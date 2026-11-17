/**
 * Pure helpers for the invoice export desk: filtering, per-section totals and the Excel (CSV)
 * file. Shared by the billing pages and covered by invoice-export.test.ts.
 */
import { findDepartment } from "./constants";
import { deskOf, RECEIPT_DESKS, type ReceiptDeskKey } from "./catalog";
import { invoiceAmounts } from "./finance";
import { listLabel, type HospitalDB, type InvoiceExport, type PatientInvoice } from "./model";

export interface InvoiceFilters {
  from: string; // YYYY-MM-DD, "" = open
  to: string;
  desks: ReceiptDeskKey[]; // empty = all
  method: string; // "all" or payment method id
  payer: string; // "all" | "none" | payer id
  status: "all" | "new" | "exported";
  query: string;
}

export const EMPTY_FILTERS: InvoiceFilters = {
  from: "",
  to: "",
  desks: [],
  method: "all",
  payer: "all",
  status: "all",
  query: "",
};

export function exportedIds(exports: InvoiceExport[]) {
  return new Set(exports.flatMap((e) => e.invoiceIds));
}

export function filterInvoices(
  invoices: PatientInvoice[],
  f: InvoiceFilters,
  exported: Set<string>,
): PatientInvoice[] {
  const q = f.query.trim().toLowerCase();
  return invoices
    .filter(
      (i) =>
        (!f.from || i.date >= f.from) &&
        (!f.to || i.date <= f.to) &&
        (!f.desks.length || f.desks.includes(deskOf(i.department).key)) &&
        (f.method === "all" || i.paymentMethod === f.method) &&
        (f.payer === "all" ||
          (f.payer === "none" ? !i.payer : i.payer?.payerId === f.payer)) &&
        (f.status === "all" || (f.status === "exported") === exported.has(i.id)) &&
        (!q ||
          [i.patientName, i.number, i.patientPhone ?? "", ...i.items.map((x) => x.description)]
            .join(" ")
            .toLowerCase()
            .includes(q)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DeskTotals {
  key: ReceiptDeskKey;
  label: string;
  count: number;
  subtotal: number;
  discount: number;
  total: number;
  insurerShare: number;
  patientShare: number;
}

/** Totals per receipt section (only sections that have invoices), plus a grand total. */
export function deskTotals(invoices: PatientInvoice[]) {
  const rows = new Map<ReceiptDeskKey, DeskTotals>();
  const zero = { count: 0, subtotal: 0, discount: 0, total: 0, insurerShare: 0, patientShare: 0 };
  const grand: DeskTotals = {
    key: "other",
    label: "الإجمالي",
    count: 0,
    subtotal: 0,
    discount: 0,
    total: 0,
    insurerShare: 0,
    patientShare: 0,
  };
  for (const inv of invoices) {
    const d = deskOf(inv.department);
    const row = rows.get(d.key) ?? { ...zero, key: d.key, label: d.label };
    const a = invoiceAmounts(inv);
    for (const t of [row, grand]) {
      t.count += 1;
      t.subtotal = r2(t.subtotal + a.subtotal);
      t.discount = r2(t.discount + a.discount);
      t.total = r2(t.total + a.total);
      t.insurerShare = r2(t.insurerShare + a.insurerShare);
      t.patientShare = r2(t.patientShare + a.patientShare);
    }
    rows.set(d.key, row);
  }
  const order = RECEIPT_DESKS.map((d) => d.key);
  return {
    rows: [...rows.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
    grand,
  };
}

/** Section, specialty clinic / referral and doctor lines describing where a receipt came from. */
export function invoiceContext(db: Pick<HospitalDB, "departments" | "doctors">, inv: PatientInvoice) {
  const desk = deskOf(inv.department);
  const dept = findDepartment(db.departments, inv.department).name;
  return {
    desk,
    section: desk.key === "other" ? dept : desk.label,
    clinic: inv.clinicId ? findDepartment(db.departments, inv.clinicId).name : "",
    doctor: inv.doctorId ? (db.doctors.find((d) => d.id === inv.doctorId)?.name ?? "") : "",
    referredBy: inv.referredBy ?? "",
  };
}

const cell = (v: string | number) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Excel-ready CSV (UTF-8 with BOM so Arabic opens correctly), one line per invoice + total. */
export function invoicesCsv(db: HospitalDB, invoices: PatientInvoice[]) {
  const head = [
    "رقم الفاتورة",
    "التاريخ",
    "المريض",
    "التليفون",
    "القسم",
    "العيادة / المحوِّل",
    "الطبيب",
    "الخدمات",
    "الإجمالي",
    "الخصم",
    "الصافي",
    "جهة التعاقد",
    "نصيب الجهة",
    "المدفوع من المريض",
    "طريقة الدفع",
    "حرره",
  ];
  const lines = invoices.map((inv) => {
    const a = invoiceAmounts(inv);
    const c = invoiceContext(db, inv);
    const services = [
      ...inv.items.map((i) => `${i.description} ×${i.qty}`),
      ...(a.days ? [`إقامة ${a.days} يوم`] : []),
    ].join(" + ");
    return [
      inv.number,
      inv.date,
      inv.patientName,
      inv.patientPhone ?? "",
      c.section,
      c.clinic || c.referredBy,
      c.doctor,
      services,
      a.subtotal,
      a.discount,
      a.total,
      inv.payer ? listLabel(db.lists.payers, inv.payer.payerId) : "",
      a.insurerShare,
      a.patientShare,
      listLabel(db.lists.paymentMethods, inv.paymentMethod),
      inv.createdBy ?? "",
    ];
  });
  const g = deskTotals(invoices).grand;
  const total = ["الإجمالي", "", `${g.count} فاتورة`, "", "", "", "", "", g.subtotal, g.discount, g.total, "", g.insurerShare, g.patientShare, "", ""];
  return "\uFEFF" + [head, ...lines, total].map((r) => r.map(cell).join(",")).join("\r\n");
}
