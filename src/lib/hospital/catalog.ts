/**
 * Receipt desks (العيادات / الطوارئ / المعمل / الأشعة / العناية) and the default price catalog.
 * Desks point at department ids; names always come from the hospital's own department list.
 * The catalog is configuration (editable from the services page), not demo data.
 */
import type { ServiceItem, ServiceKind } from "./model";

export type ReceiptDeskKey = "clinics" | "er" | "lab" | "radiology" | "surgery" | "icu" | "pharmacy" | "other";

export interface ReceiptDesk {
  key: ReceiptDeskKey;
  /** Department the revenue is booked to ("other" lets the user pick any department). */
  deptId: string | null;
  label: string;
  hint: string;
  /** Extra fields shown on the receipt form for this desk. */
  clinic?: boolean;
  referral?: boolean;
  stay?: boolean;
  /** Operating theatre: surgeon + anaesthetist, optional surgical specialty for its operations. */
  surgery?: boolean;
  /** Pharmacy: lines are store items sold to the patient (taken out of stock). */
  pharmacy?: boolean;
}

export const RECEIPT_DESKS: ReceiptDesk[] = [
  { key: "clinics", deptId: "clinics", label: "العيادات", hint: "كشوفات واستشارات وإجراءات العيادة", clinic: true },
  { key: "er", deptId: "er", label: "الطوارئ", hint: "كشف طوارئ، خياطة، جبس، ملاحظة" },
  { key: "lab", deptId: "lab", label: "المعمل", hint: "تحاليل الدم والهرمونات والمزارع", referral: true },
  { key: "radiology", deptId: "radiology", label: "الأشعة", hint: "عادية، سونار، مقطعية، رنين", referral: true },
  { key: "surgery", deptId: "surgery", label: "العمليات", hint: "الجراح والتخدير والغرفة وباقات العمليات", surgery: true },
  { key: "icu", deptId: "icu", label: "العناية المركزة", hint: "إقامة يومية، أجهزة، إجراءات", stay: true },
  { key: "pharmacy", deptId: "pharmacy", label: "الصيدلية", hint: "بيع أدوية ومستلزمات من المخزن", pharmacy: true },
  { key: "other", deptId: null, label: "أقسام أخرى", hint: "أي قسم آخر من الهيكل" },
];

export function deskOf(department: string): ReceiptDesk {
  return RECEIPT_DESKS.find((d) => d.deptId === department) ?? RECEIPT_DESKS[RECEIPT_DESKS.length - 1]!;
}

/** Bump when DEFAULT_SERVICES gains items; older saves receive the missing ones once. */
export const SERVICE_CATALOG_VERSION = 4;

const group = (
  department: string,
  groupName: string,
  rows: [id: string, name: string, price: number, kind?: ServiceKind][],
): ServiceItem[] =>
  rows.map(([id, name, price, kind]) => ({
    id: `cat-${department}-${id}`,
    name,
    price,
    department,
    group: groupName,
    kind: kind ?? "procedure",
  }));

export const DEFAULT_SERVICES: ServiceItem[] = [
  /* ---------- العيادات ---------- */
  ...group("clinics", "الكشوفات", [
    ["spec", "كشف أخصائي", 300, "consult"],
    ["cons", "كشف استشاري", 500, "consult"],
    ["prof", "كشف أستاذ جامعي", 700, "consult"],
    ["revisit", "استشارة (إعادة خلال أسبوعين)", 150, "consult"],
    ["urgent", "كشف مستعجل", 400, "consult"],
  ]),
  ...group("clinics", "إجراءات العيادة", [
    ["ecg", "رسم قلب ECG", 150],
    ["sugar", "قياس سكر عشوائي", 30],
    ["inj", "حقنة عضل / وريد", 30],
    ["neb", "جلسة نيبولايزر", 80],
    ["dress", "غيار جرح بسيط", 100],
    ["stitch-rm", "فك غرز", 100],
    ["ear", "غسيل أذن", 150],
  ]),
  /* ---------- الطوارئ ---------- */
  ...group("er", "كشف الطوارئ", [
    ["exam", "كشف طوارئ", 250, "consult"],
    ["night", "كشف طوارئ ليلي", 350, "consult"],
    ["consult", "استدعاء استشاري للطوارئ", 600, "consult"],
  ]),
  ...group("er", "إجراءات الطوارئ", [
    ["suture-s", "خياطة جرح بسيط", 250],
    ["suture-m", "خياطة جرح متوسط", 450],
    ["suture-l", "خياطة جرح كبير", 700],
    ["dress", "غيار جرح", 120],
    ["cast", "جبيرة جبس", 500],
    ["splint", "جبيرة سبلنت", 350],
    ["lavage", "غسيل معدة", 400],
    ["foley", "تركيب قسطرة بولية", 250],
    ["cannula", "تركيب كانيولا", 80],
    ["iv", "جلسة محاليل وريدية", 150],
    ["inj", "حقنة", 40],
    ["neb", "جلسة نيبولايزر", 100],
    ["ecg", "رسم قلب ECG", 150],
    ["cpr", "إنعاش قلبي رئوي", 1500],
  ]),
  ...group("er", "الملاحظة", [
    ["obs-hr", "ملاحظة (بالساعة)", 100],
    ["obs-bed", "سرير ملاحظة حتى ٦ ساعات", 400],
    ["oxygen", "أكسجين (بالساعة)", 80],
  ]),
  /* ---------- المعمل ---------- */
  ...group("lab", "صورة الدم والتجلط", [
    ["cbc", "صورة دم كاملة CBC", 120],
    ["esr", "سرعة ترسيب ESR", 50],
    ["pt", "زمن البروثرومبين PT/INR", 120],
    ["ptt", "PTT", 120],
    ["abo", "فصيلة الدم", 50],
  ]),
  ...group("lab", "السكر", [
    ["fbs", "سكر صائم", 40],
    ["pp", "سكر فاطر", 40],
    ["rbs", "سكر عشوائي", 40],
    ["hba1c", "سكر تراكمي HbA1c", 200],
  ]),
  ...group("lab", "وظائف الكبد والكلى", [
    ["alt", "ALT", 60],
    ["ast", "AST", 60],
    ["bil", "صفراء Bilirubin", 80],
    ["alb", "زلال Albumin", 70],
    ["creat", "كرياتينين", 60],
    ["urea", "يوريا", 60],
    ["uric", "حمض يوريك", 60],
    ["elec", "أملاح Na / K", 150],
  ]),
  ...group("lab", "الدهون والهرمونات", [
    ["lipid", "دهون كاملة Lipid profile", 250],
    ["tsh", "TSH", 200],
    ["ft4", "FT4", 200],
    ["vitd", "فيتامين د", 450],
    ["bhcg", "اختبار حمل في الدم β-hCG", 250],
  ]),
  ...group("lab", "الفيروسات والمناعة", [
    ["hcv", "فيروس سي HCV Ab", 150],
    ["hbs", "فيروس بي HBsAg", 150],
    ["hiv", "HIV", 200],
    ["crp", "CRP", 120],
    ["aso", "ASO", 100],
  ]),
  ...group("lab", "البول والبراز والمزارع", [
    ["urine", "تحليل بول كامل", 50],
    ["stool", "تحليل براز كامل", 50],
    ["uc", "مزرعة بول", 250],
    ["bc", "مزرعة دم", 400],
  ]),
  /* ---------- الأشعة ---------- */
  ...group("radiology", "أشعة عادية X-Ray", [
    ["chest", "أشعة صدر", 200],
    ["ls", "أشعة فقرات قطنية", 300],
    ["knee", "أشعة ركبة", 200],
    ["hand", "أشعة يد / قدم", 180],
    ["abd", "أشعة بطن", 200],
  ]),
  ...group("radiology", "سونار ودوبلر", [
    ["us-abd", "سونار بطن وحوض", 400],
    ["us-preg", "سونار حمل", 400],
    ["us-thy", "سونار غدة درقية", 400],
    ["doppler", "دوبلر", 700],
  ]),
  ...group("radiology", "أشعة مقطعية CT", [
    ["ct-brain", "مقطعية مخ", 900],
    ["ct-chest", "مقطعية صدر", 1200],
    ["ct-abd", "مقطعية بطن وحوض بالصبغة", 2200],
  ]),
  ...group("radiology", "رنين مغناطيسي MRI", [
    ["mri-brain", "رنين مخ", 1800],
    ["mri-ls", "رنين فقرات قطنية", 1800],
    ["mri-knee", "رنين ركبة", 1800],
  ]),
  ...group("radiology", "أخرى", [
    ["mammo", "ماموجرام", 700],
    ["contrast", "صبغة إضافية", 500],
    ["cd", "نسخة CD", 50],
  ]),
  /* ---------- العناية المركزة ---------- */
  { id: "cat-icu-bed", name: "إقامة سرير عناية مركزة (يوم)", price: 2500, department: "icu", group: "الإقامة اليومية", kind: "other", stay: "room" },
  { id: "cat-icu-sup", name: "إشراف طبي بالعناية (يوم)", price: 800, department: "icu", group: "الإقامة اليومية", kind: "other", stay: "supervision" },
  ...group("icu", "الأجهزة (يوميًا)", [
    ["vent", "جهاز تنفس صناعي (يوم)", 2000],
    ["cpap", "جهاز CPAP / BiPAP (يوم)", 1000],
    ["hfnc", "أكسجين عالي التدفق HFNC (يوم)", 1200],
    ["monitor", "مونيتور (يوم)", 300],
    ["pump", "سرنجة بامب (يوم)", 150],
    ["infusion-pump", "جهاز محاليل إنفيوجن بامب (يوم)", 150],
    ["o2", "أكسجين (يوم)", 400],
    ["suction-dev", "جهاز شفط (يوم)", 100],
    ["air-mattress", "مرتبة هوائية لقرح الفراش (يوم)", 150],
    ["dvt-pump", "جهاز منع الجلطات DVT (يوم)", 200],
    ["warmer", "بطانية تدفئة (يوم)", 150],
  ]),
  ...group("icu", "إجراءات العناية", [
    ["cvl", "تركيب قسطرة وريد مركزي", 2500],
    ["art-line", "تركيب خط شرياني", 1500],
    ["ett", "تركيب أنبوبة حنجرية", 1500],
    ["extub", "نزع الأنبوبة الحنجرية", 300],
    ["trach", "شق حنجري (تراكيوستومي)", 5000],
    ["chest-tube", "تركيب أنبوبة صدر", 2500],
    ["tap", "بزل صدر / بطن", 1000],
    ["lp", "بزل قطني", 1000],
    ["cpr", "إنعاش قلبي رئوي", 1500],
    ["dc", "صدمة كهربائية", 1000],
    ["foley", "تركيب قسطرة بولية", 250],
    ["ryle", "تركيب أنبوبة رايل", 200],
    ["cannula", "تركيب كانيولا", 80],
    ["blood", "نقل كيس دم", 600],
    ["neb", "جلسة نيبولايزر", 100],
    ["suction", "شفط إفرازات (جلسة)", 80],
    ["dressing", "غيار جرح / قرحة فراش", 200],
    ["chest-pt", "جلسة علاج طبيعي تنفسي", 300],
  ]),
  ...group("icu", "متابعة وفحوص بجوار السرير", [
    ["abg", "غازات الدم ABG", 250],
    ["sugar", "متابعة سكر (يوم)", 120],
    ["ecg", "رسم قلب ECG", 150],
    ["echo", "إيكو بجوار السرير", 700],
    ["us", "سونار بجوار السرير", 500],
    ["xray", "أشعة متنقلة بجوار السرير", 400],
    ["cvp", "قياس الضغط الوريدي المركزي CVP (يوم)", 100],
  ]),
  ...group("icu", "المستهلكات", [
    ["cons", "مستهلكات يومية", 500],
    ["cvc-kit", "طقم قسطرة وريد مركزي", 1500],
    ["art-kit", "طقم خط شرياني وترانسديوسر", 1200],
    ["ett-tube", "أنبوبة حنجرية", 150],
    ["trach-tube", "أنبوبة شق حنجري", 900],
    ["vent-circuit", "دائرة جهاز تنفس صناعي", 600],
    ["hme", "فلتر تنفس HME", 120],
    ["closed-suction", "شفاط مغلق", 450],
    ["suction-cath", "قسطرة شفط", 15],
    ["o2-mask", "ماسك أكسجين", 60],
    ["nrb-mask", "ماسك أكسجين بخزان", 150],
    ["venturi", "ماسك فنتوري", 120],
    ["nasal", "قسطرة أكسجين أنفية", 40],
    ["neb-mask", "ماسك نيبولايزر", 60],
    ["cannula-unit", "كانيولا", 35],
    ["syringe", "سرنجة ٣ / ٥ / ١٠ مل", 5],
    ["syringe-50", "سرنجة بامب ٥٠ مل", 30],
    ["pump-line", "وصلة سرنجة بامب", 40],
    ["iv-set", "جهاز محلول", 20],
    ["three-way", "ثري واي", 20],
    ["extension", "وصلة امتداد", 20],
    ["foley-unit", "قسطرة بولية فولي", 60],
    ["urine-bag", "كيس بول", 25],
    ["urometer", "كيس بول بعداد (يوروميتر)", 120],
    ["ryle-unit", "أنبوبة رايل", 30],
    ["feeding-set", "جهاز تغذية أنبوبية", 80],
    ["chest-tube-unit", "أنبوبة صدر", 350],
    ["chest-bottle", "زجاجة درنقة صدر", 250],
    ["electrodes", "إلكترودات مونيتور (طقم)", 40],
    ["spo2", "مجس أكسجين استخدام واحد", 400],
    ["abg-syringe", "سرنجة غازات دم", 60],
    ["glucose-strip", "شريط قياس سكر", 10],
    ["blood-set", "جهاز نقل دم", 40],
    ["sterile-gloves", "جوانتي معقم (زوج)", 25],
    ["gauze", "شاش معقم (علبة)", 40],
    ["tegaderm", "لاصق شفاف للقسطرة", 60],
    ["diaper", "حفاضة كبار", 20],
    ["underpad", "مفرش سرير استخدام واحد", 15],
  ]),
  /* ---------- عناية القلب والحضانات والإقامة ---------- */
  { id: "cat-ccu-bed", name: "إقامة سرير عناية قلب (يوم)", price: 2500, department: "ccu", group: "الإقامة اليومية", kind: "other", stay: "room" },
  { id: "cat-ccu-sup", name: "إشراف طبي بعناية القلب (يوم)", price: 800, department: "ccu", group: "الإقامة اليومية", kind: "other", stay: "supervision" },
  ...group("ccu", "إجراءات عناية القلب", [
    ["echo", "إيكو بجوار السرير", 700],
    ["pacing", "تركيب منظم ضربات مؤقت", 4000],
    ["dc", "صدمة كهربائية", 1000],
    ["enzymes", "إنزيمات قلب", 400],
  ]),
  { id: "cat-nicu-bed", name: "حضانة (يوم)", price: 1500, department: "nicu", group: "الإقامة اليومية", kind: "other", stay: "room" },
  { id: "cat-nicu-sup", name: "إشراف طبي بالحضانات (يوم)", price: 400, department: "nicu", group: "الإقامة اليومية", kind: "other", stay: "supervision" },
  ...group("nicu", "إجراءات الحضانات", [
    ["photo", "جلسة علاج ضوئي (يوم)", 300],
    ["cpap", "جهاز CPAP أطفال (يوم)", 800],
    ["surfactant", "إعطاء سيرفاكتانت", 3500],
    ["exchange", "تغيير دم", 4000],
  ]),
  { id: "cat-inpatient-bed", name: "إقامة غرفة عادية (يوم)", price: 700, department: "inpatient", group: "الإقامة اليومية", kind: "other", stay: "room" },
  { id: "cat-inpatient-sup", name: "إشراف طبي بالقسم الداخلي (يوم)", price: 300, department: "inpatient", group: "الإقامة اليومية", kind: "other", stay: "supervision" },
  ...group("inpatient", "فروق الإقامة والخدمات", [
    ["private", "فرق غرفة خاصة (يوم)", 500],
    ["suite", "فرق جناح (يوم)", 1200],
    ["companion", "مرافق (يوم)", 250],
    ["nursing", "خدمة تمريض خاص (يوم)", 400],
    ["meals", "وجبات إضافية (يوم)", 150],
  ]),
  /* ---------- الأطفال ---------- */
  ...group("pediatrics", "كشف وإجراءات الأطفال", [
    ["exam", "كشف أطفال", 250, "consult"],
    ["neb", "جلسة نيبولايزر أطفال", 80],
    ["vaccine", "إعطاء تطعيم", 100],
    ["growth", "متابعة نمو وتطور", 150],
  ]),
  /* ---------- النساء والتوليد ---------- */
  ...group("obgyn", "كشف ومتابعة", [
    ["exam", "كشف نساء وتوليد", 300, "consult"],
    ["us", "سونار نساء / حمل", 400],
    ["4d", "سونار رباعي الأبعاد", 800],
    ["ctg", "رسم قلب جنين CTG", 200],
    ["iud", "تركيب لولب", 800],
  ]),
  ...group("obgyn", "الولادة والعمليات", [
    ["nvd", "ولادة طبيعية", 6000, "surgery"],
    ["cs", "ولادة قيصرية", 12000, "surgery"],
    ["dnc", "تنظيف رحم (كحت)", 3500, "surgery"],
    ["lap-ovary", "منظار نساء تشخيصي", 9000, "surgery"],
  ]),
  /* ---------- العمليات والتخدير ---------- */
  ...group("surgery", "رسوم غرفة العمليات", [
    ["or-minor", "غرفة عمليات صغرى", 1500],
    ["or-major", "غرفة عمليات كبرى", 4000],
    ["or-hour", "ساعة إضافية بغرفة العمليات", 800],
    ["recovery", "إفاقة", 500],
    ["consumables", "مستهلكات عمليات", 1000],
  ]),
  ...group("surgery", "التخدير", [
    ["local", "تخدير موضعي", 300],
    ["spinal", "تخدير نصفي", 1500],
    ["general", "تخدير كلي", 2000],
  ]),
  ...group("surgery", "أتعاب الجراحين", [
    ["surgeon-minor", "أتعاب جراح — عملية صغرى", 1500, "surgery"],
    ["surgeon-mid", "أتعاب جراح — عملية متوسطة", 3500, "surgery"],
    ["surgeon-major", "أتعاب جراح — عملية كبرى", 7000, "surgery"],
    ["assistant", "أتعاب مساعد جراح", 1000],
    ["anesthetist", "أتعاب طبيب التخدير", 1500],
  ]),
  ...group("surgery", "باقات العمليات (سعر ثابت شامل)", [
    ["pkg-nvd", "باقة ولادة طبيعية شاملة", 8000, "surgery"],
    ["pkg-cs", "باقة ولادة قيصرية شاملة", 16000, "surgery"],
    ["pkg-appendix", "باقة استئصال الزائدة", 12000, "surgery"],
    ["pkg-lapchole", "باقة استئصال المرارة بالمنظار", 20000, "surgery"],
    ["pkg-hernia", "باقة إصلاح فتق بالشبكة", 14000, "surgery"],
    ["pkg-piles", "باقة استئصال البواسير", 9000, "surgery"],
    ["pkg-tonsil", "باقة استئصال اللوز", 8000, "surgery"],
    ["pkg-circ", "باقة ختان", 2000, "surgery"],
    ["pkg-phaco", "باقة مياه بيضاء بالفاكو مع العدسة", 15000, "surgery"],
    ["pkg-orif", "باقة تثبيت كسر بشريحة ومسامير", 28000, "surgery"],
    ["pkg-turp", "باقة استئصال البروستاتا بالمنظار", 22000, "surgery"],
    ["pkg-dnc", "باقة تنظيف رحم (كحت)", 4500, "surgery"],
  ]),
  ...group("gsurgery", "عمليات الجراحة العامة", [
    ["appendix", "استئصال الزائدة", 8000, "surgery"],
    ["lap-chole", "استئصال المرارة بالمنظار", 15000, "surgery"],
    ["hernia", "إصلاح فتق", 10000, "surgery"],
    ["piles", "استئصال بواسير", 6000, "surgery"],
    ["abscess", "فتح خراج", 1500, "surgery"],
    ["lipoma", "استئصال ورم دهني", 2500, "surgery"],
  ]),
  ...group("ortho", "إجراءات وعمليات العظام", [
    ["reduction", "رد خلع", 800],
    ["joint-inj", "حقن مفصل", 500],
    ["orif", "تثبيت كسر بشريحة ومسامير", 20000, "surgery"],
    ["knee-scope", "منظار ركبة", 15000, "surgery"],
    ["k-wire", "تثبيت بأسلاك", 6000, "surgery"],
  ]),
  ...group("urology", "إجراءات وعمليات المسالك", [
    ["cysto", "منظار مثانة", 3000],
    ["eswl", "تفتيت حصوات بالموجات", 8000],
    ["turp", "استئصال البروستاتا بالمنظار", 15000, "surgery"],
    ["circ", "ختان", 1500, "surgery"],
    ["urs", "منظار حالب", 10000, "surgery"],
  ]),
  /* ---------- القلب ---------- */
  ...group("cardio", "فحوصات القلب", [
    ["echo", "إيكو على القلب", 600],
    ["stress", "رسم قلب بالمجهود", 800],
    ["holter", "هولتر ٢٤ ساعة", 900],
    ["abpm", "هولتر ضغط", 700],
  ]),
  ...group("cardio", "القسطرة", [
    ["diag-cath", "قسطرة تشخيصية", 8000, "surgery"],
    ["pci", "دعامة شريان تاجي", 35000, "surgery"],
    ["pacemaker", "تركيب منظم ضربات دائم", 45000, "surgery"],
  ]),
  /* ---------- الرمد ---------- */
  ...group("ophth", "فحوصات الرمد", [
    ["va", "قياس نظر", 100],
    ["iop", "قياس ضغط العين", 100],
    ["fundus", "فحص قاع العين", 150],
    ["oct", "أشعة مقطعية على العين OCT", 600],
    ["field", "مجال بصري", 400],
  ]),
  ...group("ophth", "عمليات الرمد", [
    ["phaco", "مياه بيضاء بالفاكو مع عدسة", 12000, "surgery"],
    ["yag", "ليزر ياج", 2000],
    ["pterygium", "استئصال ظفرة", 4000, "surgery"],
  ]),
  /* ---------- الأنف والأذن ---------- */
  ...group("ent", "فحوصات وإجراءات", [
    ["scope", "منظار أنف وحنجرة", 400],
    ["audio", "رسم سمع", 300],
    ["tympano", "رسم أذن وسطى", 250],
    ["cautery", "كي أنف", 300],
  ]),
  ...group("ent", "عمليات الأنف والأذن", [
    ["tonsil", "استئصال اللوز", 6000, "surgery"],
    ["adenoid", "استئصال اللحمية", 5000, "surgery"],
    ["septum", "تعديل الحاجز الأنفي", 9000, "surgery"],
    ["fess", "منظار جيوب أنفية", 12000, "surgery"],
  ]),
  /* ---------- الأسنان ---------- */
  ...group("dental", "علاج الأسنان", [
    ["exam", "كشف أسنان", 200, "consult"],
    ["xray", "أشعة أسنان صغيرة", 100],
    ["scaling", "تنظيف جير", 500],
    ["amalgam", "حشو عادي", 400],
    ["composite", "حشو تجميلي ضوئي", 600],
    ["rct", "حشو عصب", 1500],
  ]),
  ...group("dental", "الخلع والتركيبات", [
    ["extract", "خلع عادي", 300],
    ["surgical", "خلع جراحي / ضرس عقل", 1000],
    ["crown", "طربوش (Crown)", 2500],
    ["denture", "طقم أسنان متحرك", 6000],
  ]),
  /* ---------- الجلدية ---------- */
  ...group("derma", "إجراءات الجلدية", [
    ["cautery", "كي ثآليل / زوائد", 300],
    ["peel", "جلسة تقشير", 800],
    ["laser", "جلسة ليزر", 1000],
    ["prp", "حقن بلازما", 1200],
  ]),
  /* ---------- الغسيل الكلوي ---------- */
  ...group("dialysis", "الغسيل الكلوي", [
    ["session", "جلسة غسيل كلوي", 1200],
    ["cath", "تركيب قسطرة غسيل مؤقتة", 3000],
    ["epo", "حقنة إريثروبويتين", 250],
    ["iron", "حقنة حديد وريدي", 300],
  ]),
  /* ---------- المناظير ---------- */
  ...group("endoscopy", "المناظير", [
    ["ogd", "منظار معدة تشخيصي", 2500],
    ["colono", "منظار قولون", 3500],
    ["biopsy", "أخذ عينة", 500],
    ["polyp", "استئصال زوائد", 2000],
    ["sedation", "تخدير للمنظار", 800],
    ["ercp", "منظار قنوات مرارية ERCP", 9000],
  ]),
  /* ---------- العلاج الطبيعي ---------- */
  ...group("physio", "جلسات العلاج الطبيعي", [
    ["session", "جلسة علاج طبيعي", 250],
    ["rehab", "جلسة تأهيل", 300],
    ["shockwave", "جلسة موجات تصادمية", 500],
    ["pack10", "باقة ١٠ جلسات", 2200],
  ]),
  /* ---------- بنك الدم ---------- */
  ...group("bloodbank", "بنك الدم", [
    ["crossmatch", "فصيلة وتوافق", 150],
    ["prbc", "كيس دم (كرات حمراء)", 600],
    ["ffp", "كيس بلازما", 500],
    ["platelets", "كيس صفائح", 800],
  ]),
];

/** Room / supervision daily rates a department defines in its price list (0 when missing). */
export function stayRates(services: ServiceItem[], department: string) {
  const find = (k: "room" | "supervision") =>
    services.find((s) => s.department === department && s.stay === k)?.price ?? 0;
  return { roomRate: find("room"), supervisionRate: find("supervision") };
}

/**
 * Price list a receipt shows for the chosen section: only the department's own services
 * (plus the chosen specialty clinic's). Services without a department ("shared") are kept
 * apart so they never flood a department's list; ICU day rates come from the stay fields.
 * No department chosen yet → nothing to show.
 */
export function servicesForDesk(
  services: ServiceItem[],
  opts: { department: string | null; clinicDept?: string | null; stay?: boolean },
): { own: ServiceItem[]; shared: ServiceItem[] } {
  if (!opts.department) return { own: [], shared: [] };
  const usable = services.filter((s) => !(opts.stay && s.stay));
  return {
    own: usable.filter(
      (s) => s.department === opts.department || (!!opts.clinicDept && s.department === opts.clinicDept),
    ),
    shared: usable.filter((s) => !s.department),
  };
}

/** Exact price lookup for a typed line: the section's own list first, then shared services. */
export function findDeskService(name: string, own: ServiceItem[], shared: ServiceItem[]) {
  const n = name.trim();
  return own.find((s) => s.name.trim() === n) ?? shared.find((s) => s.name.trim() === n);
}
