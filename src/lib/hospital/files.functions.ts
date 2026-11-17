/**
 * Private files (national ID photos, signed contracts, signatures, patient attachments).
 * Bytes live under `data/files`; metadata in `stored_files`. Only these functions and the
 * session-checked upload/download routes touch them.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";
import type { StoredFile } from "./files.server";

export type { StoredFile };

const MAX_BYTES = 15 * 1024 * 1024;
const MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
const OwnerKind = z.enum(["employee", "patient"]);
const safeId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const createFileUpload = createServerFn({ method: "POST" })
  .middleware([requireAuth])
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
    const { createUpload } = await import("./files.server");
    return createUpload(context.me, data);
  });

export const confirmFileUpload = createServerFn({ method: "POST" })
  .middleware([requireAuth])
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
        replace: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { confirmUpload } = await import("./files.server");
    return confirmUpload(context.me, data);
  });

export const listFiles = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ ownerKind: OwnerKind, ownerId: safeId }).parse(d))
  .handler(async ({ data, context }): Promise<StoredFile[]> => {
    const { list } = await import("./files.server");
    return list(context.me, data);
  });

export const deleteStoredFile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { remove } = await import("./files.server");
    remove(context.me, data.id);
    return { ok: true };
  });
