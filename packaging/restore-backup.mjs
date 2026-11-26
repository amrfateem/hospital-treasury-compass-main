/**
 * Manual restore for the Al-Rahma server (run on the server PC with the app closed):
 *   node tools/restore-backup.mjs --list
 *   node tools/restore-backup.mjs                 # newest backup that passes the integrity check
 *   node tools/restore-backup.mjs --file <path>   # a specific backup file
 *   node tools/restore-backup.mjs --from <folder> # also look in another backup folder
 *
 * The current database is never deleted: it is renamed to hospital.before-restore-<time>.db.
 * Uploaded files are copied back from the same backup folder (nothing is removed).
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name) => process.argv.includes(`--${name}`);

const dataDir = process.env.ALRAHMA_DATA_DIR || resolve("data");
const dbFile = join(dataDir, "hospital.db");

function backupRoots() {
  const roots = [resolve("Backups")];
  if (process.env.ALRAHMA_BACKUP_DIR) roots.push(resolve(process.env.ALRAHMA_BACKUP_DIR));
  const shared = join(process.env.PUBLIC || "C:\\Users\\Public", "Documents", "AlRahmaHospitalBackups");
  if (existsSync(shared)) for (const pc of readdirSync(shared)) roots.push(join(shared, pc));
  try {
    const cfg = JSON.parse(readFileSync(join(dataDir, "backup-config.json"), "utf8"));
    for (const d of cfg.extraDirs ?? []) roots.push(resolve(d));
  } catch {
    /* no extra folders */
  }
  if (arg("from")) roots.push(resolve(arg("from")));
  return [...new Set(roots)];
}

function healthy(path) {
  let d;
  try {
    d = new DatabaseSync(path, { readOnly: true });
    const row = d.prepare("PRAGMA quick_check").get();
    if (Object.values(row ?? {})[0] !== "ok") return false;
    return !!d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'").get();
  } catch {
    return false;
  } finally {
    try {
      d?.close();
    } catch {
      /* ignore */
    }
  }
}

function snapshots() {
  const out = [];
  for (const root of backupRoots()) {
    const dir = join(root, "db");
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir))
      if (/^hospital-\d{4}-\d{2}-\d{2}.*\.db$/.test(n)) {
        const p = join(dir, n);
        out.push({ path: p, root, mtime: statSync(p).mtimeMs, size: statSync(p).size });
      }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function mirror(from, to) {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const s = join(from, e.name);
    const t = join(to, e.name);
    if (e.isDirectory()) n += mirror(s, t);
    else if (!existsSync(t) || statSync(t).size !== statSync(s).size) {
      copyFileSync(s, t);
      n++;
    }
  }
  return n;
}

async function serverRunning() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch("http://127.0.0.1/api/ping", { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  }
}

const list = snapshots();
if (has("list")) {
  console.log("Backups (newest first) / النسخ من الأحدث:");
  for (const s of list.slice(0, 30))
    console.log(`  ${new Date(s.mtime).toLocaleString()}  ${(s.size / 1048576).toFixed(1)} MB  ${healthy(s.path) ? "OK " : "BAD"}  ${s.path}`);
  if (!list.length) console.log("  (none found / لا توجد نسخ)");
  process.exit(0);
}

if ((await serverRunning()) && !has("force")) {
  console.error("The hospital app is still running. Close it (or stop the AlRahma service) first.");
  console.error("البرنامج لسه شغال — اقفله (أو أوقف الخدمة) الأول وبعدين جرّب تاني.");
  process.exit(1);
}

let pick;
if (arg("file")) {
  const p = resolve(arg("file"));
  if (!healthy(p)) {
    console.error(`This file is not a healthy backup: ${p}`);
    process.exit(1);
  }
  pick = { path: p, root: dirname(dirname(p)) };
} else {
  pick = list.find((s) => healthy(s.path));
}
if (!pick) {
  console.error("No healthy backup found. Use --from <folder> to point at another backup folder.");
  console.error("مفيش نسخة سليمة — استخدم --from عشان تحدد مكان نسخ تاني.");
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
if (existsSync(dbFile)) {
  const aside = join(dataDir, `hospital.before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  renameSync(dbFile, aside);
  for (const ext of ["-wal", "-shm"]) if (existsSync(dbFile + ext)) renameSync(dbFile + ext, aside + ext);
  console.log(`Current database kept as / القاعدة الحالية اتحفظت باسم: ${aside}`);
}
copyFileSync(pick.path, `${dbFile}.restoring`);
renameSync(`${dbFile}.restoring`, dbFile);
const files = mirror(join(pick.root, "files"), join(dataDir, "files"));
console.log(`Restored from / تم الاسترجاع من: ${pick.path}`);
console.log(`Files copied back / ملفات اترجعت: ${files}`);
console.log("Start the app again. / شغّل البرنامج تاني.");
