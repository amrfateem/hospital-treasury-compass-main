/**
 * Daily restore points (director only). The database keeps, for every piece of the hospital
 * document, how it looked at the start of each day it changed (trigger on hospital_chunks).
 * Restoring rewrites the pieces to the start of a chosen day; the permanent audit log is kept.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function requireDirector(ctx: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("نقاط الاستعادة متاحة لمدير المستشفى فقط.");
}

export interface RestoreDay {
  day: string;
  pieces: number;
  firstSaved: string;
}

export const listRestoreDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RestoreDay[]> => {
    await requireDirector(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("list_restore_days");
    if (error) throw error;
    return (data ?? []).map((r) => ({ day: r.day, pieces: Number(r.pieces), firstSaved: r.first_saved }));
  });

function validDay(s: unknown): string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("تاريخ غير صحيح.");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error("تاريخ غير صحيح.");
  return s;
}

export const restoreToDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { day: string }) => ({ day: validDay(d?.day) }))
  .handler(async ({ data, context }) => {
    await requireDirector(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.rpc("prune_restore_points");
    const { data: version, error } = await supabaseAdmin.rpc("restore_hospital_to_day", { _day: data.day });
    if (error) throw error;
    const v = Number(version);
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, username")
      .eq("id", context.userId)
      .maybeSingle();
    await supabaseAdmin.from("audit_log").insert({
      id: `restore-${Date.now()}-${context.userId}`,
      at: new Date().toISOString(),
      by_name: profile?.full_name || profile?.username || "",
      by_id: context.userId,
      role: "admin",
      op: "restoreToDay",
      section: "settings",
      summary: `استعادة النظام إلى بداية يوم ${data.day}`,
      version: v,
    });
    return { ok: true as const, version: v };
  });
