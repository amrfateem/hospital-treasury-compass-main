import type { Actor, Role } from "./model";
import { ROLES } from "./permissions";

/** The signed-in staff member, as the server sees them. */
export interface Me extends Actor {
  username: string;
}

/** With several roles the strongest wins (director first). */
export const ROLE_RANK: Role[] = ROLES;
