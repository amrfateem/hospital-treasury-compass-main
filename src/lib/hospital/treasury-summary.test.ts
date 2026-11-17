import { describe, expect, it } from "vitest";
import { emptyDB, type Actor, type HospitalDB } from "./model";
import { runOp, type OpCtx } from "./ops";
import { mainTreasurySummary } from "./treasury-summary";

const finance: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const mona: Actor = { id: "u-mona", name: "منى", role: "reception" };
const hala: Actor = { id: "u-hala", name: "د. هالة", role: "lab_manager" };
let clock = 1_000;
const ctx = (actor: Actor): OpCtx => ({ now: ++clock, today: "2026-11-16", actor });

const receipt = (department: string, amount: number, paymentMethod = "cash") => ({
  date: "2026-11-16",
  patientName: "مريض",
  department,
  items: [{ description: "خدمة", qty: 1, unitPrice: amount, kind: "procedure" as const }],
  discount: 0,
  paymentMethod,
});

/** Opening 1000 in the main treasury; Mona collects 300 + 200 (card), Hala 500 then is short 20. */
function day(): HospitalDB {
  let db = runOp(emptyDB(), "addTransaction", { id: "open", input: { date: "2026-11-01", department: "general", kind: "in", description: "رصيد", amount: 1000, source: "opening" } }, ctx(finance));
  db = runOp(db, "openShift", { id: "sm", openingFloat: 0 }, ctx(mona));
  db = runOp(db, "openShift", { id: "sh", openingFloat: 0 }, ctx(hala));
  db = runOp(db, "savePatientInvoice", { id: "i1", input: receipt("clinics", 300) }, ctx(mona));
  db = runOp(db, "savePatientInvoice", { id: "i2", input: receipt("clinics", 200, "card") }, ctx(mona));
  db = runOp(db, "savePatientInvoice", { id: "i3", input: receipt("lab", 500) }, ctx(hala));
  db = runOp(db, "closeShift", { shiftId: "sh", counted: { cash: 480 }, handover: "main" }, ctx(hala));
  return db;
}

describe("main treasury summary — who collected how much", () => {
  it("credits each receipt to the person whose shift took it", () => {
    const s = mainTreasurySummary(day(), { from: "2026-11-16", to: "2026-11-16" });
    const by = Object.fromEntries(s.collectors.map((r) => [r.name, r.collected]));
    expect(by).toEqual({ "د. هالة": 500, "منى": 500 });
    const mona = s.collectors.find((r) => r.name === "منى")!;
    expect(mona.count).toBe(2);
    expect(mona.byMethod).toEqual({ cash: 300, card: 200 });
  });

  it("puts a shift shortage on the person's name and in their net", () => {
    const s = mainTreasurySummary(day(), { from: "2026-11-16", to: "2026-11-16" });
    const hala = s.collectors.find((r) => r.name === "د. هالة")!;
    expect(hala.shortage).toBe(20);
    expect(hala.net).toBe(480);
    expect(hala.openShift).toBeUndefined();
    expect(s.collectors.find((r) => r.name === "منى")!.openShift?.id).toBe("sm");
  });

  it("does not count the opening balance as anyone's collection", () => {
    const s = mainTreasurySummary(day(), { from: "2026-11-01", to: "2026-11-30" });
    expect(s.collectors.reduce((t, r) => t + r.collected, 0)).toBe(1000);
  });

  it("balances: opening + in − out = closing = balance now", () => {
    const s = mainTreasurySummary(day(), { from: "2026-11-16", to: "2026-11-16" });
    expect(s.opening).toBe(1000);
    expect(s.periodIn).toBe(1000);
    expect(s.periodOut).toBe(20);
    expect(s.closing).toBe(1980);
    expect(s.balance).toBe(1980);
  });

  it("counts a petty spend as money paid out of the main treasury by whoever paid it", () => {
    const db = runOp(day(), "addPettyExpense", { id: "p1", input: { date: "2026-11-16", department: "general", category: "", description: "شاي", amount: 50 } }, ctx(finance));
    const s = mainTreasurySummary(db, { from: "2026-11-16", to: "2026-11-16" });
    expect(s.collectors.find((r) => r.name === "المدير المالي")!.paidOut).toBe(50);
    expect(s.balance).toBe(1930);
  });
});
