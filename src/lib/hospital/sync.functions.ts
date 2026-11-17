import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { Actor, HospitalDB, Role } from "./model";
import { OPS, OpError, runOp, viewFor, type OpName } from "./ops";
import { ROLES, cleanControls, cleanPermissions } from "./permissions";

export interface Me extends Actor {
  username: string;
}

type AuthedSupabase = SupabaseClient<Database>;

/** With several roles the strongest wins (director first). */
const ROLE_RANK: Role[] = ROLES;

/** Reads the caller's own profile and role (RLS: own rows only). */
export async function loadMe(supabase: AuthedSupabase, userId: string): Promise<Me> {
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("username, full_name, box_id, active, permissions, controls")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);
  const role = ROLE_RANK.find((r) => roles?.some((x) => x.role === r));
  if (!profile || !profile.active || !role) throw new Error("NO_ACCESS");
  return {
    id: userId,
    username: profile.username,
    name: profile.full_name || profile.username,
    role,
    boxId: profile.box_id,
    perms: role === "admin" ? null : cleanPermissions(profile.permissions),
    controls: role === "admin" ? null : cleanControls(profile.controls),
  };
}

const state = () => import("./state.server");

export const getHospitalState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    let me: Me;
    try {
      me = await loadMe(context.supabase, context.userId);
    } catch {
      return { ok: false as const, error: "NO_ACCESS" };
    }
    const { db, version } = await (await state()).readState();
    return { ok: true as const, me, version, db: viewFor(db, me) as unknown as Json };
  });

/**
 * Only the pieces that changed since the device's version (already filtered for the caller).
 * `full: true` asks the device to reload everything (too many changes, or it is ahead).
 */
export const getHospitalChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { since: number }) => {
    if (!d || typeof d.since !== "number" || !Number.isFinite(d.since)) throw new Error("Bad version");
    return d;
  })
  .handler(async ({ data, context }) => {
    let me: Me;
    try {
      me = await loadMe(context.supabase, context.userId);
    } catch {
      return { ok: false as const, error: "NO_ACCESS" };
    }
    const s = await state();
    const { db, version } = await s.readState();
    if (data.since === version) return { ok: true as const, full: false as const, me, version, chunks: {} as Json };
    if (data.since > version) return { ok: true as const, full: true as const, me, version };
    const keys = await s.changedKeysSince(data.since);
    if (!keys) return { ok: true as const, full: true as const, me, version };
    const { pickChunks } = await import("./chunks.view");
    const chunks = pickChunks(viewFor(db, me), keys);
    return { ok: true as const, full: false as const, me, version, chunks: chunks as Json };
  });

/** Work outside the document that must follow some operations (after they are saved). */
async function afterOp(op: string, args: unknown, before: HospitalDB) {
  if (op !== "decidePatientDelete") return;
  const a = args as { id: string; approve: boolean };
  if (!a.approve) return;
  const req = before.patientDeleteRequests.find((r) => r.id === a.id);
  if (!req) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: files } = await supabaseAdmin
    .from("stored_files")
    .select("id, path")
    .eq("owner_kind", "patient")
    .eq("owner_id", req.patientId);
  if (files?.length) {
    await supabaseAdmin.storage.from("private-files").remove(files.map((f) => f.path));
    await supabaseAdmin.from("stored_files").delete().in("id", files.map((f) => f.id));
  }
  await supabaseAdmin.from("patients").delete().eq("id", req.patientId);
}

/** Whether an op with this audit id was already saved (recent log in the document, else the full log). */
async function alreadyApplied(db: HospitalDB, auditId: string, at: number) {
  const log = db.auditLog ?? [];
  if (log.some((e) => e.id === auditId)) return true;
  const oldest = log[0]?.at;
  if (oldest === undefined || at >= oldest) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("audit_log").select("id").eq("id", auditId).maybeSingle();
  return !!data;
}

export const applyHospitalOp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { op: string; args: unknown; now: number; today: string }) => {
    if (!input || typeof input.op !== "string" || !(input.op in OPS)) throw new Error("Unknown op");
    if (typeof input.now !== "number" || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.today)))
      throw new Error("Bad clock");
    return input;
  })
  .handler(async ({ data, context }) => {
    let me: Me;
    try {
      me = await loadMe(context.supabase, context.userId);
    } catch {
      return { ok: false as const, error: "ليست لديك صلاحية دخول النظام." };
    }
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
