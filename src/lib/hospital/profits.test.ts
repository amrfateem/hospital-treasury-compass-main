import { describe, expect, it } from "vitest";
import { distributeProfit, policyProblem, yearProfit } from "./profits";

const typeOf = (a: string) => (a.startsWith("4") ? "revenue" : a.startsWith("5") ? "expense" : "asset");

describe("hospital profits", () => {
  it("takes tax first, then the reserve, then splits the rest between partners", () => {
    const d = distributeProfit(100_000, { taxPct: 22.5, reservePct: 5, partners: [{ name: "أ", pct: 60 }, { name: "ب", pct: 40 }] });
    expect(d.tax).toBe(22_500);
    expect(d.netAfterTax).toBe(77_500);
    expect(d.reserve).toBe(3_875);
    expect(d.distributable).toBe(73_625);
    expect(d.partners.map((p) => p.amount)).toEqual([44_175, 29_450]);
    expect(d.retained).toBe(0);
  });

  it("never taxes or distributes a loss", () => {
    const d = distributeProfit(-5_000, { taxPct: 22.5, reservePct: 5, partners: [{ name: "أ", pct: 100 }] });
    expect(d.tax).toBe(0);
    expect(d.distributable).toBe(0);
    expect(d.partners[0]!.amount).toBe(0);
  });

  it("refuses partner shares above 100%", () => {
    expect(policyProblem({ taxPct: 22.5, reservePct: 5, partners: [{ name: "أ", pct: 70 }, { name: "ب", pct: 40 }] })).toContain("110");
  });

  it("splits the year's net profit by month and department", () => {
    const entries = [
      { date: "2026-01-10", lines: [{ account: "1100-main", debit: 1000, credit: 0 }, { account: "4100", debit: 0, credit: 1000, costCenter: "lab" }] },
      { date: "2026-01-20", lines: [{ account: "5100", debit: 300, credit: 0, costCenter: "lab" }, { account: "1100-main", debit: 0, credit: 300 }] },
      { date: "2026-03-05", lines: [{ account: "5200", debit: 200, credit: 0 }, { account: "1100-main", debit: 0, credit: 200 }] },
      { date: "2025-12-31", lines: [{ account: "4100", debit: 0, credit: 9999, costCenter: "lab" }] },
    ];
    const p = yearProfit(entries, 2026, typeOf);
    expect(p.monthly[0]).toEqual({ revenue: 1000, expense: 300, net: 700 });
    expect(p.monthly[2]).toEqual({ revenue: 0, expense: 200, net: -200 });
    expect(p.total).toEqual({ revenue: 1000, expense: 500, net: 500 });
    expect(p.byCenter.find((c) => c.center === "lab")!.net).toBe(700);
    expect(p.byCenter.find((c) => c.center === "general")!.net).toBe(-200);
  });
});
