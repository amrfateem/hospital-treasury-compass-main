import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { all, filesDir, get, run } from "@/lib/local/db.server";
import { requireLevel } from "./access";
import type { Me } from "./me";
import type { Section } from "./permissions";

type OwnerKind = "employee" | "patient";
const SECTION: Record<OwnerKind, Section> = { employee: "hr", patient: "patients" };

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

export function createUpload(me: Me, data: { ownerKind: OwnerKind; ownerId: string }) {
  requireLevel({ me }, SECTION[data.ownerKind], "add");
  const path = `${data.ownerKind}/${data.ownerId}/${randomUUID()}`;
  const token = randomBytes(24).toString("base64url");
  run(
    "INSERT INTO upload_tokens (token, path, user_id, expires_at) VALUES (?, ?, ?, ?)",
    token,
    path,
    me.id,
    Date.now() + 10 * 60 * 1000,
  );
  return { path, token };
}

export function confirmUpload(
  me: Me,
  data: {
    ownerKind: OwnerKind;
    ownerId: string;
    kind: string;
    refId: string | null;
    path: string;
    fileName: string;
    mimeType: string;
    size: number;
    replace: boolean;
  },
) {
  requireLevel({ me }, SECTION[data.ownerKind], "add");
  if (!data.path.startsWith(`${data.ownerKind}/${data.ownerId}/`)) throw new Error("مسار ملف غير صحيح.");
  const full = join(filesDir(), data.path);
  if (!existsSync(full) || statSync(full).size < 1) throw new Error("لم يكتمل رفع الملف.");
  if (data.replace) {
    const old = data.refId
      ? all<{ id: string; path: string }>(
          "SELECT id, path FROM stored_files WHERE owner_kind = ? AND owner_id = ? AND kind = ? AND ref_id = ?",
          data.ownerKind,
          data.ownerId,
          data.kind,
          data.refId,
        )
      : all<{ id: string; path: string }>(
          "SELECT id, path FROM stored_files WHERE owner_kind = ? AND owner_id = ? AND kind = ? AND ref_id IS NULL",
          data.ownerKind,
          data.ownerId,
          data.kind,
        );
    for (const f of old) {
      try {
        unlinkSync(join(filesDir(), f.path));
      } catch {
        /* missing */
      }
      run("DELETE FROM stored_files WHERE id = ?", f.id);
    }
  }
  const id = randomUUID();
  run(
    `INSERT INTO stored_files (id, owner_kind, owner_id, kind, ref_id, path, file_name, mime_type, size_bytes, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    data.ownerKind,
    data.ownerId,
    data.kind,
    data.refId,
    data.path,
    data.fileName,
    data.mimeType,
    data.size,
    me.id,
    new Date().toISOString(),
  );
  return { id };
}

export function list(me: Me, data: { ownerKind: OwnerKind; ownerId: string }): StoredFile[] {
  requireLevel({ me }, SECTION[data.ownerKind], "view");
  const rows = all<{
    id: string;
    owner_kind: OwnerKind;
    owner_id: string;
    kind: string;
    ref_id: string | null;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
  }>(
    "SELECT * FROM stored_files WHERE owner_kind = ? AND owner_id = ? ORDER BY created_at DESC",
    data.ownerKind,
    data.ownerId,
  );
  return rows.map((r) => ({
    id: r.id,
    ownerKind: r.owner_kind,
    ownerId: r.owner_id,
    kind: r.kind,
    refId: r.ref_id,
    fileName: r.file_name,
    mimeType: r.mime_type,
    size: Number(r.size_bytes),
    createdAt: r.created_at,
    url: `/api/file/${r.id}`,
  }));
}

export function remove(me: Me, id: string) {
  const row = get<{ path: string; owner_kind: OwnerKind }>(
    "SELECT path, owner_kind FROM stored_files WHERE id = ?",
    id,
  );
  if (!row) return;
  requireLevel({ me }, SECTION[row.owner_kind], "edit");
  try {
    unlinkSync(join(filesDir(), row.path));
  } catch {
    /* missing */
  }
  run("DELETE FROM stored_files WHERE id = ?", id);
}
