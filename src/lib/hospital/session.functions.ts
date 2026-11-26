import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequestProtocol, setCookie } from "@tanstack/react-start/server";
import type { Me } from "./me";
import { normalizeUsername } from "./staff";

interface Attempt {
  count: number;
  until: number;
}
const attempts = new Map<string, Attempt>();
const MAX_ATTEMPTS = 8;
const LOCK_MS = 5 * 60 * 1000;

function checkThrottle(username: string) {
  const a = attempts.get(username);
  if (!a) return;
  if (a.until > Date.now()) {
    const seconds = Math.ceil((a.until - Date.now()) / 1000);
    throw new Error(`محاولات كثيرة — انتظر ${seconds} ثانية ثم حاول مرة أخرى.`);
  }
  attempts.delete(username);
}

function noteFailure(username: string) {
  const a = attempts.get(username);
  const next = { count: (a?.count ?? 0) + 1, until: 0 };
  if (next.count >= MAX_ATTEMPTS) {
    next.until = Date.now() + LOCK_MS;
    next.count = 0;
  }
  attempts.set(username, next);
}

/**
 * Session cookie flags. On the hospital network (plain http://alrahma.local) a Lax cookie is right.
 * Over https the app may be shown inside another site's frame (online preview), where browsers drop
 * Lax cookies after sign-in — so there it is SameSite=None; Secure; Partitioned.
 */
function cookieFlags() {
  const https = getRequestProtocol() === "https";
  return https
    ? ({ path: "/", sameSite: "none", secure: true, partitioned: true } as const)
    : ({ path: "/", sameSite: "lax" } as const);
}

/** Current signed-in staff member, or null. Used at app start and before protected pages. */
export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const { SESSION_COOKIE, userForSession } = await import("./auth.server");
  return { user: userForSession(getCookie(SESSION_COOKIE)) };
});

export const signIn = createServerFn({ method: "POST" })
  .validator((input: { username: string; password: string }) => {
    const username = normalizeUsername(String(input?.username ?? ""));
    const password = String(input?.password ?? "");
    if (!username || !password) throw new Error("اكتب اسم المستخدم وكلمة المرور.");
    if (username.length > 30 || password.length > 200) throw new Error("بيانات الدخول غير صحيحة.");
    return { username, password };
  })
  .handler(async ({ data }): Promise<{ user: Me }> => {
    const { SESSION_COOKIE, SESSION_DAYS, createSession, findProfileByUsername, loadMe, verifyPassword } =
      await import("./auth.server");
    checkThrottle(data.username);
    const profile = findProfileByUsername(data.username);
    if (!profile || !profile.active || !verifyPassword(data.password, profile.password_hash)) {
      noteFailure(data.username);
      throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب موقوف.");
    }
    attempts.delete(data.username);
    const user = loadMe(profile.id);
    const token = createSession(profile.id);
    setCookie(SESSION_COOKIE, token, {
      ...cookieFlags(),
      httpOnly: true,
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return { user };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  const { SESSION_COOKIE, deleteSession } = await import("./auth.server");
  deleteSession(getCookie(SESSION_COOKIE));
  deleteCookie(SESSION_COOKIE, cookieFlags());
  return { ok: true as const };
});
