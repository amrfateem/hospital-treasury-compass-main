/**
 * General ledger (القيود اليومية ودفتر الأستاذ). Pure: every record the hospital keeps
 * (receipts, insurer collections, supplier invoices & payments, treasury entries, transfers,
 * fixed assets & depreciation, e-invoice VAT) is turned into a balanced double-entry journal
 * entry that points back at its source document. Reports (trial balance, income statement,
 * balance sheet, account ledger, daily cash flow) are computed from these entries, so every
 * number can be opened down to the entry that produced it.
 */
import { assetValuation, invoiceAmounts, supplierInvoiceTotals } from "./finance";
import { eInvoiceTotals } from "./eta";
import type { HospitalDB } from "./model";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "الأصول",
  liability: "الالتزامات",
  equity: "حقوق الملكية",
  revenue: "الإيرادات",
  expense: "المصروفات",
};

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  /** Parent group code (e.g. "1100"). */
  group: string;
}

/** Fixed group accounts; sub-accounts are "<group>-<id>". */
export const GROUPS: Record<string, { name: string; type: AccountType }> = {
  "1100": { name: "النقدية بالخزينة الرئيسية", type: "asset" },
  "1200": { name: "الحسابات البنكية", type: "asset" },
  "1300": { name: "مستحقات شركات التأمين والتعاقدات", type: "asset" },
  "1350": { name: "ذمم المرضى والشركات المتعاقدة (آجل)", type: "asset" },
  "1400": { name: "ضريبة القيمة المضافة — مدخلات", type: "asset" },
  "1500": { name: "الأصول الثابتة (بالتكلفة)", type: "asset" },
  "1590": { name: "مجمع إهلاك الأصول الثابتة", type: "asset" },
  "1600": { name: "مصروفات مدفوعة مقدمًا", type: "asset" },
  "1700": { name: "سلف العاملين وأرصدة مدينة أخرى", type: "asset" },
  "2100": { name: "الموردون (دائنون)", type: "liability" },
  "2200": { name: "ضريبة الخصم والتحصيل المستحقة للمصلحة", type: "liability" },
  "2300": { name: "ضريبة القيمة المضافة — مخرجات", type: "liability" },
  "2400": { name: "مصروفات مستحقة", type: "liability" },
  "2500": { name: "إيرادات مقدمة وأرصدة دائنة أخرى", type: "liability" },
  "2600": { name: "قروض وتمويل", type: "liability" },
  "3100": { name: "رأس المال والأرصدة الافتتاحية", type: "equity" },
  "3200": { name: "الأرباح المحتجزة وأرباح الفترة", type: "equity" },
  "4100": { name: "إيرادات الخدمات الطبية", type: "revenue" },
  "4200": { name: "إيرادات أخرى", type: "revenue" },
  "4300": { name: "زيادة تقفيل الورديات", type: "revenue" },
  "5100": { name: "المشتريات والمصروفات التشغيلية", type: "expense" },
  "5200": { name: "الأجور والمرتبات", type: "expense" },
  "5300": { name: "أتعاب ومستحقات الأطباء", type: "expense" },
  "5400": { name: "النثريات", type: "expense" },
  "5500": { name: "مصروفات أخرى", type: "expense" },
  "5600": { name: "إهلاك الأصول الثابتة", type: "expense" },
  "5700": { name: "عجز تقفيل الورديات", type: "expense" },
  "5800": { name: "مصروفات تمويلية وفوائد", type: "expense" },
  "5900": { name: "مصروفات وتسويات أخرى", type: "expense" },
};

/**
 * Accounts kept by their own screens (cash & banks, insurers, credit accounts, suppliers): a manual
 * entry must not touch them, or the treasury / statements would disagree with the ledger.
 */
export const CONTROLLED_GROUPS = ["1100", "1200", "1300", "1350", "2100"];
export const isControlled = (code: string) => CONTROLLED_GROUPS.includes(groupOf(code));
export const groupOf = (code: string) => code.split("-")[0]!;
export const typeOf = (code: string): AccountType => GROUPS[groupOf(code)]?.type ?? "expense";
/** Debit-normal accounts grow with debits. */
export const debitNormal = (code: string) => {
  const t = typeOf(code);
  return (t === "asset" && groupOf(code) !== "1590") || t === "expense";
};

export type EntrySource =
  | "patient-invoice"
  | "supplier-invoice"
  | "transaction"
  | "transfer"
  | "asset"
  | "depreciation"
  | "e-invoice"
  | "credit-charge"
  | "advance-deduction"
  | "manual";
export const ENTRY_SOURCE_LABELS: Record<EntrySource, string> = {
  "patient-invoice": "إيصال / فاتورة مريض",
  "supplier-invoice": "فاتورة مورد",
  transaction: "حركة خزينة",
  transfer: "تحويل بين الخزائن والبنوك",
  asset: "إثبات أصل ثابت",
  depreciation: "إهلاك شهري",
  "e-invoice": "فاتورة إلكترونية (ضريبة)",
  "credit-charge": "مديونية على حساب آجل",
  "advance-deduction": "خصم قسط سلفة من المرتب",
  manual: "قيد يدوي (المحاسب)",
};

export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
  /** Cost center (department) for analytic accounting. */
  costCenter?: string | undefined;
}

export interface JournalEntry {
  id: string;
  date: string;
  number: string;
  description: string;
  source: EntrySource;
  sourceId: string;
  /** Treasury source of a "transaction" entry (expense, payroll...). */
  txSource?: string | undefined;
  createdAt: number;
  lines: JournalLine[];
}

type DB = Pick<
  HospitalDB,
  | "patientInvoices"
  | "supplierInvoices"
  | "transactions"
  | "transfers"
  | "assets"
  | "cashboxes"
  | "lists"
  | "eInvoices"
> &
  Partial<Pick<HospitalDB, "journalEntries" | "creditCharges" | "creditAccounts" | "customAccounts" | "advances">>;

const dr = (account: string, amount: number, costCenter?: string): JournalLine => ({
  account,
  debit: round2(amount),
  credit: 0,
  costCenter,
});
const cr = (account: string, amount: number, costCenter?: string): JournalLine => ({
  account,
  debit: 0,
  credit: round2(amount),
  costCenter,
});

/** First day of the month after `period` ("YYYY-MM"). */
function nextMonthStart(period: string) {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Last day of `period` ("YYYY-MM"). */
function lastDay(period: string) {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Chart of accounts for this hospital (groups + one sub-account per box, bank, category). */
export function chartOfAccounts(
  db: Pick<DB, "cashboxes" | "lists" | "creditAccounts" | "customAccounts">,
): Account[] {
  const out: Account[] = Object.entries(GROUPS).map(([code, g]) => ({ code, name: g.name, type: g.type, group: code }));
  for (const b of db.cashboxes) {
    const g = b.kind === "bank" ? "1200" : "1100";
    out.push({ code: `${g}-${b.id}`, name: b.name, type: "asset", group: g });
  }
  for (const c of db.lists.expenseCategories)
    out.push({ code: `5100-${c.id}`, name: c.name, type: "expense", group: "5100" });
  for (const c of db.lists.pettyCategories)
    out.push({ code: `5400-${c.id}`, name: c.name, type: "expense", group: "5400" });
  for (const c of db.creditAccounts ?? [])
    out.push({ code: `1350-${c.id}`, name: c.name, type: "asset", group: "1350" });
  for (const c of db.customAccounts ?? [])
    if (GROUPS[c.group]) out.push({ code: c.code, name: c.name, type: GROUPS[c.group]!.type, group: c.group });
  return out;
}

export function accountName(accounts: Account[], code: string) {
  const a = accounts.find((x) => x.code === code);
  if (a) return a.name;
  const g = GROUPS[groupOf(code)];
  return g ? `${g.name} (${code.split("-").slice(1).join("-")})` : code;
}

/** Journal entries for everything recorded up to `asOf` (inclusive). */
export function buildJournal(db: DB, asOf: string): JournalEntry[] {
  const banks = new Set(db.cashboxes.filter((b) => b.kind === "bank").map((b) => b.id));
  const cash = (boxId: string | undefined) => {
    const id = boxId || "main";
    return `${banks.has(id) ? "1200" : "1100"}-${id}`;
  };
  const out: JournalEntry[] = [];
  const push = (e: JournalEntry) => {
    const lines = e.lines.filter((l) => l.debit > 0 || l.credit > 0);
    if (lines.length && e.date <= asOf) out.push({ ...e, lines });
  };

  // Patient receipts: patient share into the drawer, insurer share as a receivable.
  for (const inv of db.patientInvoices) {
    const a = invoiceAmounts(inv);
    push({
      id: `je-inv-${inv.id}`,
      date: inv.date,
      number: inv.number,
      description: `إيراد ${inv.patientName}`,
      source: "patient-invoice",
      sourceId: inv.id,
      createdAt: inv.createdAt,
      lines: [
        // Admission deposits were held as a liability (2500) until this discharge bill.
        dr(cash(inv.boxId), a.paidNow - (inv.depositApplied ?? 0)),
        dr("2500", inv.depositApplied ?? 0),
        dr(`1350-${inv.credit?.accountId ?? "x"}`, a.credit),
        dr("1300", a.insurerShare),
        cr("4100", a.total, inv.department),
      ],
    });
  }

  // Supplier invoices: expense + input VAT, withholding owed to the tax authority.
  for (const s of db.supplierInvoices) {
    const t = supplierInvoiceTotals(s.subtotal, s.vatApplicable, s.whtType);
    const credit = s.terms === "credit";
    push({
      id: `je-sup-${s.id}`,
      date: s.date,
      number: s.number,
      description: `${s.supplierName} — ${s.description}`,
      source: "supplier-invoice",
      sourceId: s.id,
      createdAt: s.createdAt,
      lines: [
        dr(`5100-${s.category}`, t.subtotal, s.department),
        dr("1400", t.vat),
        cr("2200", t.wht),
        cr(credit ? "2100" : cash(s.boxId), t.payable),
      ],
    });
  }

  // Treasury entries (invoice / supplier entries are already covered above).
  for (const t of db.transactions) {
    if (t.source === "invoice" || t.source === "supplier") continue;
    const box = cash(t.boxId);
    const amt = t.amount;
    let lines: JournalLine[];
    if (t.kind === "in") {
      const counter =
        t.source === "insurer"
          ? "1300"
          : t.source === "collection"
            ? `1350-${t.ref}`
            : t.source === "opening"
              ? "3100"
              : t.source === "deposit"
                ? "2500"
                : t.source === "shift"
                ? "4300"
                : "4200";
      lines = [dr(box, amt), cr(counter, amt, counter.startsWith("4") ? t.department : undefined)];
    } else {
      let counter: string;
      if (t.source === "supplier-payment") counter = "2100";
      else if (t.source === "payroll") counter = "5200";
      else if (t.source === "doctor") counter = "5300";
      else if (t.source === "opening") counter = "3100";
      // Refunds reverse revenue, advances are owed back by the employee, deposits go back to the patient.
      else if (t.source === "refund") counter = "4100";
      else if (t.source === "advance") counter = "1700";
      else if (t.source === "deposit") counter = "2500";
      else if (t.source === "shift") counter = "5700";
      else if (t.source === "petty") counter = t.category ? `5400-${t.category}` : "5400";
      else counter = t.category ? `5100-${t.category}` : "5500";
      lines = [dr(counter, amt, counter.startsWith("5") || counter.startsWith("4") ? t.department : undefined), cr(box, amt)];
    }
    push({
      id: `je-tx-${t.id}`,
      date: t.date,
      number: t.receiptId,
      description: t.description,
      source: "transaction",
      sourceId: t.id,
      txSource: t.source,
      createdAt: t.createdAt,
      lines,
    });
  }

  for (const t of db.transfers)
    push({
      id: `je-trf-${t.id}`,
      date: t.date,
      number: t.number,
      description: t.note || "تحويل بين الخزائن",
      source: "transfer",
      sourceId: t.id,
      createdAt: t.createdAt,
      lines: [dr(cash(t.to), t.amount), cr(cash(t.from), t.amount)],
    });

  // Fixed assets: recognised at cost against capital, then depreciated monthly (straight line).
  for (const a of db.assets) {
    const cost = round2(Math.max(0, a.unitCost) * Math.max(1, a.quantity));
    push({
      id: `je-ast-${a.id}`,
      date: a.purchaseDate,
      number: `AST-${a.id.slice(0, 6).toUpperCase()}`,
      description: `إثبات أصل: ${a.name}`,
      source: "asset",
      sourceId: a.id,
      createdAt: 0,
      lines: [dr("1500", cost, a.department), cr("3100", cost)],
    });
    let period = a.purchaseDate.slice(0, 7);
    let prev = 0;
    for (let i = 0; i < 600; i++) {
      const start = nextMonthStart(period);
      if (start > asOf) break;
      const acc = assetValuation(a.unitCost, a.quantity, a.purchaseDate, a.usefulLifeYears, start).depreciation;
      const dep = round2(acc - prev);
      prev = acc;
      if (dep <= 0) break;
      push({
        id: `je-dep-${a.id}-${start}`,
        date: start,
        number: `DEP-${start.slice(0, 7).replace("-", "")}`,
        description: `إهلاك ${a.name} — شهر ${period}`,
        source: "depreciation",
        sourceId: a.id,
        createdAt: 0,
        lines: [dr("5600", dep, a.department), cr("1590", dep)],
      });
      period = start.slice(0, 7);
    }
  }

  // Credit-account debts that did not come from a receipt (opening balances, services).
  for (const c of db.creditCharges ?? [])
    push({
      id: `je-chg-${c.id}`,
      date: c.date,
      number: c.number,
      description: c.description,
      source: "credit-charge",
      sourceId: c.id,
      createdAt: c.createdAt,
      lines: [dr(`1350-${c.accountId}`, c.amount), c.kind === "opening" ? cr("3100", c.amount) : cr("4100", c.amount, c.department)],
    });

  // Advance installments taken from salaries: part of the salary cost, settling the advance.
  for (const adv of db.advances ?? [])
    for (const d of adv.deductions)
      push({
        id: `je-advd-${adv.id}-${d.period}`,
        date: lastDay(d.period),
        number: `${adv.number}-${d.period.replace("-", "")}`,
        description: `قسط سلفة ${adv.employeeName} من مرتب ${d.period}`,
        source: "advance-deduction",
        sourceId: adv.id,
        createdAt: 0,
        lines: [dr("5200", d.amount, adv.department), cr("1700", d.amount)],
      });

  // The accountant's own entries; accruals are reversed automatically on `reverseOn`.
  for (const m of db.journalEntries ?? []) {
    const lines = m.lines.map((l) => ({ account: l.account, debit: round2(l.debit), credit: round2(l.credit), costCenter: l.costCenter }));
    push({ id: `je-man-${m.id}`, date: m.date, number: m.number, description: m.description, source: "manual", sourceId: m.id, createdAt: m.createdAt, lines });
    if (m.reverseOn)
      push({
        id: `je-rev-${m.id}`,
        date: m.reverseOn,
        number: `${m.number}-R`,
        description: `عكس: ${m.description}`,
        source: "manual",
        sourceId: m.id,
        createdAt: m.createdAt + 1,
        lines: lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
      });
  }

  // E-invoices with taxable lines: the VAT part of the receipt belongs to the tax authority.
  for (const e of db.eInvoices) {
    if (e.status === "cancelled" || e.status === "rejected") continue;
    const vat = eInvoiceTotals(e).vat;
    if (vat <= 0) continue;
    push({
      id: `je-ein-${e.id}`,
      date: e.date,
      number: e.number,
      description: `ضريبة قيمة مضافة على ${e.receiver.name}`,
      source: "e-invoice",
      sourceId: e.id,
      createdAt: e.createdAt,
      // Free invoices (rent, services to companies) are collected as other revenue.
      lines: [dr(e.source === "manual" ? "4200" : "4100", vat, e.department), cr("2300", vat)],
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Net movement of an account (positive = its normal side). */
const signed = (code: string, l: Pick<JournalLine, "debit" | "credit">) =>
  debitNormal(code) ? l.debit - l.credit : l.credit - l.debit;

export interface LedgerLine {
  entry: JournalEntry;
  line: JournalLine;
  balance: number;
}

const matchesAccount = (filter: string, code: string) =>
  filter === code || (!filter.includes("-") && groupOf(code) === filter);

/** One account (or a whole group) between two dates, with opening and running balance. */
export function accountLedger(
  entries: JournalEntry[],
  account: string,
  from: string,
  to: string,
  costCenter?: string,
) {
  let opening = 0;
  const rows: LedgerLine[] = [];
  let bal = 0;
  for (const e of entries) {
    if (e.date > to) break;
    for (const l of e.lines) {
      if (!matchesAccount(account, l.account)) continue;
      if (costCenter && l.costCenter !== costCenter) continue;
      const mv = signed(l.account, l);
      if (e.date < from) {
        opening += mv;
        continue;
      }
      if (!rows.length) bal = opening;
      bal += mv;
      rows.push({ entry: e, line: l, balance: round2(bal) });
    }
  }
  const debit = round2(rows.reduce((s, r) => s + r.line.debit, 0));
  const credit = round2(rows.reduce((s, r) => s + r.line.credit, 0));
  return { opening: round2(opening), rows, debit, credit, closing: round2(opening + rows.reduce((s, r) => s + signed(r.line.account, r.line), 0)) };
}

export interface TrialRow {
  account: string;
  openingDebit: number;
  openingCredit: number;
  debit: number;
  credit: number;
  closingDebit: number;
  closingCredit: number;
}

/** ميزان المراجعة: opening, movements and closing per account, debits = credits. */
export function trialBalance(entries: JournalEntry[], from: string, to: string): TrialRow[] {
  const acc = new Map<string, { o: number; d: number; c: number }>();
  for (const e of entries) {
    if (e.date > to) break;
    for (const l of e.lines) {
      const r = acc.get(l.account) ?? { o: 0, d: 0, c: 0 };
      if (e.date < from) r.o += l.debit - l.credit;
      else {
        r.d += l.debit;
        r.c += l.credit;
      }
      acc.set(l.account, r);
    }
  }
  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([account, r]) => {
      const close = r.o + r.d - r.c;
      return {
        account,
        openingDebit: round2(Math.max(0, r.o)),
        openingCredit: round2(Math.max(0, -r.o)),
        debit: round2(r.d),
        credit: round2(r.c),
        closingDebit: round2(Math.max(0, close)),
        closingCredit: round2(Math.max(0, -close)),
      };
    });
}

export interface StatementRow {
  account: string;
  amount: number;
}
const byAccount = (rows: Map<string, number>) =>
  [...rows.entries()]
    .map(([account, amount]) => ({ account, amount: round2(amount) }))
    .filter((r) => Math.abs(r.amount) >= 0.005)
    .sort((a, b) => a.account.localeCompare(b.account));

/** قائمة الدخل for a date range, optionally for one cost center (analytic accounting). */
export function incomeStatement(entries: JournalEntry[], from: string, to: string, costCenter?: string) {
  const rev = new Map<string, number>();
  const exp = new Map<string, number>();
  for (const e of entries) {
    if (e.date > to) break;
    if (e.date < from) continue;
    for (const l of e.lines) {
      if (costCenter && l.costCenter !== costCenter) continue;
      const t = typeOf(l.account);
      if (t === "revenue") rev.set(l.account, (rev.get(l.account) ?? 0) + l.credit - l.debit);
      if (t === "expense") exp.set(l.account, (exp.get(l.account) ?? 0) + l.debit - l.credit);
    }
  }
  const revenue = byAccount(rev);
  const expenses = byAccount(exp);
  const totalRevenue = round2(revenue.reduce((s, r) => s + r.amount, 0));
  const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0));
  return { revenue, expenses, totalRevenue, totalExpenses, net: round2(totalRevenue - totalExpenses) };
}

/** الميزانية العمومية (المركز المالي) as of a date. Profit to date sits in equity (3200). */
export function balanceSheet(entries: JournalEntry[], asOf: string) {
  const bal = new Map<string, number>();
  let profit = 0;
  for (const e of entries) {
    if (e.date > asOf) break;
    for (const l of e.lines) {
      const t = typeOf(l.account);
      if (t === "revenue") profit += l.credit - l.debit;
      else if (t === "expense") profit -= l.debit - l.credit;
      else bal.set(l.account, (bal.get(l.account) ?? 0) + signed(l.account, l));
    }
  }
  const rows = byAccount(bal);
  const assets = rows.filter((r) => typeOf(r.account) === "asset").map((r) =>
    groupOf(r.account) === "1590" ? { ...r, amount: -r.amount } : r,
  );
  const liabilities = rows.filter((r) => typeOf(r.account) === "liability");
  const equity = [...rows.filter((r) => typeOf(r.account) === "equity"), { account: "3200", amount: round2(profit) }];
  const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
  const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0));
  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    profit: round2(profit),
    balanced: Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.01,
  };
}

const isCash = (code: string) => ["1100", "1200"].includes(groupOf(code));

/** Daily cash flow across drawers and banks (transfers between them cancel out). */
export function dailyCashFlow(entries: JournalEntry[], from: string, to: string) {
  let opening = 0;
  const days = new Map<string, { inflow: number; outflow: number }>();
  for (const e of entries) {
    if (e.date > to) break;
    const net = e.lines.filter((l) => isCash(l.account)).reduce((s, l) => s + l.debit - l.credit, 0);
    if (e.source === "transfer") continue;
    if (e.date < from) {
      opening += net;
      continue;
    }
    const d = days.get(e.date) ?? { inflow: 0, outflow: 0 };
    if (net > 0) d.inflow += net;
    else d.outflow -= net;
    days.set(e.date, d);
  }
  let bal = opening;
  const rows = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => {
      bal += d.inflow - d.outflow;
      return { date, inflow: round2(d.inflow), outflow: round2(d.outflow), net: round2(d.inflow - d.outflow), balance: round2(bal) };
    });
  return {
    opening: round2(opening),
    rows,
    inflow: round2(rows.reduce((s, r) => s + r.inflow, 0)),
    outflow: round2(rows.reduce((s, r) => s + r.outflow, 0)),
    closing: round2(bal),
  };
}

/** Lines of the journal for one cost center in a range (analytic drill-down). */
export function costCenterLines(entries: JournalEntry[], costCenter: string, from: string, to: string) {
  const out: { entry: JournalEntry; line: JournalLine }[] = [];
  for (const e of entries) {
    if (e.date > to) break;
    if (e.date < from) continue;
    for (const l of e.lines)
      if (l.costCenter === costCenter && ["revenue", "expense"].includes(typeOf(l.account))) out.push({ entry: e, line: l });
  }
  return out;
}

/** Where to open the source document of an entry. */
export function sourceRoute(e: Pick<JournalEntry, "source" | "txSource">):
  | "/billing"
  | "/suppliers"
  | "/treasury"
  | "/inventory"
  | "/e-invoicing"
  | "/expenses"
  | "/petty-cash"
  | "/payroll"
  | "/doctors"
  | "/supplier-accounts"
  | "/insurance"
  | "/receivables"
  | "/journal" {
  switch (e.source) {
    case "patient-invoice":
      return "/billing";
    case "supplier-invoice":
      return "/suppliers";
    case "asset":
    case "depreciation":
      return "/inventory";
    case "e-invoice":
      return "/e-invoicing";
    case "transfer":
      return "/treasury";
    case "credit-charge":
      return "/receivables";
    case "manual":
      return "/journal";
    default:
      switch (e.txSource) {
        case "expense":
        case "payment-order":
          return "/expenses";
        case "petty":
          return "/petty-cash";
        case "payroll":
          return "/payroll";
        case "doctor":
          return "/doctors";
        case "supplier-payment":
          return "/supplier-accounts";
        case "insurer":
          return "/insurance";
        case "collection":
          return "/receivables";
        default:
          return "/treasury";
      }
  }
}

