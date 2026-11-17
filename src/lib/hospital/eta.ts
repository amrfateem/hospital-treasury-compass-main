/**
 * Egyptian e-invoicing (منظومة الفاتورة الإلكترونية — مصلحة الضرائب المصرية).
 * Pure: totals with VAT (T1) and withholding (T4), validation in Arabic and the ETA
 * document JSON (v1.0 shape) that the hospital's signing tool signs and submits.
 * Medical services are VAT-exempt (V003); other services carry 14% (V009).
 * Prices copied from patient receipts are what the patient paid, so taxable lines are
 * split back to net + VAT (VAT-inclusive).
 */
import { WHT_THRESHOLD, WHT_TYPES, type WhtType } from "./finance";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round5 = (n: number) => Math.round(n * 100000) / 100000;

export const ETA_VAT_RATE = 14;
export type EtaTaxType = "exempt" | "vat14";
export const ETA_TAX_LABELS: Record<EtaTaxType, string> = {
  exempt: "معفاة — خدمة طبية (V003)",
  vat14: "خاضعة ١٤٪ (V009)",
};
/** ETA withholding sub-types (T4). */
export const ETA_WHT_SUBTYPES: Record<WhtType, string> = {
  none: "",
  supplies: "W002",
  services: "W004",
  professional: "W010",
};

export type EInvoiceStatus = "draft" | "submitted" | "accepted" | "rejected" | "cancelled";
export const EINVOICE_STATUS_LABELS: Record<EInvoiceStatus, string> = {
  draft: "مسودة",
  submitted: "مرفوعة — بانتظار رد المصلحة",
  accepted: "مقبولة (Valid)",
  rejected: "مرفوضة (Invalid)",
  cancelled: "ملغاة",
};

export type ReceiverType = "B" | "P" | "F";
export const RECEIVER_TYPES: Record<ReceiverType, string> = {
  B: "شركة / جهة مسجلة (رقم تسجيل ضريبي)",
  P: "شخص طبيعي (رقم قومي)",
  F: "أجنبي (جواز سفر)",
};

export interface EInvoiceLine {
  id: string;
  description: string;
  /** GS1 / EGS code registered on the ETA portal. */
  itemCode: string;
  qty: number;
  /** Net unit price before VAT. */
  unitPrice: number;
  discount: number;
  taxType: EtaTaxType;
}

export interface EInvoice {
  id: string;
  number: string;
  date: string;
  /** "patient" = a patient receipt; "insurer" = a claim invoice to an insurer for a period. */
  source: "patient" | "insurer" | "manual";
  /** Patient invoice id, or the patient invoice ids covered by an insurer claim. */
  refIds: string[];
  /** Cost center the revenue belongs to (for VAT reclassification). */
  department: string;
  receiver: { type: ReceiverType; id: string; name: string; address?: string | undefined };
  lines: EInvoiceLine[];
  /** Withholding the buyer deducts (companies only). */
  whtType: WhtType;
  status: EInvoiceStatus;
  etaUuid?: string | undefined;
  statusNote?: string | undefined;
  submittedAt?: number | undefined;
  createdAt: number;
  createdBy?: string | undefined;
}

export interface EtaSettings {
  activityCode: string;
  branchId: string;
  governate: string;
  regionCity: string;
  street: string;
  buildingNumber: string;
  defaultItemCode: string;
}
export const DEFAULT_ETA_SETTINGS: EtaSettings = {
  activityCode: "8610",
  branchId: "0",
  governate: "",
  regionCity: "",
  street: "",
  buildingNumber: "",
  defaultItemCode: "",
};

export function eLineAmounts(l: Pick<EInvoiceLine, "qty" | "unitPrice" | "discount" | "taxType">) {
  const sales = round5(Math.max(0, l.qty || 0) * Math.max(0, l.unitPrice || 0));
  const discount = round5(Math.min(sales, Math.max(0, l.discount || 0)));
  const net = round5(sales - discount);
  const vat = l.taxType === "vat14" ? round5((net * ETA_VAT_RATE) / 100) : 0;
  return { sales, discount, net, vat };
}

/** Whole-document totals; withholding applies from the WHT threshold on the net amount. */
export function eInvoiceTotals(inv: Pick<EInvoice, "lines" | "whtType">) {
  const rows = inv.lines.map(eLineAmounts);
  const sales = round2(rows.reduce((s, r) => s + r.sales, 0));
  const discount = round2(rows.reduce((s, r) => s + r.discount, 0));
  const net = round2(rows.reduce((s, r) => s + r.net, 0));
  const vat = round2(rows.reduce((s, r) => s + r.vat, 0));
  const whtRate = net >= WHT_THRESHOLD ? WHT_TYPES[inv.whtType].rate : 0;
  const wht = round2(net * whtRate);
  return { sales, discount, net, vat, wht, whtRate, total: round2(net + vat - wht) };
}

/** Net unit price from a price the patient paid (VAT included for taxable lines). */
export const netFromGross = (gross: number, taxType: EtaTaxType) =>
  taxType === "vat14" ? round5(gross / (1 + ETA_VAT_RATE / 100)) : round5(gross);

const RIN = /^\d{9}$/;
const NATIONAL_ID = /^\d{14}$/;
/** ETA asks for the buyer's national ID on invoices to individuals from this total. */
export const PERSON_ID_THRESHOLD = 50_000;

/** Problems that would make the ETA reject the document (Arabic, for the screen). */
export function validateEInvoice(
  inv: EInvoice,
  issuer: { taxId: string; name: string },
  eta: EtaSettings,
): string[] {
  const out: string[] = [];
  if (!RIN.test(issuer.taxId.replace(/\D/g, "")))
    out.push("رقم التسجيل الضريبي للمستشفى غير مكتمل (٩ أرقام) — من الإعدادات.");
  if (!eta.activityCode.trim()) out.push("كود النشاط الضريبي للمستشفى غير محدد.");
  if (!eta.governate.trim() || !eta.regionCity.trim() || !eta.street.trim() || !eta.buildingNumber.trim())
    out.push("عنوان فرع المستشفى (المحافظة، المدينة، الشارع، رقم المبنى) غير مكتمل.");
  if (!inv.receiver.name.trim()) out.push("اكتب اسم المستلم.");
  const total = eInvoiceTotals(inv).total;
  if (inv.receiver.type === "B" && !RIN.test(inv.receiver.id.replace(/\D/g, "")))
    out.push("رقم التسجيل الضريبي للجهة المستلمة يجب أن يكون ٩ أرقام.");
  if (inv.receiver.type === "P" && (inv.receiver.id || total >= PERSON_ID_THRESHOLD)) {
    if (!NATIONAL_ID.test(inv.receiver.id.replace(/\D/g, "")))
      out.push(`الرقم القومي للمريض (١٤ رقمًا) مطلوب للفواتير من ${PERSON_ID_THRESHOLD.toLocaleString("ar-EG")} ج.م.`);
  }
  if (inv.receiver.type === "F" && !inv.receiver.id.trim()) out.push("اكتب رقم جواز سفر المستلم.");
  if (!inv.lines.length) out.push("الفاتورة بلا بنود.");
  inv.lines.forEach((l, i) => {
    if (!l.description.trim()) out.push(`البند ${i + 1}: بلا وصف.`);
    if (!(l.itemCode || eta.defaultItemCode).trim())
      out.push(`البند ${i + 1}: لا يوجد كود صنف (EGS) — أضف كودًا افتراضيًا في إعدادات الفاتورة الإلكترونية.`);
    if (!(l.qty > 0) || !(l.unitPrice >= 0)) out.push(`البند ${i + 1}: الكمية أو السعر غير صحيح.`);
  });
  return out;
}

const r5 = (n: number) => round5(n);

/** The document in the ETA v1.0 JSON shape (unsigned; the signing tool adds `signatures`). */
export function etaDocument(
  inv: EInvoice,
  issuer: { taxId: string; name: string },
  eta: EtaSettings,
) {
  const totals = eInvoiceTotals(inv);
  const lines = inv.lines.map((l) => {
    const a = eLineAmounts(l);
    const whtAmount = r5(a.net * totals.whtRate);
    const taxableItems = [
      {
        taxType: "T1",
        amount: r5(a.vat),
        subType: l.taxType === "vat14" ? "V009" : "V003",
        rate: l.taxType === "vat14" ? ETA_VAT_RATE : 0,
      },
      ...(totals.whtRate > 0
        ? [{ taxType: "T4", amount: whtAmount, subType: ETA_WHT_SUBTYPES[inv.whtType], rate: totals.whtRate * 100 }]
        : []),
    ];
    return {
      description: l.description,
      itemType: "EGS",
      itemCode: (l.itemCode || eta.defaultItemCode).trim(),
      unitType: "EA",
      quantity: r5(l.qty),
      internalCode: l.id,
      salesTotal: a.sales,
      total: r5(a.net + a.vat - whtAmount),
      valueDifference: 0,
      totalTaxableFees: 0,
      netTotal: a.net,
      itemsDiscount: 0,
      unitValue: { currencySold: "EGP", amountEGP: r5(l.unitPrice) },
      discount: { rate: a.sales ? r5((a.discount / a.sales) * 100) : 0, amount: a.discount },
      taxableItems,
    };
  });
  const sum = (k: "salesTotal" | "netTotal" | "total") => r5(lines.reduce((s, l) => s + l[k], 0));
  const taxTotal = (t: string) =>
    r5(lines.reduce((s, l) => s + l.taxableItems.filter((x) => x.taxType === t).reduce((a, x) => a + x.amount, 0), 0));
  return {
    issuer: {
      address: {
        branchID: eta.branchId || "0",
        country: "EG",
        governate: eta.governate,
        regionCity: eta.regionCity,
        street: eta.street,
        buildingNumber: eta.buildingNumber,
      },
      type: "B",
      id: issuer.taxId.replace(/\D/g, ""),
      name: issuer.name,
    },
    receiver: {
      address: { country: "EG", governate: "", regionCity: "", street: inv.receiver.address ?? "", buildingNumber: "" },
      type: inv.receiver.type,
      id: inv.receiver.id.replace(inv.receiver.type === "F" ? /\s/g : /\D/g, ""),
      name: inv.receiver.name,
    },
    documentType: "I",
    documentTypeVersion: "1.0",
    dateTimeIssued: `${inv.date}T08:00:00Z`,
    taxpayerActivityCode: eta.activityCode,
    internalID: inv.number,
    invoiceLines: lines,
    totalDiscountAmount: r5(lines.reduce((s, l) => s + l.discount.amount, 0)),
    totalSalesAmount: sum("salesTotal"),
    netAmount: sum("netTotal"),
    taxTotals: [
      { taxType: "T1", amount: taxTotal("T1") },
      ...(totals.whtRate > 0 ? [{ taxType: "T4", amount: taxTotal("T4") }] : []),
    ],
    totalAmount: sum("total"),
    extraDiscountAmount: 0,
    totalItemsDiscountAmount: 0,
  };
}

/** VAT position for a period: output (e-invoices) minus input (supplier invoices). */
export function vatPosition(
  eInvoices: Pick<EInvoice, "date" | "lines" | "whtType" | "status">[],
  supplierVat: { date: string; vat: number; wht: number }[],
  prefix: string,
) {
  const live = eInvoices.filter((e) => e.date.startsWith(prefix) && e.status !== "cancelled" && e.status !== "rejected");
  const t = live.map(eInvoiceTotals);
  const output = round2(t.reduce((s, x) => s + x.vat, 0));
  const whtByCustomers = round2(t.reduce((s, x) => s + x.wht, 0));
  const sup = supplierVat.filter((s) => s.date.startsWith(prefix));
  const input = round2(sup.reduce((s, x) => s + x.vat, 0));
  const whtToPay = round2(sup.reduce((s, x) => s + x.wht, 0));
  return { output, input, net: round2(output - input), whtByCustomers, whtToPay, count: live.length };
}
