import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const b = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const p = await b.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
const svg = readFileSync("src-tauri/icons/source-logo.svg", "utf8");
await p.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`, { waitUntil: "load" });
await p.screenshot({ path: ".logo-preview.png", omitBackground: true });
await b.close();
