/** Large, chunked state uses authenticated JSON, avoiding the RPC serializer's size ceiling. */
import type { Me } from "./me";
import type { HospitalDB } from "./model";

interface Base { ok: true; me: Me; version: number }
type State = Base & { db: HospitalDB };
type Changes = Base & ({ full: true } | { full: false; chunks: Record<string, unknown> });

async function request<T>(input: { since?: number } = {}): Promise<T> {
  const response = await fetch("/api/hospital-state", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(response.status === 401 ? "انتهت جلسة الدخول." : "تعذر تحميل بيانات المستشفى.");
  return response.json() as Promise<T>;
}
export const getHospitalState = () => request<State>();
export const getHospitalChanges = (input: { data: { since: number } }) => request<Changes>(input.data);