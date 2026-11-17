/**
 * Private files (national ID photos, signed contracts, signatures, patient attachments).
 * Files live in the private "private-files" bucket and their metadata in `stored_files`;
 * both are reachable only through these functions, which check the caller's section first.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Section } from "./permissions";
import { requireLevel } from "./access";

const BUCKET = "private-files";
const MAX_BYTES = 15 * 1024 * 1024;
const MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
const EXT: Record<(typeof MIME)[number], string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const OwnerKind = z.enum(["employee", "patient"]);
type OwnerKind = z.infer<typeof OwnerKind>;
const SECTION: Record<OwnerKind, Section> = { employee: "hr", patient: "patients" };
const safeId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export interface StoredFile {
  id: string;
  ownerKind: OwnerKind;
  ownerId: string;
  kind: string;
  refId: string | null;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  url: string | null;
}

export const createFileUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ownerKind: OwnerKind,
        ownerId: safeId,
        mimeType: z.enum(MIME),
        size: z.number().int().positive().max(MAX_BYTES),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireLevel(context, SECTION[data.ownerKind], "add");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${data.ownerKind}/${data.ownerId}/${crypto.randomUUID()}.${EXT[data.mimeType]}`;
    const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !signed) throw new Error("تعذر تجهيز رفع الملف.");
    return { path, token: signed.token };
  });

export const confirmFileUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        ownerKind: OwnerKind,
        ownerId: safeId,
        kind: z.string().min(1).max(40),
        refId: z.string().max(64).nullable(),
        path: z.string().max(200),
        fileName: z.string().max(160),
        mimeType: z.enum(MIME),
        size: z.number().int().positive().max(MAX_BYTES),
        /** Replace earlier files of the same kind (e.g. a new ID card photo). */
        replace: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireLevel(context, SECTION[data.ownerKind], "add");
    if (!data.path.startsWith(`${data.ownerKind}/${data.ownerId}/`)) throw new Error("مسار ملف غير صحيح.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const folder = `${data.ownerKind}/${data.ownerId}`;
    const name = data.path.slice(folder.length + 1);
    const { data: listed } = await supabaseAdmin.storage.from(BUCKET).list(folder, { search: name });
    if (!listed?.some((o) => o.name === name)) throw new Error("لم يكتمل رفع الملف.");
    if (data.replace) {
      let q = supabaseAdmin
        .from("stored_files")
        .select("id, path")
        .eq("owner_kind", data.ownerKind)
        .eq("owner_id", data.ownerId)
        .eq("kind", data.kind);
      q = data.refId ? q.eq("ref_id", data.refId) : q.is("ref_id", null);
      const { data: old } = await q;
      if (old?.length) {
        await supabaseAdmin.storage.from(BUCKET).remove(old.map((o) => o.path));
        await supabaseAdmin.from("stored_files").delete().in("id", old.map((o) => o.id));
      }
    }
    const { data: row, error } = await supabaseAdmin
      .from("stored_files")
      .insert({
        owner_kind: data.ownerKind,
        owner_id: data.ownerId,
        kind: data.kind,
        ref_id: data.refId,
        path: data.path,
        file_name: data.fileName,
        mime_type: data.mimeType,
        size_bytes: data.size,
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error("تعذر حفظ بيانات الملف.");
    return { id: row.id };
  });

export const listFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ownerKind: OwnerKind, ownerId: safeId }).parse(d))
  .handler(async ({ data, context }): Promise<StoredFile[]> => {
    await requireLevel(context, SECTION[data.ownerKind], "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("stored_files")
      .select("*")
      .eq("owner_kind", data.ownerKind)
      .eq("owner_id", data.ownerId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("تعذر تحميل الملفات.");
    if (!rows.length) return [];
    const { data: urls } = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600);
    return rows.map((r) => ({
      id: r.id,
      ownerKind: r.owner_kind as OwnerKind,
      ownerId: r.owner_id,
      kind: r.kind,
      refId: r.ref_id,
      fileName: r.file_name,
      mimeType: r.mime_type,
      size: Number(r.size_bytes),
      createdAt: r.created_at,
      url: urls?.find((u) => u.path === r.path)?.signedUrl ?? null,
    }));
  });

export const deleteStoredFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin.from("stored_files").select("*").eq("id", data.id).maybeSingle();
    if (!row) return { ok: true };
    await requireLevel(context, SECTION[row.owner_kind as OwnerKind], "edit");
    await supabaseAdmin.storage.from(BUCKET).remove([row.path]);
    await supabaseAdmin.from("stored_files").delete().eq("id", row.id);
    return { ok: true };
  });
