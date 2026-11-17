/**
 * Browser-side store. The authoritative copy lives in Lovable Cloud; this module keeps a
 * local copy for instant screens, runs each change locally first (optimistic), sends it to
 * the server which re-runs it with permission checks, and refreshes whenever another device
 * saves (live version ping).
 */
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { getCurrentUserId, setCurrentUserId } from "./current-user";
import type { Department, DepartmentId } from "./constants";
import { isoDate } from "./format";
import {
  emptyDB,
  normalizeDB,
  type Asset,
  type Cashbox,
  type Doctor,
  type Employee,
  type ExportFormat,
  type HospitalDB,
  type HospitalLists,
  type HospitalSettings,
  type ListItem,
  type PatientInvoice,
  type StockItem,
  type StockMove,
  type SupplierPayment,
} from "./model";
import { can, canApprove, type PermLevel, type Role, type Section } from "./permissions";
import {
  OpError,
  runOp,
  type ExpenseInput,
  type IssueOrderInput,
  type OpArgs,
  type OpName,
  type PatientInvoiceInput,
  type PaymentOrderInput,
  type PettyInput,
  type PurchaseOrderInput,
  type ReceiveInput,
  type ResetMode,
  type SupplierInvoiceInput,
  type TransactionInput,
  type EInvoiceInput,
  type BankStatementInput,
} from "./ops";
import { applyHospitalOp, getHospitalChanges, getHospitalState, type Me } from "./sync.functions";
import { applyChunks } from "./chunks";
import {
  clearCache,
  deleteOutbox,
  opAuditId,
  putOutbox,
  readCache,
  readOutbox,
  writeCache,
  type OutboxEntry,
} from "./device-cache";

export * from "./model";
export {
  canDeleteDepartment,
  canReceptionEdit,
  departmentUsage,
  resetDB,
  viewFor,
  withPatientInvoice,
  withSupplierInvoice,
  type PatientInvoiceInput,
  type ResetMode,
  type SupplierInvoiceInput,
  type TransactionInput,
  type EInvoiceInput,
  type BankStatementInput,
  bookFor,
  usedOnOtherStatements,
} from "./ops";
export type { Me } from "./sync.functions";
export {
  can,
  canApprove,
  canSpendDirectly,
  levelOf,
  PERM_HINTS,
  PERM_LABELS,
  PERM_LEVELS,
  ROLE_DEFAULTS,
  SECTIONS,
  type Permissions,
} from "./permissions";
export {
  OP_LABELS,
  type ExpenseInput,
  type IssueOrderInput,
  type PaymentOrderInput,
  type PettyInput,
  type PurchaseOrderInput,
  type ReceiveInput,
} from "./ops";

type Status = "idle" | "loading" | "ready" | "no-access" | "error";
interface State {
  db: HospitalDB;
  version: number;
  me: Me | null;
  status: Status;
}

const SERVER_SNAPSHOT: State = { db: emptyDB(), version: -1, me: null, status: "idle" };
let state: State = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useHospitalDB(): HospitalDB {
  return useSyncExternalStore(
    subscribe,
    () => state.db,
    () => SERVER_SNAPSHOT.db,
  );
}
export function useHospitalSession() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_SNAPSHOT,
  );
}
export const currentMe = () => state.me;

/** Whether the signed-in person has at least `level` on a section. */
export function useCan(section: Section, level: PermLevel = "edit") {
  const { me } = useHospitalSession();
  return !!me && can(me, section, level);
}

/** Whether the signed-in person may approve this request (finance manager only). */
export function useCanApprove() {
  const { me } = useHospitalSession();
  return (req: { requestedById?: string | undefined; requestedRole?: Role | undefined }) =>
    !!me && can(me, "approvals", "edit") && canApprove(me, req);
}

export function newId() {
  return crypto.randomUUID();
}

/* ---------------- Loading & live sync ---------------- */

let pending = 0;
let reloadWanted = false;
let failedOp = false;
let loading: Promise<void> | null = null;

let triedCache = false;

/** Shows this device's saved copy at once (if any) and returns true when it was used. */
async function startFromDeviceCache(): Promise<boolean> {
  if (triedCache || state.status === "ready") return false;
  triedCache = true;
  try {
    const userId = getCurrentUserId();
    if (!userId) return false;
    const cached = await readCache(userId);
    if (!cached || (state.status as Status) === "ready") return false;
    set({
      db: normalizeDB(cached.db as Partial<HospitalDB>),
      version: cached.version,
      me: cached.me as Me,
      status: "ready",
    });
    return true;
  } catch {
    return false;
  }
}

export function loadHospital(): Promise<void> {
  if (loading) return loading;
  if (state.status !== "ready") set({ status: "loading" });
  loading = (async () => {
    try {
      if (await startFromDeviceCache()) {
        loading = null;
        await resumeOutbox();
        if (!pending) await syncChanges();
        return;
      }
      const res = await getHospitalState();
      if (!res.ok) {
        set({ status: "no-access", me: null, db: emptyDB() });
        return;
      }
      if (pending) {
        reloadWanted = true;
        return;
      }
      setCurrentUserId(res.me.id);
      set({
        db: normalizeDB(res.db as unknown as Partial<HospitalDB>),
        version: res.version,
        me: res.me,
        status: "ready",
      });
      loading = null;
      await resumeOutbox();
    } catch (e) {
      console.error(e);
      if (state.status !== "ready") set({ status: "error" });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

let catchingUp: Promise<void> | null = null;
/**
 * Downloads only what changed since this device's version and merges it in place. Falls back
 * to a full load when the server asks for it or when the signed-in person's access changed.
 */
export function syncChanges(): Promise<void> {
  if (state.status !== "ready" || state.version < 0) return loadHospital();
  if (loading) return loading;
  if (catchingUp) return catchingUp;
  catchingUp = (async () => {
    try {
      const since = state.version;
      const res = await getHospitalChanges({ data: { since } });
      if (!res.ok) {
        set({ status: "no-access", me: null, db: emptyDB() });
        return;
      }
      if (pending) {
        reloadWanted = true;
        return;
      }
      if (res.full || JSON.stringify(res.me) !== JSON.stringify(state.me)) {
        await loadHospital();
        return;
      }
      if (state.version !== since) return;
      const chunks = (res.chunks ?? {}) as Record<string, unknown>;
      const db = Object.keys(chunks).length
        ? normalizeDB(applyChunks(state.db, chunks) as Partial<HospitalDB>)
        : state.db;
      set({ db, version: res.version });
    } catch (e) {
      console.error(e);
      await loadHospital();
    } finally {
      catchingUp = null;
    }
  })();
  return catchingUp;
}

/** Clears everything on sign-out so the next person never sees the previous data. */
export function clearHospital() {
  // Unsent changes stay in the device outbox and are sent when the same person signs in again.
  outbox = [];
  persisted.clear();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  setSync("saved");
  pending = 0;
  reloadWanted = false;
  triedCache = false;
  cachedVersion = -1;
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = null;
  setCurrentUserId(null);
  set({ ...SERVER_SNAPSHOT });
  void clearCache();
}

/* Keeps this device's copy up to date a moment after each confirmed change. */
let cacheTimer: ReturnType<typeof setTimeout> | null = null;
let cachedVersion = -1;
subscribe(() => {
  if (typeof window === "undefined") return;
  if (state.status !== "ready" || !state.me || state.version === cachedVersion || pending) return;
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    const { db, version, me, status } = state;
    if (status !== "ready" || !me || pending || version === cachedVersion) return;
    cachedVersion = version;
    void writeCache({ userId: me.id, version, db, me, savedAt: Date.now() });
  }, 2500);
});

/** Polls the local server for a new version; returns an unsubscribe function. */
export function startLiveSync() {
  let stopped = false;
  const tick = () => {
    if (stopped || pending || state.status !== "ready") return;
    void syncChanges();
  };
  const timer = setInterval(tick, 4000);
  const onFocus = () => {
    if (!pending && state.status === "ready") void syncChanges();
  };
  window.addEventListener("focus", onFocus);
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("focus", onFocus);
  };
}

/* ---------------- Saving: durable outbox ---------------- */

/**
 * Every change goes to a per-device outbox (IndexedDB) before it is sent, and leaves it only
 * when the server answers. A dropped connection keeps the change on screen and in the outbox
 * and retries in order (backoff, on reconnect, on focus, on next start). The server skips an
 * op it already applied (same audit id), so resending is safe.
 */
let outbox: OutboxEntry[] = [];
const persisted = new Map<string, Promise<void>>();
let flushing: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
let lastNow = 0;
let serverErrors = 0;

export type SyncState = "saved" | "saving" | "offline";
interface SyncStatus {
  state: SyncState;
  queued: number;
}
let sync: SyncStatus = { state: "saved", queued: 0 };
const syncListeners = new Set<() => void>();
function setSync(next: SyncState) {
  const queued = outbox.length;
  const state2: SyncState = next === "offline" ? "offline" : queued ? "saving" : "saved";
  if (sync.state === state2 && sync.queued === queued) return;
  sync = { state: state2, queued };
  syncListeners.forEach((l) => l());
}
const SAVED: SyncStatus = { state: "saved", queued: 0 };
/** Cloud save status for the top bar: saved / saving N / waiting for the internet. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => sync,
    () => SAVED,
  );
}
/** Changes on this device not yet confirmed by the server. */
export const unsentCount = () => outbox.length;

function isNetworkError(e: unknown) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (e instanceof TypeError) return true; // fetch failed / connection reset
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch|network|timeout|Failed to|Load failed|ECONN|abort/i.test(msg);
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60_000);
}

function afterQueueDrained() {
  pending = outbox.length;
  if (pending || !reloadWanted) return;
  reloadWanted = false;
  if (failedOp) {
    failedOp = false;
    void loadHospital();
  } else void syncChanges();
}

function flush(): Promise<void> {
  if (flushing) return flushing;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  flushing = (async () => {
    while (outbox.length) {
      const e = outbox[0]!;
      await persisted.get(e.key);
      let res: Awaited<ReturnType<typeof applyHospitalOp>>;
      try {
        res = await applyHospitalOp({ data: { op: e.op, args: e.args, now: e.now, today: e.today } });
      } catch (err) {
        console.error(err);
        if (!isNetworkError(err) && ++serverErrors >= 5) {
          // The server keeps failing on this one change: drop it so the rest can be saved.
          serverErrors = 0;
          toast.error("تعذّر حفظ إحدى العمليات على السيرفر بعد عدة محاولات وتم إلغاؤها.");
          outbox.shift();
          persisted.delete(e.key);
          await deleteOutbox(e.key);
          failedOp = true;
          reloadWanted = true;
          continue;
        }
        setSync("offline");
        scheduleRetry();
        return;
      }
      serverErrors = 0;
      retryDelay = 2000;
      outbox.shift();
      persisted.delete(e.key);
      await deleteOutbox(e.key);
      pending = outbox.length;
      setSync("saving");
      if (!res.ok) {
        toast.error(res.error);
        // The local copy has a change the server refused: take the server's copy again.
        failedOp = true;
        reloadWanted = true;
      } else if ("duplicate" in res && res.duplicate) {
        // It was saved earlier; this device may show it twice — take the server's copy.
        failedOp = true;
        reloadWanted = true;
      } else if (res.version === state.version + 1) {
        state = { ...state, version: res.version };
      } else {
        reloadWanted = true;
      }
    }
    setSync("saving");
    afterQueueDrained();
  })().finally(() => {
    flushing = null;
    if (outbox.length && !retryTimer) void flush();
  });
  return flushing;
}

function enqueue(e: OutboxEntry) {
  outbox.push(e);
  pending = outbox.length;
  persisted.set(e.key, putOutbox(e).catch(() => undefined));
  setSync("saving");
  void flush();
}

/**
 * After this device loads (from its copy or the server), puts back on screen any change that
 * was not confirmed before the page closed, and sends it again.
 */
async function resumeOutbox() {
  const me = state.me;
  if (!me || typeof window === "undefined") return;
  const saved = await readOutbox(me.id);
  const fresh = saved.filter((e) => !outbox.some((x) => x.key === e.key));
  if (!fresh.length) return;
  let db = state.db;
  const known = new Set(db.auditLog.map((x) => x.id));
  for (const e of fresh) {
    lastNow = Math.max(lastNow, e.now);
    if (known.has(opAuditId(e))) continue; // already in the server copy
    try {
      db = runOp(db, e.op as OpName, e.args as never, { now: e.now, today: e.today, actor: me });
    } catch {
      /* the server will report the reason when it is resent */
    }
  }
  set({ db });
  outbox.push(...fresh);
  pending = outbox.length;
  toast.info(`جارٍ إرسال ${fresh.length} عملية محفوظة على هذا الجهاز ولم تصل للسحابة بعد.`);
  setSync("saving");
  void flush();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    retryDelay = 2000;
    if (outbox.length) void flush();
  });
  window.addEventListener("focus", () => {
    if (outbox.length && !flushing) void flush();
  });
  window.addEventListener("beforeunload", (ev) => {
    // Entries are already kept on the device; this only warns when some never left it.
    if (outbox.length && sync.state === "offline") {
      ev.preventDefault();
    }
  });
}

/**
 * Runs an operation locally right away and queues it for the server. Returns false (and shows
 * the reason) when a rule refuses it.
 */
export function dispatch<K extends OpName>(name: K, args: OpArgs<K>): boolean {
  const me = state.me;
  if (!me) {
    toast.error("انتهت الجلسة، سجّل الدخول مرة أخرى.");
    return false;
  }
  // Unique per person and op, so the server can recognise a resent change.
  let now = Date.now();
  if (now <= lastNow) now = lastNow + 1;
  lastNow = now;
  const today = isoDate(new Date(now));
  try {
    const next = runOp(state.db, name, args, { now, today, actor: me });
    set({ db: next });
  } catch (e) {
    toast.error(e instanceof OpError ? e.message : "تعذّر تنفيذ العملية.");
    if (!(e instanceof OpError)) console.error(e);
    return false;
  }
  enqueue({ key: `${now}-${newId()}`, userId: me.id, op: name, args, now, today });
  return true;
}

/** Resolves once every queued change reached the server (or is waiting for the internet). */
export const flushPending = () => flush();

/* ---------------- Actions (same names the pages already use) ---------------- */

export const saveEmployee = (e: Employee) => dispatch("saveEmployee", e);
export const deleteEmployee = (id: string) => dispatch("deleteEmployee", { id });

export function addTransaction(t: TransactionInput) {
  return dispatch("addTransaction", { id: newId(), input: t });
}
export const updateTransaction = (id: string, patch: Omit<TransactionInput, "source">) =>
  dispatch("updateTransaction", { id, patch });
export const deleteTransaction = (id: string) => dispatch("deleteTransaction", { id });

export const postPayrollToTreasury = (
  period: string,
  date: string,
  byDept: { department: DepartmentId; code: string; net: number; label: string }[],
) => dispatch("postPayroll", { period, date, byDept });
export const unpostPayroll = (period: string) => dispatch("unpostPayroll", { period });

/** Creates or updates an invoice (and its treasury entries). Returns the saved invoice. */
export function savePatientInvoice(
  input: PatientInvoiceInput,
  existing?: PatientInvoice | null,
): PatientInvoice | null {
  const id = existing?.id ?? newId();
  if (!dispatch("savePatientInvoice", { id, input })) return null;
  return state.db.patientInvoices.find((i) => i.id === id) ?? null;
}
export const deletePatientInvoice = (id: string) => dispatch("deletePatientInvoice", { id });
export const markInvoicePrinted = (id: string) => dispatch("markInvoicePrinted", { id });
export const logInvoiceExport = (a: {
  format: ExportFormat;
  from: string;
  to: string;
  filters: string;
  invoiceIds: string[];
}) => dispatch("logInvoiceExport", { id: newId(), ...a });
export const requestInvoiceChange = (
  invoiceId: string,
  action: "edit" | "delete",
  reason: string,
) => dispatch("requestInvoiceChange", { id: newId(), invoiceId, action, reason });
export const decideInvoiceChange = (id: string, approve: boolean) =>
  dispatch("decideInvoiceChange", { id, approve });
export const collectInsurer = (invoiceId: string, date: string, boxId: string, method: string) =>
  dispatch("collectInsurer", { invoiceId, date, boxId, method });
export const uncollectInsurer = (invoiceId: string) => dispatch("uncollectInsurer", { invoiceId });

export function saveSupplierInvoice(input: SupplierInvoiceInput, existing?: { id: string } | null) {
  return dispatch("saveSupplierInvoice", { id: existing?.id ?? newId(), input });
}
export const deleteSupplierInvoice = (id: string) => dispatch("deleteSupplierInvoice", { id });
export const saveSupplierPayment = (
  input: Omit<SupplierPayment, "id" | "number" | "createdAt">,
  existing?: { id: string } | null,
) => dispatch("saveSupplierPayment", { id: existing?.id ?? newId(), input });
export const deleteSupplierPayment = (id: string) => dispatch("deleteSupplierPayment", { id });

export const saveAsset = (a: Asset) => dispatch("saveAsset", a);
export const deleteAsset = (id: string) => dispatch("deleteAsset", { id });

export const saveDoctor = (d: Doctor) => dispatch("saveDoctor", d);
export const deleteDoctor = (id: string) => dispatch("deleteDoctor", { id });
export const payDoctor = (a: {
  doctorId: string;
  period: string;
  date: string;
  amount: number;
  boxId: string;
  note?: string | undefined;
}) => dispatch("payDoctor", { id: newId(), ...a });
export const deleteDoctorPayout = (id: string) => dispatch("deleteDoctorPayout", { id });

export const saveStockItem = (i: StockItem) => dispatch("saveStockItem", i);
export const deleteStockItem = (id: string) => dispatch("deleteStockItem", { id });
export const addStockMove = (m: Omit<StockMove, "id" | "createdAt">) =>
  dispatch("addStockMove", { id: newId(), ...m });
export const deleteStockMove = (id: string) => dispatch("deleteStockMove", { id });

export const openShift = (boxId: string, openingFloat: number) =>
  dispatch("openShift", { id: newId(), boxId, openingFloat });
export const closeShift = (
  shiftId: string,
  counted: Record<string, number>,
  handover: "main" | "next",
  note?: string,
) => dispatch("closeShift", { shiftId, counted, handover, note });
export const addTransfer = (t: {
  date: string;
  from: string;
  to: string;
  amount: number;
  method: string;
  note?: string | undefined;
}) => dispatch("addTransfer", { id: newId(), ...t });
export const deleteTransfer = (id: string) => dispatch("deleteTransfer", { id });
export const saveCashbox = (b: Cashbox) => dispatch("saveCashbox", b);
export const deleteCashbox = (id: string) => dispatch("deleteCashbox", { id });

export const saveSettings = (s: HospitalSettings) => dispatch("saveSettings", s);
export const resetSystem = (mode: ResetMode) => dispatch("resetSystem", { mode });

export const saveDepartment = (d: Department) => dispatch("saveDepartment", d);
/** Returns false (and changes nothing) when the department is in use or is a system department. */
export const deleteDepartment = (id: string) => dispatch("deleteDepartment", { id });
export const restoreDefaultDepartments = () => dispatch("restoreDefaultDepartments", {});

export function saveListItem<K extends keyof HospitalLists>(
  key: K,
  item: HospitalLists[K][number],
) {
  return dispatch("saveListItem", { key, item: item as ListItem });
}
export const deleteListItem = (key: keyof HospitalLists, id: string) =>
  dispatch("deleteListItem", { key, id });

/* ---------------- Backup & data from this device ---------------- */

export function exportBackup() {
  return JSON.stringify(state.db, null, 2);
}

/** Replaces all data with a backup file's content (owner only). */
export function restoreBackup(json: string) {
  const parsed = JSON.parse(json) as Partial<HospitalDB>;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.transactions))
    throw new Error("not a backup");
  return dispatch("replaceAll", { db: parsed });
}

/** Data saved by the older device-only version of the system, if any. */
const LEGACY_KEY = "rahma-hospital-db-v1";
export function readLegacyDeviceData(): HospitalDB | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    return raw ? normalizeDB(JSON.parse(raw) as Partial<HospitalDB>) : null;
  } catch {
    return null;
  }
}
export function forgetLegacyDeviceData() {
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

/* ---------------- Expenses, petty cash, review, orders ---------------- */
export const addExpense = (input: ExpenseInput) => dispatch("addExpense", { id: newId(), input });
export const deleteExpense = (id: string) => dispatch("deleteExpense", { id });
export const addPettyExpense = (input: PettyInput) =>
  dispatch("addPettyExpense", { id: newId(), input });
export const deletePettyExpense = (id: string) => dispatch("deletePettyExpense", { id });
export const requestPetty = (input: PettyInput) => dispatch("requestPetty", { id: newId(), input });
export const decidePettyRequest = (id: string, approve: boolean, note?: string) =>
  dispatch("decidePettyRequest", { id, approve, note });
export const payPettyRequest = (id: string, date: string) => dispatch("payPettyRequest", { id, date });
export const deletePettyRequest = (id: string) => dispatch("deletePettyRequest", { id });
export const reviewTransaction = (txId: string, status: "approved" | "flagged", note?: string) =>
  dispatch("reviewTransaction", { txId, status, note });
export const clearReview = (txId: string) => dispatch("clearReview", { txId });
export const savePaymentOrder = (input: PaymentOrderInput, existing?: { id: string } | null) =>
  dispatch("savePaymentOrder", { id: existing?.id ?? newId(), input });
export const decidePaymentOrder = (id: string, approve: boolean, note?: string) =>
  dispatch("decidePaymentOrder", { id, approve, note });
export const payPaymentOrder = (id: string, date: string, boxId: string, method: string) =>
  dispatch("payPaymentOrder", { id, date, boxId, method });
export const unpayPaymentOrder = (id: string) => dispatch("unpayPaymentOrder", { id });
export const deletePaymentOrder = (id: string) => dispatch("deletePaymentOrder", { id });
export const savePurchaseOrder = (input: PurchaseOrderInput, existing?: { id: string } | null) =>
  dispatch("savePurchaseOrder", { id: existing?.id ?? newId(), input });
export const decidePurchaseOrder = (id: string, approve: boolean) =>
  dispatch("decidePurchaseOrder", { id, approve });
export const receivePurchaseOrder = (a: Omit<ReceiveInput, "receiptId">) =>
  dispatch("receivePurchaseOrder", { ...a, receiptId: newId() });
export const cancelPurchaseOrder = (id: string) => dispatch("cancelPurchaseOrder", { id });
export const deletePurchaseOrder = (id: string) => dispatch("deletePurchaseOrder", { id });
export const saveIssueOrder = (input: IssueOrderInput, existing?: { id: string } | null) =>
  dispatch("saveIssueOrder", { id: existing?.id ?? newId(), input });
export const decideIssueOrder = (id: string, approve: boolean, note?: string) =>
  dispatch("decideIssueOrder", { id, approve, note });
export const deliverIssueOrder = (id: string, date: string) => dispatch("deliverIssueOrder", { id, date });
export const deleteIssueOrder = (id: string) => dispatch("deleteIssueOrder", { id });

/* ---------------- AI drafts, e-invoicing, banks ---------------- */
export const saveInvoiceDraft = (draft: OpArgs<"saveInvoiceDraft">["draft"]) =>
  dispatch("saveInvoiceDraft", { draft });
export const deleteInvoiceDraft = (id: string) => dispatch("deleteInvoiceDraft", { id });
export const saveEInvoice = (input: EInvoiceInput, existing?: { id: string } | null) =>
  dispatch("saveEInvoice", { id: existing?.id ?? newId(), input });
export const setEInvoiceStatus = (a: OpArgs<"setEInvoiceStatus">) => dispatch("setEInvoiceStatus", a);
export const deleteEInvoice = (id: string) => dispatch("deleteEInvoice", { id });
export const saveEtaSettings = (a: OpArgs<"saveEtaSettings">) => dispatch("saveEtaSettings", a);
export const saveBankAccount = (b: Cashbox) => dispatch("saveBankAccount", b);
/** Returns the new statement id, or null when it was refused. */
export function importBankStatement(input: BankStatementInput) {
  const id = newId();
  return dispatch("importBankStatement", { id, input }) ? id : null;
}
export const autoMatchBankStatement = (id: string) => dispatch("autoMatchBankStatement", { id });
export const matchBankLine = (statementId: string, lineId: string, bookIds: string[]) =>
  dispatch("matchBankLine", { statementId, lineId, bookIds });
export const unmatchBankLine = (statementId: string, lineId: string) =>
  dispatch("unmatchBankLine", { statementId, lineId });
export const addBankAdjustment = (a: OpArgs<"addBankAdjustment">) => dispatch("addBankAdjustment", a);
export const setBankStatementStatus = (id: string, status: "open" | "reconciled") =>
  dispatch("setBankStatementStatus", { id, status });
export const deleteBankStatement = (id: string) => dispatch("deleteBankStatement", { id });

/* ---------------- Credit accounts, manual entries, budget, branches ---------------- */
export const saveCreditAccount = (a: OpArgs<"saveCreditAccount">) => dispatch("saveCreditAccount", a);
export const deleteCreditAccount = (id: string) => dispatch("deleteCreditAccount", { id });
export const saveCreditCharge = (input: OpArgs<"saveCreditCharge">["input"], existing?: { id: string } | null) =>
  dispatch("saveCreditCharge", { id: existing?.id ?? newId(), input });
export const deleteCreditCharge = (id: string) => dispatch("deleteCreditCharge", { id });
export const collectCredit = (a: Omit<OpArgs<"collectCredit">, "id">) => dispatch("collectCredit", { ...a, id: newId() });
export const deleteCreditCollection = (id: string) => dispatch("deleteCreditCollection", { id });
export const saveJournalEntry = (input: OpArgs<"saveJournalEntry">["input"], existing?: { id: string } | null) =>
  dispatch("saveJournalEntry", { id: existing?.id ?? newId(), input });
export const deleteJournalEntry = (id: string) => dispatch("deleteJournalEntry", { id });
export const saveCustomAccount = (a: OpArgs<"saveCustomAccount">) => dispatch("saveCustomAccount", a);
export const deleteCustomAccount = (code: string) => dispatch("deleteCustomAccount", { code });
export const saveBudget = (b: OpArgs<"saveBudget">) => dispatch("saveBudget", b);
export const saveBranch = (b: OpArgs<"saveBranch">) => dispatch("saveBranch", b);
export const deleteBranch = (id: string) => dispatch("deleteBranch", { id });
export const saveCurrencies = (currencies: OpArgs<"saveCurrencies">["currencies"]) => dispatch("saveCurrencies", { currencies });
export const saveEmployeeFile = (a: OpArgs<"saveEmployeeFile">) => dispatch("saveEmployeeFile", a);
export const saveContract = (input: OpArgs<"saveContract">["input"], existing?: { id: string } | null) => {
  const id = existing?.id ?? newId();
  return dispatch("saveContract", { id, input }) ? id : null;
};
export const signContract = (a: OpArgs<"signContract">) => dispatch("signContract", a);
export const endContract = (a: OpArgs<"endContract">) => dispatch("endContract", a);
export const deleteContract = (id: string) => dispatch("deleteContract", { id });

/* ---------------- Patients: remaining amounts and file deletion ---------------- */
export const collectPatientRemaining = (a: Omit<OpArgs<"collectPatientRemaining">, "id">) =>
  dispatch("collectPatientRemaining", { ...a, id: newId() });
export const requestPatientDelete = (a: Omit<OpArgs<"requestPatientDelete">, "id">) =>
  dispatch("requestPatientDelete", { ...a, id: newId() });
/** Waits for the server: approving also removes the medical file, so callers refresh after it. */
export async function decidePatientDelete(id: string, approve: boolean) {
  if (!dispatch("decidePatientDelete", { id, approve })) return false;
  await flushPending();
  return true;
}
export const closeFiscalYear = (year: number) => dispatch("closeFiscalYear", { year });
export const reopenFiscalYear = (year: number, reason: string) => dispatch("reopenFiscalYear", { year, reason });
export const closeCashDay = (date: string, counted: number, note?: string) =>
  dispatch("closeCashDay", { id: `dc-${date}-${newId()}`, date, counted, note });
export const requestDayReopen = (date: string, reason: string) => dispatch("requestDayReopen", { date, reason });
export const decideDayReopen = (id: string, approve: boolean, note?: string) =>
  dispatch("decideDayReopen", { id, approve, note });

/* ---------------- Inpatient accounts, refunds, staff advances ---------------- */
type AdmissionInput = OpArgs<"openAdmission">["input"];
export function openAdmission(input: AdmissionInput) {
  const id = newId();
  return dispatch("openAdmission", { id, input }) ? id : null;
}
export const updateAdmission = (id: string, patch: OpArgs<"updateAdmission">["patch"]) =>
  dispatch("updateAdmission", { id, patch });
export const addAdmissionDeposit = (a: Omit<OpArgs<"addAdmissionDeposit">, "id">) =>
  dispatch("addAdmissionDeposit", { id: newId(), ...a });
export const deleteAdmissionDeposit = (id: string) => dispatch("deleteAdmissionDeposit", { id });
export const addAdmissionCharge = (admissionId: string, charge: Omit<OpArgs<"addAdmissionCharge">["charge"], "id">) =>
  dispatch("addAdmissionCharge", { admissionId, charge: { id: newId(), ...charge } });
export const removeAdmissionCharge = (admissionId: string, chargeId: string) =>
  dispatch("removeAdmissionCharge", { admissionId, chargeId });
/** Discharges the patient; returns the final bill's id. */
export function dischargeAdmission(a: Omit<OpArgs<"dischargeAdmission">, "invoiceId">) {
  const invoiceId = newId();
  return dispatch("dischargeAdmission", { ...a, invoiceId }) ? invoiceId : null;
}
export const reopenAdmission = (admissionId: string) => dispatch("reopenAdmission", { admissionId });
export const deleteAdmission = (id: string) => dispatch("deleteAdmission", { id });

export const requestRefund = (input: OpArgs<"requestRefund">["input"]) =>
  dispatch("requestRefund", { id: newId(), input });
export const decideRefund = (id: string, approve: boolean, note?: string) =>
  dispatch("decideRefund", { id, approve, note });
export const payRefund = (a: OpArgs<"payRefund">) => dispatch("payRefund", a);
export const deleteRefund = (id: string) => dispatch("deleteRefund", { id });

export const requestAdvance = (input: OpArgs<"requestAdvance">["input"]) =>
  dispatch("requestAdvance", { id: newId(), input });
export const decideAdvance = (id: string, approve: boolean, note?: string) =>
  dispatch("decideAdvance", { id, approve, note });
export const payAdvance = (a: OpArgs<"payAdvance">) => dispatch("payAdvance", a);
export const deleteAdvance = (id: string) => dispatch("deleteAdvance", { id });
