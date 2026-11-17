/**
 * Pure money rules for invoices, purchases, assets and period closing.
 * Egyptian rules: VAT 14% (Law 67/2016); withholding tax (ضريبة الخصم تحت حساب الضريبة)
 * 1% supplies, 3% services, 5% professional fees, applied from 300 EGP per invoice,
 * computed on the amount before VAT. Medical services are VAT-exempt.
 */
import type { LedgerDepartment } from "./constants";

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- Patient invoices ---------- */
export interface InvoiceItemInput {
  description: string;
  qty: number;
  unitPrice: number;
}
export function patientInvoiceTotals(items: InvoiceItemInput[], discount: number) {
  const subtotal = round2(
    items.reduce((s, i) => s + Math.max(0, i.qty || 0) * Math.max(0, i.unitPrice || 0), 0),
  );
  const disc = round2(Math.min(Math.max(0, discount || 0), subtotal));
  return { subtotal, discount: disc, total: round2(subtotal - disc) };
}

/* ---------- Supplier invoices ---------- */
export const VAT_RATE = 0.14;
export const WHT_THRESHOLD = 300;
export const WHT_TYPES = {
  none: { label: "غير خاضع", rate: 0 },
  supplies: { label: "توريدات (١٪)", rate: 0.01 },
  services: { label: "خدمات ومقاولات (٣٪)", rate: 0.03 },
  professional: { label: "أتعاب مهنية وعمولات (٥٪)", rate: 0.05 },
} as const;
export type WhtType = keyof typeof WHT_TYPES;

export function supplierInvoiceTotals(subtotal: number, vatApplicable: boolean, whtType: WhtType) {
  const base = round2(Math.max(0, subtotal || 0));
  const vat = vatApplicable ? round2(base * VAT_RATE) : 0;
  const wht = base >= WHT_THRESHOLD ? round2(base * WHT_TYPES[whtType].rate) : 0;
  const total = round2(base + vat);
  return { subtotal: base, vat, wht, total, payable: round2(total - wht) };
}

/* ---------- Assets ---------- */
/** Straight-line book value per unit at a given date ("YYYY-MM-DD"), counting whole months used. */
export function assetValuation(
  unitCost: number,
  quantity: number,
  purchaseDate: string,
  usefulLifeYears: number,
  asOf: string,
) {
  const [py, pm] = purchaseDate.split("-").map(Number) as [number, number];
  const [ay, am] = asOf.split("-").map(Number) as [number, number];
  const months = Math.max(0, (ay - py) * 12 + (am - pm));
  const cost = round2(Math.max(0, unitCost) * Math.max(1, quantity));
  const lifeMonths = Math.max(1, usefulLifeYears * 12);
  const depreciation = round2(Math.min(cost, (cost / lifeMonths) * months));
  return { cost, depreciation, bookValue: round2(cost - depreciation), monthsUsed: months };
}

/* ---------- Closing ---------- */
export interface LedgerTx {
  id: string;
  date: string;
  department: LedgerDepartment;
  kind: "in" | "out";
  amount: number;
  description: string;
  receiptId: string;
  source: string;
  createdAt: number;
}

/** Departments that actually have entries, ordered like the hospital's department list. */
function activeDepts(txs: LedgerTx[], order: string[]) {
  const ids = [...new Set(txs.map((t) => t.department))];
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return ids.sort((a, b) => rank(a) - rank(b));
}
const isOperating = (t: LedgerTx) => t.source !== "opening";
const sum = (txs: LedgerTx[], kind: "in" | "out") =>
  round2(txs.filter((t) => t.kind === kind).reduce((s, t) => s + t.amount, 0));

export function monthlyClosing(txs: LedgerTx[], period: string, order: string[] = []) {
  const inPeriod = txs
    .filter((t) => isOperating(t) && t.date.startsWith(period))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const departments = activeDepts(inPeriod, order).map((dept) => {
    const rows = inPeriod.filter((t) => t.department === dept);
    const totalIn = sum(rows, "in");
    const totalOut = sum(rows, "out");
    return {
      dept,
      ins: rows.filter((t) => t.kind === "in"),
      outs: rows.filter((t) => t.kind === "out"),
      totalIn,
      totalOut,
      net: round2(totalIn - totalOut),
    };
  });
  const totalIn = sum(inPeriod, "in");
  const totalOut = sum(inPeriod, "out");
  return { departments, totalIn, totalOut, net: round2(totalIn - totalOut) };
}

export function annualClosing(txs: LedgerTx[], year: number, order: string[] = []) {
  const inYear = txs.filter((t) => isOperating(t) && t.date.startsWith(`${year}-`));
  const depts = activeDepts(inYear, order);
  const months = Array.from({ length: 12 }, (_, i) => {
    const period = `${year}-${String(i + 1).padStart(2, "0")}`;
    const rows = inYear.filter((t) => t.date.startsWith(period));
    const totalIn = sum(rows, "in");
    const totalOut = sum(rows, "out");
    return {
      period,
      totalIn,
      totalOut,
      net: round2(totalIn - totalOut),
      byDept: depts.map((dept) => {
        const r = rows.filter((t) => t.department === dept);
        return round2(sum(r, "in") - sum(r, "out"));
      }),
    };
  });
  const byDept = depts.map((dept) => {
    const r = inYear.filter((t) => t.department === dept);
    const totalIn = sum(r, "in");
    const totalOut = sum(r, "out");
    return { dept, totalIn, totalOut, net: round2(totalIn - totalOut) };
  });
  const totalIn = sum(inYear, "in");
  const totalOut = sum(inYear, "out");
  return { months, byDept, depts, totalIn, totalOut, net: round2(totalIn - totalOut) };
}

/* ---------- Outpatient / inpatient invoices with insurance split ---------- */
const DAY = 86_400_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n || 0));

/** Nights of stay between two "YYYY-MM-DD" dates; a same-day admission counts as one day. */
export function stayDays(admitDate: string, dischargeDate: string) {
  const a = Date.parse(`${admitDate}T00:00:00Z`);
  const d = Date.parse(`${dischargeDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(d)) return 1;
  return Math.max(1, Math.round((d - a) / DAY));
}

export interface StayInput {
  admitDate: string;
  dischargeDate: string;
  roomRate: number;
  supervisionRate: number;
}
export interface InvoiceAmountsInput {
  items: (InvoiceItemInput & { kind?: string | undefined })[];
  discount: number;
  kind?: "outpatient" | "inpatient" | undefined;
  stay?: StayInput | undefined;
  payer?: { payerId: string; percent: number } | undefined;
  credit?: { amount: number } | undefined;
}

/**
 * Full invoice math. Inpatient invoices add accommodation and medical supervision per day of
 * stay. When an insurer / syndicate covers a percentage, the net is split into the insurer's
 * share (a receivable) and the patient's share (collected in cash now).
 */
export function invoiceAmounts(inv: InvoiceAmountsInput) {
  const items = patientInvoiceTotals(inv.items, 0).subtotal;
  const inpatient = inv.kind === "inpatient" && !!inv.stay;
  const days = inpatient ? stayDays(inv.stay!.admitDate, inv.stay!.dischargeDate) : 0;
  const room = inpatient ? round2(days * Math.max(0, inv.stay!.roomRate || 0)) : 0;
  const supervision = inpatient ? round2(days * Math.max(0, inv.stay!.supervisionRate || 0)) : 0;
  const subtotal = round2(items + room + supervision);
  const discount = round2(clamp(inv.discount, 0, subtotal));
  const total = round2(subtotal - discount);
  const percent = inv.payer ? clamp(inv.payer.percent, 0, 100) : 0;
  const insurerShare = round2((total * percent) / 100);
  return {
    items,
    days,
    room,
    supervision,
    subtotal,
    discount,
    total,
    coverage: percent,
    insurerShare,
    patientShare: round2(total - insurerShare),
    /** Part of the patient's share put on a credit account. */
    credit: round2(clamp(inv.credit?.amount ?? 0, 0, total - insurerShare)),
    /** Collected at the desk now. */
    paidNow: round2(total - insurerShare - clamp(inv.credit?.amount ?? 0, 0, total - insurerShare)),
  };
}

/** Receipt: what stays on the patient after paying `paid` of `due` now (never negative). */
export function remainingAfterPayment(due: number, paid: number) {
  return round2(Math.max(0, (due || 0) - Math.max(0, paid || 0)));
}

/* ---------- Doctors' dues ---------- */
export interface DoctorTerms {
  id: string;
  monthlySalary: number;
  consultPercent: number;
  surgeryFee: number;
  supervisionPerDay: number;
}
export interface DoctorInvoiceInput extends InvoiceAmountsInput {
  date: string;
  doctorId?: string | undefined;
  /** Operating theatre: the anaesthetist earns the per-surgery fee on the receipt's surgeries. */
  anesthetistId?: string | undefined;
}

/**
 * A doctor's dues for a period ("YYYY-MM"): fixed salary + % of consultation lines +
 * a flat fee per surgery + supervision per inpatient day, minus what was already paid.
 */
export function doctorDues(
  doctor: DoctorTerms,
  invoices: DoctorInvoiceInput[],
  payouts: { doctorId: string; period: string; amount: number }[],
  period: string,
) {
  const mine = invoices.filter(
    (i) => (i.doctorId === doctor.id || i.anesthetistId === doctor.id) && i.date.startsWith(period),
  );
  let consultBase = 0;
  let surgeries = 0;
  let days = 0;
  for (const inv of mine) {
    if (inv.doctorId !== doctor.id) {
      // Anaesthetist on this receipt: only the surgeries count.
      for (const it of inv.items) if (it.kind === "surgery") surgeries += Math.max(0, it.qty || 0);
      continue;
    }
    for (const it of inv.items) {
      const value = Math.max(0, it.qty || 0) * Math.max(0, it.unitPrice || 0);
      if (it.kind === "consult") consultBase += value;
      if (it.kind === "surgery") surgeries += Math.max(0, it.qty || 0);
    }
    if (inv.kind === "inpatient" && inv.stay)
      days += stayDays(inv.stay.admitDate, inv.stay.dischargeDate);
  }
  const salary = round2(Math.max(0, doctor.monthlySalary || 0));
  const consult = round2((consultBase * clamp(doctor.consultPercent, 0, 100)) / 100);
  const surgery = round2(surgeries * Math.max(0, doctor.surgeryFee || 0));
  const supervision = round2(days * Math.max(0, doctor.supervisionPerDay || 0));
  const total = round2(salary + consult + surgery + supervision);
  const paid = round2(
    payouts
      .filter((p) => p.doctorId === doctor.id && p.period === period)
      .reduce((s, p) => s + p.amount, 0),
  );
  return {
    invoices: mine.length,
    salary,
    consultBase: round2(consultBase),
    consult,
    surgeries,
    surgery,
    supervisionDays: days,
    supervision,
    total,
    paid,
    remaining: round2(total - paid),
  };
}

/* ---------- Cost centers (accrual view per department) ---------- */
export interface CostCenterInputs {
  invoices: (InvoiceAmountsInput & { date: string; department: string })[];
  supplierInvoices: {
    date: string;
    department: string;
    subtotal: number;
    vatApplicable: boolean;
    whtType: WhtType;
  }[];
  transactions: {
    date: string;
    department: string;
    kind: "in" | "out";
    amount: number;
    source: string;
  }[];
  assets: {
    department: string;
    unitCost: number;
    quantity: number;
    purchaseDate: string;
    usefulLifeYears: number;
    condition?: string;
  }[];
}

/** Next period start: "2026-11" → "2026-12-01", "2026" → "2027-01-01". */
function rangeBounds(prefix: string) {
  if (prefix.length === 4) {
    const y = Number(prefix);
    return { start: `${y}-01-01`, end: `${y + 1}-01-01` };
  }
  const [y, m] = prefix.split("-").map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start: `${prefix}-01`, end: `${ny}-${String(nm).padStart(2, "0")}-01` };
}

/**
 * Revenue, operating expenses, depreciation and profit per department for a month
 * ("YYYY-MM") or a year ("YYYY"). Revenue is the full invoice value (patient + insurer share)
 * plus manual income; expenses are supplier invoices (incl. VAT), payroll, doctors' payouts,
 * manual expenses and the period's straight-line depreciation of the department's assets.
 */
const OTHER_COST_SOURCES = new Set(["manual", "expense", "petty", "payment-order"]);
export function costCenters(data: CostCenterInputs, prefix: string, order: string[] = []) {
  const { start, end } = rangeBounds(prefix);
  const rows = new Map<
    string,
    {
      revenue: number;
      supplies: number;
      payroll: number;
      doctors: number;
      other: number;
      depreciation: number;
    }
  >();
  const row = (d: string) => {
    if (!rows.has(d))
      rows.set(d, { revenue: 0, supplies: 0, payroll: 0, doctors: 0, other: 0, depreciation: 0 });
    return rows.get(d)!;
  };
  for (const inv of data.invoices)
    if (inv.date.startsWith(prefix)) row(inv.department).revenue += invoiceAmounts(inv).total;
  for (const s of data.supplierInvoices)
    if (s.date.startsWith(prefix))
      row(s.department).supplies += supplierInvoiceTotals(
        s.subtotal,
        s.vatApplicable,
        s.whtType,
      ).total;
  for (const t of data.transactions) {
    if (!t.date.startsWith(prefix)) continue;
    if (t.kind === "in" && t.source === "manual") row(t.department).revenue += t.amount;
    // Money paid back to patients for cancelled services reduces the department's revenue.
    if (t.kind === "out" && t.source === "refund") row(t.department).revenue -= t.amount;
    if (t.kind === "out") {
      if (t.source === "payroll") row(t.department).payroll += t.amount;
      else if (t.source === "doctor") row(t.department).doctors += t.amount;
      // Registered expenses, petty cash and paid payment orders are operating costs too.
      else if (OTHER_COST_SOURCES.has(t.source)) row(t.department).other += t.amount;
    }
  }
  for (const a of data.assets) {
    const dep =
      assetValuation(a.unitCost, a.quantity, a.purchaseDate, a.usefulLifeYears, end).depreciation -
      assetValuation(a.unitCost, a.quantity, a.purchaseDate, a.usefulLifeYears, start).depreciation;
    if (dep > 0) row(a.department).depreciation += dep;
  }
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  const list = [...rows.entries()]
    .map(([dept, r]) => {
      const expenses = round2(r.supplies + r.payroll + r.doctors + r.other + r.depreciation);
      const revenue = round2(r.revenue);
      const profit = round2(revenue - expenses);
      return {
        dept,
        revenue,
        supplies: round2(r.supplies),
        payroll: round2(r.payroll),
        doctors: round2(r.doctors),
        other: round2(r.other),
        depreciation: round2(r.depreciation),
        expenses,
        profit,
        margin: revenue > 0 ? round2((profit / revenue) * 100) : null,
      };
    })
    .filter((r) => r.revenue || r.expenses)
    .sort((a, b) => rank(a.dept) - rank(b.dept));
  const totals = list.reduce(
    (s, r) => ({
      revenue: round2(s.revenue + r.revenue),
      expenses: round2(s.expenses + r.expenses),
      depreciation: round2(s.depreciation + r.depreciation),
      profit: round2(s.profit + r.profit),
    }),
    { revenue: 0, expenses: 0, depreciation: 0, profit: 0 },
  );
  const byProfit = [...list].sort((a, b) => b.profit - a.profit);
  const byExpense = [...list].sort((a, b) => b.expenses - a.expenses);
  return {
    rows: list,
    totals,
    mostProfitable: byProfit[0] && byProfit[0].profit > 0 ? byProfit[0] : null,
    highestExpense: byExpense[0] && byExpense[0].expenses > 0 ? byExpense[0] : null,
  };
}

/* ---------- Stock (drugs, consumables, lab chemicals) ---------- */
export interface StockMoveInput {
  itemId: string;
  type: "in" | "out";
  qty: number;
  date: string;
  batchNo?: string | undefined;
  expiry?: string | undefined;
  unitCost?: number | undefined;
}
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Balance and per-batch remaining quantities. Issues are taken from the batch that expires
 * first (FEFO). Flags expired stock, stock expiring within `nearDays`, and reorder alerts.
 */
export function stockStatus(
  item: { id: string; reorderLevel: number },
  moves: StockMoveInput[],
  today: string,
  nearDays = 60,
) {
  const mine = moves.filter((m) => m.itemId === item.id);
  const batches = mine
    .filter((m) => m.type === "in")
    .map((m) => ({
      batchNo: m.batchNo ?? "",
      expiry: m.expiry ?? "",
      unitCost: m.unitCost ?? 0,
      received: Math.max(0, m.qty),
      remaining: Math.max(0, m.qty),
      date: m.date,
    }))
    .sort(
      (a, b) =>
        (a.expiry || "9999").localeCompare(b.expiry || "9999") || a.date.localeCompare(b.date),
    );
  let toIssue = mine.filter((m) => m.type === "out").reduce((s, m) => s + Math.max(0, m.qty), 0);
  for (const b of batches) {
    const take = Math.min(b.remaining, toIssue);
    b.remaining -= take;
    toIssue -= take;
  }
  const received = batches.reduce((s, b) => s + b.received, 0);
  const issued = mine.filter((m) => m.type === "out").reduce((s, m) => s + Math.max(0, m.qty), 0);
  const balance = round2(received - issued);
  const live = batches.filter((b) => b.remaining > 0);
  const limit = addDays(today, nearDays);
  const expired = live.filter((b) => b.expiry && b.expiry < today);
  const near = live.filter((b) => b.expiry && b.expiry >= today && b.expiry <= limit);
  return {
    received,
    issued,
    balance,
    batches: live,
    value: round2(live.reduce((s, b) => s + b.remaining * b.unitCost, 0)),
    expiredQty: expired.reduce((s, b) => s + b.remaining, 0),
    nearExpiryQty: near.reduce((s, b) => s + b.remaining, 0),
    nextExpiry:
      live
        .map((b) => b.expiry)
        .filter(Boolean)
        .sort()[0] ?? null,
    belowReorder: balance <= Math.max(0, item.reorderLevel || 0),
  };
}

/* ---------- Supplier accounts ---------- */
export interface SupplierInvoiceAcct {
  id: string;
  number: string;
  date: string;
  supplierName: string;
  description: string;
  subtotal: number;
  vatApplicable: boolean;
  whtType: WhtType;
  terms?: "cash" | "credit" | undefined;
  createdAt: number;
}
export interface SupplierPaymentAcct {
  id: string;
  number: string;
  date: string;
  supplierName: string;
  amount: number;
  note?: string | undefined;
  createdAt: number;
}
const sameSupplier = (a: string, b: string) => a.trim() === b.trim();

/**
 * Statement of account for one supplier: each invoice adds what we owe (amount after
 * withholding tax); each payment reduces it. Cash invoices are settled on the same line.
 */
export function supplierStatement(
  invoices: SupplierInvoiceAcct[],
  payments: SupplierPaymentAcct[],
  supplierName: string,
) {
  type Row = {
    date: string;
    ref: string;
    description: string;
    debit: number;
    credit: number;
    createdAt: number;
  };
  const rows: Row[] = [];
  for (const inv of invoices.filter((i) => sameSupplier(i.supplierName, supplierName))) {
    const payable = supplierInvoiceTotals(inv.subtotal, inv.vatApplicable, inv.whtType).payable;
    rows.push({
      date: inv.date,
      ref: inv.number,
      description: `فاتورة ${inv.terms === "credit" ? "آجلة" : "نقدية"}: ${inv.description}`,
      debit: payable,
      credit: inv.terms === "credit" ? 0 : payable,
      createdAt: inv.createdAt,
    });
  }
  for (const p of payments.filter((x) => sameSupplier(x.supplierName, supplierName)))
    rows.push({
      date: p.date,
      ref: p.number,
      description: p.note ? `سداد: ${p.note}` : "سداد للمورد",
      debit: 0,
      credit: p.amount,
      createdAt: p.createdAt,
    });
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let bal = 0;
  const lines = rows.map((r) => {
    bal = round2(bal + r.debit - r.credit);
    return { ...r, balance: bal };
  });
  const debit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const credit = round2(rows.reduce((s, r) => s + r.credit, 0));
  return { lines, debit, credit, balance: round2(debit - credit) };
}

/** Every supplier with what was invoiced, paid and is still due. */
export function supplierBalances(invoices: SupplierInvoiceAcct[], payments: SupplierPaymentAcct[]) {
  const names = [...new Set([...invoices, ...payments].map((x) => x.supplierName.trim()))].filter(
    Boolean,
  );
  return names
    .map((name) => {
      const s = supplierStatement(invoices, payments, name);
      const last = s.lines[s.lines.length - 1]?.date ?? "";
      return { name, invoiced: s.debit, paid: s.credit, balance: s.balance, lastDate: last };
    })
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "ar"));
}

/* ---------- Cash drawers & shifts ---------- */
export interface CashTx {
  kind: "in" | "out";
  amount: number;
  boxId?: string | undefined;
  method?: string | undefined;
  shiftId?: string | undefined;
}
export interface CashTransfer {
  from: string;
  to: string;
  amount: number;
}

/** Balance of one cash box: its own entries plus transfers in, minus transfers out. */
export function boxBalance(
  boxId: string,
  txs: CashTx[],
  transfers: CashTransfer[],
  mainId = "main",
) {
  const own = txs
    .filter((t) => (t.boxId ?? mainId) === boxId)
    .reduce((s, t) => s + (t.kind === "in" ? t.amount : -t.amount), 0);
  const moved = transfers.reduce(
    (s, t) => s + (t.to === boxId ? t.amount : 0) - (t.from === boxId ? t.amount : 0),
    0,
  );
  return round2(own + moved);
}

/**
 * What the drawer should hold at the end of a shift, per payment method: the opening cash
 * float plus every receipt minus every payment recorded during the shift.
 */
export function shiftExpected(
  shift: { id: string; openingFloat: number },
  txs: CashTx[],
  cashMethod = "cash",
) {
  const out: Record<string, number> = {
    [cashMethod]: round2(Math.max(0, shift.openingFloat || 0)),
  };
  for (const t of txs.filter((x) => x.shiftId === shift.id)) {
    const m = t.method || cashMethod;
    out[m] = round2((out[m] ?? 0) + (t.kind === "in" ? t.amount : -t.amount));
  }
  return out;
}

/** Counted minus expected per method; negative = shortage (عجز), positive = surplus (زيادة). */
export function shiftDifferences(
  expected: Record<string, number>,
  counted: Record<string, number>,
) {
  const methods = [...new Set([...Object.keys(expected), ...Object.keys(counted)])];
  const rows = methods.map((m) => {
    const e = round2(expected[m] ?? 0);
    const c = round2(counted[m] ?? 0);
    return { method: m, expected: e, counted: c, diff: round2(c - e) };
  });
  return {
    rows,
    expected: round2(rows.reduce((s, r) => s + r.expected, 0)),
    counted: round2(rows.reduce((s, r) => s + r.counted, 0)),
    diff: round2(rows.reduce((s, r) => s + r.diff, 0)),
  };
}

/* ---------- Analytic accounting: shared-cost allocation ---------- */
export interface CenterRow {
  dept: string;
  revenue: number;
  expenses: number;
}

/**
 * Spreads the costs of shared (service / administrative) cost centers over the revenue-earning
 * centers in proportion to their revenue (or equally when nobody earned anything), so each
 * clinical department carries its fair share of overheads. Shared centers end at zero.
 */
export function allocateSharedCosts<T extends CenterRow>(rows: T[], sharedIds: Set<string>, basis: "revenue" | "equal" = "revenue") {
  const shared = rows.filter((r) => sharedIds.has(r.dept));
  const pool = round2(shared.reduce((s, r) => s + r.expenses - r.revenue, 0));
  const earners = rows.filter((r) => !sharedIds.has(r.dept));
  const totalRev = earners.reduce((s, r) => s + Math.max(0, r.revenue), 0);
  const useEqual = basis === "equal" || totalRev <= 0;
  let given = 0;
  const out = rows.map((r) => {
    if (sharedIds.has(r.dept)) return { ...r, allocated: round2(r.revenue - r.expenses), afterAllocation: 0 };
    return { ...r, allocated: 0, afterAllocation: round2(r.revenue - r.expenses) };
  });
  const earnerRows = out.filter((r) => !sharedIds.has(r.dept));
  earnerRows.forEach((r, i) => {
    const share = i === earnerRows.length - 1
      ? round2(pool - given)
      : round2(pool * (useEqual ? 1 / earnerRows.length : Math.max(0, r.revenue) / totalRev));
    given = round2(given + share);
    r.allocated = share;
    r.afterAllocation = round2(r.revenue - r.expenses - share);
  });
  return { rows: out, pool: earnerRows.length ? pool : 0 };
}
