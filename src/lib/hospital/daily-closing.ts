/**
 * Daily closing of the main treasury (الإقفال اليومي). Pure, shared by browser and server.
 *
 * For one day: opening balance + money in − money out = closing balance, broken down by type and
 * by collector, compared with the cash actually counted. Days close in order; once a day is closed
 * every main-treasury entry dated on or before it is frozen (`lockedDayChange`), so the next day's
 * opening always equals the printed closing. Only the latest closed day can be reopened, and only
 * with the finance manager's approval.
 */
import { findDepartment } from "./constants";
import {
  listLabel,
  MAIN_BOX_ID,
  TX_SOURCE_LABELS,
  type DailyClosing,
  type DayClosingCollector,
  type DayClosingLine,
  type HospitalDB,
  type Transaction,
  type Transfer,
} from "./model";
import { mainTreasurySummary } from "./treasury-summary";

const r2 = (n: number) => Math.round(n * 100) / 100;
const inMain = (t: Pick<Transaction, "boxId">) => (t.boxId ?? MAIN_BOX_ID) === MAIN_BOX_ID;
const touchesMain = (t: Pick<Transfer, "from" | "to">) => t.from === MAIN_BOX_ID || t.to === MAIN_BOX_ID;
const methodOf = (m: string | undefined) => m || "cash";

export interface DayEntry {
  id: string;
  ref: string;
  description: string;
  type: string;
  by: string;
  method: string;
  in: number;
  out: number;
  createdAt: number;
}

export interface DayReport {
  date: string;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  expectedCash: number;
  nonCash: number;
  byMethod: Record<string, number>;
  inLines: DayClosingLine[];
  outLines: DayClosingLine[];
  collectors: DayClosingCollector[];
  entries: DayEntry[];
}

type Db = Pick<HospitalDB, "transactions" | "transfers" | "shifts" | "cashboxes" | "departments" | "lists">;

function addLine(map: Map<string, DayClosingLine>, key: string, label: string, amount: number) {
  const l = map.get(key) ?? { key, label, count: 0, amount: 0 };
  l.count++;
  l.amount = r2(l.amount + amount);
  map.set(key, l);
}

/** Everything about the main treasury on one day, derived from the entries. */
export function dayReport(db: Db, date: string): DayReport {
  const s = mainTreasurySummary(db, { from: date, to: date });
  const boxName = (id: string) => db.cashboxes.find((b) => b.id === id)?.name ?? id;
  const txs = db.transactions.filter((t) => inMain(t) && t.date === date);
  const trfs = db.transfers.filter((t) => touchesMain(t) && t.date === date);

  const ins = new Map<string, DayClosingLine>();
  const outs = new Map<string, DayClosingLine>();
  for (const t of txs) {
    if (t.kind === "in") {
      if (t.source === "invoice")
        addLine(ins, `invoice:${t.department}`, `إيصالات المرضى — ${findDepartment(db.departments, t.department).name}`, t.amount);
      else addLine(ins, `src:${t.source}`, TX_SOURCE_LABELS[t.source] ?? t.source, t.amount);
    } else addLine(outs, `src:${t.source}`, TX_SOURCE_LABELS[t.source] ?? t.source, t.amount);
  }
  for (const t of trfs) {
    if (t.to === MAIN_BOX_ID) addLine(ins, `trf:${t.from}`, `تحويل وارد من ${boxName(t.from)}`, t.amount);
    else addLine(outs, `trf:${t.to}`, `تحويل إلى ${boxName(t.to)}`, t.amount);
  }

  // Closing per payment method (all dates up to the end of the day).
  const byMethod: Record<string, number> = {};
  const bump = (m: string | undefined, n: number) => {
    const k = methodOf(m);
    byMethod[k] = r2((byMethod[k] ?? 0) + n);
  };
  for (const t of db.transactions) if (inMain(t) && t.date <= date) bump(t.method, t.kind === "in" ? t.amount : -t.amount);
  for (const t of db.transfers)
    if (touchesMain(t) && t.date <= date) bump(t.method, t.to === MAIN_BOX_ID ? t.amount : -t.amount);
  for (const k of Object.keys(byMethod)) if (Math.abs(byMethod[k]!) < 0.005) delete byMethod[k];
  const expectedCash = r2(byMethod["cash"] ?? 0);

  const methodName = (m: string | undefined) => listLabel(db.lists.paymentMethods, methodOf(m));
  const entries: DayEntry[] = [
    ...txs.map((t) => ({
      id: t.id,
      ref: t.receiptId,
      description: t.description,
      type: TX_SOURCE_LABELS[t.source] ?? t.source,
      by: t.by ?? "",
      method: methodName(t.method),
      in: t.kind === "in" ? t.amount : 0,
      out: t.kind === "out" ? t.amount : 0,
      createdAt: t.createdAt,
    })),
    ...trfs.map((t) => ({
      id: t.id,
      ref: t.number,
      description: t.note || (t.to === MAIN_BOX_ID ? `تحويل من ${boxName(t.from)}` : `تحويل إلى ${boxName(t.to)}`),
      type: "تحويل",
      by: t.by ?? "",
      method: methodName(t.method),
      in: t.to === MAIN_BOX_ID ? t.amount : 0,
      out: t.from === MAIN_BOX_ID ? t.amount : 0,
      createdAt: t.createdAt,
    })),
  ].sort((a, b) => a.createdAt - b.createdAt);

  const sortLines = (m: Map<string, DayClosingLine>) => [...m.values()].sort((a, b) => b.amount - a.amount);
  return {
    date,
    opening: s.opening,
    totalIn: s.periodIn,
    totalOut: s.periodOut,
    closing: s.closing,
    expectedCash,
    nonCash: r2(s.closing - expectedCash),
    byMethod,
    inLines: sortLines(ins),
    outLines: sortLines(outs),
    collectors: s.collectors
      .filter((c) => c.count || c.collected || c.paidOut || c.shortage || c.surplus)
      .map((c) => ({
        name: c.name,
        count: c.count,
        collected: c.collected,
        paidOut: c.paidOut,
        shortage: c.shortage,
        surplus: c.surplus,
        net: c.net,
      })),
    entries,
  };
}

/** Closed (not reopened) daily closings, oldest first. */
export const closedDays = (db: Pick<HospitalDB, "dailyClosings">) =>
  (db.dailyClosings ?? []).filter((c) => c.status === "closed").sort((a, b) => a.date.localeCompare(b.date));

/** Last closed day: entries on or before it are frozen. */
export function closedThrough(db: Pick<HospitalDB, "dailyClosings">): string | null {
  const list = closedDays(db);
  return list.length ? list[list.length - 1]!.date : null;
}

export const closingOf = (db: Pick<HospitalDB, "dailyClosings">, date: string) =>
  closedDays(db).find((c) => c.date === date);

/** Days with main-treasury movement after the last closed day, up to `today`, oldest first. */
export function unclosedDays(db: Pick<HospitalDB, "transactions" | "transfers" | "dailyClosings">, today: string): string[] {
  const after = closedThrough(db) ?? "";
  const days = new Set<string>();
  for (const t of db.transactions) if (inMain(t) && t.date > after && t.date <= today) days.add(t.date);
  for (const t of db.transfers) if (touchesMain(t) && t.date > after && t.date <= today) days.add(t.date);
  return [...days].sort();
}

/** Why `date` cannot be closed now, or null when it can. */
export function closeDayBlocker(
  db: Pick<HospitalDB, "transactions" | "transfers" | "dailyClosings" | "shifts">,
  date: string,
  today: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "تاريخ غير صحيح.";
  if (date > today) return "لا يمكن إقفال يوم لم ينتهِ بعد.";
  const through = closedThrough(db);
  if (through && date <= through)
    return closingOf(db, date) ? `يوم ${date} مقفول بالفعل.` : `الأيام حتى ${through} مقفولة بالفعل.`;
  const earlier = unclosedDays(db, today).find((d) => d < date);
  if (earlier) return `اقفل يوم ${earlier} أولًا — الأيام تُقفل بالترتيب.`;
  // An open shift could still record money on this day.
  const open = db.shifts.filter((s) => !s.closedAt);
  if (open.length && date >= today) return `توجد وردية مفتوحة (${open[0]!.openedBy}) — تُقفل كل الورديات قبل إقفال اليوم.`;
  for (const s of open)
    if (db.transactions.some((t) => t.shiftId === s.id && t.date <= date))
      return `وردية ${s.openedBy} اللي فيها حركات يوم ${date} لسه مفتوحة — اقفلها أولًا.`;
  return null;
}

/** Builds the frozen closing record for `date` (the caller checks `closeDayBlocker`). */
export function buildClosing(
  db: Db,
  input: { id: string; date: string; counted: number; note?: string | undefined },
  by: { now: number; name: string; id: string; role?: DailyClosing["closedRole"] },
): DailyClosing {
  const r = dayReport(db, input.date);
  const counted = r2(Number(input.counted) || 0);
  return {
    id: input.id,
    date: input.date,
    status: "closed",
    opening: r.opening,
    totalIn: r.totalIn,
    totalOut: r.totalOut,
    closing: r.closing,
    expectedCash: r.expectedCash,
    counted,
    difference: r2(counted - r.expectedCash),
    note: input.note?.trim() || undefined,
    inLines: r.inLines,
    outLines: r.outLines,
    byMethod: r.byMethod,
    collectors: r.collectors,
    entries: r.entries.length,
    closedAt: by.now,
    closedBy: by.name,
    closedById: by.id,
    closedRole: by.role,
  };
}

/** Fields that never change money (ignored when comparing a frozen entry). */
const IGNORED = new Set(["printedAt", "unlocked", "insurerPaid"]);
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
 * The closed day that `next` changes compared with `prev` (a main-treasury entry or transfer
 * dated on or before the last closed day was added, removed, edited or moved), or null.
 */
export function lockedDayChange(prev: HospitalDB, next: HospitalDB): string | null {
  const through = closedThrough(prev);
  if (!through) return null;
  const check = <T extends { id: string; date: string }>(a: T[], b: T[], main: (x: T) => boolean): string | null => {
    if (a === b) return null;
    const inA = new Set(a);
    const inB = new Set(b);
    const before = new Map<string, T>();
    const after = new Map<string, T>();
    for (const x of a) if (!inB.has(x)) before.set(x.id, x);
    for (const x of b) if (!inA.has(x)) after.set(x.id, x);
    const frozen = (x: T | undefined) => !!x && main(x) && x.date <= through;
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const o = before.get(id);
      const n = after.get(id);
      if (!frozen(o) && !frozen(n)) continue;
      if (o && n && stable(o) === stable(n)) continue;
      return (frozen(o) ? o!.date : n!.date) as string;
    }
    return null;
  };
  return (
    check(prev.transactions ?? [], next.transactions ?? [], inMain) ??
    check(prev.transfers ?? [], next.transfers ?? [], touchesMain)
  );
}

export const lockedDayMessage = (date: string) =>
  `يوم ${date} مقفول في الإقفال اليومي للخزينة — لا يمكن إضافة أو تعديل أو حذف حركة خزينة بتاريخه أو قبله. سجّل العملية بتاريخ اليوم، أو اطلب إعادة فتح اليوم بموافقة المدير المالي.`;

/** Reopen requests waiting for a decision. */
export const pendingReopens = (db: Pick<HospitalDB, "dailyClosings">) =>
  (db.dailyClosings ?? []).filter((c) => c.reopen?.status === "pending");
