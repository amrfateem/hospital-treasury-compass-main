import { describe, expect, it } from "vitest";
import {
  annualClosing,
  assetValuation,
  monthlyClosing,
  patientInvoiceTotals,
  supplierInvoiceTotals,
  type LedgerTx,
} from "./finance";

describe("supplier invoices", () => {
  it("adds 14% VAT", () => {
    expect(supplierInvoiceTotals(10_000, true, "none")).toMatchObject({
      vat: 1_400,
      total: 11_400,
      payable: 11_400,
    });
  });
  it("withholds 1% on supplies before VAT", () => {
    expect(supplierInvoiceTotals(10_000, true, "supplies")).toMatchObject({
      wht: 100,
      payable: 11_300,
    });
  });
  it("withholds 3% on services and 5% on professional fees", () => {
    expect(supplierInvoiceTotals(10_000, false, "services").wht).toBe(300);
    expect(supplierInvoiceTotals(10_000, false, "professional").wht).toBe(500);
  });
  it("does not withhold under 300 EGP", () => {
    expect(supplierInvoiceTotals(299, true, "supplies").wht).toBe(0);
  });
});

describe("patient invoices", () => {
  it("totals items and caps discount at subtotal", () => {
    expect(patientInvoiceTotals([{ description: "x", qty: 2, unitPrice: 500 }], 200)).toEqual({
      subtotal: 1000,
      discount: 200,
      total: 800,
    });
    expect(patientInvoiceTotals([{ description: "x", qty: 1, unitPrice: 100 }], 500).total).toBe(0);
  });
});

describe("assets", () => {
  it("depreciates straight-line by months used", () => {
    expect(assetValuation(120_000, 1, "2025-01-01", 5, "2026-01-01")).toMatchObject({
      depreciation: 24_000,
      bookValue: 96_000,
    });
  });
  it("never goes below zero", () => {
    expect(assetValuation(10_000, 2, "2010-01-01", 5, "2026-01-01").bookValue).toBe(0);
  });
});

describe("closing", () => {
  const tx = (
    date: string,
    department: LedgerTx["department"],
    kind: "in" | "out",
    amount: number,
    source = "manual",
  ): LedgerTx => ({
    id: date + amount,
    date,
    department,
    kind,
    amount,
    description: "",
    receiptId: "",
    source,
    createdAt: 0,
  });
  const txs = [
    tx("2026-11-01", "general", "in", 100_000, "opening"),
    tx("2026-11-02", "lab", "in", 5_000),
    tx("2026-11-03", "lab", "out", 2_000),
    tx("2026-12-01", "icu", "in", 7_000),
  ];
  it("monthly closing excludes the opening balance", () => {
    const m = monthlyClosing(txs, "2026-11");
    expect(m.totalIn).toBe(5_000);
    expect(m.net).toBe(3_000);
  });
  it("annual closing sums 12 months", () => {
    const a = annualClosing(txs, 2026);
    expect(a.net).toBe(10_000);
    expect(a.months[11]!.net).toBe(7_000);
  });
});
