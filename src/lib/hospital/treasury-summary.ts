/**
 * The hospital keeps one cash treasury (الخزينة الرئيسية); bank accounts are separate. Every desk
 * person collects into it inside their own shift, so "who collected how much" is read from the
 * treasury entries themselves (the shift owner, or the person who recorded the entry). Pure.
 */
import { boxBalance } from "./finance";
import { MAIN_BOX_ID, type HospitalDB, type Shift, type Transaction } from "./model";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Range {
  from: string;
  to: string;
}

/** Money in that is not collection from patients/payers: opening balances and shift surplus. */
const NOT_COLLECTION = new Set<Transaction["source"]>(["opening", "shift"]);

export interface CollectorRow {
  /** Stable key: the shift owner's user id, or the recorded name. */
  key: string;
  name: string;
  /** Number of collection entries (receipts, deposits, collections...). */
  count: number;
  collected: number;
  /** Money this person paid out of the treasury (refunds, petty, expenses...). */
  paidOut: number;
  /** Collected per payment method (cash, card...). */
  byMethod: Record<string, number>;
  shortage: number;
  surplus: number;
  /** Net this person brought into the treasury: collected − paid out + surplus − shortage. */
  net: number;
  openShift?: Shift | undefined;
}

export interface MainTreasurySummary {
  /** Main treasury balance now (all dates). */
  balance: number;
  opening: number;
  periodIn: number;
  periodOut: number;
  closing: number;
  /** Collections in the period per payment method. */
  byMethod: Record<string, number>;
  collectors: CollectorRow[];
  openShifts: Shift[];
}

/** Who an entry belongs to: the owner of the shift it was recorded in, else whoever recorded it. */
export function entryOwner(t: Pick<Transaction, "shiftId" | "by">, shifts: Shift[]): { key: string; name: string } {
  const s = t.shiftId ? shifts.find((x) => x.id === t.shiftId) : undefined;
  if (s) return { key: `u:${s.openedById}`, name: s.openedBy };
  const name = t.by?.trim() || "غير محدد";
  return { key: `n:${name}`, name };
}

/** Main treasury figures for a period, with each person's collections and shift differences. */
export function mainTreasurySummary(
  db: Pick<HospitalDB, "transactions" | "transfers" | "shifts">,
  range: Range,
): MainTreasurySummary {
  const inMain = (t: Transaction) => (t.boxId ?? MAIN_BOX_ID) === MAIN_BOX_ID;
  const main = db.transactions.filter(inMain);
  const transfers = db.transfers.filter((t) => t.from === MAIN_BOX_ID || t.to === MAIN_BOX_ID);
  const signedTx = (t: Transaction) => (t.kind === "in" ? t.amount : -t.amount);
  const signedTrf = (t: (typeof transfers)[number]) => (t.to === MAIN_BOX_ID ? t.amount : -t.amount);

  const opening = r2(
    main.filter((t) => t.date < range.from).reduce((s, t) => s + signedTx(t), 0) +
      transfers.filter((t) => t.date < range.from).reduce((s, t) => s + signedTrf(t), 0),
  );
  const inRange = main.filter((t) => t.date >= range.from && t.date <= range.to);
  const trfRange = transfers.filter((t) => t.date >= range.from && t.date <= range.to);
  const periodIn = r2(
    inRange.filter((t) => t.kind === "in").reduce((s, t) => s + t.amount, 0) +
      trfRange.filter((t) => t.to === MAIN_BOX_ID).reduce((s, t) => s + t.amount, 0),
  );
  const periodOut = r2(
    inRange.filter((t) => t.kind === "out").reduce((s, t) => s + t.amount, 0) +
      trfRange.filter((t) => t.from === MAIN_BOX_ID).reduce((s, t) => s + t.amount, 0),
  );

  const rows = new Map<string, CollectorRow>();
  const row = (t: Transaction) => {
    const o = entryOwner(t, db.shifts);
    let r = rows.get(o.key);
    if (!r) {
      r = { key: o.key, name: o.name, count: 0, collected: 0, paidOut: 0, byMethod: {}, shortage: 0, surplus: 0, net: 0 };
      rows.set(o.key, r);
    }
    return r;
  };
  const byMethod: Record<string, number> = {};
  for (const t of inRange) {
    if (t.source === "opening") continue;
    const r = row(t);
    if (t.source === "shift") {
      if (t.kind === "in") r.surplus = r2(r.surplus + t.amount);
      else r.shortage = r2(r.shortage + t.amount);
    } else if (t.kind === "in" && !NOT_COLLECTION.has(t.source)) {
      const m = t.method || "cash";
      r.count++;
      r.collected = r2(r.collected + t.amount);
      r.byMethod[m] = r2((r.byMethod[m] ?? 0) + t.amount);
      byMethod[m] = r2((byMethod[m] ?? 0) + t.amount);
    } else if (t.kind === "out") r.paidOut = r2(r.paidOut + t.amount);
  }
  const openShifts = db.shifts.filter((s) => !s.closedAt);
  for (const s of openShifts) {
    const key = `u:${s.openedById}`;
    const r = rows.get(key) ?? { key, name: s.openedBy, count: 0, collected: 0, paidOut: 0, byMethod: {}, shortage: 0, surplus: 0, net: 0 };
    r.openShift = s;
    rows.set(key, r);
  }
  const collectors = [...rows.values()]
    .map((r) => ({ ...r, net: r2(r.collected - r.paidOut + r.surplus - r.shortage) }))
    .sort((a, b) => b.collected - a.collected || a.name.localeCompare(b.name));

  return {
    balance: boxBalance(MAIN_BOX_ID, db.transactions, db.transfers),
    opening,
    periodIn,
    periodOut,
    closing: r2(opening + periodIn - periodOut),
    byMethod,
    collectors,
    openShifts,
  };
}
