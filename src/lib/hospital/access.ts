import { can, type PermLevel, type Section } from "./permissions";
import type { Me } from "./me";

/** Server-side gate for functions that touch tables outside the JSON document. */
export async function requireLevel(
  context: { me: Me },
  section: Section,
  level: PermLevel,
): Promise<Me> {
  if (!can(context.me, section, level)) throw new Error("ليست لديك صلاحية لهذه العملية.");
  return context.me;
}
