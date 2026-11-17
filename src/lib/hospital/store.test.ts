import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES } from "./catalog";
import { DEFAULT_DEPARTMENTS } from "./constants";
import { emptyDB, normalizeDB, type HospitalDB, type PatientInvoice } from "./model";
import { canDeleteDepartment, resetDB, withPatientInvoice, withSupplierInvoice } from "./ops";

function sampleDB(): HospitalDB {
  const db = emptyDB();
  db.departments = [
    ...db.departments,
    { id: "plastic", name: "التجميل", code: "PLS", group: "medical", color: "c1", active: true },
  ];
  db.lists.services = [{ id: "s1", name: "كشف", price: 300 }];
  db.settings = { ...db.settings, address: "المنصورة" };
  db.employees = [
    {
      id: "e1",
      name: "أحمد",
      jobTitle: "فني",
      department: "lab",
      hireDate: "2024-01-01",
      fixedSalary: 5000,
      variableSalary: 0,
    },
  ];
  db.transactions = [
    {
      id: "t1",
      date: "2026-11-01",
      department: "general",
      kind: "in",
      description: "رصيد",
      amount: 1000,
      receiptId: "OPN",
      source: "opening",
      createdAt: 0,
    },
  ];
  db.payrollPostings = ["2026-10"];
  return db;
}

describe("تصفير النظام", () => {
  it("data reset empties every record but keeps departments, lists and settings", () => {
    const r = resetDB(sampleDB(), "data");
    expect(r.employees).toHaveLength(0);
    expect(r.transactions).toHaveLength(0);
    expect(r.payrollPostings).toHaveLength(0);
    expect(r.departments.some((d) => d.id === "plastic")).toBe(true);
    expect(r.lists.services).toHaveLength(1);
    expect(r.settings.address).toBe("المنصورة");
  });
  it("full reset also restores default departments, lists and settings", () => {
    const r = resetDB(sampleDB(), "everything");
    expect(r.departments).toHaveLength(DEFAULT_DEPARTMENTS.length);
    expect(r.lists.services).toHaveLength(DEFAULT_SERVICES.length);
    expect(r.settings.address).toBe("");
  });
  it("a fresh system starts with no records", () => {
    const db = emptyDB();
    expect(
      db.employees.length + db.transactions.length + db.patientInvoices.length + db.assets.length,
    ).toBe(0);
  });
});

describe("departments", () => {
  it("ships the full hospital structure", () => {
    expect(DEFAULT_DEPARTMENTS.length).toBeGreaterThanOrEqual(45);
    expect(new Set(DEFAULT_DEPARTMENTS.map((d) => d.id)).size).toBe(DEFAULT_DEPARTMENTS.length);
    expect(new Set(DEFAULT_DEPARTMENTS.map((d) => d.code)).size).toBe(DEFAULT_DEPARTMENTS.length);
  });
  it("a department with records cannot be deleted; an unused one can", () => {
    const db = sampleDB();
    expect(canDeleteDepartment(db, "lab")).toBe(false);
    expect(canDeleteDepartment(db, "plastic")).toBe(true);
  });
  it("general administration can never be deleted", () => {
    expect(canDeleteDepartment(emptyDB(), "general")).toBe(false);
  });
  it("old saves without departments get the default structure", () => {
    const db = normalizeDB({ transactions: [] } as Partial<HospitalDB>);
    expect(db.departments).toHaveLength(DEFAULT_DEPARTMENTS.length);
  });
});

describe("editing invoices keeps the treasury in sync", () => {
  const inv: PatientInvoice = {
    id: "i1",
    number: "INV-1",
    date: "2026-11-10",
    patientName: "منى",
    department: "lab",
    items: [{ description: "تحليل", qty: 1, unitPrice: 500 }],
    discount: 0,
    paymentMethod: "cash",
    createdAt: 1,
  };
  it("updating a patient invoice replaces its single treasury entry", () => {
    let db = withPatientInvoice(emptyDB(), inv);
    db = withPatientInvoice(db, {
      ...inv,
      items: [{ description: "تحليل", qty: 2, unitPrice: 500 }],
      discount: 100,
    });
    const txs = db.transactions.filter((t) => t.ref === "i1");
    expect(db.patientInvoices).toHaveLength(1);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.amount).toBe(900);
  });
  it("updating a supplier invoice updates the paid amount", () => {
    const sup = {
      id: "s1",
      number: "SUP-1",
      supplierInvoiceNo: "",
      date: "2026-11-10",
      supplierName: "النيل",
      department: "lab",
      category: "medical",
      description: "كواشف",
      subtotal: 1000,
      vatApplicable: true,
      whtType: "none" as const,
      createdAt: 1,
    };
    let db = withSupplierInvoice(emptyDB(), sup);
    db = withSupplierInvoice(db, { ...sup, subtotal: 2000 });
    const txs = db.transactions.filter((t) => t.ref === "s1");
    expect(txs).toHaveLength(1);
    expect(txs[0]!.amount).toBe(2280);
  });
});
