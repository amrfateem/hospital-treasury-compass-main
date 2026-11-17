import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const dbPath = "release/AlRahmaHospital/data/hospital.db";
const db = new DatabaseSync(dbPath);
const p = db.prepare("SELECT * FROM profiles WHERE username = 'director'").get();
const r = db.prepare("SELECT * FROM user_roles WHERE user_id = ?").get(p.id);
db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(p.id);
db.prepare("DELETE FROM profiles WHERE id = ?").run(p.id);
db.close();
writeFileSync(".admin-backup.json", JSON.stringify({ p, r }));

const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const page = await browser.newPage();
await page.goto("http://alrahma.local/auth", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
console.log("H1", await page.locator("h1").first().innerText());

const x = JSON.parse(readFileSync(".admin-backup.json", "utf8"));
const db2 = new DatabaseSync(dbPath);
db2.prepare("INSERT INTO profiles (id,username,full_name,box_id,active,permissions,controls,password_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(x.p.id, x.p.username, x.p.full_name, x.p.box_id, x.p.active, x.p.permissions, x.p.controls, x.p.password_hash, x.p.created_at);
db2.prepare("INSERT INTO user_roles (user_id,role) VALUES (?,?)").run(x.r.user_id, x.r.role);
db2.close();

await page.fill("#a-name", "Another Admin");
await page.fill("#a-user", "another");
await page.fill("#a-pass", "another123");
await page.fill("#a-pass2", "another123");
await page.click('button[type="submit"]');
await page.waitForTimeout(1800);
console.log("H1_AFTER", await page.locator("h1").first().innerText());
const body = await page.locator("body").innerText();
console.log("HAS_ERROR", body.includes("تم إعداد حساب المدير بالفعل"));
console.log("LOGIN_BUTTON", await page.locator('button[type="submit"]').innerText());
await browser.close();
