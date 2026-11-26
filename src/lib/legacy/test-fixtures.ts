/** Synthetic backup, never real patient or credential data. */
export const row = (length: number, values: Record<number, string>) => {
  const out = Array.from({ length }, () => "");
  for (const [index, value] of Object.entries(values)) out[Number(index)] = value;
  return out;
};
export const statement = (table: string, values: string[]) => `INSERT INTO ${table} VALUES(${values.map((s) => JSON.stringify(s)).join(",")});`;
export const fixtureRows = {
  patients: [row(132, { 0: "7", 1: "مريض اختبار", 2: "35", 3: "1", 9: "000", 14: "2022-08-02 10:00:00" })],
  clinics: [row(32, { 0: "6", 1: "المعمل" })],
  analysis: [row(6, { 0: "4", 1: "CBC", 4: "150" })],
  pay_categories: [row(2, { 0: "1", 1: "مصاريف" })],
  revenues: [
    row(14, { 0: "1", 1: "8", 2: "202208021", 3: "202208021", 4: "7", 5: "100", 6: "6", 9: "2022-08-02 16:24:05" }),
    row(14, { 0: "2", 1: "8", 2: "202208021", 3: "202208021", 4: "7", 5: "-20", 6: "6", 9: "2022-08-03 11:30:12" }),
    row(14, { 0: "3", 1: "6", 2: "0", 3: "0", 4: "0", 5: "50", 6: "0", 9: "2022-08-04 12:00:00" }),
  ],
  paid: [row(11, { 0: "1", 1: "مصروف اختبار", 2: "30", 3: "1", 5: "2022-08-02 18:00:00", 9: "6" })],
  pays_out: [row(7, { 0: "1", 3: "2022-08-04 12:00:00", 5: "إيراد خارجي", 6: "50" })],
  waiting_lab_rays: [row(22, { 0: "1", 1: "6", 2: "7", 3: "analysis", 4: "[4]", 5: "[150]", 6: "150", 7: "100", 8: "50", 9: "202208021", 12: "2022-08-02 16:24:05" })],
  waiting: [row(29, { 0: "1", 2: "7", 3: "2022-08-02 15:00:00", 6: "1", 8: "100", 9: "100", 11: "6" })],
  patient_balance: [row(7, { 0: "1", 1: "7", 4: "50" })],
};
export const fixtureDump = () => Object.entries(fixtureRows).flatMap(([table, rows]) => rows.map((r) => statement(table, r))).join("\n");