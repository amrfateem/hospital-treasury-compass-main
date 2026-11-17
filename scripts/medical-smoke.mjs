import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://alrahma.local";
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
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
await page.goto(`${BASE}/patients`, { waitUntil: "networkidle", timeout: 60000 });
console.log("BUTTONS:", (await page.locator("button").allInnerTexts()).slice(0, 12).join(" | "));
const add = page.locator("button", { hasText: "ملف مريض جديد" }).first();
console.log("ADD_COUNT", await page.locator("button", { hasText: "ملف مريض جديد" }).count());
await add.click();
await page.waitForTimeout(400);
console.log("DIALOG", await page.locator('[role="dialog"]').innerText().then((t) => t.slice(0, 80)).catch(() => "none"));
await page.fill("#pt-name", "مريض اختبار محلي");
await page.fill("#pt-nid", "29901011234567");
await page.fill("#pt-phone", "01000000000");
await page.locator('[role="dialog"] button[type="submit"]').click();
await page.waitForTimeout(2500);
console.log("TOAST", (await page.locator("body").innerText()).includes("مريض اختبار محلي"));
await page.screenshot({ path: ".patients.png" });
console.log("ERRORS", errors.length ? errors.slice(0, 5).join(" || ") : "none");
await browser.close();
