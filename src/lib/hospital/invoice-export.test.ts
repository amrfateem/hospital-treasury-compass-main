import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES, deskOf, stayRates } from "./catalog";
import { emptyDB, normalizeDB, type Actor, type PatientInvoice } from "./model";
import { deskTotals, EMPTY_FILTERS, filterInvoices, invoicesCsv } from "./invoice-export";
import { runOp, OpError, type OpCtx } from "./ops";

const owner: Actor = { id: "u1", name: "المدير", role: "admin" };
const desk: Actor = { id: "u2", name: "منى", role: "reception" };
const blocked: Actor = { id: "u3", name: "سامح", role: "finance", perms: { billing: "none" } };
const ctx = (actor: Actor): OpCtx => ({ now: 5_000, today: "2026-11-15", actor });

const inv = (id: string, department: string, date: string, extra: Partial<PatientInvoice> = {}): PatientInvoice => ({
  id,
  number: `INV-${id}`,
  date,
  patientName: `مريض ${id}`,
  department,
  items: [{ description: "خدمة", qty: 1, unitPrice: 1000 }],
  discount: 0,
  paymentMethod: "cash",
  createdAt: Number(id.replace(/\D/g, "")) || 1,
  ...extra,
});

function sample() {
  const db = emptyDB();
  db.patientInvoices = [
    inv("1", "clinics", "2026-11-01"),
    inv("2", "lab", "2026-11-05", { payer: { payerId: "p1", percent: 80 } }),
    inv("3", "icu", "2026-11-10", {
      kind: "inpatient",
      items: [],
      stay: { admitDate: "2026-11-10", dischargeDate: "2026-11-13", roomRate: 2500, supervisionRate: 800 },
    }),
    inv("4", "radiology", "2026-10-30"),
    inv("5", "surgery", "2026-11-12"),
  ];
  return db;
}

describe("receipt sections and price catalog", () => {
  it("maps each desk to its department and anything else to other", () => {
    expect(deskOf("clinics").key).toBe("clinics");
    expect(deskOf("er").key).toBe("er");
    expect(deskOf("lab").key).toBe("lab");
    expect(deskOf("radiology").key).toBe("radiology");
    expect(deskOf("icu").key).toBe("icu");
    expect(deskOf("surgery").key).toBe("surgery");
    expect(deskOf("pharmacy").key).toBe("pharmacy");
    expect(deskOf("gsurgery").key).toBe("other");
  });

  it("every desk has a ready price list and ICU has daily room + supervision rates", () => {
    for (const d of ["clinics", "er", "lab", "radiology", "icu"])
      expect(DEFAULT_SERVICES.filter((s) => s.department === d).length).toBeGreaterThan(3);
    expect(stayRates(DEFAULT_SERVICES, "icu")).toEqual({ roomRate: 2500, supervisionRate: 800 });
  });

  it("an older save receives the catalog once; services deleted later stay deleted", () => {
    const old = normalizeDB({ transactions: [], lists: { services: [{ id: "mine", name: "كشف", price: 200 }] } });
    expect(old.lists.services).toHaveLength(DEFAULT_SERVICES.length + 1);
    const cleared = normalizeDB({ ...old, lists: { ...old.lists, services: [] } });
    expect(cleared.lists.services).toHaveLength(0);
  });
});

describe("invoice export desk", () => {
  it("filters by date range, sections and export status", () => {
    const db = sample();
    const f = { ...EMPTY_FILTERS, from: "2026-11-01", to: "2026-11-30" };
    expect(filterInvoices(db.patientInvoices, f, new Set()).map((i) => i.id)).toEqual(["1", "2", "3", "5"]);
    expect(filterInvoices(db.patientInvoices, { ...f, desks: ["lab", "icu"] }, new Set()).map((i) => i.id)).toEqual(["2", "3"]);
    expect(filterInvoices(db.patientInvoices, { ...f, desks: ["surgery"] }, new Set()).map((i) => i.id)).toEqual(["5"]);
    expect(filterInvoices(db.patientInvoices, { ...f, status: "new" }, new Set(["1"])).map((i) => i.id)).toEqual(["2", "3", "5"]);
  });

  it("totals per section include ICU stay days and the insurer split", () => {
    const { rows, grand } = deskTotals(sample().patientInvoices.filter((i) => i.date >= "2026-11-01"));
    const icu = rows.find((r) => r.key === "icu")!;
    expect(icu.total).toBe(3 * 2500 + 3 * 800);
    const lab = rows.find((r) => r.key === "lab")!;
    expect(lab.insurerShare).toBe(800);
    expect(lab.patientShare).toBe(200);
    expect(grand.count).toBe(4);
    expect(grand.total).toBe(1000 + 1000 + 9900 + 1000);
  });

  it("the Excel file opens Arabic correctly and ends with a total line", () => {
    const db = sample();
    const csv = invoicesCsv(db, db.patientInvoices.slice(0, 2));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain("2000");
  });

  it("logs each export with count and total recomputed from stored invoices", () => {
    const db = sample();
    const next = runOp(
      db,
      "logInvoiceExport",
      { id: "x1", format: "excel", from: "2026-11-01", to: "2026-11-30", filters: "", invoiceIds: ["1", "3", "ghost"] },
      ctx(desk),
    );
    expect(next.invoiceExports).toHaveLength(1);
    expect(next.invoiceExports[0]!.count).toBe(2);
    expect(next.invoiceExports[0]!.total).toBe(1000 + 9900);
    expect(next.invoiceExports[0]!.number).toBe("EXP-20261115-001");
  });

  it("refuses an empty export and anyone without access to billing", () => {
    const db = sample();
    const args = { id: "x", format: "excel" as const, from: "", to: "", filters: "", invoiceIds: ["1"] };
    expect(() => runOp(db, "logInvoiceExport", { ...args, invoiceIds: [] }, ctx(owner))).toThrow(OpError);
    expect(() => runOp(db, "logInvoiceExport", args, ctx(blocked))).toThrow(OpError);
  });
});
