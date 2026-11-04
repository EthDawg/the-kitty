// The kit gallery: every component in four states (desktop and phone, light and dark) with motion reduced. Build first: python3 build.py --v2
const { test, expect } = require("@playwright/test");
const path = require("path");
const url = "file://" + path.join(__dirname, "..", "..", "dist", "kit.html");
const COMPONENTS = ["Ring", "Bar", "StatTile", "Sparkline", "Sankey", "Pack", "EntryRow", "EntryList", "Table", "Drawer", "ReviewCard", "Chip", "EmptyState", "Skeleton", "Toast", "Tray"];
for (const [size, viewport] of [["desktop", { width: 1280, height: 860 }], ["phone", { width: 390, height: 844 }]]) for (const theme of ["light", "dark"]) {
  test(`gallery ${size} ${theme}`, async ({ page }) => {
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.goto(`${url}?noonb&noanim&theme=${theme}`); await page.waitForSelector("[data-kit=Tray]"); await page.evaluate(() => document.fonts.ready);
    for (const c of COMPONENTS) { const b = await page.locator(`[data-kit=${c}]`).boundingBox(); expect(b && b.height, c).toBeGreaterThan(50); const blank = await page.locator(`[data-kit=${c}]`).evaluate((e) => e.children.length < 2 || e.lastElementChild.getBoundingClientRect().height < 4); expect(blank, `${c} drew nothing`).toBe(false); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll").toBe(true);
    expect(errors).toEqual([]);
    const shot = path.join(__dirname, "..", "..", "docs", "screenshots", "kit", `${size}-${theme}.png`);
    if (process.env.CI) await expect(page).toHaveScreenshot(`${size}-${theme}.png`, { fullPage: true, maxDiffPixelRatio: 0.01 });
    else await page.screenshot({ path: shot, fullPage: true });
  });
}
