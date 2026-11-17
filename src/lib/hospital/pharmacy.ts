/**
 * Pharmacy sales (pure): drugs sold on a receipt or charged to an inpatient account leave the
 * store automatically at their batch cost (earliest expiry first, like store issues), so the
 * profit of every item is sale price minus that cost. Covered by care.test.ts.
 */
import { stockStatus } from "./finance";
import type { StockItem, StockMove } from "./model";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Average unit cost of taking `qty` from the item's batches now (earliest expiry first). */
export function issueUnitCost(item: Pick<StockItem, "id" | "reorderLevel">, moves: StockMove[], qty: number, today: string) {
  if (!(qty > 0)) return 0;
  const st = stockStatus(item, moves, today);
  let left = qty;
  let cost = 0;
  for (const b of st.batches) {
    const take = Math.min(b.remaining, left);
    cost += take * b.unitCost;
    left -= take;
    if (left <= 0) break;
  }
  return round2(cost / qty);
}

export interface SalesRow {
  itemId: string;
  qty: number;
  sales: number;
  cost: number;
  profit: number;
  /** Profit as a share of sales (0..1). */
  margin: number;
}

/** Sold quantity, sales value, cost and profit per item for a period prefix ("YYYY-MM" / "YYYY"), returns deducted. */
export function pharmacySales(moves: StockMove[], prefix: string): SalesRow[] {
  const rows = new Map<string, { qty: number; sales: number; cost: number }>();
  for (const m of moves) {
    if (!m.source || !m.date.startsWith(prefix)) continue;
    const sign = m.source === "return" ? -1 : m.type === "out" ? 1 : 0;
    if (!sign) continue;
    const r = rows.get(m.itemId) ?? { qty: 0, sales: 0, cost: 0 };
    r.qty += sign * m.qty;
    r.sales += sign * m.qty * (m.salePrice ?? 0);
    r.cost += sign * m.qty * (m.unitCost ?? 0);
    rows.set(m.itemId, r);
  }
  return [...rows.entries()]
    .map(([itemId, r]) => {
      const sales = round2(r.sales);
      const cost = round2(r.cost);
      const profit = round2(sales - cost);
      return { itemId, qty: round2(r.qty), sales, cost, profit, margin: sales > 0 ? profit / sales : 0 };
    })
    .filter((r) => r.qty !== 0 || r.sales !== 0)
    .sort((a, b) => b.profit - a.profit);
}
