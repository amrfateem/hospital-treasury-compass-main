/**
 * Staff advances (pure). An advance is paid once and taken back from the salary in equal
 * monthly installments starting from `startPeriod`; the last one takes whatever is left.
 * Deductions are recorded on the advance when a month's payroll is posted. Covered by care.test.ts.
 */
import type { Advance } from "./model";

const round2 = (n: number) => Math.round(n * 100) / 100;

export const installmentOf = (a: Pick<Advance, "amount" | "months">) => round2(a.amount / Math.max(1, a.months));
export const deductedOf = (a: Pick<Advance, "deductions">) => round2(a.deductions.reduce((s, d) => s + d.amount, 0));
export const remainingOf = (a: Pick<Advance, "amount" | "deductions">) => round2(Math.max(0, a.amount - deductedOf(a)));

/** Installment due from this advance in a payroll month (0 when not due). */
export function dueFor(a: Advance, period: string) {
  if (a.status !== "paid" || period < a.startPeriod) return 0;
  if (a.deductions.some((d) => d.period === period)) return 0;
  const left = remainingOf(a);
  return round2(Math.min(installmentOf(a), left));
}

/** What is deducted from an employee in a month: the recorded deductions once posted, else what is due. */
export function employeeDeduction(advances: Advance[], employeeId: string, period: string, posted: boolean) {
  const mine = advances.filter((a) => a.employeeId === employeeId);
  return round2(
    mine.reduce(
      (s, a) => s + (posted ? (a.deductions.find((d) => d.period === period)?.amount ?? 0) : dueFor(a, period)),
      0,
    ),
  );
}

/** Deductions for a month, capped so no employee's net goes below zero. */
export function payrollDeductions(advances: Advance[], period: string, netOf: (employeeId: string) => number) {
  const out: { advanceId: string; employeeId: string; amount: number }[] = [];
  const room = new Map<string, number>();
  for (const a of [...advances].sort((x, y) => x.date.localeCompare(y.date) || x.createdAt - y.createdAt)) {
    const due = dueFor(a, period);
    if (!due) continue;
    const left = room.has(a.employeeId) ? room.get(a.employeeId)! : Math.max(0, netOf(a.employeeId));
    const take = round2(Math.min(due, left));
    room.set(a.employeeId, round2(left - take));
    if (take > 0) out.push({ advanceId: a.id, employeeId: a.employeeId, amount: take });
  }
  return out;
}
