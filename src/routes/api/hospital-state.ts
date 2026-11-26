import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/hospital-state")({
  server: { handlers: {
    POST: async ({ request }) => {
      const { SESSION_COOKIE, userForSession } = await import("@/lib/hospital/auth.server");
      const part = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      const me = userForSession(part ? decodeURIComponent(part.slice(SESSION_COOKIE.length + 1)) : undefined);
      if (!me) return new Response("Unauthorized", { status: 401 });
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) return new Response("Forbidden", { status: 403 });
      let input: { since?: number };
      try { input = await request.json() as { since?: number }; }
      catch { return new Response("Bad request", { status: 400 }); }
      if (!input || typeof input !== "object" || (input.since !== undefined && (!Number.isSafeInteger(input.since) || input.since < 0))) return new Response("Bad version", { status: 400 });
      const [{ readState, changedKeysSince }, { viewFor }, { pickChunks }] = await Promise.all([
        import("@/lib/hospital/state.server"), import("@/lib/hospital/ops"), import("@/lib/hospital/chunks.view"),
      ]);
      const { db, version } = await readState();
      const headers = { "Cache-Control": "no-store", "Vary": "Cookie" };
      if (input.since === undefined) return Response.json({ ok: true, me, version, db: viewFor(db, me) }, { headers });
      if (input.since === version) return Response.json({ ok: true, full: false, me, version, chunks: {} }, { headers });
      if (input.since > version) return Response.json({ ok: true, full: true, me, version }, { headers });
      const keys = await changedKeysSince(input.since);
      if (!keys) return Response.json({ ok: true, full: true, me, version }, { headers });
      return Response.json({ ok: true, full: false, me, version, chunks: pickChunks(viewFor(db, me), keys) }, { headers });
    },
  } },
});