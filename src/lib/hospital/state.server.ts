/**
 * Server-side access to the hospital document (stored as chunks, see chunks.ts).
 * Keeps the last document in memory with its version: a request reads only the tiny version
 * row and reuses the cached copy when nothing changed, instead of re-reading everything.
 */
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { diffChunks, joinChunks, splitDB } from "./chunks";
import { normalizeDB, type AuditEntry, type HospitalDB } from "./model";

let cache: { version: number; db: HospitalDB } | null = null;
const PAGE = 500;

async function currentVersion() {
  const { data, error } = await supabaseAdmin.from("hospital_state_meta").select("version").eq("id", 1).single();
  if (error) throw error;
  return Number(data.version);
}

async function readAllChunks(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("hospital_chunks")
      .select("key, data")
      .not("data", "is", null)
      .order("key")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data) out[r.key] = r.data;
    if (data.length < PAGE) break;
  }
  return out;
}

/** One-time move of an older single-document save into chunks. */
async function migrateLegacy(version: number) {
  const { data } = await supabaseAdmin.from("hospital_state").select("data").eq("id", 1).maybeSingle();
  const legacy = (data?.data ?? {}) as Record<string, unknown>;
  if (!legacy || !Object.keys(legacy).length) return null;
  const db = normalizeDB(legacy as Partial<HospitalDB>);
  const saved = await saveChunks(version, splitDB(db), []);
  if (saved === null) return null;
  await supabaseAdmin.from("hospital_state").update({ data: {} as Json }).eq("id", 1);
  return { version: saved, db };
}

export async function readState(): Promise<{ version: number; db: HospitalDB }> {
  const version = await currentVersion();
  if (cache && cache.version === version) return cache;
  const chunks = await readAllChunks();
  if (!Object.keys(chunks).length) {
    const moved = await migrateLegacy(version);
    if (moved) return (cache = moved);
  }
  cache = { version, db: normalizeDB(joinChunks(chunks) as Partial<HospitalDB>) };
  return cache;
}

async function saveChunks(expected: number, chunks: Record<string, unknown>, audit: AuditEntry[]) {
  const { data, error } = await supabaseAdmin.rpc("save_hospital_chunks", {
    _expected: expected,
    _chunks: chunks as Json,
    _audit: audit as unknown as Json,
  });
  if (error) throw error;
  return data === null || data === undefined ? null : Number(data);
}

/** Saves only what changed between prev and next; null when another device saved first. */
export async function saveState(expected: number, prev: HospitalDB, next: HospitalDB) {
  const changed = diffChunks(prev, next);
  const known = new Set(prev.auditLog.map((e) => e.id));
  const audit = next.auditLog.filter((e) => !known.has(e.id));
  const saved = await saveChunks(expected, changed, audit);
  if (saved !== null) cache = { version: saved, db: next };
  else cache = null;
  return saved;
}

/** Keys of chunks saved after `since` (null when too many to send piece by piece). */
export async function changedKeysSince(since: number, limit = 400) {
  const { data, error } = await supabaseAdmin
    .from("hospital_chunks")
    .select("key")
    .gt("version", since)
    .limit(limit + 1);
  if (error) throw error;
  return data.length > limit ? null : data.map((r) => r.key);
}
