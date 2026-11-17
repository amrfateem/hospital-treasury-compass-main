/** Browser helpers for sending an uploaded document to the AI reader. */
export const AI_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const AI_MAX_MB = 10;

export async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Arabic reason when a file can't be read by the AI reader, or null when it's fine. */
export function aiFileProblem(file: File): string | null {
  if (!AI_FILE_TYPES.includes(file.type)) return "الملف يجب أن يكون PDF أو صورة (JPG / PNG / WEBP).";
  if (file.size > AI_MAX_MB * 1024 * 1024) return `حجم الملف أكبر من ${AI_MAX_MB} ميجابايت.`;
  if (!file.size) return "الملف فارغ.";
  return null;
}
