/**
 * Hospital profit management (إدارة أرباح المستشفى): the yearly distribution policy —
 * statutory/legal reserve, provision for income tax and partners' shares — applied to the net
 * profit from the journal. Pure (covered by profits.test.ts).
 */

export interface ProfitPartner {
  name: string;
  /** Share of the distributable profit (%). */
  pct: number;
}

export interface ProfitPolicy {
  year: number;
  /** Reserve kept in the hospital before distribution (% of net profit after tax). */
  reservePct: number;
  /** Income-tax provision (% of net profit before tax). */
  taxPct: number;
  partners: ProfitPartner[];
  notes?: string | undefined;
  updatedAt: number;
  by?: string | undefined;
}

export const DEFAULT_PROFIT_POLICY = (year: number): ProfitPolicy => ({
  year,
  reservePct: 5,
  taxPct: 22.5,
  partners: [{ name: "صاحب المستشفى", pct: 100 }],
  updatedAt: 0,
});

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ProfitDistribution {
  netBeforeTax: number;
  tax: number;
  netAfterTax: number;
  reserve: number;
  distributable: number;
  partners: { name: string; pct: number; amount: number }[];
  /** Part of the distributable profit not given to any partner (shares under 100%). */
  retained: number;
}

/** Splits a net profit by the policy. A loss is never taxed or distributed. */
export function distributeProfit(netBeforeTax: number, policy: Pick<ProfitPolicy, "reservePct" | "taxPct" | "partners">): ProfitDistribution {
  const base = r2(netBeforeTax);
  if (base <= 0)
    return { netBeforeTax: base, tax: 0, netAfterTax: base, reserve: 0, distributable: 0, partners: policy.partners.map((p) => ({ ...p, amount: 0 })), retained: 0 };
  const tax = r2((base * Math.max(0, policy.taxPct)) / 100);
  const netAfterTax = r2(base - tax);
  const reserve = r2((netAfterTax * Math.max(0, policy.reservePct)) / 100);
  const distributable = r2(netAfterTax - reserve);
  const partners = policy.partners.map((p) => ({ ...p, amount: r2((distributable * Math.max(0, p.pct)) / 100) }));
  const given = r2(partners.reduce((s, p) => s + p.amount, 0));
  return { netBeforeTax: base, tax, netAfterTax, reserve, distributable, partners, retained: r2(distributable - given) };
}

/** Problems that block saving a policy (Arabic), or null. */
export function policyProblem(p: Pick<ProfitPolicy, "reservePct" | "taxPct" | "partners">): string | null {
  if (!(p.taxPct >= 0 && p.taxPct <= 100)) return "نسبة الضريبة من 0 إلى 100٪.";
  if (!(p.reservePct >= 0 && p.reservePct <= 100)) return "نسبة الاحتياطي من 0 إلى 100٪.";
  if (p.partners.some((x) => !x.name.trim())) return "اكتب اسم كل شريك.";
  if (p.partners.some((x) => !(x.pct > 0))) return "نصيب كل شريك أكبر من صفر.";
  const sum = r2(p.partners.reduce((s, x) => s + x.pct, 0));
  if (sum > 100) return `مجموع أنصبة الشركاء ${sum}٪ — لا يزيد عن 100٪.`;
  return null;
}

export interface ProfitBucket {
  revenue: number;
  expense: number;
  net: number;
}

/**
 * Net profit of a calendar year from the journal: per month (Jan..Dec) and per cost center
 * (department; lines without one go to "general"). Uses the same revenue/expense rule as
 * `incomeStatement`, so the year total always equals the income statement.
 */
export function yearProfit(
  entries: { date: string; lines: { account: string; debit: number; credit: number; costCenter?: string | undefined }[] }[],
  year: number,
  typeOf: (account: string) => string,
) {
  const months: ProfitBucket[] = Array.from({ length: 12 }, () => ({ revenue: 0, expense: 0, net: 0 }));
  const centers = new Map<string, ProfitBucket>();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    const m = months[Number(e.date.slice(5, 7)) - 1]!;
    for (const l of e.lines) {
      const t = typeOf(l.account);
      if (t !== "revenue" && t !== "expense") continue;
      const key = l.costCenter || "general";
      const c = centers.get(key) ?? { revenue: 0, expense: 0, net: 0 };
      if (t === "revenue") {
        const v = l.credit - l.debit;
        m.revenue += v;
        c.revenue += v;
      } else {
        const v = l.debit - l.credit;
        m.expense += v;
        c.expense += v;
      }
      centers.set(key, c);
    }
  }
  const fix = (b: ProfitBucket): ProfitBucket => ({ revenue: r2(b.revenue), expense: r2(b.expense), net: r2(b.revenue - b.expense) });
  const monthly = months.map(fix);
  const byCenter = [...centers.entries()]
    .map(([center, b]) => ({ center, ...fix(b) }))
    .filter((x) => Math.abs(x.revenue) >= 0.005 || Math.abs(x.expense) >= 0.005)
    .sort((a, b) => b.net - a.net);
  const total = fix(monthly.reduce((s, b) => ({ revenue: s.revenue + b.revenue, expense: s.expense + b.expense, net: 0 }), { revenue: 0, expense: 0, net: 0 }));
  return { monthly, byCenter, total };
}
