/**
 * Builds a signed offline update folder for the current production build.
 * Output: release/updates/<version>/  (copy it to <app>\Updates on the hospital server).
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = resolve(".");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = process.env.UPDATE_VERSION || pkg.version || "0.1.0";
const out = join(root, "release", "updates", version);
const payload = join(out, "payload");

rmSync(out, { recursive: true, force: true });
mkdirSync(payload, { recursive: true });
cpSync(join(root, ".output", "server"), join(payload, "server"), { recursive: true });
copyFileSync(join(root, "packaging", "tls-entry.mjs"), join(payload, "server", "tls-entry.mjs"));
cpSync(join(root, ".output", "public"), join(payload, "public"), { recursive: true });
if (existsSync(join(root, "release", "AlRahmaHospital", "tls")))
  cpSync(join(root, "release", "AlRahmaHospital", "tls"), join(payload, "tls"), { recursive: true });

// The desktop shell carries the download and direct-print fixes, so it travels with the update.
for (const name of ["AlRahmaHospital.exe", "WebView2Loader.dll"]) {
  const from = join(root, "release", "AlRahmaHospital", name);
  if (!existsSync(from)) throw new Error(`${name} is missing from the packaged server folder.`);
  copyFileSync(from, join(payload, name));
}

function walk(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else files.push(relative(base, full).split(sep).join("/"));
  }
  return files;
}

const files = walk(payload);
const hashes = {};
for (const rel of files) {
  hashes[rel] = createHash("sha256").update(readFileSync(join(payload, rel))).digest("hex");
}

const table = Object.entries(hashes)
  .map(([path, hash]) => `  "${path.replace(/"/g, '\\"')}" = "${hash}"`)
  .join("\n");

const template = readFileSync(join(root, "packaging", "apply-update.ps1.template"), "utf8");
const scriptPath = join(out, "apply-update.ps1");
writeFileSync(
  scriptPath,
  "\uFEFF" + template.replace("__VERSION__", version).replace("__HASHES__", `@{\n${table}\n}`),
  "utf8",
);

const manifest = {
  version,
  builtAt: new Date().toISOString(),
  files: files.map((path) => ({ path, sha256: hashes[path], size: statSync(join(payload, path)).size })),
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

const thumbprintFile = join(root, "signing", "leaf-thumbprint.txt");
let signed = "unsigned";
if (existsSync(thumbprintFile)) {
  const thumbprint = readFileSync(thumbprintFile, "utf8").trim();
  const command =
    `$c = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Thumbprint -eq '${thumbprint}' }; ` +
    `if (-not $c) { throw 'signing certificate not found' }; ` +
    `$s = Set-AuthenticodeSignature -FilePath '${scriptPath.replace(/'/g, "''")}' -Certificate $c -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256; ` +
    `Write-Output $s.Status`;
  signed = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" }).trim();
}

writeFileSync(
  join(out, "README-UPDATE.txt"),
  `Al-Rahma Hospital update ${version}\n\n` +
    `1) Copy this whole folder to <application folder>\\Updates (replace the old contents).\n` +
    `2) The nightly SYSTEM task applies it at 3am or on next boot.\n` +
    `3) For tray-only mode, close the app and run apply-update.ps1 as administrator.\n` +
    `4) A database backup is written under Backups\\pre-update-* before switching.\n` +
    `5) The previous server/public folders and the old exe stay as *.old-${version} for rollback.\n` +
    `6) Client PCs need the new exe too; copy client-${version} (or the updated client folder) there.\n\n` +
    `Signed: ${signed}\nFiles: ${files.length}\n`,
);

console.log("update:", out);
console.log("files:", files.length);
console.log("signed:", signed);
