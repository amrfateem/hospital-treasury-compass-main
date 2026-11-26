import { describe, expect, it } from "vitest";
import { emptyDB, type Actor } from "@/lib/hospital/model";
import { runOp } from "@/lib/hospital/ops";
import { boxBalance } from "@/lib/hospital/finance";
import { buildJournal } from "@/lib/hospital/ledger";
import { buildLegacyPlan, parseLegacyBackup, sourceDate, sourceTime } from "./migration";
import { fixtureDump, fixtureRows, row, statement } from "./test-fixtures";

const admin: Actor = { id: "owner", name: "مدير اختبار", role: "admin" };
const ctx = { actor: admin, today: "2026-11-25", now: 1000 };
const plan = () => buildLegacyPlan(parseLegacyBackup(fixtureDump()));

describe("active migration with original dates and amounts", () => {
  it("posts 100 received, -20 reversal, 50 external income and 30 expense exactly once", () => {
    const data = plan().document;
    const next = runOp(emptyDB(), "importLegacyData", { document: data }, ctx);
    expect(next.patientInvoices).toHaveLength(1);
    expect(next.transactions).toHaveLength(4);
    expect(boxBalance("main", next.transactions, next.transfers)).toBe(100);
    const journal = buildJournal(next, "2026-11-25");
    const cashDebit = journal.flatMap((j) => j.lines).filter((l) => l.account === "1100-main").reduce((n, l) => n + l.debit - l.credit, 0);
    expect(cashDebit).toBe(100);
    expect(journal.every((j) => j.lines.reduce((n, l) => n + l.debit - l.credit, 0) === 0)).toBe(true);
  });
  it("keeps 2022 receipt and expense dates, full receipt time and source numbers", () => {
    const data = plan().document;
    expect(data.patientInvoices[0]?.date).toBe("2022-08-02");
    expect(data.patientInvoices[0]?.createdAt).toBe(Date.parse("2022-08-02T16:24:05Z"));
    expect(data.patientInvoices[0]?.number).toBe("OLD-REV-1-202208021");
    expect(data.transactions.find((t) => t.source === "expense")?.date).toBe("2022-08-02");
  });
  it("puts original service price 150 into the active lab catalogue without repricing a 100 receipt", () => {
    const next = runOp(emptyDB(), "importLegacyData", { document: plan().document }, ctx);
    expect(next.lists.services.find((s) => s.id === "legacy-analysis-4")?.price).toBe(150);
    expect(next.lists.services.find((s) => s.id === "legacy-analysis-4")?.department).toBe("lab");
    expect(next.patientInvoices[0]?.items[0]?.unitPrice).toBe(100);
  });
  it("does not duplicate cash movements, and preserves an edited imported receipt", () => {
    const data = plan().document;
    const next = runOp(emptyDB(), "importLegacyData", { document: data }, ctx);
    const first = next.patientInvoices[0];
    if (!first) throw new Error("missing receipt");
    const edited = { ...next, patientInvoices: [{ ...first, notes: "edited", items: [{ description: "service", qty: 1, unitPrice: 80 }] }] };
    const again = runOp(edited, "importLegacyData", { document: data }, { ...ctx, now: 2000 });
    expect(again.patientInvoices).toHaveLength(1);
    expect(again.patientInvoices[0]?.items[0]?.unitPrice).toBe(80);
    expect(again.transactions).toHaveLength(4);
    expect(boxBalance("main", again.transactions, again.transfers)).toBe(100);
  });
  it("does not invent patient debt or stock or doctor dues from unknown source fields", () => {
    const next = runOp(emptyDB(), "importLegacyData", { document: plan().document }, ctx);
    expect(next.creditCharges).toHaveLength(0);
    expect(next.creditAccounts).toHaveLength(0);
    expect(next.doctorPayouts).toHaveLength(0);
    expect(next.stockMoves).toHaveLength(0);
    expect(plan().disposition.has("patient_balance:1")).toBe(false);
    expect(next.patientInvoices[0]?.paymentMethod).toBe("legacy-unknown");
  });
  it("allows only the director to post the migration", () => {
    expect(() => runOp(emptyDB(), "importLegacyData", { document: plan().document }, { ...ctx, actor: { ...admin, role: "finance" } })).toThrow();
  });
  it("refuses additions inside a closed fiscal year", () => {
    let db = runOp(emptyDB(), "importLegacyData", { document: plan().document }, ctx);
    db = runOp(db, "closeFiscalYear", { year: 2022 }, { ...ctx, now: 2000 });
    const tables = parseLegacyBackup(fixtureDump());
    tables.set("revenues", [row(14, { 0: "99", 1: "8", 2: "99", 4: "7", 5: "25", 6: "6", 9: "2022-12-30 10:00:00" })]);
    expect(() => runOp(db, "importLegacyData", { document: buildLegacyPlan(tables).document }, { ...ctx, now: 3000 })).toThrow(/2022/);
  });
  it("refuses additions on a closed treasury day", () => {
    let db = runOp(emptyDB(), "importLegacyData", { document: plan().document }, ctx);
    db = runOp(db, "closeCashDay", { id: "close-test", date: "2022-08-02", boxId: "main", counted: 0 }, { ...ctx, now: 2000 });
    const tables = parseLegacyBackup(fixtureDump());
    tables.set("revenues", [row(14, { 0: "99", 1: "8", 2: "99", 4: "7", 5: "25", 6: "6", 9: "2022-08-02 10:00:00" })]);
    expect(() => runOp(db, "importLegacyData", { document: buildLegacyPlan(tables).document }, { ...ctx, now: 3000 })).toThrow();
  });
  it("rejects invalid dates and unparsed INSERTs rather than inventing or dropping data", () => {
    expect(sourceDate("2022-02-30")).toBeNull();
    expect(sourceDate("0000-00-00")).toBeNull();
    expect(sourceTime("2022-08-02 16:24:05")).toBe(Date.parse("2022-08-02T16:24:05Z"));
    expect(() => parseLegacyBackup(fixtureDump() + '\nINSERT INTO bad VALUES("1"),("2");')).toThrow();
    const patient = fixtureRows.patients[0];
    if (!patient) throw new Error("missing fixture");
    expect(() => parseLegacyBackup(fixtureDump() + "\n" + statement("patients", patient))).toThrow();
  });
});