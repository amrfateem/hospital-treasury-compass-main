import { can, type PermLevel, type Section } from "./permissions";
import { loadMe } from "./sync.functions";

/** Server-side gate for functions that touch tables outside the JSON document. */
export async function requireLevel(
  context: { supabase: Parameters<typeof loadMe>[0]; userId: string },
  section: Section,
  level: PermLevel,
) {
  let me;
  try {
    me = await loadMe(context.supabase, context.userId);
  } catch {
    throw new Error("ليست لديك صلاحية دخول النظام.");
  }
  if (!can(me, section, level)) throw new Error("ليست لديك صلاحية لهذه العملية.");
  return me;
}
