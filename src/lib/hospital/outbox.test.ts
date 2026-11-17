import { describe, expect, it } from "vitest";
import { opAuditId, outboxFor, type OutboxEntry } from "./device-cache";
import { emptyDB } from "./model";
import { runOp } from "./ops";

const e = (key: string, userId: string, now: number, op = "addTransaction"): OutboxEntry => ({
  key,
  userId,
  op,
  args: {},
  now,
  today: "2026-11-16",
});

describe("device outbox for unsent changes", () => {
  it("keeps only the signed-in person's changes, oldest first, without duplicates", () => {
    const list = [e("3-c", "u1", 3), e("1-a", "u1", 1), e("2-b", "u2", 2), e("1-a", "u1", 1)];
    expect(outboxFor("u1", list).map((x) => x.key)).toEqual(["1-a", "3-c"]);
  });

  it("uses the same id the server records for the op, so a resent change is recognised", () => {
    const actor = { id: "u1", name: "سارة", role: "admin" as const, boxId: null, perms: null };
    const db = runOp(
      emptyDB(),
      "saveEmployee",
      {
        id: "emp-1",
        name: "أحمد",
        jobTitle: "",
        department: "admin",
        fixedSalary: 5000,
        variableSalary: 0,
        hireDate: "2026-01-01",
      } as never,
      { now: 1700000000123, today: "2026-11-16", actor },
    );
    const id = opAuditId({ now: 1700000000123, userId: "u1", op: "saveEmployee" });
    expect(db.auditLog.at(-1)?.id).toBe(id);
  });
});
