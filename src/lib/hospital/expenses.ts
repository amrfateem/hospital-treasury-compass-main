/**
 * Expense register: every amount that leaves any cash box (except moves between boxes, which
 * are transfers, and opening balances) is an expense. Pure helpers shared by the expenses,
 * petty-cash and review screens.
 */
import { listLabel, type HospitalLists, type Transaction, type TxSource } from "./model";

const SOURCE_CATEGORY: Partial<Record<TxSource, string>> = {
  payroll: "رواتب وأجور",
  supplier: "مشتريات موردين",
  "supplier-payment": "سداد مستحقات موردين",
  doctor: "مستحقات أطباء",
  shift: "عجز تقفيل ورديات",
  manual: "مصروفات أخرى (قيد خزينة)",
  expense: "مصروفات أخرى",
  petty: "نثريات",
  "payment-order": "أوامر صرف",
};

/** Money out that is not an expense: refunds reverse revenue, advances are owed back, deposits are returned. */
const NOT_EXPENSE = new Set<TxSource>(["opening", "refund", "advance", "deposit"]);

/** Money-out entries that count as expenses. */
export function expenseEntries<T extends Pick<Transaction, "kind" | "source">>(txs: T[]) {
  return txs.filter((t) => t.kind === "out" && !NOT_EXPENSE.has(t.source));
}

/** Category of an expense entry: its chosen item when it has one, otherwise where it came from. */
export function expenseCategory(
  t: Pick<Transaction, "source" | "category">,
  lists: Pick<HospitalLists, "expenseCategories" | "pettyCategories">,
): { id: string; label: string } {
  if (t.category) {
    if (t.source === "petty")
      return {
        id: `petty:${t.category}`,
        label: `نثريات — ${listLabel(lists.pettyCategories, t.category)}`,
      };
    return { id: `cat:${t.category}`, label: listLabel(lists.expenseCategories, t.category) };
  }
  return { id: `src:${t.source}`, label: SOURCE_CATEGORY[t.source] ?? "مصروفات أخرى" };
}

/** Totals per group, largest first, with each group's share of the whole. */
export function groupTotals<T extends { amount: number }>(
  rows: T[],
  key: (r: T) => { id: string; label: string },
) {
  const map = new Map<string, { id: string; label: string; total: number; count: number }>();
  for (const r of rows) {
    const k = key(r);
    const g = map.get(k.id) ?? { ...k, total: 0, count: 0 };
    g.total = Math.round((g.total + r.amount) * 100) / 100;
    g.count++;
    map.set(k.id, g);
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return [...map.values()]
    .sort((a, b) => b.total - a.total)
    .map((g) => ({ ...g, share: total ? g.total / total : 0 }));
}
