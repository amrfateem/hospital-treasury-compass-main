import { createFileRoute } from "@tanstack/react-router";
import { open, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SESSION_COOKIE, userForSession } from "@/lib/hospital/auth.server";

const MAX_BYTES = 400 * 1024 * 1024;

function cookieToken(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  const part = header.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return part ? decodeURIComponent(part.slice(SESSION_COOKIE.length + 1)) : undefined;
}

/** The director uploads the old system's .sql backup; see legacy-import.server.ts. */
export const Route = createFileRoute("/api/legacy-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const me = userForSession(cookieToken(request));
        if (!me) return new Response("Unauthorized", { status: 401 });
        if (me.role !== "admin") return new Response("هذه العملية لمدير المستشفى فقط.", { status: 403 });
        const origin = request.headers.get("origin");
        if (origin && origin !== new URL(request.url).origin) return new Response("غير مسموح بمصدر الطلب.", { status: 403 });
        const declared = Number(request.headers.get("content-length") || 0);
        if (Number.isFinite(declared) && declared > MAX_BYTES)
          return new Response("حجم الملف أكبر من المسموح.", { status: 413 });
        if (!request.body) return new Response("ملف غير صالح.", { status: 400 });
        const temp = join(tmpdir(), `alrahma-legacy-${randomUUID()}.sql`);
        try {
          const out = await open(temp, "w");
          let size = 0;
          try {
            const reader = request.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value) continue;
              size += value.byteLength;
              if (size > MAX_BYTES) return new Response("حجم الملف أكبر من المسموح.", { status: 413 });
              await out.write(value);
            }
          } finally {
            await out.close();
          }
          if (size < 10) return new Response("حجم الملف غير مقبول.", { status: 413 });
          try {
            const { importLegacyDump } = await import("@/lib/legacy/legacy-import.server");
            const text = await readFile(temp, "utf8");
            const summary = await importLegacyDump(text, me);
            return Response.json({ ok: true, summary });
          } catch (e) {
            return new Response(e instanceof Error ? e.message : "تعذّر قراءة الملف.", { status: 400 });
          }
        } finally {
          await unlink(temp).catch(() => {});
        }
      },
    },
  },
});
