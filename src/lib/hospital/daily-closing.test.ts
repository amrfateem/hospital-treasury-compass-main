import { describe, expect, it } from "vitest";
import { closeDayBlocker, dayReport, unclosedDays } from "./daily-closing";
import { emptyDB, type Actor, type HospitalDB } from "./model";
import { OpError, runOp, viewFor, type OpCtx } from "./ops";
import { allNotices } from "./notifications";

const director: Actor = { id: "u-dir", name: "المدير", role: "admin" };
const finance: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const finance2: Actor = { id: "u-fin2", name: "مدير مالي ٢", role: "finance" };
const accountant: Actor = { id: "u-acc", name: "المحاسب", role: "accountant" };
const mona: Actor = { id: "u-mona", name: "منى", role: "reception" };
let clock = 1_000;
const ctx = (actor: Actor, today = "2026-11-17"): OpCtx => ({ now: ++clock, today, actor });

const tx = (id: string, date: string, kind: "in" | "out", amount: number, method = "cash") => ({
  id,
  input: { date, department: "general", kind, description: "حركة", amount, source: "manual" as const, method },
});

/** 1000 opening on the 15th; on the 16th +500 cash, +200 card, −150 cash. */
function base(): HospitalDB {
  let db = runOp(emptyDB(), "addTransaction", { id: "o", input: { ...tx("o", "2026-11-15", "in", 1000).input, source: "opening" } }, ctx(finance));
  db = runOp(db, "addTransaction", tx("a", "2026-11-16", "in", 500), ctx(finance));
  db = runOp(db, "addTransaction", tx("b", "2026-11-16", "in", 200, "card"), ctx(finance));
  db = runOp(db, "addTransaction", tx("c", "2026-11-16", "out", 150), ctx(finance));
  return db;
}
const close = (db: HospitalDB, date: string, counted: number, by = accountant, note?: string) =>
  runOp(db, "closeCashDay", { id: `dc-${date}-${clock}`, date, counted, note }, ctx(by));

describe("daily closing — opening + in − out = closing", () => {
  it("adds up the day and separates cash from card", () => {
    const r = dayReport(base(), "2026-11-16");
    expect(r.opening).toBe(1000);
    expect(r.totalIn).toBe(700);
    expect(r.totalOut).toBe(150);
    expect(r.closing).toBe(1550);
    expect(r.expectedCash).toBe(1350);
    expect(r.nonCash).toBe(200);
    expect(r.entries).toHaveLength(3);
  });

  it("next day's opening equals the closed day's closing", () => {
    let db = close(base(), "2026-11-15", 1000);
    db = close(db, "2026-11-16", 1350);
    db = runOp(db, "addTransaction", tx("d", "2026-11-17", "in", 50), ctx(finance));
    const c16 = db.dailyClosings.find((c) => c.date === "2026-11-16")!;
    expect(dayReport(db, "2026-11-17").opening).toBe(c16.closing);
    expect(c16.difference).toBe(0);
  });
});

describe("daily closing — order and blockers", () => {
  it("days close in order", () => {
    expect(unclosedDays(base(), "2026-11-17")).toEqual(["2026-11-15", "2026-11-16"]);
    expect(() => close(base(), "2026-11-16", 1350)).toThrow(/اقفل يوم 2026-11-15 أولًا/);
  });

  it("a future day cannot be closed", () => {
    expect(closeDayBlocker(base(), "2026-11-18", "2026-11-17")).toMatch(/لم ينتهِ/);
  });

  it("an open shift with entries on that day blocks the closing", () => {
    let db = runOp(base(), "openShift", { id: "sm", openingFloat: 0 }, ctx(mona, "2026-11-15"));
    db = runOp(
      db,
      "savePatientInvoice",
      { id: "i1", input: { date: "2026-11-15", patientName: "مريض", department: "clinics", items: [{ description: "كشف", qty: 1, unitPrice: 100, kind: "consult" as const }], discount: 0, paymentMethod: "cash" } },
      ctx(mona, "2026-11-15"),
    );
    expect(() => close(db, "2026-11-15", 1100)).toThrow(/وردية منى/);
  });

  it("a cash difference needs a reason and is kept on the record", () => {
    const db = close(base(), "2026-11-15", 1000);
    expect(() => close(db, "2026-11-16", 1340)).toThrow(/عجز 10/);
    const ok = close(db, "2026-11-16", 1340, accountant, "ورقة ١٠ ناقصة");
    const rec = ok.dailyClosings.find((c) => c.date === "2026-11-16")!;
    expect(rec.difference).toBe(-10);
    expect(rec.counted).toBe(1340);
  });

  it("reception cannot close a day", () => {
    expect(() => close(base(), "2026-11-15", 1000, mona)).toThrow(OpError);
  });
});

describe("daily closing — a closed day is frozen", () => {
  const closed = () => close(close(base(), "2026-11-15", 1000), "2026-11-16", 1350);

  it("refuses new, edited or deleted treasury entries dated on or before the closed day", () => {
    const db = closed();
    expect(() => runOp(db, "addTransaction", tx("x", "2026-11-16", "in", 10), ctx(finance))).toThrow(/مقفول في الإقفال اليومي/);
    expect(() => runOp(db, "addTransaction", tx("x", "2026-11-10", "in", 10), ctx(finance))).toThrow(/مقفول/);
    expect(() => runOp(db, "deleteTransaction", { id: "a" }, ctx(finance))).toThrow(/مقفول/);
    expect(() => runOp(db, "addTransaction", tx("x", "2026-11-17", "in", 10), ctx(finance))).not.toThrow();
  });

  it("desk staff see which days are closed but not the totals", () => {
    const v = viewFor(closed(), mona);
    expect(v.dailyClosings.map((c) => c.date).sort()).toEqual(["2026-11-15", "2026-11-16"]);
    expect(v.dailyClosings.every((c) => c.closing === 0 && c.collectors.length === 0)).toBe(true);
  });
});

describe("daily closing — reopening needs the finance manager", () => {
  const closed = () => close(close(base(), "2026-11-15", 1000), "2026-11-16", 1350);
  const id16 = (db: HospitalDB) => db.dailyClosings.find((c) => c.date === "2026-11-16")!.id;

  it("accountant asks, finance manager approves, then the day can be corrected and closed again", () => {
    let db = runOp(closed(), "requestDayReopen", { date: "2026-11-16", reason: "مصروف متسجل غلط" }, ctx(accountant));
    expect(allNotices(db).find((n) => n.kind === "dayReopen")?.status).toBe("pending");
    // Still locked while waiting.
    expect(() => runOp(db, "deleteTransaction", { id: "c" }, ctx(finance))).toThrow(/مقفول/);
    expect(() => runOp(db, "decideDayReopen", { id: id16(db), approve: true }, ctx(accountant))).toThrow(OpError);
    db = runOp(db, "decideDayReopen", { id: id16(db), approve: true }, ctx(finance));
    db = runOp(db, "deleteTransaction", { id: "c" }, ctx(finance));
    db = close(db, "2026-11-16", 1500);
    const recs = db.dailyClosings.filter((c) => c.date === "2026-11-16");
    expect(recs.map((c) => c.status).sort()).toEqual(["closed", "reopened"]);
    expect(recs.find((c) => c.status === "closed")!.closing).toBe(1700);
  });

  it("a rejected request leaves the day closed", () => {
    let db = runOp(closed(), "requestDayReopen", { date: "2026-11-16", reason: "سبب" }, ctx(accountant));
    db = runOp(db, "decideDayReopen", { id: id16(db), approve: false }, ctx(finance));
    expect(() => runOp(db, "deleteTransaction", { id: "c" }, ctx(finance))).toThrow(/مقفول/);
  });

  it("the finance manager cannot approve their own request; another finance manager or the director can", () => {
    const db = runOp(closed(), "requestDayReopen", { date: "2026-11-16", reason: "سبب" }, ctx(finance));
    expect(() => runOp(db, "decideDayReopen", { id: id16(db), approve: true }, ctx(finance))).toThrow(/بنفسك/);
    expect(() => runOp(db, "decideDayReopen", { id: id16(db), approve: true }, ctx(finance2))).not.toThrow();
    expect(() => runOp(db, "decideDayReopen", { id: id16(db), approve: true }, ctx(director))).not.toThrow();
  });

  it("the director reopens directly", () => {
    const db = runOp(closed(), "requestDayReopen", { date: "2026-11-16", reason: "تصحيح" }, ctx(director));
    expect(db.dailyClosings.find((c) => c.date === "2026-11-16")!.status).toBe("reopened");
  });

  it("only the latest closed day can be reopened", () => {
    expect(() => runOp(closed(), "requestDayReopen", { date: "2026-11-15", reason: "سبب" }, ctx(director))).toThrow(/الأحدث أولًا/);
  });
});
