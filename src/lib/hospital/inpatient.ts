/**
 * Inpatient accounts (pure). On admission the patient pays a deposit; services, drugs and stay
 * days are added to the account during the stay; on discharge one final bill is made, the
 * deposits are set against the patient's share, the rest is paid (or left on the patient's
 * account) and any extra deposit is paid back. Covered by care.test.ts.
 */
import { invoiceAmounts, stayDays } from "./finance";
import type { Admission, Transaction } from "./model";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Deposits paid on an admission minus deposit money paid back. */
export function depositsOf(txs: Pick<Transaction, "source" | "ref" | "kind" | "amount">[], admissionId: string) {
  return round2(
    txs
      .filter((t) => t.source === "deposit" && t.ref === admissionId)
      .reduce((s, t) => s + (t.kind === "in" ? t.amount : -t.amount), 0),
  );
}

/** Running bill of an admission up to `asOf` (or its discharge date), with optional discount. */
export function admissionBill(adm: Admission, asOf: string, discount = 0) {
  const end = adm.dischargeDate ?? (asOf < adm.date ? adm.date : asOf);
  const a = invoiceAmounts({
    items: adm.charges,
    discount,
    kind: "inpatient",
    stay: { admitDate: adm.date, dischargeDate: end, roomRate: adm.roomRate, supervisionRate: adm.supervisionRate },
    payer: adm.payer,
  });
  return { ...a, days: stayDays(adm.date, end), dischargeDate: end };
}

/**
 * How the discharge is settled: deposits cover the patient's share first, `paid` is collected now
 * (default: everything still due), the rest stays on the patient, extra deposit goes back.
 */
export function dischargeSettlement(patientShare: number, deposits: number, paid?: number | undefined) {
  const applied = round2(Math.min(Math.max(0, deposits), patientShare));
  const due = round2(patientShare - applied);
  const payNow = paid === undefined ? due : round2(Math.max(0, paid));
  return {
    applied,
    due,
    payNow,
    remaining: round2(Math.max(0, due - payNow)),
    refund: round2(Math.max(0, deposits - applied)),
    error: payNow > due + 0.001 ? `المدفوع أكبر من المطلوب بعد خصم التأمين (${due}).` : "",
  };
}
