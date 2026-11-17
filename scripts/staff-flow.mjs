import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://alrahma.local";
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console " + m.text());
});

async function login(user, pass) {
  await page.goto(`${BASE}/auth`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  const h = await page.locator("h1").first().innerText();
  if (h.includes("إعداد حساب")) {
    await page.fill("#a-name", "مدير النظام");
    await page.fill("#a-user", user);
    await page.fill("#a-pass", pass);
    await page.fill("#a-pass2", pass);
  } else {
    await page.fill("#a-user", user);
    await page.fill("#a-pass", pass);
  }
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  return page.url();
}

console.log("DIRECTOR:", await login("director", "director123"));
await page.goto(`${BASE}/settings?tab=users`, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1500);
console.log("SETTINGS URL:", page.url());
const add = page.locator("button", { hasText: "مستخدم جديد" }).first();
console.log("ADD BUTTONS:", await page.locator("button", { hasText: "مستخدم جديد" }).count());
await add.click();
await page.waitForTimeout(500);
console.log("DIALOG:", await page.locator('[role="dialog"]').innerText().then((t) => t.slice(0, 80)).catch(() => "none"));
await page.fill("#st-name", "موظف اختبار");
await page.fill("#st-user", "staff1");
await page.fill("#st-pass", "staff12345");
await page.fill("#st-pass2", "staff12345");
await page.locator('[role="dialog"] button[type="submit"]').click();
await page.waitForTimeout(2500);
console.log("AFTER CREATE:", (await page.locator("body").innerText()).includes("موظف اختبار"));
console.log("ERRORS:", errors.slice(0, 4).join(" || ") || "none");

// sign out, login as staff1
const logout = page.getByRole("button", { name: "تسجيل الخروج" });
if (await logout.count()) {
  await logout.first().click();
  await page.waitForTimeout(1500);
}
console.log("STAFF LOGIN URL:", await login("staff1", "staff12345"));
console.log("STAFF BODY:", (await page.locator("body").innerText()).slice(0, 120).replace(/\s+/g, " "));
console.log("FINAL ERRORS:", errors.slice(0, 6).join(" || ") || "none");
await page.screenshot({ path: ".staff-flow.png" });
await browser.close();
