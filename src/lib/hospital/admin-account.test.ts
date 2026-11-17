import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let dbm: typeof import("@/lib/local/db.server");
let auth: typeof import("./auth.server");
let users: typeof import("./users.server");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "alrahma-owner-"));
  process.env["ALRAHMA_DATA_DIR"] = dir;
  dbm = await import("@/lib/local/db.server");
  auth = await import("./auth.server");
  users = await import("./users.server");
});

afterAll(() => {
  dbm.closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("one owner account per installation", () => {
  it("opens setup only until the first admin exists", () => {
    expect(users.setupStatus().needsSetup).toBe(true);
    users.createFirstAdmin({ username: "director", fullName: "Director", password: "director123" });
    expect(users.setupStatus().needsSetup).toBe(false);
    expect(auth.countAdmins()).toBe(1);
  });

  it("refuses a second admin from setup or from staff management", () => {
    expect(() =>
      users.createFirstAdmin({ username: "second", fullName: "Second", password: "director123" }),
    ).toThrow(/مدير/);

    const profile = auth.findProfileByUsername("director")!;
    const me = auth.loadMe(profile.id);
    expect(() =>
      users.createStaff(me, {
        username: "owner2",
        fullName: "Owner 2",
        password: "password123",
        role: "admin",
      }),
    ).toThrow(/مدير/);

    users.createStaff(me, {
      username: "accountant",
      fullName: "Accountant",
      password: "password123",
      role: "accountant",
    });
    const acc = auth.findProfileByUsername("accountant")!;
    expect(() =>
      users.updateStaff(me, { id: acc.id, fullName: "Accountant", role: "admin", active: true }),
    ).toThrow(/مدير/);
    expect(() => users.deleteStaff(me, me.id)).toThrow(/حسابك/);
    expect(() =>
      users.updateStaff(me, { id: me.id, fullName: "Director", role: "finance", active: true }),
    ).toThrow();
    expect(auth.countAdmins()).toBe(1);
  });

  it("never reopens setup for a stopped admin account", () => {
    const profile = auth.findProfileByUsername("director")!;
    dbm.run("UPDATE profiles SET active = 0 WHERE id = ?", profile.id);
    expect(users.setupStatus().needsSetup).toBe(false);
    dbm.run("UPDATE profiles SET active = 1 WHERE id = ?", profile.id);
    expect(users.setupStatus().needsSetup).toBe(false);
  });
});
