/**
 * Egyptian payroll calculations.
 * - Salaries tax (ضريبة كسب العمل) per Income Tax Law 91/2005 as amended by Law 7/2024.
 * - Social insurance (التأمينات الاجتماعية) per Law 148/2019 — employee share on the
 *   insurable wage, clamped to the yearly minimum / maximum.
 * All amounts are EGP. Rates and limits come from hospital settings so they can be updated yearly.
 */

export interface PayrollSettings {
  siEmployeeRate: number; // e.g. 0.11
  siEmployerRate: number; // e.g. 0.1875
  siMinWage: number; // minimum monthly insurable wage
  siMaxWage: number; // maximum monthly insurable wage
  personalExemption: number; // annual personal exemption (الإعفاء الشخصي)
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  siEmployeeRate: 0.11,
  siEmployerRate: 0.1875,
  siMinWage: 2700,
  siMaxWage: 16700,
  personalExemption: 20000,
};

/** Annual brackets on taxable income (after personal exemption). */
export const TAX_BRACKETS = [
  { upTo: 40_000, rate: 0 },
  { upTo: 55_000, rate: 0.1 },
  { upTo: 70_000, rate: 0.15 },
  { upTo: 200_000, rate: 0.2 },
  { upTo: 400_000, rate: 0.225 },
  { upTo: 1_200_000, rate: 0.25 },
  { upTo: Infinity, rate: 0.275 },
] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Annual salaries tax. Above 600k the lower brackets' benefit is removed in steps
 * (Law 7/2024): the first brackets are taxed at the rate of the bracket the step starts from.
 */
export function annualSalaryTax(taxable: number): number {
  if (taxable <= 0) return 0;
  let startIndex = 0;
  if (taxable > 1_200_000) startIndex = 5;
  else if (taxable > 900_000) startIndex = 4;
  else if (taxable > 800_000) startIndex = 3;
  else if (taxable > 700_000) startIndex = 2;
  else if (taxable > 600_000) startIndex = 1;

  let tax = 0;
  let prev = 0;
  const startRate = TAX_BRACKETS[startIndex]!.rate;
  for (let i = 0; i < TAX_BRACKETS.length; i++) {
    const b = TAX_BRACKETS[i]!;
    const top = Math.min(taxable, b.upTo);
    if (top > prev) {
      const rate = i < startIndex ? startRate : b.rate;
      tax += (top - prev) * rate;
    }
    if (taxable <= b.upTo) break;
    prev = b.upTo;
  }
  return round2(tax);
}

export interface PayrollLine {
  fixed: number;
  variable: number;
  gross: number;
  insurableWage: number;
  socialInsurance: number; // employee share
  employerInsurance: number; // employer share (cost, not deducted)
  annualTaxable: number;
  incomeTax: number; // monthly
  totalDeductions: number;
  net: number;
}

export function computeMonthlyPayroll(
  fixed: number,
  variable: number,
  s: PayrollSettings = DEFAULT_PAYROLL_SETTINGS,
): PayrollLine {
  const f = Math.max(0, fixed || 0);
  const v = Math.max(0, variable || 0);
  const gross = round2(f + v);
  const insurableWage = gross <= 0 ? 0 : Math.min(Math.max(gross, s.siMinWage), s.siMaxWage);
  const socialInsurance = round2(insurableWage * s.siEmployeeRate);
  const employerInsurance = round2(insurableWage * s.siEmployerRate);
  const annualTaxable = Math.max(0, round2((gross - socialInsurance) * 12 - s.personalExemption));
  const incomeTax = round2(annualSalaryTax(annualTaxable) / 12);
  const totalDeductions = round2(socialInsurance + incomeTax);
  const net = round2(gross - totalDeductions);
  return {
    fixed: f,
    variable: v,
    gross,
    insurableWage,
    socialInsurance,
    employerInsurance,
    annualTaxable,
    incomeTax,
    totalDeductions,
    net,
  };
}

/** Multiply a monthly line by the number of months worked (annual statement). */
export function scalePayroll(line: PayrollLine, months: number): PayrollLine {
  const m = (n: number) => round2(n * months);
  return {
    fixed: m(line.fixed),
    variable: m(line.variable),
    gross: m(line.gross),
    insurableWage: m(line.insurableWage),
    socialInsurance: m(line.socialInsurance),
    employerInsurance: m(line.employerInsurance),
    annualTaxable: line.annualTaxable,
    incomeTax: m(line.incomeTax),
    totalDeductions: m(line.totalDeductions),
    net: m(line.net),
  };
}

export function sumPayroll(lines: PayrollLine[]): PayrollLine {
  const keys: (keyof PayrollLine)[] = [
    "fixed",
    "variable",
    "gross",
    "insurableWage",
    "socialInsurance",
    "employerInsurance",
    "annualTaxable",
    "incomeTax",
    "totalDeductions",
    "net",
  ];
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as unknown as PayrollLine;
  for (const l of lines) for (const k of keys) out[k] = round2(out[k] + l[k]);
  return out;
}

/** Months an employee is on payroll within a calendar year (hire month counts). */
export function monthsEmployedInYear(hireDate: string, year: number): number {
  const [hy, hm] = hireDate.split("-").map(Number);
  if (!hy || hy > year) return 0;
  if (hy < year) return 12;
  return 12 - (hm || 1) + 1;
}

/** Whether an employee is on payroll for a given month ("YYYY-MM"). */
export function isEmployedInPeriod(hireDate: string, period: string): boolean {
  return hireDate.slice(0, 7) <= period;
}
