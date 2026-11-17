/**
 * Money control ("الرقابة ومنع التلاعب"): pure, derived checks that point the director and the
 * finance manager to every movement that could hide a theft — cancelled or changed receipts,
 * shift shortages, big discounts, receipts never printed, money paid out without a payment
 * order — plus a per-person summary. Nothing here is stored; it is recomputed from the records.
 */
import { invoiceAmounts, shiftDifferences } from "./finance";
import { discountPct } from "./permissions";
import { findBox, type HospitalDB } from "./model";

export type AlertKind =
  | "cancelled"
  | "cancelRequest"
  | "editedAfterPrint"
  | "directDelete"
  | "shortage"
  | "bigDiscount"
  | "unprinted"
  | "directSpend";

export type AlertLevel = "high" | "medium";

export interface ControlAlert {
  id: string;
  kind: AlertKind;
  level: AlertLevel;
  date: string;
  /** Person responsible (who made the receipt / closed the shift / paid the money). */
  person: string;
  amount: number;
  title: string;
  detail: string;
}

export const ALERT_LABELS: Record<AlertKind, string> = {
  cancelled: "إيصال اتلغى",
  cancelRequest: "طلب إلغاء إيصال",
  editedAfterPrint: "تعديل إيصال بعد طباعته",
  directDelete: "إيصال ألغاه المدير مباشرة",
  shortage: "عجز في تقفيل وردية",
  bigDiscount: "خصم كبير",
  unprinted: "إيصال اتحصل ومطبعش",
  directSpend: "صرف بدون أمر صرف",
};

/** A discount at or above this share of the receipt is always shown. */
export const BIG_DISCOUNT_PCT = 20;

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

export function controlAlerts(db: HospitalDB, from: string, to: string, today: string): ControlAlert[] {
  const out: ControlAlert[] = [];
  const box = (id: string | undefined) => findBox(db, id).name;

  for (const r of db.editRequests) {
    const s = r.snapshot;
    const date = dayOf(r.requestedAt);
    if (!inRange(date, from, to)) continue;
    const inv = db.patientInvoices.find((i) => i.id === r.invoiceId);
    const number = s?.number ?? inv?.number ?? "—";
    const amount = s?.paidNow ?? (inv ? invoiceAmounts(inv).paidNow : 0);
    const maker = s?.createdBy ?? inv?.createdBy ?? r.requestedBy;
    const who = `طلبه ${r.requestedBy}${r.decidedBy ? ` — ${r.status === "approved" ? "وافق" : "رفض"} ${r.decidedBy}` : ""}`;
    if (r.action === "delete" && r.status === "approved")
      out.push({ id: `c-${r.id}`, kind: "cancelled", level: "high", date, person: maker, amount, title: `إلغاء الإيصال ${number} — ${s?.patientName ?? ""}`, detail: `السبب: ${r.reason} • ${who}` });
    else if (r.action === "delete" && r.status === "pending")
      out.push({ id: `c-${r.id}`, kind: "cancelRequest", level: "medium", date, person: maker, amount, title: `طلب إلغاء الإيصال ${number}`, detail: `السبب: ${r.reason} • ${who}` });
    else if (r.action === "edit" && r.status === "approved")
      out.push({ id: `c-${r.id}`, kind: "editedAfterPrint", level: "medium", date, person: maker, amount, title: `تعديل الإيصال ${number} بعد طباعته`, detail: `السبب: ${r.reason} • ${who}` });
  }

  for (const e of db.auditLog ?? []) {
    if (e.op !== "deletePatientInvoice") continue;
    const date = dayOf(e.at);
    if (!inRange(date, from, to)) continue;
    out.push({ id: `d-${e.id}`, kind: "directDelete", level: "medium", date, person: e.by, amount: 0, title: "حذف إيصال مباشرة", detail: e.summary });
  }

  for (const s of db.shifts) {
    if (!s.closedAt || !s.expected || !s.counted) continue;
    const date = dayOf(s.closedAt);
    if (!inRange(date, from, to)) continue;
    const diff = shiftDifferences(s.expected, s.counted).diff;
    if (diff < -0.009)
      out.push({ id: `s-${s.id}`, kind: "shortage", level: "high", date, person: s.closedBy ?? s.openedBy, amount: round2(-diff), title: `عجز ${round2(-diff)} ج.م في وردية ${s.number} — ${box(s.boxId)}`, detail: `فتحها ${s.openedBy}${s.closedBy ? ` وقفّلها ${s.closedBy}` : ""}${s.note ? ` • ${s.note}` : ""}` });
  }

  for (const inv of db.patientInvoices) {
    if (!inRange(inv.date, from, to)) continue;
    const a = invoiceAmounts(inv);
    const pct = discountPct(a.subtotal, a.discount);
    if (a.discount > 0 && pct >= BIG_DISCOUNT_PCT)
      out.push({ id: `b-${inv.id}`, kind: "bigDiscount", level: pct >= 50 ? "high" : "medium", date: inv.date, person: inv.createdBy ?? "—", amount: a.discount, title: `خصم ${pct}٪ على الإيصال ${inv.number} — ${inv.patientName}`, detail: `قبل الخصم ${a.subtotal} ج.م • بعد الخصم ${a.total} ج.م` });
    if (!inv.printedAt && !inv.admissionId && a.paidNow > 0 && inv.date < today)
      out.push({ id: `u-${inv.id}`, kind: "unprinted", level: "high", date: inv.date, person: inv.createdBy ?? "—", amount: a.paidNow, title: `الإيصال ${inv.number} — ${inv.patientName} اتسجل ومطبعش للمريض`, detail: `${box(inv.boxId)} • ممكن الفلوس اتحصلت من غير ما المريض ياخد إيصال` });
  }

  for (const t of db.transactions) {
    if (t.kind !== "out" || (t.source !== "manual" && t.source !== "expense")) continue;
    if (!inRange(t.date, from, to)) continue;
    out.push({ id: `x-${t.id}`, kind: "directSpend", level: "medium", date: t.date, person: t.by ?? "—", amount: t.amount, title: `${t.description}${t.paidTo ? ` — لـ ${t.paidTo}` : ""}`, detail: `من ${box(t.boxId)} • إيصال ${t.receiptId}` });
  }

  const rank = { high: 0, medium: 1 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || b.date.localeCompare(a.date) || b.amount - a.amount);
}

export interface PersonControl {
  person: string;
  receipts: number;
  collected: number;
  discounts: number;
  cancelled: number;
  shortages: number;
  alerts: number;
}

/** Per person: what they collected and every warning against their name. */
export function personSummary(db: HospitalDB, alerts: ControlAlert[], from: string, to: string): PersonControl[] {
  const map = new Map<string, PersonControl>();
  const get = (p: string) => {
    let row = map.get(p);
    if (!row) map.set(p, (row = { person: p, receipts: 0, collected: 0, discounts: 0, cancelled: 0, shortages: 0, alerts: 0 }));
    return row;
  };
  for (const inv of db.patientInvoices) {
    if (!inRange(inv.date, from, to)) continue;
    const a = invoiceAmounts(inv);
    const row = get(inv.createdBy ?? "—");
    row.receipts += 1;
    row.collected = round2(row.collected + a.paidNow);
    row.discounts = round2(row.discounts + a.discount);
  }
  for (const al of alerts) {
    const row = get(al.person);
    row.alerts += 1;
    if (al.kind === "cancelled") row.cancelled = round2(row.cancelled + al.amount);
    if (al.kind === "shortage") row.shortages = round2(row.shortages + al.amount);
  }
  return [...map.values()].sort((a, b) => b.alerts - a.alerts || b.collected - a.collected);
}

/** Where the money came from and where it went in the period (cash boxes and banks). */
export function moneyTrail(db: HospitalDB, from: string, to: string) {
  const inBy = new Map<string, number>();
  const outBy = new Map<string, number>();
  let totalIn = 0;
  let totalOut = 0;
  for (const t of db.transactions) {
    if (!inRange(t.date, from, to)) continue;
    const key = t.source;
    if (t.kind === "in") {
      inBy.set(key, round2((inBy.get(key) ?? 0) + t.amount));
      totalIn = round2(totalIn + t.amount);
    } else {
      outBy.set(key, round2((outBy.get(key) ?? 0) + t.amount));
      totalOut = round2(totalOut + t.amount);
    }
  }
  const transfers = db.transfers.filter((t) => inRange(t.date, from, to));
  return {
    totalIn,
    totalOut,
    net: round2(totalIn - totalOut),
    inBy: [...inBy.entries()].sort((a, b) => b[1] - a[1]),
    outBy: [...outBy.entries()].sort((a, b) => b[1] - a[1]),
    transfers: round2(transfers.reduce((s, t) => s + t.amount, 0)),
    transferCount: transfers.length,
  };
}
