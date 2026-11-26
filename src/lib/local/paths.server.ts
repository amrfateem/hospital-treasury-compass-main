/**
 * Where the live data and its backup copies live. Shared by the database, backups and recovery
 * so each of them looks in the same places.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/** Where the live data lives. Overridden by the Tauri shell/service. */
export function dataDir(): string {
  return process.env["ALRAHMA_DATA_DIR"] || join(process.cwd(), ".data");
}

export function filesDir(): string {
  return join(dataDir(), "files");
}

export function dbFile(): string {
  return join(dataDir(), "hospital.db");
}

export interface BackupConfig {
  /** Extra folders that get every backup too: a second USB, another disk, a network share, a cloud-synced folder. */
  extraDirs: string[];
}

function configPath() {
  return join(dataDir(), "backup-config.json");
}

export function readBackupConfig(): BackupConfig {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<BackupConfig>;
    const extraDirs = Array.isArray(raw.extraDirs)
      ? raw.extraDirs.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
      : [];
    return { extraDirs };
  } catch {
    return { extraDirs: [] };
  }
}

export function writeBackupConfig(cfg: BackupConfig) {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

export type DestinationKind = "usb" | "host" | "extra";
export interface Destination {
  kind: DestinationKind;
  dir: string;
}

/**
 * Every place a backup is written: the program folder (USB), the server PC's own disk, and any
 * extra folders the director added. Duplicates are dropped.
 */
export function backupDestinations(): Destination[] {
  const out: Destination[] = [{ kind: "usb", dir: resolve(dataDir(), "..", "Backups") }];
  const host = process.env["ALRAHMA_BACKUP_DIR"];
  if (host) out.push({ kind: "host", dir: resolve(host) });
  for (const d of readBackupConfig().extraDirs) if (isAbsolute(d)) out.push({ kind: "extra", dir: resolve(d) });
  const seen = new Set<string>();
  return out.filter((d) => {
    const k = d.dir.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Copies new or changed files from one folder tree to another; never deletes. */
export function mirrorFiles(from: string, to: string): number {
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
