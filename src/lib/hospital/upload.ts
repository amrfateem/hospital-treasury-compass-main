/** Browser helpers for private files (ID cards, signatures, signed contracts, attachments). */
import { confirmFileUpload, createFileUpload } from "./files.functions";

export const ACCEPTED_FILES = "image/jpeg,image/png,image/webp,application/pdf";
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
type Mime = (typeof ALLOWED)[number];
export const MAX_FILE_MB = 10;

export async function uploadPrivateFile(a: {
  ownerKind: "employee" | "patient";
  ownerId: string;
  kind: string;
  refId?: string | null;
  file: Blob;
  fileName: string;
  replace?: boolean;
}) {
  const mimeType = a.file.type as Mime;
  if (!ALLOWED.includes(mimeType)) throw new Error("الملف يجب أن يكون صورة (JPG / PNG / WEBP) أو PDF.");
  if (a.file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`أقصى حجم للملف ${MAX_FILE_MB} ميجا.`);
  const { path, token } = await createFileUpload({
    data: { ownerKind: a.ownerKind, ownerId: a.ownerId, mimeType, size: a.file.size },
  });
  const res = await fetch(`/api/upload?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": mimeType },
    body: a.file,
  });
  if (!res.ok) throw new Error("تعذّر رفع الملف، حاول مرة أخرى.");
  return confirmFileUpload({
    data: {
      ownerKind: a.ownerKind,
      ownerId: a.ownerId,
      kind: a.kind,
      refId: a.refId ?? null,
      path,
      fileName: a.fileName.slice(0, 160),
      mimeType,
      size: a.file.size,
      replace: a.replace ?? false,
    },
  });
}

/** Turns an image URL into a data URL so PDF capture never hits cross-origin limits. */
export async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const errorText = (e: unknown, fallback = "حدث خطأ، حاول مرة أخرى.") =>
  e instanceof Error && /[\u0600-\u06FF]/.test(e.message) ? e.message : fallback;
