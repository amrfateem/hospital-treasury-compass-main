/** Staff sign in with a username; the auth account uses a derived internal address. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
export const normalizeUsername = (u: string) => u.trim().toLowerCase();
export const usernameToEmail = (u: string) => `${normalizeUsername(u)}@staff.rahma-hospital.app`;
