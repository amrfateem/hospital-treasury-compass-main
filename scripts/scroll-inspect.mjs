import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://127.0.0.1:8091/auth", { waitUntil: "networkidle" });
await p.fill("#a-user", "director");
await p.fill("#a-pass", "director123");
await p.click('button[type="submit"]');
await p.waitForTimeout(2000);
await p.goto("http://127.0.0.1:8091/expenses", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const inspect = () =>
  p.evaluate(() => {
    const b = document.body;
    const cs = getComputedStyle(b);
    const root = document.documentElement;
    const scrollables = [...document.querySelectorAll("*")]
      .filter((e) => e.scrollHeight > e.clientHeight + 2 && ["auto", "scroll", "hidden"].includes(getComputedStyle(e).overflowY))
      .slice(0, 6)
      .map((e) => ({
        tag: e.tagName,
        cls: String(e.className).slice(0, 60),
        overflow: getComputedStyle(e).overflowY,
        ch: e.clientHeight,
        sh: e.scrollHeight,
        cw: e.clientWidth,
      }));
    return {
      inner: innerWidth,
      rootClient: root.clientWidth,
      rootScroll: root.scrollHeight,
      body: {
        client: b.clientWidth,
        offset: b.offsetWidth,
        scroll: b.scrollHeight,
        pr: cs.paddingRight,
        mr: cs.marginRight,
        overflow: cs.overflowY,
        gutter: cs.scrollbarGutter,
        width: cs.width,
      },
      scrollables,
    };
  });
console.log("BEFORE", JSON.stringify(await inspect(), null, 2));
const sel = p.locator('[role="combobox"], button[aria-label*="الخزينة"]').first();
await sel.click();
await p.waitForTimeout(500);
console.log("OPEN", JSON.stringify(await inspect(), null, 2));
await p.keyboard.press("Escape");
await p.waitForTimeout(400);
console.log("CLOSED", JSON.stringify(await inspect(), null, 2));
await b.close();
