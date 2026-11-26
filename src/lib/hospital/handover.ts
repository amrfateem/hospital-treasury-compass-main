/**
 * Patient-file handover register (سركي تسليم ملفات المرضى) between hospital departments.
 * A handover is a batch of files sent by one department and confirmed file by file by the
 * receiving department; the printed سركي carries both signatures. Pure.
 */

export type HandoverStatus = "sent" | "received" | "partial" | "rejected";
export const HANDOVER_STATUS: Record<HandoverStatus, string> = {
  sent: "في انتظار الاستلام",
  received: "تم الاستلام كاملًا",
  partial: "استلام جزئي",
  rejected: "مرفوض / مُعاد",
};

export const FILE_TYPES = [
  "ملف دخول (إقامة)",
  "ملف خروج",
  "ملف طوارئ",
  "ملف عناية مركزة",
  "ملف عمليات",
  "ملف ولادة",
  "ملف عيادة خارجية",
  "نتائج تحاليل",
  "أفلام وتقارير أشعة",
  "تقرير طبي",
  "ملف غسيل كلوي",
  "أخرى",
];

export const HANDOVER_PURPOSES = [
  "أرشفة بالسجلات الطبية",
  "تحويل المريض لقسم آخر",
  "مراجعة طبية",
  "مراجعة مالية / تأمين",
  "مراجعة الجودة",
  "إعادة الملف للقسم",
];

export interface HandoverItem {
  patientName: string;
  mrn?: string | undefined;
  fileType: string;
  pages?: number | undefined;
  notes?: string | undefined;
  /** Set by the receiving department. */
  received?: boolean | undefined;
}

export interface FileHandover {
  id: string;
  number: string;
  date: string;
  /** "HH:MM" when the files left the department. */
  time: string;
  fromDept: string;
  toDept: string;
  purpose: string;
  items: HandoverItem[];
  deliveredBy: string;
  deliveredById?: string | undefined;
  status: HandoverStatus;
  receivedBy?: string | undefined;
  receivedById?: string | undefined;
  receivedAt?: number | undefined;
  receiveNote?: string | undefined;
  notes?: string | undefined;
  createdAt: number;
}

/** Status after the receiver ticks the files that actually arrived. */
export function receiveStatus(items: HandoverItem[], reject: boolean): HandoverStatus {
  if (reject) return "rejected";
  const got = items.filter((i) => i.received).length;
  if (got === items.length) return "received";
  return got === 0 ? "rejected" : "partial";
}

/** Totals for a list of handovers (files sent, received, missing, waiting batches). */
export function handoverTotals(list: FileHandover[]) {
  let files = 0;
  let received = 0;
  let missing = 0;
  let waiting = 0;
  for (const h of list) {
    files += h.items.length;
    if (h.status === "sent") waiting++;
    else {
      const got = h.items.filter((i) => i.received).length;
      received += got;
      missing += h.items.length - got;
    }
  }
  return { batches: list.length, files, received, missing, waiting };
}

/** Files of one patient across all handovers (where the file is now). */
export function patientTrail(list: FileHandover[], query: string) {
  const q = query.trim();
  if (!q) return [];
  return list
    .flatMap((h) => h.items.map((it) => ({ h, it })))
    .filter(({ it }) => it.patientName.includes(q) || (!!it.mrn && it.mrn === q))
    .sort((a, b) => b.h.date.localeCompare(a.h.date) || b.h.createdAt - a.h.createdAt);
}
