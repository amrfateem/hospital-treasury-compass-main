import { describe, expect, it } from "vitest";
import { buildJournal } from "./ledger";
import { boxBalance } from "./finance";
import { emptyDB, ICU_BOX_ID, MAIN_BOX_ID, type Actor, type HospitalDB } from "./model";
import { runOp, type OpCtx } from "./ops";
import { dayReport } from "./daily-closing";

const admin: Actor = { id: "u-admin", name: "المدير", role: "admin" };
const finance: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const icu: Actor = { id: "u-icu", name: "مسؤول العناية", role: "icu_manager" };
const lab: Actor = { id: "u-lab", name: "مسؤول المعمل", role: "lab_manager" };
const ctx = (actor: Actor, now = 1_000): OpCtx => ({ now, today: "2026-11-15", actor });

const invoice = (department: string, description: string, unitPrice: number, date = "2026-11-15") => ({
  date,
  patientName: "مريض اختبار",
  department,
  items: [{ description, qty: 1, unitPrice }],
  discount: 0,
  paymentMethod: "cash",
});

function funded(amount = 1000, boxId = MAIN_BOX_ID, date = "2026-11-01"): HospitalDB {
  return runOp(
    emptyDB(),
    "addTransaction",
    { id: `open-${boxId}`, input: { date, department: "general", kind: "in", description: "رصيد افتتاحي", amount, source: "opening", boxId } },
    ctx(admin),
  );
}

describe("two cash treasuries", () => {
  it("sends ICU receipts to the ICU box and other receipts to main", () => {
    let db = emptyDB();
    db = runOp(db, "openShift", { id: "s-icu", openingFloat: 0 }, ctx(icu));
    db = runOp(db, "savePatientInvoice", { id: "i-icu", input: invoice("icu", "إقامة عناية", 2500) }, ctx(icu));
    db = runOp(db, "openShift", { id: "s-lab", openingFloat: 0 }, ctx(lab));
    db = runOp(db, "savePatientInvoice", { id: "i-lab", input: invoice("lab", "تحليل", 100) }, ctx(lab));

    expect(db.patientInvoices.find((i) => i.id === "i-icu")!.boxId).toBe(ICU_BOX_ID);
    expect(db.patientInvoices.find((i) => i.id === "i-lab")!.boxId).toBe(MAIN_BOX_ID);
    expect(db.shifts.find((s) => s.id === "s-icu")!.boxId).toBe(ICU_BOX_ID);
    expect(db.shifts.find((s) => s.id === "s-lab")!.boxId).toBe(MAIN_BOX_ID);
  });

  it("lets the receipt pick main or ICU treasury freely, but never a bank for desk staff", () => {
    let db = emptyDB();
    db.cashboxes = [...db.cashboxes, { id: "bank-1", name: "بنك مصر", kind: "bank", active: true }];
    db = runOp(db, "openShift", { id: "s-lab", openingFloat: 0 }, ctx(lab));
    db = runOp(db, "savePatientInvoice", { id: "i-to-icu", input: { ...invoice("lab", "تحليل", 100), boxId: ICU_BOX_ID } }, ctx(lab));
    db = runOp(db, "savePatientInvoice", { id: "i-to-bank", input: { ...invoice("lab", "تحليل", 100), boxId: "bank-1" } }, ctx(lab));
    db = runOp(db, "openShift", { id: "s-icu", openingFloat: 0 }, ctx(icu));
    db = runOp(db, "savePatientInvoice", { id: "i-icu-main", input: { ...invoice("icu", "إقامة عناية", 2500), boxId: MAIN_BOX_ID } }, ctx(icu));

    expect(db.patientInvoices.find((i) => i.id === "i-to-icu")!.boxId).toBe(ICU_BOX_ID);
    expect(db.transactions.find((t) => t.ref === "i-to-icu")!.boxId).toBe(ICU_BOX_ID);
    expect(db.patientInvoices.find((i) => i.id === "i-to-bank")!.boxId).toBe(MAIN_BOX_ID);
    expect(db.patientInvoices.find((i) => i.id === "i-icu-main")!.boxId).toBe(MAIN_BOX_ID);
    expect(boxBalance(ICU_BOX_ID, db.transactions, db.transfers)).toBe(100);
  });

  it("locks a service price unless it is marked variable", () => {
    const db = emptyDB();
    db.lists.services = [
      { id: "fixed", name: "تحليل ثابت", price: 500, department: "lab" },
      { id: "variable", name: "تحليل متغير", price: 500, department: "lab", variablePrice: true },
    ];
    let next = runOp(db, "openShift", { id: "s-lab", openingFloat: 0 }, ctx(lab));
    next = runOp(next, "savePatientInvoice", { id: "i-fixed", input: invoice("lab", "تحليل ثابت", 999) }, ctx(lab));
    next = runOp(next, "savePatientInvoice", { id: "i-var", input: invoice("lab", "تحليل متغير", 999) }, ctx(lab));
    expect(next.patientInvoices.find((i) => i.id === "i-fixed")!.items[0]!.unitPrice).toBe(500);
    expect(next.patientInvoices.find((i) => i.id === "i-var")!.items[0]!.unitPrice).toBe(999);
  });

  it("records owner funding as ICU cash and equity, never as revenue", () => {
    const db = runOp(
      emptyDB(),
      "fundCashbox",
      { id: "f1", boxId: ICU_BOX_ID, date: "2026-11-10", amount: 1_000_000, note: "تشغيل" },
      ctx(admin),
    );
    const tx = db.transactions.find((t) => t.id === "f1")!;
    expect(tx).toMatchObject({ source: "owner-funding", boxId: ICU_BOX_ID, amount: 1_000_000 });
    expect(tx.shiftId).toBeUndefined();
    expect(tx.by).toBe("صاحب المستشفى");
    expect(boxBalance(ICU_BOX_ID, db.transactions, db.transfers)).toBe(1_000_000);

    const entry = buildJournal(db, "2026-11-30").find((e) => e.sourceId === "f1")!;
    expect(entry.lines.some((l) => l.account === "3300" && l.credit === 1_000_000)).toBe(true);
    expect(entry.lines.some((l) => l.account.startsWith("4"))).toBe(false);
  });

  it("refuses an expense larger than the chosen treasury balance", () => {
    const db = funded(200, ICU_BOX_ID);
    const own = { date: "2026-11-12", department: "icu", category: "operational", description: "مستلزمات", amount: 250, boxId: ICU_BOX_ID, method: "cash" };
    expect(() => runOp(db, "addExpense", { id: "e1", input: own }, ctx(finance))).toThrow(/رصيد/);
    const ok = runOp(db, "addExpense", { id: "e2", input: { ...own, amount: 150 } }, ctx(finance));
    expect(boxBalance(ICU_BOX_ID, ok.transactions, ok.transfers)).toBe(50);
  });

  it("locks a closed day only in its own treasury", () => {
    let db = emptyDB();
    for (const boxId of [MAIN_BOX_ID, ICU_BOX_ID])
      db = runOp(
        db,
        "addTransaction",
        {
          id: `open-${boxId}`,
          input: {
            date: boxId === MAIN_BOX_ID ? "2026-11-02" : "2026-11-01",
            department: "general",
            kind: "in",
            description: "رصيد افتتاحي",
            amount: 1000,
            source: "opening",
            boxId,
          },
        },
        ctx(admin),
      );
    db = runOp(db, "addTransaction", { id: "m1", input: { date: "2026-11-02", department: "general", kind: "in", description: "إيراد", amount: 100, source: "manual", boxId: MAIN_BOX_ID } }, ctx(finance));
    db = runOp(db, "closeCashDay", { id: "dc-main", date: "2026-11-02", boxId: MAIN_BOX_ID, counted: 1100 }, ctx(finance));
    expect(dayReport(db, "2026-11-02", ICU_BOX_ID).closing).toBe(1000);

    // ICU is still open on the same day.
    const icuSpend = { date: "2026-11-02", department: "icu", category: "operational", description: "مستلزمات", amount: 100, boxId: ICU_BOX_ID, method: "cash" };
    db = runOp(db, "addExpense", { id: "e-icu", input: icuSpend }, ctx(finance));
    expect(boxBalance(ICU_BOX_ID, db.transactions, db.transfers)).toBe(900);

    // A main-treasury entry on that closed day is refused.
    expect(() =>
      runOp(db, "addExpense", { id: "e-main", input: { ...icuSpend, boxId: MAIN_BOX_ID } }, ctx(finance)),
    ).toThrow(/مقفول/);
  });
});
