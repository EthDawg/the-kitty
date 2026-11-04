// Screenshots of every portal for docs/screenshots/portals/. Run locally against a running server: node test/screenshots.js
const { chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://127.0.0.1:4173";
const OUT = path.resolve(__dirname, "..", "..", "docs", "screenshots", "portals");
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/`); await page.waitForSelector(".brandcard"); await page.screenshot({ path: path.join(OUT, "landing.png"), fullPage: true });
  const brands = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "public", "brands.json"), "utf8"));
  for (const b of brands) {
    await page.goto(`${BASE}/${b.id}`); await page.waitForSelector("#signin:not([hidden])");
    if (b.id === "westpaw") await page.screenshot({ path: path.join(OUT, "signin.png") });
    await page.fill("#name", "Jordan"); await page.fill("#password", "demo"); await page.click("#loginbtn"); await page.waitForSelector("#dash:not([hidden])");
    await page.click("#previewbtn"); await page.waitForSelector("#preview table");
    await page.screenshot({ path: path.join(OUT, `${b.id}.png`) });
  }
  await browser.close();
  console.log("screenshots in", OUT);
})();
