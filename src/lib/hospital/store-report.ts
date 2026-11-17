/**
 * General-store reports (pure): what each department consumed in a period, valued at the item's
 * average purchase cost. Shared by the store page and its tests.
 */
import type { StockItem, StockMove } from "./model";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Average unit cost of everything received for an item (0 when nothing was costed). */
export function averageCost(itemId: string, moves: Pick<StockMove, "itemId" | "type" | "qty" | "unitCost">[]) {
  let qty = 0;
  let value = 0;
  for (const m of moves) {
    if (m.itemId !== itemId || m.type !== "in" || !(m.qty > 0)) continue;
    qty += m.qty;
    value += m.qty * (m.unitCost ?? 0);
  }
  return qty > 0 ? value / qty : 0;
}

export interface DeptConsumption {
  department: string;
  /** Number of issue lines. */
  lines: number;
  value: number;
  items: { itemId: string; name: string; unit: string; qty: number; value: number }[];
}

/** Stock issued to each department in `period` ("YYYY-MM", "YYYY" or "all"), biggest first. */
export function consumptionByDepartment(
  items: Pick<StockItem, "id" | "name" | "unit">[],
  moves: StockMove[],
  period: string,
): DeptConsumption[] {
  const byDept = new Map<string, Map<string, { qty: number; lines: number }>>();
  for (const m of moves) {
    if (m.type !== "out" || !m.department) continue;
    if (period !== "all" && !m.date.startsWith(period)) continue;
    const d = byDept.get(m.department) ?? new Map();
    const cur = d.get(m.itemId) ?? { qty: 0, lines: 0 };
    d.set(m.itemId, { qty: cur.qty + m.qty, lines: cur.lines + 1 });
    byDept.set(m.department, d);
  }
  const cost = new Map<string, number>();
  const costOf = (id: string) => {
    if (!cost.has(id)) cost.set(id, averageCost(id, moves));
    return cost.get(id)!;
  };
  return [...byDept.entries()]
    .map(([department, m]) => {
      const rows = [...m.entries()].map(([itemId, v]) => {
        const it = items.find((i) => i.id === itemId);
        return {
          itemId,
          name: it?.name ?? "صنف محذوف",
          unit: it?.unit ?? "",
          qty: round2(v.qty),
          value: round2(v.qty * costOf(itemId)),
          lines: v.lines,
        };
      });
      return {
        department,
        lines: rows.reduce((s, r) => s + r.lines, 0),
        value: round2(rows.reduce((s, r) => s + r.value, 0)),
        items: rows.sort((a, b) => b.value - a.value || b.qty - a.qty).map(({ lines: _l, ...r }) => r),
      };
    })
    .sort((a, b) => b.value - a.value || b.lines - a.lines);
}
