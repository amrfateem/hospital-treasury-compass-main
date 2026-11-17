import { describe, expect, it } from "vitest";
import { boxBalance, costCenters, doctorDues } from "./finance";
import { expenseEntries } from "./expenses";
import { buildJournal, trialBalance } from "./ledger";
import { emptyDB, type Actor, type HospitalDB } from "./model";
import { runOp, type OpArgs, type OpCtx, type OpName } from "./ops";
import { pharmacySales } from "./pharmacy";
import { netOfRefunds, refundable } from "./refunds";
import { dueFor, installmentOf, remainingOf } from "./advances";
import { dischargeSettlement } from "./inpatient";

const owner: Actor = { id: "u-admin", name: "المدير", role: "admin" };
const fin: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const desk: Actor = { id: "u-desk", name: "منى", role: "reception" };
let clock = 1_000;
const ctx = (actor: Actor): OpCtx => ({ now: ++clock, today: "2026-11-20", actor });
const run = <K extends OpName>(db: HospitalDB, name: K, args: OpArgs<K>, actor: Actor = owner) => runOp(db, name, args, ctx(actor));

function base(): HospitalDB {
  let db = emptyDB();
  db = {
    ...db,
    stockItems: [{ id: "panadol", name: "بنادول", unit: "علبة", category: "c", department: "pharmacy", reorderLevel: 0, active: true, salePrice: 50 }],
    stockMoves: [{ id: "in1", itemId: "panadol", date: "2026-11-01", type: "in", qty: 10, unitCost: 30, expiry: "2027-12-31", createdAt: 1 }],
    doctors: [
      { id: "dr-s", name: "جراح", specialty: "جراحة", department: "gsurgery", active: true, monthlySalary: 0, consultPercent: 50, surgeryFee: 1000, supervisionPerDay: 0 },
      { id: "dr-a", name: "مخدر", specialty: "تخدير", department: "anesthesia", active: true, monthlySalary: 0, consultPercent: 0, surgeryFee: 400, supervisionPerDay: 0 },
    ],
    employees: [{ id: "e1", name: "أحمد", jobTitle: "ممرض", department: "nursing", hireDate: "2025-01-01", fixedSalary: 6000, variableSalary: 0 }],
  };
  // Cash in the one main treasury and the desk person's open shift on it.
  db = run(db, "addTransaction", { id: "open-main", input: { date: "2026-11-01", department: "general", kind: "in", description: "رصيد", amount: 60000, source: "opening" } });
  db = run(db, "openShift", { id: "sh1", openingFloat: 0 }, desk);
  return db;
}

const balanced = (db: HospitalDB) => {
  const rows = trialBalance(buildJournal(db, "2026-12-31"), "2026-01-01", "2026-12-31");
  const d = rows.reduce((s, r) => s + r.closingDebit, 0);
  const c = rows.reduce((s, r) => s + r.closingCredit, 0);
  return Math.round((d - c) * 100) / 100;
};
const closing = (db: HospitalDB, account: string) => {
  const r = trialBalance(buildJournal(db, "2026-12-31"), "2026-01-01", "2026-12-31").find((x) => x.account === account);
  return r ? Math.round((r.closingDebit - r.closingCredit) * 100) / 100 : 0;
};

describe("inpatient account: deposit, charges, one final bill", () => {
  function admitted() {
    let db = base();
    db = run(db, "openAdmission", { id: "adm1", input: { date: "2026-11-10", patientName: "سعاد", ward: "inpatient", roomRate: 500, supervisionRate: 200 } }, desk);
    db = run(db, "addAdmissionDeposit", { id: "dep1", admissionId: "adm1", date: "2026-11-10", amount: 3000, method: "cash" }, desk);
    db = run(db, "addAdmissionCharge", { admissionId: "adm1", charge: { id: "c1", date: "2026-11-11", department: "lab", description: "صورة دم", qty: 2, unitPrice: 150 } }, desk);
    db = run(db, "addAdmissionCharge", { admissionId: "adm1", charge: { id: "c2", date: "2026-11-11", department: "pharmacy", description: "بنادول", qty: 2, unitPrice: 50, stockItemId: "panadol" } }, desk);
    return db;
  }

  it("takes drugs charged during the stay out of stock right away", () => {
    const db = admitted();
    expect(db.stockMoves.find((m) => m.id === "sm-adm-c2")).toMatchObject({ type: "out", qty: 2, unitCost: 30, source: "admission" });
  });

  it("sets the deposit against the bill and collects only the rest on discharge", () => {
    let db = admitted();
    // 3 days × (500 + 200) = 2100 + lab 300 + drugs 100 = 2500 total; deposit 3000 → 500 back.
    db = run(db, "dischargeAdmission", { admissionId: "adm1", invoiceId: "inv-d", dischargeDate: "2026-11-13", discount: 0, paymentMethod: "cash" }, desk);
    const inv = db.patientInvoices.find((i) => i.id === "inv-d")!;
    expect(inv.depositApplied).toBe(2500);
    expect(db.transactions.some((t) => t.id === "tx-inv-d")).toBe(false);
    expect(db.transactions.find((t) => t.id === "dep-ret-adm1")).toMatchObject({ kind: "out", amount: 500 });
    expect(db.admissions[0]!.status).toBe("discharged");
    expect(closing(db, "2500")).toBe(0);
    expect(balanced(db)).toBe(0);
  });

  it("collects what the deposit does not cover and can leave a remainder on the patient", () => {
    let db = admitted();
    db = run(db, "addAdmissionCharge", { admissionId: "adm1", charge: { id: "c3", date: "2026-11-12", department: "surgery", description: "عملية", qty: 1, unitPrice: 4000, kind: "surgery" } }, desk);
    // Total 6500, deposit 3000 → 3500 due; pays 2000 now, 1500 stays on the patient.
    db = run(db, "dischargeAdmission", { admissionId: "adm1", invoiceId: "inv-d", dischargeDate: "2026-11-13", discount: 0, paid: 2000, paymentMethod: "cash" }, desk);
    expect(db.transactions.find((t) => t.id === "tx-inv-d")!.amount).toBe(2000);
    expect(db.patientInvoices.find((i) => i.id === "inv-d")!.credit!.amount).toBe(1500);
    expect(balanced(db)).toBe(0);
  });

  it("refuses to collect more than is due after the deposit", () => {
    expect(dischargeSettlement(1000, 400, 700).error).not.toBe("");
    expect(dischargeSettlement(1000, 400).payNow).toBe(600);
  });

  it("lets only a manager reopen a discharged account, removing the final bill", () => {
    let db = admitted();
    db = run(db, "dischargeAdmission", { admissionId: "adm1", invoiceId: "inv-d", dischargeDate: "2026-11-13", discount: 0, paymentMethod: "cash" }, desk);
    expect(() => run(db, "reopenAdmission", { admissionId: "adm1" }, desk)).toThrow();
    db = run(db, "reopenAdmission", { admissionId: "adm1" }, fin);
    expect(db.patientInvoices).toHaveLength(0);
    expect(db.transactions.some((t) => t.id === "dep-ret-adm1")).toBe(false);
    expect(db.admissions[0]!.status).toBe("open");
  });

  it("does not let the final bill be edited or deleted from the receipts page", () => {
    let db = admitted();
    db = run(db, "dischargeAdmission", { admissionId: "adm1", invoiceId: "inv-d", dischargeDate: "2026-11-13", discount: 0, paymentMethod: "cash" }, desk);
    expect(() => run(db, "deletePatientInvoice", { id: "inv-d" })).toThrow();
  });
});

describe("operating theatre: anaesthetist earns the per-surgery fee", () => {
  it("pays the surgeon and the anaesthetist their fee per surgery line", () => {
    let db = base();
    db = run(db, "savePatientInvoice", {
      id: "or1",
      input: { date: "2026-11-15", patientName: "خالد", department: "surgery", items: [{ description: "باقة استئصال الزائدة", qty: 1, unitPrice: 12000, kind: "surgery" }, { description: "تخدير كلي", qty: 1, unitPrice: 2000, kind: "procedure" }], discount: 0, paymentMethod: "cash", doctorId: "dr-s", anesthetistId: "dr-a" },
    }, desk);
    expect(doctorDues(db.doctors[0]!, db.patientInvoices, [], "2026-11").surgery).toBe(1000);
    expect(doctorDues(db.doctors[1]!, db.patientInvoices, [], "2026-11").surgery).toBe(400);
  });
});

describe("pharmacy sales on receipts", () => {
  const sale = (qty: number) => ({
    id: "ph1",
    input: { date: "2026-11-15", patientName: "منى", department: "pharmacy", items: [{ description: "بنادول", qty, unitPrice: 50, stockItemId: "panadol" }], discount: 0, paymentMethod: "cash" },
  });

  it("takes the sold quantity out of stock at batch cost and reports the profit", () => {
    const db = run(base(), "savePatientInvoice", sale(3), desk);
    expect(db.stockMoves.find((m) => m.id === "sm-ph1-0")).toMatchObject({ type: "out", qty: 3, unitCost: 30, salePrice: 50 });
    expect(pharmacySales(db.stockMoves, "2026-11")).toEqual([{ itemId: "panadol", qty: 3, sales: 150, cost: 90, profit: 60, margin: 0.4 }]);
  });

  it("refuses to sell more than is in stock", () => {
    expect(() => run(base(), "savePatientInvoice", sale(11), desk)).toThrow(/الرصيد المتاح/);
  });

  it("replaces the stock move when the receipt is edited and gives it back when deleted", () => {
    let db = run(base(), "savePatientInvoice", sale(3));
    db = run(db, "savePatientInvoice", sale(5));
    expect(db.stockMoves.filter((m) => m.source === "sale").map((m) => m.qty)).toEqual([5]);
    db = run(db, "deletePatientInvoice", { id: "ph1" });
    expect(db.stockMoves.some((m) => m.source === "sale")).toBe(false);
  });
});

describe("patient refunds", () => {
  function paidReceipt() {
    return run(base(), "savePatientInvoice", {
      id: "lab1",
      input: { date: "2026-11-15", patientName: "علي", department: "lab", items: [{ description: "صورة دم", qty: 1, unitPrice: 200, kind: "procedure" }, { description: "وظائف كبد", qty: 1, unitPrice: 300, kind: "consult" }], discount: 50, paymentMethod: "cash", doctorId: "dr-s" },
    }, desk);
  }

  it("prices a refund at what the patient paid for the line after the discount", () => {
    // Discount 50 on 500 → 90%: the 300 line was paid 270.
    const r = refundable(paidReceipt().patientInvoices[0]!, []);
    expect(r.lines[1]!.unitShare).toBe(270);
    expect(r.cashLeft).toBe(450);
  });

  it("pays back only after the finance manager approves, from the main treasury on the desk person's shift", () => {
    let db = paidReceipt();
    db = run(db, "requestRefund", { id: "rf1", input: { invoiceId: "lab1", date: "2026-11-16", lines: [{ index: 1, qty: 1 }], reason: "ألغى التحليل" } }, desk);
    expect(() => run(db, "payRefund", { id: "rf1", date: "2026-11-16", method: "cash" }, desk)).toThrow(/لم يُعتمد/);
    const before = boxBalance("main", db.transactions, db.transfers);
    db = run(db, "decideRefund", { id: "rf1", approve: true }, fin);
    db = run(db, "payRefund", { id: "rf1", date: "2026-11-16", method: "cash" }, desk);
    expect(boxBalance("main", db.transactions, db.transfers)).toBe(before - 270);
    expect(db.transactions.find((t) => t.source === "refund")).toMatchObject({ boxId: "main", shiftId: "sh1" });
    expect(db.refunds[0]!.status).toBe("paid");
  });

  it("reduces the department's revenue (not an expense) and the doctor's dues", () => {
    let db = paidReceipt();
    db = run(db, "requestRefund", { id: "rf1", input: { invoiceId: "lab1", date: "2026-11-16", lines: [{ index: 1, qty: 1 }], reason: "ألغى" } }, desk);
    db = run(db, "decideRefund", { id: "rf1", approve: true }, fin);
    db = run(db, "payRefund", { id: "rf1", date: "2026-11-16", method: "cash" }, desk);
    expect(expenseEntries(db.transactions).some((t) => t.source === "refund")).toBe(false);
    const lab = costCenters({ invoices: db.patientInvoices, supplierInvoices: [], transactions: db.transactions, assets: [] }, "2026-11").rows.find((r) => r.dept === "lab")!;
    expect(lab.revenue).toBe(450 - 270);
    const invs = db.patientInvoices.map((i) => netOfRefunds(i, db.refunds));
    expect(doctorDues(db.doctors[0]!, invs, [], "2026-11").consultBase).toBe(0);
    expect(balanced(db)).toBe(0);
  });

  it("never refunds more than the patient paid or the same line twice", () => {
    let db = paidReceipt();
    db = run(db, "requestRefund", { id: "rf1", input: { invoiceId: "lab1", date: "2026-11-16", lines: [{ index: 1, qty: 1 }], reason: "ألغى" } }, desk);
    expect(() => run(db, "requestRefund", { id: "rf2", input: { invoiceId: "lab1", date: "2026-11-16", lines: [{ index: 1, qty: 1 }], reason: "مرة تانية" } }, desk)).toThrow(/أكبر من المتاح/);
  });

  it("puts returned drugs back in stock", () => {
    let db = run(base(), "savePatientInvoice", { id: "ph1", input: { date: "2026-11-15", patientName: "منى", department: "pharmacy", items: [{ description: "بنادول", qty: 3, unitPrice: 50, stockItemId: "panadol" }], discount: 0, paymentMethod: "cash" } }, desk);
    db = run(db, "requestRefund", { id: "rf1", input: { invoiceId: "ph1", date: "2026-11-16", lines: [{ index: 0, qty: 1 }], reason: "علبة زيادة" } }, desk);
    db = run(db, "decideRefund", { id: "rf1", approve: true }, fin);
    db = run(db, "payRefund", { id: "rf1", date: "2026-11-16", method: "cash" }, desk);
    expect(db.stockMoves.find((m) => m.source === "return")).toMatchObject({ type: "in", qty: 1, unitCost: 30 });
    expect(pharmacySales(db.stockMoves, "2026-11")[0]).toMatchObject({ qty: 2, sales: 100, cost: 60, profit: 40 });
  });
});

describe("staff advances deducted from salary in installments", () => {
  function paidAdvance() {
    let db = base();
    db = run(db, "requestAdvance", { id: "a1", input: { date: "2026-11-05", employeeId: "e1", amount: 3000, months: 4, startPeriod: "2026-11", reason: "ظرف طارئ" } });
    db = run(db, "decideAdvance", { id: "a1", approve: true }, fin);
    db = run(db, "payAdvance", { id: "a1", date: "2026-11-05", boxId: "main", method: "cash" }, fin);
    return db;
  }

  it("needs approval and a finance manager to pay it", () => {
    let db = base();
    db = run(db, "requestAdvance", { id: "a1", input: { date: "2026-11-05", employeeId: "e1", amount: 3000, months: 4, startPeriod: "2026-11", reason: "ظرف" } });
    expect(() => run(db, "payAdvance", { id: "a1", date: "2026-11-05", boxId: "main", method: "cash" }, fin)).toThrow(/لم تُعتمد/);
    db = run(db, "decideAdvance", { id: "a1", approve: true }, fin);
    expect(() => run(db, "payAdvance", { id: "a1", date: "2026-11-05", boxId: "main", method: "cash" }, desk)).toThrow();
  });

  it("splits 3000 over 4 months as 750 each", () => {
    const a = paidAdvance().advances[0]!;
    expect(installmentOf(a)).toBe(750);
    expect(dueFor(a, "2026-10")).toBe(0);
    expect(dueFor(a, "2026-11")).toBe(750);
  });

  it("takes the installment from the month's salary when payroll is posted, and gives it back if unposted", () => {
    let db = paidAdvance();
    db = run(db, "postPayroll", { period: "2026-11", date: "2026-11-30", byDept: [{ department: "nursing", code: "NUR", net: 5000, label: "رواتب" }] }, fin);
    expect(db.transactions.find((t) => t.source === "payroll")!.amount).toBe(4250);
    expect(remainingOf(db.advances[0]!)).toBe(2250);
    expect(closing(db, "1700")).toBe(2250);
    expect(expenseEntries(db.transactions).some((t) => t.source === "advance")).toBe(false);
    expect(balanced(db)).toBe(0);
    db = run(db, "unpostPayroll", { period: "2026-11" }, fin);
    expect(remainingOf(db.advances[0]!)).toBe(3000);
  });
});
