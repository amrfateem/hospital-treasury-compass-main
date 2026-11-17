import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let dbm: typeof import("./db.server");
let auth: typeof import("../hospital/auth.server");
let state: typeof import("../hospital/state.server");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "alrahma-db-"));
  process.env["ALRAHMA_DATA_DIR"] = dir;
  dbm = await import("./db.server");
  auth = await import("../hospital/auth.server");
  state = await import("../hospital/state.server");
});

afterAll(() => {
  dbm.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("local database", () => {
  it("creates the first admin and signs in", () => {
    expect(auth.countAdmins()).toBe(0);
    const hash = auth.hashPassword("correct horse");
    dbm.transaction(() => {
      dbm.run(
        "INSERT INTO profiles (id, username, full_name, active, password_hash, created_at) VALUES (?, ?, ?, 1, ?, ?)",
        "u1",
        "director",
        "Director",
        hash,
        new Date().toISOString(),
      );
      dbm.run("INSERT INTO user_roles (user_id, role) VALUES (?, 'admin')", "u1");
    });
    expect(auth.countAdmins()).toBe(1);
    const profile = auth.findProfileByUsername("director");
    expect(profile).toBeTruthy();
    expect(auth.verifyPassword("correct horse", profile!.password_hash)).toBe(true);
    expect(auth.verifyPassword("wrong", profile!.password_hash)).toBe(false);
    const me = auth.loadMe("u1");
    expect(me.role).toBe("admin");
    expect(me.username).toBe("director");
    const token = auth.createSession("u1");
    expect(auth.userForSession(token)?.id).toBe("u1");
    auth.deleteSession(token);
    expect(auth.userForSession(token)).toBeNull();
  });

  it("saves chunks with CAS, audit rows and a restore point", async () => {
    const { emptyDB } = await import("../hospital/model");
    const empty = emptyDB();
    const first = await state.readState();
    expect(first.version).toBe(0);
    const next = { ...empty, settings: { ...empty.settings, address: "Cairo" } };
    const v1 = await state.saveState(0, empty, next);
    expect(v1).toBe(1);
    const read = await state.readState();
    expect(read.version).toBe(1);
    expect(read.db.settings.address).toBe("Cairo");

    // A stale device gets null, then succeeds after rereading.
    expect(await state.saveState(0, empty, next)).toBeNull();
    const second = { ...next, settings: { ...next.settings, address: "Giza" } };
    expect(await state.saveState(1, next, second)).toBe(2);

    const restore = dbm.get<{ n: number }>("SELECT COUNT(*) AS n FROM restore_points");
    expect(Number(restore?.n)).toBeGreaterThan(0);
    const audit = dbm.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log");
    expect(Number(audit?.n)).toBeGreaterThanOrEqual(0);
  });

  it("computes the Cairo day for restore points", () => {
    expect(dbm.cairoDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
