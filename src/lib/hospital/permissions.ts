/**
 * Section permissions. The hospital director (admin) can give each staff member, per section,
 * no access / view only / view + add / full access. Without custom settings a person gets their
 * role's defaults. Pure and shared by the browser (menus) and the server (op checks).
 */
export type Role =
  | "admin"
  | "finance"
  | "accountant"
  | "reception"
  | "lab_manager"
  | "icu_manager"
  | "radiologist"
  | "auditor";

/** Every role, in the order shown on screens. */
export const ROLES: Role[] = [
  "admin",
  "finance",
  "accountant",
  "reception",
  "lab_manager",
  "icu_manager",
  "radiologist",
  "auditor",
];

/**
 * Desk roles collect money at one department drawer that belongs to them alone (reception,
 * lab, ICU, radiology). They always work on that drawer during an open shift.
 */
export const DESK_ROLES: Role[] = ["reception", "lab_manager", "icu_manager", "radiologist"];
export const isDeskRole = (role: Role | null | undefined) => !!role && DESK_ROLES.includes(role);

/**
 * Only the director changes a printed receipt or deletes any receipt directly. Everyone else
 * (finance manager included) asks first; the finance manager approves staff requests and the
 * director approves the finance manager's own.
 */
export const needsReceiptApproval = (actor: { role: Role }) => actor.role !== "admin";

/** Personal limits the director sets on an account. */
export interface StaffControls {
  /** Highest discount (% of the receipt before discount) allowed without approval; null = no cap. */
  maxDiscountPct?: number | null | undefined;
}

export function cleanControls(input: unknown): StaffControls | null {
  if (!input || typeof input !== "object") return null;
  const raw = (input as Record<string, unknown>)["maxDiscountPct"];
  const n = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (n === null || !Number.isFinite(n)) return null;
  return { maxDiscountPct: Math.min(100, Math.max(0, Math.round(n * 100) / 100)) };
}

/** Discount of a receipt as a % of its value before discount. */
export function discountPct(subtotal: number, discount: number) {
  return subtotal > 0 ? Math.round((Math.max(0, discount) / subtotal) * 10000) / 100 : 0;
}
/** none < view < add (create new records only) < edit (create, change, delete). */
export type PermLevel = "none" | "view" | "add" | "edit";

export const SECTIONS = [
  { key: "dashboard", label: "لوحة التحكم", group: "الرئيسية" },
  { key: "treasury", label: "الخزائن وحركة النقدية", group: "الرئيسية" },
  { key: "shifts", label: "الورديات وتقفيل الشيفت", group: "الرئيسية" },
  { key: "bank", label: "البنوك والمطابقة البنكية", group: "الرئيسية" },
  { key: "billing", label: "فواتير وإيصالات المرضى", group: "دورة الإيرادات" },
  { key: "insurance", label: "مستحقات التأمين", group: "دورة الإيرادات" },
  { key: "doctors", label: "الأطباء ومستحقاتهم", group: "دورة الإيرادات" },
  { key: "eInvoicing", label: "الفاتورة الإلكترونية والضرائب", group: "دورة الإيرادات" },
  { key: "receivables", label: "حسابات المرضى والشركات (الآجل)", group: "دورة الإيرادات" },
  { key: "patients", label: "ملفات المرضى الطبية", group: "الملف الطبي" },
  { key: "appointments", label: "المواعيد والحجوزات", group: "الملف الطبي" },
  { key: "lab", label: "طلبات ونتائج المعمل", group: "الملف الطبي" },
  { key: "hr", label: "شؤون العاملين والعقود", group: "شؤون العاملين" },
  { key: "expenses", label: "إدارة المصروفات", group: "المصروفات" },
  { key: "pettyCash", label: "النثريات", group: "المصروفات" },
  { key: "orders", label: "أوامر الصرف والطلبيات وطلبات الأقسام", group: "المصروفات" },
  { key: "payroll", label: "الأجور والمرتبات", group: "المصروفات" },
  { key: "suppliers", label: "مشتريات الموردين", group: "المصروفات" },
  { key: "supplierAccounts", label: "كشف حساب الموردين", group: "المصروفات" },
  { key: "stock", label: "المخزن العام (أدوية ومستلزمات كل الأقسام)", group: "المخازن والأصول" },
  { key: "inventory", label: "الأصول الثابتة", group: "المخازن والأصول" },
  { key: "review", label: "المراجعة وسجل العمليات", group: "المراجعة" },
  { key: "approvals", label: "الاعتمادات (للمدير المالي)", group: "المراجعة" },
  { key: "costCenters", label: "مراكز التكلفة", group: "التقارير والإعدادات" },
  { key: "closing", label: "التقفيل الشهري والسنوي", group: "التقارير والإعدادات" },
  { key: "accounting", label: "القوائم المالية ودفتر الأستاذ", group: "التقارير والإعدادات" },
  { key: "settings", label: "الإعدادات والمستخدمين", group: "التقارير والإعدادات" },
] as const;

export type GrantableSection = (typeof SECTIONS)[number]["key"];
/** "system" (reset, restore, permissions) belongs to the director only and is never granted. */
export type Section = GrantableSection | "system";
export type Permissions = Partial<Record<GrantableSection, PermLevel>>;

export const PERM_LEVELS: PermLevel[] = ["none", "view", "add", "edit"];
export const PERM_LABELS: Record<PermLevel, string> = {
  none: "بدون",
  view: "عرض فقط",
  add: "عرض وإضافة",
  edit: "كامل",
};
export const PERM_HINTS: Record<PermLevel, string> = {
  none: "لا يرى القسم نهائيًا",
  view: "يرى البيانات ويطبع ويصدّر فقط",
  add: "يضيف تسجيلات وطلبات جديدة، ولا يعدّل أو يحذف",
  edit: "يضيف ويعدّل ويحذف",
};

const all = (level: PermLevel) =>
  Object.fromEntries(SECTIONS.map((s) => [s.key, level])) as Record<GrantableSection, PermLevel>;

/** Medical records are private: only people the director grants them to (and reception for bookings). */
const MEDICAL_NONE = { patients: "none", appointments: "none", lab: "none" } as const;

export const ROLE_DEFAULTS: Record<Role, Record<GrantableSection, PermLevel>> = {
  admin: all("edit"),
  finance: { ...all("edit"), ...MEDICAL_NONE },
  /** Works on every drawer; anything that pays money out goes through a payment order. */
  accountant: {
    ...all("view"),
    ...MEDICAL_NONE,
    billing: "edit",
    shifts: "edit",
    treasury: "add",
    insurance: "edit",
    receivables: "edit",
    doctors: "view",
    expenses: "view",
    pettyCash: "add",
    orders: "add",
    suppliers: "add",
    supplierAccounts: "view",
    hr: "none",
    payroll: "view",
    approvals: "none",
    settings: "none",
    review: "view",
  },
  reception: { ...all("none"), billing: "edit", shifts: "edit", appointments: "edit", patients: "add" },
  lab_manager: {
    ...all("none"),
    dashboard: "view",
    billing: "edit",
    shifts: "edit",
    patients: "view",
    lab: "edit",
    orders: "add",
    pettyCash: "add",
    stock: "view",
  },
  icu_manager: {
    ...all("none"),
    dashboard: "view",
    billing: "edit",
    shifts: "edit",
    patients: "view",
    orders: "add",
    pettyCash: "add",
    stock: "view",
  },
  radiologist: {
    ...all("none"),
    dashboard: "view",
    billing: "edit",
    shifts: "edit",
    patients: "view",
    orders: "add",
    pettyCash: "add",
    stock: "view",
  },
  auditor: { ...all("view"), review: "edit", ...MEDICAL_NONE, hr: "none" },
};

const RANK: Record<PermLevel, number> = { none: 0, view: 1, add: 2, edit: 3 };

export interface PermActor {
  role: Role;
  perms?: Permissions | null | undefined;
}

/** The level a person actually has on a section (custom setting first, then role default). */
export function levelOf(actor: PermActor, section: Section): PermLevel {
  if (actor.role === "admin") return "edit";
  if (section === "system") return "none";
  return actor.perms?.[section] ?? ROLE_DEFAULTS[actor.role]?.[section] ?? "none";
}

export function can(actor: PermActor, section: Section, level: PermLevel = "view") {
  return RANK[levelOf(actor, section)] >= RANK[level];
}

/**
 * Who may approve a request (payment order, purchase order, store request, receipt change):
 * only the finance manager, never on their own request. The director may approve only what a
 * finance manager requested (so the finance manager's own requests are not stuck).
 */
export function canApprove(
  actor: PermActor & { id?: string },
  request: { requestedById?: string | undefined; requestedRole?: Role | undefined },
) {
  if (!can(actor, "approvals", "edit")) return false;
  if (actor.role === "finance") return !actor.id || request.requestedById !== actor.id;
  if (actor.role === "admin") return request.requestedRole === "finance";
  return false;
}

/** Roles that may spend money directly; everyone else goes through a payment order. */
export const canSpendDirectly = (actor: PermActor) => actor.role === "admin" || actor.role === "finance";

/** Keeps only known sections and levels (input from the director's screen). */
export function cleanPermissions(input: unknown): Permissions | null {
  if (!input || typeof input !== "object") return null;
  const out: Permissions = {};
  for (const s of SECTIONS) {
    const v = (input as Record<string, unknown>)[s.key];
    if (v === "none" || v === "view" || v === "add" || v === "edit") out[s.key] = v;
  }
  return Object.keys(out).length ? out : null;
}
