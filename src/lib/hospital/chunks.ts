/**
 * Storage layout of the hospital document (pure, shared by server and browser).
 * The document is saved as small pieces ("chunks"): one per small collection, and one per
 * month for dated, ever-growing collections (receipts, treasury entries, stock moves, ...).
 * A change rewrites only the pieces it touched, and devices download only changed pieces,
 * so saving and syncing stay fast no matter how many years of history exist.
 */
import type { HospitalDB } from "./model";

/** Collections split by the month of their date (or timestamp). */
export const DATED = [
  "transactions",
  "patientInvoices",
  "supplierInvoices",
  "supplierPayments",
  "stockMoves",
  "doctorPayouts",
  "transfers",
  "shifts",
  "editRequests",
  "patientDeleteRequests",
  "paymentOrders",
  "pettyRequests",
  "purchaseOrders",
  "issueOrders",
  "invoiceExports",
  "invoiceDrafts",
  "eInvoices",
  "bankStatements",
  "journalEntries",
  "creditCharges",
  "admissions",
  "refunds",
  "advances",
  "dailyClosings",
  "auditLog",
] as const satisfies readonly (keyof HospitalDB)[];
type Dated = (typeof DATED)[number];
const DATED_SET = new Set<string>(DATED);

/** Object maps split into hash buckets (they grow with the records they describe). */
export const HASHED = ["reviews"] as const satisfies readonly (keyof HospitalDB)[];
const HASHED_SET = new Set<string>(HASHED);
export const BUCKETS = 32;

const MONTH = /^\d{4}-\d{2}$/;
const fromMs = (ms: unknown) =>
  typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 7) : null;

/** "YYYY-MM" of a record, or "_" when it has no usable date. */
export function monthOf(item: unknown): string {
  const r = (item ?? {}) as { date?: unknown; openedAt?: unknown; from?: unknown; [k: string]: unknown };
  const fromDate = typeof r.date === "string" ? r.date.slice(0, 7) : null;
  if (fromDate && MONTH.test(fromDate)) return fromDate;
  const opened = typeof r.openedAt === "number" ? fromMs(r.openedAt) : typeof r.openedAt === "string" ? r.openedAt.slice(0, 7) : null;
  if (opened && MONTH.test(opened)) return opened;
  for (const k of ["at", "requestedAt", "createdAt"]) {
    const m = fromMs(r[k]);
    if (m) return m;
  }
  if (typeof r.from === "string" && MONTH.test(r.from.slice(0, 7))) return r.from.slice(0, 7);
  return "_";
}

export function bucketOf(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return String(Math.abs(h) % BUCKETS).padStart(2, "0");
}

export const chunkKey = (name: string, part?: string) => (part === undefined ? name : `${name}@${part}`);
export function parseKey(key: string): { name: string; part?: string } {
  const at = key.indexOf("@");
  return at < 0 ? { name: key } : { name: key.slice(0, at), part: key.slice(at + 1) };
}

function groupByMonth(list: unknown[]) {
  const out = new Map<string, unknown[]>();
  for (const item of list) {
    const m = monthOf(item);
    const g = out.get(m);
    if (g) g.push(item);
    else out.set(m, [item]);
  }
  return out;
}
function groupByBucket(map: Record<string, unknown>) {
  const out = new Map<string, Record<string, unknown>>();
  for (const [k, v] of Object.entries(map)) {
    const b = bucketOf(k);
    const g = out.get(b);
    if (g) g[k] = v;
    else out.set(b, { [k]: v });
  }
  return out;
}

/** Splits a whole document (or part of one) into chunks. */
export function splitDB(db: Partial<HospitalDB>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(db)) {
    if (value === undefined) continue;
    if (DATED_SET.has(name) && Array.isArray(value)) {
      for (const [m, items] of groupByMonth(value)) out[chunkKey(name, m)] = items;
    } else if (HASHED_SET.has(name) && value && typeof value === "object") {
      for (const [b, part] of groupByBucket(value as Record<string, unknown>)) out[chunkKey(name, b)] = part;
    } else out[name] = value;
  }
  return out;
}

/** Puts chunks back together (months in order). Feed the result through normalizeDB. */
export function joinChunks(chunks: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const parts = new Map<string, { part: string; data: unknown }[]>();
  for (const [key, data] of Object.entries(chunks)) {
    if (data === null || data === undefined) continue;
    const { name, part } = parseKey(key);
    if (part === undefined) out[name] = data;
    else parts.set(name, [...(parts.get(name) ?? []), { part, data }]);
  }
  for (const [name, list] of parts) {
    list.sort((a, b) => (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
    if (HASHED_SET.has(name)) out[name] = Object.assign({}, ...list.map((l) => l.data as object));
    else out[name] = list.flatMap((l) => (Array.isArray(l.data) ? l.data : []));
  }
  return out;
}

const sameList = (a: unknown[] | undefined, b: unknown[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Chunks that differ between two documents (null = the chunk is now empty and is removed).
 * Uses object identity: operations copy only what they change, so untouched records keep
 * their identity and are skipped without serialising anything.
 */
export function diffChunks(prev: HospitalDB, next: HospitalDB): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const names = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof HospitalDB>;
  for (const name of names) {
    const a = prev[name] as unknown;
    const b = next[name] as unknown;
    if (a === b) continue;
    if (DATED_SET.has(name) && Array.isArray(b)) {
      const ga = groupByMonth(Array.isArray(a) ? a : []);
      const gb = groupByMonth(b);
      for (const [m, items] of gb) if (!sameList(ga.get(m), items)) out[chunkKey(name, m)] = items;
      for (const m of ga.keys()) if (!gb.has(m)) out[chunkKey(name, m)] = null;
    } else if (HASHED_SET.has(name) && b && typeof b === "object") {
      const ga = groupByBucket((a ?? {}) as Record<string, unknown>);
      const gb = groupByBucket(b as Record<string, unknown>);
      for (const [k, part] of gb) {
        const old = ga.get(k);
        const same = !!old && Object.keys(old).length === Object.keys(part).length && Object.entries(part).every(([id, v]) => old[id] === v);
        if (!same) out[chunkKey(name, k)] = part;
      }
      for (const k of ga.keys()) if (!gb.has(k)) out[chunkKey(name, k)] = null;
    } else out[name] = b === undefined ? null : b;
  }
  return out;
}

/** Replaces the given chunks inside a document (browser side, after downloading changes). */
export function applyChunks(db: HospitalDB, chunks: Record<string, unknown>): Record<string, unknown> {
  const touched = new Set(Object.keys(chunks).map((k) => parseKey(k).name));
  const current: Record<string, unknown> = {};
  for (const name of touched) {
    const value = (db as unknown as Record<string, unknown>)[name];
    if (value !== undefined) Object.assign(current, splitDB({ [name]: value } as Partial<HospitalDB>));
  }
  for (const [k, v] of Object.entries(chunks)) {
    const { name, part } = parseKey(k);
    if (part === undefined) {
      // A whole collection replaced: drop any monthly pieces of it too.
      for (const ck of Object.keys(current)) if (parseKey(ck).name === name) delete current[ck];
    }
    current[k] = v;
  }
  const joined = joinChunks(current);
  for (const name of touched) if (!(name in joined)) joined[name] = DATED_SET.has(name) ? [] : HASHED_SET.has(name) ? {} : undefined;
  return { ...db, ...joined };
}

export type { Dated };
