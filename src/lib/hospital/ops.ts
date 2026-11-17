/**
 * Every change to the hospital's records is a named operation: a pure function
 * (db, args, ctx) → db plus the roles allowed to run it. The browser runs it immediately for
 * a snappy screen; the server runs the very same function on the stored copy after checking
 * the signed-in person's role, so permissions cannot be bypassed from the browser.
 */
import {
  DEFAULT_DEPARTMENTS,
  GENERAL_DEPT_ID,
  type Department,
  type DepartmentId,
} from "./constants";
import {
  boxBalance,
  invoiceAmounts,
  shiftDifferences,
  shiftExpected,
  stockStatus,
} from "./finance";
import {
  can,
  canApprove,
  canSpendDirectly,
  discountPct,
  isDeskRole,
  needsReceiptApproval,
  type PermLevel,
  type Section,
} from "./permissions";
import { closeBlocker, lockedChange, lockedMessage, yearSummary } from "./fiscal";
import { buildClosing, closeDayBlocker, closedDays, lockedDayChange, lockedDayMessage } from "./daily-closing";
import { autoMatch, bankBookItems, type BankLine, type BankStatement } from "./bank";
import { DEFAULT_ETA_SETTINGS, type EInvoice, type EInvoiceStatus, type EtaSettings } from "./eta";
import { accountDebts, accountSummary, balanceWith, collectionsOf, installmentProblem } from "./credit";
import { GROUPS, isControlled } from "./ledger";
import { contractProblem, nextContractNumber, type ContractInput } from "./hr";
import { parseNationalId } from "./national-id";
import { issueUnitCost } from "./pharmacy";
import { refundPlan } from "./refunds";
import { depositsOf, dischargeSettlement } from "./inpatient";
import { payrollDeductions } from "./advances";
import { computeMonthlyPayroll, isEmployedInPeriod } from "./payroll-tax";
import {
  emptyDB,
  findBox,
  listLabel,
  MAIN_BOX_ID,
  nextNumber,
  nextReceiptId,
  normalizeDB,
  openShiftOf,
  supplierInvoicePayable,
  type Actor,
  type Admission,
  type AdmissionCharge,
  type Advance,
  type Refund,
  type Asset,
  type FiscalYear,
  type Branch,
  type Budget,
  type Cashbox,
  type CreditAccount,
  type CreditCharge,
  type Currency,
  type CustomAccount,
  type ManualJournalEntry,
  MAIN_BRANCH_ID,
  MANUAL_ENTRY_KINDS,
  type Doctor,
  type Employee,
  type EmployeePersonal,
  type EmploymentContract,
  type HospitalDB,
  type HospitalLists,
  type HospitalSettings,
  type InvoiceDraft,
  type ExportFormat,
  type ListItem,
  type PatientInvoice,
  type IssueOrder,
  issueStatus,
  type PaymentOrder,
  type PettyRequest,
  type PurchaseOrder,
  type StockItem,
  type StockMove,
  type SupplierInvoice,
  type SupplierPayment,
  type Transaction,
} from "./model";

export class OpError extends Error {}
const fail = (message: string): never => {
  throw new OpError(message);
};

export interface OpCtx {
  now: number;
  /** Local calendar date of the person doing the action (YYYY-MM-DD). */
  today: string;
  actor: Actor;
}

interface Op<A> {
  section: Section;
  level: PermLevel;
  run: (db: HospitalDB, args: A, ctx: OpCtx) => HospitalDB;
}
const op = <A>(section: Section, run: Op<A>["run"], level: PermLevel = "edit"): Op<A> => ({
  section,
  level,
  run,
});

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id)
    ? list.map((x) => (x.id === item.id ? item : x))
    : [...list, item];

/* ---------------- Rules (covered by store.test.ts) ---------------- */

export type ResetMode = "data" | "everything";

/**
 * "تصفير النظام": "data" wipes every operational record but keeps departments, lists,
 * cash boxes and hospital settings. "everything" restores all of those to their defaults too.
 */
export function resetDB(db: HospitalDB, mode: ResetMode): HospitalDB {
  const empty = emptyDB();
  if (mode === "everything") return empty;
  return {
    ...empty,
    departments: db.departments,
    lists: db.lists,
    settings: db.settings,
    cashboxes: db.cashboxes,
  };
}

/** How many records point at a department; a department in use cannot be deleted. */
export function departmentUsage(db: HospitalDB, id: string) {
  return (
    db.employees.filter((x) => x.department === id).length +
    db.transactions.filter((x) => x.department === id).length +
    db.patientInvoices.filter((x) => x.department === id).length +
    db.supplierInvoices.filter((x) => x.department === id).length +
    db.assets.filter((x) => x.department === id).length +
    db.doctors.filter((x) => x.department === id).length +
    db.stockItems.filter((x) => x.department === id).length
  );
}

export function canDeleteDepartment(db: HospitalDB, id: string) {
  const d = db.departments.find((x) => x.id === id);
  return !!d && !d.system && departmentUsage(db, id) === 0;
}

/** A receptionist may change a receipt only before it is printed, or once a manager unlocks it. */
export function canReceptionEdit(inv: PatientInvoice) {
  return !inv.printedAt || !!inv.unlocked;
}

function invoiceTxs(db: HospitalDB, inv: PatientInvoice): Transaction[] {
  const a = invoiceAmounts(inv);
  const out: Transaction[] = [];
  const payer = inv.payer ? listLabel(db.lists.payers, inv.payer.payerId) : "";
  // A discharge bill: the deposits paid during the stay are already in the treasury.
  const cashNow = round2(a.paidNow - (inv.depositApplied ?? 0));
  if (cashNow > 0)
    out.push({
      id: `tx-${inv.id}`,
      date: inv.date,
      department: inv.department,
      kind: "in",
      description: `${inv.admissionId ? "فاتورة خروج مريض مقيم" : "فاتورة مريض"}: ${inv.patientName}${inv.payer ? ` (نصيب المريض — ${payer})` : ""}`,
      amount: cashNow,
      receiptId: inv.number,
      source: "invoice",
      ref: inv.id,
      createdAt: inv.createdAt,
      boxId: inv.boxId ?? MAIN_BOX_ID,
      method: inv.paymentMethod,
      shiftId: inv.shiftId,
      by: inv.createdBy,
    });
  if (inv.payer && inv.insurerPaid && a.insurerShare > 0)
    out.push({
      id: `txi-${inv.id}`,
      date: inv.insurerPaid.date,
      department: inv.department,
      kind: "in",
      description: `تحصيل من ${payer}: فاتورة ${inv.number} — ${inv.patientName}`,
      amount: a.insurerShare,
      receiptId: `${inv.number}-INS`,
      source: "insurer",
      ref: inv.id,
      createdAt: inv.createdAt + 1,
      boxId: inv.insurerPaid.boxId,
      method: inv.insurerPaid.method,
      shiftId: inv.insurerPaid.shiftId,
    });
  return out;
}

/** Saves an invoice and replaces its treasury entries (patient share, collected insurer share). */
export function withPatientInvoice(db: HospitalDB, inv: PatientInvoice): HospitalDB {
  return {
    ...db,
    patientInvoices: upsert(db.patientInvoices, inv),
    transactions: [
      ...db.transactions.filter(
        (t) => !((t.source === "invoice" || t.source === "insurer") && t.ref === inv.id),
      ),
      ...invoiceTxs(db, inv),
    ],
  };
}

function withoutPatientInvoice(db: HospitalDB, id: string): HospitalDB {
  return {
    ...db,
    patientInvoices: db.patientInvoices.filter((i) => i.id !== id),
    stockMoves: db.stockMoves.some((m) => m.source === "sale" && m.ref === id)
      ? db.stockMoves.filter((m) => !(m.source === "sale" && m.ref === id))
      : db.stockMoves,
    transactions: db.transactions.filter(
      (t) => !((t.source === "invoice" || t.source === "insurer") && t.ref === id),
    ),
    editRequests: db.editRequests.filter((r) => !(r.invoiceId === id && r.status === "pending")),
  };
}

function supplierInvoiceTx(inv: SupplierInvoice, lists: HospitalLists): Transaction | null {
  if (inv.terms === "credit") return null;
  return {
    id: `tx-${inv.id}`,
    date: inv.date,
    department: inv.department,
    kind: "out",
    description: `${listLabel(lists.expenseCategories, inv.category)}: ${inv.supplierName} — ${inv.description}`,
    amount: supplierInvoicePayable(inv),
    receiptId: inv.number,
    source: "supplier",
    ref: inv.id,
    createdAt: inv.createdAt,
    boxId: inv.boxId ?? MAIN_BOX_ID,
    method: "cash",
    category: inv.category,
    paidTo: inv.supplierName,
  };
}

/** Saves a supplier invoice; cash invoices get one treasury entry, credit invoices none. */
export function withSupplierInvoice(db: HospitalDB, inv: SupplierInvoice): HospitalDB {
  const tx = supplierInvoiceTx(inv, db.lists);
  return {
    ...db,
    supplierInvoices: upsert(db.supplierInvoices, inv),
    transactions: [
      ...db.transactions.filter((t) => !(t.source === "supplier" && t.ref === inv.id)),
      ...(tx ? [tx] : []),
    ],
  };
}

/**
 * Drugs sold on a receipt leave the store automatically (one out move per stock line, at batch
 * cost). Unchanged lines keep their moves so nothing else is rewritten.
 */
function withSaleMoves(db: HospitalDB, inv: PatientInvoice, ctx: OpCtx): HospitalDB {
  const old = db.stockMoves.filter((m) => m.source === "sale" && m.ref === inv.id);
  const lines = inv.admissionId ? [] : inv.items.map((it, i) => ({ it, i })).filter((x) => !!x.it.stockItemId);
  const same =
    old.length === lines.length &&
    lines.every(({ it, i }) => {
      const m = old.find((x) => x.id === `sm-${inv.id}-${i}`);
      return !!m && m.itemId === it.stockItemId && m.qty === it.qty && m.date === inv.date && m.salePrice === it.unitPrice;
    });
  if (same) return db;
  let moves = db.stockMoves.filter((m) => !(m.source === "sale" && m.ref === inv.id));
  for (const { it, i } of lines) {
    const item = db.stockItems.find((x) => x.id === it.stockItemId);
    if (!item) fail(`الصنف «${it.description}» غير موجود في المخزن.`);
    const bal = stockStatus(item!, moves, ctx.today).balance;
    if (it.qty > bal) fail(`الرصيد المتاح من «${item!.name}» ${bal} ${item!.unit} فقط.`);
    moves = [
      ...moves,
      {
        id: `sm-${inv.id}-${i}`,
        itemId: item!.id,
        date: inv.date,
        type: "out",
        qty: it.qty,
        unitCost: issueUnitCost(item!, moves, it.qty, ctx.today),
        salePrice: it.unitPrice,
        department: inv.department,
        note: `بيع للمريض ${inv.patientName} — إيصال ${inv.number}`,
        source: "sale",
        ref: inv.id,
        createdAt: ctx.now,
      },
    ];
  }
  return { ...db, stockMoves: moves };
}

const NO_SHIFT = "افتح ورديتك أولًا من صفحة الورديات — كل فلوس بتستلمها بتتسجل على ورديتك في الخزينة الرئيسية.";

/**
 * Where money is taken or paid: desk staff always work on the one main treasury inside their own
 * open shift (so every pound is on their name); managers may also pick a bank account.
 */
function deskBox(db: HospitalDB, boxId: string | undefined, ctx: OpCtx) {
  let box = boxId || MAIN_BOX_ID;
  if (isDeskRole(ctx.actor.role)) {
    box = MAIN_BOX_ID;
    if (!openShiftOf(db, ctx.actor.id)) fail(NO_SHIFT);
  }
  requireBox(db, box);
  return box;
}

function enoughCash(db: HospitalDB, boxId: string, amount: number) {
  const bal = boxBalance(boxId, db.transactions, db.transfers);
  if (amount > bal + 0.001) fail(`رصيد «${findBox(db, boxId).name}» ${round2(bal)} ج.م فقط.`);
}

function openAdmissionOf(db: HospitalDB, id: string): Admission {
  const adm = db.admissions.find((a) => a.id === id);
  if (!adm) fail("حساب المريض المقيم غير موجود.");
  if (adm!.status !== "open") fail("المريض خرج وأُغلق حسابه — أعد فتحه أولًا للتعديل.");
  return adm!;
}
const putAdmission = (db: HospitalDB, adm: Admission): HospitalDB => ({ ...db, admissions: upsert(db.admissions, adm) });

/** Sections whose screens need every cash entry (not only the person's own drawer). */
const CASH_SECTIONS: Section[] = [
  "treasury",
  "accounting",
  "bank",
  "expenses",
  "pettyCash",
  "review",
  "costCenters",
  "closing",
  "dashboard",
];

/** What a person may see, from their section permissions. The director sees everything. */
export function viewFor(db: HospitalDB, actor: Actor): HospitalDB {
  if (actor.role === "admin") return db;
  const see = (s: Section) => can(actor, s, "view");
  const v: HospitalDB = { ...db };
  // Desk staff see only the money of their own shifts, whatever sections they were given;
  // the whole main treasury stays with the accountant, finance manager and director.
  if (isDeskRole(actor.role) || !CASH_SECTIONS.some(see)) {
    v.shifts = db.shifts.filter((s) => s.openedById === actor.id);
    const mine = new Set(v.shifts.map((s) => s.id));
    v.transactions = db.transactions.filter((t) => !!t.shiftId && mine.has(t.shiftId));
    v.transfers = [];
    // Only which days are closed (so entries on them are refused right away), never the totals.
    v.dailyClosings = db.dailyClosings.map((c) => ({
      ...c,
      opening: 0,
      totalIn: 0,
      totalOut: 0,
      closing: 0,
      expectedCash: 0,
      counted: 0,
      difference: 0,
      note: undefined,
      inLines: [],
      outLines: [],
      byMethod: {},
      collectors: [],
      entries: 0,
      reopen: undefined,
    }));
  }
  if (!see("payroll")) {
    // HR keeps the staff files; salaries stay with payroll.
    v.employees = see("hr") ? db.employees.map((e) => ({ ...e, fixedSalary: 0, variableSalary: 0 })) : [];
    v.payrollPostings = [];
  }
  if (!see("hr")) {
    v.contracts = [];
    v.employees = v.employees.map((e) => ({ ...e, personal: undefined }));
  }
  if (!see("suppliers") && !see("supplierAccounts") && !see("orders") && !see("accounting") && !see("eInvoicing")) {
    v.supplierInvoices = [];
    v.supplierPayments = [];
  }
  if (!see("inventory") && !see("accounting")) v.assets = [];
  if (!see("suppliers")) v.invoiceDrafts = [];
  if (!see("eInvoicing") && !see("accounting")) v.eInvoices = [];
  if (!see("bank")) v.bankStatements = [];
  if (!see("accounting")) v.journalEntries = [];
  if (!see("receivables")) {
    // Reception still picks the account on a receipt; nothing else about it is shown.
    v.creditAccounts = db.creditAccounts.map((a) => ({ id: a.id, kind: a.kind, name: a.name, active: a.active, createdAt: 0 }));
    v.creditCharges = [];
    v.transactions = v.transactions.filter((t) => t.source !== "collection" || CASH_SECTIONS.some(see));
  }
  if (!see("costCenters") && !see("accounting")) v.budgets = [];
  if (!see("doctors")) {
    v.doctorPayouts = [];
    v.doctors = db.doctors.map((d) => ({
      ...d,
      phone: undefined,
      monthlySalary: 0,
      consultPercent: 0,
      surgeryFee: 0,
      supervisionPerDay: 0,
    }));
  }
  if (!see("stock") && !see("orders")) {
    v.stockItems = [];
    v.stockMoves = [];
  }
  if (!see("orders") && !see("approvals")) {
    v.paymentOrders = [];
    v.purchaseOrders = [];
    if (!see("stock")) v.issueOrders = [];
  }
  if (!see("pettyCash") && !see("approvals")) v.pettyRequests = [];
  if (!see("billing")) v.admissions = [];
  if (!see("billing") && !see("approvals")) v.refunds = [];
  if (!see("payroll") && !see("approvals")) v.advances = [];
  if (!see("review")) {
    v.auditLog = [];
    v.reviews = {};
  }
  if (!see("approvals") && !see("review")) {
    v.editRequests = db.editRequests.filter((r) => r.requestedById === actor.id);
    v.patientDeleteRequests = see("patients")
      ? db.patientDeleteRequests.filter((r) => r.status === "pending" || r.requestedById === actor.id)
      : [];
  }
  return v;
}

/** Validates (or drops) the credit part of a receipt: active account, schedule, credit limit. */
function checkInvoiceCredit(db: HospitalDB, inv: PatientInvoice): PatientInvoice {
  if (!inv.credit || !(inv.credit.amount > 0)) return { ...inv, credit: undefined };
  const acct = db.creditAccounts.find((a) => a.id === inv.credit!.accountId);
  if (!acct || !acct.active) fail("الحساب الآجل المختار غير موجود أو موقوف.");
  const a = invoiceAmounts(inv);
  if (inv.credit.amount > a.patientShare + 0.001) fail("المبلغ الآجل أكبر من نصيب المريض.");
  const credit = { ...inv.credit, amount: round2(inv.credit.amount) };
  const problem = installmentProblem(credit.amount, credit.installments, inv.date);
  if (problem) fail(problem);
  if (acct!.creditLimit && acct!.creditLimit > 0) {
    const after = balanceWith(db, acct!, credit.amount, inv.id);
    if (after > acct!.creditLimit + 0.001)
      fail(`تجاوز حد الائتمان لحساب ${acct!.name}: الرصيد سيصبح ${after} ج.م والحد ${acct!.creditLimit} ج.م.`);
  }
  return { ...inv, credit };
}

const JE_LIMIT = 60;
function checkJournalEntry(db: HospitalDB, e: ManualJournalEntry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) fail("حدد تاريخ القيد.");
  if (!e.description.trim()) fail("اكتب بيان القيد.");
  if (!MANUAL_ENTRY_KINDS[e.kind]) fail("نوع القيد غير معروف.");
  const lines = e.lines.filter((l) => l.debit > 0 || l.credit > 0);
  if (lines.length < 2) fail("القيد يحتاج سطرين على الأقل (مدين ودائن).");
  if (lines.length > JE_LIMIT) fail(`أقصى عدد للأسطر ${JE_LIMIT}.`);
  const valid = new Set([
    ...Object.keys(GROUPS),
    ...db.customAccounts.map((c) => c.code),
    ...db.lists.expenseCategories.map((c) => `5100-${c.id}`),
    ...db.lists.pettyCategories.map((c) => `5400-${c.id}`),
  ]);
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0 || (l.debit > 0 && l.credit > 0)) fail("كل سطر إما مدين أو دائن بمبلغ موجب.");
    if (!valid.has(l.account)) fail(`الحساب ${l.account} غير موجود في دليل الحسابات.`);
    if (isControlled(l.account))
      fail("حسابات الخزائن والبنوك والتأمين والآجل والموردين تُسجَّل من صفحاتها، لا بقيد يدوي.");
    if (l.costCenter && !db.departments.some((d) => d.id === l.costCenter)) fail("مركز التكلفة غير موجود.");
  }
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0));
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.001) fail(`القيد غير متوازن: المدين ${dr} والدائن ${cr}.`);
  if (e.reverseOn && e.reverseOn <= e.date) fail("تاريخ العكس يكون بعد تاريخ القيد.");
  return { ...e, description: e.description.trim(), lines: lines.map((l) => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) })) };
}

/** Every entry is stamped with the person's open shift, so each pound stays on their name. */
function txBase(db: HospitalDB, boxId: string | undefined, ctx: OpCtx) {
  const box = boxId || MAIN_BOX_ID;
  return { boxId: box, shiftId: openShiftOf(db, ctx.actor.id)?.id, by: ctx.actor.name, createdAt: ctx.now };
}

function requireBox(db: HospitalDB, id: string) {
  const b = db.cashboxes.find((x) => x.id === id);
  if (!b) fail("الخزينة المختارة غير موجودة.");
  return b!;
}

/* ---------------- Bank reconciliation helpers ---------------- */
export type BankStatementInput = Pick<
  BankStatement,
  "boxId" | "from" | "to" | "openingBalance" | "closingBalance" | "fileName"
> & { lines: { date: string; description: string; reference?: string | undefined; amount: number; balance?: number | null | undefined }[] };

function updateBankLine(db: HospitalDB, statementId: string, lineId: string, fn: (l: BankLine) => BankLine): HospitalDB {
  const st = db.bankStatements.find((s) => s.id === statementId);
  if (!st) fail("الكشف غير موجود.");
  if (st!.status === "reconciled") fail("الكشف مُقفل كمطابَق — أعد فتحه أولًا.");
  return {
    ...db,
    bankStatements: db.bankStatements.map((s) =>
      s.id === statementId ? { ...s, lines: s.lines.map((l) => (l.id === lineId ? fn(l) : l)) } : s,
    ),
  };
}

/** Book items already matched on other statements of the same bank account. */
export function usedOnOtherStatements(db: Pick<HospitalDB, "bankStatements">, st: BankStatement) {
  return new Set(
    db.bankStatements
      .filter((s) => s.boxId === st.boxId && s.id !== st.id)
      .flatMap((s) => s.lines.flatMap((l) => [...(l.matched ?? []), ...(l.adjustmentTxId ? [l.adjustmentTxId] : [])])),
  );
}

export function bookFor(db: Pick<HospitalDB, "cashboxes" | "transactions" | "transfers">, boxId: string) {
  const bank = db.cashboxes.find((b) => b.id === boxId);
  if (!bank) return [];
  const bankIds = db.cashboxes.filter((b) => b.kind === "bank").map((b) => b.id);
  return bankBookItems(bank, db.transactions, db.transfers, bankIds);
}

function withAutoMatch(db: HospitalDB, id: string): HospitalDB {
  const st = db.bankStatements.find((s) => s.id === id);
  if (!st) fail("الكشف غير موجود.");
  if (st!.status === "reconciled") return db;
  const book = bookFor(db, st!.boxId);
  const adjIds = new Set(st!.lines.map((l) => l.adjustmentTxId).filter(Boolean) as string[]);
  const used = new Set([...usedOnOtherStatements(db, st!), ...adjIds]);
  const found = autoMatch(st!.lines, book, used);
  if (!found.size) return db;
  return {
    ...db,
    bankStatements: db.bankStatements.map((s) =>
      s.id === id ? { ...s, lines: s.lines.map((l) => (found.has(l.id) ? { ...l, matched: [found.get(l.id)!] } : l)) } : s,
    ),
  };
}

export type EInvoiceInput = Omit<EInvoice, "id" | "number" | "status" | "createdAt" | "createdBy" | "etaUuid" | "statusNote" | "submittedAt">;

/* ---------------- Operations ---------------- */

export type PatientInvoiceInput = Omit<
  PatientInvoice,
  "id" | "number" | "createdAt" | "shiftId" | "createdBy" | "printedAt" | "unlocked" | "insurerPaid"
> & {
  /** Unpaid part of the patient's share; kept on the patient's own account (see patientAccountId). */
  remaining?: number | undefined;
};

/** The patient's own account that carries the unpaid remainder of their receipts. */
export const patientAccountId = (patientId: string) => `pt-${patientId}`;

/**
 * Puts the unpaid remainder of a receipt on the patient's own account (created on first use),
 * so it shows on the patient's file, the receivables page and the ledger (patients receivable).
 */
function withRemaining(db: HospitalDB, inv: PatientInvoice, remaining: number | undefined, ctx: OpCtx) {
  const rest = round2(Number(remaining) || 0);
  if (rest < 0) fail("المبلغ المتبقي لا يكون بالسالب.");
  if (!(rest > 0)) return { db, inv };
  if (inv.credit && !inv.credit.accountId.startsWith("pt-"))
    fail("اختر إما «المتبقي على المريض» أو حسابًا آجلًا لشركة/تقسيط، وليس الاثنين.");
  const share = invoiceAmounts(inv).patientShare;
  if (rest > share + 0.001) fail(`المتبقي (${rest}) أكبر من المطلوب من المريض (${share}).`);
  const accountId = inv.patientId ? patientAccountId(inv.patientId) : `pt-inv-${inv.id}`;
  let next = db;
  const acct = db.creditAccounts.find((a) => a.id === accountId);
  if (!acct) {
    const created: CreditAccount = {
      id: accountId,
      kind: "patient",
      name: inv.patientName.trim(),
      phone: inv.patientPhone,
      patientId: inv.patientId,
      active: true,
      createdAt: ctx.now,
      notes: inv.patientMrn ? `ملف ${inv.patientMrn}` : undefined,
    };
    next = { ...db, creditAccounts: [...db.creditAccounts, created] };
  } else if (!acct.active) {
    next = { ...db, creditAccounts: db.creditAccounts.map((a) => (a.id === accountId ? { ...a, active: true } : a)) };
  }
  return { db: next, inv: { ...inv, credit: { accountId, amount: rest, installments: inv.credit?.installments } } };
}
export type SupplierInvoiceInput = Omit<SupplierInvoice, "id" | "number" | "createdAt">;
export type TransactionInput = {
  date: string;
  department: string;
  kind: "in" | "out";
  description: string;
  amount: number;
  source: "manual" | "opening";
  boxId?: string | undefined;
  method?: string | undefined;
  fx?: { currency: string; amount: number; rate: number } | undefined;
};


export type ExpenseInput = {
  date: string;
  department: string;
  category: string;
  description: string;
  amount: number;
  boxId: string;
  method: string;
  paidTo?: string | undefined;
};
export type PettyInput = {
  date: string;
  department: string;
  category: string;
  description: string;
  amount: number;
  paidTo?: string | undefined;
};
export type PaymentOrderInput = Pick<
  PaymentOrder,
  "date" | "beneficiary" | "department" | "category" | "description" | "amount"
>;
export type PurchaseOrderInput = Pick<
  PurchaseOrder,
  "date" | "supplierName" | "department" | "category" | "notes"
> & {
  lines: { id: string; stockItemId?: string | undefined; description: string; qty: number; unitPrice: number }[];
};
export type ReceiveInput = {
  poId: string;
  receiptId: string;
  date: string;
  lines: { lineId: string; qty: number; batchNo?: string | undefined; expiry?: string | undefined }[];
  payment: "none" | "credit" | "cash";
  boxId?: string | undefined;
  supplierInvoiceNo?: string | undefined;
};
export type IssueOrderInput = Pick<IssueOrder, "date" | "department" | "receiver" | "note" | "lines">;

const round2 = (n: number) => Math.round(n * 100) / 100;
const positive = (n: number, msg = "المبلغ يجب أن يكون أكبر من صفر.") => {
  if (!(Number(n) > 0)) fail(msg);
};

/** Only the finance manager approves requests (see canApprove). */
function requireApprover(
  ctx: OpCtx,
  req: { requestedById?: string | undefined; requestedRole?: Actor["role"] | undefined },
) {
  if (canApprove(ctx.actor, req)) return;
  if (ctx.actor.role === "finance" && req.requestedById === ctx.actor.id)
    fail("لا يجوز اعتماد طلب قدّمته بنفسك — يعتمده مدير مالي آخر أو مدير المستشفى.");
  fail("الاعتماد للمدير المالي فقط.");
}

/** Money and stock leave directly only by the finance manager or the director. */
function requireDirectSpender(ctx: OpCtx) {
  if (!canSpendDirectly(ctx.actor))
    fail("أي صرف يتم بأمر صرف يعتمده المدير المالي — من صفحة أوامر الصرف والطلبيات.");
}

/** Records a petty spend out of the main treasury (balance-checked); `ref` links it to its request. */
function withPettySpend(db: HospitalDB, id: string, input: PettyInput, ctx: OpCtx, ref?: string): HospitalDB {
  positive(input.amount);
  if (!input.description.trim()) fail("اكتب بيان المصروف النثري.");
  const balance = boxBalance(MAIN_BOX_ID, db.transactions, db.transfers);
  if (input.amount > balance + 0.001) fail(`رصيد الخزينة الرئيسية ${balance} ج.م فقط.`);
  const tx: Transaction = {
    id,
    date: input.date,
    department: input.department || GENERAL_DEPT_ID,
    kind: "out",
    description: input.description.trim(),
    amount: round2(input.amount),
    receiptId: nextReceiptId(db, "PTY", input.date),
    source: "petty",
    ...(ref ? { ref } : {}),
    ...txBase(db, MAIN_BOX_ID, ctx),
    method: "cash",
    category: input.category,
    paidTo: input.paidTo?.trim() || undefined,
  };
  return { ...db, transactions: [...db.transactions.filter((t) => t.id !== id), tx] };
}

export const OPS = {
  /* ----- Patient billing (all roles; reception rules enforced here) ----- */
  savePatientInvoice: op<{ id: string; input: PatientInvoiceInput }>(
    "billing",
    (db, { id, input: raw }, ctx) => {
      // Never trust status fields from the browser: only the invoice's own content is accepted.
      const {
        id: _i,
        number: _n,
        createdAt: _c,
        shiftId: _s,
        createdBy: _b,
        printedAt: _p,
        unlocked: _u,
        insurerPaid: _ip,
        admissionId: _ad,
        depositApplied: _da,
        remaining,
        ...input
      } = raw as PatientInvoice & { remaining?: number };
      const reception = isDeskRole(ctx.actor.role);
      const existing = db.patientInvoices.find((x) => x.id === id) ?? null;
      if (existing?.admissionId) fail("هذه فاتورة خروج مريض مقيم — تُعدَّل من صفحة حساب المريض المقيم.");
      if (!input.patientName?.trim()) fail("اكتب اسم المريض.");
      if (needsReceiptApproval(ctx.actor) && existing && !canReceptionEdit(existing))
        fail("لا يمكن تعديل إيصال بعد طباعته إلا بموافقة المدير المالي — اطلب صلاحية التعديل.");
      const cap = ctx.actor.controls?.maxDiscountPct;
      if (cap !== null && cap !== undefined && ctx.actor.role !== "admin") {
        const am = invoiceAmounts(input as PatientInvoice);
        if (am.discount > 0 && discountPct(am.subtotal, am.discount) > cap + 0.001)
          fail(`أقصى خصم مسموح لك ${cap}٪ من قيمة الإيصال — الخصم الأكبر يعمله المدير المالي.`);
      }
      let boxId = input.boxId || existing?.boxId || MAIN_BOX_ID;
      if (reception) boxId = existing?.boxId ?? MAIN_BOX_ID;
      requireBox(db, boxId);
      const shift = existing ? existing.shiftId : openShiftOf(db, ctx.actor.id)?.id;
      if (reception && !existing && !shift) fail(NO_SHIFT);
      const inv: PatientInvoice = existing
        ? {
            ...existing,
            ...input,
            boxId,
            unlocked: false,
            insurerPaid: input.payer ? existing.insurerPaid : undefined,
          }
        : {
            ...input,
            boxId,
            id,
            number: nextNumber(
              db.patientInvoices.map((i) => i.number),
              "INV",
              input.date,
            ),
            createdAt: ctx.now,
            shiftId: shift,
            createdBy: ctx.actor.name,
          };
      // Editing a receipt that had a remainder and now has none clears it from the patient's account.
      const base = remaining === undefined || Number(remaining) > 0 || !inv.credit?.accountId.startsWith("pt-") ? inv : { ...inv, credit: undefined };
      const r = withRemaining(db, base, remaining, ctx);
      const saved = checkInvoiceCredit(r.db, r.inv);
      return withSaleMoves(withPatientInvoice(r.db, saved), saved, ctx);
    },
  ),

  /** Collects (part of) a patient's remainder at a desk; reception collects into its own drawer. */
  collectPatientRemaining: op<{ id: string; patientId: string; date: string; amount: number; method: string; boxId?: string | undefined }>(
    "billing",
    (db, a, ctx) => {
      positive(a.amount);
      const acct = db.creditAccounts.find((x) => x.id === patientAccountId(a.patientId));
      if (!acct) fail("لا يوجد مبلغ متبقٍ على هذا المريض.");
      const boxId = deskBox(db, a.boxId, ctx);
      const bal = accountSummary(db, acct!, a.date).balance;
      if (a.amount > bal + 0.001) fail(`المتبقي على المريض ${bal} ج.م فقط.`);
      const tx: Transaction = {
        id: a.id,
        date: a.date,
        department: GENERAL_DEPT_ID,
        kind: "in",
        description: `تحصيل متبقي من المريض ${acct!.name}`,
        amount: round2(a.amount),
        receiptId: nextReceiptId(db, "COL", a.date),
        source: "collection",
        ref: acct!.id,
        ...txBase(db, boxId, ctx),
        method: a.method || "cash",
        paidTo: acct!.name,
      };
      return { ...db, transactions: [...db.transactions, tx] };
    },
  ),

  /* ----- Daily closing of the main treasury (opening + in − out = closing, signed on paper) ----- */
  closeCashDay: op<{ id: string; date: string; counted: number; note?: string | undefined }>(
    "treasury",
    (db, a, ctx) => {
      const blocker = closeDayBlocker(db, a.date, ctx.today);
      if (blocker) fail(blocker);
      if (!Number.isFinite(Number(a.counted)) || Number(a.counted) < 0) fail("اكتب النقدية الفعلية اللي اتعدّت في الخزينة.");
      const rec = buildClosing(db, a, { now: ctx.now, name: ctx.actor.name, id: ctx.actor.id, role: ctx.actor.role });
      if (Math.abs(rec.difference) > 0.001 && !rec.note)
        fail(`فيه ${rec.difference < 0 ? "عجز" : "زيادة"} ${Math.abs(rec.difference)} ج.م بين المعدود والمتوقع — اكتب السبب في الملاحظات.`);
      if (db.dailyClosings.some((c) => c.id === a.id)) fail("هذا الإقفال مسجّل بالفعل.");
      return { ...db, dailyClosings: [...db.dailyClosings, rec] };
    },
  ),

  requestDayReopen: op<{ date: string; reason: string }>("treasury", (db, { date, reason }, ctx) => {
    if (!reason?.trim()) fail("اكتب سبب إعادة فتح اليوم.");
    const list = closedDays(db);
    const rec = list.find((c) => c.date === date);
    if (!rec) fail("هذا اليوم ليس مقفولًا.");
    if (list[list.length - 1]!.date !== date) fail("أعد فتح الأيام الأحدث أولًا — تُفتح الأيام بعكس ترتيب إقفالها.");
    if (rec!.reopen?.status === "pending") fail("يوجد طلب إعادة فتح لهذا اليوم بانتظار اعتماد المدير المالي.");
    const direct = ctx.actor.role === "admin";
    const reopen = {
      reason: reason.trim(),
      requestedBy: ctx.actor.name,
      requestedById: ctx.actor.id,
      requestedRole: ctx.actor.role,
      requestedAt: ctx.now,
      status: direct ? ("approved" as const) : ("pending" as const),
      ...(direct ? { decidedBy: ctx.actor.name, decidedAt: ctx.now } : {}),
    };
    return {
      ...db,
      dailyClosings: db.dailyClosings.map((c) =>
        c.id === rec!.id ? { ...c, reopen, status: direct ? ("reopened" as const) : c.status } : c,
      ),
    };
  }),

  decideDayReopen: op<{ id: string; approve: boolean; note?: string | undefined }>(
    "approvals",
    (db, { id, approve, note }, ctx) => {
      const rec = db.dailyClosings.find((c) => c.id === id);
      if (!rec?.reopen || rec.reopen.status !== "pending") fail("لا يوجد طلب إعادة فتح بانتظار الاعتماد لهذا اليوم.");
      requireApprover(ctx, rec!.reopen!);
      const decided = {
        ...rec!.reopen!,
        status: approve ? ("approved" as const) : ("rejected" as const),
        decidedBy: ctx.actor.name,
        decidedAt: ctx.now,
        note: note?.trim() || undefined,
      };
      return {
        ...db,
        dailyClosings: db.dailyClosings.map((c) =>
          c.id === id ? { ...c, reopen: decided, status: approve ? ("reopened" as const) : c.status } : c,
        ),
      };
    },
  ),

  /* ----- Fiscal years: close & archive (1 January – 31 December) ----- */
  closeFiscalYear: op<{ year: number }>("closing", (db, { year }, ctx) => {
    if (!canSpendDirectly(ctx.actor)) fail("إقفال السنة المالية للمدير المالي أو مدير المستشفى فقط.");
    if (!Number.isInteger(year)) fail("سنة غير صحيحة.");
    const blocker = closeBlocker(db, year, ctx.today);
    if (blocker) fail(blocker);
    const record: FiscalYear = {
      year,
      status: "closed",
      closedAt: ctx.now,
      closedBy: ctx.actor.name,
      closedById: ctx.actor.id,
      summary: yearSummary(db, year),
    };
    return {
      ...db,
      fiscalYears: [...db.fiscalYears.filter((f) => f.year !== year), record].sort((a, b) => a.year - b.year),
    };
  }),

  reopenFiscalYear: op<{ year: number; reason: string }>("closing", (db, { year, reason }, ctx) => {
    if (ctx.actor.role !== "admin") fail("إعادة فتح سنة مقفولة لمدير المستشفى فقط.");
    if (!reason.trim()) fail("اكتب سبب إعادة فتح السنة.");
    const rec = db.fiscalYears.find((f) => f.year === year && f.status === "closed");
    if (!rec) fail("هذه السنة ليست مقفولة.");
    if (db.fiscalYears.some((f) => f.status === "closed" && f.year > year))
      fail("أعد فتح السنوات الأحدث أولًا — تُفتح السنوات بعكس ترتيب إقفالها.");
    return {
      ...db,
      fiscalYears: db.fiscalYears.map((f) =>
        f.year === year
          ? { ...f, status: "reopened" as const, reopenedAt: ctx.now, reopenedBy: ctx.actor.name, reopenReason: reason.trim() }
          : f,
      ),
    };
  }),

  /* ----- Patient files: deletion only after the finance manager approves ----- */
  requestPatientDelete: op<{ id: string; patientId: string; patientName: string; patientMrn: string; reason: string }>(
    "patients",
    (db, a, ctx) => {
      if (!a.reason.trim()) fail("اكتب سبب حذف ملف المريض.");
      if (db.patientDeleteRequests.some((r) => r.patientId === a.patientId && r.status === "pending"))
        fail("يوجد طلب حذف لهذا المريض بانتظار اعتماد المدير المالي.");
      const acct = db.creditAccounts.find((x) => x.id === patientAccountId(a.patientId));
      if (acct) {
        const bal = accountSummary(db, acct, ctx.today).balance;
        if (bal > 0.001) fail(`على المريض مبلغ متبقٍ ${bal} ج.م — حصّله أولًا قبل طلب حذف الملف.`);
      }
      return {
        ...db,
        patientDeleteRequests: [
          ...db.patientDeleteRequests,
          {
            id: a.id,
            patientId: a.patientId,
            patientName: a.patientName.trim(),
            patientMrn: a.patientMrn,
            reason: a.reason.trim(),
            requestedBy: ctx.actor.name,
            requestedById: ctx.actor.id,
            requestedRole: ctx.actor.role,
            requestedAt: ctx.now,
            status: "pending",
          },
        ],
      };
    },
    "add",
  ),
  /** Approving deletes the medical file (done by the server right after this op is saved). */
  decidePatientDelete: op<{ id: string; approve: boolean }>("approvals", (db, { id, approve }, ctx) => {
    const req = db.patientDeleteRequests.find((r) => r.id === id);
    if (!req || req.status !== "pending") fail("الطلب غير موجود أو تم البت فيه.");
    requireApprover(ctx, req!);
    return {
      ...db,
      patientDeleteRequests: db.patientDeleteRequests.map((r) =>
        r.id === id ? { ...r, status: approve ? ("approved" as const) : ("rejected" as const), decidedBy: ctx.actor.name, decidedAt: ctx.now } : r,
      ),
    };
  }),

  deletePatientInvoice: op<{ id: string }>("billing", (db, { id }, ctx) => {
    const inv = db.patientInvoices.find((x) => x.id === id);
    if (!inv) return db;
    if (inv.admissionId) fail("فاتورة الخروج تُلغى بإعادة فتح حساب المريض المقيم.");
    if (db.refunds.some((r) => r.invoiceId === id && r.status !== "rejected"))
      fail("على هذا الإيصال مرتجع — احذف المرتجع أولًا.");
    if (needsReceiptApproval(ctx.actor))
      fail("إلغاء أي إيصال يتم بطلب إلغاء يعتمده المدير المالي — من زر «طلب إلغاء».");
    return withoutPatientInvoice(db, id);
  }),

  markInvoicePrinted: op<{ id: string }>(
    "billing",
    (db, { id }, ctx) => ({
      ...db,
      patientInvoices: db.patientInvoices.map((i) =>
        i.id === id ? { ...i, printedAt: i.printedAt ?? ctx.now, unlocked: false } : i,
      ),
    }),
    "view",
  ),

  requestInvoiceChange: op<{
    id: string;
    invoiceId: string;
    action: "edit" | "delete";
    reason: string;
  }>("billing", (db, a, ctx) => {
    const target = db.patientInvoices.find((i) => i.id === a.invoiceId);
    if (!target) fail("الفاتورة غير موجودة.");
    if (target!.admissionId) fail("فاتورة الخروج تُعدَّل من صفحة حساب المريض المقيم.");
    if (!a.reason.trim()) fail("اكتب سبب الطلب.");
    if (db.editRequests.some((r) => r.invoiceId === a.invoiceId && r.status === "pending"))
      fail("يوجد طلب قيد المراجعة لهذه الفاتورة بالفعل.");
    const t = target!;
    const am = invoiceAmounts(t);
    const snapshot = {
      number: t.number,
      date: t.date,
      patientName: t.patientName,
      department: t.department,
      total: am.total,
      paidNow: am.paidNow,
      discount: am.discount,
      createdBy: t.createdBy,
      boxId: t.boxId,
    };
    return {
      ...db,
      editRequests: [
        ...db.editRequests,
        {
          id: a.id,
          invoiceId: a.invoiceId,
          action: a.action,
          reason: a.reason.trim(),
          requestedBy: ctx.actor.name,
          requestedById: ctx.actor.id,
          requestedRole: ctx.actor.role,
          requestedAt: ctx.now,
          status: "pending",
          snapshot,
        },
      ],
    };
  }),

  decideInvoiceChange: op<{ id: string; approve: boolean }>("approvals", (db, { id, approve }, ctx) => {
    const req = db.editRequests.find((r) => r.id === id);
    if (!req || req.status !== "pending") return db;
    requireApprover(ctx, req);
    let next: HospitalDB = {
      ...db,
      editRequests: db.editRequests.map((r) =>
        r.id === id
          ? {
              ...r,
              status: approve ? "approved" : "rejected",
              decidedBy: ctx.actor.name,
              decidedAt: ctx.now,
            }
          : r,
      ),
    };
    if (approve && req.action === "edit")
      next = {
        ...next,
        patientInvoices: next.patientInvoices.map((i) =>
          i.id === req.invoiceId ? { ...i, unlocked: true } : i,
        ),
      };
    if (approve && req.action === "delete") {
      const kept = next.editRequests;
      next = { ...withoutPatientInvoice(next, req.invoiceId), editRequests: kept };
    }
    return next;
  }),

  collectInsurer: op<{ invoiceId: string; date: string; boxId: string; method: string }>(
    "insurance",
    (db, a, ctx) => {
      const inv = db.patientInvoices.find((i) => i.id === a.invoiceId);
      if (!inv?.payer) fail("هذه الفاتورة ليست على جهة تأمين.");
      if (inv!.insurerPaid) fail("تم تحصيل نصيب الجهة لهذه الفاتورة من قبل.");
      if (!(invoiceAmounts(inv!).insurerShare > 0)) fail("لا يوجد نصيب على الجهة في هذه الفاتورة.");
      requireBox(db, a.boxId);
      return withPatientInvoice(db, {
        ...inv!,
        insurerPaid: {
          date: a.date,
          boxId: a.boxId,
          method: a.method,
          shiftId: openShiftOf(db, ctx.actor.id)?.id,
        },
      });
    },
  ),

  uncollectInsurer: op<{ invoiceId: string }>("insurance", (db, { invoiceId }) => {
    const inv = db.patientInvoices.find((i) => i.id === invoiceId);
    return inv ? withPatientInvoice(db, { ...inv, insurerPaid: undefined }) : db;
  }),

  /* ----- Shifts & cash drawers ----- */
  /**
   * Each person opens their own shift on the main treasury: the cash they take and pay is counted
   * against them at closing. The opening float (change handed to them) stays inside the treasury.
   */
  openShift: op<{ id: string; boxId?: string | undefined; openingFloat: number }>("shifts", (db, a, ctx) => {
    if (openShiftOf(db, ctx.actor.id)) fail("عندك وردية مفتوحة بالفعل — قفّلها الأول.");
    const n = db.shifts.length + 1;
    return {
      ...db,
      shifts: [
        ...db.shifts,
        {
          id: a.id,
          number: String(n),
          boxId: MAIN_BOX_ID,
          openedAt: ctx.now,
          openedBy: ctx.actor.name,
          openedById: ctx.actor.id,
          openingFloat: Math.max(0, a.openingFloat || 0),
        },
      ],
    };
  }),

  closeShift: op<{
    shiftId: string;
    counted: Record<string, number>;
    handover: "main" | "next";
    note?: string | undefined;
  }>("shifts", (db, a, ctx) => {
    const shift = db.shifts.find((s) => s.id === a.shiftId);
    if (!shift || shift.closedAt) fail("الوردية غير موجودة أو مغلقة بالفعل.");
    if (shift!.openedById !== ctx.actor.id && !canSpendDirectly(ctx.actor) && ctx.actor.role !== "accountant")
      fail("تقدر تقفّل ورديتك انت بس.");
    const s = shift!;
    const expected = shiftExpected(s, db.transactions);
    const counted = Object.fromEntries(
      Object.entries(a.counted).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]),
    );
    const diffs = shiftDifferences(expected, counted);
    const tag = s.id.slice(0, 8).toUpperCase();
    const adjustments: Transaction[] = diffs.rows
      .filter((r) => Math.abs(r.diff) >= 0.01)
      .map((r, i) => ({
        id: `shd-${s.id}-${r.method}`,
        date: ctx.today,
        department: GENERAL_DEPT_ID,
        kind: r.diff > 0 ? "in" : "out",
        description: `${r.diff > 0 ? "زيادة" : "عجز"} تقفيل وردية ${s.number} — ${s.openedBy} (${listLabel(db.lists.paymentMethods, r.method)})`,
        amount: Math.abs(r.diff),
        receiptId: `SHIFT-${tag}-${r.method}`.toUpperCase(),
        source: "shift",
        ref: s.id,
        createdAt: ctx.now + i,
        boxId: s.boxId,
        method: r.method,
        shiftId: s.id,
        by: ctx.actor.name,
      }));
    return {
      ...db,
      transactions: [...db.transactions, ...adjustments],
      shifts: db.shifts.map((x) =>
        x.id === s.id
          ? {
              ...x,
              closedAt: ctx.now,
              closedBy: ctx.actor.name,
              expected,
              counted,
              // The cash never leaves the main treasury: closing only counts it against the person.
              handover: "main",
              note: a.note?.trim() || undefined,
            }
          : x,
      ),
    };
  }),

  addTransfer: op<{
    id: string;
    date: string;
    from: string;
    to: string;
    amount: number;
    method: string;
    note?: string | undefined;
  }>("treasury", (db, a, ctx) => {
    if (a.from === a.to) fail("اختر خزينتين مختلفتين.");
    requireBox(db, a.from);
    requireBox(db, a.to);
    if (!(a.amount > 0)) fail("المبلغ يجب أن يكون أكبر من صفر.");
    return {
      ...db,
      transfers: [
        ...db.transfers,
        {
          ...a,
          number: nextNumber(
            db.transfers.map((t) => t.number),
            "TRF",
            a.date,
          ),
          note: a.note?.trim() || undefined,
          by: ctx.actor.name,
          createdAt: ctx.now,
        },
      ],
    };
  }),

  deleteTransfer: op<{ id: string }>("treasury", (db, { id }) => ({
    ...db,
    transfers: db.transfers.filter((t) => t.id !== id),
  })),

  saveCashbox: op<Cashbox>("settings", (db, b) => {
    if (!b.name.trim()) fail("اكتب اسم الخزينة.");
    const existing = db.cashboxes.find((x) => x.id === b.id);
    if (b.id !== MAIN_BOX_ID && existing?.kind !== "bank")
      fail("الفلوس كلها في خزينة رئيسية واحدة — مفيش أدراج. الحسابات البنكية بتتضاف من صفحة البنوك.");
    const box: Cashbox = b.id === MAIN_BOX_ID ? { ...b, kind: "main", active: true } : { ...b, kind: "bank" };
    return { ...db, cashboxes: upsert(db.cashboxes, box) };
  }),

  deleteCashbox: op<{ id: string }>("settings", (db, { id }) => {
    if (id === MAIN_BOX_ID) fail("لا يمكن حذف الخزينة الرئيسية.");
    const used =
      db.transactions.some((t) => t.boxId === id) ||
      db.shifts.some((s) => s.boxId === id) ||
      db.transfers.some((t) => t.from === id || t.to === id);
    if (used) fail("هذه الخزينة عليها حركات؛ يمكنك إيقافها بدل الحذف.");
    return { ...db, cashboxes: db.cashboxes.filter((b) => b.id !== id) };
  }),

  /* ----- Treasury ----- */
  addTransaction: op<{ id: string; input: TransactionInput }>("treasury", (db, { id, input: raw }, ctx) => {
    if (raw.source !== "manual" && raw.source !== "opening") fail("هذا النوع من الحركات يُسجَّل من صفحته.");
    const input = raw.fx ? { ...raw, amount: round2(raw.fx.amount * raw.fx.rate) } : raw;
    if (raw.fx && !(raw.fx.rate > 0 && raw.fx.amount > 0)) fail("اكتب المبلغ بالعملة وسعر الصرف.");
    if (!(input.amount > 0)) fail("المبلغ يجب أن يكون أكبر من صفر.");
    if (input.kind === "out") requireDirectSpender(ctx);
    return {
      ...db,
      transactions: [
        ...db.transactions,
        {
          ...input,
          ...txBase(db, input.boxId, ctx),
          method: input.method || "cash",
          id,
          receiptId: nextReceiptId(db, "TRX", input.date),
        },
      ],
    };
  }),

  updateTransaction: op<{ id: string; patch: Omit<TransactionInput, "source"> }>(
    "treasury",
    (db, { id, patch }) => ({
      ...db,
      transactions: db.transactions.map((t) =>
        t.id === id && (t.source === "manual" || t.source === "opening")
          ? (() => {
              const next = { ...t, ...patch };
              if (patch.fx) return { ...next, amount: round2(patch.fx.amount * patch.fx.rate) };
              // Changing the EGP amount by hand drops the stale foreign-currency details.
              if (t.fx && patch.amount !== undefined && patch.amount !== t.amount) delete next.fx;
              return next;
            })()
          : t,
      ),
    }),
  ),

  deleteTransaction: op<{ id: string }>("treasury", (db, { id }) => ({
    ...db,
    transactions: db.transactions.filter(
      (t) => !(t.id === id && (t.source === "manual" || t.source === "opening")),
    ),
  })),

  /* ----- Payroll ----- */
  saveEmployee: op<Employee>("payroll", (db, e) => {
    // The personal file belongs to HR; payroll edits never wipe it.
    const old = db.employees.find((x) => x.id === e.id);
    return { ...db, employees: upsert(db.employees, { ...e, personal: e.personal ?? old?.personal }) };
  }),
  deleteEmployee: op<{ id: string }>("payroll", (db, { id }) => ({
    ...db,
    employees: db.employees.filter((e) => e.id !== id),
  })),

  postPayroll: op<{
    period: string;
    date: string;
    byDept: { department: DepartmentId; code: string; net: number; label: string }[];
  }>("payroll", (db, { period, date, byDept }, ctx) => {
    requireDirectSpender(ctx);
    if (db.payrollPostings.includes(period)) return db;
    // Advance installments are taken from the salaries (worked out here, never trusted from the browser).
    const netOf = (employeeId: string) => {
      const e = db.employees.find((x) => x.id === employeeId);
      return e && isEmployedInPeriod(e.hireDate, period) ? computeMonthlyPayroll(e.fixedSalary, e.variableSalary, db.settings).net : 0;
    };
    const cuts = payrollDeductions(db.advances, period, netOf);
    const cutByDept = new Map<string, number>();
    for (const c of cuts) {
      const dep = db.employees.find((e) => e.id === c.employeeId)?.department ?? GENERAL_DEPT_ID;
      cutByDept.set(dep, round2((cutByDept.get(dep) ?? 0) + c.amount));
    }
    const txs: Transaction[] = byDept
      .map((d) => ({ ...d, net: round2(d.net - (cutByDept.get(d.department) ?? 0)) }))
      .filter((d) => d.net > 0)
      .map((d, i) => ({
        id: `pay-${period}-${d.department}`,
        date,
        department: d.department,
        kind: "out",
        description: d.label,
        amount: d.net,
        receiptId: `PAY-${period.replace("-", "")}-${d.code.toUpperCase()}`,
        source: "payroll",
        ref: period,
        createdAt: ctx.now + i,
        boxId: MAIN_BOX_ID,
        method: "cash",
        by: ctx.actor.name,
      }));
    const cutOf = new Map(cuts.map((c) => [c.advanceId, c.amount]));
    return {
      ...db,
      transactions: [...db.transactions, ...txs],
      payrollPostings: [...db.payrollPostings, period],
      advances: cuts.length
        ? db.advances.map((a) => (cutOf.has(a.id) ? { ...a, deductions: [...a.deductions, { period, amount: cutOf.get(a.id)! }] } : a))
        : db.advances,
    };
  }),

  unpostPayroll: op<{ period: string }>("payroll", (db, { period }) => ({
    ...db,
    transactions: db.transactions.filter((t) => !(t.source === "payroll" && t.ref === period)),
    payrollPostings: db.payrollPostings.filter((p) => p !== period),
    advances: db.advances.some((a) => a.deductions.some((d) => d.period === period))
      ? db.advances.map((a) => (a.deductions.some((d) => d.period === period) ? { ...a, deductions: a.deductions.filter((d) => d.period !== period) } : a))
      : db.advances,
  })),

  /* ----- Suppliers ----- */
  saveSupplierInvoice: op<{ id: string; input: SupplierInvoiceInput }>(
    "suppliers",
    (db, { id, input }, ctx) => {
      // A cash invoice takes money from a box straight away.
      if (input.terms !== "credit") requireDirectSpender(ctx);
      const existing = db.supplierInvoices.find((x) => x.id === id);
      const inv: SupplierInvoice = existing
        ? { ...existing, ...input }
        : {
            ...input,
            id,
            number: nextNumber(
              db.supplierInvoices.map((i) => i.number),
              "SUP",
              input.date,
            ),
            createdAt: ctx.now,
          };
      return withSupplierInvoice(db, inv);
    },
  ),

  deleteSupplierInvoice: op<{ id: string }>("suppliers", (db, { id }) => ({
    ...db,
    supplierInvoices: db.supplierInvoices.filter((i) => i.id !== id),
    transactions: db.transactions.filter((t) => !(t.source === "supplier" && t.ref === id)),
  })),

  saveSupplierPayment: op<{
    id: string;
    input: Omit<SupplierPayment, "id" | "number" | "createdAt">;
  }>("supplierAccounts", (db, { id, input }, ctx) => {
    requireDirectSpender(ctx);
    if (!input.supplierName.trim()) fail("اختر المورد.");
    if (!(input.amount > 0)) fail("المبلغ يجب أن يكون أكبر من صفر.");
    requireBox(db, input.boxId);
    const existing = db.supplierPayments.find((p) => p.id === id);
    const pay: SupplierPayment = existing
      ? { ...existing, ...input }
      : {
          ...input,
          id,
          number: nextNumber(
            db.supplierPayments.map((p) => p.number),
            "SPY",
            input.date,
          ),
          createdAt: ctx.now,
        };
    const dept = db.departments.some((d) => d.id === "purchasing") ? "purchasing" : GENERAL_DEPT_ID;
    const tx: Transaction = {
      id: `tx-${pay.id}`,
      date: pay.date,
      department: dept,
      kind: "out",
      description: `سداد للمورد: ${pay.supplierName}${pay.note ? ` — ${pay.note}` : ""}`,
      amount: pay.amount,
      receiptId: pay.number,
      source: "supplier-payment",
      ref: pay.id,
      ...txBase(db, pay.boxId, ctx),
      createdAt: pay.createdAt,
      method: pay.method,
    };
    return {
      ...db,
      supplierPayments: upsert(db.supplierPayments, pay),
      transactions: [
        ...db.transactions.filter((t) => !(t.source === "supplier-payment" && t.ref === pay.id)),
        tx,
      ],
    };
  }),

  deleteSupplierPayment: op<{ id: string }>("supplierAccounts", (db, { id }, ctx) => {
    requireDirectSpender(ctx);
    return {
      ...db,
      supplierPayments: db.supplierPayments.filter((p) => p.id !== id),
      transactions: db.transactions.filter((t) => !(t.source === "supplier-payment" && t.ref === id)),
    };
  }),

  /* ----- Assets ----- */
  saveAsset: op<Asset>("inventory", (db, a) => ({ ...db, assets: upsert(db.assets, a) })),
  deleteAsset: op<{ id: string }>("inventory", (db, { id }) => ({
    ...db,
    assets: db.assets.filter((a) => a.id !== id),
  })),

  /* ----- Doctors ----- */
  saveDoctor: op<Doctor>("doctors", (db, d) => {
    if (!d.name.trim()) fail("اكتب اسم الطبيب.");
    return { ...db, doctors: upsert(db.doctors, d) };
  }),
  deleteDoctor: op<{ id: string }>("doctors", (db, { id }) => {
    if (
      db.patientInvoices.some((i) => i.doctorId === id) ||
      db.doctorPayouts.some((p) => p.doctorId === id)
    )
      fail("للطبيب فواتير أو مستحقات مسجلة؛ يمكنك إيقافه بدل الحذف.");
    return { ...db, doctors: db.doctors.filter((d) => d.id !== id) };
  }),
  payDoctor: op<{
    id: string;
    doctorId: string;
    period: string;
    date: string;
    amount: number;
    boxId: string;
    note?: string | undefined;
  }>("doctors", (db, a, ctx) => {
    requireDirectSpender(ctx);
    const doc = db.doctors.find((d) => d.id === a.doctorId);
    if (!doc) fail("الطبيب غير موجود.");
    if (!(a.amount > 0)) fail("المبلغ يجب أن يكون أكبر من صفر.");
    requireBox(db, a.boxId);
    const number = nextNumber(
      db.doctorPayouts.map((p) => p.number),
      "DOC",
      a.date,
    );
    return {
      ...db,
      doctorPayouts: [
        ...db.doctorPayouts,
        { ...a, number, note: a.note?.trim() || undefined, createdAt: ctx.now },
      ],
      transactions: [
        ...db.transactions,
        {
          id: `tx-${a.id}`,
          date: a.date,
          department: doc!.department,
          kind: "out",
          description: `مستحقات د. ${doc!.name} عن ${a.period}${a.note ? ` — ${a.note}` : ""}`,
          amount: a.amount,
          receiptId: number,
          source: "doctor",
          ref: a.id,
          ...txBase(db, a.boxId, ctx),
          method: "cash",
        },
      ],
    };
  }),
  deleteDoctorPayout: op<{ id: string }>("doctors", (db, { id }) => ({
    ...db,
    doctorPayouts: db.doctorPayouts.filter((p) => p.id !== id),
    transactions: db.transactions.filter((t) => !(t.source === "doctor" && t.ref === id)),
  })),

  /* ----- Stock ----- */
  saveStockItem: op<StockItem>("stock", (db, item) => {
    if (!item.name.trim()) fail("اكتب اسم الصنف.");
    return { ...db, stockItems: upsert(db.stockItems, item) };
  }),
  deleteStockItem: op<{ id: string }>("stock", (db, { id }) => {
    if (db.stockMoves.some((m) => m.itemId === id))
      fail("للصنف حركات مسجلة؛ يمكنك إيقافه بدل الحذف.");
    return { ...db, stockItems: db.stockItems.filter((i) => i.id !== id) };
  }),
  addStockMove: op<Omit<StockMove, "createdAt">>("stock", (db, m, ctx) => {
    const item = db.stockItems.find((i) => i.id === m.itemId);
    if (!item) fail("الصنف غير موجود.");
    if (!(m.qty > 0)) fail("الكمية يجب أن تكون أكبر من صفر.");
    if (m.type === "out") {
      if (!canSpendDirectly(ctx.actor))
        fail("الصرف من المخزن يتم بطلب صرف للقسم يعتمده المدير المالي — من صفحة أوامر الصرف والطلبيات.");
      const bal = stockStatus(item!, db.stockMoves, ctx.today).balance;
      if (m.qty > bal) fail(`الرصيد المتاح ${bal} فقط.`);
    }
    return { ...db, stockMoves: [...db.stockMoves, { ...m, createdAt: ctx.now }] };
  }),
  deleteStockMove: op<{ id: string }>("stock", (db, { id }, ctx) => {
    const m = db.stockMoves.find((x) => x.id === id);
    if (!m) return db;
    const rest = db.stockMoves.filter((x) => x.id !== id);
    const item = db.stockItems.find((i) => i.id === m.itemId);
    if (item && m.type === "in" && stockStatus(item, rest, ctx.today).balance < 0)
      fail("لا يمكن حذف هذه الإضافة لأن جزءًا منها تم صرفه.");
    return { ...db, stockMoves: rest };
  }),

  /* ----- Expenses register: every money-out is an expense ----- */
  addExpense: op<{ id: string; input: ExpenseInput }>("expenses", (db, { id, input }, ctx) => {
    positive(input.amount);
    requireDirectSpender(ctx);
    if (!input.description.trim()) fail("اكتب بيان المصروف.");
    if (!input.category) fail("اختر بند المصروف.");
    requireBox(db, input.boxId || MAIN_BOX_ID);
    const tx: Transaction = {
      id,
      date: input.date,
      department: input.department || GENERAL_DEPT_ID,
      kind: "out",
      description: input.description.trim(),
      amount: round2(input.amount),
      receiptId: nextReceiptId(db, "EXP", input.date),
      source: "expense",
      ...txBase(db, input.boxId, ctx),
      method: input.method || "cash",
      category: input.category,
      paidTo: input.paidTo?.trim() || undefined,
    };
    return { ...db, transactions: [...db.transactions, tx] };
  }),
  deleteExpense: op<{ id: string }>("expenses", (db, { id }) => ({
    ...db,
    transactions: db.transactions.filter((t) => !(t.id === id && t.source === "expense")),
  })),

  /* ----- Petty cash (النثريات) ----- */
  /** Direct petty spend — finance manager / director only; everyone else raises a request. */
  addPettyExpense: op<{ id: string; input: PettyInput }>("pettyCash", (db, { id, input }, ctx) => {
    requireDirectSpender(ctx);
    return withPettySpend(db, id, input, ctx);
  }),
  deletePettyExpense: op<{ id: string }>("pettyCash", (db, { id }) => {
    const tx = db.transactions.find((t) => t.id === id && t.source === "petty");
    return {
      ...db,
      transactions: db.transactions.filter((t) => !(t.id === id && t.source === "petty")),
      // Undoing a paid request puts it back to "approved, waiting to be paid".
      pettyRequests: db.pettyRequests.map((r) =>
        tx?.ref && r.id === tx.ref && r.status === "paid"
          ? { ...r, status: "approved", paidBy: undefined, paidOn: undefined }
          : r,
      ),
    };
  }),
  requestPetty: op<{ id: string; input: PettyInput }>("pettyCash", (db, { id, input }, ctx) => {
    positive(input.amount);
    if (!input.description.trim()) fail("اكتب بيان المصروف النثري.");
    if (db.pettyRequests.some((r) => r.id === id)) fail("الطلب مسجل بالفعل.");
    const req: PettyRequest = {
      id,
      number: nextNumber(
        db.pettyRequests.map((r) => r.number),
        "PTR",
        input.date,
      ),
      date: input.date,
      department: input.department || GENERAL_DEPT_ID,
      category: input.category,
      description: input.description.trim(),
      amount: round2(input.amount),
      paidTo: input.paidTo?.trim() || undefined,
      status: "pending",
      requestedBy: ctx.actor.name,
      requestedById: ctx.actor.id,
      requestedRole: ctx.actor.role,
      createdAt: ctx.now,
    };
    return { ...db, pettyRequests: [...db.pettyRequests, req] };
  }),
  decidePettyRequest: op<{ id: string; approve: boolean; note?: string | undefined }>(
    "approvals",
    (db, a, ctx) => {
      const r = db.pettyRequests.find((x) => x.id === a.id);
      if (!r || r.status !== "pending") fail("طلب النثرية ليس بانتظار الاعتماد.");
      requireApprover(ctx, r!);
      if (!a.approve && !a.note?.trim()) fail("اكتب سبب الرفض.");
      return {
        ...db,
        pettyRequests: db.pettyRequests.map((x) =>
          x.id === a.id
            ? {
                ...x,
                status: a.approve ? "approved" : "rejected",
                decidedBy: ctx.actor.name,
                decidedAt: ctx.now,
                decisionNote: a.note?.trim() || undefined,
              }
            : x,
        ),
      };
    },
  ),
  payPettyRequest: op<{ id: string; date: string }>("pettyCash", (db, a, ctx) => {
    const r = db.pettyRequests.find((x) => x.id === a.id);
    if (!r) fail("طلب النثرية غير موجود.");
    if (r!.status !== "approved") fail("لا تُصرف نثرية إلا بعد اعتماد المدير المالي.");
    const next = withPettySpend(db, `tx-${r!.id}`, { ...r!, date: a.date || r!.date }, ctx, r!.id);
    return {
      ...next,
      pettyRequests: db.pettyRequests.map((x) =>
        x.id === a.id ? { ...x, status: "paid", paidBy: ctx.actor.name, paidOn: a.date || r!.date } : x,
      ),
    };
  }),
  deletePettyRequest: op<{ id: string }>("pettyCash", (db, { id }) => {
    const r = db.pettyRequests.find((x) => x.id === id);
    if (r?.status === "paid") fail("تم صرف هذا الطلب — احذف حركة الصرف من الدفتر أولًا.");
    return { ...db, pettyRequests: db.pettyRequests.filter((x) => x.id !== id) };
  }),
  /** Retired: petty spends come straight out of the main treasury (kept so queued old entries get an answer). */
  topUpPetty: op<{ id: string; date: string; amount: number; from: string; note?: string | undefined }>(
    "pettyCash",
    () => fail("النثريات بقت بتتصرف من الخزينة الرئيسية مباشرة — مفيش تغذية لخزينة منفصلة."),
  ),
  deletePettyTopUp: op<{ id: string }>("pettyCash", () =>
    fail("النثريات بقت بتتصرف من الخزينة الرئيسية مباشرة — مفيش تغذية لخزينة منفصلة."),
  ),

  /* ----- Financial review (المراجعة) ----- */
  reviewTransaction: op<{ txId: string; status: "approved" | "flagged"; note?: string | undefined }>(
    "review",
    (db, a, ctx) => {
      const tx = db.transactions.find((t) => t.id === a.txId);
      if (!tx) fail("الحركة غير موجودة.");
      if (a.status === "flagged" && !a.note?.trim()) fail("اكتب الملاحظة على الحركة.");
      return {
        ...db,
        reviews: {
          ...db.reviews,
          [a.txId]: {
            status: a.status,
            note: a.note?.trim() || undefined,
            by: ctx.actor.name,
            at: ctx.now,
            amount: tx!.amount,
          },
        },
      };
    },
  ),
  clearReview: op<{ txId: string }>("review", (db, { txId }) => {
    const reviews = { ...db.reviews };
    delete reviews[txId];
    return { ...db, reviews };
  }),

  /* ----- Payment orders (أوامر الصرف) ----- */
  savePaymentOrder: op<{ id: string; input: PaymentOrderInput }>("orders", (db, { id, input }, ctx) => {
    positive(input.amount);
    if (!input.beneficiary.trim()) fail("اكتب اسم المستفيد.");
    if (!input.description.trim()) fail("اكتب سبب الصرف.");
    const existing = db.paymentOrders.find((o) => o.id === id);
    if (existing && existing.status !== "pending")
      fail("لا يمكن تعديل أمر صرف بعد اعتماده أو رفضه.");
    const clean = {
      ...input,
      beneficiary: input.beneficiary.trim(),
      description: input.description.trim(),
      amount: round2(input.amount),
    };
    const order: PaymentOrder = existing
      ? { ...existing, ...clean }
      : {
          ...clean,
          id,
          number: nextNumber(
            db.paymentOrders.map((o) => o.number),
            "ORD",
            input.date,
          ),
          status: "pending",
          requestedBy: ctx.actor.name,
          requestedById: ctx.actor.id,
          requestedRole: ctx.actor.role,
          createdAt: ctx.now,
        };
    return { ...db, paymentOrders: upsert(db.paymentOrders, order) };
  }),
  decidePaymentOrder: op<{ id: string; approve: boolean; note?: string | undefined }>(
    "approvals",
    (db, a, ctx) => {
      const o = db.paymentOrders.find((x) => x.id === a.id);
      if (!o || o.status !== "pending") fail("أمر الصرف ليس بانتظار الاعتماد.");
      requireApprover(ctx, o!);
      return {
        ...db,
        paymentOrders: db.paymentOrders.map((x) =>
          x.id === a.id
            ? {
                ...x,
                status: a.approve ? "approved" : "rejected",
                decidedBy: ctx.actor.name,
                decidedAt: ctx.now,
                decisionNote: a.note?.trim() || undefined,
              }
            : x,
        ),
      };
    },
  ),
  payPaymentOrder: op<{ id: string; date: string; boxId: string; method: string }>(
    "orders",
    (db, a, ctx) => {
      const o = db.paymentOrders.find((x) => x.id === a.id);
      if (!o) fail("أمر الصرف غير موجود.");
      if (o!.status !== "approved") fail("لا يُصرف أمر إلا بعد اعتماده.");
      requireBox(db, a.boxId);
      const tx: Transaction = {
        id: `tx-${o!.id}`,
        date: a.date,
        department: o!.department,
        kind: "out",
        description: `أمر صرف ${o!.number}: ${o!.beneficiary} — ${o!.description}`,
        amount: o!.amount,
        receiptId: o!.number,
        source: "payment-order",
        ref: o!.id,
        ...txBase(db, a.boxId, ctx),
        method: a.method || "cash",
        category: o!.category,
        paidTo: o!.beneficiary,
      };
      return {
        ...db,
        transactions: [...db.transactions.filter((t) => t.id !== tx.id), tx],
        paymentOrders: db.paymentOrders.map((x) =>
          x.id === a.id
            ? { ...x, status: "paid", paidBy: ctx.actor.name, paidOn: a.date, boxId: a.boxId, method: a.method }
            : x,
        ),
      };
    },
  ),
  unpayPaymentOrder: op<{ id: string }>("orders", (db, { id }) => ({
    ...db,
    transactions: db.transactions.filter((t) => !(t.source === "payment-order" && t.ref === id)),
    paymentOrders: db.paymentOrders.map((x) =>
      x.id === id && x.status === "paid"
        ? { ...x, status: "approved", paidBy: undefined, paidOn: undefined }
        : x,
    ),
  })),
  deletePaymentOrder: op<{ id: string }>("orders", (db, { id }) => {
    const o = db.paymentOrders.find((x) => x.id === id);
    if (o?.status === "paid") fail("أمر الصرف تم صرفه — ألغِ الصرف أولًا.");
    return { ...db, paymentOrders: db.paymentOrders.filter((x) => x.id !== id) };
  }),

  /* ----- Purchase orders & receiving (الطلبيات والاستلام) ----- */
  savePurchaseOrder: op<{ id: string; input: PurchaseOrderInput }>(
    "orders",
    (db, { id, input }, ctx) => {
      if (!input.supplierName.trim()) fail("اكتب اسم المورد.");
      const lines = input.lines.filter((l) => l.description.trim() || l.stockItemId);
      if (!lines.length) fail("أضف صنفًا واحدًا على الأقل.");
      for (const l of lines) positive(l.qty, "الكمية يجب أن تكون أكبر من صفر.");
      const existing = db.purchaseOrders.find((o) => o.id === id);
      if (existing && existing.status !== "pending")
        fail("لا يمكن تعديل الطلبية بعد اعتمادها.");
      const clean = {
        ...input,
        supplierName: input.supplierName.trim(),
        notes: input.notes?.trim() || undefined,
        lines: lines.map((l) => ({
          id: l.id,
          stockItemId: l.stockItemId || undefined,
          description:
            l.description.trim() || db.stockItems.find((i) => i.id === l.stockItemId)?.name || "",
          qty: l.qty,
          unitPrice: Math.max(0, l.unitPrice || 0),
          received: 0,
        })),
      };
      const po: PurchaseOrder = existing
        ? { ...existing, ...clean }
        : {
            ...clean,
            id,
            number: nextNumber(
              db.purchaseOrders.map((o) => o.number),
              "PUR",
              input.date,
            ),
            status: "pending",
            requestedBy: ctx.actor.name,
            requestedById: ctx.actor.id,
            requestedRole: ctx.actor.role,
            createdAt: ctx.now,
            receipts: [],
          };
      return { ...db, purchaseOrders: upsert(db.purchaseOrders, po) };
    },
  ),
  decidePurchaseOrder: op<{ id: string; approve: boolean }>("approvals", (db, a, ctx) => {
    const po = db.purchaseOrders.find((x) => x.id === a.id);
    if (!po || po.status !== "pending") fail("الطلبية ليست بانتظار الاعتماد.");
    requireApprover(ctx, po!);
    return {
      ...db,
      purchaseOrders: db.purchaseOrders.map((x) =>
        x.id === a.id
          ? { ...x, status: a.approve ? "approved" : "rejected", decidedBy: ctx.actor.name, decidedAt: ctx.now }
          : x,
      ),
    };
  }),
  receivePurchaseOrder: op<ReceiveInput>("orders", (db, a, ctx) => {
    const po = db.purchaseOrders.find((x) => x.id === a.poId);
    if (!po) fail("الطلبية غير موجودة.");
    if (po!.status !== "approved" && po!.status !== "partial")
      fail("لا يتم الاستلام إلا على طلبية معتمدة.");
    const got = a.lines.filter((l) => Number(l.qty) > 0);
    if (!got.length) fail("اكتب الكمية المستلمة لصنف واحد على الأقل.");
    for (const g of got) {
      const line = po!.lines.find((l) => l.id === g.lineId);
      if (!line) fail("صنف غير موجود في الطلبية.");
      if (g.qty > round2(line!.qty - line!.received) + 0.0001)
        fail(`الكمية المستلمة من "${line!.description}" أكبر من المتبقي (${round2(line!.qty - line!.received)}).`);
    }
    const number = nextNumber(
      po!.receipts.map((r) => r.number).concat(db.purchaseOrders.flatMap((o) => o.receipts.map((r) => r.number))),
      "GRN",
      a.date,
    );
    const value = round2(
      got.reduce((s, g) => s + g.qty * (po!.lines.find((l) => l.id === g.lineId)!.unitPrice || 0), 0),
    );
    const moves: StockMove[] = got.flatMap((g) => {
      const line = po!.lines.find((l) => l.id === g.lineId)!;
      if (!line.stockItemId || !db.stockItems.some((i) => i.id === line.stockItemId)) return [];
      return [
        {
          id: `grn-${a.receiptId}-${g.lineId}`,
          itemId: line.stockItemId,
          date: a.date,
          type: "in" as const,
          qty: g.qty,
          batchNo: g.batchNo?.trim() || undefined,
          expiry: g.expiry || undefined,
          unitCost: line.unitPrice,
          supplierName: po!.supplierName,
          note: `استلام طلبية ${po!.number} (${number})`,
          createdAt: ctx.now,
        },
      ];
    });
    const lines = po!.lines.map((l) => {
      const g = got.find((x) => x.lineId === l.id);
      return g ? { ...l, received: round2(l.received + g.qty) } : l;
    });
    const done = lines.every((l) => l.received >= l.qty - 0.0001);
    let next: HospitalDB = { ...db, stockMoves: [...db.stockMoves, ...moves] };
    let supplierInvoiceId: string | undefined;
    if (a.payment !== "none" && value > 0) {
      if (a.payment === "cash") {
        requireDirectSpender(ctx);
        requireBox(db, a.boxId || MAIN_BOX_ID);
      }
      supplierInvoiceId = `sup-${a.receiptId}`;
      next = withSupplierInvoice(next, {
        id: supplierInvoiceId,
        number: nextNumber(
          next.supplierInvoices.map((i) => i.number),
          "SUP",
          a.date,
        ),
        supplierInvoiceNo: a.supplierInvoiceNo?.trim() || number,
        date: a.date,
        supplierName: po!.supplierName,
        department: po!.department,
        category: po!.category,
        description: `استلام طلبية ${po!.number} (${number})`,
        subtotal: value,
        vatApplicable: false,
        whtType: "none",
        createdAt: ctx.now,
        terms: a.payment,
        boxId: a.payment === "cash" ? a.boxId || MAIN_BOX_ID : undefined,
      });
    }
    return {
      ...next,
      purchaseOrders: next.purchaseOrders.map((x) =>
        x.id === po!.id
          ? {
              ...x,
              lines,
              status: done ? "received" : "partial",
              receipts: [
                ...x.receipts,
                {
                  id: a.receiptId,
                  number,
                  date: a.date,
                  lines: got,
                  value,
                  payment: a.payment,
                  supplierInvoiceId,
                  by: ctx.actor.name,
                  createdAt: ctx.now,
                },
              ],
            }
          : x,
      ),
    };
  }),
  cancelPurchaseOrder: op<{ id: string }>("orders", (db, { id }) => {
    const po = db.purchaseOrders.find((x) => x.id === id);
    if (!po) return db;
    if (po.receipts.length) fail("الطلبية عليها استلامات؛ لا يمكن إلغاؤها.");
    return {
      ...db,
      purchaseOrders: db.purchaseOrders.map((x) => (x.id === id ? { ...x, status: "cancelled" } : x)),
    };
  }),
  deletePurchaseOrder: op<{ id: string }>("orders", (db, { id }) => {
    const po = db.purchaseOrders.find((x) => x.id === id);
    if (po?.receipts.length) fail("الطلبية عليها استلامات؛ لا يمكن حذفها.");
    return { ...db, purchaseOrders: db.purchaseOrders.filter((x) => x.id !== id) };
  }),

  /* ----- Department store requests (طلبات صرف مخزني): request → finance approval → issue ----- */
  saveIssueOrder: op<{ id: string; input: IssueOrderInput }>("orders", (db, { id, input }, ctx) => {
    if (!input.receiver.trim()) fail("اكتب اسم المستلم.");
    const lines = input.lines.filter((l) => l.stockItemId && Number(l.qty) > 0);
    if (!lines.length) fail("أضف صنفًا واحدًا على الأقل بكمية أكبر من صفر.");
    for (const l of lines)
      if (!db.stockItems.some((i) => i.id === l.stockItemId)) fail("صنف غير موجود في المخزن.");
    const existing = db.issueOrders.find((o) => o.id === id);
    if (existing && issueStatus(existing) !== "pending")
      fail("لا يمكن تعديل الطلب بعد اعتماده أو رفضه.");
    const clean = {
      ...input,
      receiver: input.receiver.trim(),
      note: input.note?.trim() || undefined,
      lines: lines.map((l) => ({ stockItemId: l.stockItemId, qty: Number(l.qty) })),
    };
    const order: IssueOrder = existing
      ? { ...existing, ...clean }
      : {
          ...clean,
          id,
          number: nextNumber(
            db.issueOrders.map((o) => o.number),
            "ISS",
            input.date,
          ),
          status: "pending",
          by: ctx.actor.name,
          requestedById: ctx.actor.id,
          requestedRole: ctx.actor.role,
          createdAt: ctx.now,
        };
    return { ...db, issueOrders: upsert(db.issueOrders, order) };
  }),
  decideIssueOrder: op<{ id: string; approve: boolean; note?: string | undefined }>(
    "approvals",
    (db, a, ctx) => {
      const o = db.issueOrders.find((x) => x.id === a.id);
      if (!o || issueStatus(o) !== "pending") fail("الطلب ليس بانتظار الاعتماد.");
      requireApprover(ctx, o!);
      return {
        ...db,
        issueOrders: db.issueOrders.map((x) =>
          x.id === a.id
            ? {
                ...x,
                status: a.approve ? "approved" : "rejected",
                decidedBy: ctx.actor.name,
                decidedAt: ctx.now,
                decisionNote: a.note?.trim() || undefined,
              }
            : x,
        ),
      };
    },
  ),
  /** The storekeeper hands over an approved request: stock leaves the store (nearest expiry first). */
  deliverIssueOrder: op<{ id: string; date: string }>("stock", (db, a, ctx) => {
    const o = db.issueOrders.find((x) => x.id === a.id);
    if (!o) fail("الطلب غير موجود.");
    if (issueStatus(o!) !== "approved") fail("لا يُصرف من المخزن إلا بعد اعتماد المدير المالي.");
    const want = new Map<string, number>();
    for (const l of o!.lines) want.set(l.stockItemId, (want.get(l.stockItemId) ?? 0) + l.qty);
    for (const [itemId, qty] of want) {
      const item = db.stockItems.find((i) => i.id === itemId);
      if (!item) fail("صنف غير موجود في المخزن.");
      const bal = stockStatus(item!, db.stockMoves, ctx.today).balance;
      if (qty > bal + 0.0001) fail(`رصيد "${item!.name}" المتاح ${bal} فقط.`);
    }
    const date = a.date || ctx.today;
    const moves: StockMove[] = o!.lines.map((l, i) => ({
      id: `iss-${o!.id}-${i}`,
      itemId: l.stockItemId,
      date,
      type: "out",
      qty: l.qty,
      department: o!.department,
      note: `إذن صرف ${o!.number} — ${o!.receiver}`,
      createdAt: ctx.now + i,
    }));
    return {
      ...db,
      issueOrders: db.issueOrders.map((x) =>
        x.id === o!.id ? { ...x, status: "issued", issuedBy: ctx.actor.name, issuedOn: date } : x,
      ),
      stockMoves: [...db.stockMoves.filter((m) => !m.id.startsWith(`iss-${o!.id}-`)), ...moves],
    };
  }),
  deleteIssueOrder: op<{ id: string }>("orders", (db, { id }) => ({
    ...db,
    issueOrders: db.issueOrders.filter((o) => o.id !== id),
    stockMoves: db.stockMoves.filter((m) => !m.id.startsWith(`iss-${id}-`)),
  })),

  /* ----- Settings, departments, lists ----- */
  saveSettings: op<HospitalSettings>("settings", (db, s) => ({ ...db, settings: s })),

  saveDepartment: op<Department>("settings", (db, d) => ({
    ...db,
    departments: db.departments.some((x) => x.id === d.id)
      ? db.departments.map((x) => (x.id === d.id ? { ...d, system: x.system } : x))
      : [...db.departments, d],
  })),
  deleteDepartment: op<{ id: string }>("settings", (db, { id }) => {
    if (!canDeleteDepartment(db, id)) fail("لا يمكن حذف قسم عليه حركات أو قسم أساسي.");
    return { ...db, departments: db.departments.filter((d) => d.id !== id) };
  }),
  restoreDefaultDepartments: op<Record<string, never>>("settings", (db) => {
    const ids = new Set(db.departments.map((d) => d.id));
    return {
      ...db,
      departments: [...db.departments, ...DEFAULT_DEPARTMENTS.filter((d) => !ids.has(d.id))],
    };
  }),
  saveListItem: op<{ key: keyof HospitalLists; item: ListItem }>("settings", (db, { key, item }) => ({
    ...db,
    lists: { ...db.lists, [key]: upsert(db.lists[key] as ListItem[], item) },
  })),
  deleteListItem: op<{ key: keyof HospitalLists; id: string }>("settings", (db, { key, id }) => ({
    ...db,
    lists: { ...db.lists, [key]: (db.lists[key] as ListItem[]).filter((x) => x.id !== id) },
  })),

  /* ----- Invoice exports: anyone who can view billing may export; the log is kept. ----- */
  logInvoiceExport: op<{
    id: string;
    format: ExportFormat;
    from: string;
    to: string;
    filters: string;
    invoiceIds: string[];
  }>(
    "billing",
    (db, a, ctx) => {
      if (!["excel", "report", "receipts"].includes(a.format)) fail("صيغة تصدير غير معروفة.");
      // Count and total are recomputed from the stored invoices, never taken from the browser.
      const wanted = new Set(Array.isArray(a.invoiceIds) ? a.invoiceIds : []);
      const invs = db.patientInvoices.filter((i) => wanted.has(i.id));
      if (!invs.length) fail("لا توجد فواتير للتصدير.");
      if (db.invoiceExports.some((x) => x.id === a.id)) return db;
      const number = nextNumber(
        db.invoiceExports.map((x) => x.number),
        "EXP",
        ctx.today,
      );
      return {
        ...db,
        invoiceExports: [
          ...db.invoiceExports,
          {
            id: a.id,
            number,
            at: ctx.now,
            by: ctx.actor.name,
            format: a.format,
            from: String(a.from ?? ""),
            to: String(a.to ?? ""),
            filters: String(a.filters ?? "").slice(0, 300),
            invoiceIds: invs.map((i) => i.id),
            count: invs.length,
            total: round2(invs.reduce((s, i) => s + invoiceAmounts(i).total, 0)),
          },
        ].slice(-500),
      };
    },
    "view",
  ),

  /* ----- AI-read supplier invoices (drafts) ----- */
  saveInvoiceDraft: op<{ draft: Omit<InvoiceDraft, "createdAt" | "by"> }>(
    "suppliers",
    (db, { draft }, ctx) => {
      if (!draft.id) fail("مسودة غير صحيحة.");
      const d: InvoiceDraft = {
        ...draft,
        supplierName: String(draft.supplierName ?? "").slice(0, 200),
        description: String(draft.description ?? "").slice(0, 500),
        lines: (draft.lines ?? []).slice(0, 100),
        createdAt: ctx.now,
        by: ctx.actor.name,
      };
      return { ...db, invoiceDrafts: upsert(db.invoiceDrafts, d) };
    },
  ),
  deleteInvoiceDraft: op<{ id: string }>("suppliers", (db, { id }) => ({
    ...db,
    invoiceDrafts: db.invoiceDrafts.filter((d) => d.id !== id),
  })),

  /* ----- E-invoicing (الفاتورة الإلكترونية) ----- */
  saveEInvoice: op<{ id: string; input: EInvoiceInput }>("eInvoicing", (db, { id, input }, ctx) => {
    const existing = db.eInvoices.find((x) => x.id === id);
    if (existing && existing.status !== "draft")
      fail("لا يمكن تعديل فاتورة إلكترونية بعد رفعها — ألغها وأصدر فاتورة جديدة.");
    if (!input.lines?.length) fail("أضف بندًا واحدًا على الأقل.");
    if (!input.receiver?.name?.trim()) fail("اكتب اسم المستلم.");
    const dup = input.source === "patient" && input.refIds[0]
      ? db.eInvoices.find(
          (x) => x.id !== id && x.source === "patient" && x.refIds[0] === input.refIds[0] && x.status !== "cancelled",
        )
      : undefined;
    if (dup) fail(`هذا الإيصال له فاتورة إلكترونية بالفعل (${dup.number}).`);
    const lines = input.lines.map((l) => ({
      ...l,
      qty: Math.max(0, Number(l.qty) || 0),
      unitPrice: Math.max(0, Number(l.unitPrice) || 0),
      discount: Math.max(0, Number(l.discount) || 0),
      taxType: l.taxType === "vat14" ? ("vat14" as const) : ("exempt" as const),
    }));
    const inv: EInvoice = existing
      ? { ...existing, ...input, lines }
      : {
          ...input,
          lines,
          id,
          number: nextNumber(
            db.eInvoices.map((x) => x.number),
            "EINV",
            input.date,
          ),
          status: "draft",
          createdAt: ctx.now,
          createdBy: ctx.actor.name,
        };
    return { ...db, eInvoices: upsert(db.eInvoices, inv) };
  }),
  setEInvoiceStatus: op<{ id: string; status: EInvoiceStatus; etaUuid?: string | undefined; note?: string | undefined }>(
    "eInvoicing",
    (db, a, ctx) => {
      const inv = db.eInvoices.find((x) => x.id === a.id);
      if (!inv) fail("الفاتورة غير موجودة.");
      const allowed: Record<EInvoiceStatus, EInvoiceStatus[]> = {
        draft: ["submitted", "cancelled"],
        submitted: ["accepted", "rejected", "draft"],
        accepted: ["cancelled"],
        rejected: ["draft", "cancelled"],
        cancelled: [],
      };
      if (!allowed[inv!.status].includes(a.status)) fail("لا يمكن نقل الفاتورة لهذه الحالة.");
      if (a.status === "submitted" && !a.etaUuid?.trim())
        fail("اكتب الرقم الموحد للفاتورة (UUID) الذي ظهر بعد الرفع على منظومة المصلحة.");
      return {
        ...db,
        eInvoices: db.eInvoices.map((x) =>
          x.id === a.id
            ? {
                ...x,
                status: a.status,
                etaUuid: a.status === "draft" ? undefined : (a.etaUuid?.trim() || x.etaUuid),
                statusNote: a.note?.trim() || undefined,
                submittedAt: a.status === "submitted" ? ctx.now : x.submittedAt,
              }
            : x,
        ),
      };
    },
  ),
  deleteEInvoice: op<{ id: string }>("eInvoicing", (db, { id }) => {
    const inv = db.eInvoices.find((x) => x.id === id);
    if (inv && inv.status !== "draft") fail("تُحذف المسودات فقط — الفاتورة المرفوعة تُلغى.");
    return { ...db, eInvoices: db.eInvoices.filter((x) => x.id !== id) };
  }),
  saveEtaSettings: op<{ eta: EtaSettings; taxId: string }>("eInvoicing", (db, a) => ({
    ...db,
    settings: { ...db.settings, taxId: a.taxId.trim(), eta: { ...DEFAULT_ETA_SETTINGS, ...a.eta } },
  })),

  /* ----- Banks & reconciliation (البنوك والمطابقة البنكية) ----- */
  saveBankAccount: op<Cashbox>("bank", (db, b) => {
    if (!b.name.trim()) fail("اكتب اسم الحساب البنكي.");
    const existing = db.cashboxes.find((x) => x.id === b.id);
    if (existing && existing.kind !== "bank") fail("هذه خزينة نقدية وليست حسابًا بنكيًا.");
    const box: Cashbox = { ...b, kind: "bank", name: b.name.trim(), methods: [...new Set(b.methods ?? [])] };
    return { ...db, cashboxes: upsert(db.cashboxes, box) };
  }),
  importBankStatement: op<{ id: string; input: BankStatementInput }>("bank", (db, { id, input }, ctx) => {
    const bank = db.cashboxes.find((b) => b.id === input.boxId);
    if (!bank || bank.kind !== "bank") fail("اختر الحساب البنكي.");
    if (!input.lines?.length) fail("الكشف بلا حركات.");
    if (input.lines.length > 2000) fail("الكشف كبير جدًا — قسّمه على أكثر من ملف (٢٠٠٠ حركة كحد أقصى).");
    const st: BankStatement = {
      ...input,
      id,
      number: nextNumber(
        db.bankStatements.map((x) => x.number),
        "BST",
        input.to,
      ),
      lines: input.lines.map((l, i) => ({
        id: `${id}-${i}`,
        date: l.date,
        description: String(l.description ?? "").slice(0, 300),
        reference: l.reference ? String(l.reference).slice(0, 80) : undefined,
        amount: round2(Number(l.amount) || 0),
        balance: l.balance === undefined || l.balance === null ? undefined : round2(Number(l.balance)),
      })),
      importedAt: ctx.now,
      importedBy: ctx.actor.name,
      status: "open",
    };
    return withAutoMatch({ ...db, bankStatements: [...db.bankStatements, st] }, id);
  }),
  autoMatchBankStatement: op<{ id: string }>("bank", (db, { id }) => withAutoMatch(db, id)),
  matchBankLine: op<{ statementId: string; lineId: string; bookIds: string[] }>("bank", (db, a) =>
    updateBankLine(db, a.statementId, a.lineId, (l) => ({ ...l, matched: [...new Set(a.bookIds)].slice(0, 50) })),
  ),
  unmatchBankLine: op<{ statementId: string; lineId: string }>("bank", (db, a) =>
    updateBankLine(db, a.statementId, a.lineId, (l) => ({ ...l, matched: undefined, adjustmentTxId: undefined })),
  ),
  addBankAdjustment: op<{ statementId: string; lineId: string; category: string; department: string; description: string }>(
    "bank",
    (db, a, ctx) => {
      const st = db.bankStatements.find((s) => s.id === a.statementId);
      const line = st?.lines.find((l) => l.id === a.lineId);
      if (!st || !line) fail("الحركة غير موجودة.");
      if (line!.matched?.length || line!.adjustmentTxId) fail("هذه الحركة مطابقة بالفعل.");
      const out = line!.amount < 0;
      if (out) {
        requireDirectSpender(ctx);
        if (!a.category) fail("اختر بند المصروف.");
      }
      const txId = `bnk-${line!.id}`;
      const tx: Transaction = {
        id: txId,
        date: line!.date,
        department: a.department || GENERAL_DEPT_ID,
        kind: out ? "out" : "in",
        description: (a.description || line!.description).trim().slice(0, 300),
        amount: Math.abs(line!.amount),
        receiptId: nextReceiptId(db, out ? "BNK" : "BNI", line!.date),
        source: out ? "expense" : "manual",
        ...txBase(db, st!.boxId, ctx),
        method: "transfer",
        ...(out ? { category: a.category } : {}),
      };
      const next = { ...db, transactions: [...db.transactions.filter((t) => t.id !== txId), tx] };
      return updateBankLine(next, a.statementId, a.lineId, (l) => ({ ...l, adjustmentTxId: txId }));
    },
  ),
  setBankStatementStatus: op<{ id: string; status: "open" | "reconciled" }>("bank", (db, a, ctx) => ({
    ...db,
    bankStatements: db.bankStatements.map((s) =>
      s.id === a.id
        ? {
            ...s,
            status: a.status,
            reconciledAt: a.status === "reconciled" ? ctx.now : undefined,
            reconciledBy: a.status === "reconciled" ? ctx.actor.name : undefined,
          }
        : s,
    ),
  })),
  deleteBankStatement: op<{ id: string }>("bank", (db, { id }) => ({
    ...db,
    bankStatements: db.bankStatements.filter((s) => s.id !== id),
  })),

  /* ----- Whole-system (owner only) ----- */
  resetSystem: op<{ mode: ResetMode }>("system", (db, { mode }) => resetDB(db, mode)),
  /* ---------- Credit accounts (الآجل) ---------- */
  saveCreditAccount: op<CreditAccount>("receivables", (db, a, ctx) => {
    if (!a.name?.trim()) fail("اكتب اسم الحساب.");
    if (a.kind !== "patient" && a.kind !== "company") fail("نوع الحساب غير معروف.");
    if (a.nationalId && !/^\d{14}$/.test(a.nationalId)) fail("الرقم القومي ١٤ رقمًا.");
    const existing = db.creditAccounts.find((x) => x.id === a.id);
    const acct: CreditAccount = {
      ...a,
      name: a.name.trim(),
      creditLimit: a.creditLimit && a.creditLimit > 0 ? round2(a.creditLimit) : undefined,
      termsDays: a.termsDays && a.termsDays > 0 ? Math.min(365, Math.floor(a.termsDays)) : undefined,
      createdAt: existing?.createdAt ?? ctx.now,
    };
    return { ...db, creditAccounts: upsert(db.creditAccounts, acct) };
  }),
  deleteCreditAccount: op<{ id: string }>("receivables", (db, { id }) => {
    const acct = db.creditAccounts.find((a) => a.id === id);
    if (!acct) return db;
    if (accountDebts(db, acct).length || collectionsOf(db, id).length)
      fail("على الحساب حركات — أوقفه بدل حذفه.");
    return { ...db, creditAccounts: db.creditAccounts.filter((a) => a.id !== id) };
  }),
  saveCreditCharge: op<{ id: string; input: Omit<CreditCharge, "id" | "number" | "createdAt" | "by"> }>(
    "receivables",
    (db, { id, input }, ctx) => {
      positive(input.amount);
      const acct = db.creditAccounts.find((a) => a.id === input.accountId);
      if (!acct) fail("اختر الحساب.");
      if (!input.description?.trim()) fail("اكتب بيان المديونية.");
      const problem = installmentProblem(input.amount, input.installments, input.date);
      if (problem) fail(problem);
      const existing = db.creditCharges.find((c) => c.id === id);
      const charge: CreditCharge = {
        ...input,
        id,
        amount: round2(input.amount),
        description: input.description.trim(),
        department: input.department || GENERAL_DEPT_ID,
        number: existing?.number ?? nextNumber(db.creditCharges.map((c) => c.number), "DBT", input.date),
        createdAt: existing?.createdAt ?? ctx.now,
        by: existing?.by ?? ctx.actor.name,
      };
      return { ...db, creditCharges: upsert(db.creditCharges, charge) };
    },
  ),
  deleteCreditCharge: op<{ id: string }>("receivables", (db, { id }) => ({
    ...db,
    creditCharges: db.creditCharges.filter((c) => c.id !== id),
  })),
  collectCredit: op<{ id: string; accountId: string; date: string; amount: number; boxId: string; method: string; note?: string | undefined }>(
    "receivables",
    (db, a, ctx) => {
      positive(a.amount);
      const acct = db.creditAccounts.find((x) => x.id === a.accountId);
      if (!acct) fail("الحساب غير موجود.");
      requireBox(db, a.boxId || MAIN_BOX_ID);
      const bal = accountSummary(db, acct!, a.date).balance;
      if (a.amount > bal + 0.001) fail(`رصيد الحساب ${bal} ج.م فقط.`);
      const tx: Transaction = {
        id: a.id,
        date: a.date,
        department: GENERAL_DEPT_ID,
        kind: "in",
        description: `تحصيل من ${acct!.name}${a.note?.trim() ? ` — ${a.note.trim()}` : ""}`,
        amount: round2(a.amount),
        receiptId: nextReceiptId(db, "COL", a.date),
        source: "collection",
        ref: acct!.id,
        ...txBase(db, a.boxId, ctx),
        method: a.method || "cash",
        paidTo: acct!.name,
      };
      return { ...db, transactions: [...db.transactions, tx] };
    },
  ),
  deleteCreditCollection: op<{ id: string }>("receivables", (db, { id }) => ({
    ...db,
    transactions: db.transactions.filter((t) => !(t.id === id && t.source === "collection")),
  })),

  /* ---------- Manual journal entries & chart of accounts ---------- */
  saveJournalEntry: op<{ id: string; input: Omit<ManualJournalEntry, "id" | "number" | "createdAt" | "createdBy"> }>(
    "accounting",
    (db, { id, input }, ctx) => {
      const existing = db.journalEntries.find((e) => e.id === id);
      const entry = checkJournalEntry(db, {
        ...input,
        id,
        number: existing?.number ?? nextNumber(db.journalEntries.map((e) => e.number), "JV", input.date),
        createdAt: existing?.createdAt ?? ctx.now,
        createdBy: existing?.createdBy ?? ctx.actor.name,
      });
      return { ...db, journalEntries: upsert(db.journalEntries, entry) };
    },
  ),
  deleteJournalEntry: op<{ id: string }>("accounting", (db, { id }) => ({
    ...db,
    journalEntries: db.journalEntries.filter((e) => e.id !== id),
  })),
  saveCustomAccount: op<{ code?: string | undefined; name: string; group: string }>("accounting", (db, a) => {
    if (!a.name?.trim()) fail("اكتب اسم الحساب.");
    if (!GROUPS[a.group]) fail("اختر المجموعة الرئيسية للحساب.");
    if (isControlled(a.group)) fail("هذه المجموعة تُدار من صفحاتها (الخزائن، البنوك، التأمين، الآجل، الموردين).");
    const existing = a.code ? db.customAccounts.find((c) => c.code === a.code) : undefined;
    let code = existing?.code;
    if (!code) {
      let n = db.customAccounts.filter((c) => c.group === a.group).length + 1;
      while (db.customAccounts.some((c) => c.code === `${a.group}-c${n}`)) n++;
      code = `${a.group}-c${n}`;
    }
    const acct: CustomAccount = { code, name: a.name.trim(), group: existing?.group ?? a.group };
    return { ...db, customAccounts: [...db.customAccounts.filter((c) => c.code !== code), acct] };
  }),
  deleteCustomAccount: op<{ code: string }>("accounting", (db, { code }) => {
    if (db.journalEntries.some((e) => e.lines.some((l) => l.account === code))) fail("الحساب مستخدم في قيود — لا يمكن حذفه.");
    return { ...db, customAccounts: db.customAccounts.filter((c) => c.code !== code) };
  }),

  /* ---------- Budget ---------- */
  saveBudget: op<Budget>("costCenters", (db, b) => {
    if (!(b.year >= 2000 && b.year <= 2100)) fail("السنة غير صحيحة.");
    if (!db.departments.some((d) => d.id === b.department)) fail("القسم غير موجود.");
    const clean = (xs: number[]) => Array.from({ length: 12 }, (_, i) => round2(Math.max(0, Number(xs?.[i]) || 0)));
    const budget: Budget = { year: b.year, department: b.department, revenue: clean(b.revenue), expense: clean(b.expense) };
    return {
      ...db,
      budgets: [...db.budgets.filter((x) => !(x.year === b.year && x.department === b.department)), budget],
    };
  }),

  /* ---------- Branches & currencies ---------- */
  saveBranch: op<Branch>("settings", (db, b) => {
    if (!b.name?.trim()) fail("اكتب اسم الفرع.");
    return { ...db, branches: upsert(db.branches, { ...b, name: b.name.trim() }) };
  }),
  deleteBranch: op<{ id: string }>("settings", (db, { id }) => {
    if (id === MAIN_BRANCH_ID) fail("الفرع الرئيسي لا يُحذف.");
    if (db.cashboxes.some((c) => c.branchId === id)) fail("في خزائن أو حسابات بنكية تابعة للفرع — انقلها أولًا.");
    return { ...db, branches: db.branches.filter((b) => b.id !== id) };
  }),
  saveCurrencies: op<{ currencies: Currency[] }>("settings", (db, { currencies }) => {
    const seen = new Set<string>();
    const list = currencies.map((c) => {
      const code = c.code.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) fail("كود العملة ٣ حروف إنجليزية (مثل USD).");
      if (seen.has(code)) fail(`العملة ${code} مكررة.`);
      seen.add(code);
      if (!c.name.trim()) fail("اكتب اسم العملة.");
      return { code, name: c.name.trim(), rate: round2(Math.max(0, Number(c.rate) || 0) * 100) / 100 };
    });
    return { ...db, settings: { ...db.settings, currencies: list } };
  }),

  /* ----- Staff files & employment contracts (شؤون العاملين) ----- */
  saveEmployeeFile: op<{
    id: string;
    base: Pick<Employee, "name" | "jobTitle" | "department" | "hireDate" | "nationalId">;
    personal: EmployeePersonal;
  }>("hr", (db, { id, base, personal }) => {
    if (!base.name.trim()) fail("اكتب اسم الموظف.");
    if (base.nationalId) {
      const nid = parseNationalId(base.nationalId);
      if ("error" in nid) fail(nid.error);
      if (db.employees.some((e) => e.id !== id && e.nationalId === base.nationalId))
        fail("هذا الرقم القومي مسجل لموظف آخر.");
    }
    const existing = db.employees.find((e) => e.id === id);
    // Salaries belong to the payroll page; a staff file never changes them.
    const employee: Employee = existing
      ? { ...existing, ...base, name: base.name.trim(), personal }
      : { id, ...base, name: base.name.trim(), fixedSalary: 0, variableSalary: 0, personal };
    return { ...db, employees: upsert(db.employees, employee) };
  }),
  saveContract: op<{ id: string; input: ContractInput }>("hr", (db, { id, input }, ctx) => {
    const existing = db.contracts.find((c) => c.id === id);
    if (existing && existing.status !== "draft") fail("العقد موقَّع؛ لا يمكن تعديله. حرر عقدًا جديدًا أو جدد العقد.");
    const problem = contractProblem(input, db.employees.find((e) => e.id === input.employeeId));
    if (problem) fail(problem);
    const contract: EmploymentContract = {
      ...input,
      endDate: input.type === "fixed" ? input.endDate : undefined,
      basicSalary: round2(input.basicSalary),
      allowances: round2(input.allowances),
      extraClauses: input.extraClauses?.trim() || undefined,
      id,
      number: existing?.number ?? nextContractNumber(db.contracts, input.date),
      status: "draft",
      createdAt: existing?.createdAt ?? ctx.now,
      by: existing?.by ?? ctx.actor.name,
    };
    return { ...db, contracts: upsert(db.contracts, contract) };
  }),
  // Contracts are signed on paper with a pen; this records it (an uploaded scan is optional).
  signContract: op<{ id: string; via: "paper" | "scan"; signedAt: string }>("hr", (db, { id, via, signedAt }) => {
    const c = db.contracts.find((x) => x.id === id)!;
    if (!c) fail("العقد غير موجود.");
    if (c.status !== "draft") fail("العقد موقَّع بالفعل.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signedAt)) fail("اكتب تاريخ التوقيع.");
    if (signedAt < c.date) fail("تاريخ التوقيع قبل تاريخ تحرير العقد.");
    // Signing a new contract ends any earlier signed contract of the same person, and the
    // signed terms become the employee's job, department and salary used by payroll.
    return {
      ...db,
      employees: db.employees.map((e) =>
        e.id === c.employeeId
          ? {
              ...e,
              jobTitle: c.jobTitle,
              department: c.department,
              hireDate: e.hireDate || c.startDate,
              fixedSalary: c.basicSalary,
              variableSalary: c.allowances,
            }
          : e,
      ),
      contracts: db.contracts.map((x) =>
        x.id === id
          ? { ...x, status: "signed" as const, signedVia: via, signedAt }
          : x.employeeId === c.employeeId && x.status === "signed"
            ? { ...x, status: "ended" as const, endedOn: signedAt, endReason: `استُبدل بالعقد ${c.number}` }
            : x,
      ),
    };
  }),
  endContract: op<{ id: string; endedOn: string; reason: string }>("hr", (db, { id, endedOn, reason }) => {
    const c = db.contracts.find((x) => x.id === id)!;
    if (!c || c.status !== "signed") fail("يمكن إنهاء العقود الموقَّعة فقط.");
    if (!reason.trim()) fail("اكتب سبب إنهاء العقد.");
    if (endedOn < c.startDate) fail("تاريخ الإنهاء قبل بداية العقد.");
    return {
      ...db,
      contracts: db.contracts.map((x) => (x.id === id ? { ...x, status: "ended" as const, endedOn, endReason: reason.trim() } : x)),
    };
  }),
  deleteContract: op<{ id: string }>("hr", (db, { id }) => {
    const c = db.contracts.find((x) => x.id === id);
    if (c && c.status !== "draft") fail("لا يمكن حذف عقد موقَّع؛ يمكن إنهاؤه فقط.");
    return { ...db, contracts: db.contracts.filter((x) => x.id !== id) };
  }),

  /* ----- Inpatient accounts (حساب المريض المقيم) ----- */
  openAdmission: op<{
    id: string;
    input: Pick<Admission, "date" | "patientName" | "patientPhone" | "patientId" | "patientMrn" | "ward" | "room" | "doctorId" | "payer" | "roomRate" | "supervisionRate" | "notes">;
  }>(
    "billing",
    (db, { id, input }, ctx) => {
      if (db.admissions.some((a) => a.id === id)) fail("الحساب موجود بالفعل.");
      if (!input.patientName?.trim()) fail("اكتب اسم المريض.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fail("حدد تاريخ الدخول.");
      if (!db.departments.some((d) => d.id === input.ward)) fail("اختر القسم الذي يقيم فيه المريض.");
      if (!(Number(input.roomRate) >= 0) || !(Number(input.supervisionRate) >= 0)) fail("أسعار الإقامة لا تكون بالسالب.");
      if (input.patientId && db.admissions.some((a) => a.patientId === input.patientId && a.status === "open"))
        fail("هذا المريض له حساب إقامة مفتوح بالفعل.");
      const adm: Admission = {
        ...input,
        patientName: input.patientName.trim(),
        roomRate: round2(Number(input.roomRate) || 0),
        supervisionRate: round2(Number(input.supervisionRate) || 0),
        payer: input.payer && input.payer.percent > 0 ? { payerId: input.payer.payerId, percent: Math.min(100, input.payer.percent) } : undefined,
        id,
        number: nextNumber(db.admissions.map((a) => a.number), "ADM", input.date),
        charges: [],
        status: "open",
        createdAt: ctx.now,
        by: ctx.actor.name,
      };
      return putAdmission(db, adm);
    },
    "add",
  ),
  updateAdmission: op<{ id: string; patch: Pick<Admission, "ward" | "room" | "doctorId" | "payer" | "roomRate" | "supervisionRate" | "notes"> }>(
    "billing",
    (db, { id, patch }) => {
      const adm = openAdmissionOf(db, id);
      if (!db.departments.some((d) => d.id === patch.ward)) fail("اختر القسم.");
      return putAdmission(db, {
        ...adm,
        ...patch,
        roomRate: round2(Math.max(0, Number(patch.roomRate) || 0)),
        supervisionRate: round2(Math.max(0, Number(patch.supervisionRate) || 0)),
        payer: patch.payer && patch.payer.percent > 0 ? patch.payer : undefined,
      });
    },
  ),
  addAdmissionDeposit: op<{ id: string; admissionId: string; date: string; amount: number; method: string; boxId?: string | undefined }>(
    "billing",
    (db, a, ctx) => {
      positive(a.amount);
      const adm = openAdmissionOf(db, a.admissionId);
      const boxId = deskBox(db, a.boxId, ctx);
      const tx: Transaction = {
        id: a.id,
        date: a.date,
        department: adm.ward,
        kind: "in",
        description: `تأمين دخول — ${adm.patientName} (${adm.number})`,
        amount: round2(a.amount),
        receiptId: nextReceiptId(db, "DEP", a.date),
        source: "deposit",
        ref: adm.id,
        ...txBase(db, boxId, ctx),
        method: a.method || "cash",
        paidTo: adm.patientName,
      };
      return { ...db, transactions: [...db.transactions, tx] };
    },
    "add",
  ),
  deleteAdmissionDeposit: op<{ id: string }>("billing", (db, { id }, ctx) => {
    const t = db.transactions.find((x) => x.id === id && x.source === "deposit");
    if (!t) return db;
    openAdmissionOf(db, t.ref ?? "");
    requireDirectSpender(ctx);
    return { ...db, transactions: db.transactions.filter((x) => x.id !== id) };
  }),
  addAdmissionCharge: op<{ admissionId: string; charge: Omit<AdmissionCharge, "createdAt" | "by"> }>(
    "billing",
    (db, { admissionId, charge }, ctx) => {
      const adm = openAdmissionOf(db, admissionId);
      if (adm.charges.some((c) => c.id === charge.id)) fail("البند مسجل بالفعل.");
      if (!charge.description?.trim()) fail("اكتب بيان الخدمة.");
      if (!(charge.qty > 0) || !(charge.unitPrice > 0)) fail("اكتب الكمية والسعر.");
      if (charge.date < adm.date) fail("تاريخ الخدمة قبل تاريخ الدخول.");
      const c: AdmissionCharge = { ...charge, description: charge.description.trim(), unitPrice: round2(charge.unitPrice), createdAt: ctx.now, by: ctx.actor.name };
      let next = putAdmission(db, { ...adm, charges: [...adm.charges, c] });
      if (c.stockItemId) {
        const item = db.stockItems.find((x) => x.id === c.stockItemId);
        if (!item) fail("الصنف غير موجود في المخزن.");
        const bal = stockStatus(item!, db.stockMoves, ctx.today).balance;
        if (c.qty > bal) fail(`الرصيد المتاح من «${item!.name}» ${bal} ${item!.unit} فقط.`);
        next = {
          ...next,
          stockMoves: [
            ...db.stockMoves,
            {
              id: `sm-adm-${c.id}`,
              itemId: item!.id,
              date: c.date,
              type: "out",
              qty: c.qty,
              unitCost: issueUnitCost(item!, db.stockMoves, c.qty, ctx.today),
              salePrice: c.unitPrice,
              department: adm.ward,
              note: `صرف لمريض مقيم ${adm.patientName} — ${adm.number}`,
              source: "admission",
              ref: adm.id,
              createdAt: ctx.now,
            },
          ],
        };
      }
      return next;
    },
    "add",
  ),
  removeAdmissionCharge: op<{ admissionId: string; chargeId: string }>("billing", (db, { admissionId, chargeId }) => {
    const adm = openAdmissionOf(db, admissionId);
    if (!adm.charges.some((c) => c.id === chargeId)) return db;
    const next = putAdmission(db, { ...adm, charges: adm.charges.filter((c) => c.id !== chargeId) });
    return { ...next, stockMoves: db.stockMoves.filter((m) => m.id !== `sm-adm-${chargeId}`) };
  }),
  dischargeAdmission: op<{
    admissionId: string;
    invoiceId: string;
    dischargeDate: string;
    discount: number;
    /** Collected now; empty = everything still due after the deposits. */
    paid?: number | undefined;
    paymentMethod: string;
    boxId?: string | undefined;
    notes?: string | undefined;
  }>(
    "billing",
    (db, a, ctx) => {
      const adm = openAdmissionOf(db, a.admissionId);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.dischargeDate) || a.dischargeDate < adm.date) fail("تاريخ الخروج قبل تاريخ الدخول.");
      if (db.patientInvoices.some((i) => i.id === a.invoiceId)) fail("الفاتورة موجودة بالفعل.");
      const boxId = deskBox(db, a.boxId, ctx);
      const base: PatientInvoice = {
        id: a.invoiceId,
        number: nextNumber(db.patientInvoices.map((i) => i.number), "INV", a.dischargeDate),
        date: a.dischargeDate,
        patientName: adm.patientName,
        patientPhone: adm.patientPhone,
        patientId: adm.patientId,
        patientMrn: adm.patientMrn,
        department: adm.ward,
        items: adm.charges.map((c) => ({ description: c.description, qty: c.qty, unitPrice: c.unitPrice, kind: c.kind, stockItemId: c.stockItemId })),
        discount: round2(Math.max(0, Number(a.discount) || 0)),
        paymentMethod: a.paymentMethod || "cash",
        notes: a.notes?.trim() || undefined,
        createdAt: ctx.now,
        kind: "inpatient",
        stay: { admitDate: adm.date, dischargeDate: a.dischargeDate, roomRate: adm.roomRate, supervisionRate: adm.supervisionRate, room: adm.room },
        doctorId: adm.doctorId,
        payer: adm.payer,
        boxId,
        shiftId: openShiftOf(db, ctx.actor.id)?.id,
        createdBy: ctx.actor.name,
        admissionId: adm.id,
      };
      const share = invoiceAmounts(base).patientShare;
      const deposits = depositsOf(db.transactions, adm.id);
      const s = dischargeSettlement(share, deposits, a.paid);
      if (s.error) fail(s.error);
      const r = withRemaining(db, { ...base, depositApplied: s.applied }, s.remaining, ctx);
      let next = withPatientInvoice(r.db, r.inv);
      if (s.refund > 0) {
        enoughCash(next, boxId, s.refund);
        next = {
          ...next,
          transactions: [
            ...next.transactions,
            {
              id: `dep-ret-${adm.id}`,
              date: a.dischargeDate,
              department: adm.ward,
              kind: "out",
              description: `رد باقي التأمين — ${adm.patientName} (${adm.number})`,
              amount: s.refund,
              receiptId: nextReceiptId(next, "DPR", a.dischargeDate),
              source: "deposit",
              ref: adm.id,
              ...txBase(next, boxId, ctx),
              method: "cash",
              paidTo: adm.patientName,
            },
          ],
        };
      }
      return putAdmission(next, { ...adm, status: "discharged", dischargeDate: a.dischargeDate, invoiceId: a.invoiceId });
    },
    "add",
  ),
  reopenAdmission: op<{ admissionId: string }>("billing", (db, { admissionId }, ctx) => {
    requireDirectSpender(ctx);
    const adm = db.admissions.find((a) => a.id === admissionId);
    if (!adm || adm.status !== "discharged") fail("الحساب غير موجود أو مازال مفتوحًا.");
    if (db.refunds.some((r) => r.invoiceId === adm!.invoiceId && r.status !== "rejected"))
      fail("على فاتورة الخروج مرتجع — احذفه أولًا.");
    const next = adm!.invoiceId ? withoutPatientInvoice(db, adm!.invoiceId) : db;
    return putAdmission(
      { ...next, transactions: next.transactions.filter((t) => t.id !== `dep-ret-${adm!.id}`) },
      { ...adm!, status: "open", dischargeDate: undefined, invoiceId: undefined },
    );
  }),
  deleteAdmission: op<{ id: string }>("billing", (db, { id }) => {
    const adm = openAdmissionOf(db, id);
    if (adm.charges.length) fail("على الحساب خدمات مسجلة — احذفها أولًا.");
    if (db.transactions.some((t) => t.source === "deposit" && t.ref === id)) fail("على الحساب تأمين مدفوع — لا يمكن حذفه.");
    return { ...db, admissions: db.admissions.filter((a) => a.id !== id) };
  }),

  /* ----- Patient refunds (المرتجعات): request → finance approval → paid back ----- */
  requestRefund: op<{ id: string; input: { invoiceId: string; date: string; lines: { index: number; qty: number }[]; reason: string } }>(
    "billing",
    (db, { id, input }, ctx) => {
      if (db.refunds.some((r) => r.id === id)) fail("الطلب موجود بالفعل.");
      const inv = db.patientInvoices.find((i) => i.id === input.invoiceId);
      if (!inv) fail("الإيصال غير موجود.");
      if (!input.reason?.trim()) fail("اكتب سبب المرتجع.");
      const plan = refundPlan(inv!, db.refunds, input.lines);
      if ("error" in plan) fail(plan.error);
      const ok = plan as Exclude<typeof plan, { error: string }>;
      const r: Refund = {
        id,
        number: nextNumber(db.refunds.map((x) => x.number), "RFD", input.date),
        date: input.date,
        invoiceId: inv!.id,
        invoiceNumber: inv!.number,
        patientName: inv!.patientName,
        department: inv!.department,
        lines: ok.lines,
        amount: ok.amount,
        reason: input.reason.trim(),
        status: "pending",
        requestedBy: ctx.actor.name,
        requestedById: ctx.actor.id,
        requestedRole: ctx.actor.role,
        createdAt: ctx.now,
      };
      return { ...db, refunds: [...db.refunds, r] };
    },
    "add",
  ),
  decideRefund: op<{ id: string; approve: boolean; note?: string | undefined }>("approvals", (db, { id, approve, note }, ctx) => {
    const r = db.refunds.find((x) => x.id === id);
    if (!r || r.status !== "pending") fail("الطلب غير موجود أو تم البت فيه.");
    requireApprover(ctx, r!);
    return {
      ...db,
      refunds: db.refunds.map((x) =>
        x.id === id ? { ...x, status: approve ? ("approved" as const) : ("rejected" as const), decidedBy: ctx.actor.name, decidedAt: ctx.now, decisionNote: note?.trim() || undefined } : x,
      ),
    };
  }),
  payRefund: op<{ id: string; date: string; boxId?: string | undefined; method: string }>(
    "billing",
    (db, a, ctx) => {
      const r = db.refunds.find((x) => x.id === a.id);
      if (!r) fail("المرتجع غير موجود.");
      if (r!.status !== "approved") fail(r!.status === "paid" ? "تم صرف هذا المرتجع من قبل." : "المرتجع لم يُعتمد من المدير المالي بعد.");
      const boxId = deskBox(db, a.boxId, ctx);
      enoughCash(db, boxId, r!.amount);
      const sale = (itemId: string) =>
        db.stockMoves.find((m) => m.itemId === itemId && (m.source === "sale" || m.source === "admission") && (m.ref === r!.invoiceId || m.ref === db.patientInvoices.find((i) => i.id === r!.invoiceId)?.admissionId));
      const back: StockMove[] = r!.lines
        .filter((l) => l.stockItemId && db.stockItems.some((i) => i.id === l.stockItemId))
        .map((l, i) => ({
          id: `sm-rf-${r!.id}-${i}`,
          itemId: l.stockItemId!,
          date: a.date,
          type: "in" as const,
          qty: l.qty,
          unitCost: sale(l.stockItemId!)?.unitCost ?? 0,
          salePrice: l.unitPrice,
          note: `مرتجع من المريض ${r!.patientName} — ${r!.number}`,
          source: "return" as const,
          ref: r!.id,
          createdAt: ctx.now,
        }));
      const tx: Transaction = {
        id: `rf-${r!.id}`,
        date: a.date,
        department: r!.department,
        kind: "out",
        description: `مرتجع للمريض ${r!.patientName} — إيصال ${r!.invoiceNumber}: ${r!.lines.map((l) => l.description).join("، ")}`,
        amount: r!.amount,
        receiptId: r!.number,
        source: "refund",
        ref: r!.id,
        ...txBase(db, boxId, ctx),
        method: a.method || "cash",
        paidTo: r!.patientName,
      };
      return {
        ...db,
        transactions: [...db.transactions, tx],
        stockMoves: back.length ? [...db.stockMoves, ...back] : db.stockMoves,
        refunds: db.refunds.map((x) => (x.id === r!.id ? { ...x, status: "paid" as const, paidBy: ctx.actor.name, paidOn: a.date, boxId, method: a.method || "cash" } : x)),
      };
    },
    "add",
  ),
  deleteRefund: op<{ id: string }>("billing", (db, { id }, ctx) => {
    const r = db.refunds.find((x) => x.id === id);
    if (!r) return db;
    if (r.status === "paid") requireDirectSpender(ctx);
    else if (r.requestedById !== ctx.actor.id && !canSpendDirectly(ctx.actor)) fail("يحذف الطلب من قدّمه أو المدير المالي.");
    const moves = db.stockMoves.filter((m) => !(m.source === "return" && m.ref === id));
    for (const l of r.lines) {
      const item = l.stockItemId ? db.stockItems.find((i) => i.id === l.stockItemId) : undefined;
      if (item && stockStatus(item, moves, ctx.today).balance < 0) fail(`لا يمكن الحذف: الكمية المرتجعة من «${item.name}» صُرفت بعدها.`);
    }
    return {
      ...db,
      refunds: db.refunds.filter((x) => x.id !== id),
      transactions: db.transactions.filter((t) => !(t.source === "refund" && t.ref === id)),
      stockMoves: moves.length === db.stockMoves.length ? db.stockMoves : moves,
    };
  }),

  /* ----- Staff advances (سلف الموظفين): request → approval → pay → monthly deduction ----- */
  requestAdvance: op<{ id: string; input: { date: string; employeeId: string; amount: number; months: number; startPeriod: string; reason: string } }>(
    "payroll",
    (db, { id, input }, ctx) => {
      if (db.advances.some((a) => a.id === id)) fail("الطلب موجود بالفعل.");
      positive(input.amount);
      const e = db.employees.find((x) => x.id === input.employeeId);
      if (!e) fail("اختر الموظف.");
      const months = Math.floor(Number(input.months) || 0);
      if (months < 1 || months > 36) fail("عدد الأقساط من ١ إلى ٣٦ شهرًا.");
      if (!/^\d{4}-\d{2}$/.test(input.startPeriod) || input.startPeriod < input.date.slice(0, 7))
        fail("شهر أول قسط يكون شهر السلفة أو بعده.");
      if (!input.reason?.trim()) fail("اكتب سبب السلفة.");
      const adv: Advance = {
        id,
        number: nextNumber(db.advances.map((a) => a.number), "ADV", input.date),
        date: input.date,
        employeeId: e!.id,
        employeeName: e!.name,
        department: e!.department,
        amount: round2(input.amount),
        months,
        startPeriod: input.startPeriod,
        reason: input.reason.trim(),
        status: "pending",
        requestedBy: ctx.actor.name,
        requestedById: ctx.actor.id,
        requestedRole: ctx.actor.role,
        createdAt: ctx.now,
        deductions: [],
      };
      return { ...db, advances: [...db.advances, adv] };
    },
    "add",
  ),
  decideAdvance: op<{ id: string; approve: boolean; note?: string | undefined }>("approvals", (db, { id, approve, note }, ctx) => {
    const a = db.advances.find((x) => x.id === id);
    if (!a || a.status !== "pending") fail("الطلب غير موجود أو تم البت فيه.");
    requireApprover(ctx, a!);
    return {
      ...db,
      advances: db.advances.map((x) =>
        x.id === id ? { ...x, status: approve ? ("approved" as const) : ("rejected" as const), decidedBy: ctx.actor.name, decidedAt: ctx.now, decisionNote: note?.trim() || undefined } : x,
      ),
    };
  }),
  payAdvance: op<{ id: string; date: string; boxId: string; method: string }>(
    "payroll",
    (db, a, ctx) => {
      requireDirectSpender(ctx);
      const adv = db.advances.find((x) => x.id === a.id);
      if (!adv) fail("السلفة غير موجودة.");
      if (adv!.status !== "approved") fail(adv!.status === "paid" ? "تم صرف هذه السلفة من قبل." : "السلفة لم تُعتمد بعد.");
      requireBox(db, a.boxId);
      enoughCash(db, a.boxId, adv!.amount);
      const tx: Transaction = {
        id: `adv-${adv!.id}`,
        date: a.date,
        department: adv!.department,
        kind: "out",
        description: `سلفة للموظف ${adv!.employeeName} — تُخصم على ${adv!.months} شهر`,
        amount: adv!.amount,
        receiptId: adv!.number,
        source: "advance",
        ref: adv!.id,
        ...txBase(db, a.boxId, ctx),
        method: a.method || "cash",
        paidTo: adv!.employeeName,
      };
      return {
        ...db,
        transactions: [...db.transactions, tx],
        advances: db.advances.map((x) => (x.id === adv!.id ? { ...x, status: "paid" as const, paidBy: ctx.actor.name, paidOn: a.date, boxId: a.boxId, method: a.method || "cash" } : x)),
      };
    },
    "add",
  ),
  deleteAdvance: op<{ id: string }>("payroll", (db, { id }, ctx) => {
    const a = db.advances.find((x) => x.id === id);
    if (!a) return db;
    if (a.status === "paid") {
      requireDirectSpender(ctx);
      if (a.deductions.length) fail("خُصمت أقساط من هذه السلفة في المرتبات — ألغِ ترحيل تلك الشهور أولًا.");
    } else if (a.requestedById !== ctx.actor.id && !canSpendDirectly(ctx.actor)) fail("يحذف الطلب من قدّمه أو المدير المالي.");
    return {
      ...db,
      advances: db.advances.filter((x) => x.id !== id),
      transactions: db.transactions.filter((t) => !(t.source === "advance" && t.ref === id)),
    };
  }),

  replaceAll: op<{ db: unknown }>("system", (_db, a) => {
    const parsed = a.db as Partial<HospitalDB> | null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.transactions))
      fail("الملف ليس نسخة احتياطية صحيحة.");
    return normalizeDB(parsed!);
  }),
} satisfies Record<string, Op<never>>;

export type OpName = keyof typeof OPS;
export type OpArgs<K extends OpName> = Parameters<(typeof OPS)[K]["run"]>[1];

export const AUDIT_LIMIT = 3000;

/** Short Arabic description of an operation for the audit trail. */
export function auditSummary(name: string, args: unknown): string {
  const label = OP_LABELS[name as OpName] ?? name;
  if (name === "replaceAll") return label;
  if (name === "closeCashDay" || name === "requestDayReopen") {
    const d = args as { date?: string; counted?: number; reason?: string };
    return [label, d.date, typeof d.counted === "number" ? `المعدود ${round2(d.counted)} ج.م` : "", d.reason ?? ""]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 220);
  }
  interface Loose {
    input?: unknown;
    approve?: unknown;
    status?: unknown;
    amount?: unknown;
    [k: string]: unknown;
  }
  const a = (args ?? {}) as Loose;
  const x = (a.input && typeof a.input === "object" ? a.input : a) as Loose;
  const keys = ["patientName", "beneficiary", "supplierName", "receiver", "name", "description", "reason", "period", "note", "mode"];
  const texts = keys
    .map((k) => x[k])
    .filter((v): v is string => typeof v === "string" && !!v.trim())
    .slice(0, 2);
  const amount = typeof x.amount === "number" && x.amount > 0 ? `${round2(x.amount)} ج.م` : "";
  const status =
    typeof a.approve === "boolean"
      ? a.approve
        ? "موافقة"
        : "رفض"
      : a.status === "approved"
        ? "اعتماد"
        : a.status === "flagged"
          ? "ملاحظة"
          : "";
  return [label, ...texts, amount, status].filter(Boolean).join(" — ").slice(0, 220);
}

/**
 * Operations that only create a new record need "add" (عرض وإضافة); for upserts, changing a
 * record that already exists needs full access ("edit"). Everything else keeps its own level.
 */
const ADD_OPS: Partial<Record<OpName, ((db: HospitalDB, args: never) => boolean) | true>> = {
  savePatientInvoice: (db, a: { id: string }) => db.patientInvoices.some((x) => x.id === a.id),
  requestInvoiceChange: true,
  requestPatientDelete: true,
  collectPatientRemaining: true,
  collectInsurer: true,
  openShift: true,
  closeShift: true,
  closeCashDay: true,
  requestDayReopen: true,
  addTransfer: true,
  addTransaction: true,
  saveEmployee: (db, a: { id: string }) => db.employees.some((x) => x.id === a.id),
  saveEmployeeFile: (db, a: { id: string }) => db.employees.some((x) => x.id === a.id),
  saveContract: (db, a: { id: string }) => db.contracts.some((x) => x.id === a.id),
  signContract: true,
  postPayroll: true,
  saveSupplierInvoice: (db, a: { id: string }) => db.supplierInvoices.some((x) => x.id === a.id),
  saveSupplierPayment: (db, a: { id: string }) => db.supplierPayments.some((x) => x.id === a.id),
  saveAsset: (db, a: { id: string }) => db.assets.some((x) => x.id === a.id),
  saveDoctor: (db, a: { id: string }) => db.doctors.some((x) => x.id === a.id),
  payDoctor: true,
  saveStockItem: (db, a: { id: string }) => db.stockItems.some((x) => x.id === a.id),
  addStockMove: true,
  addExpense: true,
  addPettyExpense: true,
  topUpPetty: true,
  requestPetty: true,
  payPettyRequest: true,
  savePaymentOrder: (db, a: { id: string }) => db.paymentOrders.some((x) => x.id === a.id),
  payPaymentOrder: true,
  savePurchaseOrder: (db, a: { id: string }) => db.purchaseOrders.some((x) => x.id === a.id),
  receivePurchaseOrder: true,
  saveIssueOrder: (db, a: { id: string }) => db.issueOrders.some((x) => x.id === a.id),
  deliverIssueOrder: true,
  saveInvoiceDraft: true,
  deleteInvoiceDraft: true,
  saveEInvoice: (db, a: { id: string }) => db.eInvoices.some((x) => x.id === a.id),
  importBankStatement: true,
  autoMatchBankStatement: true,
  matchBankLine: true,
  addBankAdjustment: true,
  saveCreditAccount: (db, a: { id: string }) => db.creditAccounts.some((x) => x.id === a.id),
  saveCreditCharge: (db, a: { id: string }) => db.creditCharges.some((x) => x.id === a.id),
  collectCredit: true,
  saveJournalEntry: (db, a: { id: string }) => db.journalEntries.some((x) => x.id === a.id),
  openAdmission: true,
  addAdmissionDeposit: true,
  addAdmissionCharge: true,
  dischargeAdmission: true,
  requestRefund: true,
  payRefund: true,
  requestAdvance: true,
  payAdvance: true,
};

/** The permission level an operation needs on its section for these arguments. */
export function requiredLevel(name: OpName, db: HospitalDB, args: unknown): PermLevel {
  const rule = ADD_OPS[name];
  if (!rule) return OPS[name].level;
  if (rule === true) return "add";
  return (rule as (db: HospitalDB, a: unknown) => boolean)(db, args) ? "edit" : "add";
}

/** What each level allows on each section (for the permissions list screen). */
export function opsBySection(): Record<Section, Record<"view" | "add" | "edit", string[]>> {
  const out = {} as Record<Section, Record<"view" | "add" | "edit", string[]>>;
  for (const name of Object.keys(OPS) as OpName[]) {
    const def = OPS[name];
    const rule = ADD_OPS[name];
    const lvl = rule ? "add" : def.level === "none" ? "view" : def.level;
    const bucket = (out[def.section] ??= { view: [], add: [], edit: [] });
    bucket[lvl].push(OP_LABELS[name] + (typeof rule === "function" ? " (جديد فقط)" : ""));
    if (typeof rule === "function") bucket.edit.push(`تعديل: ${OP_LABELS[name]}`);
  }
  return out;
}

/** Runs an operation after checking the person's section permission, and records it. */
export function runOp<K extends OpName>(db: HospitalDB, name: K, args: OpArgs<K>, ctx: OpCtx) {
  const def = OPS[name] as Op<OpArgs<K>> | undefined;
  if (!def) fail("عملية غير معروفة.");
  if (!can(ctx.actor, def!.section, requiredLevel(name, db, args)))
    fail("ليست لديك صلاحية لهذه العملية.");
  const next = def!.run(db, args, ctx);
  if (next === db) return db;
  const lockedYear = name === "reopenFiscalYear" ? null : lockedChange(db, next);
  if (lockedYear !== null) fail(lockedMessage(lockedYear));
  const lockedDay = def!.section === "system" ? null : lockedDayChange(db, next);
  if (lockedDay !== null) fail(lockedDayMessage(lockedDay));
  const entry = {
    id: `log-${ctx.now}-${ctx.actor.id}-${name}`,
    at: ctx.now,
    by: ctx.actor.name,
    byId: ctx.actor.id,
    role: ctx.actor.role,
    op: name,
    section: def!.section,
    summary: auditSummary(name, args),
  };
  const log = [...(next.auditLog ?? []), entry];
  return { ...next, auditLog: log.length > AUDIT_LIMIT ? log.slice(-AUDIT_LIMIT) : log };
}

export const OP_LABELS: Record<OpName, string> = {
  closeCashDay: "الإقفال اليومي للخزينة الرئيسية",
  requestDayReopen: "طلب إعادة فتح يوم مقفول",
  decideDayReopen: "اعتماد / رفض إعادة فتح يوم مقفول",
  closeFiscalYear: "إقفال وأرشفة سنة مالية",
  reopenFiscalYear: "إعادة فتح سنة مالية مقفولة",
  saveCreditAccount: "حفظ حساب آجل (مريض / شركة)",
  deleteCreditAccount: "حذف حساب آجل",
  saveCreditCharge: "تسجيل مديونية على حساب آجل",
  deleteCreditCharge: "حذف مديونية حساب آجل",
  collectCredit: "تحصيل من حساب آجل",
  deleteCreditCollection: "حذف تحصيل حساب آجل",
  saveJournalEntry: "حفظ قيد يومية يدوي",
  deleteJournalEntry: "حذف قيد يومية يدوي",
  saveCustomAccount: "إضافة / تعديل حساب في الدليل",
  deleteCustomAccount: "حذف حساب من الدليل",
  saveBudget: "حفظ الموازنة التقديرية لقسم",
  saveBranch: "حفظ فرع",
  deleteBranch: "حذف فرع",
  saveCurrencies: "أسعار صرف العملات",
  saveInvoiceDraft: "قراءة فاتورة مورد بالذكاء الاصطناعي (مسودة)",
  deleteInvoiceDraft: "حذف مسودة فاتورة مورد",
  saveEInvoice: "حفظ فاتورة إلكترونية",
  setEInvoiceStatus: "تغيير حالة فاتورة إلكترونية",
  deleteEInvoice: "حذف مسودة فاتورة إلكترونية",
  saveEtaSettings: "إعدادات الفاتورة الإلكترونية",
  saveBankAccount: "حفظ حساب بنكي",
  importBankStatement: "استيراد كشف حساب بنكي",
  autoMatchBankStatement: "مطابقة بنكية تلقائية",
  matchBankLine: "مطابقة حركة بنكية",
  unmatchBankLine: "إلغاء مطابقة حركة بنكية",
  addBankAdjustment: "قيد تسوية من كشف البنك",
  setBankStatementStatus: "اعتماد / إعادة فتح مطابقة بنكية",
  deleteBankStatement: "حذف كشف حساب بنكي",
  savePatientInvoice: "حفظ فاتورة مريض",
  deletePatientInvoice: "حذف فاتورة مريض",
  markInvoicePrinted: "طباعة إيصال",
  requestInvoiceChange: "طلب تعديل/حذف إيصال",
  collectPatientRemaining: "تحصيل متبقي من مريض",
  requestPatientDelete: "طلب حذف ملف مريض",
  decidePatientDelete: "قرار على طلب حذف ملف مريض",
  decideInvoiceChange: "قرار على طلب تعديل إيصال",
  collectInsurer: "تحصيل من جهة تأمين",
  uncollectInsurer: "إلغاء تحصيل تأمين",
  openShift: "فتح وردية",
  closeShift: "تقفيل وردية",
  addTransfer: "تحويل بين الخزائن",
  deleteTransfer: "حذف تحويل",
  saveCashbox: "حفظ خزينة",
  deleteCashbox: "حذف خزينة",
  addTransaction: "قيد خزينة يدوي",
  updateTransaction: "تعديل قيد خزينة",
  deleteTransaction: "حذف قيد خزينة",
  saveEmployee: "حفظ بيانات موظف",
  deleteEmployee: "حذف موظف",
  postPayroll: "ترحيل رواتب للخزينة",
  unpostPayroll: "إلغاء ترحيل رواتب",
  saveSupplierInvoice: "حفظ فاتورة مورد",
  deleteSupplierInvoice: "حذف فاتورة مورد",
  saveSupplierPayment: "سداد لمورد",
  deleteSupplierPayment: "حذف سداد مورد",
  saveAsset: "حفظ أصل ثابت",
  deleteAsset: "حذف أصل ثابت",
  saveDoctor: "حفظ بيانات طبيب",
  deleteDoctor: "حذف طبيب",
  payDoctor: "صرف مستحقات طبيب",
  deleteDoctorPayout: "حذف صرف مستحقات طبيب",
  saveStockItem: "حفظ صنف مخزني",
  deleteStockItem: "حذف صنف مخزني",
  addStockMove: "حركة مخزن",
  deleteStockMove: "حذف حركة مخزن",
  addExpense: "تسجيل مصروف",
  deleteExpense: "حذف مصروف",
  addPettyExpense: "مصروف نثري",
  deletePettyExpense: "حذف مصروف نثري",
  topUpPetty: "تغذية خزينة النثريات",
  deletePettyTopUp: "حذف تغذية النثريات",
  requestPetty: "طلب صرف نثرية",
  decidePettyRequest: "قرار على طلب نثرية",
  payPettyRequest: "صرف طلب نثرية معتمد",
  deletePettyRequest: "حذف طلب نثرية",
  reviewTransaction: "مراجعة حركة مالية",
  clearReview: "إلغاء مراجعة حركة",
  savePaymentOrder: "حفظ أمر صرف",
  decidePaymentOrder: "قرار على أمر صرف",
  payPaymentOrder: "صرف أمر صرف",
  unpayPaymentOrder: "إلغاء صرف أمر صرف",
  deletePaymentOrder: "حذف أمر صرف",
  savePurchaseOrder: "حفظ طلبية شراء",
  decidePurchaseOrder: "قرار على طلبية شراء",
  receivePurchaseOrder: "استلام طلبية",
  cancelPurchaseOrder: "إلغاء طلبية",
  deletePurchaseOrder: "حذف طلبية",
  saveIssueOrder: "طلب صرف مخزني لقسم",
  decideIssueOrder: "قرار على طلب صرف مخزني",
  deliverIssueOrder: "تسليم طلب صرف من المخزن",
  deleteIssueOrder: "حذف طلب صرف مخزني",
  saveSettings: "تعديل إعدادات المستشفى",
  saveDepartment: "حفظ قسم",
  deleteDepartment: "حذف قسم",
  restoreDefaultDepartments: "استعادة الأقسام الافتراضية",
  logInvoiceExport: "تصدير فواتير",
  saveListItem: "تعديل بند في القوائم",
  deleteListItem: "حذف بند من القوائم",
  resetSystem: "تصفير النظام",
  saveEmployeeFile: "حفظ ملف موظف",
  saveContract: "حفظ عقد عمل",
  signContract: "توقيع عقد عمل",
  endContract: "إنهاء عقد عمل",
  deleteContract: "حذف مسودة عقد",
  replaceAll: "استعادة نسخة احتياطية",
  openAdmission: "فتح حساب مريض مقيم",
  updateAdmission: "تعديل بيانات إقامة مريض",
  addAdmissionDeposit: "تحصيل تأمين من مريض مقيم",
  deleteAdmissionDeposit: "حذف تأمين مريض مقيم",
  addAdmissionCharge: "إضافة خدمة / دواء على حساب مريض مقيم",
  removeAdmissionCharge: "حذف بند من حساب مريض مقيم",
  dischargeAdmission: "خروج مريض مقيم وفاتورته النهائية",
  reopenAdmission: "إعادة فتح حساب مريض مقيم",
  deleteAdmission: "حذف حساب مريض مقيم",
  requestRefund: "طلب مرتجع لمريض",
  decideRefund: "قرار على طلب مرتجع",
  payRefund: "صرف مرتجع لمريض",
  deleteRefund: "حذف مرتجع",
  requestAdvance: "طلب سلفة موظف",
  decideAdvance: "قرار على طلب سلفة",
  payAdvance: "صرف سلفة موظف",
  deleteAdvance: "حذف سلفة موظف",
};
