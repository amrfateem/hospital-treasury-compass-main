import { describe, expect, it } from "vitest";
import {
  boxBalance,
  costCenters,
  doctorDues,
  doctorStatement,
  invoiceAmounts,
  shiftDifferences,
  stayDays,
  stockStatus,
  supplierBalances,
  supplierStatement,
} from "./finance";
import { emptyDB, type Actor, type HospitalDB, type PatientInvoice } from "./model";
import { OpError, runOp, viewFor, type OpCtx } from "./ops";

const owner: Actor = { id: "u-admin", name: "المدير", role: "admin" };
const financeMgr: Actor = { id: "u-fin", name: "المدير المالي", role: "finance" };
const desk: Actor = { id: "u-desk", name: "منى", role: "reception" };
const ctx = (actor: Actor, now = 1_000): OpCtx => ({ now, today: "2026-11-14", actor });

const baseInvoice = {
  date: "2026-11-14",
  patientName: "محمد علي",
  department: "clinics",
  items: [{ description: "خدمة اختبار", qty: 1, unitPrice: 400, kind: "consult" as const }],
  discount: 0,
  paymentMethod: "cash",
};

describe("outpatient / inpatient invoices with insurance split", () => {
  it("counts a same-day admission as one day and nights otherwise", () => {
    expect(stayDays("2026-11-10", "2026-11-10")).toBe(1);
    expect(stayDays("2026-11-10", "2026-11-14")).toBe(4);
  });

  it("charges accommodation and supervision per day for inpatients", () => {
    const a = invoiceAmounts({
      items: [{ description: "عملية", qty: 1, unitPrice: 5000 }],
      discount: 0,
      kind: "inpatient",
      stay: {
        admitDate: "2026-11-10",
        dischargeDate: "2026-11-13",
        roomRate: 600,
        supervisionRate: 300,
      },
    });
    expect(a.days).toBe(3);
    expect(a.room).toBe(1800);
    expect(a.supervision).toBe(900);
    expect(a.total).toBe(7700);
  });

  it("splits the net between the insurer (80%) and the patient (20%)", () => {
    const a = invoiceAmounts({
      ...baseInvoice,
      discount: 100,
      payer: { payerId: "p1", percent: 80 },
    });
    expect(a.total).toBe(300);
    expect(a.insurerShare).toBe(240);
    expect(a.patientShare).toBe(60);
  });

  it("puts only the patient's share in the drawer, and the insurer's share when collected", () => {
    let db = emptyDB();
    db = runOp(db, "openShift", { id: "s1", openingFloat: 0 }, ctx(desk));
    db = runOp(
      db,
      "savePatientInvoice",
      { id: "i1", input: { ...baseInvoice, payer: { payerId: "p1", percent: 80 } } },
      ctx(desk),
    );
    const patientTx = db.transactions.filter((t) => t.ref === "i1");
    expect(patientTx.map((t) => t.amount)).toEqual([80]);
    expect(patientTx[0]!.shiftId).toBe("s1");
    db = runOp(
      db,
      "collectInsurer",
      { invoiceId: "i1", date: "2026-11-30", boxId: "main", method: "transfer" },
      ctx(owner),
    );
    expect(
      db.transactions
        .filter((t) => t.ref === "i1")
        .map((t) => t.amount)
        .sort(),
    ).toEqual([320, 80]);
    expect(() =>
      runOp(db, "collectInsurer", { invoiceId: "i1", date: "2026-12-01", boxId: "main", method: "cash" }, ctx(owner)),
    ).toThrow(OpError);
  });
});

describe("reception permissions (enforced by the same rules on the server)", () => {
  function deskWithInvoice(): HospitalDB {
    let db = emptyDB();
    db = runOp(db, "openShift", { id: "s1", openingFloat: 0 }, ctx(desk));
    return runOp(db, "savePatientInvoice", { id: "i1", input: baseInvoice }, ctx(desk));
  }

  it("refuses an invoice when the receptionist has no open shift", () => {
    expect(() =>
      runOp(emptyDB(), "savePatientInvoice", { id: "x", input: baseInvoice }, ctx(desk)),
    ).toThrow(OpError);
  });

  it("lets reception edit before printing but not after", () => {
    let db = deskWithInvoice();
    db = runOp(
      db,
      "savePatientInvoice",
      { id: "i1", input: { ...baseInvoice, discount: 50 } },
      ctx(desk),
    );
    expect(db.transactions.find((t) => t.ref === "i1")!.amount).toBe(350);
    db = runOp(db, "markInvoicePrinted", { id: "i1" }, ctx(desk));
    expect(() =>
      runOp(
        db,
        "savePatientInvoice",
        { id: "i1", input: { ...baseInvoice, discount: 0 } },
        ctx(desk),
      ),
    ).toThrow(OpError);
    expect(() => runOp(db, "deletePatientInvoice", { id: "i1" }, ctx(desk))).toThrow(OpError);
  });

  it("ignores a forged 'not printed' flag sent from the browser", () => {
    const db = runOp(deskWithInvoice(), "markInvoicePrinted", { id: "i1" }, ctx(desk));
    const forged = { ...baseInvoice, discount: 0, printedAt: undefined, unlocked: true };
    expect(() => runOp(db, "savePatientInvoice", { id: "i1", input: forged }, ctx(desk))).toThrow(
      OpError,
    );
  });

  it("allows exactly one edit after the finance manager approves the request", () => {
    let db = runOp(deskWithInvoice(), "markInvoicePrinted", { id: "i1" }, ctx(desk));
    db = runOp(
      db,
      "requestInvoiceChange",
      { id: "r1", invoiceId: "i1", action: "edit", reason: "خطأ في السعر" },
      ctx(desk),
    );
    expect(() => runOp(db, "decideInvoiceChange", { id: "r1", approve: true }, ctx(desk))).toThrow(
      OpError,
    );
    db = runOp(db, "decideInvoiceChange", { id: "r1", approve: true }, ctx(financeMgr));
    db = runOp(
      db,
      "savePatientInvoice",
      { id: "i1", input: { ...baseInvoice, discount: 20 } },
      ctx(desk),
    );
    expect(db.patientInvoices[0]!.unlocked).toBe(false);
    expect(() =>
      runOp(
        db,
        "savePatientInvoice",
        { id: "i1", input: { ...baseInvoice, discount: 30 } },
        ctx(desk),
      ),
    ).toThrow(OpError);
  });

  it("deletes a printed invoice only through an approved delete request", () => {
    let db = runOp(deskWithInvoice(), "markInvoicePrinted", { id: "i1" }, ctx(desk));
    db = runOp(
      db,
      "requestInvoiceChange",
      { id: "r1", invoiceId: "i1", action: "delete", reason: "مكرر" },
      ctx(desk),
    );
    db = runOp(db, "decideInvoiceChange", { id: "r1", approve: true }, ctx(financeMgr));
    expect(db.patientInvoices).toHaveLength(0);
    expect(db.transactions.filter((t) => t.ref === "i1")).toHaveLength(0);
  });

  it("blocks reception from manager-only operations", () => {
    expect(() =>
      runOp(
        emptyDB(),
        "addTransaction",
        {
          id: "t",
          input: {
            date: "2026-11-14",
            department: "general",
            kind: "out",
            description: "x",
            amount: 10,
            source: "manual",
          },
        },
        ctx(desk),
      ),
    ).toThrow(OpError);
    expect(() => runOp(emptyDB(), "resetSystem", { mode: "everything" }, ctx(desk))).toThrow(
      OpError,
    );
    // A receipt needs the person's own open shift on the main treasury.
    expect(() => runOp(emptyDB(), "savePatientInvoice", { id: "i", input: baseInvoice }, ctx(desk))).toThrow(OpError);
  });

  it("hides payroll and everyone else's treasury entries from reception — only their own shifts show", () => {
    const db = emptyDB();
    db.employees = [
      {
        id: "e",
        name: "x",
        jobTitle: "y",
        department: "lab",
        hireDate: "2024-01-01",
        fixedSalary: 9000,
        variableSalary: 0,
      },
    ];
    db.transactions = [
      {
        id: "a",
        date: "2026-11-01",
        department: "general",
        kind: "in",
        description: "",
        amount: 1,
        receiptId: "1",
        source: "manual",
        createdAt: 1,
        boxId: "main",
      },
      {
        id: "b",
        date: "2026-11-01",
        department: "general",
        kind: "in",
        description: "",
        amount: 1,
        receiptId: "2",
        source: "manual",
        createdAt: 1,
        boxId: "main",
        shiftId: "s-mine",
      },
    ];
    db.shifts = [
      { id: "s-mine", number: "1", boxId: "main", openedAt: 1, openedBy: "منى", openedById: "u-desk", openingFloat: 0 },
      { id: "s-other", number: "2", boxId: "main", openedAt: 1, openedBy: "سارة", openedById: "u-other", openingFloat: 0 },
    ];
    const v = viewFor(db, desk);
    expect(v.employees).toHaveLength(0);
    expect(v.transactions.map((t) => t.id)).toEqual(["b"]);
    expect(v.shifts.map((s) => s.id)).toEqual(["s-mine"]);
  });
});

describe("shift closing", () => {
  it("hands the float as custody, posts the shortage and returns the counted cash to main", () => {
    let db = emptyDB();
    db = runOp(db, "openShift", { id: "s1", openingFloat: 500 }, ctx(desk));
    db = runOp(db, "savePatientInvoice", { id: "i1", input: baseInvoice }, ctx(desk));
    db = runOp(
      db,
      "savePatientInvoice",
      { id: "i2", input: { ...baseInvoice, paymentMethod: "instapay" } },
      ctx(desk, 2_000),
    );
    db = runOp(
      db,
      "closeShift",
      { shiftId: "s1", counted: { cash: 850, instapay: 400 }, handover: "main" },
      ctx(desk),
    );
    const shift = db.shifts[0]!;
    expect(shift.expected).toEqual({ cash: 900, instapay: 400 });
    expect(shiftDifferences(shift.expected!, shift.counted!).diff).toBe(-50);
    expect(
      db.transactions.filter((t) => t.source === "shift").map((t) => [t.kind, t.amount]),
    ).toEqual([["out", 50]]);
    // Everything stays in the one main treasury: 800 collected − 50 shortage on her name.
    expect(db.shifts[0]!.handover).toBe("main");
    expect(boxBalance("main", db.transactions, db.transfers)).toBe(750);
  });
});

describe("doctors' dues", () => {
  it("adds salary, consultation %, surgery fee and supervision days, minus payouts", () => {
    const doctor = {
      id: "d1",
      monthlySalary: 3000,
      consultPercent: 30,
      surgeryFee: 1500,
      supervisionPerDay: 200,
    };
    const invoices = [
      { ...baseInvoice, doctorId: "d1" },
      {
        ...baseInvoice,
        doctorId: "d1",
        kind: "inpatient" as const,
        stay: {
          admitDate: "2026-11-01",
          dischargeDate: "2026-11-04",
          roomRate: 0,
          supervisionRate: 0,
        },
        items: [{ description: "عملية", qty: 2, unitPrice: 4000, kind: "surgery" as const }],
      },
      { ...baseInvoice, doctorId: "other" },
    ];
    const d = doctorDues(
      doctor,
      invoices,
      [{ doctorId: "d1", period: "2026-11", amount: 1000 }],
      "2026-11",
    );
    expect(d.consult).toBe(120);
    expect(d.surgery).toBe(3000);
    expect(d.supervision).toBe(600);
    expect(d.total).toBe(6720);
    expect(d.remaining).toBe(5720);
  });
});

describe("clinic doctors' percentage", () => {
  const items = [
    { description: "كشف", qty: 1, unitPrice: 300, kind: "consult" as const },
    { description: "سونار", qty: 1, unitPrice: 200, kind: "procedure" as const },
    { description: "دواء", qty: 2, unitPrice: 50, kind: "other" as const, stockItemId: "s1" },
  ];
  const rec = (id: string, doctorId: string, date: string) => ({ ...baseInvoice, id, number: id, patientName: "م", date, doctorId, items });
  const invoices = [rec("r2", "a", "2026-11-20"), rec("r1", "a", "2026-11-03"), rec("r3", "b", "2026-11-05"), rec("r4", "a", "2026-10-30")];
  const terms = { id: "a", monthlySalary: 0, consultPercent: 40, surgeryFee: 0, supervisionPerDay: 0 };

  it("takes the percentage from consultation lines only by default", () => {
    expect(doctorDues(terms, invoices, [], "2026-11").consult).toBe(240); // 40% × 300 × 2 receipts
  });

  it("can take the percentage from every service line except store items", () => {
    expect(doctorDues({ ...terms, percentOn: "all" }, invoices, [], "2026-11").consult).toBe(400); // 40% × 500 × 2
  });

  it("lists only that doctor's receipts of the month, oldest first, with each share", () => {
    const rows = doctorStatement(terms, invoices, "2026-11");
    expect(rows.map((r) => r.invoice.id)).toEqual(["r1", "r2"]);
    expect(rows[0]!.percent).toBe(120);
  });
});

describe("cost centers", () => {
  it("compares each department's revenue with its expenses and depreciation", () => {
    const r = costCenters(
      {
        invoices: [
          {
            ...baseInvoice,
            department: "lab",
            items: [{ description: "تحليل", qty: 1, unitPrice: 2000 }],
          },
          {
            ...baseInvoice,
            department: "radiology",
            items: [{ description: "أشعة", qty: 1, unitPrice: 500 }],
          },
        ],
        supplierInvoices: [
          {
            date: "2026-11-02",
            department: "radiology",
            subtotal: 1000,
            vatApplicable: true,
            whtType: "none",
          },
        ],
        transactions: [
          { date: "2026-11-30", department: "lab", kind: "out", amount: 600, source: "payroll" },
          { date: "2026-11-30", department: "lab", kind: "in", amount: 2000, source: "invoice" },
        ],
        assets: [
          {
            department: "lab",
            unitCost: 12000,
            quantity: 1,
            purchaseDate: "2026-01-01",
            usefulLifeYears: 1,
          },
        ],
      },
      "2026-11",
    );
    const lab = r.rows.find((x) => x.dept === "lab")!;
    expect(lab.revenue).toBe(2000);
    expect(lab.depreciation).toBe(1000);
    expect(lab.profit).toBe(400);
    expect(r.rows.find((x) => x.dept === "radiology")!.profit).toBe(-640);
    expect(r.mostProfitable?.dept).toBe("lab");
    expect(r.highestExpense?.dept).toBe("lab");
  });
});

describe("stock", () => {
  it("issues from the batch expiring first and raises reorder / expiry alerts", () => {
    const moves = [
      {
        itemId: "k",
        type: "in" as const,
        qty: 10,
        date: "2026-10-01",
        expiry: "2027-06-01",
        unitCost: 5,
      },
      {
        itemId: "k",
        type: "in" as const,
        qty: 10,
        date: "2026-10-05",
        expiry: "2026-12-01",
        unitCost: 5,
      },
      { itemId: "k", type: "out" as const, qty: 12, date: "2026-11-01" },
    ];
    const s = stockStatus({ id: "k", reorderLevel: 8 }, moves, "2026-11-14");
    expect(s.balance).toBe(8);
    expect(s.batches.map((b) => [b.expiry, b.remaining])).toEqual([["2027-06-01", 8]]);
    expect(s.belowReorder).toBe(true);
    expect(s.nearExpiryQty).toBe(0);
  });

  it("refuses issuing more than the balance", () => {
    let db = emptyDB();
    db = runOp(
      db,
      "saveStockItem",
      {
        id: "k",
        name: "سرنجة",
        unit: "قطعة",
        category: "sc1",
        department: "pharmacy",
        reorderLevel: 5,
        active: true,
      },
      ctx(owner),
    );
    db = runOp(
      db,
      "addStockMove",
      { id: "m1", itemId: "k", type: "in", qty: 3, date: "2026-11-01" },
      ctx(owner),
    );
    expect(() =>
      runOp(
        db,
        "addStockMove",
        { id: "m2", itemId: "k", type: "out", qty: 4, date: "2026-11-02" },
        ctx(owner),
      ),
    ).toThrow(OpError);
  });
});

describe("supplier accounts", () => {
  it("keeps credit invoices out of the treasury and tracks the balance due", () => {
    let db = emptyDB();
    const input = {
      supplierInvoiceNo: "77",
      date: "2026-11-01",
      supplierName: "شركة الدواء",
      department: "pharmacy",
      category: "medical",
      description: "أدوية",
      subtotal: 1000,
      vatApplicable: false,
      whtType: "supplies" as const,
      terms: "credit" as const,
    };
    db = runOp(db, "saveSupplierInvoice", { id: "si", input }, ctx(owner));
    expect(db.transactions).toHaveLength(0);
    db = runOp(
      db,
      "saveSupplierPayment",
      {
        id: "sp",
        input: {
          supplierName: "شركة الدواء",
          date: "2026-11-10",
          amount: 400,
          boxId: "main",
          method: "cash",
        },
      },
      ctx(owner),
    );
    const st = supplierStatement(db.supplierInvoices, db.supplierPayments, "شركة الدواء");
    expect(st.balance).toBe(590); // 1000 − 1% withholding − 400 paid
    expect(supplierBalances(db.supplierInvoices, db.supplierPayments)[0]!.balance).toBe(590);
    expect(db.transactions.map((t) => t.amount)).toEqual([400]);
  });

  it("lets only finance or the director delete a supplier payment", () => {
    let db = emptyDB();
    db = runOp(
      db,
      "saveSupplierPayment",
      { id: "sp", input: { supplierName: "شركة الدواء", date: "2026-11-10", amount: 400, boxId: "main", method: "cash" } },
      ctx(owner),
    );
    const clerk: Actor = { id: "u-c", name: "محاسب", role: "auditor", perms: { supplierAccounts: "edit" } };
    expect(() => runOp(db, "deleteSupplierPayment", { id: "sp" }, ctx(clerk))).toThrow(OpError);
    db = runOp(db, "deleteSupplierPayment", { id: "sp" }, ctx(financeMgr));
    expect(db.supplierPayments).toHaveLength(0);
    expect(db.transactions).toHaveLength(0);
  });
});

// Keeps the PatientInvoice type import meaningful for future invoice fixtures.
export type _Fixture = PatientInvoice;

describe("cost centers count every operating expense", () => {
  it("adds registered expenses, petty cash and paid payment orders to the department's costs", () => {
    const tx = (source: string, amount: number) => ({ date: "2026-11-10", department: "lab", kind: "out" as const, amount, source });
    const r = costCenters(
      { invoices: [], supplierInvoices: [], assets: [], transactions: [tx("expense", 300), tx("petty", 50), tx("payment-order", 1000), tx("supplier", 999)] },
      "2026-11",
    );
    expect(r.rows[0]).toMatchObject({ dept: "lab", other: 1350, expenses: 1350 });
  });
});
