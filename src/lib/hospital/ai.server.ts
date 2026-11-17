/**
 * Server-only: reads a document (photo or PDF) with Lovable AI and returns JSON that follows
 * a strict schema. Used by the supplier-invoice and bank-statement readers.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, jsonSchema, NoObjectGeneratedError, Output, streamText, type JSONSchema7 } from "ai";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MODEL = "openai/gpt-6-astra";
const RUN_ID = "X-Lovable-AIG-Run-ID";

export class AiReadError extends Error {}

function runIdFetch() {
  let runId: string | undefined;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (runId && !headers.has(RUN_ID)) headers.set(RUN_ID, runId);
    const res = await fetch(input, { ...init, headers });
    runId ??= res.headers.get(RUN_ID)?.trim() || undefined;
    return res;
  };
}

export interface DocFile {
  fileName: string;
  mimeType: string;
  base64: string;
}

export async function readDocument<T>(file: DocFile, instructions: string, schema: JSONSchema7, signal?: AbortSignal): Promise<T> {
  const apiKey = process.env['LOVABLE_API_KEY'];
  if (!apiKey) throw new AiReadError("خدمة القراءة الذكية غير مفعّلة حاليًا.");
  const provider = createOpenAI({
    baseURL: GATEWAY,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch(),
  });
  const part = { type: "file" as const, filename: file.fileName, data: file.base64, mediaType: file.mimeType };
  const result = streamText({
    model: provider.responses(MODEL),
    instructions,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `المستند المرفق: ${file.fileName}` }, part],
      },
    ],
    output: Output.object({ schema: jsonSchema<T>(schema) }),
    ...(signal ? { abortSignal: signal } : {}),
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  });
  try {
    return (await result.output) as T;
  } catch (e) {
    console.error("AI document read failed", e);
    if (NoObjectGeneratedError.isInstance(e))
      throw new AiReadError("لم نتمكن من قراءة المستند بوضوح — جرّب صورة أوضح أو ملف PDF.");
    const status = APICallError.isInstance(e) ? e.statusCode : undefined;
    if (status === 402) throw new AiReadError("انتهى رصيد خدمة الذكاء الاصطناعي لهذا الشهر — يحتاج صاحب الحساب لإضافة رصيد.");
    if (status === 429) throw new AiReadError("ضغط كبير على خدمة القراءة الآن — حاول بعد دقيقة.");
    if (status === 403) throw new AiReadError("خدمة القراءة الذكية غير متاحة لهذا الحساب حاليًا.");
    if (status === 400) throw new AiReadError("صيغة الملف غير مدعومة أو حجمه كبير — استخدم صورة JPG/PNG أو PDF أصغر.");
    throw new AiReadError("تعذّرت قراءة المستند الآن، حاول مرة أخرى.");
  }
}
