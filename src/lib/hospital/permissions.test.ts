import { describe, expect, it } from "vitest";
import { emptyDB, type Actor, type HospitalDB } from "./model";
import { OpError, runOp, viewFor, type OpCtx } from "./ops";
import { can, cleanPermissions } from "./permissions";
import { expenseEntries } from "./expenses";
import { authErrorAr } from "./users.functions";

const director: Actor = { id: "u-dir", name: "المدير", role: "admin" };
const finance: Actor = { id: "u-fin", name: "أحمد", role: "finance" };
const finance2: Actor = { id: "u-fin2", name: "سارة", role: "finance" };
const desk: Actor = { id: "u-desk", name: "منى", role: "reception" };
const auditor: Actor = { id: "u-aud", name: "مراجع", role: "auditor" };
const ctx = (actor: Actor, now = 1_000): OpCtx => ({ now, today: "2026-11-15", actor });
/** Puts an opening balance in the one main treasury (petty cash is paid from it). */
const withCash = (amount: number, actor: Actor = director, now = 1_000) =>
  runOp(emptyDB(), "addTransaction", { id: "open", input: { date: "2026-11-01", department: "general", kind: "in", description: "رصيد افتتاحي", amount, source: "opening" } }, ctx(actor, now));

describe("section permissions set by the director", () => {
  it("gives each role its defaults and keeps the director's own powers", () => {
    expect(can(desk, "billing", "edit")).toBe(true);
    expect(can(desk, "expenses", "view")).toBe(false);
    expect(can(auditor, "treasury", "view")).toBe(true);
    expect(can(auditor, "treasury", "edit")).toBe(false);
    expect(can(auditor, "review", "edit")).toBe(true);
    expect(can({ ...finance, perms: { expenses: "none" } }, "system", "edit")).toBe(false);
    expect(can({ ...director, perms: { expenses: "none" } }, "expenses", "edit")).toBe(true);
  });

  it("never lets a custom setting grant the director-only system section", () => {
    expect(cleanPermissions({ system: "edit", expenses: "view", bogus: "edit" })).toEqual({ expenses: "view" });
  });

  it("refuses a change on a section the person may only view", () => {
    const viewer = { ...finance, perms: { expenses: "view" as const } };
    const input = { date: "2026-11-15", department: "general", category: "operational", description: "كهرباء", amount: 500, boxId: "main", method: "cash" };
    expect(() => runOp(emptyDB(), "addExpense", { id: "e1", input }, ctx(viewer))).toThrow(OpError);
    expect(runOp(emptyDB(), "addExpense", { id: "e1", input }, ctx(finance)).transactions).toHaveLength(1);
  });

  it("lets the director grant a receptionist an extra section", () => {
    const db = withCash(200);
    const input = { date: "2026-11-15", department: "general", category: "pc1", description: "شاي", amount: 50 };
    expect(() => runOp(db, "requestPetty", { id: "p1", input }, ctx(desk))).toThrow(OpError);
    const granted = { ...desk, perms: { pettyCash: "edit" as const } };
    expect(runOp(db, "requestPetty", { id: "p1", input }, ctx(granted)).pettyRequests).toHaveLength(1);
  });

  it("hides the audit trail from people without the review section", () => {
    const db = runOp(emptyDB(), "saveSettings", { ...emptyDB().settings, address: "x" }, ctx(director));
    expect(viewFor(db, auditor).auditLog).toHaveLength(1);
    expect(viewFor(db, desk).auditLog).toHaveLength(0);
  });
});

describe("audit log", () => {
  it("records who did each change", () => {
    const db = withCash(300, finance, 5);
    expect(db.auditLog).toHaveLength(1);
    expect(db.auditLog[0]).toMatchObject({ by: "أحمد", op: "addTransaction", section: "treasury", at: 5 });
    expect(db.auditLog[0]!.summary).toContain("300");
  });
});

describe("every money-out is an expense", () => {
  const funded = () => withCash(100);

  it("blocks petty cash spending beyond the main treasury balance", () => {
    const input = { date: "2026-11-15", department: "general", category: "pc1", description: "ضيافة", amount: 150 };
    expect(() => runOp(funded(), "addPettyExpense", { id: "p1", input }, ctx(finance))).toThrow(/رصيد الخزينة الرئيسية 100/);
  });

  it("records petty cash spending as an expense out of the main treasury, and the opening balance is not one", () => {
    const input = { date: "2026-11-15", department: "general", category: "pc1", description: "ضيافة", amount: 60 };
    const db = runOp(funded(), "addPettyExpense", { id: "p1", input }, ctx(finance));
    const exp = expenseEntries(db.transactions);
    expect(exp).toHaveLength(1);
    expect(exp[0]).toMatchObject({ source: "petty", amount: 60, boxId: "main", category: "pc1" });
  });

  it("pays a payment order only after someone else approves it, then records the expense", () => {
    let db: HospitalDB = runOp(
      emptyDB(),
      "savePaymentOrder",
      { id: "o1", input: { date: "2026-11-15", beneficiary: "شركة الصيانة", department: "general", category: "maintenance", description: "صيانة مصعد", amount: 2500 } },
      ctx(finance),
    );
    expect(() => runOp(db, "payPaymentOrder", { id: "o1", date: "2026-11-15", boxId: "main", method: "cash" }, ctx(finance))).toThrow(OpError);
    expect(() => runOp(db, "decidePaymentOrder", { id: "o1", approve: true }, ctx(finance))).toThrow(OpError);
    db = runOp(db, "decidePaymentOrder", { id: "o1", approve: true }, ctx(finance2));
    db = runOp(db, "payPaymentOrder", { id: "o1", date: "2026-11-16", boxId: "main", method: "cash" }, ctx(finance));
    expect(db.paymentOrders[0]!.status).toBe("paid");
    expect(expenseEntries(db.transactions)).toEqual([
      expect.objectContaining({ source: "payment-order", amount: 2500, category: "maintenance", paidTo: "شركة الصيانة" }),
    ]);
    db = runOp(db, "unpayPaymentOrder", { id: "o1" }, ctx(finance));
    expect(db.transactions).toHaveLength(0);
  });
});

describe("purchase orders and store issue orders", () => {
  const withItem = () => {
    const db = emptyDB();
    db.stockItems = [{ id: "gl", name: "جوانتي", unit: "علبة", category: "sc2", department: "pharmacy", reorderLevel: 5, active: true }];
    return db;
  };
  const order = (db: HospitalDB) => {
    db = runOp(
      db,
      "savePurchaseOrder",
      {
        id: "po1",
        input: {
          date: "2026-11-15",
          supplierName: "المتحدة للأدوية",
          department: "pharmacy",
          category: "medical",
          notes: "",
          lines: [{ id: "l1", stockItemId: "gl", description: "", qty: 10, unitPrice: 40 }],
        },
      },
      ctx(finance),
    );
    return runOp(db, "decidePurchaseOrder", { id: "po1", approve: true }, ctx(director));
  };

  it("cannot receive before approval or more than ordered", () => {
    const pending = runOp(
      withItem(),
      "savePurchaseOrder",
      { id: "po1", input: { date: "2026-11-15", supplierName: "س", department: "pharmacy", category: "medical", lines: [{ id: "l1", stockItemId: "gl", description: "", qty: 10, unitPrice: 40 }] } },
      ctx(finance),
    );
    const rcv = { poId: "po1", receiptId: "r1", date: "2026-11-16", payment: "none" as const, lines: [{ lineId: "l1", qty: 4 }] };
    expect(() => runOp(pending, "receivePurchaseOrder", rcv, ctx(finance))).toThrow(OpError);
    expect(() => runOp(order(withItem()), "receivePurchaseOrder", { ...rcv, lines: [{ lineId: "l1", qty: 11 }] }, ctx(finance))).toThrow(OpError);
  });

  it("adds received goods to the store and a credit invoice to the supplier", () => {
    let db = order(withItem());
    db = runOp(db, "receivePurchaseOrder", { poId: "po1", receiptId: "r1", date: "2026-11-16", payment: "credit", lines: [{ lineId: "l1", qty: 4, expiry: "2027-01-01" }] }, ctx(finance));
    expect(db.purchaseOrders[0]!.status).toBe("partial");
    expect(db.stockMoves).toEqual([expect.objectContaining({ itemId: "gl", type: "in", qty: 4, unitCost: 40 })]);
    expect(db.supplierInvoices[0]).toMatchObject({ subtotal: 160, terms: "credit" });
    expect(db.transactions).toHaveLength(0);
    db = runOp(db, "receivePurchaseOrder", { poId: "po1", receiptId: "r2", date: "2026-11-17", payment: "cash", boxId: "main", lines: [{ lineId: "l1", qty: 6 }] }, ctx(finance));
    expect(db.purchaseOrders[0]!.status).toBe("received");
    expect(expenseEntries(db.transactions)).toEqual([expect.objectContaining({ source: "supplier", amount: 240, category: "medical" })]);
  });

  it("issues to a department only after finance approval and only what is in stock; deleting returns it", () => {
    let db = order(withItem());
    db = runOp(db, "receivePurchaseOrder", { poId: "po1", receiptId: "r1", date: "2026-11-16", payment: "none", lines: [{ lineId: "l1", qty: 5 }] }, ctx(finance));
    const issue = (qty: number) => ({ id: "is1", input: { date: "2026-11-17", department: "er", receiver: "رئيس التمريض", lines: [{ stockItemId: "gl", qty }] } });
    db = runOp(db, "saveIssueOrder", issue(6), ctx(director));
    expect(db.stockMoves.filter((m) => m.type === "out")).toHaveLength(0);
    expect(() => runOp(db, "deliverIssueOrder", { id: "is1", date: "2026-11-17" }, ctx(finance))).toThrow(OpError);
    db = runOp(db, "decideIssueOrder", { id: "is1", approve: true }, ctx(finance));
    expect(() => runOp(db, "deliverIssueOrder", { id: "is1", date: "2026-11-17" }, ctx(finance))).toThrow(OpError);
    db = runOp(db, "saveIssueOrder", { id: "is2", input: issue(3).input }, ctx(director));
    db = runOp(db, "decideIssueOrder", { id: "is2", approve: true }, ctx(finance));
    db = runOp(db, "deliverIssueOrder", { id: "is2", date: "2026-11-17" }, ctx(finance));
    expect(db.stockMoves.filter((m) => m.type === "out")).toEqual([expect.objectContaining({ qty: 3, department: "er" })]);
    db = runOp(db, "deleteIssueOrder", { id: "is2" }, ctx(finance));
    expect(db.stockMoves.filter((m) => m.type === "out")).toHaveLength(0);
  });
});

describe("staff account errors are shown in Arabic", () => {
  it("translates the weak-password message", () => {
    expect(authErrorAr("Password is known to be weak and easy to guess, please choose a different one.", "x")).toContain("ضعيفة");
    expect(authErrorAr("something unexpected", "تعذّر إنشاء الحساب.")).toBe("تعذّر إنشاء الحساب.");
  });
});
