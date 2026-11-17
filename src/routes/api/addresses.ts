import { createFileRoute } from "@tanstack/react-router";

/**
 * Addresses other PCs can use to reach this server. The handler runs on the server,
 * so the LAN IPs are the server's own, not the browser's (clients call it through the server).
 */
export const Route = createFileRoute("/api/addresses")({
  server: {
    handlers: {
      GET: async () => {
        const os = await import("node:os");
        const host = process.env["ALRAHMA_HOST"] || "alrahma.local";
        const port = Number(process.env["PORT"] || 80);
        const suffix = port === 80 ? "" : `:${port}`;
        const ips = Object.values(os.networkInterfaces())
          .flat()
          .filter((iface) => iface?.family === "IPv4" && !iface.internal)
          .map((iface) => iface!.address);
        return Response.json({
          host,
          port,
          urls: [`http://${host}${suffix}`, ...ips.map((ip) => `http://${ip}${suffix}`)],
        });
      },
    },
  },
});
