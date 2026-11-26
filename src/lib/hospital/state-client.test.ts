import { afterEach, expect, it, vi } from "vitest";
import { getHospitalChanges, getHospitalState } from "./state-client";
import { emptyDB } from "./model";

afterEach(() => vi.unstubAllGlobals());
it("loads large state through authenticated JSON without a serializer size ceiling", async () => {
  const db = emptyDB();
  db.settings.address = "x".repeat(17_000_000);
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, version: 9, me: { id: "test", role: "admin" }, db }), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await getHospitalState();
  expect(result.db.settings.address.length).toBe(17_000_000);
  expect(result.version).toBe(9);
  expect(fetchMock).toHaveBeenCalledWith("/api/hospital-state", expect.objectContaining({ credentials: "include", method: "POST" }));
});
it("requests only changed chunks using the device's saved version", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, full: false, version: 10, me: { id: "test", role: "admin" }, chunks: { "transactions@2026-11": [] } })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await getHospitalChanges({ data: { since: 9 } });
  expect(fetchMock).toHaveBeenCalledWith("/api/hospital-state", expect.objectContaining({ body: '{"since":9}', credentials: "include" }));
  expect(result.full).toBe(false);
  if (result.full) throw new Error("expected changed chunks");
  expect(result.chunks).toEqual({ "transactions@2026-11": [] });
});
it("rejects an expired session rather than treating it as saved state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })));
  await expect(getHospitalState()).rejects.toThrow();
});