#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    ffi::OsStr,    fs::{create_dir_all, OpenOptions},
    io::Write,
    net::TcpStream,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread::sleep,
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    webview::{DownloadEvent, PermissionKind, PermissionResponse},
    Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use windows_sys::Win32::Graphics::Printing::{
    ClosePrinter, EndDocPrinter, EndPagePrinter, EnumPrintersW, GetDefaultPrinterW, OpenPrinterW,
    StartDocPrinterW, StartPagePrinter, WritePrinter, DOC_INFO_1W, PRINTER_ENUM_CONNECTIONS,
    PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_4W,
};

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
    let tls = dir.join("server").join("tls-entry.mjs");
    if tls.exists() {
        return tls;
    }
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

fn has_tls(dir: &Path) -> bool {
    dir.join("tls").join("server.crt").exists() && dir.join("tls").join("server.key").exists()
}

fn wait_for_server(port: u16) -> bool {
    for _ in 0..80 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        sleep(Duration::from_millis(250));
    }
    false
}

fn spawn_server(dir: &Path, log_path: &Path) -> Option<Child> {
    let tls = has_tls(dir);
    let port = if tls { "443" } else { "80" };
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
        .env("PORT", port)
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

fn exports_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .or_else(|_| app.path().download_dir())
        .unwrap_or_else(|_| app_dir())
        .join("AlRahmaHospital")
        .join("Exports")
}

fn safe_file_name(name: &OsStr) -> String {
    let cleaned: String = name
        .to_string_lossy()
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 32 => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "export".to_string()
    } else {
        trimmed
    }
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(OsStr::to_str).unwrap_or("export");
    let ext = path.extension().and_then(OsStr::to_str);
    for n in 2..10_000 {
        let next = match ext {
            Some(ext) => dir.join(format!("{stem} ({n}).{ext}")),
            None => dir.join(format!("{stem} ({n})")),
        };
        if !next.exists() {
            return next;
        }
    }
    dir.join(format!("{stem}-{}", chrono_like()))
}

fn log_line(file: &str, text: &str) {
    let dir = app_dir().join("data").join("logs");
    let _ = create_dir_all(&dir);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(dir.join(file)) {
        let _ = writeln!(f, "[{}] {}", chrono_like(), text);
    }
}

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

unsafe fn pwstr_to_string(p: *const u16) -> String {
    if p.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *p.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
}

#[tauri::command]
fn list_printers() -> Result<Vec<String>, String> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed = 0u32;
    let mut returned = 0u32;
    unsafe {
        EnumPrintersW(
            flags,
            std::ptr::null(),
            4,
            std::ptr::null_mut(),
            0,
            &mut needed,
            &mut returned,
        );
    }
    if needed == 0 {
        return Ok(Vec::new());
    }
    let mut buffer = vec![0u8; needed as usize + 1024];
    let ok = unsafe {
        EnumPrintersW(
            flags,
            std::ptr::null(),
            4,
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            &mut needed,
            &mut returned,
        )
    };
    if ok == 0 {
        return Err(format!(
            "تعذّر قراءة قائمة الطابعات: {}",
            std::io::Error::last_os_error()
        ));
    }
    let infos = unsafe {
        std::slice::from_raw_parts(buffer.as_ptr() as *const PRINTER_INFO_4W, returned as usize)
    };
    let mut names = Vec::new();
    for info in infos {
        let name = unsafe { pwstr_to_string(info.pPrinterName) };
        if !name.is_empty() {
            names.push(name);
        }
    }
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    Ok(names)
}

#[tauri::command]
fn default_printer() -> Result<String, String> {
    let mut size = 0u32;
    unsafe {
        GetDefaultPrinterW(std::ptr::null_mut(), &mut size);
    }
    if size == 0 {
        return Ok(String::new());
    }
    let mut buffer = vec![0u16; size as usize + 1];
    let ok = unsafe { GetDefaultPrinterW(buffer.as_mut_ptr(), &mut size) };
    if ok == 0 {
        return Ok(String::new());
    }
    Ok(unsafe { pwstr_to_string(buffer.as_ptr()) })
}

fn send_raw(printer: &str, bytes: &[u8]) -> Result<(), String> {
    if printer.trim().is_empty() {
        return Err("اختر طابعة الإيصالات أولًا.".to_string());
    }
    let printer_w = wide(printer);
    let mut handle = PRINTER_HANDLE::default();
    unsafe {
        if OpenPrinterW(printer_w.as_ptr(), &mut handle, std::ptr::null()) == 0 {
            return Err(format!(
                "تعذّر فتح الطابعة «{printer}»: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    let mut doc_name = wide("Al-Rahma receipt");
    let mut datatype = wide("RAW");
    let doc = DOC_INFO_1W {
        pDocName: doc_name.as_mut_ptr(),
        pOutputFile: std::ptr::null_mut(),
        pDatatype: datatype.as_mut_ptr(),
    };
    let result = unsafe {
        let job = StartDocPrinterW(handle, 1, &doc);
        if job == 0 {
            Err(format!(
                "تعذّر بدء مهمة الطباعة: {}",
                std::io::Error::last_os_error()
            ))
        } else if StartPagePrinter(handle) == 0 {
            Err(format!(
                "تعذّر بدء صفحة الطباعة: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            let mut written = 0u32;
            let wrote = WritePrinter(
                handle,
                bytes.as_ptr() as *const std::ffi::c_void,
                bytes.len() as u32,
                &mut written,
            );
            let _ = EndPagePrinter(handle);
            let _ = EndDocPrinter(handle);
            if wrote == 0 || written as usize != bytes.len() {
                Err(format!(
                    "تعذّر إرسال بيانات الإيصال للطابعة: {}",
                    std::io::Error::last_os_error()
                ))
            } else {
                Ok(())
            }
        }
    };
    unsafe {
        let _ = ClosePrinter(handle);
    }
    result
}

/// Prints a pre-rendered 1-bit receipt image with ESC/POS (thermal receipt printers).
#[tauri::command]
fn print_receipt_raw(
    printer: String,
    width_bytes: u32,
    height: u32,
    data: String,
    copies: u32,
    cut: bool,
) -> Result<(), String> {
    if !(32..=128).contains(&width_bytes) {
        return Err("عرض الطباعة غير صحيح.".to_string());
    }
    if height == 0 || height > 30_000 {
        return Err("ارتفاع الإيصال غير صحيح.".to_string());
    }
    let rows = B64
        .decode(data)
        .map_err(|_| "بيانات الطباعة غير صحيحة.".to_string())?;
    if rows.len() != width_bytes as usize * height as usize {
        return Err("حجم صورة الإيصال لا يطابق الأبعاد.".to_string());
    }
    let copies = copies.clamp(1, 3);
    let mut job = Vec::with_capacity(16 + copies as usize * (rows.len() + 16));
    job.extend_from_slice(&[0x1b, 0x40]); // ESC @ init
    // Many thermal printers only buffer a few hundred raster lines per GS v 0 command and
    // drop or garble the rest of a long receipt, so the image is sent in bands.
    const BAND: usize = 256;
    let row_bytes = width_bytes as usize;
    let xl = (width_bytes & 0xff) as u8;
    let xh = ((width_bytes >> 8) & 0xff) as u8;
    for _ in 0..copies {
        job.extend_from_slice(&[0x1b, 0x33, 0x00]); // line spacing 0 between bands
        let mut start = 0usize;
        while start < height as usize {
            let lines = BAND.min(height as usize - start);
            let yl = (lines & 0xff) as u8;
            let yh = ((lines >> 8) & 0xff) as u8;
            job.extend_from_slice(&[0x1d, 0x76, 0x30, 0x00, xl, xh, yl, yh]);
            job.extend_from_slice(&rows[start * row_bytes..(start + lines) * row_bytes]);
            start += lines;
        }
        job.extend_from_slice(&[0x1b, 0x32]); // default line spacing
        if cut {
            // GS V 65 0: feed only up to the cutter and cut, so no blank paper is wasted after
            // the last line (a fixed line feed before the cut left an empty strip on every slip).
            job.extend_from_slice(&[0x1d, 0x56, 0x41, 0x00]);
        } else {
            job.extend_from_slice(&[0x1b, 0x64, 0x03]); // feed 3 lines so the slip can be torn off
        }
    }
    let printer_name = printer.clone();
    let result = send_raw(&printer, &job);
    match &result {
        Ok(()) => log_line(
            "print.log",
            &format!("printed {} copies on {} ({}x{})", copies, printer_name, width_bytes, height),
        ),
        Err(e) => log_line("print.log", &format!("print failed on {printer_name}: {e}")),
    }
    result
}

#[tauri::command]
fn open_exports_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = exports_dir(&app);
    let _ = create_dir_all(&dir);
    Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("تعذّر فتح مجلد التصدير: {e}"))?;
    Ok(())
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
            let tls = has_tls(&dir);
            let port: u16 = if tls { 443 } else { 80 };
            if server_mode {
                // A Windows service may already be serving; never start a second server.
                let service_running = TcpStream::connect(("127.0.0.1", port)).is_ok();
                if !service_running {
                    if let Some(c) = spawn_server(&dir, &log_path) {
                        child = Some(c);
                    }
                }
            }

            let url: tauri::Url = match &client_url {
                Some(u) => u.parse()?,
                None => {
                    let _ = wait_for_server(port);
                    if tls {
                        "https://127.0.0.1/".parse()?
                    } else {
                        "http://127.0.0.1/".parse()?
                    }
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
            window = window.on_permission_request(|_, kind| match kind {
                PermissionKind::AutomaticDownloads
                | PermissionKind::FileSystemAccess
                | PermissionKind::ClipboardRead => PermissionResponse::Allow,
                _ => PermissionResponse::Default,
            });
            window = window.on_download(|webview, event| {
                match event {
                    DownloadEvent::Requested { destination, .. } => {
                        let out = exports_dir(webview.app_handle());
                        let _ = create_dir_all(&out);
                        let suggested = destination
                            .file_name()
                            .map(safe_file_name)
                            .unwrap_or_else(|| "export".to_string());
                        *destination = unique_path(&out, &suggested);
                    }
                    DownloadEvent::Finished { path, success, .. } => {
                        log_line(
                            "downloads.log",
                            &format!(
                                "{} {}",
                                if success { "saved" } else { "failed" },
                                path.as_ref()
                                    .map(|p| p.display().to_string())
                                    .unwrap_or_else(|| "-".to_string())
                            ),
                        );
                    }
                    _ => {}
                }
                true
            });
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
            let exports = MenuItem::with_id(app, "exports", "مجلد التصدير", true, None::<&str>)?;
            let autostart = MenuItem::with_id(app, "autostart", "بدء التشغيل مع ويندوز", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "إغلاق", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &backups, &updates, &exports, &autostart, &quit])?;

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
                    "exports" => {
                        let dir = exports_dir(app);
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
        .invoke_handler(tauri::generate_handler![
            list_printers,
            default_printer,
            print_receipt_raw,
            open_exports_folder
        ])
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
