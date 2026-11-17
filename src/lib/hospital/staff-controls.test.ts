import { describe, expect, it } from "vitest";
import { controlAlerts, personSummary } from "./control";
import { emptyDB, type Actor, type HospitalDB } from "./model";
import { OpError, runOp, type OpCtx } from "./ops";
import { can } from "./permissions";

const director: Actor = { id: "u-dir", name: "المدير", role: "admin" };
const finance: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const accountant: Actor = { id: "u-acc", name: "كريم المحاسب", role: "accountant" };
const lab: Actor = { id: "u-lab", name: "د. هالة", role: "lab_manager" };
const ctx = (actor: Actor, now = 1_000, today = "2026-11-14"): OpCtx => ({ now, today, actor });

const receipt = {
  date: "2026-11-14",
  patientName: "محمد علي",
  department: "lab",
  items: [{ description: "خدمة اختبار", qty: 1, unitPrice: 400, kind: "procedure" as const }],
  discount: 0,
  paymentMethod: "cash",
};

/** The hospital: one main treasury plus a bank account. */
function withBank(): HospitalDB {
  const db = emptyDB();
  return { ...db, cashboxes: [...db.cashboxes, { id: "bank1", name: "بنك مصر", kind: "bank", active: true }] };
}

function labReceipt(): HospitalDB {
  let db = runOp(withBank(), "openShift", { id: "s1", openingFloat: 0 }, ctx(lab));
  db = runOp(db, "savePatientInvoice", { id: "i1", input: { ...receipt, boxId: "bank1" } }, ctx(lab, 1_100));
  return db;
}

describe("one main treasury — every desk person collects in their own shift", () => {
  it("puts a lab manager's receipt in the main treasury on their own shift, even if another box is sent", () => {
    const db = labReceipt();
    expect(db.patientInvoices[0]!.boxId).toBe("main");
    expect(db.transactions.find((t) => t.ref === "i1")).toMatchObject({ boxId: "main", shiftId: "s1", by: "د. هالة" });
  });

  it("refuses a desk receipt when the person has no open shift", () => {
    expect(() => runOp(withBank(), "savePatientInvoice", { id: "x1", input: receipt }, ctx(lab))).toThrow(OpError);
  });

  it("opens every shift on the main treasury, one open shift per person", () => {
    const db = labReceipt();
    expect(db.shifts[0]!.boxId).toBe("main");
    expect(() => runOp(db, "openShift", { id: "s2", openingFloat: 0 }, ctx(lab, 1_200))).toThrow(OpError);
  });

  it("lets the accountant record a receipt paid into a bank account", () => {
    const db = runOp(withBank(), "savePatientInvoice", { id: "a1", input: { ...receipt, boxId: "bank1" } }, ctx(accountant));
    expect(db.patientInvoices[0]!.boxId).toBe("bank1");
  });

  it("does not allow creating a drawer — only the main treasury and bank accounts exist", () => {
    expect(() => runOp(emptyDB(), "saveCashbox", { id: "lab", name: "درج المعمل", kind: "sub", active: true }, ctx(director))).toThrow(OpError);
  });
});

describe("cancelling a receipt needs approval", () => {
  it("refuses a direct cancel by the person who made it, even before printing", () => {
    expect(() => runOp(labReceipt(), "deletePatientInvoice", { id: "i1" }, ctx(lab, 1_200))).toThrow(OpError);
  });

  it("refuses a direct cancel by the accountant and the finance manager", () => {
    const db = runOp(withBank(), "savePatientInvoice", { id: "a1", input: receipt }, ctx(accountant));
    expect(() => runOp(db, "deletePatientInvoice", { id: "a1" }, ctx(accountant, 1_200))).toThrow(OpError);
    expect(() => runOp(db, "deletePatientInvoice", { id: "a1" }, ctx(finance, 1_200))).toThrow(OpError);
  });

  it("cancels only after the finance manager approves, and keeps who did what", () => {
    let db = runOp(labReceipt(), "requestInvoiceChange", { id: "r1", invoiceId: "i1", action: "delete", reason: "مكرر" }, ctx(lab, 1_200));
    expect(db.patientInvoices).toHaveLength(1);
    expect(() => runOp(db, "decideInvoiceChange", { id: "r1", approve: true }, ctx(accountant, 1_300))).toThrow(OpError);
    db = runOp(db, "decideInvoiceChange", { id: "r1", approve: true }, ctx(finance, 1_300));
    expect(db.patientInvoices).toHaveLength(0);
    const req = db.editRequests[0]!;
    expect(req.snapshot).toMatchObject({ paidNow: 400, createdBy: "د. هالة", boxId: "main" });
    expect(req.decidedBy).toBe("المدير المالي");
  });

  it("sends the finance manager's own cancel request to the director", () => {
    let db = runOp(withBank(), "savePatientInvoice", { id: "f1", input: receipt }, ctx(finance));
    db = runOp(db, "requestInvoiceChange", { id: "r2", invoiceId: "f1", action: "delete", reason: "خطأ" }, ctx(finance, 1_100));
    expect(() => runOp(db, "decideInvoiceChange", { id: "r2", approve: true }, ctx(finance, 1_200))).toThrow(OpError);
    db = runOp(db, "decideInvoiceChange", { id: "r2", approve: true }, ctx(director, 1_200));
    expect(db.patientInvoices).toHaveLength(0);
  });
});

describe("money out needs the finance manager", () => {
  it("lets the accountant raise a payment order but not approve it or pay an expense directly", () => {
    expect(can(accountant, "expenses", "add")).toBe(false);
    let db = runOp(
      emptyDB(),
      "savePaymentOrder",
      { id: "po1", input: { date: "2026-11-14", beneficiary: "شركة صيانة", department: "general", category: "maintenance", description: "صيانة تكييف", amount: 1500 } },
      ctx(accountant),
    );
    expect(db.paymentOrders[0]!.status).toBe("pending");
    expect(() => runOp(db, "decidePaymentOrder", { id: "po1", approve: true }, ctx(accountant, 1_100))).toThrow(OpError);
    db = runOp(db, "decidePaymentOrder", { id: "po1", approve: true }, ctx(finance, 1_100));
    expect(db.paymentOrders[0]!.status).toBe("approved");
  });
});

describe("personal discount limit", () => {
  const capped: Actor = { ...lab, controls: { maxDiscountPct: 10 } };
  it("refuses a 20% discount from someone limited to 10%", () => {
    const db = runOp(withBank(), "openShift", { id: "s1", openingFloat: 0 }, ctx(capped));
    expect(() => runOp(db, "savePatientInvoice", { id: "d1", input: { ...receipt, discount: 80 } }, ctx(capped, 1_100))).toThrow(OpError);
    const ok = runOp(db, "savePatientInvoice", { id: "d1", input: { ...receipt, discount: 40 } }, ctx(capped, 1_100));
    expect(ok.patientInvoices).toHaveLength(1);
  });
});

describe("money control alerts", () => {
  it("lists a cancelled receipt with its amount and maker, and counts it on the person", () => {
    let db = runOp(labReceipt(), "requestInvoiceChange", { id: "r1", invoiceId: "i1", action: "delete", reason: "مكرر" }, ctx(lab, 1_200));
    db = runOp(db, "decideInvoiceChange", { id: "r1", approve: true }, ctx(finance, 1_300));
    const alerts = controlAlerts(db, "1970-01-01", "2099-12-31", "2026-11-14");
    const c = alerts.find((a) => a.kind === "cancelled")!;
    expect(c.amount).toBe(400);
    expect(c.person).toBe("د. هالة");
    expect(personSummary(db, alerts, "1970-01-01", "2099-12-31").find((p) => p.person === "د. هالة")!.cancelled).toBe(400);
  });

  it("flags a shift closed short and a paid receipt never printed by the next day", () => {
    let db = labReceipt();
    db = runOp(db, "closeShift", { shiftId: "s1", counted: { cash: 300 }, handover: "next" }, ctx(lab, 2_000));
    const alerts = controlAlerts(db, "1970-01-01", "2099-12-31", "2026-11-15");
    expect(alerts.find((a) => a.kind === "shortage")!.amount).toBe(100);
    expect(alerts.find((a) => a.kind === "unprinted")!.amount).toBe(400);
  });

  it("flags a discount of 20% or more", () => {
    const db = runOp(withBank(), "savePatientInvoice", { id: "a1", input: { ...receipt, discount: 100 } }, ctx(accountant));
    expect(controlAlerts(db, "2026-11-01", "2026-11-30", "2026-11-14").some((a) => a.kind === "bigDiscount")).toBe(true);
  });
});
