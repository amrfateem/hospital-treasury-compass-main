/**
 * Packaged-runtime startup: SQLite schema, mDNS name and background jobs. Dev keeps using
 * the Vite server without these.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

let started = false;
let stopMdns: (() => void) | null = null;

export async function initRuntime() {
  if (started) return;
  started = true;
  const { dataDir, db } = await import("./db.server");
  mkdirSync(join(dataDir(), "logs"), { recursive: true });
  mkdirSync(join(dataDir(), "files"), { recursive: true });
  db();

  const port = Number(process.env["PORT"] || 80);
  const host = process.env["ALRAHMA_HOST"] || "alrahma.local";
  if (process.env["ALRAHMA_MDNS"] !== "0") {
    try {
      const { Bonjour } = await import("bonjour-service");
      const bonjour = new Bonjour();
      bonjour.publish({ name: "AlRahma Hospital", type: "http", port, host });
      stopMdns = () => bonjour.destroy();
      console.log(`[alrahma] advertising http://${host} on port ${port}`);
    } catch (e) {
      console.error("[alrahma] mDNS failed", e);
    }
  }
  const { startBackups } = await import("./backup.server");
  await startBackups();

  const shutdown = () => {
    stopMdns?.();
    stopMdns = null;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", shutdown);
}
