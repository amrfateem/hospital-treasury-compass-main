import { chromium } from "playwright-core";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://alrahma.local";
const data = "portable/data";
const db = new DatabaseSync(join(data, "hospital.db"));
const user = db.prepare("SELECT id FROM profiles WHERE username = 'director'").get();
if (!user) throw new Error("director missing");
const token = randomUUID().replace(/-/g, "");
const rel = `patient/test-owner/${randomUUID()}.png`;
const id = randomUUID();
db.prepare("INSERT INTO upload_tokens (token, path, user_id, expires_at) VALUES (?,?,?,?)").run(token, rel, user.id, Date.now() + 600000);
db.close();

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${BASE}/auth`, { waitUntil: "networkidle", timeout: 60000 });
if ((await page.locator("h1").first().innerText()).includes("إعداد حساب")) {
  await page.fill("#a-name", "Director");
  await page.fill("#a-user", "director");
  await page.fill("#a-pass", "director123");
  await page.fill("#a-pass2", "director123");
} else {
  await page.fill("#a-user", "director");
  await page.fill("#a-pass", "director123");
}
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 60000 }).catch(() => {});

// 1x1 transparent PNG
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64",
);
const up = await context.request.post(`${BASE}/api/upload?token=${token}`, {
  data: png,
  headers: { "content-type": "image/png" },
});
console.log("UPLOAD", up.status(), await up.text());

const db2 = new DatabaseSync(join(data, "hospital.db"));
db2.prepare(
  "INSERT INTO stored_files (id,owner_kind,owner_id,kind,ref_id,path,file_name,mime_type,size_bytes,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
).run(id, "patient", "test-owner", "test", null, rel, "x.png", "image/png", png.length, user.id, new Date().toISOString());
db2.close();

const down = await context.request.get(`${BASE}/api/file/${id}`);
console.log("DOWNLOAD", down.status(), down.headers()["content-type"], (await down.body()).length);

const anon = await browser.newContext();
const denied = await anon.request.get(`${BASE}/api/file/${id}`);
console.log("ANON", denied.status());
await anon.close();
await browser.close();

const db3 = new DatabaseSync(join(data, "hospital.db"));
db3.prepare("DELETE FROM stored_files WHERE id = ?").run(id);
db3.close();
unlinkSync(join(data, "files", rel));
