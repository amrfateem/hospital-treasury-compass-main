/**
 * Local password recovery for the Al-Rahma server. Run it on the server PC:
 *   node tools/reset-password.mjs --list
 *   node tools/reset-password.mjs --user director --password "new-password"
 *
 * It updates the same scrypt hash format the app uses and clears that user's sessions.
 */
import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dbPath =
  arg("db") ||
  (process.env.ALRAHMA_DATA_DIR
    ? join(process.env.ALRAHMA_DATA_DIR, "hospital.db")
    : resolve("data", "hospital.db"));

if (!existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
const profiles = db.prepare("SELECT id, username, full_name, active FROM profiles ORDER BY username").all();
if (process.argv.includes("--list") || profiles.length === 0) {
  console.log("Users:");
  for (const p of profiles) console.log(`  ${p.username}  (${p.full_name})${p.active ? "" : " [stopped]"}`);
  db.close();
  process.exit(0);
}

const username = String(arg("user") || "").trim().toLowerCase();
const password = String(arg("password") || "");
if (!username || password.length < 8) {
  console.error('Usage: node tools/reset-password.mjs --user director --password "at-least-8-chars"');
  db.close();
  process.exit(1);
}

const profile = db.prepare("SELECT id FROM profiles WHERE username = ?").get(username);
if (!profile) {
  console.error(`User not found: ${username}`);
  db.close();
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const stored = `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
db.prepare("UPDATE profiles SET password_hash = ? WHERE id = ?").run(stored, profile.id);
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(profile.id);
db.close();
console.log(`Password changed for ${username}. Sign in again.`);
