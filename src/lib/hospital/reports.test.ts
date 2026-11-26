import { describe, expect, it } from "vitest";
import { emptyDB, type HospitalDB, type PatientInvoice, type Transaction } from "./model";
import { paymentsReport, pettyReport, revenueReport } from "./reports";

const inv = (o: Partial<PatientInvoice>): PatientInvoice => ({
  id: "i1",
  number: "INV-1",
  date: "2026-11-10",
  patientName: "مريض",
  department: "lab",
  items: [{ description: "صورة دم", qty: 2, unitPrice: 100 }],
  discount: 0,
  paymentMethod: "cash",
  createdAt: 1,
  createdBy: "سارة",
  ...o,
});
const tx = (o: Partial<Transaction>): Transaction => ({
  id: "t1",
  date: "2026-11-10",
  department: "general",
  kind: "out",
  description: "مصروف",
  amount: 100,
  receiptId: "EXP-1",
  source: "expense",
  createdAt: 1,
  ...o,
});
function db(): HospitalDB {
  const d = emptyDB();
  d.lists.payers = [{ id: "p1", name: "شركة تأمين", percent: 50 }];
  d.patientInvoices = [
    inv({}),
    inv({ id: "i2", number: "INV-2", department: "radiology", items: [{ description: "أشعة", qty: 1, unitPrice: 500 }], discount: 100, payer: { payerId: "p1", percent: 50 } }),
    inv({ id: "i3", number: "INV-3", date: "2026-12-01" }),
  ];
  return d;
}
const NOV = { from: "2026-11-01", to: "2026-11-30" };

describe("revenue report", () => {
  it("totals receipts after discount and splits the insurer's share", () => {
    const r = revenueReport(db(), NOV);
    // 200 + (500 − 100) = 600 net; insurer pays 50% of 400 = 200; patients paid 400
    expect(r.totals).toMatchObject({ count: 2, gross: 700, discount: 100, net: 600, insurer: 200, paid: 400 });
    expect(r.byDepartment.map((g) => [g.key, g.total])).toEqual([["radiology", 400], ["lab", 200]]);
  });

  it("subtracts refunds paid back in the period", () => {
    const d = db();
    d.refunds = [{ id: "r1", number: "RF-1", date: "2026-11-12", invoiceId: "i1", invoiceNumber: "INV-1", patientName: "مريض", department: "lab", lines: [], amount: 50, reason: "خطأ", status: "paid", requestedBy: "س", requestedById: "u", createdAt: 1, paidOn: "2026-11-12" }];
    expect(revenueReport(d, NOV).totals.netAfterRefunds).toBe(550);
  });

  it("counts services with their quantities and includes both range ends", () => {
    const r = revenueReport(db(), { from: "2026-11-10", to: "2026-12-01" });
    expect(r.totals.count).toBe(3);
    const cbc = r.byService.find((s) => s.label.startsWith("صورة دم"))!;
    expect([cbc.qty, cbc.total]).toEqual([4, 400]);
  });
});

describe("payments report", () => {
  it("groups every money-out by source and category, skipping money-in and shift differences", () => {
    const d = emptyDB();
    d.lists.expenseCategories = [{ id: "elec", name: "كهرباء" }];
    d.transactions = [
      tx({ id: "a", amount: 300, category: "elec" }),
      tx({ id: "b", amount: 200, source: "supplier-payment" }),
      tx({ id: "c", amount: 999, kind: "in", source: "invoice" }),
      tx({ id: "d", amount: 5, source: "shift" }),
    ];
    const r = paymentsReport(d, NOV);
    expect(r.totals.total).toBe(500);
    expect(r.bySource.map((g) => [g.key, g.total])).toEqual([["expense", 300], ["supplier-payment", 200]]);
    expect(r.totals.largest).toBe("كهرباء");
  });
});

describe("petty report", () => {
  it("counts only petty spends and links them to their request", () => {
    const d = emptyDB();
    d.pettyRequests = [{ id: "q1", number: "PR-1", date: "2026-11-09", department: "lab", category: "tea", description: "شاي", amount: 40, status: "paid", requestedBy: "منى", requestedById: "u2", createdAt: 1 }];
    d.transactions = [tx({ id: "p", amount: 40, source: "petty", ref: "q1", department: "lab" }), tx({ id: "e", amount: 300 })];
    const r = pettyReport(d, NOV);
    expect(r.totals.total).toBe(40);
    expect(r.byRequester[0]).toMatchObject({ label: "منى", total: 40 });
    expect(r.byStatus.find((s) => s.status === "paid")!.count).toBe(1);
  });
});
