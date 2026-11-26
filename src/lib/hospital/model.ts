/**
 * The hospital's data shape, defaults and pure helpers. Shared by the browser and the server
 * (no browser or server-only APIs here).
 */
import {
  DEFAULT_DEPARTMENTS,
  GENERAL_DEPT_ID,
  type Department,
  type DepartmentId,
  type LedgerDepartment,
} from "./constants";
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from "./payroll-tax";
import { invoiceAmounts, supplierInvoiceTotals, type DoctorShareRule, type StayInput, type WhtType } from "./finance";
import type { Permissions, Role, Section, StaffControls } from "./permissions";
import { DEFAULT_SERVICES, SERVICE_CATALOG_VERSION } from "./catalog";
import { DEFAULT_STOCK_ITEMS, STOCK_CATALOG_VERSION, STOCK_CATEGORIES } from "./stock-catalog";
import { DEFAULT_ETA_SETTINGS, type EInvoice, type EtaSettings } from "./eta";
import type { BankStatement } from "./bank";
import type { CalibrationGuide, DeviceLog, MedicalDevice } from "./devices";
import type { FileHandover } from "./handover";
import type { FiscalBudget } from "./fiscal-budget";
import type { ProfitPolicy } from "./profits";
export type { CalibrationGuide, DeviceLog, MedicalDevice } from "./devices";
export type { FileHandover, HandoverItem } from "./handover";
export type { FiscalBudget, FiscalBudgetLine } from "./fiscal-budget";
export type { ProfitPolicy, ProfitPartner } from "./profits";
export type { EInvoice, EInvoiceLine, EtaSettings } from "./eta";
export type { BankStatement, BankLine } from "./bank";
export type { Permissions, Role, Section, PermLevel, GrantableSection, StaffControls } from "./permissions";

/* ---------------- Staff & roles ---------------- */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "مدير المستشفى / مدير النظام",
  finance: "المدير المالي",
  accountant: "محاسب مالي",
  reception: "موظف استقبال",
  lab_manager: "مدير المعمل",
  icu_manager: "مدير العناية المركزة",
  radiologist: "أخصائي الأشعة",
  auditor: "مراجع داخلي",
};
export interface Actor {
  id: string;
  name: string;
  role: Role;
  /** Cash drawer a receptionist works on. */
  boxId?: string | null | undefined;
  /** Custom section permissions set by the director (null = role defaults). */
  perms?: Permissions | null | undefined;
  /** Personal limits set by the director (discount cap...). */
  controls?: StaffControls | null | undefined;
}
export const isManager = (role: Role | undefined | null) => role === "admin" || role === "finance";

/* ---------------- Records ---------------- */
export interface Employee {
  id: string;
  name: string;
  jobTitle: string;
  department: DepartmentId;
  hireDate: string; // YYYY-MM-DD
  fixedSalary: number;
  variableSalary: number;
  nationalId?: string | undefined;
  /** Personal file kept by شؤون العاملين. */
  personal?: EmployeePersonal | undefined;
}

export interface EmployeePersonal {
  phone?: string | undefined;
  address?: string | undefined;
  birthDate?: string | undefined;
  gender?: "male" | "female" | undefined;
  maritalStatus?: string | undefined;
  qualification?: string | undefined;
  insuranceNo?: string | undefined;
  emergencyContact?: string | undefined;
  /** Set when the person has left the hospital. */
  leftOn?: string | undefined;
}

export type ContractType = "fixed" | "open";
export type ContractStatus = "draft" | "signed" | "ended";
export interface EmploymentContract {
  id: string;
  number: string;
  employeeId: string;
  type: ContractType;
  date: string;
  startDate: string;
  endDate?: string | undefined;
  probationMonths: number;
  jobTitle: string;
  department: DepartmentId;
  basicSalary: number;
  allowances: number;
  dailyHours: number;
  weeklyDays: number;
  annualLeaveDays: number;
  noticeDays: number;
  extraClauses?: string | undefined;
  status: ContractStatus;
  signedAt?: string | undefined;
  /** "screen" only on older contracts signed on a tablet before paper-only signing. */
  signedVia?: "paper" | "scan" | "screen" | undefined;
  endedOn?: string | undefined;
  endReason?: string | undefined;
  createdAt: number;
  by?: string | undefined;
}

export type TxSource =
  | "manual"
  | "payroll"
  | "invoice"
  | "supplier"
  | "opening"
  | "insurer"
  | "doctor"
  | "supplier-payment"
  | "shift"
  | "expense"
  | "petty"
  | "payment-order"
  | "collection"
  | "deposit"
  | "refund"
  | "advance"
  | "owner-funding";

export const TX_SOURCE_LABELS: Record<TxSource, string> = {
  manual: "يدوي",
  payroll: "رواتب",
  invoice: "فاتورة مريض",
  supplier: "فاتورة مورد",
  opening: "افتتاحي",
  insurer: "تحصيل تأمين",
  doctor: "مستحقات طبيب",
  "supplier-payment": "سداد مورد",
  shift: "فرق تقفيل وردية",
  expense: "مصروف مسجّل",
  petty: "نثريات",
  "payment-order": "أمر صرف",
  collection: "تحصيل من حساب آجل",
  deposit: "تأمين مريض مقيم",
  refund: "مرتجع لمريض",
  advance: "سلفة موظف",
  "owner-funding": "تمويل من صاحب المستشفى",
};

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  department: LedgerDepartment;
  kind: "in" | "out";
  description: string;
  amount: number;
  receiptId: string;
  source: TxSource;
  ref?: string | undefined;
  createdAt: number;
  /** Cash box the money went into / out of (default: main treasury). */
  boxId?: string | undefined;
  /** Payment method id (lists.paymentMethods); default cash. */
  method?: string | undefined;
  /** Open shift on that box when the entry was recorded. */
  shiftId?: string | undefined;
  by?: string | undefined;
  /** Expense category id (lists.expenseCategories or lists.pettyCategories). */
  category?: string | undefined;
  /** Who received the money (expenses, petty cash, payment orders). */
  paidTo?: string | undefined;
  /** Entered in a foreign currency: original amount and the rate used (amount is always EGP). */
  fx?: FxAmount | undefined;
}

/** A foreign-currency amount converted to EGP at `rate`. */
export interface FxAmount {
  currency: string;
  amount: number;
  rate: number;
}

export type ServiceKind = "consult" | "surgery" | "procedure" | "other";
export const SERVICE_KINDS: Record<ServiceKind, string> = {
  consult: "كشف / استشارة",
  surgery: "عملية جراحية",
  procedure: "إجراء / فحص",
  other: "أخرى",
};

export interface InvoiceItem {
  description: string;
  qty: number;
  unitPrice: number;
  kind?: ServiceKind | undefined;
  /** Drug / consumable sold from the store (pharmacy): the sale takes it out of stock. */
  stockItemId?: string | undefined;
  /** The price-list service this line came from (drives the doctor's share). */
  serviceId?: string | undefined;
  /** The doctor who asked for / did this line (ECG, stitching...) when not the receipt's doctor. */
  doctorId?: string | undefined;
  /** The intervention share in force when the receipt was saved, so later rate changes never rewrite it. */
  doctorRule?: DoctorShareRule | undefined;
}

export type InvoiceKind = "outpatient" | "inpatient";
export const INVOICE_KINDS: Record<InvoiceKind, string> = {
  outpatient: "عيادات خارجية",
  inpatient: "أقسام داخلية (إقامة)",
};

export interface PatientInvoice {
  id: string;
  number: string;
  date: string;
  patientName: string;
  patientPhone?: string | undefined;
  /** The patient's file (patients table) this receipt belongs to. */
  patientId?: string | undefined;
  patientMrn?: string | undefined;
  department: DepartmentId;
  items: InvoiceItem[];
  discount: number;
  /** Id of an entry in lists.paymentMethods. */
  paymentMethod: string;
  notes?: string | undefined;
  createdAt: number;
  kind?: InvoiceKind | undefined;
  /** Inpatient stay: accommodation and medical supervision are charged per day. */
  stay?: (StayInput & { room?: string | undefined }) | undefined;
  doctorId?: string | undefined;
  /** Clinics desk: the specialty clinic (a medical department id). */
  clinicId?: string | undefined;
  /** Lab / radiology desk: the referring doctor or clinic. */
  referredBy?: string | undefined;
  /** Insurance company / syndicate covering a percentage of the net. */
  payer?: { payerId: string; percent: number } | undefined;
  /** When the insurer's share was collected. */
  insurerPaid?:
    { date: string; boxId: string; method: string; shiftId?: string | undefined } | undefined;
  boxId?: string | undefined;
  shiftId?: string | undefined;
  createdBy?: string | undefined;
  /** Set the first time the receipt is printed; reception can no longer change it. */
  printedAt?: number | undefined;
  /** A manager approved one more edit after printing. */
  unlocked?: boolean | undefined;
  /** Part of the patient's share put on a credit account (installments / company billed monthly). */
  credit?: InvoiceCredit | undefined;
  /** Operating theatre: the anaesthetist (earns the per-surgery fee too). */
  anesthetistId?: string | undefined;
  /** Final bill of an inpatient stay (admissions); changed only from the inpatient account. */
  admissionId?: string | undefined;
  /** Part of the patient's share already paid as admission deposits (cash came in earlier). */
  depositApplied?: number | undefined;
}

export interface Installment {
  due: string; // YYYY-MM-DD
  amount: number;
}
export interface InvoiceCredit {
  accountId: string;
  amount: number;
  /** Payment schedule; empty = due after the account's payment terms. */
  installments?: Installment[] | undefined;
}

export interface SupplierInvoice {
  id: string;
  number: string; // internal reference SUP-...
  supplierInvoiceNo: string;
  date: string;
  supplierName: string;
  supplierTaxId?: string | undefined;
  department: DepartmentId;
  /** Id of an entry in lists.expenseCategories. */
  category: string;
  description: string;
  subtotal: number; // before VAT
  vatApplicable: boolean;
  whtType: WhtType;
  createdAt: number;
  /** cash = paid now from the treasury; credit = added to the supplier's balance. */
  terms?: "cash" | "credit" | undefined;
  boxId?: string | undefined;
}

export interface SupplierPayment {
  id: string;
  number: string;
  supplierName: string;
  date: string;
  amount: number;
  boxId: string;
  method: string;
  note?: string | undefined;
  createdAt: number;
}

export type AssetCondition = "good" | "maintenance" | "retired";
export const ASSET_CONDITIONS: Record<AssetCondition, string> = {
  good: "يعمل",
  maintenance: "تحت الصيانة",
  retired: "مكهن",
};

export interface Asset {
  id: string;
  name: string;
  department: DepartmentId;
  category: string;
  serialNumber?: string | undefined;
  purchaseDate: string;
  unitCost: number;
  quantity: number;
  usefulLifeYears: number;
  condition: AssetCondition;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  department: DepartmentId;
  phone?: string | undefined;
  active: boolean;
  monthlySalary: number;
  /** The doctor's percentage (of consultation lines, or of every service line — see `percentOn`). */
  consultPercent: number;
  /** What the percentage is taken from; default "consult". */
  percentOn?: "consult" | "all" | undefined;
  /** Flat fee per surgery line (per qty). */
  surgeryFee: number;
  /** Per inpatient day the doctor supervises. */
  supervisionPerDay: number;
  /** The doctor's own share for specific services (wins over the service's default share). */
  serviceShares?: ({ serviceId: string } & DoctorShareRule)[] | undefined;
}

export interface DoctorPayout {
  id: string;
  number: string;
  doctorId: string;
  period: string; // YYYY-MM
  date: string;
  amount: number;
  boxId: string;
  note?: string | undefined;
  /** "daily": the doctor's shares paid at the end of a shift/day (see `doctorDay`). */
  kind?: "daily" | undefined;
  createdAt: number;
}

export interface StockItem {
  id: string;
  name: string;
  unit: string;
  /** Id in lists.stockCategories. */
  category: string;
  department: DepartmentId;
  reorderLevel: number;
  active: boolean;
  /** Price the pharmacy sells one unit to a patient for (0 / empty = not sold). */
  salePrice?: number | undefined;
}

export interface StockMove {
  id: string;
  itemId: string;
  date: string;
  type: "in" | "out";
  qty: number;
  batchNo?: string | undefined;
  expiry?: string | undefined;
  unitCost?: number | undefined;
  supplierName?: string | undefined;
  /** Department that received an issue. */
  department?: string | undefined;
  note?: string | undefined;
  createdAt: number;
  /** Automatic moves: sale on a receipt, charge on an inpatient account, return on a refund. */
  source?: "sale" | "admission" | "return" | undefined;
  /** Receipt / admission / refund id that created the move. */
  ref?: string | undefined;
  /** Unit sale price of sale / admission / return moves (pharmacy profit report). */
  salePrice?: number | undefined;
}

export interface Cashbox {
  id: string;
  name: string;
  /** A cash treasury (main, ICU), a legacy drawer, or a bank account. */
  kind: "main" | "sub" | "bank";
  active: boolean;
  bankName?: string | undefined;
  accountNo?: string | undefined;
  iban?: string | undefined;
  /** Payment methods (card, transfer...) taken at drawers that settle into this bank account. */
  methods?: string[] | undefined;
  /** Branch the drawer / account belongs to (default: main branch). */
  branchId?: string | undefined;
}
export const isBank = (b: Pick<Cashbox, "kind"> | undefined) => b?.kind === "bank";
export const isCashBox = (b: Pick<Cashbox, "kind"> | undefined) => !!b && b.kind !== "bank";
export const MAIN_BOX_ID = "main";
export const ICU_BOX_ID = "icu";
export const PETTY_BOX_ID = "petty";
/** The two cash treasuries; bank accounts stay separate. */
export const DEFAULT_CASHBOXES: Cashbox[] = [
  { id: MAIN_BOX_ID, name: "الخزينة الرئيسية", kind: "main", active: true },
  { id: ICU_BOX_ID, name: "خزنة العناية المركزة", kind: "main", active: true },
];

/** ICU receipts and ICU shifts use the ICU treasury; every other department uses the main one. */
export const boxForDepartment = (department: string | null | undefined) =>
  department === "icu" ? ICU_BOX_ID : MAIN_BOX_ID;
export const boxForRole = (role: string | null | undefined) =>
  role === "icu_manager" ? ICU_BOX_ID : MAIN_BOX_ID;

export interface Shift {
  id: string;
  number: string;
  boxId: string;
  openedAt: number;
  openedBy: string;
  openedById: string;
  openingFloat: number;
  closedAt?: number | undefined;
  closedBy?: string | undefined;
  expected?: Record<string, number> | undefined;
  counted?: Record<string, number> | undefined;
  /** main = cash handed to the main treasury; next = left in the drawer for the next shift. */
  handover?: "main" | "next" | undefined;
  note?: string | undefined;
}

export interface Transfer {
  id: string;
  number: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  method: string;
  note?: string | undefined;
  shiftId?: string | undefined;
  by?: string | undefined;
  createdAt: number;
}

export interface EditRequest {
  id: string;
  invoiceId: string;
  action: "edit" | "delete";
  reason: string;
  requestedBy: string;
  requestedById: string;
  requestedRole?: Role | undefined;
  requestedAt: number;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string | undefined;
  decidedAt?: number | undefined;
  /** The receipt as it was when the change was asked for (kept after a delete for the record). */
  snapshot?: ReceiptSnapshot | undefined;
}

/** Enough of a receipt to know what was changed or cancelled and who made it. */
export interface ReceiptSnapshot {
  number: string;
  date: string;
  patientName: string;
  department: string;
  total: number;
  paidNow: number;
  discount: number;
  createdBy?: string | undefined;
  boxId?: string | undefined;
}

/** What a fiscal year ended with, frozen when the year is closed (archive). */
export interface FiscalYearSummary {
  totalIn: number;
  totalOut: number;
  net: number;
  byDept: { dept: string; totalIn: number; totalOut: number; net: number }[];
  /** Cash in every box / bank account on 31 December. */
  boxes: { boxId: string; name: string; balance: number }[];
  receipts: number;
  entries: number;
}

/** A calendar fiscal year (1 January – 31 December) that was closed and archived. */
export interface FiscalYear {
  year: number;
  status: "closed" | "reopened";
  closedAt: number;
  closedBy: string;
  closedById: string;
  summary: FiscalYearSummary;
  reopenedAt?: number | undefined;
  reopenedBy?: string | undefined;
  reopenReason?: string | undefined;
}

/** One line of a daily closing breakdown (money in or out of the main treasury by type). */
export interface DayClosingLine {
  key: string;
  label: string;
  count: number;
  amount: number;
}

/** A collector's day in the main treasury, frozen in the daily closing. */
export interface DayClosingCollector {
  name: string;
  count: number;
  collected: number;
  paidOut: number;
  shortage: number;
  surplus: number;
  net: number;
}

/**
 * Daily closing of the main treasury (الإقفال اليومي): opening + in − out = closing for one day,
 * the cash actually counted, and who collected what. Once closed, no treasury entry dated on or
 * before that day may change; reopening needs the finance manager's approval.
 */
export interface DailyClosing {
  id: string;
  date: string;
  /** Cash treasury this day belongs to (old records default to the main treasury). */
  boxId?: string | undefined;
  status: "closed" | "reopened";
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  /** Part of the closing that should be physical cash (the rest is card / wallet / cheque). */
  expectedCash: number;
  counted: number;
  /** counted − expectedCash (negative = shortage). */
  difference: number;
  note?: string | undefined;
  inLines: DayClosingLine[];
  outLines: DayClosingLine[];
  /** Closing balance per payment method. */
  byMethod: Record<string, number>;
  collectors: DayClosingCollector[];
  entries: number;
  closedAt: number;
  closedBy: string;
  closedById: string;
  closedRole?: Role | undefined;
  /** Request to reopen the day (decided by the finance manager; the director's own reopen is direct). */
  reopen?:
    | {
        reason: string;
        requestedBy: string;
        requestedById: string;
        requestedRole: Role;
        requestedAt: number;
        status: "pending" | "approved" | "rejected";
        decidedBy?: string | undefined;
        decidedAt?: number | undefined;
        note?: string | undefined;
      }
    | undefined;
}

/** Deleting a patient file always needs the finance manager's approval. */
export interface PatientDeleteRequest {
  id: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  reason: string;
  requestedBy: string;
  requestedById: string;
  requestedRole?: Role | undefined;
  requestedAt: number;
  status: "pending" | "approved" | "rejected";
  decidedBy?: string | undefined;
  decidedAt?: number | undefined;
}

/* ---------------- Review & audit ---------------- */
export interface Review {
  status: "approved" | "flagged";
  note?: string | undefined;
  by: string;
  at: number;
  /** Amount when reviewed: a later change shows as "changed after review". */
  amount: number;
}

export interface AuditEntry {
  id: string;
  at: number;
  by: string;
  byId: string;
  role: Role;
  op: string;
  section: Section;
  summary: string;
}

/* ---------------- Payment orders (أوامر الصرف) ---------------- */
export type OrderStatus = "pending" | "approved" | "rejected" | "paid";
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "بانتظار اعتماد المدير المالي",
  approved: "معتمد — بانتظار الصرف",
  rejected: "مرفوض",
  paid: "تم الصرف",
};

export interface PaymentOrder {
  id: string;
  number: string;
  date: string;
  beneficiary: string;
  department: DepartmentId;
  category: string;
  description: string;
  amount: number;
  status: OrderStatus;
  requestedBy: string;
  requestedById: string;
  requestedRole?: Role | undefined;
  createdAt: number;
  decidedBy?: string | undefined;
  decidedAt?: number | undefined;
  decisionNote?: string | undefined;
  paidBy?: string | undefined;
  paidOn?: string | undefined;
  boxId?: string | undefined;
  method?: string | undefined;
}

/* ---------------- Petty-cash requests (طلبات صرف النثريات) ---------------- */
/** A small cash spend from the petty box; paid only after the finance manager approves it. */
export interface PettyRequest {
  id: string;
  number: string;
  date: string;
  department: DepartmentId;
  category: string;
  description: string;
  amount: number;
  paidTo?: string | undefined;
  status: OrderStatus;
  requestedBy: string;
  requestedById: string;
  requestedRole?: Role | undefined;
  createdAt: number;
  decidedBy?: string | undefined;
  decidedAt?: number | undefined;
  decisionNote?: string | undefined;
  paidBy?: string | undefined;
  paidOn?: string | undefined;
  /** Treasury the request is paid from (main / ICU). */
  boxId?: string | undefined;
}

/* ---------------- Purchase orders & receiving (الطلبيات والاستلام) ---------------- */
export type PurchaseStatus = "pending" | "approved" | "rejected" | "partial" | "received" | "cancelled";
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  pending: "بانتظار اعتماد المدير المالي",
  approved: "معتمدة — بانتظار الاستلام",
  rejected: "مرفوضة",
  partial: "استلام جزئي",
  received: "تم الاستلام بالكامل",
  cancelled: "ملغاة",
};

export interface PurchaseLine {
  id: string;
  /** Linked store item; free-text lines (services, non-stock) have none. */
  stockItemId?: string | undefined;
  description: string;
  qty: number;
  unitPrice: number;
  received: number;
}

export interface PurchaseReceipt {
  id: string;
  number: string;
  date: string;
  lines: { lineId: string; qty: number; batchNo?: string | undefined; expiry?: string | undefined }[];
  value: number;
  payment: "none" | "credit" | "cash";
  supplierInvoiceId?: string | undefined;
  by: string;
  createdAt: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  date: string;
  supplierName: string;
  department: DepartmentId;
  category: string;
  notes?: string | undefined;
  lines: PurchaseLine[];
  status: PurchaseStatus;
  requestedBy: string;
  requestedById?: string | undefined;
  requestedRole?: Role | undefined;
  createdAt: number;
  decidedBy?: string | undefined;
  decidedAt?: number | undefined;
  receipts: PurchaseReceipt[];
}

/* ---------------- Store requests / issue orders (طلبات الأقسام وأذون الصرف المخزني) ---------------- */
export type IssueStatus = "pending" | "approved" | "rejected" | "issued";
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  pending: "بانتظار اعتماد المدير المالي",
  approved: "معتمد — بانتظار التسليم من المخزن",
  rejected: "مرفوض",
  issued: "تم الصرف من المخزن",
};
export interface IssueOrder {
  id: string;
  number: string;
  date: string;
  department: DepartmentId;
  receiver: string;
  note?: string | undefined;
  lines: { stockItemId: string; qty: number }[];
  /** Who requested it. */
  by: string;
  createdAt: number;
  /** Older saves (before approvals) are treated as already issued. */
  status?: IssueStatus | undefined;
  requestedById?: string | undefined;
  requestedRole?: Role | undefined;
  decidedBy?: string | undefined;
  decidedAt?: number | undefined;
  decisionNote?: string | undefined;
  issuedBy?: string | undefined;
  issuedOn?: string | undefined;
}
export const issueStatus = (o: Pick<IssueOrder, "status">): IssueStatus => o.status ?? "issued";

/* ---------------- Inpatient accounts (حساب المريض المقيم) ---------------- */
export interface AdmissionCharge {
  id: string;
  date: string;
  /** Department that gave the service (lab, radiology, pharmacy...). */
  department: DepartmentId;
  description: string;
  qty: number;
  unitPrice: number;
  kind?: ServiceKind | undefined;
  stockItemId?: string | undefined;
  by?: string | undefined;
  createdAt: number;
}
export interface Admission {
  id: string;
  number: string;
  /** Admission date (YYYY-MM-DD). */
  date: string;
  patientName: string;
  patientPhone?: string | undefined;
  patientId?: string | undefined;
  patientMrn?: string | undefined;
  /** Ward the stay is booked to (revenue / cost center). */
  ward: DepartmentId;
  room?: string | undefined;
  doctorId?: string | undefined;
  payer?: { payerId: string; percent: number } | undefined;
  roomRate: number;
  supervisionRate: number;
  notes?: string | undefined;
  charges: AdmissionCharge[];
  status: "open" | "discharged";
  dischargeDate?: string | undefined;
  /** The final bill made on discharge. */
  invoiceId?: string | undefined;
  createdAt: number;
  by?: string | undefined;
}

/* ---------------- Patient refunds (المرتجعات) ---------------- */
export interface RefundLine {
  /** Line index on the receipt. */
  index: number;
  description: string;
  qty: number;
  amount: number;
  stockItemId?: string | undefined;
  unitPrice: number;
}
/** Money paid back to a patient for cancelled services; paid only after the finance manager approves. */
export interface Refund {
  id: string;
  number: string;
  date: string;
  invoiceId: string;
  invoiceNumber: string;
  patientName: string;
  department: DepartmentId;
  lines: RefundLine[];
  amount: number;
  reason: string;
  status: OrderStatus;
  requestedBy: string;
  requestedById: string;
  requestedRole?: Role | undefined;
  createdAt: number;
  decidedBy?: string | undefined;
  decidedAt?: number | undefined;
  decisionNote?: string | undefined;
  paidBy?: string | undefined;
  paidOn?: string | undefined;
  boxId?: string | undefined;
  method?: string | undefined;
}

/* ---------------- Staff advances (سلف الموظفين) ---------------- */
export interface Advance {
  id: string;
  number: string;
  date: string;
  employeeId: string;
  employeeName: string;
  department: DepartmentId;
  amount: number;
  /** Number of monthly installments deducted from the salary. */
  months: number;
  /** First payroll month ("YYYY-MM") the installment is deducted. */
  startPeriod: string;
  reason: string;
  status: OrderStatus;
  requestedBy: string;
  requestedById: string;
  requestedRole?: Role | undefined;
  createdAt: number;
  decidedBy?: string | undefined;
  decidedAt?: number | undefined;
  decisionNote?: string | undefined;
  paidBy?: string | undefined;
  paidOn?: string | undefined;
  boxId?: string | undefined;
  method?: string | undefined;
  /** Installments taken when a month's payroll was posted. */
  deductions: { period: string; amount: number }[];
}

/* ---------------- Editable lists (settings → البنود والقوائم) ---------------- */
export interface ListItem {
  id: string;
  name: string;
}
export interface ServiceItem extends ListItem {
  price: number;
  /** Empty = available for every department. */
  department?: string | undefined;
  /** Drives doctors' dues (consultation % / surgery fee). */
  kind?: ServiceKind | undefined;
  /** Sub-group inside the department (e.g. "هرمونات", "سونار"). */
  group?: string | undefined;
  /** Marks the department's daily room / supervision rate (used for stays such as ICU). */
  stay?: "room" | "supervision" | undefined;
  /** Allows the price to be typed on a receipt; otherwise it is fixed from this list. */
  variablePrice?: boolean | undefined;
  /** The requesting / performing doctor's share of this service (ECG, stitching...). */
  doctorShare?: DoctorShareRule | undefined;
}
export interface PayerItem extends ListItem {
  /** Default coverage percentage. */
  percent: number;
  /** Tax registration number (for e-invoices to the insurer). */
  taxId?: string | undefined;
}
export interface HospitalLists {
  services: ServiceItem[];
  expenseCategories: ListItem[];
  assetCategories: ListItem[];
  jobTitles: ListItem[];
  paymentMethods: ListItem[];
  payers: PayerItem[];
  stockCategories: ListItem[];
  pettyCategories: ListItem[];
}
export type SimpleListKey = Exclude<keyof HospitalLists, "services" | "payers">;

const L = (names: string[], prefix: string): ListItem[] =>
  names.map((name, i) => ({ id: `${prefix}${i + 1}`, name }));

export const DEFAULT_LISTS: HospitalLists = {
  services: DEFAULT_SERVICES,
  expenseCategories: [
    { id: "medical", name: "مستلزمات طبية" },
    { id: "operational", name: "مصروفات تشغيل" },
    { id: "maintenance", name: "صيانة" },
    { id: "bank-fees", name: "رسوم وعمولات بنكية" },
    ...L(
      [
        "أدوية",
        "كواشف ومحاليل معمل",
        "أفلام وصبغات أشعة",
        "مستلزمات تعقيم",
        "أغذية وتغذية",
        "مستلزمات نظافة",
        "أدوات مكتبية ومطبوعات",
        "كهرباء ومياه وغاز",
        "إيجارات",
        "اتصالات وإنترنت",
        "أتعاب أطباء زائرين",
      ],
      "ec",
    ),
  ],
  assetCategories: L(
    [
      "أجهزة تحاليل",
      "أجهزة أشعة",
      "أجهزة عمليات",
      "أجهزة رعاية مركزة",
      "أجهزة عيادات",
      "أثاث طبي",
      "أسرّة ونقالات",
      "أثاث مكتبي",
      "أجهزة كمبيوتر وشبكات",
      "سيارات إسعاف",
      "مولدات وتكييف",
      "أجهزة مطبخ ومغسلة",
    ],
    "ac",
  ),
  jobTitles: L(
    [
      "مدير المستشفى",
      "مدير طبي",
      "استشاري",
      "أخصائي",
      "طبيب مقيم",
      "طبيب امتياز",
      "صيدلي",
      "كيميائي",
      "فني معمل",
      "فني أشعة",
      "فني تخدير",
      "رئيس تمريض",
      "ممرض / ممرضة",
      "محاسب",
      "أمين خزينة",
      "موظف استقبال",
      "موظف شؤون عاملين",
      "أمين مخزن",
      "مسؤول مشتريات",
      "مهندس صيانة طبية",
      "فني صيانة",
      "مسؤول جودة",
      "مسؤول تكنولوجيا معلومات",
      "فرد أمن",
      "عامل نظافة",
      "سائق إسعاف",
    ],
    "jt",
  ),
  paymentMethods: [
    { id: "cash", name: "نقدي" },
    { id: "card", name: "فيزا / بطاقة بنكية" },
    { id: "instapay", name: "إنستاباي" },
    { id: "wallet", name: "محفظة إلكترونية" },
    { id: "transfer", name: "تحويل بنكي" },
  ],
  payers: [],
  stockCategories: STOCK_CATEGORIES,
  pettyCategories: L(
    [
      "ضيافة وبوفيه",
      "مواصلات وانتقالات",
      "أدوات نظافة بسيطة",
      "أدوات مكتبية وتصوير",
      "صيانة بسيطة",
      "طوابع ورسوم حكومية",
      "إكراميات",
      "أخرى",
    ],
    "pc",
  ),
};

export function listLabel(list: ListItem[], id: string) {
  return list.find((x) => x.id === id)?.name ?? id;
}

export interface HospitalSettings extends PayrollSettings {
  address: string;
  phones: string;
  taxId: string;
  commercialRegister: string;
  /** Version of the default price catalog already merged into lists.services. */
  catalogVersion?: number | undefined;
  /** Version of the default store catalog already merged into stockItems / stockCategories. */
  stockCatalogVersion?: number | undefined;
  /** E-invoicing (Egyptian Tax Authority) issuer details. */
  eta?: EtaSettings | undefined;
  /** Foreign currencies with their current rate to EGP. */
  currencies?: Currency[] | undefined;
}

export interface Currency {
  code: string;
  name: string;
  /** EGP per one unit. */
  rate: number;
}
export const DEFAULT_CURRENCIES: Currency[] = [
  { code: "USD", name: "دولار أمريكي", rate: 0 },
  { code: "EUR", name: "يورو", rate: 0 },
  { code: "SAR", name: "ريال سعودي", rate: 0 },
];

/* ---------------- Branches ---------------- */
export interface Branch {
  id: string;
  name: string;
  address?: string | undefined;
  phones?: string | undefined;
}
export const MAIN_BRANCH_ID = "main";
export const DEFAULT_BRANCHES: Branch[] = [{ id: MAIN_BRANCH_ID, name: "الفرع الرئيسي" }];

/* ---------------- Manual journal entries (القيود اليدوية) ---------------- */
export type ManualEntryKind = "adjustment" | "correction" | "accrual" | "prepayment" | "opening" | "other";
export const MANUAL_ENTRY_KINDS: Record<ManualEntryKind, string> = {
  adjustment: "قيد تسوية",
  correction: "قيد تصحيح",
  accrual: "مصروفات / إيرادات مستحقة",
  prepayment: "مدفوعات / إيرادات مقدمة",
  opening: "قيد افتتاحي",
  other: "قيد آخر",
};
export interface ManualLine {
  account: string;
  debit: number;
  credit: number;
  costCenter?: string | undefined;
  memo?: string | undefined;
}
export interface ManualJournalEntry {
  id: string;
  number: string;
  date: string;
  kind: ManualEntryKind;
  description: string;
  lines: ManualLine[];
  /** Accruals: reversed automatically on this date (first day of the next period). */
  reverseOn?: string | undefined;
  createdAt: number;
  createdBy?: string | undefined;
}
/** Extra accounts the accountant adds under a fixed group (code "<group>-c<n>"). */
export interface CustomAccount {
  code: string;
  name: string;
  group: string;
}

/* ---------------- Credit accounts (الحسابات الآجلة) ---------------- */
export interface CreditAccount {
  id: string;
  kind: "patient" | "company";
  name: string;
  /** Set on the patient's own account that holds the unpaid remainder of their receipts. */
  patientId?: string | undefined;
  phone?: string | undefined;
  nationalId?: string | undefined;
  taxId?: string | undefined;
  /** 0 / empty = no limit. */
  creditLimit?: number | undefined;
  /** Days until a charge is due when it has no installments (companies: e.g. 30). */
  termsDays?: number | undefined;
  notes?: string | undefined;
  active: boolean;
  createdAt: number;
}
/** A debt not coming from a receipt: opening balance or a manual charge. */
export interface CreditCharge {
  id: string;
  accountId: string;
  number: string;
  date: string;
  kind: "opening" | "service";
  description: string;
  amount: number;
  department: string;
  installments?: Installment[] | undefined;
  createdAt: number;
  by?: string | undefined;
}

/* ---------------- Budget (الموازنة التقديرية) ---------------- */
export interface Budget {
  year: number;
  department: string;
  /** 12 monthly amounts. */
  revenue: number[];
  expense: number[];
}

/* ---------------- AI-read supplier invoices (مسودات القراءة الذكية) ---------------- */
export interface InvoiceDraft {
  id: string;
  fileName: string;
  createdAt: number;
  by: string;
  supplierName: string;
  supplierTaxId?: string | undefined;
  supplierInvoiceNo?: string | undefined;
  date?: string | undefined;
  subtotal?: number | undefined;
  vat?: number | undefined;
  total?: number | undefined;
  vatApplicable: boolean;
  whtType: WhtType;
  category?: string | undefined;
  department?: string | undefined;
  description: string;
  lines: { description: string; qty: number; unitPrice: number; total: number }[];
  confidence: "high" | "medium" | "low";
  notes?: string | undefined;
}

/* ---------------- Invoice exports (إدارة تصدير الفواتير) ---------------- */
export type ExportFormat = "excel" | "report" | "receipts";
export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  excel: "ملف Excel",
  report: "تقرير PDF مجمّع",
  receipts: "إيصالات PDF",
};
export interface InvoiceExport {
  id: string;
  number: string;
  at: number;
  by: string;
  format: ExportFormat;
  from: string;
  to: string;
  /** Short description of the filters used (sections, payment method...). */
  filters: string;
  invoiceIds: string[];
  count: number;
  total: number;
}

export interface HospitalDB {
  version: 3;
  departments: Department[];
  lists: HospitalLists;
  employees: Employee[];
  contracts: EmploymentContract[];
  transactions: Transaction[];
  /** Periods ("YYYY-MM") whose net salaries were posted to the treasury. */
  payrollPostings: string[];
  patientInvoices: PatientInvoice[];
  supplierInvoices: SupplierInvoice[];
  supplierPayments: SupplierPayment[];
  assets: Asset[];
  doctors: Doctor[];
  doctorPayouts: DoctorPayout[];
  stockItems: StockItem[];
  stockMoves: StockMove[];
  cashboxes: Cashbox[];
  shifts: Shift[];
  transfers: Transfer[];
  editRequests: EditRequest[];
  patientDeleteRequests: PatientDeleteRequest[];
  fiscalYears: FiscalYear[];
  dailyClosings: DailyClosing[];
  paymentOrders: PaymentOrder[];
  pettyRequests: PettyRequest[];
  purchaseOrders: PurchaseOrder[];
  issueOrders: IssueOrder[];
  invoiceExports: InvoiceExport[];
  invoiceDrafts: InvoiceDraft[];
  eInvoices: EInvoice[];
  bankStatements: BankStatement[];
  journalEntries: ManualJournalEntry[];
  customAccounts: CustomAccount[];
  creditAccounts: CreditAccount[];
  creditCharges: CreditCharge[];
  budgets: Budget[];
  branches: Branch[];
  admissions: Admission[];
  refunds: Refund[];
  advances: Advance[];
  /** Medical devices register (every department). */
  medicalDevices: MedicalDevice[];
  /** Maintenance / calibration history of the devices. */
  deviceLogs: DeviceLog[];
  /** Calibration guides written or uploaded by the departments. */
  calibrationGuides: CalibrationGuide[];
  /** Patient-file handovers between departments (سركي التسليم). */
  fileHandovers: FileHandover[];
  /** Fiscal-year budgets (one per year). */
  fiscalBudgets: FiscalBudget[];
  /** Yearly profit distribution policies. */
  profitPolicies: ProfitPolicy[];
  /** Review status per transaction id. */
  reviews: Record<string, Review>;
  /** Who did what and when (newest last, capped). */
  auditLog: AuditEntry[];
  settings: HospitalSettings;
}

export const DEFAULT_SETTINGS: HospitalSettings = {
  ...DEFAULT_PAYROLL_SETTINGS,
  address: "",
  phones: "",
  taxId: "",
  commercialRegister: "",
  catalogVersion: SERVICE_CATALOG_VERSION,
  stockCatalogVersion: STOCK_CATALOG_VERSION,
  eta: DEFAULT_ETA_SETTINGS,
  currencies: DEFAULT_CURRENCIES,
};

export function emptyDB(): HospitalDB {
  return {
    version: 3,
    departments: DEFAULT_DEPARTMENTS.map((d) => ({ ...d })),
    lists: structuredClone(DEFAULT_LISTS),
    employees: [],
    contracts: [],
    transactions: [],
    payrollPostings: [],
    patientInvoices: [],
    supplierInvoices: [],
    supplierPayments: [],
    assets: [],
    doctors: [],
    doctorPayouts: [],
    stockItems: DEFAULT_STOCK_ITEMS.map((i) => ({ ...i })),
    stockMoves: [],
    cashboxes: DEFAULT_CASHBOXES.map((b) => ({ ...b })),
    shifts: [],
    transfers: [],
    editRequests: [],
    patientDeleteRequests: [],
    fiscalYears: [],
    dailyClosings: [],
    paymentOrders: [],
    pettyRequests: [],
    purchaseOrders: [],
    issueOrders: [],
    invoiceExports: [],
    invoiceDrafts: [],
    eInvoices: [],
    bankStatements: [],
    journalEntries: [],
    customAccounts: [],
    creditAccounts: [],
    creditCharges: [],
    budgets: [],
    branches: DEFAULT_BRANCHES.map((b) => ({ ...b })),
    admissions: [],
    refunds: [],
    advances: [],
    medicalDevices: [],
    deviceLogs: [],
    calibrationGuides: [],
    fileHandovers: [],
    fiscalBudgets: [],
    profitPolicies: [],
    reviews: {},
    auditLog: [],
    settings: DEFAULT_SETTINGS,
  };
}

/** Brings any saved copy up to the current shape without losing its data. */
export function normalizeDB(parsed: Partial<HospitalDB> | Record<string, unknown>): HospitalDB {
  const p = (parsed ?? {}) as Partial<HospitalDB>;
  const base = emptyDB();
  const departments = p.departments?.length ? [...p.departments] : base.departments;
  if (!departments.some((d) => d.id === GENERAL_DEPT_ID))
    departments.unshift(DEFAULT_DEPARTMENTS.find((d) => d.id === GENERAL_DEPT_ID)!);
  const cashboxes = p.cashboxes?.length ? [...p.cashboxes] : base.cashboxes;
  if (!cashboxes.some((b) => b.id === MAIN_BOX_ID)) cashboxes.unshift({ ...DEFAULT_CASHBOXES[0]! });
  if (!cashboxes.some((b) => b.id === ICU_BOX_ID))
    cashboxes.push({ ...DEFAULT_CASHBOXES.find((b) => b.id === ICU_BOX_ID)! });
  const arr = <K extends keyof HospitalDB>(k: K) =>
    (Array.isArray(p[k]) ? p[k] : base[k]) as HospitalDB[K];
  return foldDrawers({
    version: 3,
    departments,
    lists: withBankFees(
      withStockCategories(
        withCatalog({ ...base.lists, ...(p.lists ?? {}) }, p.settings?.catalogVersion ?? 0),
        p.settings?.stockCatalogVersion ?? 0,
      ),
    ),
    employees: arr("employees"),
    contracts: arr("contracts"),
    transactions: arr("transactions"),
    payrollPostings: arr("payrollPostings"),
    patientInvoices: arr("patientInvoices"),
    supplierInvoices: arr("supplierInvoices"),
    supplierPayments: arr("supplierPayments"),
    assets: arr("assets"),
    doctors: arr("doctors"),
    doctorPayouts: arr("doctorPayouts"),
    stockItems: withStockItems(
      Array.isArray(p.stockItems) ? p.stockItems : [],
      p.settings?.stockCatalogVersion ?? 0,
    ),
    stockMoves: arr("stockMoves"),
    cashboxes,
    shifts: arr("shifts"),
    transfers: arr("transfers"),
    editRequests: arr("editRequests"),
    patientDeleteRequests: arr("patientDeleteRequests"),
    fiscalYears: arr("fiscalYears"),
    dailyClosings: arr("dailyClosings").map((c) => ({ ...c, boxId: c.boxId ?? MAIN_BOX_ID })),
    paymentOrders: arr("paymentOrders"),
    pettyRequests: arr("pettyRequests"),
    purchaseOrders: arr("purchaseOrders"),
    issueOrders: arr("issueOrders").map((o) => ({ ...o, status: issueStatus(o) })),
    invoiceExports: arr("invoiceExports"),
    invoiceDrafts: arr("invoiceDrafts"),
    eInvoices: arr("eInvoices"),
    bankStatements: arr("bankStatements"),
    journalEntries: arr("journalEntries"),
    customAccounts: arr("customAccounts"),
    creditAccounts: arr("creditAccounts"),
    creditCharges: arr("creditCharges"),
    budgets: arr("budgets"),
    branches: Array.isArray(p.branches) && p.branches.some((b) => b.id === MAIN_BRANCH_ID) ? p.branches : [...DEFAULT_BRANCHES, ...(Array.isArray(p.branches) ? p.branches : [])],
    admissions: arr("admissions"),
    refunds: arr("refunds"),
    advances: arr("advances"),
    medicalDevices: arr("medicalDevices"),
    deviceLogs: arr("deviceLogs"),
    calibrationGuides: arr("calibrationGuides"),
    fileHandovers: arr("fileHandovers"),
    fiscalBudgets: arr("fiscalBudgets"),
    profitPolicies: arr("profitPolicies"),
    reviews: p.reviews && typeof p.reviews === "object" ? { ...p.reviews } : {},
    auditLog: arr("auditLog"),
    settings: {
      ...DEFAULT_SETTINGS,
      ...(p.settings ?? {}),
      eta: { ...DEFAULT_ETA_SETTINGS, ...(p.settings?.eta ?? {}) },
      currencies: p.settings?.currencies?.length ? p.settings.currencies : DEFAULT_CURRENCIES,
      catalogVersion: SERVICE_CATALOG_VERSION,
      stockCatalogVersion: STOCK_CATALOG_VERSION,
    },
  });
}

/**
 * The hospital has a single cash treasury: drawers (sub boxes, including the old petty box) from
 * older saves fold into the main treasury — their entries move to it and transfers between them
 * vanish, so the main balance is the sum of everything. Bank accounts are kept as they are.
 */
export function foldDrawers(db: HospitalDB): HospitalDB {
  const subs = new Set(db.cashboxes.filter((b) => b.kind === "sub").map((b) => b.id));
  if (!subs.size) return db;
  const to = (id: string) => (subs.has(id) ? MAIN_BOX_ID : id);
  const fix = <T extends { boxId?: string | null | undefined }>(xs: T[]): T[] =>
    xs.map((x) => (x.boxId && subs.has(x.boxId) ? { ...x, boxId: MAIN_BOX_ID } : x));
  return {
    ...db,
    cashboxes: db.cashboxes.filter((b) => !subs.has(b.id)),
    transactions: fix(db.transactions),
    patientInvoices: fix(db.patientInvoices).map((i) =>
      i.insurerPaid && subs.has(i.insurerPaid.boxId) ? { ...i, insurerPaid: { ...i.insurerPaid, boxId: MAIN_BOX_ID } } : i,
    ),
    supplierInvoices: fix(db.supplierInvoices),
    supplierPayments: fix(db.supplierPayments),
    doctorPayouts: fix(db.doctorPayouts),
    shifts: fix(db.shifts),
    paymentOrders: fix(db.paymentOrders),
    refunds: fix(db.refunds),
    advances: fix(db.advances),
    transfers: db.transfers
      .map((t) => ({ ...t, from: to(t.from), to: to(t.to) }))
      .filter((t) => t.from !== t.to),
  };
}

/** Bank reconciliation books bank charges under their own expense item. */
function withBankFees(lists: HospitalLists): HospitalLists {
  if (lists.expenseCategories.some((c) => c.id === "bank-fees")) return lists;
  return { ...lists, expenseCategories: [...lists.expenseCategories, { id: "bank-fees", name: "رسوم وعمولات بنكية" }] };
}

/** Adds catalog services an older save has never received (deleted ones stay deleted). */
export function withCatalog(lists: HospitalLists, savedVersion: number): HospitalLists {
  if (savedVersion >= SERVICE_CATALOG_VERSION) return lists;
  const have = new Set(lists.services.map((s) => s.id));
  return { ...lists, services: [...lists.services, ...DEFAULT_SERVICES.filter((s) => !have.has(s.id))] };
}

/** Adds store categories an older save has never received. */
export function withStockCategories(lists: HospitalLists, savedVersion: number): HospitalLists {
  if (savedVersion >= STOCK_CATALOG_VERSION) return lists;
  const have = new Set(lists.stockCategories.map((c) => c.id));
  return { ...lists, stockCategories: [...lists.stockCategories, ...STOCK_CATEGORIES.filter((c) => !have.has(c.id))] };
}

/** Adds the store catalog's consumables an older save has never received (deleted ones stay deleted). */
export function withStockItems(items: StockItem[], savedVersion: number): StockItem[] {
  if (savedVersion >= STOCK_CATALOG_VERSION) return items;
  const have = new Set(items.map((i) => i.id));
  return [...items, ...DEFAULT_STOCK_ITEMS.filter((i) => !have.has(i.id)).map((i) => ({ ...i }))];
}

/** True when the copy holds any operational record (used to offer uploading old device data). */
export function hasRecords(db: HospitalDB) {
  return (
    db.transactions.length +
      db.patientInvoices.length +
      db.supplierInvoices.length +
      db.employees.length +
      db.assets.length >
    0
  );
}

/* ---------------- Pure helpers ---------------- */

export const invoiceTotals = (inv: PatientInvoice) => invoiceAmounts(inv);

export function supplierInvoicePayable(inv: SupplierInvoice) {
  return supplierInvoiceTotals(inv.subtotal, inv.vatApplicable, inv.whtType).payable;
}

export function findBox(db: Pick<HospitalDB, "cashboxes">, id: string | undefined) {
  return (
    db.cashboxes.find((b) => b.id === (id ?? MAIN_BOX_ID)) ?? {
      id: id ?? "?",
      name: "خزينة غير معروفة",
      kind: "sub" as const,
      active: false,
    }
  );
}

/** A person's open shift: each desk person counts their own cash into the one main treasury. */
export function openShiftOf(db: Pick<HospitalDB, "shifts">, userId: string | undefined) {
  return (userId && db.shifts.find((s) => s.openedById === userId && !s.closedAt)) || null;
}

/** Next sequential number like INV-20261114-003, unique among `used`. */
export function nextNumber(used: Iterable<string>, prefix: string, date: string) {
  const day = date.replaceAll("-", "");
  const set = new Set(used);
  const stem = `${prefix}-${day}-`;
  let n = [...set].filter((x) => x.startsWith(stem)).length + 1;
  while (set.has(`${stem}${String(n).padStart(3, "0")}`)) n++;
  return `${stem}${String(n).padStart(3, "0")}`;
}

export function nextReceiptId(db: Pick<HospitalDB, "transactions">, prefix: string, date: string) {
  return nextNumber(
    db.transactions.map((t) => t.receiptId),
    prefix,
    date,
  );
}

/** Ledger sorted chronologically with running balance. */
export function withRunningBalance<
  T extends { date: string; createdAt: number; kind: "in" | "out"; amount: number },
>(txs: T[], opening = 0) {
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let bal = opening;
  return sorted.map((t) => {
    bal += t.kind === "in" ? t.amount : -t.amount;
    return { ...t, balance: Math.round(bal * 100) / 100 };
  });
}
