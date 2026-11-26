/**
 * Server-side access to the hospital document, stored as small JSON chunks in SQLite.
 * Keeps the last document in memory with its version: a request reads only the tiny version
 * row and reuses the cached copy when nothing changed.
 */
import { all, cairoDay, get, run, transaction } from "@/lib/local/db.server";
import { diffChunks, joinChunks } from "./chunks";
import { normalizeDB, type AuditEntry, type HospitalDB } from "./model";

let cache: { version: number; db: HospitalDB } | null = null;

function currentVersion(): number {
  const row = get<{ value: string }>("SELECT value FROM meta WHERE key = 'version'");
  return Number(row?.value ?? 0);
}

function readAllChunks(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of all<{ key: string; data: string }>(
    "SELECT key, data FROM chunks WHERE data IS NOT NULL ORDER BY key",
  )) {
    try {
      out[row.key] = JSON.parse(row.data) as unknown;
    } catch {
      console.error("bad chunk", row.key);
    }
  }
  return out;
}

export async function readState(): Promise<{ version: number; db: HospitalDB }> {
  const version = currentVersion();
  if (cache && cache.version === version) return cache;
  cache = { version, db: normalizeDB(joinChunks(readAllChunks()) as Partial<HospitalDB>) };
  return cache;
}

function writeAudit(entries: AuditEntry[], version: number) {
  for (const a of entries) {
    run(
      `INSERT OR IGNORE INTO audit_log (id, at, by_name, by_id, role, op, section, summary, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.id,
      Math.round(a.at),
      a.by ?? "",
      a.byId || null,
      a.role ?? "",
      a.op ?? "",
      a.section ?? "",
      a.summary ?? "",
      version,
    );
  }
}

/** Applies changed chunks atomically only if the version still matches. */
function saveChunks(expected: number, chunks: Record<string, unknown>, audit: AuditEntry[], sideEffects?: () => void): number | null {
  return transaction(() => {
    if (currentVersion() !== expected) return null;
    sideEffects?.();
    const version = expected + 1;
    const day = cairoDay();
    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(chunks)) {
      const data = value === null || value === undefined ? null : JSON.stringify(value);
      const old = get<{ data: string | null; version: number }>(
        "SELECT data, version FROM chunks WHERE key = ?",
        key,
      );
      if (old) {
        if (old.data !== data) {
          run(
            `INSERT OR IGNORE INTO restore_points (day, key, data, version, saved_at)
             VALUES (?, ?, ?, ?, ?)`,
            day,
            key,
            old.data,
            old.version,
            now,
          );
        }
        run(
          "UPDATE chunks SET data = ?, version = ?, updated_at = ? WHERE key = ?",
          data,
          version,
          now,
          key,
        );
      } else {
        run(
          `INSERT OR IGNORE INTO restore_points (day, key, data, version, saved_at)
           VALUES (?, ?, NULL, 0, ?)`,
          day,
          key,
          now,
        );
        run(
          "INSERT INTO chunks (key, data, version, updated_at) VALUES (?, ?, ?, ?)",
          key,
          data,
          version,
          now,
        );
      }
    }
    writeAudit(audit, version);
    run("UPDATE meta SET value = ? WHERE key = 'version'", String(version));
    return version;
  });
}

/** Saves only what changed between prev and next; null when another device saved first. */
export async function saveState(expected: number, prev: HospitalDB, next: HospitalDB, sideEffects?: () => void) {
  const changed = diffChunks(prev, next);
  const known = new Set(prev.auditLog.map((e) => e.id));
  const audit = next.auditLog.filter((e) => !known.has(e.id));
  let saved: number | null;
  try {
    saved = saveChunks(expected, changed, audit, sideEffects);
  } catch (error) {
    cache = null;
    throw error;
  }
  if (saved !== null) cache = { version: saved, db: next };
  else cache = null;
  return saved;
}

/** Keys of chunks saved after `since` (null when too many to send piece by piece). */
export async function changedKeysSince(since: number, limit = 400) {
  const rows = all<{ key: string }>(
    "SELECT key FROM chunks WHERE version > ? LIMIT ?",
    since,
    limit + 1,
  );
  return rows.length > limit ? null : rows.map((r) => r.key);
}

export function resetStateCache() {
  cache = null;
}
