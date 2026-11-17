/**
 * Egyptian national ID (الرقم القومي): 14 digits —
 * C YYMMDD GG SSSS K: C = century (2 → 19xx, 3 → 20xx), birth date, governorate code,
 * sequence (its last digit is odd for males, even for females) and a check digit.
 */
export const GOVERNORATES: Record<string, string> = {
  "01": "القاهرة", "02": "الإسكندرية", "03": "بورسعيد", "04": "السويس", "11": "دمياط", "12": "الدقهلية",
  "13": "الشرقية", "14": "القليوبية", "15": "كفر الشيخ", "16": "الغربية", "17": "المنوفية", "18": "البحيرة",
  "19": "الإسماعيلية", "21": "الجيزة", "22": "بني سويف", "23": "الفيوم", "24": "المنيا", "25": "أسيوط",
  "26": "سوهاج", "27": "قنا", "28": "أسوان", "29": "الأقصر", "31": "البحر الأحمر", "32": "الوادي الجديد",
  "33": "مطروح", "34": "شمال سيناء", "35": "جنوب سيناء", "88": "خارج الجمهورية",
};

export interface NationalIdInfo {
  birthDate: string;
  gender: "male" | "female";
  governorate: string;
}

/** Reads birth date, gender and governorate, or explains why the number is not valid. */
export function parseNationalId(raw: string, today = new Date()): NationalIdInfo | { error: string } {
  const id = raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s/g, "");
  if (!/^\d{14}$/.test(id)) return { error: "الرقم القومي 14 رقمًا." };
  const century = id[0] === "2" ? 1900 : id[0] === "3" ? 2000 : 0;
  if (!century) return { error: "أول رقم في الرقم القومي يجب أن يكون 2 أو 3." };
  const y = century + Number(id.slice(1, 3));
  const m = Number(id.slice(3, 5));
  const d = Number(id.slice(5, 7));
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return { error: "تاريخ الميلاد داخل الرقم القومي غير صحيح." };
  if (date.getTime() > today.getTime()) return { error: "تاريخ الميلاد داخل الرقم القومي في المستقبل." };
  const gov = GOVERNORATES[id.slice(7, 9)];
  if (!gov) return { error: "كود المحافظة داخل الرقم القومي غير معروف." };
  return {
    birthDate: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    gender: Number(id[12]) % 2 === 1 ? "male" : "female",
    governorate: gov,
  };
}

/** Full years between a birth date and a day. */
export function ageOn(birthDate: string, on: string) {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = on.split("-").map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
