import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Role } from "./model";
import {
  ROLES,
  cleanControls,
  cleanPermissions,
  type Permissions,
  type StaffControls,
} from "./permissions";
import { USERNAME_RE, normalizeUsername, usernameToEmail } from "./staff";

export interface StaffRow {
  id: string;
  username: string;
  fullName: string;
  role: Role | null;
  active: boolean;
  createdAt: string;
  permissions: Permissions | null;
  controls: StaffControls | null;
}

function checkStaffInput(i: {
  username?: string;
  fullName: string;
  role: Role;
  password?: string;
}) {
  if (i.username !== undefined && !USERNAME_RE.test(normalizeUsername(i.username)))
    throw new Error("اسم المستخدم: حروف إنجليزية صغيرة وأرقام (٣ إلى ٣٠ حرفًا) بدون مسافات.");
  if (!i.fullName.trim()) throw new Error("اكتب الاسم بالكامل.");
  if (!ROLES.includes(i.role)) throw new Error("دور غير معروف.");
  if (i.password !== undefined && i.password.length < 8)
    throw new Error("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
}

/** Turns sign-in service messages (English) into Arabic for staff. */
export function authErrorAr(message: string | undefined, fallback: string): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("weak") || m.includes("pwned") || m.includes("easy to guess"))
    return "كلمة المرور ضعيفة أو مشهورة وسهل تخمينها — اختر كلمة مرور أقوى (اخلط حروفًا وأرقامًا ورموزًا).";
  if (m.includes("at least") && m.includes("characters")) return "كلمة المرور قصيرة — يجب ألا تقل عن ٨ أحرف.";
  if (m.includes("already") && (m.includes("registered") || m.includes("exists")))
    return "اسم المستخدم مستخدم بالفعل.";
  if (m.includes("rate limit") || m.includes("too many")) return "محاولات كثيرة — انتظر دقيقة وحاول مرة أخرى.";
  return fallback;
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

type AdminClient = Awaited<ReturnType<typeof admin>>;

async function createAccount(i: {
  username: string;
  fullName: string;
  password: string;
  role: Role;
  permissions?: Permissions | null | undefined;
  controls?: StaffControls | null | undefined;
}) {
  const sb = await admin();
  const username = normalizeUsername(i.username);
  const { data: taken } = await sb
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (taken) throw new Error("اسم المستخدم مستخدم بالفعل.");
  const { data, error } = await sb.auth.admin.createUser({
    email: usernameToEmail(username),
    password: i.password,
    email_confirm: true,
    user_metadata: { username, full_name: i.fullName.trim() },
  });
  if (error || !data.user) throw new Error(authErrorAr(error?.message, "تعذّر إنشاء الحساب."));
  const id = data.user.id;
  const p = await sb
    .from("profiles")
    .insert({
      id,
      username,
      full_name: i.fullName.trim(),
      // One main treasury for everyone: nobody is tied to a drawer.
      box_id: null,
      permissions: i.role === "admin" ? null : (i.permissions ?? null),
      controls: i.role === "admin" ? null : ((i.controls ?? null) as never),
    });
  const r = await sb.from("user_roles").insert({ user_id: id, role: i.role });
  if (p.error || r.error) {
    await sb.auth.admin.deleteUser(id);
    throw new Error("تعذّر حفظ بيانات الحساب.");
  }
  return id;
}

/** Public: whether the very first owner account still has to be created. */
export const getSetupStatus = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { count } = await sb
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  return { needsSetup: !count };
});

/** Public, but only works while no owner account exists yet. */
export const createFirstAdmin = createServerFn({ method: "POST" })
  .validator((i: { username: string; fullName: string; password: string }) => {
    checkStaffInput({ ...i, role: "admin" });
    return i;
  })
  .handler(async ({ data }) => {
    const sb = await admin();
    const { count } = await sb
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (count) throw new Error("تم إعداد حساب المدير بالفعل. سجّل الدخول.");
    await createAccount({ ...data, role: "admin" });
    return { ok: true };
  });

const requireAdmin = async (ctx: { supabase: SupabaseClient<Database>; userId: string }) => {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (!data) throw new Error("هذه الصفحة لمدير المستشفى فقط.");
};

export const listStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const sb = await admin();
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      sb.from("profiles").select("*").order("created_at"),
      sb.from("user_roles").select("user_id, role"),
    ]);
    const rows: StaffRow[] = (profiles ?? []).map((p) => ({
      id: p.id,
      username: p.username,
      fullName: p.full_name,
      role: ROLES.find((r) => roles?.some((x) => x.user_id === p.id && x.role === r)) ?? null,
      active: p.active,
      createdAt: p.created_at,
      permissions: cleanPermissions(p.permissions),
      controls: cleanControls(p.controls),
    }));
    return rows;
  });

export const createStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (i: {
      username: string;
      fullName: string;
      password: string;
      role: Role;
      permissions?: unknown;
      controls?: unknown;
    }) => {
      checkStaffInput(i);
      return { ...i, permissions: cleanPermissions(i.permissions), controls: cleanControls(i.controls) };
    },
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    await createAccount(data);
    return { ok: true };
  });

export const updateStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (i: {
      id: string;
      fullName: string;
      role: Role;
      active: boolean;
      controls?: unknown;
    }) => {
      checkStaffInput(i);
      return { ...i, controls: cleanControls(i.controls) };
    },
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (data.id === context.userId && (data.role !== "admin" || !data.active))
      throw new Error("لا يمكنك إلغاء صلاحية المدير أو إيقاف حسابك أنت.");
    const sb = await admin();
    const p = await sb
      .from("profiles")
      .update({
        full_name: data.fullName.trim(),
        box_id: null,
        active: data.active,
        controls: data.role === "admin" ? null : (data.controls as never),
      })
      .eq("id", data.id);
    if (p.error) throw new Error("تعذّر حفظ التعديل.");
    await sb.from("user_roles").delete().eq("user_id", data.id);
    const r = await sb.from("user_roles").insert({ user_id: data.id, role: data.role });
    if (r.error) throw new Error("تعذّر حفظ الدور.");
    await sb.auth.admin.updateUserById(data.id, { ban_duration: data.active ? "none" : "876000h" });
    return { ok: true };
  });

export const setStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { id: string; password: string }) => {
    if (!i.password || i.password.length < 8) throw new Error("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
    return i;
  })
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const sb = await admin();
    const { error } = await sb.auth.admin.updateUserById(data.id, { password: data.password });
    if (error) throw new Error(authErrorAr(error.message, "تعذّر تغيير كلمة المرور."));
    return { ok: true };
  });

export const deleteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (data.id === context.userId) throw new Error("لا يمكنك حذف حسابك أنت.");
    const sb = await admin();
    const { error } = await sb.auth.admin.deleteUser(data.id);
    if (error) throw new Error("تعذّر حذف الحساب.");
    return { ok: true };
  });

/** The director sets which sections a staff member can see or change (null = role defaults). */
export const setStaffPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: { id: string; permissions: unknown }) => {
    if (!i || typeof i.id !== "string") throw new Error("بيانات غير صحيحة.");
    return { id: i.id, permissions: cleanPermissions(i.permissions) };
  })
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (data.id === context.userId) throw new Error("صلاحيات مدير المستشفى كاملة ولا تُعدَّل.");
    const sb = await admin();
    const { error } = await sb
      .from("profiles")
      .update({ permissions: data.permissions })
      .eq("id", data.id);
    if (error) throw new Error("تعذّر حفظ الصلاحيات.");
    return { ok: true };
  });
