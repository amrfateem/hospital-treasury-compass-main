import { describe, expect, it } from "vitest";
import { emptyDB, type HospitalDB, type PatientInvoice } from "./model";
import { runOp, type OpCtx } from "./ops";
import { accountSummary, creditStatement, dueSchedule, makeInstallments } from "./credit";
import { balanceSheet, buildJournal, incomeStatement, trialBalance } from "./ledger";

const admin: OpCtx = { now: 1_000, today: "2026-11-15", actor: { id: "u1", name: "المدير", role: "admin" } };

function receipt(over: Partial<PatientInvoice> = {}): PatientInvoice {
  return {
    id: "p1",
    number: "",
    date: "2026-11-02",
    patientName: "مريض",
    department: "lab",
    items: [{ description: "عملية", qty: 1, unitPrice: 1000 }],
    discount: 0,
    paymentMethod: "cash",
    createdAt: 1,
    boxId: "main",
    ...over,
  };
}
function withAccount(limit?: number): HospitalDB {
  return runOp(emptyDB(), "saveCreditAccount", { id: "c1", kind: "patient", name: "أحمد", active: true, createdAt: 0, creditLimit: limit, termsDays: 30 }, admin);
}

describe("credit accounts (الآجل)", () => {
  it("a 1,000 receipt with 600 on credit puts 400 in the drawer and 600 on the account", () => {
    const db = runOp(withAccount(), "savePatientInvoice", { id: "p1", input: receipt({ credit: { accountId: "c1", amount: 600 } }) }, admin);
    const cash = db.transactions.filter((t) => t.source === "invoice");
    expect(cash.map((t) => t.amount)).toEqual([400]);
    const s = accountSummary(db, db.creditAccounts[0]!, "2026-11-15");
    expect(s.balance).toBe(600);
    const tb = trialBalance(buildJournal(db, "2026-12-31"), "2026-01-01", "2026-12-31");
    expect(tb.find((r) => r.account === "1350-c1")?.closingDebit).toBe(600);
  });

  it("splits 900 into 3 monthly installments of 300", () => {
    expect(makeInstallments(900, 3, "2026-12-01")).toEqual([
      { due: "2026-12-01", amount: 300 },
      { due: "2027-01-01", amount: 300 },
      { due: "2027-02-01", amount: 300 },
    ]);
  });

  it("a 350 collection pays the first installment and 50 of the second; the rest is overdue later", () => {
    let db = runOp(
      withAccount(),
      "savePatientInvoice",
      { id: "p1", input: receipt({ credit: { accountId: "c1", amount: 900, installments: makeInstallments(900, 3, "2026-12-01") } }) },
      admin,
    );
    db = runOp(db, "collectCredit", { id: "col1", accountId: "c1", date: "2026-12-01", amount: 350, boxId: "main", method: "cash" }, admin);
    const rows = dueSchedule(db, db.creditAccounts[0]!, "2027-01-20");
    expect(rows.map((r) => r.remaining)).toEqual([0, 250, 300]);
    expect(rows[1]!.lateDays).toBe(19);
    const st = creditStatement(db, db.creditAccounts[0]!);
    expect(st.closing).toBe(550);
    // collection goes into the treasury against the account
    const tb = trialBalance(buildJournal(db, "2027-12-31"), "2026-01-01", "2027-12-31");
    expect(tb.find((r) => r.account === "1350-c1")?.closingDebit).toBe(550);
  });

  it("refuses to pass the credit limit", () => {
    expect(() =>
      runOp(withAccount(500), "savePatientInvoice", { id: "p1", input: receipt({ credit: { accountId: "c1", amount: 600 } }) }, admin),
    ).toThrow(/حد الائتمان/);
  });

  it("refuses to collect more than the balance", () => {
    const db = runOp(withAccount(), "savePatientInvoice", { id: "p1", input: receipt({ credit: { accountId: "c1", amount: 600 } }) }, admin);
    expect(() =>
      runOp(db, "collectCredit", { id: "x", accountId: "c1", date: "2026-11-10", amount: 700, boxId: "main", method: "cash" }, admin),
    ).toThrow(/رصيد الحساب/);
  });
});

describe("manual journal entries", () => {
  const entry = (over = {}) => ({
    date: "2026-12-31",
    kind: "accrual" as const,
    description: "كهرباء ديسمبر مستحقة",
    lines: [
      { account: "5900", debit: 2000, credit: 0, costCenter: "general" },
      { account: "2400", debit: 0, credit: 2000 },
    ],
    ...over,
  });

  it("rejects an unbalanced entry", () => {
    expect(() =>
      runOp(emptyDB(), "saveJournalEntry", { id: "j1", input: entry({ lines: [{ account: "5900", debit: 2000, credit: 0 }, { account: "2400", debit: 0, credit: 1500 }] }) }, admin),
    ).toThrow(/غير متوازن/);
  });

  it("rejects entries on cash boxes (they belong to the treasury)", () => {
    expect(() =>
      runOp(emptyDB(), "saveJournalEntry", { id: "j1", input: entry({ lines: [{ account: "5900", debit: 50, credit: 0 }, { account: "1100", debit: 0, credit: 50 }] }) }, admin),
    ).toThrow(/من صفحاتها/);
  });

  it("an accrual hits December and reverses on 1 January; the balance sheet stays balanced", () => {
    const db = runOp(emptyDB(), "saveJournalEntry", { id: "j1", input: entry({ reverseOn: "2027-01-01" }) }, admin);
    const entries = buildJournal(db, "2027-01-31");
    expect(incomeStatement(entries, "2026-12-01", "2026-12-31").totalExpenses).toBe(2000);
    expect(incomeStatement(entries, "2027-01-01", "2027-01-31").totalExpenses).toBe(-2000);
    const bs = balanceSheet(entries, "2026-12-31");
    expect(bs.balanced).toBe(true);
    expect(bs.totalLiabilities).toBe(2000);
  });
});

describe("budget", () => {
  it("keeps one budget per department and year", () => {
    let db = runOp(emptyDB(), "saveBudget", { year: 2026, department: "lab", revenue: Array(12).fill(1000), expense: Array(12).fill(400) }, admin);
    db = runOp(db, "saveBudget", { year: 2026, department: "lab", revenue: Array(12).fill(2000), expense: Array(12).fill(400) }, admin);
    expect(db.budgets).toHaveLength(1);
    expect(db.budgets[0]!.revenue[0]).toBe(2000);
  });
});
