import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.BASE || "http://alrahma.local";
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
  await page.waitForTimeout(1500);
  const h = await page.locator("h1").first().innerText();
  console.log("LOGIN FORM:", h);
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
  console.log("AFTER SUBMIT URL:", page.url());
  if (await page.locator("form").count()) {
    console.log("FORM TEXT:", (await page.locator("form").innerText()).slice(0, 160).replace(/\s+/g, " "));
  }
  console.log("COOKIES:", (await context.cookies()).map((c) => `${c.name}@${c.domain}`).join(", ") || "none");
}

await login("director", "director123");
console.log("DASH:", (await page.locator("body").innerText()).slice(0, 120).replace(/\s+/g, " "));

// Sign out if we reached the app.
const logout = page.getByRole("button", { name: "تسجيل الخروج" });
if (await logout.count()) {
  await logout.first().click();
  await page.waitForTimeout(2000);
  console.log("SIGNED OUT URL:", page.url());
  await login("director", "director123");
}

console.log("ERRORS:", errors.length ? errors.slice(0, 6).join(" || ") : "none");
await page.screenshot({ path: ".auth-flow.png" });
await browser.close();
