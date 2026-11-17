/** The signed-in person's id, kept on the device only so its cached copy can be opened at once. */
const KEY = "rahma-current-user";

export function getCurrentUserId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setCurrentUserId(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
