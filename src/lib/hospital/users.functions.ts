import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./auth-middleware";
import type { Role } from "./model";
import { ROLES, cleanControls, cleanPermissions } from "./permissions";
import { USERNAME_RE, normalizeUsername } from "./staff";
import type { StaffRow } from "./users.server";

export type { StaffRow };

function checkStaffInput(i: { username?: string; fullName: string; role: Role; password?: string }) {
  if (i.username !== undefined && !USERNAME_RE.test(normalizeUsername(i.username)))
    throw new Error("اسم المستخدم: حروف إنجليزية صغيرة وأرقام (٣ إلى ٣٠ حرفًا) بدون مسافات.");
  if (!i.fullName.trim()) throw new Error("اكتب الاسم بالكامل.");
  if (!ROLES.includes(i.role)) throw new Error("دور غير معروف.");
  if (i.password !== undefined && i.password.length < 8)
    throw new Error("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
}

/** Turns sign-in service messages into Arabic for staff. */
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

/** Public: whether the very first owner account still has to be created. */
export const getSetupStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { setupStatus } = await import("./users.server");
  return setupStatus();
});

/** Public, but only works while no owner account exists yet. */
export const createFirstAdmin = createServerFn({ method: "POST" })
  .validator((i: { username: string; fullName: string; password: string }) => {
    checkStaffInput({ ...i, role: "admin" });
    return i;
  })
  .handler(async ({ data }) => {
    const { createFirstAdmin: create } = await import("./users.server");
    create(data);
    return { ok: true };
  });

export const listStaff = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<StaffRow[]> => {
    const { listStaff: list } = await import("./users.server");
    return list(context.me);
  });

export const createStaff = createServerFn({ method: "POST" })
  .middleware([requireAuth])
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
      return {
        ...i,
        permissions: cleanPermissions(i.permissions),
        controls: cleanControls(i.controls),
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { createStaff: create } = await import("./users.server");
    create(context.me, data);
    return { ok: true };
  });

export const updateStaff = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator(
    (i: { id: string; fullName: string; role: Role; active: boolean; controls?: unknown }) => {
      checkStaffInput(i);
      return { ...i, controls: cleanControls(i.controls) };
    },
  )
  .handler(async ({ data, context }) => {
    const { updateStaff: update } = await import("./users.server");
    update(context.me, data);
    return { ok: true };
  });

export const setStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((i: { id: string; password: string }) => {
    if (!i.password || i.password.length < 8) throw new Error("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { setStaffPassword: set } = await import("./users.server");
    set(context.me, data);
    return { ok: true };
  });

export const deleteStaff = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const { deleteStaff: remove } = await import("./users.server");
    remove(context.me, data.id);
    return { ok: true };
  });

/** The director sets which sections a staff member can see or change (null = role defaults). */
export const setStaffPermissions = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .validator((i: { id: string; permissions: unknown }) => {
    if (!i || typeof i.id !== "string") throw new Error("بيانات غير صحيحة.");
    return { id: i.id, permissions: cleanPermissions(i.permissions) };
  })
  .handler(async ({ data, context }) => {
    const { setStaffPermissions: set } = await import("./users.server");
    set(context.me, data.id, data.permissions);
    return { ok: true };
  });
