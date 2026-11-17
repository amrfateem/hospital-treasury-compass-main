import { createMiddleware } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

/** Every protected server function runs through this: the cookie must be a live session. */
export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { SESSION_COOKIE, userForSession } = await import("./auth.server");
  const me = userForSession(getCookie(SESSION_COOKIE));
  if (!me) throw new Error("Unauthorized");
  return next({ context: { me, userId: me.id } });
});
