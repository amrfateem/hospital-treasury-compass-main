/**
 * Fiscal years (pure, shared by browser and server). A fiscal year is a calendar year,
 * 1 January – 31 December. Once it has ended it can be closed: its results are frozen into an
 * archive summary and every money record dated inside it becomes read-only, so last year's
 * statements can never change. Balances simply carry on into the next year because every
 * statement is derived from all records.
 */
import { monthOf } from "./chunks";
import { annualClosing, boxBalance } from "./finance";
import type { FiscalYear, FiscalYearSummary, HospitalDB } from "./model";

/** Money collections that are frozen once their year is closed. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export const LOCKED_COLLECTIONS = [
  "transactions",
  "patientInvoices",
  "supplierInvoices",
  "supplierPayments",
  "stockMoves",
  "doctorPayouts",
  "transfers",
  "journalEntries",
  "creditCharges",
] as const satisfies readonly (keyof HospitalDB)[];

/** Fields that may still change on an archived record (they do not touch the accounts). */
const IGNORED = new Set(["printedAt", "unlocked", "insurerPaid"]);

export const yearStart = (y: number) => `${y}-01-01`;
export const yearEnd = (y: number) => `${y}-12-31`;

/** Year a record belongs to (from its date), or null when it has none. */
export function yearOf(item: unknown): number | null {
  const m = monthOf(item);
  const y = Number(m.slice(0, 4));
  return m === "_" || !Number.isFinite(y) ? null : y;
}

export function closedYears(db: Pick<HospitalDB, "fiscalYears">): Set<number> {
  return new Set((db.fiscalYears ?? []).filter((f) => f.status === "closed").map((f) => f.year));
}

export const isYearClosed = (db: Pick<HospitalDB, "fiscalYears">, year: number) => closedYears(db).has(year);

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => !IGNORED.has(k) && o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * The first closed year that `next` changes compared with `prev` (a money record dated in it
 * added, removed or edited), or null when closed years are untouched. Uses object identity to
 * look only at records the operation actually replaced.
 */
export function lockedChange(prev: HospitalDB, next: HospitalDB): number | null {
  const closed = closedYears(prev);
  if (!closed.size) return null;
  for (const name of LOCKED_COLLECTIONS) {
    const a = (prev[name] ?? []) as unknown as { id: string }[];
    const b = (next[name] ?? []) as unknown as { id: string }[];
    if (a === b) continue;
    const inA = new Set(a);
    const inB = new Set(b);
    const before = new Map<string, string>();
    const after = new Map<string, string>();
    const years = new Map<string, number>();
    for (const x of a)
      if (!inB.has(x)) {
        const y = yearOf(x);
        if (y !== null && closed.has(y)) {
          before.set(x.id, stable(x));
          years.set(x.id, y);
        }
      }
    for (const x of b)
      if (!inA.has(x)) {
        const y = yearOf(x);
        if (y !== null && closed.has(y)) {
          after.set(x.id, stable(x));
          years.set(x.id, y);
        }
      }
    for (const [id, y] of years) if (before.get(id) !== after.get(id)) return y;
    // A record moved out of a closed year (its date changed) also changes that year.
    for (const x of b)
      if (!inA.has(x)) {
        const old = a.find((o) => o.id === x.id);
        const y = old ? yearOf(old) : null;
        if (old && y !== null && closed.has(y) && yearOf(x) !== y) return y;
      }
  }
  return null;
}

export const lockedMessage = (y: number) =>
  `السنة المالية ${y} مقفولة ومؤرشفة — لا يمكن إضافة أو تعديل أو حذف حركات بتاريخ فيها. سجّل العملية بتاريخ في السنة المفتوحة، أو اطلب من المدير إعادة فتح السنة.`;

/** Earliest year that has any money record (or the given fallback). */
export function firstDataYear(db: HospitalDB, fallback: number): number {
  let min = fallback;
  for (const name of LOCKED_COLLECTIONS)
    for (const x of db[name] as unknown[]) {
      const y = yearOf(x);
      if (y !== null && y < min) min = y;
    }
  for (const f of db.fiscalYears) if (f.year < min) min = f.year;
  return min;
}

/** Frozen results of a year: totals per department and the cash in each box on 31 December. */
export function yearSummary(db: HospitalDB, year: number): FiscalYearSummary {
  const end = yearEnd(year);
  const a = annualClosing(db.transactions, year);
  const txs = db.transactions.filter((t) => t.date <= end);
  const transfers = db.transfers.filter((t) => t.date <= end);
  const inYear = (x: unknown) => yearOf(x) === year;
  return {
    totalIn: round2(a.totalIn),
    totalOut: round2(a.totalOut),
    net: round2(a.net),
    byDept: a.byDept.map((d) => ({ dept: d.dept, totalIn: d.totalIn, totalOut: d.totalOut, net: d.net })),
    boxes: db.cashboxes.map((b) => ({ boxId: b.id, name: b.name, balance: boxBalance(b.id, txs, transfers) })),
    receipts: db.patientInvoices.filter(inYear).length,
    entries: db.transactions.filter(inYear).length,
  };
}

export type YearState = "open" | "ended" | "closed";

/** open = still running, ended = past 31 December but not closed yet, closed = archived. */
export function yearState(db: HospitalDB, year: number, today: string): YearState {
  if (isYearClosed(db, year)) return "closed";
  return today > yearEnd(year) ? "ended" : "open";
}

/** Every year from the first record until this year, newest first, with its state. */
export function yearsList(db: HospitalDB, today: string): { year: number; state: YearState; record?: FiscalYear }[] {
  const current = Number(today.slice(0, 4));
  const first = firstDataYear(db, current);
  const out: { year: number; state: YearState; record?: FiscalYear }[] = [];
  for (let y = current; y >= first; y--) {
    const record = db.fiscalYears.find((f) => f.year === y);
    out.push({ year: y, state: yearState(db, y, today), ...(record ? { record } : {}) });
  }
  return out;
}

/** Why a year cannot be closed yet, or null when it can. */
export function closeBlocker(db: HospitalDB, year: number, today: string): string | null {
  if (isYearClosed(db, year)) return `السنة ${year} مقفولة بالفعل.`;
  if (today <= yearEnd(year)) return `لا يمكن إقفال سنة ${year} قبل انتهائها يوم ٣١/١٢/${year}.`;
  const first = firstDataYear(db, year);
  for (let y = first; y < year; y++)
    if (!isYearClosed(db, y)) return `اقفل سنة ${y} أولًا — السنوات تُقفل بالترتيب.`;
  const open = db.shifts.find((s) => !s.closedAt && yearOf({ openedAt: s.openedAt }) === year);
  if (open) return `توجد وردية مفتوحة من سنة ${year} — اقفلها من صفحة الورديات أولًا.`;
  return null;
}

/** Waiting requests dated inside the year (a warning only: deciding them later posts in the new year). */
export function pendingInYear(db: HospitalDB, year: number) {
  const lists = [db.paymentOrders, db.pettyRequests, db.purchaseOrders, db.issueOrders, db.editRequests] as {
    status: string;
  }[][];
  return lists.flat().filter((r) => r.status === "pending" && yearOf(r) === year).length;
}
