/**
 * Per-device storage (IndexedDB):
 * - "state": the signed-in person's last hospital view. Opening the system shows it at once and
 *   downloads only what changed since, so archived years download once per device. Cleared on
 *   sign-out.
 * - "outbox": changes made on this device that the server has not confirmed yet (e.g. typed while
 *   the internet was down). Written before sending and removed only after the server answers,
 *   so a dropped connection or a closed tab never loses an entry. Survives sign-out.
 */
const DB_NAME = "rahma-hospital";
const STORE = "state";
const OUTBOX = "outbox";
const LS_OUTBOX = "rahma-outbox";

export interface CachedState {
  userId: string;
  version: number;
  db: unknown;
  me: unknown;
  savedAt: number;
}

export interface OutboxEntry {
  /** Unique and ordered: `${now}-${random}`. */
  key: string;
  userId: string;
  op: string;
  args: unknown;
  now: number;
  today: string;
}

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Runs one request and resolves once the transaction is committed (null on failure). */
async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<{ ok: boolean; value: T | null }> {
  const db = await open();
  if (!db) return { ok: false, value: null };
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      let value: T | null = null;
      req.onsuccess = () => {
        value = req.result;
      };
      tx.oncomplete = () => {
        db.close();
        resolve({ ok: true, value });
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve({ ok: false, value: null });
      };
    } catch {
      db.close();
      resolve({ ok: false, value: null });
    }
  });
}

export async function readCache(userId: string): Promise<CachedState | null> {
  const { value } = await run(STORE, "readonly", (s) => s.get(userId) as IDBRequest<CachedState | undefined>);
  return value && value.userId === userId && typeof value.version === "number" ? value : null;
}

export async function writeCache(v: CachedState) {
  await run(STORE, "readwrite", (s) => s.put(v, v.userId));
}

/** Forgets the saved view (sign-out). Unsent changes in the outbox are kept. */
export async function clearCache() {
  await run(STORE, "readwrite", (s) => s.clear());
}

/* ---------------- Outbox ---------------- */

function lsRead(): OutboxEntry[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_OUTBOX) : null;
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}
function lsWrite(list: OutboxEntry[]) {
  try {
    if (typeof localStorage === "undefined") return;
    if (list.length) localStorage.setItem(LS_OUTBOX, JSON.stringify(list));
    else localStorage.removeItem(LS_OUTBOX);
  } catch {
    /* storage full or blocked: IndexedDB copy still holds it */
  }
}

/** Saves an unsent change durably (IndexedDB, with a localStorage fallback). */
export async function putOutbox(e: OutboxEntry): Promise<void> {
  const { ok } = await run(OUTBOX, "readwrite", (s) => s.put(e, e.key));
  if (!ok) lsWrite(sortOutbox([...lsRead().filter((x) => x.key !== e.key), e]));
}

export async function deleteOutbox(key: string): Promise<void> {
  await run(OUTBOX, "readwrite", (s) => s.delete(key));
  const ls = lsRead();
  if (ls.some((x) => x.key === key)) lsWrite(ls.filter((x) => x.key !== key));
}

/** Unsent changes made by this person on this device, oldest first. */
export async function readOutbox(userId: string): Promise<OutboxEntry[]> {
  const { value } = await run(OUTBOX, "readonly", (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
  return outboxFor(userId, [...(value ?? []), ...lsRead()]);
}

export function sortOutbox(list: OutboxEntry[]): OutboxEntry[] {
  return [...list].sort((a, b) => a.now - b.now || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** One person's entries, de-duplicated by key and in the order they were made. */
export function outboxFor(userId: string, list: OutboxEntry[]): OutboxEntry[] {
  const seen = new Set<string>();
  const mine = list.filter((e) => {
    if (!e || e.userId !== userId || seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });
  return sortOutbox(mine);
}

/** The audit-log id the server records for an op (ops.ts runOp) — used to skip a resent op. */
export const opAuditId = (e: Pick<OutboxEntry, "now" | "userId" | "op">) => `log-${e.now}-${e.userId}-${e.op}`;
