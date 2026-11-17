import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          version: process.env["ALRAHMA_VERSION"] || "dev",
          schema: 1,
          host: process.env["ALRAHMA_HOST"] || "alrahma.local",
          at: new Date().toISOString(),
        }),
    },
  },
});
