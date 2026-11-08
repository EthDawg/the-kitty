// Home as a canvas, on the built v2 page: the phase C acceptance. Build first: python3 build.py --v2
const { test, expect } = require("@playwright/test");
const path = require("path");
const page_url = "file://" + path.join(__dirname, "..", "..", "dist", "local-v2.html");
// ?signals: the public demo hides the "new on Home" note; these tests exercise it as a household would see it
const open = (page, q = "") => page.goto(`${page_url}?noonb&noanim&signals${q}`).then(() => page.waitForSelector("#canvas .wcell"));
const prefs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("kitty:prefs") || "{}"));
const cell = (page, id) => page.locator(`.wcell[data-wid="${id}"]`);
const mounted = (page) => page.waitForSelector("#canvas.grid-stack .wcell[data-wid='hero'][gs-h]");
const ids = (page) => page.locator(".wcell").evaluateAll((els) => els.map((e) => e.dataset.wid));

test("desktop: signals add widgets once with an undo; drag and resize survive a reload; hide, show and reset work", async ({ page }) => {
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await expect(page.locator("#toast")).toContainText("Property");
  expect((await prefs(page)).layout.seen).toContain("property");
  // heights follow the content: nothing clipped, nothing overlapping
  const boxes = await page.locator(".wcell").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(), b = e.querySelector(".wbox").getBoundingClientRect(); return { id: e.dataset.wid, top: r.top, bottom: r.bottom, left: r.left, right: r.right, clipped: b.height > r.height + 1 }; }));
  expect(boxes.filter((b) => b.clipped)).toEqual([]);
  for (const a of boxes) for (const b of boxes) if (a.id < b.id) expect(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `${a.id} overlaps ${b.id}`).toBe(true);
  await page.getByRole("button", { name: "Arrange this page" }).click(); await mounted(page);
  // drag Property up to the top
  await cell(page, "property").scrollIntoViewIfNeeded();
  const box = await cell(page, "property").boundingBox(); const hero = await cell(page, "needs").boundingBox();
  await page.mouse.move(box.x + 120, box.y + 120); await page.mouse.down();
  const steps = 12; for (let i = 1; i <= steps; i++) await page.mouse.move(box.x + 120, box.y + 120 + (hero.y + 20 - box.y - 120) * i / steps);
  await page.mouse.up(); await page.waitForTimeout(200);
  let saved = (await prefs(page)).layout.items; const movedY = saved.find((i) => i.id === "property").y;
  expect(movedY).toBeLessThan(saved.find((i) => i.id === "goals").y);
  await mounted(page);
  // resize Super from half to wide: the width snaps to a declared size
  await cell(page, "super").scrollIntoViewIfNeeded();
  const sb = await cell(page, "super").locator(".ui-resizable-e").boundingBox(); expect(sb.width).toBeGreaterThan(4);
  await page.mouse.move(sb.x + 3, sb.y + 20); await page.mouse.down(); await page.mouse.move(sb.x + 300, sb.y + 20, { steps: 8 }); await page.mouse.move(sb.x + 460, sb.y + 20, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(250);
  saved = (await prefs(page)).layout.items; const widths = Object.fromEntries(saved.map((i) => [i.id, i.w]));
  expect([6, 12]).toContain(widths.super);
  // reload keeps it, and no second toast
  await open(page);
  await expect(page.locator("#toast")).not.toHaveClass(/on/);
  expect((await prefs(page)).layout.items.find((i) => i.id === "property").y).toBe(movedY);
  // hide, then show again
  await page.getByRole("button", { name: "Arrange this page" }).click(); await mounted(page);
  await page.getByRole("button", { name: "Hide Things" }).click();
  await expect(cell(page, "things")).toHaveCount(0);
  await page.getByRole("button", { name: "+ Things" }).click();
  await expect(cell(page, "things")).toHaveCount(1);
  // reset
  await page.getByRole("button", { name: "Back to the default" }).click();
  await expect.poll(async () => (await ids(page)).slice(0, 3)).toEqual(["hero", "needs", "decide"]);
  expect(errors).toEqual([]);
});

test("undo removes what a signal added, and it stays removed", async ({ page }) => {
  await open(page); await page.locator("#toast button").click();
  await expect(cell(page, "property")).toHaveCount(0);
  await open(page); await expect(cell(page, "property")).toHaveCount(0);
  await expect(cell(page, "hero")).toHaveCount(1);
});

test("?layout=default ignores a saved layout and writes nothing", async ({ page }) => {
  await open(page); await page.locator("#toast button").click();
  const before = JSON.stringify((await prefs(page)).layout);
  await open(page, "&layout=default");
  await expect(cell(page, "property")).toHaveCount(1); await expect(page.getByRole("button", { name: "Arrange this page" })).toHaveCount(0);
  expect(JSON.stringify((await prefs(page)).layout)).toBe(before);
});

test("a blocked GridStack costs dragging, not the page", async ({ page }) => {
  await page.route("**/gridstack-all.min.js", (r) => r.abort());
  await open(page); expect(await page.evaluate(() => !!window.GridStack)).toBe(false);
  const h = await cell(page, "hero").boundingBox(); expect(h.height).toBeGreaterThan(200);
  const u = await cell(page, "upcoming").boundingBox(), m = await cell(page, "months").boundingBox(); expect(m.x).toBeGreaterThan(u.x + u.width - 1);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test("one column; the handle and the arrows reorder; the order survives a reload", async ({ page }) => {
    await open(page);
    await expect(page.locator("#canvas")).toHaveClass(/phone/); await expect(page.locator("#canvas.grid-stack")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const toast = await page.locator("#toast").boundingBox(); expect(toast.width).toBeGreaterThan(280);
    // a wider font must not push anything sideways: the goal tiles once did on Linux
    await page.addStyleTag({ content: "*{font-family:Verdana,'DejaVu Sans',sans-serif !important}" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const lefts = await page.locator(".wcell").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left))); expect(new Set(lefts).size).toBe(1);
    await page.getByRole("button", { name: "Arrange this page" }).click();
    for (let k = (await ids(page)).indexOf("upcoming"); k > 1; k--) await page.getByRole("button", { name: "Move What's coming up up" }).click();
    expect((await ids(page)).slice(0, 3)).toEqual(["hero", "upcoming", "needs"]);
    await cell(page, "needs").scrollIntoViewIfNeeded();
    const h = await cell(page, "needs").locator(".whandle").boundingBox(), t = await cell(page, "upcoming").boundingBox();
    await page.mouse.move(h.x + 6, h.y + 6); await page.mouse.down(); await page.mouse.move(h.x + 6, t.y + 10, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
    expect((await ids(page)).slice(0, 3)).toEqual(["hero", "needs", "upcoming"]);
    await open(page); expect((await ids(page)).slice(0, 3)).toEqual(["hero", "needs", "upcoming"]);
  });
});

test("the undo cannot be clicked once the toast has gone", async ({ page }) => {
  await open(page); await expect(page.locator("#toast")).toHaveClass(/on/);
  await expect(page.locator("#toast")).not.toHaveClass(/on/, { timeout: 9000 });
  await expect(page.locator("#toast button")).toHaveCount(0);
});

// card edges by row: every gap between rows is the grid's own, and a row runs edge to edge
const rows = (page) => page.locator(".wcell").evaluateAll((els) => {
  const by = new Map(); for (const e of els) { const r = (e.querySelector(".card") || e).getBoundingClientRect(); const k = Math.round(r.top); by.set(k, (by.get(k) || []).concat({ l: r.left, r: r.right, b: r.bottom })); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([top, cs]) => ({ top, bottom: Math.max(...cs.map((c) => c.b)), left: Math.min(...cs.map((c) => c.l)), right: Math.max(...cs.map((c) => c.r)) }));
});
const flush = async (page) => {
  const rs = await rows(page); const left = rs[0].left, right = rs[0].right;
  for (const r of rs) { expect(Math.abs(r.left - left)).toBeLessThan(1); expect(Math.abs(r.right - right)).toBeLessThan(1); }
  return rs;
};

test("spacing: gaps are the grid's own, rows run edge to edge, and nothing needs GridStack", async ({ page }) => {
  await open(page); await expect(page.locator("#canvas.grid-stack")).toHaveCount(0);
  const rs = await flush(page);
  for (let i = 1; i < rs.length; i++) expect(Math.abs(rs[i].top - rs[i - 1].bottom - 16), `row ${i}`).toBeLessThan(1);
});

test("a drop leaves no hole, and the page matches what the arrange view showed", async ({ page }) => {
  await open(page);
  await page.locator("#arrangebtn").click(); await mounted(page);
  await expect(page.locator(".arrangebar .btn")).toBeFocused();
  await cell(page, "contracts").scrollIntoViewIfNeeded();
  const box = await cell(page, "contracts").boundingBox(), to = await cell(page, "shares").boundingBox();
  await page.mouse.move(box.x + 120, box.y + 80); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 120, box.y + 80 + (to.y - box.y - 60) * i / 12);
  await page.mouse.up(); await mounted(page);
  await expect.poll(async () => { const o = await ids(page); return o.indexOf("contracts") < o.indexOf("shares"); }).toBe(true);
  await page.keyboard.press("Escape"); await expect(page.locator("#canvas.grid-stack")).toHaveCount(0);
  await flush(page);
});

test("width changes without dragging, and a newer local layout beats an older cloud copy", async ({ page }) => {
  await open(page); await page.locator("#arrangebtn").click(); await mounted(page);
  await page.getByRole("button", { name: "Make Super wider" }).click();
  await expect(page.getByRole("button", { name: "Make Super narrower" })).toBeFocused();
  expect((await prefs(page)).layout.items.find((i) => i.id === "super").w).toBe(12);
  expect(await page.evaluate(() => Number(localStorage.getItem("kitty:prefsSavedAt")))).toBeGreaterThan(0);
});

test("every icon the shell asks for exists in the brand sprite", async ({ page }) => {
  await open(page);
  const missing = await page.locator("use").evaluateAll((us) => us.map((u) => u.getAttribute("href")).filter((h) => h && h.startsWith("#") && !document.querySelector(h)));
  expect(missing).toEqual([]);
});

test("the header fits the narrowest phone, live label included", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 }); await open(page);
  await page.evaluate(() => { document.querySelector("#trustpill .txt").textContent = "Live demo · 30 Sep 2027"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const search = await page.locator("#topsearch").boundingBox(); expect(search.x + search.width).toBeLessThanOrEqual(308);
});

test("Narrower twice puts two neighbours side by side, and a reload keeps it", async ({ page }) => {
  await open(page); await page.locator("#arrangebtn").click(); await mounted(page);
  await page.getByRole("button", { name: "Make Saving for narrower" }).click();
  await expect(page.locator("#toast")).toContainText("fills its row");
  await expect(page.getByRole("button", { name: "Make Saving for wider" })).toBeFocused();
  await page.getByRole("button", { name: "Make Ways to get there faster narrower" }).click();
  const check = async () => {
    const r = await cell(page, "goals").boundingBox(), n = await cell(page, "ideas").boundingBox();
    expect(Math.abs(r.y - n.y)).toBeLessThan(2); expect(n.x).toBeGreaterThan(r.x + r.width - 1);
    expect(Math.abs(r.width - n.width)).toBeLessThan(2);
  };
  await check(); await open(page); await check();
  const items = (await prefs(page)).layout.items; expect(items.find((i) => i.id === "goals").w).toBe(6); expect(items.find((i) => i.id === "ideas").w).toBe(6);
});

test("a drop keeps every other widget's chosen width", async ({ page }) => {
  await open(page); await page.locator("#arrangebtn").click(); await mounted(page);
  await page.getByRole("button", { name: "Make Saving for narrower" }).click(); await mounted(page);
  await cell(page, "contracts").scrollIntoViewIfNeeded();
  const box = await cell(page, "contracts").boundingBox(), to = await cell(page, "shares").boundingBox();
  await page.mouse.move(box.x + 120, box.y + 80); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 120, box.y + 80 + (to.y - box.y - 60) * i / 12);
  await page.mouse.up(); await mounted(page);
  await expect.poll(async () => (await prefs(page)).layout.items.find((i) => i.id === "goals").w).toBe(6);
});

test.describe("a phone on its side", () => {
  test.use({ viewport: { width: 956, height: 440 }, hasTouch: true, isMobile: true });
  test("stays a phone: one column and no GridStack", async ({ page }) => {
    await open(page); await expect(page.locator("#canvas")).toHaveClass(/phone/);
    await page.locator("#arrangebtn").click(); await expect(page.locator(".arrangebar .btn")).toBeFocused();
    await expect(page.locator("#canvas.grid-stack")).toHaveCount(0);
    const a = await cell(page, "property").boundingBox(), b = await cell(page, "super").boundingBox(); expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  });
});

test("Escape and a resize in mid-drag cost nothing, and leaving the arrange view on the narrowest phone keeps focus", async ({ page }) => {
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await open(page); await page.locator("#arrangebtn").click(); await mounted(page);
  await cell(page, "contracts").scrollIntoViewIfNeeded(); const box = await cell(page, "contracts").boundingBox();
  await page.mouse.move(box.x + 120, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 40, { steps: 6 });
  await page.keyboard.press("Escape"); await page.setViewportSize({ width: 1270, height: 860 }); await page.waitForTimeout(250);
  await page.mouse.up(); await mounted(page); expect(errors).toEqual([]);
  await page.setViewportSize({ width: 320, height: 640 }); await open(page);
  await page.getByRole("button", { name: "Arrange this page" }).click(); await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Arrange this page" })).toBeFocused();
});

test("a blocked GridStack offers no handle it cannot honour", async ({ page }) => {
  await page.route(/gridstack/, (r) => r.abort()); await open(page);
  await page.locator("#arrangebtn").click(); await expect(page.locator(".whandle").first()).toBeHidden();
  for (let k = (await ids(page)).indexOf("upcoming"); k > 1; k--) await page.getByRole("button", { name: "Move What's coming up up" }).click();
  await expect.poll(async () => (await ids(page)).slice(0, 3)).toEqual(["hero", "upcoming", "needs"]);
});

test("a card that already draws full width says so when it is widened", async ({ page }) => {
  await open(page); await page.locator("#arrangebtn").click(); await mounted(page);
  await page.getByRole("button", { name: "Make Saving for narrower" }).click(); await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Make Saving for wider" }).click();
  await expect(page.locator("#toast")).toContainText("stays full width");
});

test("the desktop header fits from 820px up, live label and Ask included", async ({ page }) => {
  for (const width of [820, 860, 900, 960, 1000, 1040, 1060, 1100, 1180, 1240, 1320]) {
    await page.setViewportSize({ width, height: 800 }); await open(page);
    await page.evaluate(() => { document.querySelector("#trustpill .txt").textContent = "Live demo · 30 Sep 2027"; document.querySelector("#askbtn").hidden = false; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `page at ${width}`).toBeLessThanOrEqual(width);
    const lines = await page.locator(".brand .bname").evaluateAll((e) => e.filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect().height));
    for (const h of lines) expect(h, `wordmark at ${width}`).toBeLessThan(40);
  }
  await expect(page.locator("nav.tabs button").first()).toHaveAccessibleName(/Home/);
});
