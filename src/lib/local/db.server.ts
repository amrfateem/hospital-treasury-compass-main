/**
 * Local SQLite database (node:sqlite). One file on the USB drive, no server install.
 * Every server function talks to this module; the browser never opens it.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('version', '0');

CREATE TABLE IF NOT EXISTS chunks (
  key TEXT PRIMARY KEY,
  data TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_version_idx ON chunks (version);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  by_name TEXT NOT NULL DEFAULT '',
  by_id TEXT,
  role TEXT NOT NULL DEFAULT '',
  op TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC);

CREATE TABLE IF NOT EXISTS restore_points (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  data TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (day, key)
);
CREATE INDEX IF NOT EXISTS restore_points_day_idx ON restore_points (day DESC);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  box_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  permissions TEXT,
  controls TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS upload_tokens (
  token TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stored_files (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('employee','patient')),
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT,
  path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stored_files_owner_idx ON stored_files (owner_kind, owner_id);
CREATE INDEX IF NOT EXISTS stored_files_ref_idx ON stored_files (owner_kind, owner_id, kind, ref_id);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  mrn TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  national_id TEXT,
  birth_date TEXT,
  gender TEXT CHECK (gender IN ('male','female')),
  phone TEXT,
  address TEXT,
  blood_type TEXT,
  allergies TEXT,
  chronic_conditions TEXT,
  emergency_contact TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS patients_name_idx ON patients (full_name);
CREATE INDEX IF NOT EXISTS patients_phone_idx ON patients (phone);
CREATE INDEX IF NOT EXISTS patients_nid_idx ON patients (national_id);
CREATE INDEX IF NOT EXISTS patients_created_idx ON patients (created_at DESC);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  doctor_id TEXT,
  department TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'booked',
  reason TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS appointments_time_idx ON appointments (starts_at);
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id);

CREATE TABLE IF NOT EXISTS medical_visits (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  doctor_id TEXT,
  complaint TEXT,
  diagnosis TEXT,
  prescription TEXT,
  notes TEXT,
  vitals TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS medical_visits_patient_idx ON medical_visits (patient_id, visit_date DESC);

CREATE TABLE IF NOT EXISTS lab_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL,
  doctor_id TEXT,
  ordered_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ordered',
  tests TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  result_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lab_orders_patient_idx ON lab_orders (patient_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS lab_orders_status_idx ON lab_orders (status, ordered_at DESC);
`;

let database: DatabaseSync | null = null;
const statements = new Map<string, StatementSync>();

/** Where the live data lives. Overridden by the Tauri shell/service. */
export function dataDir(): string {
  return process.env["ALRAHMA_DATA_DIR"] || join(process.cwd(), ".data");
}

export function filesDir(): string {
  return join(dataDir(), "files");
}

export function db(): DatabaseSync {
  if (database) return database;
  const dir = dataDir();
  mkdirSync(join(dir, "files"), { recursive: true });
  const d = new DatabaseSync(join(dir, "hospital.db"));
  d.exec("PRAGMA journal_mode = WAL");
  d.exec("PRAGMA synchronous = NORMAL");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec("PRAGMA busy_timeout = 8000");
  d.exec(SCHEMA);
  database = d;
  return d;
}

function stmt(sql: string) {
  let s = statements.get(sql);
  if (!s) {
    s = db().prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return stmt(sql).all(...(params as never[])) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return stmt(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
  return stmt(sql).run(...(params as never[])) as { changes: number; lastInsertRowid: number | bigint };
}

/** Runs a function inside an immediate transaction; rolls back on any throw. */
export function transaction<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (e) {
    try {
      d.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw e;
  }
}

/** "YYYY-MM-DD" in Cairo, matching the old database day boundaries. */
export function cairoDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Must run inside a transaction; the caller owns the atomic boundary. */
export function nextCounter(name: string): number {
  const row = get<{ value: number }>("SELECT value FROM counters WHERE name = ?", name);
  const next = (row?.value ?? 0) + 1;
  run(
    "INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value",
    name,
    next,
  );
  return next;
}

export function closeDb(): void {
  if (!database) return;
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    /* best effort */
  }
  database.close();
  database = null;
  statements.clear();
}
