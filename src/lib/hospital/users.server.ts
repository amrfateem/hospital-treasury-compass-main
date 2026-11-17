import { all, get, run, transaction } from "@/lib/local/db.server";
import {
  countAdmins,
  deleteUserSessions,
  findProfileByUsername,
  hashPassword,
  insertAccount,
} from "./auth.server";
import type { Me } from "./me";
import type { Role } from "./model";
import {
  ROLES,
  cleanControls,
  cleanPermissions,
  type Permissions,
  type StaffControls,
} from "./permissions";
import { normalizeUsername } from "./staff";

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

export function requireAdmin(me: Me) {
  if (me.role !== "admin") throw new Error("هذه الصفحة لمدير المستشفى فقط.");
}

export function setupStatus() {
  return { needsSetup: countAdmins() === 0 };
}

export function createFirstAdmin(i: { username: string; fullName: string; password: string }) {
  if (countAdmins() > 0) throw new Error("تم إعداد حساب المدير بالفعل. سجّل الدخول.");
  createAccount({ ...i, role: "admin" });
}

function createAccount(i: {
  username: string;
  fullName: string;
  password: string;
  role: Role;
  permissions?: Permissions | null;
  controls?: StaffControls | null;
}) {
  const username = normalizeUsername(i.username);
  if (findProfileByUsername(username)) throw new Error("اسم المستخدم مستخدم بالفعل.");
  const id = crypto.randomUUID();
  insertAccount({
    id,
    username,
    fullName: i.fullName.trim(),
    passwordHash: hashPassword(i.password),
    role: i.role,
    permissions:
      i.role === "admin" || !i.permissions ? null : JSON.stringify(cleanPermissions(i.permissions)),
    controls: i.role === "admin" || !i.controls ? null : JSON.stringify(cleanControls(i.controls)),
  });
  return id;
}

export function listStaff(me: Me): StaffRow[] {
  requireAdmin(me);
  const profiles = all<{
    id: string;
    username: string;
    full_name: string;
    active: number;
    permissions: string | null;
    controls: string | null;
    created_at: string;
  }>("SELECT id, username, full_name, active, permissions, controls, created_at FROM profiles ORDER BY created_at");
  const roles = all<{ user_id: string; role: Role }>("SELECT user_id, role FROM user_roles");
  return profiles.map((p) => {
    let permissions: unknown = null;
    let controls: unknown = null;
    try {
      permissions = p.permissions ? JSON.parse(p.permissions) : null;
    } catch {
      permissions = null;
    }
    try {
      controls = p.controls ? JSON.parse(p.controls) : null;
    } catch {
      controls = null;
    }
    return {
      id: p.id,
      username: p.username,
      fullName: p.full_name,
      role: ROLES.find((r) => roles.some((x) => x.user_id === p.id && x.role === r)) ?? null,
      active: !!p.active,
      createdAt: p.created_at,
      permissions: cleanPermissions(permissions),
      controls: cleanControls(controls),
    };
  });
}

export function createStaff(
  me: Me,
  data: {
    username: string;
    fullName: string;
    password: string;
    role: Role;
    permissions?: Permissions | null;
    controls?: StaffControls | null;
  },
) {
  requireAdmin(me);
  createAccount(data);
}

export function updateStaff(
  me: Me,
  data: { id: string; fullName: string; role: Role; active: boolean; controls?: StaffControls | null },
) {
  requireAdmin(me);
  if (data.id === me.id && (data.role !== "admin" || !data.active))
    throw new Error("لا يمكنك إلغاء صلاحية المدير أو إيقاف حسابك أنت.");
  if (!get("SELECT id FROM profiles WHERE id = ?", data.id)) throw new Error("الحساب غير موجود.");
  transaction(() => {
    run(
      "UPDATE profiles SET full_name = ?, box_id = NULL, active = ?, controls = ? WHERE id = ?",
      data.fullName.trim(),
      data.active ? 1 : 0,
      data.role === "admin" || !data.controls ? null : JSON.stringify(data.controls),
      data.id,
    );
    run("DELETE FROM user_roles WHERE user_id = ?", data.id);
    run("INSERT INTO user_roles (user_id, role) VALUES (?, ?)", data.id, data.role);
    if (!data.active) run("DELETE FROM sessions WHERE user_id = ?", data.id);
  });
}

export function setStaffPassword(me: Me, data: { id: string; password: string }) {
  requireAdmin(me);
  if (!get("SELECT id FROM profiles WHERE id = ?", data.id)) throw new Error("الحساب غير موجود.");
  run("UPDATE profiles SET password_hash = ? WHERE id = ?", hashPassword(data.password), data.id);
  deleteUserSessions(data.id);
}

export function deleteStaff(me: Me, id: string) {
  requireAdmin(me);
  if (id === me.id) throw new Error("لا يمكنك حذف حسابك أنت.");
  run("DELETE FROM profiles WHERE id = ?", id);
}

export function setStaffPermissions(me: Me, id: string, permissions: Permissions | null) {
  requireAdmin(me);
  if (id === me.id) throw new Error("صلاحيات مدير المستشفى كاملة ولا تُعدَّل.");
  run(
    "UPDATE profiles SET permissions = ? WHERE id = ?",
    permissions ? JSON.stringify(permissions) : null,
    id,
  );
}
