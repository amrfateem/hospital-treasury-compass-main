/**
 * Detailed report managements (تقارير الإيرادات / المدفوعات / النثريات), document by document.
 * Revenue comes from the patients' receipts (refunds subtracted), payments from every money-out
 * treasury entry, petty cash from petty spends + petty requests. Pure (reports.test.ts).
 */
import { findDepartment } from "./constants";
import { invoiceAmounts } from "./finance";
import { invoiceContext } from "./invoice-export";
import {
  findBox,
  listLabel,
  ORDER_STATUS_LABELS,
  TX_SOURCE_LABELS,
  type HospitalDB,
  type OrderStatus,
  type PettyRequest,
  type Transaction,
} from "./model";

const r2 = (n: number) => Math.round(n * 100) / 100;
const ALL = "all";
const pass = (filter: string | undefined, value: string | undefined) => !filter || filter === ALL || filter === value;

export interface ReportFilters {
  from: string;
  to: string;
  department?: string | undefined;
  method?: string | undefined;
  source?: string | undefined;
  box?: string | undefined;
  category?: string | undefined;
  status?: string | undefined;
}

export interface ReportGroup {
  key: string;
  label: string;
  count: number;
  qty: number;
  total: number;
  /** Share of the grand total (0..1). */
  share: number;
}

/** Groups rows by key, summing amounts; largest first (days/months keep date order). */
export function groupRows<T>(
  rows: T[],
  key: (r: T) => { key: string; label: string },
  amount: (r: T) => number,
  qty: (r: T) => number = () => 1,
  sortByKey = false,
): ReportGroup[] {
  const map = new Map<string, ReportGroup>();
  for (const r of rows) {
    const k = key(r);
    const g = map.get(k.key) ?? { ...k, count: 0, qty: 0, total: 0, share: 0 };
    g.count++;
    g.qty = r2(g.qty + qty(r));
    g.total = r2(g.total + amount(r));
    map.set(k.key, g);
  }
  const total = [...map.values()].reduce((s, g) => s + g.total, 0);
  const list = [...map.values()].map((g) => ({ ...g, share: total ? g.total / total : 0 }));
  return sortByKey ? list.sort((a, b) => a.key.localeCompare(b.key)) : list.sort((a, b) => b.total - a.total);
}

const dayKey = (date: string) => ({ key: date, label: date });
const monthKey = (date: string) => ({ key: date.slice(0, 7), label: date.slice(0, 7) });

/* ---------------- Revenue ---------------- */

export interface RevenueLine {
  id: string;
  date: string;
  number: string;
  patient: string;
  department: string;
  departmentName: string;
  section: string;
  clinic: string;
  doctor: string;
  services: string;
  subtotal: number;
  discount: number;
  total: number;
  insurer: number;
  paid: number;
  remaining: number;
  method: string;
  cashier: string;
}

export interface ServiceRow {
  description: string;
  department: string;
  qty: number;
  total: number;
}

export function revenueReport(db: HospitalDB, f: ReportFilters) {
  const dept = (id: string) => findDepartment(db.departments, id).name;
  const invoices = db.patientInvoices.filter(
    (i) => i.date >= f.from && i.date <= f.to && pass(f.department, i.department) && pass(f.method, i.paymentMethod),
  );
  const lines: RevenueLine[] = invoices
    .map((inv) => {
      const a = invoiceAmounts(inv);
      const c = invoiceContext(db, inv);
      const services = [
        ...(a.room > 0 ? [`إقامة ${a.days} يوم`] : []),
        ...(a.supervision > 0 ? [`إشراف طبي ${a.days} يوم`] : []),
        ...inv.items.map((it) => (it.qty > 1 ? `${it.description} ×${it.qty}` : it.description)),
      ].join("، ");
      return {
        id: inv.id,
        date: inv.date,
        number: inv.number,
        patient: inv.patientName,
        department: inv.department,
        departmentName: dept(inv.department),
        section: c.section,
        clinic: c.clinic,
        doctor: c.doctor,
        services,
        subtotal: a.subtotal,
        discount: a.discount,
        total: a.total,
        insurer: a.insurerShare,
        paid: a.paidNow,
        remaining: a.credit,
        method: listLabel(db.lists.paymentMethods, inv.paymentMethod),
        cashier: inv.createdBy || "غير محدد",
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));

  // Every service line (before the receipt's discount), with stay days as their own services.
  const serviceRows: ServiceRow[] = invoices.flatMap((inv) => {
    const a = invoiceAmounts(inv);
    const rows: ServiceRow[] = inv.items.map((it) => ({
      description: it.description.trim(),
      department: inv.department,
      qty: it.qty,
      total: r2(it.qty * it.unitPrice),
    }));
    if (a.room > 0) rows.push({ description: "إقامة (يوم)", department: inv.department, qty: a.days, total: a.room });
    if (a.supervision > 0) rows.push({ description: "إشراف طبي (يوم)", department: inv.department, qty: a.days, total: a.supervision });
    return rows;
  });

  const refunds = db.refunds.filter(
    (r) => r.status === "paid" && (r.paidOn ?? r.date) >= f.from && (r.paidOn ?? r.date) <= f.to && pass(f.department, r.department),
  );
  const collections = db.transactions.filter(
    (t) =>
      t.kind === "in" &&
      (t.source === "insurer" || t.source === "collection") &&
      t.date >= f.from &&
      t.date <= f.to &&
      pass(f.department, t.department) &&
      pass(f.method, t.method ?? "cash"),
  );
  const sum = (k: keyof RevenueLine) => r2(lines.reduce((s, l) => s + (l[k] as number), 0));
  const net = sum("total");
  const refundTotal = r2(refunds.reduce((s, r) => s + r.amount, 0));
  return {
    lines,
    refunds,
    collections,
    totals: {
      count: lines.length,
      gross: sum("subtotal"),
      discount: sum("discount"),
      net,
      insurer: sum("insurer"),
      paid: sum("paid"),
      remaining: sum("remaining"),
      refunds: refundTotal,
      /** Receipts net of discounts, minus refunds paid back in the period. */
      netAfterRefunds: r2(net - refundTotal),
      collections: r2(collections.reduce((s, t) => s + t.amount, 0)),
    },
    byDepartment: groupRows(lines, (l) => ({ key: l.department, label: l.departmentName }), (l) => l.total),
    byService: groupRows(
      serviceRows,
      (s) => ({ key: `${s.department}|${s.description}`, label: `${s.description} — ${dept(s.department)}` }),
      (s) => s.total,
      (s) => s.qty,
    ),
    byDoctor: groupRows(lines, (l) => ({ key: l.doctor || "-", label: l.doctor ? `د. ${l.doctor}` : "بدون طبيب" }), (l) => l.total),
    byMethod: groupRows(lines, (l) => ({ key: l.method, label: l.method }), (l) => l.paid),
    byCashier: groupRows(lines, (l) => ({ key: l.cashier, label: l.cashier }), (l) => l.paid),
    byDay: groupRows(lines, (l) => dayKey(l.date), (l) => l.total, () => 1, true),
  };
}

/* ---------------- Payments (money out) ---------------- */

/** Money out that is a movement, not a payment (shift shortage differences). */
const NOT_PAYMENT = new Set<string>(["shift"]);

export interface PaymentLine {
  id: string;
  date: string;
  number: string;
  description: string;
  source: string;
  sourceLabel: string;
  category: string;
  categoryLabel: string;
  department: string;
  departmentName: string;
  box: string;
  boxName: string;
  paidTo: string;
  by: string;
  amount: number;
}

export function categoryLabel(db: Pick<HospitalDB, "lists">, t: Pick<Transaction, "source" | "category">) {
  if (!t.category) return "بدون تصنيف";
  return listLabel(t.source === "petty" ? db.lists.pettyCategories : db.lists.expenseCategories, t.category);
}

function paymentLine(db: HospitalDB, t: Transaction): PaymentLine {
  const box = t.boxId ?? "main";
  return {
    id: t.id,
    date: t.date,
    number: t.receiptId,
    description: t.description,
    source: t.source,
    sourceLabel: TX_SOURCE_LABELS[t.source] ?? t.source,
    category: t.category ?? "",
    categoryLabel: categoryLabel(db, t),
    department: t.department,
    departmentName: findDepartment(db.departments, t.department).name,
    box,
    boxName: findBox(db, box).name,
    paidTo: t.paidTo?.trim() || "غير محدد",
    by: t.by || "",
    amount: t.amount,
  };
}

export function paymentsReport(db: HospitalDB, f: ReportFilters) {
  const lines = db.transactions
    .filter(
      (t) =>
        t.kind === "out" &&
        !NOT_PAYMENT.has(t.source) &&
        t.date >= f.from &&
        t.date <= f.to &&
        pass(f.department, t.department) &&
        pass(f.source, t.source) &&
        pass(f.box, t.boxId ?? "main") &&
        pass(f.category, t.category ?? ""),
    )
    .map((t) => paymentLine(db, t))
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  const days = new Set(lines.map((l) => l.date)).size;
  const byCategory = groupRows(lines, (l) => ({ key: `${l.source === "petty" ? "p" : "e"}:${l.category}`, label: l.categoryLabel }), (l) => l.amount);
  return {
    lines,
    totals: {
      total,
      count: lines.length,
      /** Average per day that had any payment. */
      perDay: days ? r2(total / days) : 0,
      largest: byCategory[0]?.label ?? "—",
    },
    bySource: groupRows(lines, (l) => ({ key: l.source, label: l.sourceLabel }), (l) => l.amount),
    byCategory,
    byDepartment: groupRows(lines, (l) => ({ key: l.department, label: l.departmentName }), (l) => l.amount),
    byBox: groupRows(lines, (l) => ({ key: l.box, label: l.boxName }), (l) => l.amount),
    byPaidTo: groupRows(lines, (l) => ({ key: l.paidTo, label: l.paidTo }), (l) => l.amount),
    byDay: groupRows(lines, (l) => dayKey(l.date), (l) => l.amount, () => 1, true),
  };
}

/* ---------------- Petty cash ---------------- */

export interface PettyLine extends PaymentLine {
  requestedBy: string;
  requestNumber: string;
}

export function pettyReport(db: HospitalDB, f: ReportFilters) {
  const requestOf = new Map(db.pettyRequests.map((r) => [r.id, r]));
  const lines: PettyLine[] = db.transactions
    .filter(
      (t) =>
        t.kind === "out" &&
        t.source === "petty" &&
        t.date >= f.from &&
        t.date <= f.to &&
        pass(f.department, t.department) &&
        pass(f.category, t.category ?? "") &&
        pass(f.box, t.boxId ?? "main"),
    )
    .map((t) => {
      const req = t.ref ? requestOf.get(t.ref) : undefined;
      return { ...paymentLine(db, t), requestedBy: req?.requestedBy ?? t.by ?? "صرف مباشر", requestNumber: req?.number ?? "" };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const requests: PettyRequest[] = db.pettyRequests
    .filter(
      (r) =>
        r.date >= f.from &&
        r.date <= f.to &&
        pass(f.department, r.department) &&
        pass(f.category, r.category) &&
        pass(f.status, r.status),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));
  const byStatus = (Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => {
    const list = requests.filter((r) => r.status === s);
    return { status: s, label: ORDER_STATUS_LABELS[s], count: list.length, amount: r2(list.reduce((x, r) => x + r.amount, 0)) };
  });
  return {
    lines,
    requests,
    byStatus,
    totals: {
      total,
      count: lines.length,
      average: lines.length ? r2(total / lines.length) : 0,
      pending: byStatus.find((s) => s.status === "pending")!,
      approved: byStatus.find((s) => s.status === "approved")!,
      rejected: byStatus.find((s) => s.status === "rejected")!,
    },
    byCategory: groupRows(lines, (l) => ({ key: l.category, label: l.categoryLabel }), (l) => l.amount),
    byDepartment: groupRows(lines, (l) => ({ key: l.department, label: l.departmentName }), (l) => l.amount),
    byRequester: groupRows(lines, (l) => ({ key: l.requestedBy, label: l.requestedBy }), (l) => l.amount),
    byBox: groupRows(lines, (l) => ({ key: l.box, label: l.boxName }), (l) => l.amount),
    byMonth: groupRows(lines, (l) => monthKey(l.date), (l) => l.amount, () => 1, true),
    byDay: groupRows(lines, (l) => dayKey(l.date), (l) => l.amount, () => 1, true),
  };
}
