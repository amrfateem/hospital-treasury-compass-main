import { describe, expect, it } from "vitest";
import { annualSalaryTax, computeMonthlyPayroll, monthsEmployedInYear } from "./payroll-tax";

describe("Egyptian salaries tax brackets (Law 7/2024)", () => {
  it("is zero up to 40,000 taxable", () => {
    expect(annualSalaryTax(40_000)).toBe(0);
  });
  it("taxes 40k–55k at 10% and 55k–70k at 15%", () => {
    expect(annualSalaryTax(55_000)).toBe(1_500);
    expect(annualSalaryTax(70_000)).toBe(3_750);
  });
  it("taxes 70k–200k at 20%", () => {
    expect(annualSalaryTax(100_000)).toBe(9_750);
  });
  it("removes the 0% bracket above 600k (first 55k at 10%)", () => {
    expect(annualSalaryTax(650_000)).toBe(141_250);
  });
  it("taxes everything up to 1.2M at 25% above 1.2M", () => {
    expect(annualSalaryTax(1_300_000)).toBe(1_200_000 * 0.25 + 100_000 * 0.275);
  });
});

describe("monthly payroll", () => {
  it("gross = fixed + variable, deducts 11% insurance and tax", () => {
    const p = computeMonthlyPayroll(7_000, 3_000);
    expect(p.gross).toBe(10_000);
    expect(p.socialInsurance).toBe(1_100);
    expect(p.incomeTax).toBe(592.5);
    expect(p.net).toBe(8_307.5);
  });
  it("uses the minimum insurable wage for low salaries", () => {
    expect(computeMonthlyPayroll(2_000, 0).socialInsurance).toBe(297);
  });
  it("caps insurance at the maximum insurable wage", () => {
    expect(computeMonthlyPayroll(40_000, 20_000).socialInsurance).toBe(1_837);
  });
  it("counts months on payroll from the hire month", () => {
    expect(monthsEmployedInYear("2026-04-15", 2026)).toBe(9);
    expect(monthsEmployedInYear("2020-01-01", 2026)).toBe(12);
    expect(monthsEmployedInYear("2027-01-01", 2026)).toBe(0);
  });
});
