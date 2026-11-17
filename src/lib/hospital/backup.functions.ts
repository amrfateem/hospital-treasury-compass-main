import { createServerFn } from "@tanstack/react-start";
import { requireAuth } from "./auth-middleware";

/** Backup status for the director's settings screen. */
export const getBackupInfo = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (context.me.role !== "admin") throw new Error("هذه الصفحة لمدير المستشفى فقط.");
    const { backupStatus } = await import("@/lib/local/backup.server");
    return {
      ...backupStatus(),
      version: process.env["ALRAHMA_VERSION"] || "dev",
      host: process.env["ALRAHMA_HOST"] || "alrahma.local",
      dataDir: process.env["ALRAHMA_DATA_DIR"] || "",
    };
  });

export const backupNow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    if (context.me.role !== "admin") throw new Error("هذه الصفحة لمدير المستشفى فقط.");
    const { runBackup, backupStatus } = await import("@/lib/local/backup.server");
    const result = await runBackup("manual");
    if (result.error) throw new Error(`تعذّر النسخ الاحتياطي: ${result.error}`);
    return backupStatus();
  });
