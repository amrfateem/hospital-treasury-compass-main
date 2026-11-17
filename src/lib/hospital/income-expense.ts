/**
 * Revenues, expenses and petty cash in full detail (إدارة الإيرادات والمصروفات والنثريات).
 * Built from the same double-entry journal as the financial statements, so every total here
 * equals the income statement for the same dates, and every line opens its source document.
 * Petty cash (group 5400) is shown on its own but is part of total expenses. Pure.
 */
import { accountName, groupOf, typeOf, type Account, type JournalEntry } from "./ledger";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const PETTY_GROUP = "5400";

export interface DetailLine {
  id: string;
  entryId: string;
  date: string;
  number: string;
  description: string;
  source: JournalEntry["source"];
  txSource?: string | undefined;
  account: string;
  accountLabel: string;
  costCenter: string;
  /** On the account's normal side: revenue = credit − debit, expense = debit − credit (refunds are negative revenue). */
  amount: number;
}

export interface Group {
  id: string;
  label: string;
  total: number;
  count: number;
  share: number;
}

export interface Block {
  lines: DetailLine[];
  byAccount: Group[];
  byCenter: Group[];
  total: number;
}

export interface RevenueExpenseReport {
  revenue: Block;
  /** Every expense except petty cash. */
  expenses: Block;
  petty: Block;
  /** Expenses + petty (equals the income statement's total expenses). */
  totalExpenses: number;
  net: number;
  /** Month by month: revenue, expenses (incl. petty), petty, net. */
  months: { period: string; revenue: number; expenses: number; petty: number; net: number }[];
}

function group(lines: DetailLine[], key: (l: DetailLine) => { id: string; label: string }): Group[] {
  const map = new Map<string, Group>();
  for (const l of lines) {
    const k = key(l);
    const g = map.get(k.id) ?? { ...k, total: 0, count: 0, share: 0 };
    g.total = r2(g.total + l.amount);
    g.count++;
    map.set(k.id, g);
  }
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return [...map.values()]
    .filter((g) => Math.abs(g.total) >= 0.005 || g.count)
    .sort((a, b) => b.total - a.total)
    .map((g) => ({ ...g, share: total ? g.total / total : 0 }));
}

function block(lines: DetailLine[], centerName: (id: string) => string): Block {
  return {
    lines: [...lines].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)),
    byAccount: group(lines, (l) => ({ id: l.account, label: l.accountLabel })),
    byCenter: group(lines, (l) => ({ id: l.costCenter || "-", label: l.costCenter ? centerName(l.costCenter) : "بدون مركز تكلفة" })),
    total: r2(lines.reduce((s, l) => s + l.amount, 0)),
  };
}

/** Revenue / expense / petty lines of the journal between two dates (inclusive). */
export function revenueExpenseReport(
  entries: JournalEntry[],
  accounts: Account[],
  from: string,
  to: string,
  centerName: (id: string) => string = (id) => id,
): RevenueExpenseReport {
  const rev: DetailLine[] = [];
  const exp: DetailLine[] = [];
  const petty: DetailLine[] = [];
  for (const e of entries) {
    if (e.date > to) break;
    if (e.date < from) continue;
    e.lines.forEach((l, i) => {
      const t = typeOf(l.account);
      if (t !== "revenue" && t !== "expense") return;
      const line: DetailLine = {
        id: `${e.id}#${i}`,
        entryId: e.id,
        date: e.date,
        number: e.number,
        description: e.description,
        source: e.source,
        txSource: e.txSource,
        account: l.account,
        accountLabel: accountName(accounts, l.account),
        costCenter: l.costCenter ?? "",
        amount: r2(t === "revenue" ? l.credit - l.debit : l.debit - l.credit),
      };
      if (t === "revenue") rev.push(line);
      else if (groupOf(l.account) === PETTY_GROUP) petty.push(line);
      else exp.push(line);
    });
  }
  const revenue = block(rev, centerName);
  const expenses = block(exp, centerName);
  const pettyBlock = block(petty, centerName);
  const totalExpenses = r2(expenses.total + pettyBlock.total);

  const months = new Map<string, { revenue: number; expenses: number; petty: number }>();
  const add = (l: DetailLine, k: "revenue" | "expenses" | "petty") => {
    const p = l.date.slice(0, 7);
    const m = months.get(p) ?? { revenue: 0, expenses: 0, petty: 0 };
    m[k] = r2(m[k] + l.amount);
    if (k === "petty") m.expenses = r2(m.expenses + l.amount);
    months.set(p, m);
  };
  rev.forEach((l) => add(l, "revenue"));
  exp.forEach((l) => add(l, "expenses"));
  petty.forEach((l) => add(l, "petty"));

  return {
    revenue,
    expenses,
    petty: pettyBlock,
    totalExpenses,
    net: r2(revenue.total - totalExpenses),
    months: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, m]) => ({ period, ...m, net: r2(m.revenue - m.expenses) })),
  };
}

const cell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Excel-ready CSV (UTF-8 BOM so Arabic opens correctly) of every line, grouped by section, with totals. */
export function revenueExpenseCsv(report: RevenueExpenseReport, centerName: (id: string) => string = (id) => id) {
  const head = ["القسم", "التاريخ", "رقم المستند", "البيان", "الحساب", "مركز التكلفة", "المبلغ"];
  const out: (string | number)[][] = [head];
  const section = (title: string, b: Block) => {
    for (const l of [...b.lines].reverse())
      out.push([title, l.date, l.number, l.description, l.accountLabel, l.costCenter ? centerName(l.costCenter) : "", l.amount.toFixed(2)]);
    out.push([`إجمالي ${title}`, "", "", "", "", "", b.total.toFixed(2)]);
  };
  section("الإيرادات", report.revenue);
  section("المصروفات", report.expenses);
  section("النثريات", report.petty);
  out.push(["إجمالي المصروفات شاملة النثريات", "", "", "", "", "", report.totalExpenses.toFixed(2)]);
  out.push([report.net >= 0 ? "صافي الربح" : "صافي الخسارة", "", "", "", "", "", report.net.toFixed(2)]);
  return "\uFEFF" + out.map((r) => r.map(cell).join(",")).join("\r\n");
}

export interface PeriodTotals {
  revenue: number;
  /** Expenses without petty cash. */
  expenses: number;
  petty: number;
  /** Expenses + petty. */
  totalExpenses: number;
  net: number;
}

/**
 * Today / this month / this year totals for the dashboard, from the same journal lines as
 * `revenueExpenseReport`, so each one equals the income statement for those dates.
 */
export function dashboardTotals(entries: JournalEntry[], today: string): Record<"day" | "month" | "year", PeriodTotals> {
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const acc = { day: [0, 0, 0], month: [0, 0, 0], year: [0, 0, 0] };
  for (const e of entries) {
    if (e.date > today) break;
    if (!e.date.startsWith(year)) continue;
    for (const l of e.lines) {
      const t = typeOf(l.account);
      if (t !== "revenue" && t !== "expense") continue;
      const i = t === "revenue" ? 0 : groupOf(l.account) === PETTY_GROUP ? 2 : 1;
      const v = t === "revenue" ? l.credit - l.debit : l.debit - l.credit;
      acc.year[i]! += v;
      if (e.date.startsWith(month)) acc.month[i]! += v;
      if (e.date === today) acc.day[i]! += v;
    }
  }
  const out = (a: number[]): PeriodTotals => {
    const [revenue, expenses, petty] = a.map(r2) as [number, number, number];
    const totalExpenses = r2(expenses + petty);
    return { revenue, expenses, petty, totalExpenses, net: r2(revenue - totalExpenses) };
  };
  return { day: out(acc.day), month: out(acc.month), year: out(acc.year) };
}
