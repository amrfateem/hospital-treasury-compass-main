// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let dbm: typeof import("./db.server");
let backup: typeof import("./backup.server");
let recovery: typeof import("./recovery.server");

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "alrahma-backup-"));
  process.env["ALRAHMA_DATA_DIR"] = join(root, "app", "data");
  process.env["ALRAHMA_BACKUP_DIR"] = join(root, "pc-backups");
  dbm = await import("./db.server");
  backup = await import("./backup.server");
  recovery = await import("./recovery.server");
});

afterAll(() => {
  dbm.closeDb();
  rmSync(root, { recursive: true, force: true });
});

describe("backup retention", () => {
  const today = "2026-11-20";
  it("keeps every snapshot of today and yesterday", () => {
    const names = ["hospital-2026-11-20-0900.db", "hospital-2026-11-20-hourly-1000.db", "hospital-2026-11-19-0800.db", "hospital-2026-11-19-hourly-2300.db"];
    expect(backup.prunePlan(names, today)).toEqual([]);
  });
  it("keeps only the last snapshot of older days", () => {
    const names = ["hospital-2026-11-10-0800.db", "hospital-2026-11-10-hourly-2200.db", "hospital-2026-11-10-hourly-1200.db"];
    expect(backup.prunePlan(names, today)).toEqual(["hospital-2026-11-10-0800.db", "hospital-2026-11-10-hourly-1200.db"]);
  });
  it("drops days older than 60 days", () => {
    expect(backup.prunePlan(["hospital-2026-09-01-0800.db", "hospital-2026-10-01-0800.db"], today)).toEqual(["hospital-2026-09-01-0800.db"]);
  });
});

describe("backups survive a broken USB or a damaged database", () => {
  it("writes a checked copy to the USB folder and the server PC", async () => {
    dbm.run("INSERT INTO meta (key, value) VALUES ('marker', 'before-crash') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    mkdirSync(join(dbm.dataDir(), "files", "patient"), { recursive: true });
    writeFileSync(join(dbm.dataDir(), "files", "patient", "id-card.jpg"), "photo");
    const r = await backup.runBackup("manual");
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(2);
    for (const f of r.ok) expect(recovery.isHealthyDatabase(f)).toBe(true);
    expect(readdirSync(join(root, "pc-backups", "db")).some((n) => n.endsWith(".partial"))).toBe(false);
  });

  it("puts a damaged database aside and brings back the newest healthy backup", () => {
    dbm.closeDb();
    const live = join(dbm.dataDir(), "hospital.db");
    rmSync(`${live}-wal`, { force: true });
    rmSync(`${live}-shm`, { force: true });
    writeFileSync(live, "this is not a database");
    const e = recovery.prepareDatabaseFile({ restoreMissing: true });
    expect(e?.reason).toBe("damaged");
    expect(e?.setAside && existsSync(e.setAside)).toBe(true);
    expect(dbm.get<{ value: string }>("SELECT value FROM meta WHERE key = 'marker'")?.value).toBe("before-crash");
  });

  it("restores everything on a new USB from the server PC's copy", () => {
    dbm.closeDb();
    // The new USB has the program but no data and no USB backups.
    rmSync(dbm.dataDir(), { recursive: true, force: true });
    rmSync(join(root, "app", "Backups"), { recursive: true, force: true });
    const e = recovery.prepareDatabaseFile({ restoreMissing: true });
    expect(e?.reason).toBe("missing");
    expect(e?.restoredFrom).toContain("pc-backups");
    expect(existsSync(join(dbm.dataDir(), "files", "patient", "id-card.jpg"))).toBe(true);
    expect(dbm.get<{ value: string }>("SELECT value FROM meta WHERE key = 'marker'")?.value).toBe("before-crash");
  });

  it("stops warning about a recovery once the director has reviewed it", () => {
    const before = recovery.recoveryLog();
    expect(before.some((e) => !e.acknowledgedAt)).toBe(true);
    expect(recovery.acknowledgeRecoveries("director")).toBeGreaterThan(0);
    const after = recovery.recoveryLog();
    expect(after).toHaveLength(before.length);
    expect(after.every((e) => e.acknowledgedAt && e.acknowledgedBy === "director")).toBe(true);
    expect(recovery.acknowledgeRecoveries("director")).toBe(0);
  });

  it("saves with full sync so a confirmed entry survives a power cut", () => {
    const row = dbm.get<{ synchronous: number }>("PRAGMA synchronous");
    expect(row?.synchronous).toBe(2); // FULL
  });
});
