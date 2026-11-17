#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs::{create_dir_all, OpenOptions},
    io::Write,
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread::sleep,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

struct ServerState {
    child: Mutex<Option<Child>>,
}

fn app_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn backup_dir() -> PathBuf {
    if let Ok(p) = env::var("ALRAHMA_BACKUP_DIR") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let public = env::var("PUBLIC").unwrap_or_else(|_| r"C:\Users\Public".to_string());
    let pc = env::var("COMPUTERNAME").unwrap_or_else(|_| "SERVER".to_string());
    PathBuf::from(public)
        .join("Documents")
        .join("AlRahmaHospitalBackups")
        .join(pc)
}

fn server_entry(dir: &Path) -> PathBuf {
    let direct = dir.join("server").join("index.mjs");
    if direct.exists() {
        return direct;
    }
    let current = dir.join("server").join("current.json");
    if let Ok(text) = std::fs::read_to_string(&current) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(version) = v.get("version").and_then(|x| x.as_str()) {
                let candidate = dir.join("server").join("versions").join(version).join("index.mjs");
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }
    direct
}

fn wait_for_server() -> bool {
    for _ in 0..80 {
        if TcpStream::connect(("127.0.0.1", 80)).is_ok() {
            return true;
        }
        sleep(Duration::from_millis(250));
    }
    false
}

fn spawn_server(dir: &Path, log_path: &Path) -> Option<Child> {
    let node = {
        let local = dir.join("node.exe");
        if local.exists() {
            local
        } else {
            PathBuf::from("node")
        }
    };
    let entry = server_entry(dir);
    let data = dir.join("data");
    let browser = data.join("browser");
    let _ = create_dir_all(&browser);
    let mut log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .ok()?;
    let _ = writeln!(log, "\n--- {} starting {} ---", chrono_like(), entry.display());
    let out = log.try_clone().ok()?;
    let err = log.try_clone().ok()?;
    let mut cmd = Command::new(&node);
    cmd.arg(&entry)
        .current_dir(dir)
        .env("NODE_ENV", "production")
        .env("ALRAHMA_APP", "1")
        .env("PORT", "80")
        .env("HOST", "0.0.0.0")
        .env("ALRAHMA_HOST", "alrahma.local")
        .env("ALRAHMA_DATA_DIR", &data)
        .env("ALRAHMA_BACKUP_DIR", backup_dir())
        .env("ALRAHMA_VERSION", env!("CARGO_PKG_VERSION"))
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    match cmd.spawn() {
        Ok(child) => {
            let _ = writeln!(log, "node started pid {}", child.id());
            Some(child)
        }
        Err(e) => {
            let _ = writeln!(log, "node failed: {e}");
            None
        }
    }
}

fn chrono_like() -> String {
    // Avoid a chrono dependency: a sortable, human-readable local timestamp is enough for logs.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{now}")
}

fn main() {
    let hidden = env::args().any(|a| a == "--hidden");
    let dir = app_dir();
    let _ = std::fs::write(
        dir.join("boot.log"),
        format!(
            "exe={:?}\ndir={:?}\nargs={:?}\n",
            env::current_exe(),
            dir,
            env::args().collect::<Vec<_>>()
        ),
    );
    let client_conf = dir.join("client.json");
    let client_url = std::fs::read_to_string(&client_conf)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("url").and_then(|u| u.as_str()).map(str::to_string));
    let server_mode = client_url.is_none();

    let log_dir = dir.join("data").join("logs");
    let _ = create_dir_all(&log_dir);
    let log_path = log_dir.join("app.log");

    // Prefer the WebView2 runtime shipped next to the exe; fall back to the Windows one.
    let webview = dir.join("webview2");
    if webview.join("msedgewebview2.exe").exists() {
        env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &webview);
    }

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));

    if server_mode {
        builder = builder.manage(ServerState {
            child: Mutex::new(None),
        });
    }

    let app = builder
        .setup(move |app| {
            let mut child = None;
            if server_mode {
                // A Windows service may already be serving; never start a second server.
                let service_running = TcpStream::connect(("127.0.0.1", 80)).is_ok();
                if !service_running {
                    if let Some(c) = spawn_server(&dir, &log_path) {
                        child = Some(c);
                    }
                }
            }

            let url: tauri::Url = match &client_url {
                Some(u) => u.parse()?,
                None => {
                    let _ = wait_for_server();
                    "http://127.0.0.1/".parse()?
                }
            };

            let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("مستشفى الرحمة التخصصي")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 700.0)
                .visible(!(server_mode && hidden));
            if server_mode {
                window = window.data_directory(dir.join("data").join("browser"));
            }
            let window = window.build()?;

            if server_mode {
                if let Some(state) = app.try_state::<ServerState>() {
                    *state.child.lock().unwrap() = child;
                }
                let hide_on_close = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = hide_on_close.hide();
                    }
                });
            }

            let open = MenuItem::with_id(app, "open", "فتح النظام", true, None::<&str>)?;
            let backups = MenuItem::with_id(app, "backups", "مجلد النسخ الاحتياطي", true, None::<&str>)?;
            let updates = MenuItem::with_id(app, "updates", "مجلد التحديثات", true, None::<&str>)?;
            let autostart = MenuItem::with_id(app, "autostart", "بدء التشغيل مع ويندوز", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "إغلاق", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &backups, &updates, &autostart, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("مستشفى الرحمة التخصصي")
                .menu(&menu);
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "backups" => {
                        let _ = Command::new("explorer").arg(backup_dir()).spawn();
                    }
                    "updates" => {
                        let dir = app_dir().join("Updates");
                        let _ = create_dir_all(&dir);
                        let _ = Command::new("explorer").arg(dir).spawn();
                    }
                    "autostart" => {
                        let manager = app.autolaunch();
                        let enabled = manager.is_enabled().unwrap_or(false);
                        let _ = if enabled { manager.disable() } else { manager.enable() };
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let _ = window.set_focus();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<ServerState>() {
                if let Some(mut child) = state.child.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}
