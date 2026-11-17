import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./auth-middleware";
import type { Me } from "./me";
import type { HospitalDB } from "./model";
import { OPS, OpError, runOp, viewFor, type OpName } from "./ops";

export type { Me };

const state = () => import("./state.server");

export const getHospitalState = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db, version } = await (await state()).readState();
    return { ok: true as const, me: context.me, version, db: viewFor(db, context.me) };
  });

/**
 * Only the pieces that changed since the device's version (already filtered for the caller).
 * `full: true` asks the device to reload everything (too many changes, or it is ahead).
 */
export const getHospitalChanges = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { since: number }) => {
    if (!d || typeof d.since !== "number" || !Number.isFinite(d.since)) throw new Error("Bad version");
    return d;
  })
  .handler(async ({ data, context }) => {
    const s = await state();
    const { db, version } = await s.readState();
    if (data.since === version)
      return { ok: true as const, full: false as const, me: context.me, version, chunks: {} as never };
    if (data.since > version) return { ok: true as const, full: true as const, me: context.me, version };
    const keys = await s.changedKeysSince(data.since);
    if (!keys) return { ok: true as const, full: true as const, me: context.me, version };
    const { pickChunks } = await import("./chunks.view");
    const chunks = pickChunks(viewFor(db, context.me), keys);
    return { ok: true as const, full: false as const, me: context.me, version, chunks: chunks as never };
  });

/** Work outside the document that must follow some operations (after they are saved). */
async function afterOp(op: string, args: unknown, before: HospitalDB) {
  if (op !== "decidePatientDelete") return;
  const a = args as { id: string; approve: boolean };
  if (!a.approve) return;
  const req = before.patientDeleteRequests.find((r) => r.id === a.id);
  if (!req) return;
  const [{ all, run, filesDir }, { unlinkSync }, { join }] = await Promise.all([
    import("@/lib/local/db.server"),
    import("node:fs"),
    import("node:path"),
  ]);
  const files = all<{ id: string; path: string }>(
    "SELECT id, path FROM stored_files WHERE owner_kind = 'patient' AND owner_id = ?",
    req.patientId,
  );
  for (const f of files) {
    try {
      unlinkSync(join(filesDir(), f.path));
    } catch {
      /* missing file is fine */
    }
    run("DELETE FROM stored_files WHERE id = ?", f.id);
  }
  run("DELETE FROM patients WHERE id = ?", req.patientId);
}

/** Whether an op with this audit id was already saved (recent log in the document, else the full log). */
async function alreadyApplied(db: HospitalDB, auditId: string, at: number) {
  const log = db.auditLog ?? [];
  if (log.some((e) => e.id === auditId)) return true;
  const oldest = log[0]?.at;
  if (oldest === undefined || at >= oldest) return false;
  const { get } = await import("@/lib/local/db.server");
  return !!get("SELECT id FROM audit_log WHERE id = ?", auditId);
}

export const applyHospitalOp = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { op: string; args: unknown; now: number; today: string }) => {
    if (!input || typeof input.op !== "string" || !(input.op in OPS)) throw new Error("Unknown op");
    if (typeof input.now !== "number" || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.today)))
      throw new Error("Bad clock");
    return input;
  })
  .handler(async ({ data, context }) => {
    const me = context.me as Me;
    const s = await state();
    // Same id runOp gives the op's audit entry: if it is already recorded, this is a resend
    // of a change that was saved (the device lost the answer) — never apply it twice.
    const auditId = `log-${data.now}-${me.id}-${data.op}`;
    for (let attempt = 0; attempt < 6; attempt++) {
      const { db, version } = await s.readState();
      if (await alreadyApplied(db, auditId, data.now))
        return { ok: true as const, version, duplicate: true as const };
      let next: HospitalDB;
      try {
        next = runOp(db, data.op as OpName, data.args as never, {
          now: data.now,
          today: data.today,
          actor: me,
        });
      } catch (e) {
        if (e instanceof OpError) return { ok: false as const, error: e.message };
        throw e;
      }
      if (next === db) return { ok: true as const, version };
      const saved = await s.saveState(version, db, next);
      if (saved !== null) {
        try {
          await afterOp(data.op, data.args, db);
        } catch (e) {
          // The change itself is saved; only the follow-up cleanup failed.
          console.error("afterOp failed", data.op, e);
        }
        return { ok: true as const, version: saved };
      }
    }
    // Still busy after several tries: a temporary state — the device keeps the change and resends.
    throw new Error("timeout: hospital busy");
  });
