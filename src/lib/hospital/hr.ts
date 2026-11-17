/** Staff files and employment contracts (شؤون العاملين). Pure. */
import type { EmploymentContract, Employee } from "./model";
import { parseNationalId } from "./national-id";

export const CONTRACT_TYPES: Record<EmploymentContract["type"], string> = {
  fixed: "عقد محدد المدة",
  open: "عقد غير محدد المدة",
};
export const CONTRACT_STATUS: Record<EmploymentContract["status"], string> = {
  draft: "مسودة — لم يوقَّع",
  signed: "موقَّع",
  ended: "منتهي",
};
export const STAFF_FILE_KINDS = {
  id_front: "البطاقة — الوجه",
  id_back: "البطاقة — الظهر",
  signature: "توقيع الموظف على العقد",
  contract_scan: "نسخة العقد الموقَّعة (مسح ضوئي)",
  other: "مستند آخر",
} as const;
export type StaffFileKind = keyof typeof STAFF_FILE_KINDS;

export type ContractInput = Omit<EmploymentContract, "id" | "number" | "status" | "signedAt" | "signedVia" | "endedOn" | "endReason" | "createdAt" | "by">;

/** Why a contract can't be saved, or null. */
export function contractProblem(c: ContractInput, employee: Employee | undefined): string | null {
  if (!employee) return "اختر الموظف.";
  if (!employee.nationalId || "error" in parseNationalId(employee.nationalId))
    return "سجّل رقم قومي صحيح للموظف في ملفه قبل تحرير العقد.";
  if (!c.startDate) return "اكتب تاريخ بداية العقد.";
  if (c.type === "fixed") {
    if (!c.endDate) return "العقد محدد المدة يحتاج تاريخ نهاية.";
    if (c.endDate <= c.startDate) return "تاريخ نهاية العقد يجب أن يكون بعد بدايته.";
  }
  if (!(c.basicSalary > 0)) return "اكتب الأجر الأساسي.";
  if (c.allowances < 0) return "البدلات لا تكون بالسالب.";
  if (c.probationMonths < 0 || c.probationMonths > 3) return "فترة الاختبار من صفر إلى ٣ شهور.";
  if (!(c.dailyHours > 0 && c.dailyHours <= 8)) return "ساعات العمل اليومية من ١ إلى ٨ ساعات.";
  if (!(c.weeklyDays >= 1 && c.weeklyDays <= 6)) return "أيام العمل في الأسبوع من ١ إلى ٦ (يوم راحة على الأقل).";
  if (!(c.annualLeaveDays >= 0)) return "اكتب أيام الإجازة السنوية.";
  if (!c.jobTitle.trim()) return "اكتب الوظيفة.";
  return null;
}

const n = (v: number) => v.toLocaleString("ar-EG");
const money = (v: number) => v.toLocaleString("ar-EG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** The contract clauses as printed. Hospital-specific clauses come from `extraClauses` (one per line). */
export function contractClauses(c: EmploymentContract, deptName: string, hospitalName: string): string[] {
  const clauses = [
    `يعمل الطرف الثاني لدى الطرف الأول (${hospitalName}) بوظيفة «${c.jobTitle}» بقسم ${deptName}، ويلتزم بأداء العمل المكلف به بنفسه وبعناية، وباتباع تعليمات العمل ولوائح المستشفى ونظم مكافحة العدوى وسلامة المرضى.`,
    c.type === "fixed"
      ? `مدة هذا العقد من ${c.startDate} حتى ${c.endDate}، ويجوز تجديده باتفاق الطرفين كتابةً.`
      : `هذا العقد غير محدد المدة ويبدأ العمل به اعتبارًا من ${c.startDate}.`,
    c.probationMonths > 0
      ? `يخضع الطرف الثاني لفترة اختبار مدتها ${n(c.probationMonths)} شهر من تاريخ بدء العمل، ولا يجوز تعيينه تحت الاختبار أكثر من مرة لدى الطرف الأول.`
      : "لا يخضع الطرف الثاني لفترة اختبار.",
    `يتقاضى الطرف الثاني أجرًا أساسيًا شهريًا قدره ${money(c.basicSalary)} جنيه${c.allowances > 0 ? `، وبدلات شهرية قدرها ${money(c.allowances)} جنيه، بإجمالي ${money(c.basicSalary + c.allowances)} جنيه` : ""}، يُصرف في نهاية كل شهر، وتُخصم منه الاستقطاعات المقررة قانونًا (التأمينات الاجتماعية وضريبة كسب العمل).`,
    `ساعات العمل ${n(c.dailyHours)} ساعات يوميًا لمدة ${n(c.weeklyDays)} أيام أسبوعيًا، مع راحة أسبوعية مدفوعة الأجر، ويجوز تشغيله بنظام الورديات وفق حاجة العمل بالمستشفى مع احتساب الأجر الإضافي طبقًا للقانون.`,
    `يستحق الطرف الثاني إجازة سنوية مدفوعة الأجر مدتها ${n(c.annualLeaveDays)} يومًا، بالإضافة إلى الإجازات العارضة والمرضية والرسمية المقررة قانونًا.`,
    "يلتزم الطرف الأول بالتأمين على الطرف الثاني لدى الهيئة القومية للتأمين الاجتماعي من تاريخ بدء العمل.",
    "يلتزم الطرف الثاني بالحفاظ على سرية بيانات المرضى وأسرار العمل أثناء سريان العقد وبعد انتهائه.",
    `يجوز لأي من الطرفين إنهاء العقد بإخطار كتابي للطرف الآخر قبل ${n(c.noticeDays)} يومًا على الأقل، وذلك وفقًا للأحكام المنظمة لإنهاء عقد العمل.`,
    ...(c.extraClauses ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    "فيما لم يرد به نص في هذا العقد تسري أحكام قانون العمل المصري الساري ولائحة المستشفى المعتمدة.",
    "حُرر هذا العقد من نسختين، بيد كل طرف نسخة للعمل بموجبها، ونسخة إلكترونية محفوظة بنظام المستشفى.",
  ];
  return clauses;
}

/** Next contract number "HR-YYYY-####". */
export function nextContractNumber(contracts: Pick<EmploymentContract, "number">[], date: string) {
  const prefix = `HR-${date.slice(0, 4)}-`;
  const max = contracts
    .filter((c) => c.number.startsWith(prefix))
    .reduce((m, c) => Math.max(m, Number(c.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** Contracts that end within `days` (fixed term, signed) — for renewal reminders. */
export function endingSoon(contracts: EmploymentContract[], today: string, days = 30) {
  const limit = new Date(new Date(`${today}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
  return contracts.filter((c) => c.status === "signed" && c.type === "fixed" && c.endDate && c.endDate >= today && c.endDate <= limit);
}
