import { describe, expect, it } from "vitest";
import { emptyDB, type Actor } from "./model";
import { OpError, runOp, type OpCtx } from "./ops";
import { myRequests, unseenDecisions, waitingForMe } from "./notifications";
import { remainingAfterPayment } from "./finance";

const finance: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const director: Actor = { id: "u-dir", name: "المدير", role: "admin" };
const accountant: Actor = { id: "u-acc", name: "المحاسب", role: "reception", perms: { orders: "add" } };
const ctx = (actor: Actor, now = 1_000): OpCtx => ({ now, today: "2026-11-16", actor });
const order = {
  id: "o1",
  input: { date: "2026-11-16", beneficiary: "شركة الصيانة", department: "general", category: "maintenance", description: "صيانة مصعد", amount: 2500 },
};

describe("notifications: the finance manager finds the accountant's requests waiting for approval", () => {
  it("shows the accountant's payment order in the finance manager's list, not in the accountant's or director's", () => {
    const db = runOp(emptyDB(), "savePaymentOrder", order, ctx(accountant));
    expect(waitingForMe(db, finance).map((n) => [n.kind, n.id, n.amount])).toEqual([["payment", "o1", 2500]]);
    expect(waitingForMe(db, accountant)).toEqual([]);
    expect(waitingForMe(db, director)).toEqual([]);
  });

  it("leaves the list once approved and tells the accountant it was approved", () => {
    let db = runOp(emptyDB(), "savePaymentOrder", order, ctx(accountant));
    expect(myRequests(db, "u-acc", 5_000).waiting).toHaveLength(1);
    db = runOp(db, "decidePaymentOrder", { id: "o1", approve: true }, ctx(finance, 2_000));
    expect(waitingForMe(db, finance)).toEqual([]);
    const mine = myRequests(db, "u-acc", 5_000);
    expect(mine.waiting).toEqual([]);
    expect(mine.decided.map((n) => [n.status, n.decidedBy])).toEqual([["approved", "المدير المالي"]]);
    expect(unseenDecisions(mine.decided, 1_500)).toBe(1);
    expect(unseenDecisions(mine.decided, 2_500)).toBe(0);
  });

  it("tells the accountant about a rejection with its reason", () => {
    let db = runOp(emptyDB(), "savePaymentOrder", order, ctx(accountant));
    db = runOp(db, "decidePaymentOrder", { id: "o1", approve: false, note: "المبلغ كبير" }, ctx(finance, 2_000));
    expect(myRequests(db, "u-acc", 5_000).decided[0]).toMatchObject({ status: "rejected", note: "المبلغ كبير" });
  });

  it("the finance manager's own request waits for the director, never for himself", () => {
    const db = runOp(emptyDB(), "savePaymentOrder", order, ctx(finance));
    expect(waitingForMe(db, finance)).toEqual([]);
    expect(waitingForMe(db, director).map((n) => n.id)).toEqual(["o1"]);
  });
});

describe("receipt: remaining on the patient is calculated, not typed", () => {
  it("bill 300, paid 100 → 200 remaining", () => expect(remainingAfterPayment(300, 100)).toBe(200));
  it("paid in full → nothing remaining", () => expect(remainingAfterPayment(300, 300)).toBe(0));
  it("paid nothing → everything remaining", () => expect(remainingAfterPayment(300, 0)).toBe(300));
});

describe("contracts are signed on paper", () => {
  const withDraft = () => {
    let db = runOp(
      emptyDB(),
      "saveEmployeeFile",
      { id: "e1", base: { name: "سارة أحمد", jobTitle: "ممرضة", department: "icu", hireDate: "2026-01-01", nationalId: "29001010100015" }, personal: {} },
      ctx(director),
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
      ctx(director, 2_000),
    );
    return db;
  };
  it("records a pen signature without any scan and the contract becomes signed", () => {
    const db = runOp(withDraft(), "signContract", { id: "c1", via: "paper", signedAt: "2026-11-16" }, ctx(director, 3_000));
    expect(db.contracts[0]).toMatchObject({ status: "signed", signedVia: "paper", signedAt: "2026-11-16" });
  });
  it("refuses a signing date before the contract was written", () => {
    expect(() => runOp(withDraft(), "signContract", { id: "c1", via: "paper", signedAt: "2026-11-01" }, ctx(director, 3_000))).toThrow(OpError);
  });
});
