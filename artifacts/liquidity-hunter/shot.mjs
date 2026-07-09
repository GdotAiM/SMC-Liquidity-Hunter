// Headless screenshot generator for the SMC dashboard.
// Run from inside artifacts/liquidity-hunter so `playwright` resolves.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = new URL("./shots-out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5173";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safe(label, fn) {
  try {
    await fn();
    console.log(`  ok: ${label}`);
  } catch (e) {
    console.log(`  FAIL: ${label} — ${e.message}`);
  }
}

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(20000);

// Capture any console errors for debugging.
page.on("console", (m) => { if (m.type() === "error") console.log(`  [console.error] ${m.text().slice(0,160)}`); });
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message.slice(0,160)}`));

console.log("→ loading dashboard…");
await safe("dashboard goto", async () => {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  // Give the SPA + real-time data time to hydrate and render TF cards.
  await sleep(8000);
});
await safe("dashboard screenshot", async () => {
  await page.screenshot({ path: OUT + "01-dashboard.png", fullPage: false });
});

// Try to open the first timeframe Intelligence Sheet (cards are buttons).
console.log("→ opening intelligence sheet…");
await safe("intelligence sheet", async () => {
  // Click the first TF agent card we can find.
  const card = await page.locator('[role="button"], button').filter({ hasText: /bias|draw|target|confidence/i }).first();
  await card.click({ timeout: 8000 });
  await sleep(3500);
  await page.screenshot({ path: OUT + "02-intelligence-sheet.png", fullPage: false });
});

// Try the CHART view.
console.log("→ opening chart…");
await safe("chart view", async () => {
  const chartBtn = page.locator('button, [role="button"]').filter({ hasText: /chart|pro chart/i }).first();
  await chartBtn.click({ timeout: 8000 });
  await sleep(4000);
  await page.screenshot({ path: OUT + "03-chart.png", fullPage: false });
});

// Analytics page (will show empty states without DB — honest).
console.log("→ analytics page…");
await safe("analytics", async () => {
  await page.goto(BASE + "/analytics", { waitUntil: "domcontentloaded", timeout: 20000 });
  await sleep(3000);
  await page.screenshot({ path: OUT + "04-analytics.png", fullPage: false });
});

// Broker page.
console.log("→ broker page…");
await safe("broker", async () => {
  await page.goto(BASE + "/broker", { waitUntil: "domcontentloaded", timeout: 20000 });
  await sleep(2500);
  await page.screenshot({ path: OUT + "05-broker.png", fullPage: false });
});

await browser.close();
console.log("done → output in " + OUT);
