import { describe, expect, it } from "vitest";
import { DEFAULT_DEPARTMENTS } from "./constants";
import { emptyDB, normalizeDB, type Actor, type HospitalDB } from "./model";
import { OpError, runOp, type OpCtx } from "./ops";
import { can, canApprove } from "./permissions";
import { DEFAULT_STOCK_ITEMS, STOCK_CATALOG_VERSION } from "./stock-catalog";
import { approvableCount } from "./approvals";

const director: Actor = { id: "u-dir", name: "المدير", role: "admin" };
const finance: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const finance2: Actor = { id: "u-fin2", name: "مدير مالي ٢", role: "finance" };
const auditor: Actor = { id: "u-aud", name: "مراجع", role: "auditor" };
/** A nurse given "view + add" on orders only (can request, cannot approve or change). */
const nurse: Actor = { id: "u-nurse", name: "رئيسة التمريض", role: "reception", perms: { orders: "add" } };
const storekeeper: Actor = { id: "u-store", name: "أمين المخزن", role: "reception", perms: { stock: "add" } };
const ctx = (actor: Actor, now = 1_000): OpCtx => ({ now, today: "2026-11-15", actor });

const payOrder = (id = "o1") => ({
  id,
  input: { date: "2026-11-15", beneficiary: "شركة الصيانة", department: "general", category: "maintenance", description: "صيانة مصعد", amount: 2500 },
});

describe("only the finance manager approves requests", () => {
  it("lets only a finance manager approve a nurse's payment order — not the director, auditor or the nurse", () => {
    const db = runOp(emptyDB(), "savePaymentOrder", payOrder(), ctx(nurse));
    expect(db.paymentOrders[0]).toMatchObject({ status: "pending", requestedRole: "reception" });
    for (const who of [nurse, auditor, director])
      expect(() => runOp(db, "decidePaymentOrder", { id: "o1", approve: true }, ctx(who))).toThrow(OpError);
    const ok = runOp(db, "decidePaymentOrder", { id: "o1", approve: true }, ctx(finance));
    expect(ok.paymentOrders[0]!.status).toBe("approved");
  });

  it("never lets the finance manager approve their own request; another finance manager or the director can", () => {
    const db = runOp(emptyDB(), "savePaymentOrder", payOrder(), ctx(finance));
    expect(() => runOp(db, "decidePaymentOrder", { id: "o1", approve: true }, ctx(finance))).toThrow(OpError);
    expect(runOp(db, "decidePaymentOrder", { id: "o1", approve: true }, ctx(finance2)).paymentOrders[0]!.status).toBe("approved");
    expect(runOp(db, "decidePaymentOrder", { id: "o1", approve: true }, ctx(director)).paymentOrders[0]!.status).toBe("approved");
  });

  it("does not give approval power to someone granted the approvals section who is not a finance manager", () => {
    const granted: Actor = { ...auditor, perms: { approvals: "edit" } };
    expect(can(granted, "approvals", "edit")).toBe(true);
    expect(canApprove(granted, { requestedRole: "reception", requestedById: "x" })).toBe(false);
  });

  it("requires finance approval before a department's store request leaves the store", () => {
    let db = emptyDB();
    db.stockItems = [{ id: "gz", name: "شاش", unit: "رول", category: "sc2", department: "nursing", reorderLevel: 5, active: true }];
    db = runOp(db, "addStockMove", { id: "m1", itemId: "gz", date: "2026-11-15", type: "in", qty: 20 }, ctx(finance));
    const req = { id: "is1", input: { date: "2026-11-15", department: "er", receiver: "تمريض الطوارئ", lines: [{ stockItemId: "gz", qty: 4 }] } };
    db = runOp(db, "saveIssueOrder", req, ctx(nurse));
    expect(db.issueOrders[0]!.status).toBe("pending");
    expect(() => runOp(db, "deliverIssueOrder", { id: "is1", date: "2026-11-15" }, ctx(storekeeper))).toThrow(OpError);
    expect(() => runOp(db, "decideIssueOrder", { id: "is1", approve: true }, ctx(director))).toThrow(OpError);
    db = runOp(db, "decideIssueOrder", { id: "is1", approve: true }, ctx(finance));
    db = runOp(db, "deliverIssueOrder", { id: "is1", date: "2026-11-15" }, ctx(storekeeper));
    expect(db.issueOrders[0]).toMatchObject({ status: "issued", issuedBy: "أمين المخزن" });
    expect(db.stockMoves.filter((m) => m.type === "out")).toEqual([expect.objectContaining({ itemId: "gz", qty: 4, department: "er" })]);
  });

  it("puts a store request back nowhere when it is rejected", () => {
    let db = emptyDB();
    const item = db.stockItems[0]!;
    db = runOp(db, "saveIssueOrder", { id: "is1", input: { date: "2026-11-15", department: "er", receiver: "س", lines: [{ stockItemId: item.id, qty: 1 }] } }, ctx(nurse));
    db = runOp(db, "decideIssueOrder", { id: "is1", approve: false, note: "غير مطلوب" }, ctx(finance));
    expect(db.issueOrders[0]!.status).toBe("rejected");
    expect(() => runOp(db, "deliverIssueOrder", { id: "is1", date: "2026-11-15" }, ctx(storekeeper))).toThrow(OpError);
  });

  it("requires finance approval for a receipt edit request", () => {
    let db: HospitalDB = emptyDB();
    db = runOp(db, "openShift", { id: "s1", openingFloat: 0 }, ctx({ ...nurse, perms: null }));
    db = runOp(db, "savePatientInvoice", { id: "i1", input: { date: "2026-11-15", patientName: "مريض", department: "er", items: [{ description: "كشف", qty: 1, unitPrice: 200 }], discount: 0, paymentMethod: "cash" } }, ctx({ ...nurse, perms: null }));
    db = runOp(db, "requestInvoiceChange", { id: "r1", invoiceId: "i1", action: "edit", reason: "خطأ" }, ctx({ ...nurse, perms: null }));
    expect(() => runOp(db, "decideInvoiceChange", { id: "r1", approve: true }, ctx(director))).toThrow(OpError);
    db = runOp(db, "decideInvoiceChange", { id: "r1", approve: true }, ctx(finance));
    expect(db.editRequests[0]!.status).toBe("approved");
  });
});

describe("a user cannot go beyond the permission the director set", () => {
  it("lets 'view + add' create a request but not change or delete it", () => {
    const db = runOp(emptyDB(), "savePaymentOrder", payOrder(), ctx(nurse));
    expect(() => runOp(db, "savePaymentOrder", { ...payOrder(), input: { ...payOrder().input, amount: 9000 } }, ctx(nurse))).toThrow(OpError);
    expect(() => runOp(db, "deletePaymentOrder", { id: "o1" }, ctx(nurse))).toThrow(OpError);
    const full: Actor = { ...nurse, perms: { orders: "edit" } };
    expect(runOp(db, "savePaymentOrder", { ...payOrder(), input: { ...payOrder().input, amount: 9000 } }, ctx(full)).paymentOrders[0]!.amount).toBe(9000);
  });

  it("refuses everything on a section set to view only or none", () => {
    const viewer: Actor = { ...nurse, perms: { orders: "view" } };
    expect(() => runOp(emptyDB(), "savePaymentOrder", payOrder(), ctx(viewer))).toThrow(OpError);
    const none: Actor = { ...nurse, perms: { orders: "none" } };
    expect(() => runOp(emptyDB(), "savePaymentOrder", payOrder(), ctx(none))).toThrow(OpError);
  });

  it("makes anyone except the finance manager or director spend through a payment order", () => {
    const spender: Actor = { ...auditor, perms: { expenses: "edit", treasury: "edit", stock: "edit" } };
    const exp = { date: "2026-11-15", department: "general", category: "operational", description: "كهرباء", amount: 500, boxId: "main", method: "cash" };
    expect(() => runOp(emptyDB(), "addExpense", { id: "e1", input: exp }, ctx(spender))).toThrow(OpError);
    expect(() => runOp(emptyDB(), "addTransaction", { id: "t1", input: { date: "2026-11-15", department: "general", kind: "out", description: "سحب", amount: 100, source: "manual" } }, ctx(spender))).toThrow(OpError);
    expect(runOp(emptyDB(), "addExpense", { id: "e1", input: exp }, ctx(finance)).transactions).toHaveLength(1);
  });
});

describe("general store catalog", () => {
  it("starts with consumables for every main department, all with unique ids and zero balance", () => {
    const db = emptyDB();
    const ids = new Set(db.stockItems.map((i) => i.id));
    expect(ids.size).toBe(db.stockItems.length);
    const depts = new Set(db.stockItems.map((i) => i.department));
    for (const d of ["pharmacy", "nursing", "er", "surgery", "icu", "lab", "radiology", "dialysis", "dental", "kitchen", "laundry", "housekeeping"])
      expect(depts.has(d)).toBe(true);
    const known = new Set(DEFAULT_DEPARTMENTS.map((d) => d.id));
    expect([...depts].every((d) => known.has(d))).toBe(true);
    const cats = new Set(db.lists.stockCategories.map((c) => c.id));
    expect(db.stockItems.every((i) => cats.has(i.category))).toBe(true);
    expect(db.stockMoves).toHaveLength(0);
  });

  it("adds the catalog once to an older save without duplicating its own items", () => {
    const own = { id: "my-item", name: "صنف خاص", unit: "قطعة", category: "sc1", department: "pharmacy", reorderLevel: 1, active: true };
    const older = normalizeDB({ transactions: [], stockItems: [own, { ...DEFAULT_STOCK_ITEMS[0]!, name: "اسم معدل" }], settings: { stockCatalogVersion: 0 } as never });
    expect(older.stockItems).toHaveLength(DEFAULT_STOCK_ITEMS.length + 1);
    expect(older.stockItems.find((i) => i.id === DEFAULT_STOCK_ITEMS[0]!.id)!.name).toBe("اسم معدل");
    expect(older.settings.stockCatalogVersion).toBe(STOCK_CATALOG_VERSION);
    const deleted = { ...older, stockItems: older.stockItems.filter((i) => i.id !== DEFAULT_STOCK_ITEMS[1]!.id) };
    expect(normalizeDB(deleted).stockItems.some((i) => i.id === DEFAULT_STOCK_ITEMS[1]!.id)).toBe(false);
  });
});

describe("department consumption report", () => {
  it("values each department's issues at the item's average purchase cost, per period", async () => {
    const { consumptionByDepartment } = await import("./store-report");
    const items = [{ id: "gz", name: "شاش", unit: "رول" }];
    const moves = [
      { id: "a", itemId: "gz", date: "2026-10-01", type: "in" as const, qty: 10, unitCost: 10, createdAt: 1 },
      { id: "b", itemId: "gz", date: "2026-10-02", type: "in" as const, qty: 10, unitCost: 20, createdAt: 2 },
      { id: "c", itemId: "gz", date: "2026-11-03", type: "out" as const, qty: 4, department: "er", createdAt: 3 },
      { id: "d", itemId: "gz", date: "2026-11-04", type: "out" as const, qty: 2, department: "icu", createdAt: 4 },
      { id: "e", itemId: "gz", date: "2026-10-20", type: "out" as const, qty: 5, department: "er", createdAt: 5 },
    ];
    const nov = consumptionByDepartment(items, moves, "2026-11");
    expect(nov.map((d) => [d.department, d.value])).toEqual([["er", 60], ["icu", 30]]);
    expect(consumptionByDepartment(items, moves, "all").find((d) => d.department === "er")!.items[0]!.qty).toBe(9);
  });
});

describe("petty cash is paid from the main treasury, after finance approval", () => {
  const cashier: Actor = { id: "u-petty", name: "أمين النثريات", role: "reception", perms: { pettyCash: "add" } };
  const spend = { date: "2026-11-15", department: "general", category: "", description: "شاي وسكر", amount: 150 };
  /** The main treasury holds 1000 (there is no separate petty box). */
  const funded = (): HospitalDB => ({
    ...emptyDB(),
    transactions: [
      { id: "open", date: "2026-11-01", department: "general", kind: "in", description: "رصيد افتتاحي", amount: 1000, receiptId: "OPEN-1", source: "opening", createdAt: 1, boxId: "main" },
    ],
  });

  it("blocks a staff member from spending petty cash directly", () => {
    expect(() => runOp(funded(), "addPettyExpense", { id: "p1", input: spend }, ctx(cashier))).toThrow(OpError);
  });

  it("has no separate petty box to top up — for anyone, the director included", () => {
    for (const who of [cashier, finance, director])
      expect(() => runOp(funded(), "topUpPetty", { id: "t2", date: "2026-11-15", amount: 500, from: "main" }, ctx(who))).toThrow(OpError);
  });

  it("takes a direct petty spend by the finance manager out of the main treasury", () => {
    const db = runOp(funded(), "addPettyExpense", { id: "p1", input: spend }, ctx(finance));
    expect(db.transactions.find((t) => t.id === "p1")).toMatchObject({ source: "petty", kind: "out", amount: 150, boxId: "main" });
  });

  it("pays a petty request only after the finance manager approves it", () => {
    let db = runOp(funded(), "requestPetty", { id: "r1", input: spend }, ctx(cashier));
    expect(db.pettyRequests[0]).toMatchObject({ status: "pending", amount: 150 });
    expect(() => runOp(db, "payPettyRequest", { id: "r1", date: "2026-11-15" }, ctx(cashier))).toThrow(OpError);
    expect(() => runOp(db, "decidePettyRequest", { id: "r1", approve: true }, ctx(director))).toThrow(OpError);
    db = runOp(db, "decidePettyRequest", { id: "r1", approve: true }, ctx(finance));
    db = runOp(db, "payPettyRequest", { id: "r1", date: "2026-11-15" }, ctx(cashier));
    expect(db.pettyRequests[0]!.status).toBe("paid");
    const out = db.transactions.filter((t) => t.source === "petty");
    expect(out).toEqual([expect.objectContaining({ amount: 150, boxId: "main", ref: "r1" })]);
  });

  it("never pays a rejected petty request and needs a reason to reject", () => {
    let db = runOp(funded(), "requestPetty", { id: "r1", input: spend }, ctx(cashier));
    expect(() => runOp(db, "decidePettyRequest", { id: "r1", approve: false }, ctx(finance))).toThrow(OpError);
    db = runOp(db, "decidePettyRequest", { id: "r1", approve: false, note: "غير ضروري" }, ctx(finance));
    expect(() => runOp(db, "payPettyRequest", { id: "r1", date: "2026-11-15" }, ctx(cashier))).toThrow(OpError);
  });

  it("refuses to pay an approved request bigger than the main treasury balance", () => {
    let db = runOp(funded(), "requestPetty", { id: "r1", input: { ...spend, amount: 1500 } }, ctx(cashier));
    db = runOp(db, "decidePettyRequest", { id: "r1", approve: true }, ctx(finance));
    expect(() => runOp(db, "payPettyRequest", { id: "r1", date: "2026-11-15" }, ctx(cashier))).toThrow(OpError);
  });

  it("does not let the finance manager approve their own petty request", () => {
    const db = runOp(funded(), "requestPetty", { id: "r1", input: spend }, ctx(finance));
    expect(() => runOp(db, "decidePettyRequest", { id: "r1", approve: true }, ctx(finance))).toThrow(OpError);
    expect(runOp(db, "decidePettyRequest", { id: "r1", approve: true }, ctx(director)).pettyRequests[0]!.status).toBe("approved");
  });

  it("counts waiting petty requests in the finance manager's approvals badge, not the requester's", () => {
    const db = runOp(funded(), "requestPetty", { id: "r1", input: spend }, ctx(cashier));
    expect(approvableCount(db, finance)).toBe(1);
    expect(approvableCount(db, cashier)).toBe(0);
    expect(approvableCount(db, director)).toBe(0);
  });
});

describe("other money-out screens follow the finance-manager rule", () => {
  const clerk: Actor = { id: "u-clerk", name: "موظف حسابات", role: "auditor", perms: { doctors: "edit", supplierAccounts: "edit", payroll: "edit", suppliers: "edit" } };

  it("lets only the finance manager or director pay a doctor, pay a supplier or post payroll", () => {
    let db = emptyDB();
    db = runOp(db, "saveDoctor", { id: "d1", name: "د. سامي", specialty: "باطنة", department: "internal", active: true, monthlySalary: 5000, consultPercent: 0, surgeryFee: 0, supervisionPerDay: 0 }, ctx(finance));
    const pay = { id: "dp1", doctorId: "d1", period: "2026-11", date: "2026-11-15", amount: 1000, boxId: "main" };
    expect(() => runOp(db, "payDoctor", pay, ctx(clerk))).toThrow(OpError);
    expect(runOp(db, "payDoctor", pay, ctx(finance)).doctorPayouts).toHaveLength(1);
    const sp = { id: "s1", input: { supplierName: "شركة الدواء", date: "2026-11-15", amount: 500, boxId: "main", method: "cash" } };
    expect(() => runOp(db, "saveSupplierPayment", sp, ctx(clerk))).toThrow(OpError);
    const payroll = { period: "2026-11", date: "2026-11-30", byDept: [{ department: "general", code: "A", net: 9000, label: "الإدارة" }] };
    expect(() => runOp(db, "postPayroll", payroll, ctx(clerk))).toThrow(OpError);
  });

  it("lets staff record a credit supplier invoice but not a cash one", () => {
    const inv = { date: "2026-11-15", supplierInvoiceNo: "77", supplierName: "شركة الدواء", department: "pharmacy", category: "supplies", description: "أدوية", subtotal: 1000, vatApplicable: false, whtType: "none" as const };
    expect(() => runOp(emptyDB(), "saveSupplierInvoice", { id: "i1", input: { ...inv, terms: "cash" as const } }, ctx(clerk))).toThrow(OpError);
    expect(runOp(emptyDB(), "saveSupplierInvoice", { id: "i1", input: { ...inv, terms: "credit" as const } }, ctx(clerk)).supplierInvoices).toHaveLength(1);
  });
});
