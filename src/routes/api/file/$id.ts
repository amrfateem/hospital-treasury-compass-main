import { createFileRoute } from "@tanstack/react-router";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { get, filesDir } from "@/lib/local/db.server";
import { SESSION_COOKIE, userForSession } from "@/lib/hospital/auth.server";
import { can, type Section } from "@/lib/hospital/permissions";

function cookieToken(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  const part = header.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return part ? decodeURIComponent(part.slice(SESSION_COOKIE.length + 1)) : undefined;
}

export const Route = createFileRoute("/api/file/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const me = userForSession(cookieToken(request));
        if (!me) return new Response("Unauthorized", { status: 401 });
        const row = get<{
          path: string;
          owner_kind: "employee" | "patient";
          file_name: string;
          mime_type: string;
        }>("SELECT path, owner_kind, file_name, mime_type FROM stored_files WHERE id = ?", params.id);
        if (!row) return new Response("Not found", { status: 404 });
        const section: Section = row.owner_kind === "employee" ? "hr" : "patients";
        if (!can(me, section, "view")) return new Response("Forbidden", { status: 403 });
        let bytes: Buffer;
        try {
          bytes = readFileSync(join(filesDir(), row.path));
        } catch {
          return new Response("Not found", { status: 404 });
        }
        return new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": row.mime_type || "application/octet-stream",
            "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.file_name || "file")}`,
            "cache-control": "private, max-age=300",
          },
        });
      },
    },
  },
});
