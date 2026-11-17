import { describe, expect, it } from "vitest";
import { closeBlocker, isYearClosed, yearsList } from "./fiscal";
import { emptyDB, type Actor, type HospitalDB } from "./model";
import { OpError, runOp, type OpCtx } from "./ops";

const owner: Actor = { id: "u-admin", name: "المدير", role: "admin" };
const financeMgr: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const desk: Actor = { id: "u-desk", name: "منى", role: "reception" };
const at = (actor: Actor, today: string, now = 1_000): OpCtx => ({ now, today, actor });

const receipt = (date: string, extra: Record<string, unknown> = {}) => ({
  date,
  patientName: "محمد علي",
  department: "clinics",
  items: [{ description: "كشف", qty: 1, unitPrice: 1000 }],
  discount: 0,
  paymentMethod: "cash",
  ...extra,
});

/** 2026 has one receipt (1000) and is closed on 2 January 2027 by the finance manager. */
function closed2026(): HospitalDB {
  let db = runOp(emptyDB(), "savePatientInvoice", { id: "inv26", input: receipt("2026-06-10") as never }, at(owner, "2026-06-10"));
  db = runOp(db, "closeFiscalYear", { year: 2026 }, at(financeMgr, "2027-01-02", 2_000));
  return db;
}

describe("fiscal year = 1 January to 31 December", () => {
  it("cannot be closed on 31 December 2026, only after it ends", () => {
    const db = runOp(emptyDB(), "savePatientInvoice", { id: "a", input: receipt("2026-03-01") as never }, at(owner, "2026-03-01"));
    expect(() => runOp(db, "closeFiscalYear", { year: 2026 }, at(financeMgr, "2026-12-31"))).toThrow(OpError);
    expect(runOp(db, "closeFiscalYear", { year: 2026 }, at(financeMgr, "2027-01-01")).fiscalYears[0]!.year).toBe(2026);
  });

  it("freezes the year's results: 1000 in, net 1000, main box 1000 on 31/12", () => {
    const f = closed2026().fiscalYears[0]!;
    expect(f.status).toBe("closed");
    expect(f.summary.totalIn).toBe(1000);
    expect(f.summary.net).toBe(1000);
    expect(f.summary.boxes.find((b) => b.boxId === "main")?.balance).toBe(1000);
  });

  it("only the finance manager or the director may close a year", () => {
    const db = runOp(emptyDB(), "savePatientInvoice", { id: "a", input: receipt("2026-03-01") as never }, at(owner, "2026-03-01"));
    expect(() => runOp(db, "closeFiscalYear", { year: 2026 }, at(desk, "2027-01-05"))).toThrow(OpError);
  });

  it("years close in order: 2027 cannot close while 2026 is open", () => {
    let db = runOp(emptyDB(), "savePatientInvoice", { id: "a", input: receipt("2026-03-01") as never }, at(owner, "2026-03-01"));
    db = runOp(db, "savePatientInvoice", { id: "b", input: receipt("2027-03-01") as never }, at(owner, "2027-03-01", 2_000));
    expect(closeBlocker(db, 2027, "2028-01-02")).toContain("2026");
  });

  it("after 31/12/2026 the list shows 2026 ended and 2027 open", () => {
    const db = runOp(emptyDB(), "savePatientInvoice", { id: "a", input: receipt("2026-03-01") as never }, at(owner, "2026-03-01"));
    expect(yearsList(db, "2027-01-03").map((y) => [y.year, y.state])).toEqual([
      [2027, "open"],
      [2026, "ended"],
    ]);
  });
});

describe("a closed year is read-only", () => {
  it("refuses a new receipt dated in 2026", () => {
    expect(() =>
      runOp(closed2026(), "savePatientInvoice", { id: "late", input: receipt("2026-12-30") as never }, at(owner, "2027-01-05", 3_000)),
    ).toThrow(/2026/);
  });

  it("refuses deleting or editing a 2026 receipt, even for the director", () => {
    const db = closed2026();
    expect(() => runOp(db, "deletePatientInvoice", { id: "inv26" }, at(owner, "2027-01-05", 3_000))).toThrow(OpError);
    expect(() =>
      runOp(db, "savePatientInvoice", { id: "inv26", input: receipt("2026-06-10", { discount: 100 }) as never }, at(owner, "2027-01-05", 3_000)),
    ).toThrow(OpError);
  });

  it("refuses moving a 2026 receipt into 2027", () => {
    expect(() =>
      runOp(closed2026(), "savePatientInvoice", { id: "inv26", input: receipt("2027-01-05") as never }, at(owner, "2027-01-05", 3_000)),
    ).toThrow(OpError);
  });

  it("still allows new 2027 work and reprinting old receipts", () => {
    let db = runOp(closed2026(), "savePatientInvoice", { id: "new", input: receipt("2027-01-05") as never }, at(owner, "2027-01-05", 3_000));
    db = runOp(db, "markInvoicePrinted", { id: "inv26" }, at(owner, "2027-01-05", 4_000));
    expect(db.patientInvoices).toHaveLength(2);
  });

  it("collecting a 2026 patient's remaining in 2027 is allowed and lands in 2027", () => {
    let db = runOp(
      emptyDB(),
      "savePatientInvoice",
      { id: "inv", input: receipt("2026-11-01", { patientId: "11111111-1111-4111-8111-111111111111", remaining: 400 }) as never },
      at(owner, "2026-11-01"),
    );
    db = runOp(db, "closeFiscalYear", { year: 2026 }, at(financeMgr, "2027-01-02", 2_000));
    db = runOp(
      db,
      "collectPatientRemaining",
      { id: "c1", patientId: "11111111-1111-4111-8111-111111111111", date: "2027-01-10", amount: 400, method: "cash" },
      at(owner, "2027-01-10", 3_000),
    );
    expect(db.transactions.find((t) => t.id === "c1")?.date).toBe("2027-01-10");
  });
});

describe("reopening", () => {
  it("only the director can reopen, with a reason; then 2026 can be edited again", () => {
    const db = closed2026();
    expect(() => runOp(db, "reopenFiscalYear", { year: 2026, reason: "تصحيح" }, at(financeMgr, "2027-01-05"))).toThrow(OpError);
    expect(() => runOp(db, "reopenFiscalYear", { year: 2026, reason: " " }, at(owner, "2027-01-05"))).toThrow(OpError);
    const open = runOp(db, "reopenFiscalYear", { year: 2026, reason: "فاتورة متأخرة" }, at(owner, "2027-01-05", 3_000));
    expect(isYearClosed(open, 2026)).toBe(false);
    const edited = runOp(open, "savePatientInvoice", { id: "late", input: receipt("2026-12-30") as never }, at(owner, "2027-01-05", 4_000));
    expect(edited.patientInvoices).toHaveLength(2);
  });
});
