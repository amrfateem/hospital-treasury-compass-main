/**
 * Daily restore points (director only). For every piece of the hospital document, the first
 * change of each day keeps how it looked at the start of that day. Restoring rewrites the
 * pieces to the start of a chosen day; the permanent audit log is kept.
 */
import { createServerFn } from "@tanstack/react-start";
import { all, cairoDay, get, run, transaction } from "@/lib/local/db.server";
import { requireAuth } from "./auth-middleware";

function requireDirector(role: string) {
  if (role !== "admin") throw new Error("نقاط الاستعادة متاحة لمدير المستشفى فقط.");
}

export interface RestoreDay {
  day: string;
  pieces: number;
  firstSaved: string;
}

export const listRestoreDays = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }): Promise<RestoreDay[]> => {
    requireDirector(context.me.role);
    return all<{ day: string; pieces: number; first_saved: string }>(
      `SELECT day, COUNT(*) AS pieces, MIN(saved_at) AS first_saved
         FROM restore_points GROUP BY day ORDER BY day DESC LIMIT 400`,
    ).map((r) => ({ day: r.day, pieces: Number(r.pieces), firstSaved: r.first_saved }));
  });

function validDay(s: unknown): string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("تاريخ غير صحيح.");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new Error("تاريخ غير صحيح.");
  return s;
}

export const restoreToDay = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { day: string }) => ({ day: validDay(d?.day) }))
  .handler(async ({ data, context }) => {
    requireDirector(context.me.role);
    const version = transaction(() => {
      const old = get<{ value: string }>("SELECT value FROM meta WHERE key = 'version'");
      const next = Number(old?.value ?? 0) + 1;
      const cutoff = cairoDay(new Date(Date.now() - 366 * 86400000));
      run("DELETE FROM restore_points WHERE day < ?", cutoff);

      const firsts = all<{ key: string; data: string | null }>(
        `SELECT r.key, r.data
           FROM restore_points r
           JOIN (SELECT key, MIN(day) AS day FROM restore_points WHERE day >= ? GROUP BY key) f
             ON f.key = r.key AND f.day = r.day`,
        data.day,
      );
      const now = new Date().toISOString();
      for (const f of firsts) {
        run("UPDATE chunks SET data = ?, version = ?, updated_at = ? WHERE key = ?", f.data, next, now, f.key);
      }
      run(
        `INSERT INTO audit_log (id, at, by_name, by_id, role, op, section, summary, version)
         VALUES (?, ?, ?, ?, 'admin', 'restoreToDay', 'settings', ?, ?)`,
        `restore-${Date.now()}-${context.userId}`,
        Date.now(),
        context.me.name,
        context.userId,
        `استعادة النظام إلى بداية يوم ${data.day}`,
        next,
      );
      run("UPDATE meta SET value = ? WHERE key = 'version'", String(next));
      return next;
    });
    const { resetStateCache } = await import("./state.server");
    resetStateCache();
    return { ok: true as const, version };
  });
