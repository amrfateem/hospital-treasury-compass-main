import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.BASE || "http://127.0.0.1:5173";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto(`${BASE}/auth`, { waitUntil: "networkidle", timeout: 60000 });
const title = await page.locator("h1").first().innerText();
console.log("AUTH_TITLE:", title);

if (title.includes("إعداد حساب")) {
  await page.fill("#a-name", "مدير النظام");
  await page.fill("#a-user", "director");
  await page.fill("#a-pass", "director123");
  await page.fill("#a-pass2", "director123");
  await page.click('button[type="submit"]');
} else {
  await page.fill("#a-user", "director");
  await page.fill("#a-pass", "director123");
  await page.click('button[type="submit"]');
}

await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);
console.log("URL:", page.url());
console.log("BODY:", (await page.locator("body").innerText()).slice(0, 300).replace(/\s+/g, " "));
await page.screenshot({ path: ".smoke.png", fullPage: false });

await page.goto(`${BASE}/patients`, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => errors.push("patients: " + e.message));
await page.waitForTimeout(1500);
console.log("PATIENTS_TITLE:", await page.locator("h1").first().innerText().catch(() => "none"));
console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
await browser.close();
