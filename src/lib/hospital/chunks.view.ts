/** Picks the requested chunks out of an (already filtered) document. Pure. */
import { bucketOf, DATED, HASHED, monthOf, parseKey } from "./chunks";
import type { HospitalDB } from "./model";

const DATED_SET = new Set<string>(DATED);
const HASHED_SET = new Set<string>(HASHED);

export function pickChunks(view: HospitalDB, keys: string[]): Record<string, unknown> {
  const doc = view as unknown as Record<string, unknown>;
  const groups = new Map<string, Map<string, unknown>>();
  const groupOf = (name: string) => {
    let g = groups.get(name);
    if (g) return g;
    g = new Map();
    const value = doc[name];
    if (DATED_SET.has(name) && Array.isArray(value)) {
      for (const item of value) {
        const m = monthOf(item);
        const list = (g.get(m) as unknown[] | undefined) ?? [];
        list.push(item);
        g.set(m, list);
      }
    } else if (HASHED_SET.has(name) && value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        const b = bucketOf(k);
        const part = (g.get(b) as Record<string, unknown> | undefined) ?? {};
        part[k] = v;
        g.set(b, part);
      }
    }
    groups.set(name, g);
    return g;
  };
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const { name, part } = parseKey(key);
    if (part === undefined) out[key] = doc[name] ?? null;
    else out[key] = groupOf(name).get(part) ?? null;
  }
  return out;
}
