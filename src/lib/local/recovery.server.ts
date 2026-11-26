/**
 * Start-up safety net for the live database. Before the app opens `hospital.db` it checks the
 * file; a damaged file is put aside (never deleted) and the newest backup that passes an integrity
 * check is put back, from the USB, the server PC or an extra backup folder. A missing database
 * on the packaged app (new USB after the old one broke) is restored the same way.
 */
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backupDestinations, dataDir, dbFile, filesDir, mirrorFiles } from "./paths.server";

export interface RecoveryEvent {
  at: string;
  reason: "missing" | "damaged" | "damaged-no-backup";
  restoredFrom: string | null;
  setAside: string | null;
  /** When the director confirmed they reviewed this recovery; the dashboard warning stops then. */
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
}

/** True when the SQLite file opens and passes a quick integrity check. */
export function isHealthyDatabase(path: string): boolean {
  if (!existsSync(path)) return false;
  let d: DatabaseSync | null = null;
  try {
    d = new DatabaseSync(path, { readOnly: true });
    const row = d.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
    const ok = row ? Object.values(row)[0] === "ok" : false;
    if (!ok) return false;
    const t = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks'").get();
    return !!t;
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

/** Backup snapshots in the given folders, newest first. */
export function listSnapshots(dirs: string[]): { path: string; dir: string; mtime: number; size: number }[] {
  const out: { path: string; dir: string; mtime: number; size: number }[] = [];
  for (const dir of dirs) {
    const db = join(dir, "db");
    if (!existsSync(db)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(db);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!/^hospital-\d{4}-\d{2}-\d{2}.*\.db$/.test(n)) continue;
      try {
        const st = statSync(join(db, n));
        out.push({ path: join(db, n), dir, mtime: st.mtimeMs, size: st.size });
      } catch {
        /* unreadable */
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** The newest backup that passes the integrity check, or null. */
export function newestHealthySnapshot(dirs = backupDestinations().map((d) => d.dir)) {
  for (const s of listSnapshots(dirs)) if (isHealthyDatabase(s.path)) return s;
  return null;
}

function logPath() {
  return join(dataDir(), "recovery-log.json");
}

export function recoveryLog(): RecoveryEvent[] {
  try {
    const v = JSON.parse(readFileSync(logPath(), "utf8")) as unknown;
    return Array.isArray(v) ? (v as RecoveryEvent[]) : [];
  } catch {
    return [];
  }
}

/** Marks every recovery not yet reviewed as reviewed by `by`. Returns how many were marked. */
export function acknowledgeRecoveries(by: string): number {
  const log = recoveryLog();
  const at = new Date().toISOString();
  let n = 0;
  const next = log.map((e) => {
    if (e.acknowledgedAt) return e;
    n++;
    return { ...e, acknowledgedAt: at, acknowledgedBy: by };
  });
  if (n) {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(logPath(), JSON.stringify(next, null, 2));
  }
  return n;
}

function record(e: RecoveryEvent) {
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(logPath(), JSON.stringify([e, ...recoveryLog()].slice(0, 50), null, 2));
  } catch {
    /* best effort */
  }
  console.warn("[alrahma] database recovery", e);
}

function putBack(snapshot: { path: string; dir: string }) {
  const target = dbFile();
  const tmp = `${target}.restoring`;
  copyFileSync(snapshot.path, tmp);
  renameSync(tmp, target);
  // Uploaded files (ID cards, contracts...) come back from the same backup folder.
  mirrorFiles(join(snapshot.dir, "files"), filesDir());
}

/**
 * Makes sure `hospital.db` is usable before it is opened. Returns what happened, or null when the
 * file was fine (or new on a dev machine).
 */
export function prepareDatabaseFile(opts: { restoreMissing: boolean } = { restoreMissing: process.env["ALRAHMA_APP"] === "1" }): RecoveryEvent | null {
  const file = dbFile();
  mkdirSync(dataDir(), { recursive: true });
  if (!existsSync(file)) {
    if (!opts.restoreMissing) return null;
    const snap = newestHealthySnapshot();
    if (!snap) return null;
    putBack(snap);
    const e: RecoveryEvent = { at: new Date().toISOString(), reason: "missing", restoredFrom: snap.path, setAside: null };
    record(e);
    return e;
  }
  if (isHealthyDatabase(file)) return null;
  const snap = newestHealthySnapshot();
  if (!snap) {
    // Nothing better to put back: keep working on the file as it is and warn the director.
    const e: RecoveryEvent = { at: new Date().toISOString(), reason: "damaged-no-backup", restoredFrom: null, setAside: null };
    record(e);
    return e;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const aside = join(dataDir(), `hospital.damaged-${stamp}.db`);
  renameSync(file, aside);
  for (const ext of ["-wal", "-shm"]) if (existsSync(file + ext)) renameSync(file + ext, aside + ext);
  putBack(snap);
  const e: RecoveryEvent = { at: new Date().toISOString(), reason: "damaged", restoredFrom: snap.path, setAside: aside };
  record(e);
  return e;
}
