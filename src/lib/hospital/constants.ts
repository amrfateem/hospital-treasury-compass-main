export const HOSPITAL = {
  name: "مستشفى الرحمة التخصصي",
  owner: "صاحبها ومديرها دكتور سامي البربري",
} as const;

/** Sections of the hospital organisational chart. */
export type DeptGroup = "critical" | "medical" | "surgical" | "support" | "admin" | "services";
export const DEPT_GROUPS: { id: DeptGroup; name: string }[] = [
  { id: "critical", name: "الطوارئ والعنايات المركزة" },
  { id: "medical", name: "الأقسام الباطنية والتخصصية" },
  { id: "surgical", name: "الأقسام الجراحية والعمليات" },
  { id: "support", name: "الخدمات الطبية المساعدة" },
  { id: "admin", name: "الإدارات الإدارية والمالية" },
  { id: "services", name: "الخدمات المعاونة والفنية" },
];
/** Groups whose departments run specialty clinics (receipt "clinics" desk). */
export const CLINICAL_GROUPS: DeptGroup[] = ["medical", "surgical"];

/** Fixed colour swatches (literal class names so Tailwind generates them). */
export const DEPT_COLORS = [
  { key: "c1", dot: "bg-dept-c1", text: "text-dept-c1", soft: "bg-dept-c1/10" },
  { key: "c2", dot: "bg-dept-c2", text: "text-dept-c2", soft: "bg-dept-c2/10" },
  { key: "c3", dot: "bg-dept-c3", text: "text-dept-c3", soft: "bg-dept-c3/10" },
  { key: "c4", dot: "bg-dept-c4", text: "text-dept-c4", soft: "bg-dept-c4/10" },
  { key: "c5", dot: "bg-dept-c5", text: "text-dept-c5", soft: "bg-dept-c5/10" },
  { key: "c6", dot: "bg-dept-c6", text: "text-dept-c6", soft: "bg-dept-c6/10" },
  { key: "c7", dot: "bg-dept-c7", text: "text-dept-c7", soft: "bg-dept-c7/10" },
  { key: "c8", dot: "bg-dept-c8", text: "text-dept-c8", soft: "bg-dept-c8/10" },
  { key: "c9", dot: "bg-dept-c9", text: "text-dept-c9", soft: "bg-dept-c9/10" },
  { key: "c10", dot: "bg-dept-c10", text: "text-dept-c10", soft: "bg-dept-c10/10" },
  { key: "gray", dot: "bg-dept-general", text: "text-dept-general", soft: "bg-dept-general/10" },
] as const;
export type DeptColor = (typeof DEPT_COLORS)[number]["key"];

export interface Department {
  id: string;
  name: string;
  code: string;
  group: DeptGroup;
  color: DeptColor;
  active: boolean;
  /** System departments (e.g. general administration) cannot be deleted. */
  system?: boolean | undefined;
}

export type DepartmentId = string;
/** Treasury entries may also go to the general administration ("general"). */
export type LedgerDepartment = string;
export const GENERAL_DEPT_ID = "general";

const D = (
  id: string,
  name: string,
  code: string,
  group: DeptGroup,
  i: number,
  system = false,
): Department => ({
  id,
  name,
  code,
  group,
  color: system ? "gray" : DEPT_COLORS[i % 10]!.key,
  active: true,
  ...(system ? { system } : {}),
});

/** Full organisational structure of a general hospital (editable from settings). */
export const DEFAULT_DEPARTMENTS: Department[] = [
  // الطوارئ والعنايات المركزة
  D("er", "الاستقبال والطوارئ", "ER", "critical", 2),
  D("icu", "العناية المركزة", "ICU", "critical", 3),
  D("ccu", "عناية القلب (CCU)", "CCU", "critical", 7),
  D("nicu", "الحضانات وعناية الأطفال", "NICU", "critical", 8),
  // الأقسام الباطنية والتخصصية
  D("clinics", "العيادات الخارجية", "OPD", "medical", 4),
  D("internal", "الباطنة العامة", "IM", "medical", 0),
  D("cardio", "القلب والقسطرة", "CAR", "medical", 2),
  D("chest", "الصدر والجهاز التنفسي", "CHS", "medical", 5),
  D("gastro", "الجهاز الهضمي والكبد", "GIT", "medical", 9),
  D("nephro", "الكلى", "NEP", "medical", 6),
  D("dialysis", "الغسيل الكلوي", "HD", "medical", 1),
  D("neuro", "المخ والأعصاب", "NEU", "medical", 7),
  D("pediatrics", "الأطفال", "PED", "medical", 1),
  D("derma", "الجلدية", "DER", "medical", 8),
  D("oncology", "الأورام", "ONC", "medical", 3),
  D("psych", "الطب النفسي", "PSY", "medical", 4),
  D("endoscopy", "المناظير", "END", "medical", 3),
  D("physio", "العلاج الطبيعي والتأهيل", "PT", "medical", 4),
  D("inpatient", "الأقسام الداخلية (الإقامة)", "INP", "medical", 0),
  // الأقسام الجراحية والعمليات
  D("surgery", "العمليات", "OPR", "surgical", 2),
  D("anesthesia", "التخدير", "ANE", "surgical", 6),
  D("gsurgery", "الجراحة العامة", "GS", "surgical", 5),
  D("ortho", "العظام", "ORT", "surgical", 0),
  D("urology", "المسالك البولية", "URO", "surgical", 4),
  D("neurosurgery", "جراحة المخ والأعصاب", "NSG", "surgical", 7),
  D("plastic-burns", "جراحة التجميل والحروق", "PLS", "surgical", 8),
  D("vascular", "جراحة الأوعية الدموية", "VAS", "surgical", 1),
  D("cardiothoracic", "جراحة القلب والصدر", "CTS", "surgical", 3),
  D("obgyn", "النساء والتوليد", "OBG", "surgical", 9),
  D("ent", "الأنف والأذن والحنجرة", "ENT", "surgical", 5),
  D("ophth", "الرمد", "OPH", "surgical", 6),
  D("dental", "الأسنان", "DEN", "surgical", 9),
  // الخدمات الطبية المساعدة
  D("lab", "المعمل (التحاليل الطبية)", "LAB", "support", 0),
  D("bloodbank", "بنك الدم", "BB", "support", 2),
  D("radiology", "الأشعة", "RAD", "support", 1),
  D("pharmacy", "الصيدلية", "PHA", "support", 4),
  D("nursing", "التمريض", "NUR", "support", 6),
  D("cssd", "التعقيم المركزي", "CSSD", "support", 7),
  D("nutrition", "التغذية العلاجية", "NUT", "support", 3),
  D("infection", "مكافحة العدوى", "IC", "support", 5),
  // الإدارات الإدارية والمالية
  D("general", "الإدارة العامة", "GEN", "admin", 0, true),
  D("medical-admin", "الإدارة الطبية", "MED", "admin", 9),
  D("nursing-admin", "إدارة التمريض", "NSA", "admin", 6),
  D("finance", "الشؤون المالية والحسابات", "FIN", "admin", 8),
  D("treasury", "الخزينة", "TRS", "admin", 3),
  D("audit", "المراجعة الداخلية", "AUD", "admin", 2),
  D("hr", "الموارد البشرية وشؤون العاملين", "HR", "admin", 1),
  D("training", "التدريب والتعليم الطبي", "TRN", "admin", 5),
  D("purchasing", "المشتريات", "PUR", "admin", 5),
  D("stores", "المخازن", "STO", "admin", 6),
  D("admission", "شؤون المرضى والدخول", "ADM", "admin", 7),
  D("records", "السجلات الطبية والإحصاء", "MR", "admin", 2),
  D("insurance", "التأمين الطبي والتعاقدات", "INS", "admin", 4),
  D("quality", "الجودة وسلامة المرضى", "QA", "admin", 0),
  D("it", "تكنولوجيا المعلومات", "IT", "admin", 9),
  D("pr", "العلاقات العامة وخدمة العملاء", "PR", "admin", 8),
  D("legal", "الشؤون القانونية", "LEG", "admin", 3),
  // الخدمات المعاونة والفنية
  D("maintenance", "الصيانة والهندسة الطبية", "MNT", "services", 5),
  D("security", "الأمن", "SEC", "services", 6),
  D("housekeeping", "النظافة والإشراف الداخلي", "HK", "services", 7),
  D("laundry", "المغسلة", "LND", "services", 1),
  D("kitchen", "المطبخ", "KIT", "services", 2),
  D("transport", "الحركة والإسعاف", "AMB", "services", 4),
];

const UNKNOWN: Department = {
  id: "?",
  name: "قسم غير معروف",
  code: "—",
  group: "admin",
  color: "gray",
  active: false,
};

export function deptColor(color: string) {
  return DEPT_COLORS.find((c) => c.key === color) ?? DEPT_COLORS[DEPT_COLORS.length - 1]!;
}

/** Look up a department (with its colour classes) in the hospital's own list. */
export function findDepartment(list: Department[], id: string) {
  const d =
    list.find((x) => x.id === id) ??
    (id === GENERAL_DEPT_ID ? DEFAULT_DEPARTMENTS.find((x) => x.id === id)! : { ...UNKNOWN, id });
  return { ...d, ...deptColor(d.color) };
}

/** Departments sorted by organisational group, keeping each group's own order. */
export function sortDepartments(list: Department[]) {
  const order = DEPT_GROUPS.map((g) => g.id);
  return list
    .map((d, i) => ({ d, i }))
    .sort((a, b) => order.indexOf(a.d.group) - order.indexOf(b.d.group) || a.i - b.i)
    .map((x) => x.d);
}
