import { describe, expect, it } from "vitest";
import { doctorAccount, doctorDay, doctorDues, doctorStatement } from "./finance";
import { buildJournal } from "./ledger";
import { emptyDB, ICU_BOX_ID, type Actor, type Doctor, type HospitalDB, type ServiceItem } from "./model";
import { OpError, runOp, type OpCtx } from "./ops";

const owner: Actor = { id: "u-admin", name: "المدير", role: "admin" };
const ctx = (now = 1_000, today = "2026-11-14"): OpCtx => ({ now, today, actor: owner });

const drA: Doctor = { id: "dA", name: "أحمد", specialty: "باطنة", department: "clinics", active: true, monthlySalary: 0, consultPercent: 40, surgeryFee: 0, supervisionPerDay: 0 };
const drB: Doctor = { id: "dB", name: "سارة", specialty: "طوارئ", department: "emergency", active: true, monthlySalary: 0, consultPercent: 0, surgeryFee: 0, supervisionPerDay: 0 };
const consult: ServiceItem = { id: "s-consult", name: "كشف باطنة", price: 300, department: "clinics", kind: "consult" };
const ecg: ServiceItem = { id: "s-ecg", name: "رسم قلب", price: 200, department: "clinics", kind: "procedure", doctorShare: { mode: "fixed", value: 50 } };
const stitch: ServiceItem = { id: "s-stitch", name: "خياطة جرح", price: 400, department: "clinics", kind: "procedure", doctorShare: { mode: "percent", value: 30 } };

function setup(): HospitalDB {
  let db = emptyDB();
  db = runOp(db, "saveDoctor", drA, ctx(1));
  db = runOp(db, "saveDoctor", drB, ctx(2));
  for (const [i, s] of [consult, ecg, stitch].entries()) db = runOp(db, "saveListItem", { key: "services", item: s }, ctx(3 + i));
  return db;
}

const receipt = (id: string, date: string, items: { description: string; qty: number; unitPrice: number; doctorId?: string }[], doctorId?: string) => ({
  id,
  input: { date, patientName: "مريض", department: "clinics", items, discount: 0, paymentMethod: "cash", ...(doctorId ? { doctorId } : {}) },
});

describe("doctors' share on interventions (ECG, stitching)", () => {
  it("gives the receipt's doctor a fixed 50 per ECG and 30% of stitching, on top of 40% of the consultation", () => {
    let db = setup();
    db = runOp(db, "savePatientInvoice", receipt("i1", "2026-11-14", [
      { description: "كشف باطنة", qty: 1, unitPrice: 300 },
      { description: "رسم قلب", qty: 2, unitPrice: 200 },
      { description: "خياطة جرح", qty: 1, unitPrice: 400 },
    ], "dA"), ctx(10));
    const d = doctorDues(drA, db.patientInvoices, [], "2026-11", db.lists.services);
    expect(d.consult).toBe(120); // 40% × 300
    expect(d.interventions).toBe(220); // 2 × 50 + 30% × 400
    expect(d.total).toBe(340);
  });

  it("credits an intervention to the doctor who asked for it, not the receipt's doctor", () => {
    let db = setup();
    db = runOp(db, "savePatientInvoice", receipt("i1", "2026-11-14", [
      { description: "كشف باطنة", qty: 1, unitPrice: 300 },
      { description: "خياطة جرح", qty: 1, unitPrice: 400, doctorId: "dB" },
    ], "dA"), ctx(10));
    expect(doctorDues(drA, db.patientInvoices, [], "2026-11", db.lists.services).interventions).toBe(0);
    expect(doctorDues(drB, db.patientInvoices, [], "2026-11", db.lists.services).interventions).toBe(120);
    expect(doctorStatement(drB, db.patientInvoices, "2026-11", db.lists.services)).toHaveLength(1);
  });

  it("uses the doctor's own rate for a service before the service's default share", () => {
    let db = setup();
    const special = { ...drA, serviceShares: [{ serviceId: "s-ecg", mode: "fixed" as const, value: 80 }] };
    db = runOp(db, "saveDoctor", special, ctx(9));
    db = runOp(db, "savePatientInvoice", receipt("i1", "2026-11-14", [{ description: "رسم قلب", qty: 1, unitPrice: 200 }], "dA"), ctx(10));
    expect(doctorDues(special, db.patientInvoices, [], "2026-11", db.lists.services).interventions).toBe(80);
  });

  it("refuses a receipt with an intervention that carries a share but no doctor", () => {
    const db = setup();
    expect(() => runOp(db, "savePatientInvoice", receipt("i1", "2026-11-14", [{ description: "رسم قلب", qty: 1, unitPrice: 200 }]), ctx(10))).toThrow(OpError);
  });

  it("keeps an old receipt's share when the service's rate changes later", () => {
    let db = setup();
    db = runOp(db, "savePatientInvoice", receipt("i1", "2026-11-14", [{ description: "رسم قلب", qty: 1, unitPrice: 200 }], "dA"), ctx(10));
    const cheaper: ServiceItem = { ...ecg, doctorShare: { mode: "fixed", value: 10 } };
    db = runOp(db, "saveListItem", { key: "services", item: cheaper }, ctx(11));
    expect(doctorDues(drA, db.patientInvoices, [], "2026-11", db.lists.services).interventions).toBe(50);
  });
});

describe("doctors' money is never lost", () => {
  it("carries an unpaid month forward as arrears", () => {
    let db = setup();
    db = runOp(db, "savePatientInvoice", receipt("i1", "2026-10-20", [{ description: "رسم قلب", qty: 1, unitPrice: 200 }], "dA"), ctx(10, "2026-10-20"));
    db = runOp(db, "savePatientInvoice", receipt("i2", "2026-11-05", [{ description: "رسم قلب", qty: 1, unitPrice: 200 }], "dA"), ctx(11, "2026-11-05"));
    const acc = doctorAccount(drA, db.patientInvoices, [], "2026-11", db.lists.services);
    expect(acc.arrears).toBe(50);
    expect(acc.balance).toBe(100);
    expect(acc.oldestUnpaid).toBe("2026-10");
  });

  it("refuses to pay a doctor more than is owed", () => {
    let db = setup();
    db = runOp(db, "savePatientInvoice", receipt("i1", "2026-11-14", [{ description: "رسم قلب", qty: 1, unitPrice: 200 }], "dA"), ctx(10));
    const pay = (amount: number) => ({ id: `p${amount}`, doctorId: "dA", period: "2026-11", date: "2026-11-14", amount, boxId: "main" });
    expect(() => runOp(db, "payDoctor", pay(51), ctx(20))).toThrow(OpError);
    expect(runOp(db, "payDoctor", pay(50), ctx(21)).doctorPayouts).toHaveLength(1);
  });

  it("books the share as owed to the doctor on the receipt day, and the payout clears it", () => {
    let db = setup();
    db = runOp(db, "savePatientInvoice", receipt("i1", "2026-11-14", [{ description: "خياطة جرح", qty: 1, unitPrice: 400 }], "dA"), ctx(10));
    const owed = (d: HospitalDB) =>
      buildJournal(d, "2026-12-31").flatMap((e) => e.lines).filter((l) => l.account === "2450-dA").reduce((s, l) => s + l.credit - l.debit, 0);
    expect(owed(db)).toBe(120);
    db = runOp(db, "payDoctor", { id: "p1", doctorId: "dA", period: "2026-11", date: "2026-11-30", amount: 120, boxId: "main" }, ctx(30));
    expect(owed(db)).toBe(0);
  });
});

describe("doctors' shares are paid at the end of each shift/day", () => {
  const accountant: Actor = { id: "u-acc", name: "المحاسب", role: "accountant" };
  const reception: Actor = { id: "u-rec", name: "الاستقبال", role: "reception" };
  const as = (actor: Actor, now: number, today = "2026-11-14"): OpCtx => ({ now, today, actor });
  const daily = (id: string, date: string, amount: number) => ({ id, doctorId: "dA", period: date.slice(0, 7), date, amount, boxId: "main" });

  function twoDays() {
    let db = setup();
    db = runOp(db, "savePatientInvoice", receipt("i1", "2026-11-13", [{ description: "رسم قلب", qty: 1, unitPrice: 200 }], "dA"), ctx(10, "2026-11-13"));
    db = runOp(db, "savePatientInvoice", receipt("i2", "2026-11-14", [{ description: "خياطة جرح", qty: 1, unitPrice: 400 }], "dA"), ctx(11));
    return db;
  }

  it("shows today's share and what is left from earlier days", () => {
    const db = twoDays();
    const d = doctorDay(drA, db.patientInvoices, db.doctorPayouts, "2026-11-14", db.lists.services);
    expect(d.today).toBe(120); // 30% × 400
    expect(d.earlier).toBe(50); // yesterday's ECG not paid yet
    expect(d.due).toBe(170);
  });

  it("lets the accountant pay the day's shares, never above what is due", () => {
    const db = twoDays();
    expect(() => runOp(db, "payDoctorDaily", daily("p1", "2026-11-14", 171), as(accountant, 20))).toThrow(OpError);
    const paid = runOp(db, "payDoctorDaily", daily("p2", "2026-11-14", 170), as(accountant, 21));
    expect(paid.doctorPayouts[0]?.kind).toBe("daily");
    expect(doctorDay(drA, paid.patientInvoices, paid.doctorPayouts, "2026-11-14", paid.lists.services).due).toBe(0);
    expect(doctorAccount(drA, paid.patientInvoices, paid.doctorPayouts, "2026-11", paid.lists.services).balance).toBe(0);
  });

  it("does not let reception pay doctors", () => {
    const db = twoDays();
    expect(() => runOp(db, "payDoctorDaily", daily("p1", "2026-11-14", 50), as(reception, 20))).toThrow(OpError);
  });

  it("refuses a doctor payout bigger than the cash in the treasury", () => {
    const db = twoDays(); // the cash went into the main treasury; the ICU treasury is empty
    expect(() => runOp(db, "payDoctorDaily", { ...daily("p1", "2026-11-14", 50), boxId: ICU_BOX_ID }, as(accountant, 20))).toThrow(OpError);
  });
});
