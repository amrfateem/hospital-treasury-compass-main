import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { can, type Section } from "./permissions";
import { loadMe } from "./sync.functions";

const MAX_BYTES = 12 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

interface FileInput {
  fileName: string;
  mimeType: string;
  base64: string;
}
function validateFile(input: unknown): FileInput {
  const f = input as Partial<FileInput> | null;
  if (!f || typeof f.base64 !== "string" || typeof f.mimeType !== "string" || typeof f.fileName !== "string")
    throw new Error("Bad file");
  if (!TYPES.includes(f.mimeType)) throw new Error("Unsupported type");
  if (f.base64.length * 0.75 > MAX_BYTES) throw new Error("Too large");
  return { fileName: f.fileName.slice(0, 120), mimeType: f.mimeType, base64: f.base64 };
}

async function guard(supabase: Parameters<typeof loadMe>[0], userId: string, section: Section) {
  try {
    const me = await loadMe(supabase, userId);
    return can(me, section, "add") ? null : "ليست لديك صلاحية لهذه العملية.";
  } catch {
    return "ليست لديك صلاحية دخول النظام.";
  }
}

export interface ReadInvoice {
  supplierName: string;
  supplierTaxId: string | null;
  supplierInvoiceNo: string | null;
  date: string | null;
  subtotal: number | null;
  vat: number | null;
  total: number | null;
  vatApplicable: boolean;
  whtType: "none" | "supplies" | "services" | "professional";
  categoryId: string | null;
  description: string;
  lines: { description: string; qty: number; unitPrice: number; total: number }[];
  confidence: "high" | "medium" | "low";
  notes: string | null;
}

const nullable = (type: "string" | "number") => ({ type: [type, "null"] as ["string" | "number", "null"] });

export const readSupplierInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { file: FileInput; categories: { id: string; name: string }[] }) => ({
    file: validateFile(input?.file),
    categories: Array.isArray(input?.categories)
      ? input.categories.slice(0, 80).map((c) => ({ id: String(c.id).slice(0, 40), name: String(c.name).slice(0, 80) }))
      : [],
  }))
  .handler(async ({ data, context }) => {
    const denied = await guard(context.supabase, context.userId, "suppliers");
    if (denied) return { ok: false as const, error: denied };
    const { readDocument, AiReadError } = await import("./ai.server");
    const cats = data.categories.map((c) => `${c.id} = ${c.name}`).join("\n");
    try {
      const result = await readDocument<ReadInvoice>(
        data.file,
        `أنت محاسب في مستشفى مصري. اقرأ فاتورة المورد المرفقة (صورة أو PDF، عربي أو إنجليزي) واستخرج بياناتها بدقة كما هي مكتوبة.
- supplierName: اسم المورد / البائع (ليس المستشفى).
- supplierTaxId: رقم التسجيل الضريبي للمورد (أرقام فقط) إن وُجد.
- supplierInvoiceNo: رقم الفاتورة.
- date: تاريخ الفاتورة بصيغة YYYY-MM-DD.
- subtotal: الإجمالي قبل ضريبة القيمة المضافة. vat: قيمة ضريبة القيمة المضافة. total: الإجمالي بعد الضريبة.
- vatApplicable: true إذا كانت الفاتورة عليها ضريبة قيمة مضافة.
- whtType: نوع الخصم تحت حساب الضريبة المناسب: supplies للتوريدات والأصناف، services للخدمات والمقاولات والصيانة، professional للأتعاب المهنية، none إذا لم ينطبق.
- categoryId: اختر أنسب بند مصروف من القائمة التالية (اكتب الكود فقط) أو null:
${cats}
- description: وصف مختصر بالعربية لما تم شراؤه (سطر واحد).
- lines: بنود الفاتورة (حتى ٤٠ بندًا).
- confidence: مدى وضوح المستند. notes: أي ملاحظة مهمة بالعربية (أرقام غير واضحة، اختلاف في الإجماليات) أو null.
لا تخترع أرقامًا غير موجودة؛ استخدم null.`,
        {
          type: "object",
          additionalProperties: false,
          required: ["supplierName", "supplierTaxId", "supplierInvoiceNo", "date", "subtotal", "vat", "total", "vatApplicable", "whtType", "categoryId", "description", "lines", "confidence", "notes"],
          properties: {
            supplierName: { type: "string" },
            supplierTaxId: nullable("string"),
            supplierInvoiceNo: nullable("string"),
            date: nullable("string"),
            subtotal: nullable("number"),
            vat: nullable("number"),
            total: nullable("number"),
            vatApplicable: { type: "boolean" },
            whtType: { type: "string", enum: ["none", "supplies", "services", "professional"] },
            categoryId: nullable("string"),
            description: { type: "string" },
            lines: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["description", "qty", "unitPrice", "total"],
                properties: {
                  description: { type: "string" },
                  qty: { type: "number" },
                  unitPrice: { type: "number" },
                  total: { type: "number" },
                },
              },
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            notes: nullable("string"),
          },
        },
      );
      return { ok: true as const, result };
    } catch (e) {
      if (e instanceof AiReadError) return { ok: false as const, error: e.message };
      console.error(e);
      return { ok: false as const, error: "تعذّرت قراءة الفاتورة الآن، حاول مرة أخرى." };
    }
  });

export interface ReadStatement {
  bankName: string | null;
  accountNo: string | null;
  from: string | null;
  to: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  lines: { date: string; description: string; reference: string | null; debit: number | null; credit: number | null; balance: number | null }[];
}

export const readBankStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { file: FileInput }) => ({ file: validateFile(input?.file) }))
  .handler(async ({ data, context }) => {
    const denied = await guard(context.supabase, context.userId, "bank");
    if (denied) return { ok: false as const, error: denied };
    const { readDocument, AiReadError } = await import("./ai.server");
    try {
      const result = await readDocument<ReadStatement>(
        data.file,
        `أنت محاسب. اقرأ كشف الحساب البنكي المرفق واستخرج كل الحركات بالترتيب كما هي.
- التواريخ بصيغة YYYY-MM-DD.
- debit = المسحوب / المدين (أرقام موجبة)، credit = المودع / الدائن (أرقام موجبة)، واحد منهما فقط لكل حركة.
- balance = الرصيد بعد الحركة إن وُجد.
- openingBalance / closingBalance = الرصيد الافتتاحي والختامي للكشف.
- reference = رقم الشيك أو المرجع إن وُجد.
لا تخترع حركات؛ استخدم null للقيم غير الموجودة.`,
        {
          type: "object",
          additionalProperties: false,
          required: ["bankName", "accountNo", "from", "to", "openingBalance", "closingBalance", "lines"],
          properties: {
            bankName: nullable("string"),
            accountNo: nullable("string"),
            from: nullable("string"),
            to: nullable("string"),
            openingBalance: nullable("number"),
            closingBalance: nullable("number"),
            lines: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["date", "description", "reference", "debit", "credit", "balance"],
                properties: {
                  date: { type: "string" },
                  description: { type: "string" },
                  reference: nullable("string"),
                  debit: nullable("number"),
                  credit: nullable("number"),
                  balance: nullable("number"),
                },
              },
            },
          },
        },
      );
      return { ok: true as const, result };
    } catch (e) {
      if (e instanceof AiReadError) return { ok: false as const, error: e.message };
      console.error(e);
      return { ok: false as const, error: "تعذّرت قراءة الكشف الآن، حاول مرة أخرى." };
    }
  });
