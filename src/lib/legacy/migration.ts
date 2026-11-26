/** Confirmed positional mappings for this backup. Unknown meanings remain review rows. */
import type { Department } from "@/lib/hospital/constants";
import type { Branch, HospitalDB, ListItem, PatientInvoice, ServiceItem, StockItem, Transaction } from "@/lib/hospital/model";
import { MAIN_BOX_ID } from "@/lib/hospital/model";
import { parseDumpLines } from "./sql-dump";

export type LegacyTables = Map<string, string[][]>;
export interface LegacyDocument {
  departments: Department[];
  services: ServiceItem[];
  expenseCategories: ListItem[];
  paymentMethods: ListItem[];
  stockCategories: ListItem[];
  stockItems: StockItem[];
  branches: Branch[];
  patientInvoices: PatientInvoice[];
  transactions: Transaction[];
}
export interface SourceDisposition { target: string; targetId: string; reason: string }
export interface LegacyPlan {
  tables: LegacyTables;
  document: LegacyDocument;
  disposition: Map<string, SourceDisposition>;
  clinicDepartments: Map<string, string>;
  serviceNames: Map<string, string>;
}
export const sourceKey = (table: string, id: string) => `${table}:${id}`;
export const legacyId = (table: string, id: string) => `legacy-${table}-${id}`;
export const legacyPatientId = (id: string | undefined) => id && id !== "0" ? `legacy-${id}` : null;
export const sourceDate = (s: string | undefined): string | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(s)) return null;
  const day = s.slice(0, 10);
  const ms = Date.parse(`${day}T00:00:00Z`);
  const timestamp = Date.parse(s.replace(" ", "T") + (s.length === 10 ? "T00:00:00Z" : "Z"));
  return Number.isFinite(ms) && Number.isFinite(timestamp) && new Date(ms).toISOString().slice(0, 10) === day ? s : null;
};
export const sourceMoney = (s: string | undefined): number | null => {
  if (!s?.trim() || !/^-?\d+(?:\.\d+)?$/.test(s.trim())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
export const sourceTime = (s: string | undefined) => {
  const date = sourceDate(s);
  // Historical local wall-clock time; never replace it with the import time.
  return date ? Date.parse(date.replace(" ", "T") + (date.length === 10 ? "T00:00:00Z" : "Z")) : 0;
};
export const listIds = (s: string | undefined): string[] => (s ?? "").match(/\d+/g) ?? [];

export function parseLegacyBackup(text: string): LegacyTables {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let inserts = 0;
  for (const line of lines) {
    if (!/^\s*INSERT\s+INTO\b/i.test(line)) continue;
    inserts++;
    const values = line.slice(line.search(/\bVALUES\b/i));
    const unquoted = values.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
    if ((unquoted.match(/\(/g) ?? []).length !== 1 || (unquoted.match(/\)/g) ?? []).length !== 1)
      throw new Error("النسخة تحتوي على صيغة سجلات غير مدعومة؛ لم يُحذف أو يُتجاهل أي سجل.");
  }
  const tables = parseDumpLines(lines);
  const parsed = [...tables.values()].reduce((n, rows) => n + rows.length, 0);
  if (!tables.get("patients")?.length || parsed !== inserts)
    throw new Error("صيغة النسخة غير مكتملة أو تحتوي على سجلات لم تُقرأ؛ لم يتم نقل أي بيانات.");
  for (const [name, rows] of tables) {
    const ids = new Set<string>();
    for (const row of rows) {
      const id = row[0];
      if (!id || ids.has(id)) throw new Error(`معرّفات مكررة أو ناقصة في ${name}؛ لم يتم النقل.`);
      ids.add(id);
    }
  }
  return tables;
}

export function buildLegacyPlan(tables: LegacyTables): LegacyPlan {
  const rows = (table: string) => tables.get(table) ?? [];
  const disposition = new Map<string, SourceDisposition>();
  const put = (table: string, row: string[], target: string, targetId: string, reason = "") => {
    const id = row[0];
    if (id) disposition.set(sourceKey(table, id), { target, targetId, reason });
  };
  const clinicDepartments = new Map<string, string>();
  const serviceNames = new Map<string, string>();
  const document: LegacyDocument = { departments: [], services: [], expenseCategories: [], paymentMethods: [], stockCategories: [], stockItems: [], branches: [], patientInvoices: [], transactions: [] };
  document.paymentMethods.push({ id: "legacy-unknown", name: "طريقة الدفع غير محددة بالمصدر" });
  const names = (table: string) => new Map(rows(table).map((r) => [r[0] ?? "", r[1]?.trim() ?? ""]));
  const patients = names("patients");
  const phones = new Map(rows("patients").map((r) => [r[0] ?? "", r[9] ?? ""]));
  const clinicNames = names("clinics");
  for (const r of rows("clinics")) {
    const id = r[0]; const name = r[1]?.trim();
    if (!id || !name) continue;
    const normalized = name.replace(/[أإآ]/g, "ا").replace(/ه\b/g, "ة");
    const department = /طوارئ/.test(normalized) ? "er" : /جراح/.test(normalized) ? "surgery" : /اسنان/.test(normalized) ? "dental" : /قلب/.test(normalized) ? "cardio" : /معمل/.test(normalized) ? "lab" : /سونار|اشعة/.test(normalized) ? "radiology" : /مخ.*اعصاب/.test(normalized) ? "neuro" : legacyId("clinic", id);
    clinicDepartments.set(id, department);
    document.departments.push({ id: department, name, code: `OLD-${id}`, group: department === "lab" || department === "radiology" ? "support" : department === "surgery" || department === "dental" ? "surgical" : "medical", color: "c1", active: true });
    put("clinics", r, "departments", department);
  }
  const departmentOf = (id: string | undefined) => clinicDepartments.get(id ?? "") ?? "general";
  for (const r of rows("pay_categories")) {
    const id = r[0]; const name = r[1]?.trim();
    if (!id || !name) continue;
    document.expenseCategories.push({ id: legacyId("category", id), name });
    put("pay_categories", r, "expenseCategories", legacyId("category", id));
  }
  for (const r of rows("payments")) {
    const id = r[0]; const name = r[1]?.trim();
    if (!id || !name) continue;
    document.paymentMethods.push({ id: legacyId("payment", id), name });
    put("payments", r, "paymentMethods", legacyId("payment", id));
  }
  const serviceConfigs = [
    { table: "prices", price: 2, department: "", kind: "procedure" as const },
    { table: "analysis", price: 4, department: "lab", kind: "procedure" as const },
    { table: "rays", price: 3, department: "radiology", kind: "procedure" as const },
    { table: "prices_operations", price: 2, department: "surgery", kind: "surgery" as const },
    { table: "setting_rooms_types", price: 2, department: "inpatient", kind: "other" as const },
  ];
  for (const config of serviceConfigs) for (const r of rows(config.table)) {
    const id = r[0]; const name = r[1]?.trim(); const price = sourceMoney(r[config.price]);
    if (!id || !name || price === null || price < 0) continue;
    const serviceId = legacyId(config.table, id);
    const department = config.department || (r[6] && r[6] !== "0" ? departmentOf(r[6]) : "");
    document.services.push({ id: serviceId, name, price, ...(department ? { department } : {}), kind: /كشف|اعادة|إعادة/.test(name) ? "consult" : config.kind, group: config.table === "prices" ? clinicNames.get(r[6] ?? "") || "السيستم القديم" : "السيستم القديم", ...(config.table === "setting_rooms_types" ? { stay: "room" as const } : {}) });
    serviceNames.set(sourceKey(config.table, id), name);
    put(config.table, r, "services", serviceId);
  }
  for (const r of rows("category")) {
    const id = r[0]; const name = r[1]?.trim();
    if (!id || !name) continue;
    document.stockCategories.push({ id: legacyId("stock-category", id), name });
    put("category", r, "stockCategories", legacyId("stock-category", id));
  }
  const units = names("units");
  const productsByName = new Map<string, string>();
  for (const r of rows("products")) {
    const id = r[0]; const name = r[1]?.trim();
    if (!id || !name) continue;
    const itemId = legacyId("product", id);
    const price = sourceMoney(r[11]);
    document.stockItems.push({ id: itemId, name, unit: units.get(r[7] ?? "") || "عدد", category: legacyId("stock-category", r[4] ?? "1"), department: "pharmacy", reorderLevel: 0, active: true, ...(price !== null && price >= 0 ? { salePrice: price } : {}) });
    productsByName.set(name, itemId);
    put("products", r, "stockItems", itemId, "كميات المخزون وتفاصيل الوحدات غير المؤكدة لم تُرحّل.");
  }
  for (const r of rows("drugs")) {
    const existing = productsByName.get(r[1]?.trim() ?? "");
    if (existing) put("drugs", r, "stockItems", existing, "ربط بقائمة الأصناف المطابقة؛ التفاصيل الإضافية محفوظة.");
  }
  for (const r of rows("branchs")) {
    const id = r[0]; const name = r[1]?.trim();
    if (!id || !name) continue;
    const targetId = legacyId("branch", id);
    document.branches.push({ id: targetId, name, address: r[2] ?? "", phones: r[3] ?? "" });
    put("branchs", r, "branches", targetId);
  }
  // revenues is the sole cash-in authority. Service rows/sales/pays_out never post a second copy.
  const incomeLinks = new Map<string, string>();
  for (const r of rows("revenues")) {
    const id = r[0]; const date = sourceDate(r[9]); const amount = sourceMoney(r[5]);
    if (!id || !date || amount === null) continue;
    const targetId = legacyId("revenue", id);
    const department = r[1] === "2" ? "surgery" : departmentOf(r[6]);
    const sourceName = r[1] === "1" ? serviceNames.get(sourceKey("prices", r[3] ?? "")) : r[1] === "2" ? serviceNames.get(sourceKey("prices_operations", r[3] ?? "")) : null;
    const patientName = patients.get(r[4] ?? "") || "إيصال قديم بدون ملف مريض";
    const description = sourceName || clinicNames.get(r[6] ?? "") || "إيراد السيستم القديم";
    const number = `OLD-REV-${id}-${r[2] || "0"}`;
    const createdAt = sourceTime(date);
    if (amount < 0 || r[1] === "6") {
      document.transactions.push({ id: targetId, date: date.slice(0, 10), department, kind: amount < 0 ? "out" : "in", description: `${amount < 0 ? "تسوية إيراد سالب" : "إيراد خارجي"} — ${description} — ${patientName}`, amount: Math.abs(amount), receiptId: number, source: amount < 0 ? "refund" : "manual", ref: targetId, boxId: MAIN_BOX_ID, method: "legacy-unknown", createdAt, by: "السيستم القديم" });
      put("revenues", r, "transactions", targetId);
      if (r[1] === "6") incomeLinks.set(`${date}|${amount}`, targetId);
    } else {
      const patientId = legacyPatientId(r[4]);
      document.patientInvoices.push({ id: targetId, number, date: date.slice(0, 10), patientName, ...(patientId && patients.has(r[4] ?? "") ? { patientId, patientMrn: `OLD-${r[4]}` } : {}), patientPhone: phones.get(r[4] ?? "") || "", department, items: [{ description, qty: 1, unitPrice: amount }], discount: 0, paymentMethod: "legacy-unknown", boxId: MAIN_BOX_ID, createdAt, createdBy: "السيستم القديم", notes: `إيصال تحصيل منقول من revenues رقم ${id}؛ الوقت الأصلي ${date}؛ رقم المصدر ${r[2] || "0"}. إجمالي الخدمة والخصم والمديونية غير المؤكدة لم تُستنتج من مبلغ التحصيل.` });
      if (amount > 0) document.transactions.push({ id: `tx-${targetId}`, date: date.slice(0, 10), department, kind: "in", description: `فاتورة مريض: ${patientName} — ${description}`, amount, receiptId: number, source: "invoice", ref: targetId, boxId: MAIN_BOX_ID, method: "legacy-unknown", createdAt, by: "السيستم القديم" });
      put("revenues", r, "patientInvoices", targetId);
    }
  }
  for (const r of rows("paid")) {
    const id = r[0]; const date = sourceDate(r[5]); const amount = sourceMoney(r[2]);
    if (!id || !date || amount === null || amount < 0) continue;
    const targetId = legacyId("expense", id);
    document.transactions.push({ id: targetId, date: date.slice(0, 10), department: departmentOf(r[9]), kind: "out", description: `${r[1]?.trim() || "مصروف السيستم القديم"} — ${date}`, amount, receiptId: `OLD-EXP-${id}`, source: "expense", boxId: MAIN_BOX_ID, method: "legacy-unknown", category: legacyId("category", r[3] ?? "1"), createdAt: sourceTime(date), by: "السيستم القديم" });
    put("paid", r, "transactions", targetId);
  }
  for (const r of rows("pays_out")) {
    const targetId = incomeLinks.get(`${r[3] ?? ""}|${sourceMoney(r[6])}`);
    if (targetId) put("pays_out", r, "transactions", targetId, "مرتبط بإيراد خارجي من revenues؛ لم يُحتسب مرتين.");
  }
  return { tables, document, disposition, clinicDepartments, serviceNames };
}

/** Add-only, linear-time merge: never overwrite existing or edited target records on reimport. */
export function mergeLegacyDocument(db: HospitalDB, data: LegacyDocument): HospitalDB {
  const append = <T extends { id: string }>(old: T[], incoming: T[]) => {
    const ids = new Set(old.map((r) => r.id));
    const added: T[] = [];
    for (const row of incoming) if (!ids.has(row.id)) { ids.add(row.id); added.push(row); }
    return added.length ? [...old, ...added] : old;
  };
  // An invoice's cash movement must not be recreated after the imported invoice was edited/deleted.
  const invoiceIds = new Set(db.patientInvoices.map((r) => r.id));
  const transactions = data.transactions.filter((t) => t.source !== "invoice" || !invoiceIds.has(t.ref ?? ""));
  return { ...db, departments: append(db.departments, data.departments), branches: append(db.branches, data.branches), stockItems: append(db.stockItems, data.stockItems), patientInvoices: append(db.patientInvoices, data.patientInvoices), transactions: append(db.transactions, transactions), lists: { ...db.lists, services: append(db.lists.services, data.services), expenseCategories: append(db.lists.expenseCategories, data.expenseCategories), paymentMethods: append(db.lists.paymentMethods, data.paymentMethods), stockCategories: append(db.lists.stockCategories, data.stockCategories) } };
}