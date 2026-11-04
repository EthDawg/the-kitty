// Screenshots of the portals for docs/screenshots/portals/. Run locally against a running server: node test/screenshots.js
const { chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const BASE = process.env.BASE || "http://127.0.0.1:4173";
const OUT = path.resolve(__dirname, "..", "..", "docs", "screenshots", "portals");
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/`); await page.waitForSelector(".brandcard"); await page.waitForSelector("#stats b"); await page.screenshot({ path: path.join(OUT, "landing.png"), fullPage: true });
  const brands = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "public", "brands.json"), "utf8"));
  const first = { westpaw: "ACC-EVD", commbark: "ACC-OLD", amewx: "ACC-CC", ping: "ACC-SAV", propertymeow: "RENTAL", pawroll: "Jordan@Northwind Logistics", purrsure: "POL-RENTAL" };
  for (const b of brands) {
    await page.goto(`${BASE}/${b.id}`); await page.waitForSelector("#signin:not([hidden])");
    if (b.id === "westpaw") await page.screenshot({ path: path.join(OUT, "signin.png") });
    await page.fill("#name", "Jordan"); await page.fill("#password", "demo"); await page.click("#loginbtn"); await page.waitForSelector("#view:not([hidden])");
    await page.waitForSelector("#recent table, #recent .error", { timeout: 15000 });
    await page.screenshot({ path: path.join(OUT, `${b.id}.png`) });
    await page.goto(`${BASE}/${b.id}#/account/${encodeURIComponent(first[b.id])}`); await page.waitForSelector("#rows table");
    if (b.id === "westpaw" || b.id === "amewx" || b.id === "pawroll") {
      await page.click("#export-open"); await page.waitForSelector("#exportpanel:not([hidden])");
      await page.screenshot({ path: path.join(OUT, `${b.id}-activity.png`) });
    }
    if (b.id === "westpaw" || b.id === "propertymeow") {
      await page.goto(`${BASE}/${b.id}#/documents/${encodeURIComponent(first[b.id])}`); await page.waitForSelector("#docs .fy");
      await page.screenshot({ path: path.join(OUT, `${b.id}-documents.png`) });
    }
  }
  await browser.close();
  console.log("screenshots in", OUT, fs.readdirSync(OUT));
})();
