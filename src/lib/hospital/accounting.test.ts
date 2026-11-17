import { describe, expect, it } from "vitest";
import { emptyDB, type HospitalDB, type PatientInvoice, type SupplierInvoice } from "./model";
import { runOp, withPatientInvoice, withSupplierInvoice, type OpCtx } from "./ops";
import { accountLedger, balanceSheet, buildJournal, incomeStatement, trialBalance } from "./ledger";
import { eInvoiceTotals, etaDocument, netFromGross, validateEInvoice, type EInvoice } from "./eta";
import { autoMatch, parseStatementCsv, reconciliation, type BankStatement } from "./bank";
import { allocateSharedCosts } from "./finance";

const admin: OpCtx = { now: 1_000, today: "2026-11-15", actor: { id: "u1", name: "المدير", role: "admin" } };

function invoice(over: Partial<PatientInvoice> = {}): PatientInvoice {
  return {
    id: "p1",
    number: "INV-1",
    date: "2026-11-02",
    patientName: "مريض",
    department: "lab",
    items: [{ description: "تحليل", qty: 1, unitPrice: 1000 }],
    discount: 0,
    paymentMethod: "cash",
    createdAt: 1,
    boxId: "main",
    ...over,
  };
}
function supplier(over: Partial<SupplierInvoice> = {}): SupplierInvoice {
  return {
    id: "s1",
    number: "SUP-1",
    supplierInvoiceNo: "77",
    date: "2026-11-03",
    supplierName: "مورد",
    department: "lab",
    category: "medical",
    description: "كواشف",
    subtotal: 1000,
    vatApplicable: true,
    whtType: "supplies",
    createdAt: 2,
    terms: "credit",
    ...over,
  };
}
function sample(): HospitalDB {
  let db = emptyDB();
  db.lists.payers = [{ id: "ins", name: "شركة تأمين", percent: 40 }];
  db = withPatientInvoice(db, invoice({ payer: { payerId: "ins", percent: 40 } }));
  db = withSupplierInvoice(db, supplier());
  db.assets = [
    { id: "a1", name: "جهاز", department: "lab", category: "ac1", purchaseDate: "2026-09-10", unitCost: 12000, quantity: 1, usefulLifeYears: 1, condition: "good" },
  ];
  return db;
}

describe("general ledger", () => {
  it("every journal entry balances (debits = credits)", () => {
    for (const e of buildJournal(sample(), "2026-12-31")) {
      const d = e.lines.reduce((s, l) => s + l.debit, 0);
      const c = e.lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.round(d * 100)).toBe(Math.round(c * 100));
    }
  });

  it("a receipt with 40% insurance puts 600 in the drawer and 400 as insurer receivable", () => {
    const j = buildJournal(sample(), "2026-11-30");
    expect(accountLedger(j, "1100-main", "2026-11-01", "2026-11-30").closing).toBe(600);
    expect(accountLedger(j, "1300", "2026-11-01", "2026-11-30").closing).toBe(400);
  });

  it("a credit supplier invoice of 1000 + 14% VAT with 1% withholding owes the supplier 1130", () => {
    const j = buildJournal(sample(), "2026-11-30");
    expect(accountLedger(j, "2100", "2026-11-01", "2026-11-30").closing).toBe(1130);
    expect(accountLedger(j, "2200", "2026-11-01", "2026-11-30").closing).toBe(10);
    expect(accountLedger(j, "1400", "2026-11-01", "2026-11-30").closing).toBe(140);
  });

  it("income statement: revenue 1000, purchases 1000, one month of depreciation 1000", () => {
    const j = buildJournal(sample(), "2026-11-30");
    const r = incomeStatement(j, "2026-11-01", "2026-11-30");
    expect(r.totalRevenue).toBe(1000);
    expect(r.totalExpenses).toBe(2000);
    expect(r.net).toBe(-1000);
  });

  it("balance sheet balances and trial balance totals match", () => {
    const j = buildJournal(sample(), "2026-12-31");
    expect(balanceSheet(j, "2026-12-31").balanced).toBe(true);
    const tb = trialBalance(j, "2026-01-01", "2026-12-31");
    const d = tb.reduce((s, r) => s + r.closingDebit, 0);
    const c = tb.reduce((s, r) => s + r.closingCredit, 0);
    expect(Math.round(d * 100)).toBe(Math.round(c * 100));
  });
});

describe("e-invoicing", () => {
  const base: EInvoice = {
    id: "e1",
    number: "EINV-1",
    date: "2026-11-05",
    source: "insurer",
    refIds: [],
    department: "lab",
    receiver: { type: "B", id: "123456789", name: "شركة تأمين" },
    lines: [{ id: "l1", description: "خدمات طبية", itemCode: "EG-1-1", qty: 1, unitPrice: 1000, discount: 0, taxType: "exempt" }],
    whtType: "services",
    status: "draft",
    createdAt: 1,
  };
  const eta = { activityCode: "8610", branchId: "0", governate: "الدقهلية", regionCity: "المنصورة", street: "ش", buildingNumber: "1", defaultItemCode: "" };

  it("medical services are exempt; 3% withholding on a 1000 company invoice", () => {
    const t = eInvoiceTotals(base);
    expect(t.vat).toBe(0);
    expect(t.wht).toBe(30);
    expect(t.total).toBe(970);
  });

  it("a taxable 1140 receipt line splits into 1000 net + 140 VAT", () => {
    const unit = netFromGross(1140, "vat14");
    const t = eInvoiceTotals({ lines: [{ ...base.lines[0]!, unitPrice: unit, taxType: "vat14" }], whtType: "none" });
    expect(t.net).toBe(1000);
    expect(t.vat).toBe(140);
  });

  it("no withholding below 300 EGP", () => {
    expect(eInvoiceTotals({ ...base, lines: [{ ...base.lines[0]!, unitPrice: 299 }] }).wht).toBe(0);
  });

  it("ETA document totals add up and use V003 for exempt lines", () => {
    const doc = etaDocument(base, { taxId: "111222333", name: "المستشفى" }, eta);
    expect(doc.invoiceLines[0]!.taxableItems[0]!.subType).toBe("V003");
    expect(doc.totalAmount).toBe(970);
    expect(doc.taxTotals.find((t) => t.taxType === "T4")!.amount).toBe(30);
  });

  it("validation asks for a 9-digit tax number for companies", () => {
    const issues = validateEInvoice({ ...base, receiver: { ...base.receiver, id: "12" } }, { taxId: "111222333", name: "x" }, eta);
    expect(issues.some((i) => i.includes("٩ أرقام"))).toBe(true);
    expect(validateEInvoice(base, { taxId: "111222333", name: "x" }, eta)).toEqual([]);
  });

  it("a submitted e-invoice can no longer be edited", () => {
    let db = emptyDB();
    const { id: _i, number: _n, status: _s, createdAt: _c, ...input } = base;
    db = runOp(db, "saveEInvoice", { id: "e1", input }, admin);
    db = runOp(db, "setEInvoiceStatus", { id: "e1", status: "submitted", etaUuid: "ABC" }, admin);
    expect(() => runOp(db, "saveEInvoice", { id: "e1", input }, admin)).toThrow();
  });
});

describe("bank reconciliation", () => {
  it("reads Arabic CSV statements with debit / credit columns", () => {
    const csv = "التاريخ,البيان,المرجع,مدين,دائن,الرصيد\n05/11/2026,إيداع نقدي,TRF-1,,5000,15000\n06/11/2026,عمولة بنكية,,25,,14975";
    const r = parseStatementCsv(csv);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ date: "2026-11-05", amount: 5000, reference: "TRF-1" });
    expect(r.lines[1]!.amount).toBe(-25);
  });

  it("matches the same amount within 3 days, not beyond", () => {
    const lines = [
      { id: "b1", date: "2026-11-05", description: "deposit", amount: 5000 },
      { id: "b2", date: "2026-11-20", description: "x", amount: -300 },
    ];
    const book = [
      { id: "t1", kind: "tx" as const, date: "2026-11-03", amount: 5000, description: "", reference: "R1" },
      { id: "t2", kind: "tx" as const, date: "2026-11-10", amount: -300, description: "", reference: "R2" },
    ];
    const m = autoMatch(lines, book, new Set());
    expect(m.get("b1")).toBe("t1");
    expect(m.has("b2")).toBe(false);
  });

  it("reconciliation: book 10,000 + unrecorded 25 bank charge = bank 9,975", () => {
    const st: BankStatement = {
      id: "s", number: "BST-1", boxId: "bank1", from: "2026-11-01", to: "2026-11-30",
      openingBalance: 5000, closingBalance: 9975, importedAt: 0, importedBy: "x", status: "open",
      lines: [
        { id: "l1", date: "2026-11-05", description: "dep", amount: 5000, matched: ["t1"] },
        { id: "l2", date: "2026-11-06", description: "fee", amount: -25 },
      ],
    };
    const book = [
      { id: "t0", kind: "tx" as const, date: "2026-10-01", amount: 5000, description: "", reference: "" },
      { id: "t1", kind: "tx" as const, date: "2026-11-05", amount: 5000, description: "", reference: "" },
    ];
    const r = reconciliation(st, book, new Set());
    expect(r.bookBalance).toBe(10000);
    expect(r.bankDebits).toBe(25);
    expect(r.difference).toBe(0);
    expect(r.statementGap).toBe(0);
  });

  it("a bank charge recorded from the statement is matched, leaving no difference", () => {
    const st: BankStatement = {
      id: "s", number: "BST-2", boxId: "bank1", from: "2026-11-01", to: "2026-11-30",
      openingBalance: 0, closingBalance: 4975, importedAt: 0, importedBy: "x", status: "open",
      lines: [
        { id: "l1", date: "2026-11-05", description: "dep", amount: 5000, adjustmentTxId: "bnk-l1" },
        { id: "l2", date: "2026-11-06", description: "fee", amount: -25, adjustmentTxId: "bnk-l2" },
      ],
    };
    const book = [
      { id: "bnk-l1", kind: "tx" as const, date: "2026-11-05", amount: 5000, description: "", reference: "" },
      { id: "bnk-l2", kind: "tx" as const, date: "2026-11-06", amount: -25, description: "", reference: "" },
    ];
    const r = reconciliation(st, book, new Set());
    expect(r.depositsInTransit).toBe(0);
    expect(r.outstandingPayments).toBe(0);
    expect(r.unmatchedBook).toHaveLength(0);
    expect(r.difference).toBe(0);
  });
});

describe("analytic accounting", () => {
  it("spreads 1,000 of administration cost over clinics by revenue share (3:1)", () => {
    const r = allocateSharedCosts(
      [
        { dept: "admin", revenue: 0, expenses: 1000 },
        { dept: "lab", revenue: 3000, expenses: 1000 },
        { dept: "xray", revenue: 1000, expenses: 500 },
      ],
      new Set(["admin"]),
    );
    expect(r.rows.find((x) => x.dept === "lab")!.allocated).toBe(750);
    expect(r.rows.find((x) => x.dept === "xray")!.allocated).toBe(250);
    expect(r.rows.find((x) => x.dept === "lab")!.afterAllocation).toBe(1250);
  });
});
