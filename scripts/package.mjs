/**
 * Assembles the portable Windows folders from a production build.
 * Run after `vite build` and `cargo build --release`.
 * Set NO_WEBVIEW2=1 to skip the bundled runtime (uses the Windows one).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(".");
const out = join(root, "release");
const serverDir = join(out, "AlRahmaHospital");
const clientDir = join(out, "AlRahmaHospital-client");

function copy(src, dst) {
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  cpSync(src, dst, { recursive: true });
}

function webviewDir() {
  if (process.env.NO_WEBVIEW2 === "1") return null;
  if (process.env.WEBVIEW2_DIR) return process.env.WEBVIEW2_DIR;
  const base = "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application";
  if (!existsSync(base)) return null;
  const versions = readdirSync(base)
    .filter((n) => /^\d+\./.test(n))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return versions.length ? join(base, versions[0]) : null;
}

function nodeExe() {
  if (process.env.NODE_EXE) return process.env.NODE_EXE;
  const fromPath = execFileSync("where", ["node"], { encoding: "utf8" }).split(/\r?\n/)[0];
  return fromPath || "C:\\Program Files\\nodejs\\node.exe";
}

function loaderDll() {
  const local = join(root, "src-tauri", "target", "release", "WebView2Loader.dll");
  if (existsSync(local)) return local;
  const registry = join(process.env.USERPROFILE, ".cargo", "registry", "src");
  if (existsSync(registry)) {
    for (const host of readdirSync(registry)) {
      const hostDir = join(registry, host);
      for (const crate of readdirSync(hostDir)) {
        if (!crate.startsWith("webview2-com-sys-")) continue;
        const dll = join(hostDir, crate, "x64", "WebView2Loader.dll");
        if (existsSync(dll)) return dll;
      }
    }
  }
  throw new Error("WebView2Loader.dll not found; build Tauri first.");
}

const webview = webviewDir();
const node = nodeExe();
const winsw = join(root, "tools", "winsw", "AlRahmaService.exe");

rmSync(out, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });
mkdirSync(clientDir, { recursive: true });

for (const dir of [serverDir, clientDir]) {
  copyFileSync(join(root, "src-tauri", "target", "release", "alrahma-hospital.exe"), join(dir, "AlRahmaHospital.exe"));
  copyFileSync(loaderDll(), join(dir, "WebView2Loader.dll"));
  if (webview) copy(webview, join(dir, "webview2"));
}

copy(join(root, ".output", "server"), join(serverDir, "server"));
copy(join(root, ".output", "public"), join(serverDir, "public"));
copyFileSync(node, join(serverDir, "node.exe"));

for (const name of ["data", "Backups", "Updates"]) mkdirSync(join(serverDir, name), { recursive: true });
for (const name of ["install-service.ps1", "uninstall-service.ps1", "Trust-AlRahma.ps1", "Run-Update.ps1", "README-AR.txt"]) {
  const p = join(root, "packaging", name);
  if (existsSync(p)) copyFileSync(p, join(serverDir, name));
}
if (existsSync(join(root, "trust"))) {
  copy(join(root, "trust"), join(serverDir, "trust"));
  copy(join(root, "trust"), join(clientDir, "trust"));
}
if (existsSync(winsw)) copyFileSync(winsw, join(serverDir, "AlRahmaService.exe"));
if (existsSync(join(root, "packaging", "Trust-AlRahma.ps1"))) {
  copyFileSync(join(root, "packaging", "Trust-AlRahma.ps1"), join(clientDir, "Trust-AlRahma.ps1"));
}
const clientReadme = join(root, "packaging", "README-CLIENT-AR.txt");
if (existsSync(clientReadme)) {
  copyFileSync(clientReadme, join(clientDir, "README-AR.txt"));
}

writeFileSync(
  join(clientDir, "client.json"),
  JSON.stringify({ url: process.env.ALRAHMA_CLIENT_URL || "http://alrahma.local" }, null, 2),
);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
writeFileSync(join(serverDir, "version.txt"), `version=${pkg.version || "0.1.0"}\n`);
writeFileSync(join(clientDir, "version.txt"), `version=${pkg.version || "0.1.0"}\n`);

console.log("server:", serverDir);
console.log("client:", clientDir);
console.log("webview2:", webview ?? "system");
console.log("node:", node);
