/**
 * Local staff accounts and sessions. Passwords are scrypt hashes; a session is a random
 * token in an HttpOnly cookie, and only its SHA-256 hash is stored in SQLite.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { all, get, run, transaction } from "@/lib/local/db.server";
import type { Role } from "./model";
import { cleanControls, cleanPermissions } from "./permissions";
import { ROLE_RANK, type Me } from "./me";

export const SESSION_COOKIE = "alrahma_session";
export const SESSION_DAYS = 30;
/** A shared reception PC must not stay signed in for the next shift. */
const IDLE_MS = 12 * 60 * 60 * 1000;

export interface ProfileRow {
  id: string;
  username: string;
  full_name: string;
  box_id: string | null;
  active: number;
  permissions: string | null;
  controls: string | null;
  password_hash: string;
  created_at: string;
}

function json<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltText, hashText] = parts;
  try {
    const salt = Buffer.from(saltText!, "base64url");
    const expected = Buffer.from(hashText!, "base64url");
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function roleOf(userId: string): Role | null {
  const list = all<{ role: Role }>("SELECT role FROM user_roles WHERE user_id = ?", userId);
  return ROLE_RANK.find((r) => list.some((x) => x.role === r)) ?? null;
}

export function loadMe(userId: string): Me {
  const profile = get<ProfileRow>("SELECT * FROM profiles WHERE id = ?", userId);
  if (!profile || !profile.active) throw new Error("NO_ACCESS");
  const role = roleOf(userId);
  if (!role) throw new Error("NO_ACCESS");
  return {
    id: userId,
    username: profile.username,
    name: profile.full_name || profile.username,
    role,
    boxId: profile.box_id,
    perms: role === "admin" ? null : cleanPermissions(json(profile.permissions)),
    controls: role === "admin" ? null : cleanControls(json(profile.controls)),
  };
}

export function findProfileByUsername(username: string): ProfileRow | undefined {
  return get<ProfileRow>("SELECT * FROM profiles WHERE username = ?", username);
}

export function countAdmins(): number {
  // Every owner account (active or stopped) counts: a stopped account must never reopen
  // the one-time setup form for anyone else on the network.
  const row = get<{ n: number }>("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin'");
  return Number(row?.n ?? 0);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  run("DELETE FROM sessions WHERE expires_at < ?", now);
  run(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
    tokenHash(token),
    userId,
    now,
    now + SESSION_DAYS * 86400000,
    now,
  );
  return token;
}

/** Returns the signed-in staff member for a token, or null. */
export function userForSession(token: string | undefined | null): Me | null {
  if (!token) return null;
  const hash = tokenHash(token);
  const row = get<{ user_id: string; expires_at: number; last_seen_at: number; active: number }>(
    `SELECT s.user_id, s.expires_at, s.last_seen_at, p.active
       FROM sessions s JOIN profiles p ON p.id = s.user_id
      WHERE s.token_hash = ?`,
    hash,
  );
  if (!row || !row.active) return null;
  if (row.expires_at < Date.now()) {
    run("DELETE FROM sessions WHERE token_hash = ?", hash);
    return null;
  }
  if (Date.now() - row.last_seen_at > IDLE_MS) {
    run("DELETE FROM sessions WHERE token_hash = ?", hash);
    return null;
  }
  if (Date.now() - row.last_seen_at > 5 * 60 * 1000) {
    run("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", Date.now(), hash);
  }
  try {
    return loadMe(row.user_id);
  } catch {
    return null;
  }
}

export function deleteSession(token: string | undefined | null): void {
  if (!token) return;
  run("DELETE FROM sessions WHERE token_hash = ?", tokenHash(token));
}

export function deleteUserSessions(userId: string): void {
  run("DELETE FROM sessions WHERE user_id = ?", userId);
}

export interface NewAccount {
  id: string;
  username: string;
  fullName: string;
  passwordHash: string;
  role: Role;
  permissions: string | null;
  controls: string | null;
}

export function insertAccount(account: NewAccount): void {
  transaction(() => {
    // One owner per installation. This check sits inside the write lock so two setup
    // requests racing from different devices cannot both create an admin account.
    if (account.role === "admin") {
      const existing = get<{ n: number }>("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin'");
      if (Number(existing?.n ?? 0) > 0)
        throw new Error("يوجد حساب مدير بالفعل — لا يمكن إنشاء أكثر من حساب مدير واحد.");
    }
    run(
      `INSERT INTO profiles (id, username, full_name, box_id, active, permissions, controls, password_hash, created_at)
       VALUES (?, ?, ?, NULL, 1, ?, ?, ?, ?)`,
      account.id,
      account.username,
      account.fullName,
      account.permissions,
      account.controls,
      account.passwordHash,
      new Date().toISOString(),
    );
    run("INSERT INTO user_roles (user_id, role) VALUES (?, ?)", account.id, account.role);
  });
}
