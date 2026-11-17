/**
 * Credit accounts (الحسابات الآجلة): patients paying in installments and contracted companies
 * billed at the end of the month. Pure. Debts come from the credit part of patient receipts and
 * from manual charges (opening balances); collections are treasury entries with source
 * "collection" and ref = account id. Collections settle the oldest due amounts first.
 */
import { invoiceAmounts } from "./finance";
import type { CreditAccount, HospitalDB, Installment } from "./model";

const round2 = (n: number) => Math.round(n * 100) / 100;

type DB = Pick<HospitalDB, "patientInvoices" | "creditCharges" | "transactions" | "creditAccounts">;

const validIso = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso);
export function addDays(iso: string, days: number) {
  if (!validIso(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}
export function addMonths(iso: string, months: number) {
  if (!validIso(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Splits `total` into `count` monthly installments (the last one absorbs rounding). */
export function makeInstallments(total: number, count: number, firstDue: string): Installment[] {
  const n = Math.max(1, Math.min(60, Math.floor(count)));
  const each = Math.floor((total / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({
    due: addMonths(firstDue, i),
    amount: i === n - 1 ? round2(total - each * (n - 1)) : each,
  }));
}

/** Problems with a schedule (sum must equal the credit amount, dates on/after the receipt). */
export function installmentProblem(total: number, list: Installment[] | undefined, date: string): string | null {
  if (!list?.length) return null;
  if (list.some((i) => !(i.amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(i.due))) return "كل قسط يحتاج تاريخ استحقاق ومبلغ أكبر من صفر.";
  if (list.some((i) => i.due < date)) return "تاريخ استحقاق القسط لا يكون قبل تاريخ الفاتورة.";
  const sum = round2(list.reduce((s, i) => s + i.amount, 0));
  if (Math.abs(sum - round2(total)) > 0.01) return `مجموع الأقساط (${sum}) لا يساوي المبلغ الآجل (${round2(total)}).`;
  return null;
}

export interface CreditDebt {
  id: string;
  date: string;
  number: string;
  description: string;
  amount: number;
  department: string;
  source: "invoice" | "charge";
  refId: string;
  schedule: Installment[];
}

/** Every debt on an account, with its payment schedule. */
export function accountDebts(db: DB, account: Pick<CreditAccount, "id" | "termsDays">): CreditDebt[] {
  const terms = Math.max(0, account.termsDays ?? 0);
  const sched = (amount: number, date: string, list?: Installment[]) =>
    list?.length ? list : [{ due: addDays(date, terms), amount }];
  const out: CreditDebt[] = [];
  for (const inv of db.patientInvoices) {
    if (inv.credit?.accountId !== account.id) continue;
    const amount = invoiceAmounts(inv).credit;
    if (amount <= 0) continue;
    out.push({
      id: `inv-${inv.id}`,
      date: inv.date,
      number: inv.number,
      description: `إيصال ${inv.patientName}`,
      amount,
      department: inv.department,
      source: "invoice",
      refId: inv.id,
      schedule: sched(amount, inv.date, inv.credit.installments),
    });
  }
  for (const c of db.creditCharges) {
    if (c.accountId !== account.id) continue;
    out.push({
      id: `chg-${c.id}`,
      date: c.date,
      number: c.number,
      description: c.description,
      amount: round2(c.amount),
      department: c.department,
      source: "charge",
      refId: c.id,
      schedule: sched(round2(c.amount), c.date, c.installments),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

export const collectionsOf = (db: Pick<DB, "transactions">, accountId: string) =>
  db.transactions
    .filter((t) => t.source === "collection" && t.ref === accountId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

export interface DueRow {
  debtId: string;
  number: string;
  description: string;
  due: string;
  amount: number;
  paid: number;
  remaining: number;
  /** Days past due as of `today` (0 when not yet due). */
  lateDays: number;
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Installments with what is paid on each (oldest due first), as of `today`. */
export function dueSchedule(db: DB, account: Pick<CreditAccount, "id" | "termsDays">, today: string): DueRow[] {
  const rows: DueRow[] = accountDebts(db, account)
    .flatMap((d) =>
      d.schedule.map((s) => ({
        debtId: d.id,
        number: d.number,
        description: d.description,
        due: s.due,
        amount: round2(s.amount),
        paid: 0,
        remaining: round2(s.amount),
        lateDays: 0,
      })),
    )
    .sort((a, b) => a.due.localeCompare(b.due) || a.number.localeCompare(b.number));
  let pool = round2(collectionsOf(db, account.id).reduce((s, t) => s + t.amount, 0));
  for (const r of rows) {
    const take = round2(Math.min(pool, r.amount));
    r.paid = take;
    r.remaining = round2(r.amount - take);
    pool = round2(pool - take);
    r.lateDays = r.remaining > 0 && r.due < today ? daysBetween(r.due, today) : 0;
  }
  return rows;
}

export interface AccountSummary {
  account: CreditAccount;
  charged: number;
  collected: number;
  balance: number;
  overdue: number;
  nextDue: { due: string; remaining: number } | null;
  aging: { current: number; d30: number; d60: number; d90: number; over90: number };
  maxLate: number;
}

export function accountSummary(db: DB, account: CreditAccount, today: string): AccountSummary {
  const debts = accountDebts(db, account);
  const charged = round2(debts.reduce((s, d) => s + d.amount, 0));
  const collected = round2(collectionsOf(db, account.id).reduce((s, t) => s + t.amount, 0));
  const rows = dueSchedule(db, account, today);
  const aging = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 };
  let maxLate = 0;
  for (const r of rows) {
    if (r.remaining <= 0) continue;
    maxLate = Math.max(maxLate, r.lateDays);
    const k = r.lateDays === 0 ? "current" : r.lateDays <= 30 ? "d30" : r.lateDays <= 60 ? "d60" : r.lateDays <= 90 ? "d90" : "over90";
    aging[k] = round2(aging[k] + r.remaining);
  }
  const next = rows.find((r) => r.remaining > 0 && r.due >= today);
  return {
    account,
    charged,
    collected,
    balance: round2(charged - collected),
    overdue: round2(aging.d30 + aging.d60 + aging.d90 + aging.over90),
    nextDue: next ? { due: next.due, remaining: next.remaining } : null,
    aging,
    maxLate,
  };
}

export interface StatementRow {
  id: string;
  date: string;
  number: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

/** Account statement (كشف حساب): debts and collections with a running balance. */
export function creditStatement(db: DB, account: Pick<CreditAccount, "id" | "termsDays">, from = "0000-00-00", to = "9999-12-31") {
  type R = Omit<StatementRow, "balance"> & { at: number };
  const all: R[] = [
    ...accountDebts(db, account).map((d) => ({ id: d.id, date: d.date, number: d.number, description: d.description, debit: d.amount, credit: 0, at: 0 })),
    ...collectionsOf(db, account.id).map((t) => ({
      id: t.id,
      date: t.date,
      number: t.receiptId,
      description: t.description,
      debit: 0,
      credit: round2(t.amount),
      at: 1,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
  let bal = 0;
  let opening = 0;
  const rows: StatementRow[] = [];
  for (const r of all) {
    bal = round2(bal + r.debit - r.credit);
    if (r.date < from) {
      opening = bal;
      continue;
    }
    if (r.date > to) continue;
    rows.push({ id: r.id, date: r.date, number: r.number, description: r.description, debit: r.debit, credit: r.credit, balance: bal });
  }
  const closing = rows.length ? rows[rows.length - 1]!.balance : opening;
  return { opening, rows, closing };
}

/** Balance an account would reach with `extra` more debt — for the credit-limit check. */
export function balanceWith(db: DB, account: CreditAccount, extra: number, excludeInvoiceId?: string) {
  const d = db.patientInvoices.filter((i) => i.id !== excludeInvoiceId);
  const s = accountSummary({ ...db, patientInvoices: d }, account, "9999-12-31");
  return round2(s.balance + extra);
}
