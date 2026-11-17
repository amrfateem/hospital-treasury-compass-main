import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
const external = [];
p.on("request", (r) => {
  const u = r.url();
  if (!u.startsWith("http://127.0.0.1") && !u.startsWith("data:")) external.push(u);
});
await p.goto("http://127.0.0.1:8091/auth", { waitUntil: "networkidle" });
const h = await p.locator("h1").first().innerText();
if (h.includes("إعداد حساب")) {
  await p.fill("#a-name", "مدير");
  await p.fill("#a-user", "director");
  await p.fill("#a-pass", "director123");
  await p.fill("#a-pass2", "director123");
} else {
  await p.fill("#a-user", "director");
  await p.fill("#a-pass", "director123");
}
await p.click('button[type="submit"]');
await p.waitForTimeout(2200);
await p.goto("http://127.0.0.1:8091/expenses", { waitUntil: "networkidle" });
await p.waitForTimeout(1000);

const metrics = () =>
  p.evaluate(() => ({
    inner: window.innerWidth,
    root: document.documentElement.clientWidth,
    body: document.body.clientWidth,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    locked: document.body.hasAttribute("data-scroll-locked"),
    font: getComputedStyle(document.body).fontFamily,
    tajawal: document.fonts.check("16px Tajawal"),
  }));
console.log("BEFORE", await metrics());

// Open a Radix select.
const select = p.locator('[role="combobox"], button[aria-label*="الخزينة"]').first();
console.log("SELECT", await select.count());
if (await select.count()) {
  await select.click();
  await p.waitForTimeout(500);
  console.log("SELECT_OPEN", await metrics());
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  console.log("SELECT_CLOSED", await metrics());
}

// Open the new-expense dialog.
const add = p.locator("button", { hasText: /مصروف|إضافة/ }).last();
console.log("ADD", await add.count());
if (await add.count()) {
  await add.click();
  await p.waitForTimeout(700);
  console.log("DIALOG_OPEN", await metrics());
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  console.log("DIALOG_CLOSED", await metrics());
}
console.log("EXTERNAL", external.length ? external.slice(0, 5) : "none");
await b.close();
