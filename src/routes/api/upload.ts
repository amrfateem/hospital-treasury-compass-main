import { createFileRoute } from "@tanstack/react-router";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { get, run, filesDir } from "@/lib/local/db.server";
import { SESSION_COOKIE, userForSession } from "@/lib/hospital/auth.server";
import { can, type Section } from "@/lib/hospital/permissions";

const MAX_BYTES = 15 * 1024 * 1024;
const MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

function cookieToken(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  const part = header.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return part ? decodeURIComponent(part.slice(SESSION_COOKIE.length + 1)) : undefined;
}

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const me = userForSession(cookieToken(request));
        if (!me) return new Response("Unauthorized", { status: 401 });
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const row = get<{ path: string; user_id: string; expires_at: number }>(
          "SELECT path, user_id, expires_at FROM upload_tokens WHERE token = ?",
          token,
        );
        if (!row || row.user_id !== me.id || row.expires_at < Date.now())
          return new Response("Upload expired", { status: 401 });
        const [kind, ownerId] = row.path.split("/");
        const section: Section = kind === "employee" ? "hr" : "patients";
        if (!ownerId || !can(me, section, "add")) return new Response("Forbidden", { status: 403 });
        const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim();
        if (!MIME.includes(type)) return new Response("Unsupported type", { status: 415 });
        const bytes = Buffer.from(await request.arrayBuffer());
        if (bytes.length < 1 || bytes.length > MAX_BYTES)
          return new Response("Bad size", { status: 413 });
        const full = join(filesDir(), row.path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, bytes);
        run("DELETE FROM upload_tokens WHERE token = ?", token);
        return Response.json({ ok: true, path: row.path, size: bytes.length });
      },
    },
  },
});
