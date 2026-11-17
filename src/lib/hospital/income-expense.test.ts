import { describe, expect, it } from "vitest";
import { buildJournal, chartOfAccounts, incomeStatement } from "./ledger";
import { emptyDB, type Actor, type HospitalDB } from "./model";
import { runOp, type OpCtx } from "./ops";
import { dashboardTotals, revenueExpenseCsv, revenueExpenseReport } from "./income-expense";

const owner: Actor = { id: "u-dir", name: "المدير", role: "admin" };
let clock = 1_000;
const ctx = (): OpCtx => ({ now: ++clock, today: "2026-11-20", actor: owner });

/** Receipts 1000 (lab) + 600 (clinics), a 200 expense, a 50 petty spend and a 100 refund. */
function month(): HospitalDB {
  let db = runOp(emptyDB(), "addTransaction", { id: "open", input: { date: "2026-11-01", department: "general", kind: "in", description: "رصيد", amount: 5000, source: "opening" } }, ctx());
  const inv = (id: string, department: string, amount: number) =>
    ({ id, input: { date: "2026-11-10", patientName: "مريض", department, items: [{ description: "خدمة", qty: 1, unitPrice: amount, kind: "procedure" as const }], discount: 0, paymentMethod: "cash" } });
  db = runOp(db, "savePatientInvoice", inv("i1", "lab", 1000), ctx());
  db = runOp(db, "savePatientInvoice", inv("i2", "clinics", 600), ctx());
  db = runOp(db, "addExpense", { id: "e1", input: { date: "2026-11-12", department: "general", category: "maintenance", description: "صيانة", amount: 200, boxId: "main", method: "cash" } }, ctx());
  db = runOp(db, "addPettyExpense", { id: "p1", input: { date: "2026-11-12", department: "lab", category: "", description: "شاي", amount: 50 } }, ctx());
  db = runOp(db, "requestRefund", { id: "rf1", input: { invoiceId: "i1", date: "2026-11-15", lines: [{ index: 0, qty: 1 }], reason: "إلغاء" } }, ctx());
  return db;
}

function report(db: HospitalDB) {
  const entries = buildJournal(db, "2026-11-30");
  return { entries, r: revenueExpenseReport(entries, chartOfAccounts(db), "2026-11-01", "2026-11-30") };
}

describe("revenues, expenses and petty cash report", () => {
  it("shows revenue per department, expenses and petty cash separately", () => {
    const { r } = report(month());
    expect(r.revenue.total).toBe(1600);
    expect(Object.fromEntries(r.revenue.byCenter.map((g) => [g.id, g.total]))).toEqual({ lab: 1000, clinics: 600 });
    expect(r.expenses.total).toBe(200);
    expect(r.petty.total).toBe(50);
    expect(r.totalExpenses).toBe(250);
    expect(r.net).toBe(1350);
  });

  it("does not count the opening balance as revenue", () => {
    const { r } = report(month());
    expect(r.revenue.lines.some((l) => l.description === "رصيد")).toBe(false);
  });

  it("shows a paid refund as negative revenue, not an expense", () => {
    let db = month();
    db = runOp(db, "decideRefund", { id: "rf1", approve: true }, { ...ctx(), actor: { id: "u-fin", name: "مالي", role: "finance" } });
    db = runOp(db, "payRefund", { id: "rf1", date: "2026-11-15", method: "cash" }, ctx());
    const { r } = report(db);
    expect(r.revenue.total).toBe(600);
    expect(r.expenses.total).toBe(200);
    expect(r.revenue.lines.find((l) => l.amount < 0)?.amount).toBe(-1000);
  });

  it("always equals the income statement for the same dates", () => {
    const { entries, r } = report(month());
    const is = incomeStatement(entries, "2026-11-01", "2026-11-30");
    expect(r.revenue.total).toBe(is.totalRevenue);
    expect(r.totalExpenses).toBe(is.totalExpenses);
    expect(r.net).toBe(is.net);
  });

  it("splits the totals month by month", () => {
    let db = month();
    db = runOp(db, "addPettyExpense", { id: "p2", input: { date: "2026-12-02", department: "general", category: "", description: "مياه", amount: 30 } }, ctx());
    const entries = buildJournal(db, "2026-12-31");
    const r = revenueExpenseReport(entries, chartOfAccounts(db), "2026-11-01", "2026-12-31");
    expect(r.months).toEqual([
      { period: "2026-11", revenue: 1600, expenses: 250, petty: 50, net: 1350 },
      { period: "2026-12", revenue: 0, expenses: 30, petty: 30, net: -30 },
    ]);
  });

  it("exports every line with section totals for Excel", () => {
    const csv = revenueExpenseCsv(report(month()).r);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("إجمالي الإيرادات,,,,,,1600.00");
    expect(csv).toContain("إجمالي النثريات,,,,,,50.00");
    expect(csv).toContain("صافي الربح,,,,,,1350.00");
  });
});

describe("dashboard: today, this month and this year", () => {
  /** Adds last year's and another day's movement around the November month. */
  function withOtherDays(): HospitalDB {
    let db = month();
    db = runOp(db, "addPettyExpense", { id: "p-today", input: { date: "2026-11-20", department: "general", category: "", description: "مياه", amount: 25 } }, ctx());
    db = runOp(db, "savePatientInvoice", { id: "i-today", input: { date: "2026-11-20", patientName: "مريض", department: "lab", items: [{ description: "تحليل", qty: 1, unitPrice: 400, kind: "procedure" as const }], discount: 0, paymentMethod: "cash" } }, ctx());
    db = runOp(db, "addExpense", { id: "e-oct", input: { date: "2026-10-05", department: "general", category: "maintenance", description: "صيانة", amount: 300, boxId: "main", method: "cash" } }, ctx());
    db = runOp(db, "savePatientInvoice", { id: "i-2025", input: { date: "2025-12-30", patientName: "مريض", department: "lab", items: [{ description: "تحليل", qty: 1, unitPrice: 999, kind: "procedure" as const }], discount: 0, paymentMethod: "cash" } }, ctx());
    return db;
  }

  it("shows today's revenue, expenses and petty cash only for today", () => {
    const t = dashboardTotals(buildJournal(withOtherDays(), "2026-11-20"), "2026-11-20");
    expect(t.day).toEqual({ revenue: 400, expenses: 0, petty: 25, totalExpenses: 25, net: 375 });
  });

  it("shows the month from the 1st to today", () => {
    const t = dashboardTotals(buildJournal(withOtherDays(), "2026-11-20"), "2026-11-20");
    expect(t.month).toEqual({ revenue: 2000, expenses: 200, petty: 75, totalExpenses: 275, net: 1725 });
  });

  it("shows the year from 1 January, without last year", () => {
    const t = dashboardTotals(buildJournal(withOtherDays(), "2026-11-20"), "2026-11-20");
    expect(t.year).toEqual({ revenue: 2000, expenses: 500, petty: 75, totalExpenses: 575, net: 1425 });
  });

  it("matches the income statement for the same year", () => {
    const entries = buildJournal(withOtherDays(), "2026-11-20");
    const is = incomeStatement(entries, "2026-01-01", "2026-11-20");
    const t = dashboardTotals(entries, "2026-11-20").year;
    expect([t.revenue, t.totalExpenses, t.net]).toEqual([is.totalRevenue, is.totalExpenses, is.net]);
  });
});
