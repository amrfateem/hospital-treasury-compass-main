import { describe, expect, it } from "vitest";
import { emptyDB, type HospitalDB } from "./model";
import { expenseDetails, pettyDetails, revenueDetails, totalsOf } from "./cash-details";

function dbWith(): HospitalDB {
  const db = emptyDB();
  db.patientInvoices = [
    {
      id: "inv1",
      number: "INV-1",
      date: "2026-11-10",
      patientName: "مريض",
      department: "clinics",
      items: [{ description: "كشف", qty: 1, unitPrice: 200 }],
      discount: 0,
      paymentMethod: "cash",
      createdAt: 1,
    },
  ];
  db.transactions = [
    {
      id: "t-out",
      date: "2026-11-11",
      department: "general",
      kind: "out",
      description: "كهرباء",
      amount: 500,
      receiptId: "EXP-1",
      source: "expense",
      createdAt: 2,
    },
    {
      id: "t-petty",
      date: "2026-11-12",
      department: "general",
      kind: "out",
      description: "نثريات",
      amount: 50,
      receiptId: "PTX-1",
      source: "petty",
      category: "c1",
      createdAt: 3,
    },
  ];
  db.pettyRequests = [
    {
      id: "p1",
      number: "PTR-1",
      date: "2026-11-12",
      department: "general",
      category: "c1",
      description: "نثريات",
      amount: 50,
      status: "paid",
      requestedBy: "موظف",
      requestedById: "u1",
      createdAt: 4,
      paidBy: "محاسب",
      paidOn: "2026-11-12",
    },
  ];
  db.transactions[1]!.ref = "p1";
  return db;
}

describe("cash detail rows", () => {
  it("keeps petty out of the expense block and counts it once in petty", () => {
    const db = dbWith();
    const expenses = expenseDetails(db, "2026-11-01", "2026-11-30");
    expect(expenses.map((t) => t.id)).toEqual(["t-out"]);
    expect(totalsOf(expenses)).toBe(500);
    const petty = pettyDetails(db, "2026-11-01", "2026-11-30");
    expect(petty).toHaveLength(1);
    expect(petty[0]!.spend?.id).toBe("t-petty");
    expect(totalsOf(petty.map((p) => p.request))).toBe(50);
  });

  it("returns receipt amounts for the selected period only", () => {
    const db = dbWith();
    const rows = revenueDetails(db, "2026-11-01", "2026-11-30");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amounts.total).toBe(200);
    expect(revenueDetails(db, "2026-10-01", "2026-10-31")).toHaveLength(0);
  });
});
