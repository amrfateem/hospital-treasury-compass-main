/** What each patient paid and still owes, from their linked receipts and collections. Pure. */
import { invoiceAmounts } from "./finance";
import type { HospitalDB } from "./model";
import { patientAccountId } from "./ops";

export interface PatientMoney {
  receipts: number;
  billed: number;
  paidAtDesk: number;
  collected: number;
  remaining: number;
  lastDate: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const empty = (): PatientMoney => ({ receipts: 0, billed: 0, paidAtDesk: 0, collected: 0, remaining: 0, lastDate: null });

/** One pass over receipts, charges and collections for the given patients. */
export function patientMoney(
  db: Pick<HospitalDB, "patientInvoices" | "transactions" | "creditCharges">,
  patientIds: string[],
): Record<string, PatientMoney> {
  const out: Record<string, PatientMoney> = Object.fromEntries(patientIds.map((id) => [id, empty()]));
  const byAccount = new Map(patientIds.map((id) => [patientAccountId(id), id]));
  const owed: Record<string, number> = {};
  for (const inv of db.patientInvoices) {
    if (!inv.patientId || !out[inv.patientId]) continue;
    const m = out[inv.patientId]!;
    const a = invoiceAmounts(inv);
    m.receipts += 1;
    m.billed = round2(m.billed + a.patientShare);
    m.paidAtDesk = round2(m.paidAtDesk + a.paidNow);
    if (!m.lastDate || inv.date > m.lastDate) m.lastDate = inv.date;
    if (inv.credit && byAccount.get(inv.credit.accountId) === inv.patientId)
      owed[inv.patientId] = round2((owed[inv.patientId] ?? 0) + a.credit);
  }
  for (const c of db.creditCharges) {
    const pid = byAccount.get(c.accountId);
    if (pid) owed[pid] = round2((owed[pid] ?? 0) + c.amount);
  }
  for (const t of db.transactions) {
    if (t.source !== "collection" || !t.ref) continue;
    const pid = byAccount.get(t.ref);
    if (pid) out[pid]!.collected = round2(out[pid]!.collected + t.amount);
  }
  for (const id of patientIds) out[id]!.remaining = round2(Math.max(0, (owed[id] ?? 0) - out[id]!.collected));
  return out;
}
