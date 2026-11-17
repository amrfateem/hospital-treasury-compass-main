/**
 * Patient refunds (pure). A refund pays back the patient's own share of cancelled receipt lines
 * (after the receipt's discount and the insurer's share), never more than the patient actually
 * paid in cash minus earlier refunds. Covered by care.test.ts.
 */
import { invoiceAmounts } from "./finance";
import type { PatientInvoice, Refund, RefundLine } from "./model";

const round2 = (n: number) => Math.round(n * 100) / 100;
const live = (r: Refund) => r.status !== "rejected";

export interface RefundableLine {
  index: number;
  description: string;
  qty: number;
  /** Quantity not refunded yet. */
  left: number;
  unitPrice: number;
  /** What the patient paid for one unit (after discount and insurer share). */
  unitShare: number;
  stockItemId?: string | undefined;
}

/** Lines of a receipt that can still be refunded, and the cash that can still go back. */
export function refundable(inv: PatientInvoice, refunds: Refund[]) {
  const a = invoiceAmounts(inv);
  const mine = refunds.filter((r) => r.invoiceId === inv.id && live(r));
  const done = new Map<number, number>();
  for (const r of mine) for (const l of r.lines) done.set(l.index, (done.get(l.index) ?? 0) + l.qty);
  const ratio = a.subtotal > 0 ? a.total / a.subtotal : 0;
  const patientRatio = a.total > 0 ? a.patientShare / a.total : 0;
  const lines: RefundableLine[] = inv.items.map((it, index) => ({
    index,
    description: it.description,
    qty: it.qty,
    left: Math.max(0, it.qty - (done.get(index) ?? 0)),
    unitPrice: it.unitPrice,
    unitShare: round2(it.unitPrice * ratio * patientRatio),
    stockItemId: it.stockItemId,
  }));
  const refunded = round2(mine.reduce((s, r) => s + r.amount, 0));
  return { lines, refunded, cashLeft: round2(Math.max(0, a.paidNow - refunded)) };
}

/** Checks a refund request and prices it; returns an Arabic error or the lines with amounts. */
export function refundPlan(
  inv: PatientInvoice,
  refunds: Refund[],
  picked: { index: number; qty: number }[],
): { error: string } | { lines: RefundLine[]; amount: number } {
  const r = refundable(inv, refunds);
  const lines: RefundLine[] = [];
  for (const p of picked) {
    if (!(p.qty > 0)) continue;
    const l = r.lines[p.index];
    if (!l) return { error: "سطر غير موجود في الإيصال." };
    if (p.qty > l.left) return { error: `الكمية المرتجعة من «${l.description}» أكبر من المتاح (${l.left}).` };
    lines.push({ index: l.index, description: l.description, qty: p.qty, unitPrice: l.unitPrice, amount: round2(l.unitShare * p.qty), stockItemId: l.stockItemId });
  }
  if (!lines.length) return { error: "اختر الخدمة المرتجعة وكميتها." };
  const amount = round2(Math.min(lines.reduce((s, l) => s + l.amount, 0), r.cashLeft));
  if (!(amount > 0)) return { error: "لا يوجد مبلغ مدفوع نقدًا يمكن رده على هذا الإيصال." };
  return { lines, amount };
}

/** The receipt with paid-back quantities removed (doctors' dues count only what was kept). */
export function netOfRefunds<T extends Pick<PatientInvoice, "id" | "items">>(inv: T, refunds: Refund[]): T {
  const back = new Map<number, number>();
  for (const r of refunds)
    if (r.invoiceId === inv.id && r.status === "paid") for (const l of r.lines) back.set(l.index, (back.get(l.index) ?? 0) + l.qty);
  if (!back.size) return inv;
  return { ...inv, items: inv.items.map((it, i) => ({ ...it, qty: Math.max(0, it.qty - (back.get(i) ?? 0)) })) };
}
