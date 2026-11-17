/**
 * Daily backups: one SQLite snapshot plus an additive mirror of uploaded files, written to
 * the USB (`<app>/Backups`) and to the server PC (`ALRAHMA_BACKUP_DIR`).
 */
import { backup as sqliteBackup } from "node:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { cairoDay, dataDir, db } from "./db.server";

const KEEP_DAYS = 60;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export interface BackupStatus {
  lastDay: string | null;
  lastAt: string | null;
  usbDir: string;
  hostDir: string | null;
  lastError: string | null;
}

function statusPath() {
  return join(dataDir(), "backup-status.json");
}

export function backupStatus(): BackupStatus {
  const usbDir = join(dataDir(), "..", "Backups");
  const hostDir = process.env["ALRAHMA_BACKUP_DIR"] || null;
  try {
    const saved = JSON.parse(readFileSync(statusPath(), "utf8")) as Partial<BackupStatus>;
    return {
      lastDay: saved.lastDay ?? null,
      lastAt: saved.lastAt ?? null,
      usbDir,
      hostDir,
      lastError: saved.lastError ?? null,
    };
  } catch {
    return { lastDay: null, lastAt: null, usbDir, hostDir, lastError: null };
  }
}

function saveStatus(patch: Partial<BackupStatus>) {
  const next = { ...backupStatus(), ...patch };
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(statusPath(), JSON.stringify(next, null, 2));
}

function mirrorFiles(from: string, to: string) {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      copied += mirrorFiles(src, dst);
    } else if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) {
      copyFileSync(src, dst);
      copied += 1;
    }
  }
  return copied;
}

function pruneDbDir(dir: string) {
  if (!existsSync(dir)) return;
  const cutoff = cairoDay(new Date(Date.now() - KEEP_DAYS * 86400000));
  for (const name of readdirSync(dir)) {
    const m = /^hospital-(\d{4}-\d{2}-\d{2}).*\.db$/.exec(name);
    if (m && m[1]! < cutoff) rmSync(join(dir, name), { force: true });
  }
}

async function snapshot(dir: string, day: string, reason: string) {
  mkdirSync(join(dir, "db"), { recursive: true });
  const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
  const suffix = reason === "daily" ? "" : `-${reason.replace(/[^a-z0-9-]/gi, "")}`;
  const target = join(dir, "db", `hospital-${day}${suffix}-${stamp}.db`);
  await sqliteBackup(db(), target);
  mirrorFiles(join(dataDir(), "files"), join(dir, "files"));
  writeFileSync(
    join(dir, "db", `hospital-${day}${suffix}-${stamp}.json`),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        day,
        reason,
        appVersion: process.env["ALRAHMA_VERSION"] || "dev",
        schema: "1",
      },
      null,
      2,
    ),
  );
  pruneDbDir(join(dir, "db"));
  return target;
}

/** Runs a backup now in both destinations. Used daily and before updates. */
export async function runBackup(reason = "manual"): Promise<{ usb: string | null; host: string | null; error: string | null }> {
  if (running) return { usb: null, host: null, error: "busy" };
  running = true;
  const day = cairoDay();
  const usbDir = join(dataDir(), "..", "Backups");
  const hostDir = process.env["ALRAHMA_BACKUP_DIR"];
  let usb: string | null = null;
  let host: string | null = null;
  let error: string | null = null;
  try {
    usb = await snapshot(usbDir, day, reason);
    if (hostDir) host = await snapshot(hostDir, day, reason);
    saveStatus({ lastDay: day, lastAt: new Date().toISOString(), lastError: null });
    console.log("[alrahma] backup", day, usb, host);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    saveStatus({ lastError: error });
    console.error("[alrahma] backup failed", e);
  } finally {
    running = false;
  }
  return { usb, host, error };
}

export async function startBackups() {
  if (process.env["ALRAHMA_BACKUPS"] === "0" || timer) return;
  const status = backupStatus();
  if (status.lastDay !== cairoDay()) void runBackup("daily");
  timer = setInterval(() => {
    if (backupStatus().lastDay !== cairoDay()) void runBackup("daily");
  }, 60 * 60 * 1000);
}

export function stopBackups() {
  if (timer) clearInterval(timer);
  timer = null;
}
