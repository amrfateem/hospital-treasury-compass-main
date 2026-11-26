/**
 * Backups: a verified SQLite snapshot plus an additive mirror of uploaded files, written to every
 * destination — the program folder on the USB (`<app>/Backups`), the server PC's own disk
 * (`ALRAHMA_BACKUP_DIR`) and any extra folders the director added (second USB, another disk,
 * network share, cloud-synced folder). One runs at start, then every hour when something
 * changed, and at least once a day. Each snapshot is written to a temporary name, checked, then
 * renamed, so a power cut mid-backup never leaves a broken "latest" copy.
 */
import type { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { cairoDay, db } from "./db.server";
import { backupDestinations, dataDir, dbFile, filesDir, mirrorFiles, type DestinationKind } from "./paths.server";
import { isHealthyDatabase, recoveryLog, type RecoveryEvent } from "./recovery.server";

const KEEP_DAYS = 60;
/** Every snapshot of today and yesterday is kept; older days keep their last snapshot only. */
const KEEP_ALL_DAYS = 2;
const HOUR = 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

/** The shared public copy must not be readable by every Windows user on the PC. */
function securePublicCopy(dir: string) {
  if (process.platform !== "win32" || !/[\\/]AlRahmaHospitalBackups[\\/]/i.test(`${dir}\\`)) return;
  const user = process.env["USERNAME"];
  try {
    execFileSync(
      "icacls",
      [
        dir,
        "/inheritance:r",
        "/grant:r",
        "*S-1-5-18:(OI)(CI)F",
        "*S-1-5-32-544:(OI)(CI)F",
        ...(user ? [`${user}:(OI)(CI)F`] : []),
      ],
      { stdio: "ignore", windowsHide: true },
    );
  } catch {
    /* a non-admin user may not change the ACL; keep the backup instead of failing it */
  }
}
let running = false;

export interface DestinationStatus {
  kind: DestinationKind;
  dir: string;
  lastAt: string | null;
  lastFile: string | null;
  lastError: string | null;
  /** Free space on that drive (bytes), when it can be read. */
  freeBytes: number | null;
  snapshots: number;
}

export interface BackupStatus {
  lastDay: string | null;
  lastAt: string | null;
  /** Kept for older screens: the USB and server-PC folders. */
  usbDir: string;
  hostDir: string | null;
  lastError: string | null;
  destinations: DestinationStatus[];
  recoveries: RecoveryEvent[];
}

interface SavedStatus {
  lastDay?: string | null;
  lastAt?: string | null;
  lastError?: string | null;
  perDir?: Record<string, { lastAt: string | null; lastFile: string | null; lastError: string | null }>;
}

function statusPath() {
  return join(dataDir(), "backup-status.json");
}

function readSaved(): SavedStatus {
  try {
    return JSON.parse(readFileSync(statusPath(), "utf8")) as SavedStatus;
  } catch {
    return {};
  }
}

function saveStatus(patch: SavedStatus) {
  const next = { ...readSaved(), ...patch };
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(statusPath(), JSON.stringify(next, null, 2));
}

function freeBytes(dir: string): number | null {
  try {
    let probe = dir;
    while (!existsSync(probe)) {
      const up = join(probe, "..");
      if (up === probe) return null;
      probe = up;
    }
    const s = statfsSync(probe);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

function countSnapshots(dir: string) {
  try {
    return readdirSync(join(dir, "db")).filter((n) => /^hospital-.*\.db$/.test(n)).length;
  } catch {
    return 0;
  }
}

export function backupStatus(): BackupStatus {
  const saved = readSaved();
  const dests = backupDestinations();
  return {
    lastDay: saved.lastDay ?? null,
    lastAt: saved.lastAt ?? null,
    usbDir: dests.find((d) => d.kind === "usb")!.dir,
    hostDir: dests.find((d) => d.kind === "host")?.dir ?? null,
    lastError: saved.lastError ?? null,
    destinations: dests.map((d) => {
      const s = saved.perDir?.[d.dir];
      return {
        kind: d.kind,
        dir: d.dir,
        lastAt: s?.lastAt ?? null,
        lastFile: s?.lastFile ?? null,
        lastError: s?.lastError ?? null,
        freeBytes: freeBytes(d.dir),
        snapshots: countSnapshots(d.dir),
      };
    }),
    recoveries: recoveryLog().slice(0, 5),
  };
}

/**
 * Which snapshot files to delete: days older than `keepDays` go; days before the last
 * `keepAllDays` keep only their newest snapshot. Pure (covered by backup.test.ts).
 */
export function prunePlan(names: string[], today: string, keepDays = KEEP_DAYS, keepAllDays = KEEP_ALL_DAYS): string[] {
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const cutoff = shift(keepDays);
  const keepAllFrom = shift(keepAllDays - 1);
  const byDay = new Map<string, { name: string; stamp: string }[]>();
  for (const name of names) {
    const m = /^hospital-(\d{4}-\d{2}-\d{2}).*?-(\d{4})\.db$/.exec(name) ?? /^hospital-(\d{4}-\d{2}-\d{2}).*\.db$/.exec(name);
    if (!m) continue;
    const list = byDay.get(m[1]!) ?? [];
    list.push({ name, stamp: m[2] ?? "0000" });
    byDay.set(m[1]!, list);
  }
  const drop: string[] = [];
  for (const [day, list] of byDay) {
    if (day < cutoff) {
      drop.push(...list.map((x) => x.name));
      continue;
    }
    if (day >= keepAllFrom) continue;
    const newest = [...list].sort((a, b) => b.stamp.localeCompare(a.stamp) || b.name.localeCompare(a.name))[0]!;
    drop.push(...list.filter((x) => x !== newest).map((x) => x.name));
  }
  return drop.sort();
}

function pruneDbDir(dir: string) {
  if (!existsSync(dir)) return;
  for (const name of prunePlan(readdirSync(dir), cairoDay())) {
    rmSync(join(dir, name), { force: true });
    rmSync(join(dir, name.replace(/\.db$/, ".json")), { force: true });
  }
  // Leftovers of a backup cut off half-way (power cut, unplugged drive).
  for (const name of readdirSync(dir)) if (/\.partial(-wal|-shm)?$/.test(name)) rmSync(join(dir, name), { force: true });
}

// Loaded at runtime: the preview's build stubs node:sqlite without `backup`, so a static named
// import fails that build even though the packaged Node runtime has it.
type SqliteBackup = (db: DatabaseSync, path: string) => Promise<number>;
function sqliteBackup(source: DatabaseSync, path: string) {
  const mod = process.getBuiltinModule("node:sqlite") as { backup: SqliteBackup };
  return mod.backup(source, path);
}

async function snapshot(dir: string, day: string, reason: string) {
  mkdirSync(join(dir, "db"), { recursive: true });
  // Cairo clock, like the day in the name, so the newest snapshot of a day sorts last.
  const stamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date())
    .replace(":", "");
  const suffix = reason === "daily" ? "" : `-${reason.replace(/[^a-z0-9-]/gi, "")}`;
  const base = `hospital-${day}${suffix}-${stamp}`;
  const target = join(dir, "db", `${base}.db`);
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });
  await sqliteBackup(db(), partial);
  // Only a copy that opens and passes the integrity check becomes a real backup.
  const healthy = isHealthyDatabase(partial);
  // The check opens the copy, which leaves empty -wal/-shm side files next to it.
  for (const ext of ["-wal", "-shm"]) rmSync(partial + ext, { force: true });
  if (!healthy) {
    rmSync(partial, { force: true });
    throw new Error("النسخة الجديدة لم تجتز فحص السلامة — لم تُحفظ.");
  }
  renameSync(partial, target);
  mirrorFiles(filesDir(), join(dir, "files"));
  writeFileSync(
    join(dir, "db", `${base}.json`),
    JSON.stringify(
      { at: new Date().toISOString(), day, reason, appVersion: process.env["ALRAHMA_VERSION"] || "dev", schema: "1" },
      null,
      2,
    ),
  );
  pruneDbDir(join(dir, "db"));
  return target;
}

/** Last time the live database file changed on disk (main file or its write-ahead log). */
function lastWrite(): number {
  let t = 0;
  for (const f of [dbFile(), `${dbFile()}-wal`])
    try {
      t = Math.max(t, statSync(f).mtimeMs);
    } catch {
      /* not there */
    }
  return t;
}

export interface BackupResult {
  ok: string[];
  failed: { dir: string; error: string }[];
  error: string | null;
}

/** Runs a backup now in every destination. Used at start, hourly, daily and before updates. */
export async function runBackup(reason = "manual"): Promise<BackupResult> {
  if (running) return { ok: [], failed: [], error: "busy" };
  running = true;
  const day = cairoDay();
  const ok: string[] = [];
  const failed: { dir: string; error: string }[] = [];
  const perDir = { ...(readSaved().perDir ?? {}) };
  try {
    for (const dest of backupDestinations()) {
      const at = new Date().toISOString();
      try {
        const file = await snapshot(dest.dir, day, reason);
        if (dest.kind === "host") securePublicCopy(dest.dir);
        ok.push(file);
        perDir[dest.dir] = { lastAt: at, lastFile: file, lastError: null };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        failed.push({ dir: dest.dir, error });
        perDir[dest.dir] = { lastAt: perDir[dest.dir]?.lastAt ?? null, lastFile: perDir[dest.dir]?.lastFile ?? null, lastError: error };
        console.error("[alrahma] backup failed in", dest.dir, e);
      }
    }
    const error = ok.length ? (failed.length ? `فشل النسخ في ${failed.length} مكان` : null) : (failed[0]?.error ?? "لا يوجد مكان للنسخ");
    saveStatus({
      ...(ok.length ? { lastDay: day, lastAt: new Date().toISOString() } : {}),
      lastError: error,
      perDir,
    });
    console.log("[alrahma] backup", reason, day, ok.length, "ok,", failed.length, "failed");
    return { ok, failed, error };
  } finally {
    running = false;
  }
}

/** Hourly check: back up when today has no backup yet, or something changed since the last one. */
export function backupDue(now = Date.now()): string | null {
  const s = readSaved();
  if (s.lastDay !== cairoDay(new Date(now))) return "daily";
  const last = s.lastAt ? Date.parse(s.lastAt) : 0;
  if (now - last >= HOUR - 60_000 && lastWrite() > last) return "hourly";
  return null;
}

export async function startBackups() {
  if (process.env["ALRAHMA_BACKUPS"] === "0" || timer) return;
  void runBackup(readSaved().lastDay === cairoDay() ? "start" : "daily");
  timer = setInterval(() => {
    const why = backupDue();
    if (why) void runBackup(why);
  }, 10 * 60 * 1000);
}

/** True while a backup is being written (the start-up backup right after the app opens, for example). */
export function backupRunning() {
  return running;
}

export function stopBackups() {
  if (timer) clearInterval(timer);
  timer = null;
}
