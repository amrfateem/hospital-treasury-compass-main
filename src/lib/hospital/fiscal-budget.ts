/**
 * Fiscal-year budget (موازنة السنة المالية): planned revenue, operating expenses, capital
 * spending and financing per month, prepared as a draft and approved by the finance manager /
 * director. Totals and plan-vs-actual math are pure (covered by fiscal-budget.test.ts).
 */

export type BudgetLineKind = "revenue" | "expense" | "capex" | "financing";
export const BUDGET_LINE_KINDS: Record<BudgetLineKind, string> = {
  revenue: "الإيرادات المتوقعة",
  expense: "المصروفات التشغيلية",
  capex: "المصروفات الرأسمالية (أجهزة وأصول)",
  financing: "التمويل (قروض / تمويل المالك)",
};

export interface FiscalBudgetLine {
  id: string;
  kind: BudgetLineKind;
  label: string;
  /** Department / cost center (revenue and departmental expenses). */
  department?: string | undefined;
  /** Expense category id (lists.expenseCategories) for plan-vs-actual. */
  category?: string | undefined;
  /** 12 monthly amounts (Jan..Dec). */
  months: number[];
  note?: string | undefined;
}

export type FiscalBudgetStatus = "draft" | "approved";
export interface FiscalBudget {
  year: number;
  status: FiscalBudgetStatus;
  lines: FiscalBudgetLine[];
  /** Cash expected at the start of the year. */
  openingCash: number;
  notes?: string | undefined;
  preparedBy?: string | undefined;
  approvedBy?: string | undefined;
  approvedAt?: number | undefined;
  updatedAt: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const lineTotal = (l: FiscalBudgetLine) => r2(l.months.reduce((s, x) => s + (Number(x) || 0), 0));

/** Twelve clean, non-negative monthly amounts. */
export function cleanMonths(xs: unknown): number[] {
  const arr = Array.isArray(xs) ? xs : [];
  return Array.from({ length: 12 }, (_, i) => r2(Math.max(0, Number(arr[i]) || 0)));
}

/** Spreads a yearly amount evenly over 12 months (cents go to the last month). */
export function spreadYearly(total: number): number[] {
  const each = Math.floor((Math.max(0, total) / 12) * 100) / 100;
  const months = Array.from({ length: 12 }, () => each);
  months[11] = r2(Math.max(0, total) - each * 11);
  return months;
}

export interface BudgetTotals {
  revenue: number;
  expense: number;
  capex: number;
  financing: number;
  /** Revenue − operating expenses. */
  operatingSurplus: number;
  /** Opening cash + revenue + financing − expenses − capex. */
  closingCash: number;
  monthly: { month: number; revenue: number; expense: number; capex: number; financing: number; net: number; cash: number }[];
}

export function budgetTotals(b: Pick<FiscalBudget, "lines" | "openingCash">): BudgetTotals {
  const sumKind = (k: BudgetLineKind, m?: number) =>
    r2(b.lines.filter((l) => l.kind === k).reduce((s, l) => s + (m === undefined ? lineTotal(l) : Number(l.months[m]) || 0), 0));
  let cash = r2(b.openingCash || 0);
  const monthly = Array.from({ length: 12 }, (_, m) => {
    const revenue = sumKind("revenue", m);
    const expense = sumKind("expense", m);
    const capex = sumKind("capex", m);
    const financing = sumKind("financing", m);
    const net = r2(revenue + financing - expense - capex);
    cash = r2(cash + net);
    return { month: m + 1, revenue, expense, capex, financing, net, cash };
  });
  const revenue = sumKind("revenue");
  const expense = sumKind("expense");
  const capex = sumKind("capex");
  const financing = sumKind("financing");
  return {
    revenue,
    expense,
    capex,
    financing,
    operatingSurplus: r2(revenue - expense),
    closingCash: r2((b.openingCash || 0) + revenue + financing - expense - capex),
    monthly,
  };
}

/** Variance of an actual figure against its plan: amount and % (null when nothing was planned). */
export function variance(plan: number, actual: number) {
  return { diff: r2(actual - plan), pct: plan > 0 ? Math.round(((actual - plan) / plan) * 1000) / 10 : null };
}
