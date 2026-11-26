// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, get, run } from "@/lib/local/db.server";
import { readState, resetStateCache, saveState } from "@/lib/hospital/state.server";
import { emptyDB, type Actor } from "@/lib/hospital/model";
import { boxBalance } from "@/lib/hospital/finance";
import { importLegacyDump, legacyDetails, legacyOverview, legacySearch } from "./legacy-import.server";
import { fixtureDump } from "./test-fixtures";

// The backup itself is covered by backup.test.ts; a real snapshot inside every import test
// makes the suite I/O-bound and flaky on Windows.
const backupState = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/local/backup.server", () => ({
  runBackup: async () =>
    backupState.ok
      ? { ok: ["test-backup"], failed: [], error: null }
      : { ok: [], failed: [{ dir: "test", error: "disk full" }], error: "disk full" },
}));

const actor: Actor = { id: "test-owner", name: "مدير الاختبار", role: "admin" };
let root = "";
let oldData: string | undefined;
let oldBackup: string | undefined;
beforeEach(() => {
  closeDb(); resetStateCache();
  oldData = process.env["ALRAHMA_DATA_DIR"]; oldBackup = process.env["ALRAHMA_BACKUP_DIR"];
  root = mkdtempSync(join(tmpdir(), "legacy-active-"));
  process.env["ALRAHMA_DATA_DIR"] = join(root, "app", "data");
  process.env["ALRAHMA_BACKUP_DIR"] = join(root, "host-backups");
});
afterEach(() => {
  closeDb(); resetStateCache(); rmSync(root, { recursive: true, force: true });
  if (oldData === undefined) delete process.env["ALRAHMA_DATA_DIR"]; else process.env["ALRAHMA_DATA_DIR"] = oldData;
  if (oldBackup === undefined) delete process.env["ALRAHMA_BACKUP_DIR"]; else process.env["ALRAHMA_BACKUP_DIR"] = oldBackup;
});

describe("durable active legacy import", () => {
  it("imports patients and actual medical records with original dates, no fabricated age-based birth date", async () => {
    const result = await importLegacyDump(fixtureDump(), actor);
    expect(result.patients).toBe(1);
    expect(result.visits).toBe(1);
    expect(result.labOrders).toBe(1);
    expect(get<{birth_date:string|null;created_at:string}>("SELECT birth_date,created_at FROM patients WHERE id='legacy-7'")).toEqual({ birth_date: null, created_at: "2022-08-02 10:00:00" });
    expect(get<{visit_date:string}>("SELECT visit_date FROM medical_visits")?.visit_date).toBe("2022-08-02");
    const lab = get<{ordered_at:string;tests:string}>("SELECT ordered_at,tests FROM lab_orders");
    expect(lab?.ordered_at).toBe("2022-08-02 16:24:05");
    expect(JSON.parse(lab?.tests ?? "[]")).toEqual([{ name: "CBC", result: "", unit: "", range: "" }]);
  });
  it("refuses to import when the pre-import backup fails and changes nothing", async () => {
    backupState.ok = false;
    try {
      await expect(importLegacyDump(fixtureDump(), actor)).rejects.toThrow("نسخة أمان");
      expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM patients")?.n).toBe(0);
    } finally {
      backupState.ok = true;
    }
  });
  it("reads active invoices and cash back after reload and keeps every source row", async () => {
    await importLegacyDump(fixtureDump(), actor);
    resetStateCache();
    const saved = await readState();
    expect(saved.db.patientInvoices).toHaveLength(1);
    expect(boxBalance("main",saved.db.transactions,saved.db.transfers)).toBe(100);
    expect(get<{n:number}>("SELECT COUNT(*) AS n FROM legacy_source_rows")?.n).toBe(12);
    expect(legacyOverview().counts.find((c) => c.kind === "patient_balance")?.review).toBe(1);
    expect(legacyDetails("patients","7").find((f) => f.index === 2)?.value).toBe("35");
    expect(saved.db.creditAccounts).toHaveLength(0);
  });
  it("repeat import adds no financial or medical records", async () => {
    await importLegacyDump(fixtureDump(),actor);
    const again = await importLegacyDump(fixtureDump(),actor);
    expect(again.patients).toBe(0);
    expect(again.visits).toBe(0);
    expect(again.labOrders).toBe(0);
    expect(again.invoices).toBe(0);
    expect(again.transactions).toBe(0);
    expect(again.sourceRows).toBe(0);
    expect(get<{n:number}>("SELECT COUNT(*) AS n FROM medical_visits")?.n).toBe(1);
  });
  it("does not resurrect an imported invoice after its removal", async () => {
    await importLegacyDump(fixtureDump(),actor);
    const before = await readState();
    await saveState(before.version,before.db,{ ...before.db,patientInvoices:[],transactions:before.db.transactions.filter((t) => t.source !== "invoice") });
    await importLegacyDump(fixtureDump(),actor);
    expect((await readState()).db.patientInvoices).toHaveLength(0);
    expect((await readState()).db.transactions.filter((t) => t.source === "invoice")).toHaveLength(0);
  });
  it("changed source rows are retained for review without overwriting financial amounts", async () => {
    await importLegacyDump(fixtureDump(),actor);
    const changed = fixtureDump().replace('"100","6","","","2022-08-02 16:24:05"','"900","6","","","2022-08-02 16:24:05"');
    expect(changed).not.toBe(fixtureDump());
    await importLegacyDump(changed,actor);
    expect((await readState()).db.patientInvoices[0]?.items[0]?.unitPrice).toBe(100);
    expect(get<{n:number}>("SELECT COUNT(*) AS n FROM legacy_source_versions WHERE table_name='revenues'")?.n).toBe(1);
    expect(legacySearch("revenues", "").find((r) => r.sourceId === "1")?.reason).toContain("تغيّر");
  });
  it("rolls back both SQL records and document chunks when the atomic callback fails", async () => {
    const before = await readState();
    const next = { ...emptyDB(), settings: { ...before.db.settings, address: "atomic test" } };
    await expect(saveState(before.version,before.db,next,() => {
      run("INSERT INTO meta(key,value) VALUES('atomic-test','should roll back')");
      throw new Error("forced rollback");
    })).rejects.toThrow("forced rollback");
    expect(get("SELECT value FROM meta WHERE key='atomic-test'")).toBeUndefined();
    expect((await readState()).version).toBe(before.version);
    expect((await readState()).db.settings.address).toBe(before.db.settings.address);
  });
  it("rejects non-directors and never returns credential/configuration fields", async () => {
    await expect(importLegacyDump(fixtureDump(), { ...actor,role:"finance" })).rejects.toThrow();
    expect(() => legacyDetails("users","1")).toThrow();
    expect(() => legacyDetails("settings","1")).toThrow();
    expect(() => legacyDetails("sms_companies","1")).toThrow();
  });
});