import { describe, expect, it } from "vitest";
import { applyChunks, diffChunks, joinChunks, splitDB } from "./chunks";
import { pickChunks } from "./chunks.view";
import { boxBalance } from "./finance";
import { emptyDB, normalizeDB, type Actor, type HospitalDB } from "./model";
import { OpError, patientAccountId, runOp, type OpCtx } from "./ops";
import { patientMoney } from "./patient-money";

const owner: Actor = { id: "u-admin", name: "المدير", role: "admin" };
const financeMgr: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const desk: Actor = { id: "u-desk", name: "منى", role: "reception" };
const ctx = (actor: Actor, now = 1_000): OpCtx => ({ now, today: "2026-11-14", actor });
const PID = "11111111-1111-4111-8111-111111111111";

const receipt = (extra: Record<string, unknown> = {}) => ({
  date: "2026-11-14",
  patientName: "محمد علي",
  patientId: PID,
  patientMrn: "MRN-000001",
  department: "clinics",
  items: [{ description: "كشف استشاري", qty: 1, unitPrice: 1000 }],
  discount: 0,
  paymentMethod: "cash",
  ...extra,
});

function withReceipt(remaining: number, db: HospitalDB = emptyDB()) {
  return runOp(db, "savePatientInvoice", { id: "inv1", input: receipt({ remaining }) as never }, ctx(owner));
}

describe("remaining amount on a patient receipt", () => {
  it("keeps 300 of a 1000 receipt on the patient's file and takes 700 into the box now", () => {
    const db = withReceipt(300);
    const m = patientMoney(db, [PID])[PID]!;
    expect(m.billed).toBe(1000);
    expect(m.paidAtDesk).toBe(700);
    expect(m.remaining).toBe(300);
    expect(db.creditAccounts.find((a) => a.id === patientAccountId(PID))?.patientId).toBe(PID);
    expect(boxBalance("main", db.transactions, db.transfers)).toBe(700);
  });

  it("refuses a remaining amount larger than what the patient owes", () => {
    expect(() => withReceipt(1200)).toThrow(OpError);
  });

  it("collecting 200 later leaves 100 remaining", () => {
    let db = withReceipt(300);
    db = runOp(db, "collectPatientRemaining", { id: "c1", patientId: PID, date: "2026-11-15", amount: 200, method: "cash" }, ctx(owner, 2_000));
    expect(patientMoney(db, [PID])[PID]!.remaining).toBe(100);
    expect(() =>
      runOp(db, "collectPatientRemaining", { id: "c2", patientId: PID, date: "2026-11-15", amount: 150, method: "cash" }, ctx(owner, 3_000)),
    ).toThrow(OpError);
  });

  it("editing the receipt to remaining 0 clears what the patient owes", () => {
    let db = withReceipt(300);
    db = runOp(db, "savePatientInvoice", { id: "inv1", input: receipt({ remaining: 0 }) as never }, ctx(owner, 2_000));
    expect(patientMoney(db, [PID])[PID]!.remaining).toBe(0);
  });
});

describe("deleting a patient file needs the finance manager", () => {
  const request = (db: HospitalDB, actor: Actor) =>
    runOp(db, "requestPatientDelete", { id: "r1", patientId: PID, patientName: "محمد علي", patientMrn: "MRN-000001", reason: "ملف مكرر" }, ctx(actor));

  it("reception can only request; the finance manager approves", () => {
    let db = request(emptyDB(), desk);
    expect(db.patientDeleteRequests[0]!.status).toBe("pending");
    expect(() => runOp(db, "decidePatientDelete", { id: "r1", approve: true }, ctx(desk))).toThrow(OpError);
    db = runOp(db, "decidePatientDelete", { id: "r1", approve: true }, ctx(financeMgr, 2_000));
    expect(db.patientDeleteRequests[0]!.status).toBe("approved");
  });

  it("the director cannot approve a desk employee's request (finance manager only)", () => {
    const db = request(emptyDB(), desk);
    expect(() => runOp(db, "decidePatientDelete", { id: "r1", approve: true }, ctx(owner, 2_000))).toThrow(OpError);
  });

  it("a patient who still owes money cannot be deleted", () => {
    expect(() => request(withReceipt(300), owner)).toThrow(OpError);
  });
});

describe("signing a contract updates the employee for payroll", () => {
  it("takes job, department and salary from the signed contract", () => {
    let db = runOp(
      emptyDB(),
      "saveEmployeeFile",
      { id: "e1", base: { name: "سارة أحمد", jobTitle: "ممرضة", department: "icu", hireDate: "2026-01-01", nationalId: "29001010100015" }, personal: {} },
      ctx(owner),
    );
    db = runOp(
      db,
      "saveContract",
      {
        id: "c1",
        input: {
          employeeId: "e1", type: "fixed", date: "2026-11-14", startDate: "2026-11-15", endDate: "2027-11-14",
          probationMonths: 3, jobTitle: "رئيسة تمريض", department: "icu", basicSalary: 9000, allowances: 1500,
          dailyHours: 8, weeklyDays: 6, annualLeaveDays: 21, noticeDays: 60,
        },
      },
      ctx(owner, 2_000),
    );
    expect(db.contracts[0]!.status).toBe("draft");
    db = runOp(db, "signContract", { id: "c1", via: "paper", signedAt: "2026-11-15" }, ctx(owner, 3_000));
    const e = db.employees[0]!;
    expect(db.contracts[0]!.status).toBe("signed");
    expect(e.jobTitle).toBe("رئيسة تمريض");
    expect(e.fixedSalary).toBe(9000);
    expect(e.variableSalary).toBe(1500);
  });
});

describe("piece-by-piece storage", () => {
  it("split + join gives the same records back", () => {
    const db = withReceipt(300);
    const back = normalizeDB(joinChunks(splitDB(db)) as Partial<HospitalDB>);
    expect(back.patientInvoices).toEqual(db.patientInvoices);
    expect(back.transactions).toEqual(db.transactions);
    expect(back.creditAccounts).toEqual(db.creditAccounts);
    expect(back.auditLog).toEqual(db.auditLog);
  });

  it("a new receipt rewrites only this month's pieces, not older months or settings", () => {
    const old = runOp(emptyDB(), "savePatientInvoice", { id: "old", input: receipt({ date: "2020-03-02" }) as never }, ctx(owner));
    const next = runOp(old, "savePatientInvoice", { id: "new", input: receipt() as never }, ctx(owner, 5_000));
    const changed = Object.keys(diffChunks(old, next));
    expect(changed).toContain("patientInvoices@2026-11");
    expect(changed).not.toContain("patientInvoices@2020-03");
    expect(changed).not.toContain("settings");
    expect(changed).not.toContain("employees");
  });

  it("a device that applies the changed pieces ends with the same data", () => {
    const before = runOp(emptyDB(), "savePatientInvoice", { id: "a", input: receipt({ date: "2026-10-01" }) as never }, ctx(owner));
    const after = runOp(before, "savePatientInvoice", { id: "b", input: receipt({ remaining: 100 }) as never }, ctx(owner, 9_000));
    const keys = Object.keys(diffChunks(before, after));
    const device = normalizeDB(applyChunks(before, pickChunks(after, keys)) as Partial<HospitalDB>);
    expect(device.patientInvoices.map((i) => i.id).sort()).toEqual(["a", "b"]);
    expect(device.creditAccounts).toEqual(after.creditAccounts);
    expect(device.transactions.length).toBe(after.transactions.length);
  });
});
