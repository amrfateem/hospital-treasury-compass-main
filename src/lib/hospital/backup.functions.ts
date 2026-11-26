import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "./auth-middleware";

const directorOnly = (role: string) => {
  if (role !== "admin") throw new Error("هذه الصفحة لمدير المستشفى فقط.");
};

/** Backup status for the director's settings screen. */
export const getBackupInfo = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    directorOnly(context.me.role);
    const { backupStatus, backupRunning } = await import("@/lib/local/backup.server");
    const { readBackupConfig, dataDir } = await import("@/lib/local/paths.server");
    const { tmpdir } = await import("node:os");
    const { resolve } = await import("node:path");
    const temp = resolve(tmpdir()).toLowerCase();
    const data = resolve(dataDir()).toLowerCase();
    return {
      ...backupStatus(),
      running: backupRunning(),
      /** The program was opened straight from the ZIP (Windows runs it from a temporary folder), so nothing it saves stays. */
      runningFromTemp: data.startsWith(temp),
      extraDirs: readBackupConfig().extraDirs,
      /** Backups only run in the installed hospital app, not in a development preview. */
      appMode: process.env["ALRAHMA_APP"] === "1",
      version: process.env["ALRAHMA_VERSION"] || "dev",
      host: process.env["ALRAHMA_HOST"] || "alrahma.local",
      dataDir: process.env["ALRAHMA_DATA_DIR"] || "",
    };
  });

export const backupNow = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    directorOnly(context.me.role);
    const { runBackup } = await import("@/lib/local/backup.server");
    const result = await runBackup("manual");
    if (result.error === "busy") throw new Error("نسخة احتياطية شغالة دلوقتي — جرّب بعد دقيقة.");
    if (!result.ok.length) throw new Error(`تعذّر النسخ الاحتياطي: ${result.error ?? ""}`);
    return { saved: result.ok.length, failed: result.failed };
  });

/** The director's extra backup folders (second USB, another disk, network share, cloud folder). */
export const setBackupFolders = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d: { extraDirs: string[] }) => z.object({ extraDirs: z.array(z.string().trim().max(400)).max(5) }).parse(d))
  .handler(async ({ context, data }) => {
    directorOnly(context.me.role);
    const { isAbsolute, join, resolve } = await import("node:path");
    const { mkdirSync, rmSync, writeFileSync } = await import("node:fs");
    const { writeBackupConfig, dataDir } = await import("@/lib/local/paths.server");
    const dirs = [...new Set(data.extraDirs.filter(Boolean))];
    for (const d of dirs) {
      if (!isAbsolute(d)) throw new Error(`«${d}» مش مسار كامل — اكتبه مثل E:\\AlRahmaBackup أو \\\\PC2\\Backup.`);
      if (resolve(d).toLowerCase().startsWith(resolve(dataDir()).toLowerCase()))
        throw new Error("لا تختار مجلد البيانات نفسه كمكان للنسخ.");
      try {
        mkdirSync(d, { recursive: true });
        const probe = join(d, ".alrahma-write-test");
        writeFileSync(probe, "ok");
        rmSync(probe, { force: true });
      } catch {
        throw new Error(`مش قادر أكتب في «${d}» — تأكد إن الفلاشة/الجهاز متوصل وإن المجلد مسموح الكتابة فيه.`);
      }
    }
    writeBackupConfig({ extraDirs: dirs });
    return { extraDirs: dirs };
  });

/** The director confirms they reviewed an automatic data recovery, so the dashboard warning goes away. */
export const acknowledgeRecovery = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    directorOnly(context.me.role);
    const { acknowledgeRecoveries } = await import("@/lib/local/recovery.server");
    return { marked: acknowledgeRecoveries(context.me.name || context.me.username) };
  });
