import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/hospital/auth-middleware";
import { can } from "@/lib/hospital/permissions";

export const getLegacyOverview = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (context.me.role !== "admin") throw new Error("هذه الصفحة لمدير المستشفى فقط.");
    const { legacyOverview } = await import("./legacy-import.server");
    return legacyOverview();
  });

export const getLegacyPatientHistory = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { patientId: string }) => z.object({ patientId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ context, data }) => {
    if (!can(context.me, "patients", "view")) throw new Error("غير مسموح.");
    if (!data.patientId.startsWith("legacy-")) return [];
    const { legacyForPatient } = await import("./legacy-import.server");
    return legacyForPatient(data.patientId);
  });

export const searchLegacyRecords = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { kind: string; q: string }) =>
    z.object({ kind: z.string().regex(/^[a-z_]+$/).max(60), q: z.string().max(100) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (context.me.role !== "admin") throw new Error("هذه الصفحة لمدير المستشفى فقط.");
    const { legacySearch } = await import("./legacy-import.server");
    return legacySearch(data.kind, data.q.trim());
  });

export const getLegacyDetails = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { table: string; id: string }) => z.object({ table: z.string().regex(/^[a-z_]+$/).max(60), id: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ context, data }) => {
    if (context.me.role !== "admin") throw new Error("تفاصيل النقل لمدير المستشفى فقط.");
    const { legacyDetails } = await import("./legacy-import.server");
    return legacyDetails(data.table, data.id);
  });
