/**
 * Server entry for the packaged app. When tls/server.crt and tls/server.key exist, Nitro starts
 * HTTPS on 443, and a tiny HTTP listener on 80 redirects older clients to https.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const serverDir = dirname(fileURLToPath(import.meta.url));
const tlsDir = join(serverDir, "..", "tls");
const certPath = join(tlsDir, "server.crt");
const keyPath = join(tlsDir, "server.key");

if (existsSync(certPath) && existsSync(keyPath)) {
  process.env["NITRO_SSL_CERT"] = readFileSync(certPath, "utf8");
  process.env["NITRO_SSL_KEY"] = readFileSync(keyPath, "utf8");
  process.env["PORT"] = process.env["PORT"] || "443";
  const redirect = createServer((req, res) => {
    const host = (req.headers.host || "alrahma.local").split(":")[0];
    res.writeHead(301, { Location: `https://${host}${req.url || "/"}` });
    res.end();
  });
  redirect.on("error", () => {});
  redirect.listen(80);
}

await import("./index.mjs");
