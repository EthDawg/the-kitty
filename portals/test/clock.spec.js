// The clock is one request parameter, today. It filters what is listed by delivered date, and with no today the portals are as they always were.
const { test, expect } = require("@playwright/test");
const { session, signIn, getJson, API } = require("./helpers");
const MONTHS = require("../data/months.json");

const VISITOR = "Clock Test"; // any name: the whole household, no friction, so only the clock is under test
const last = (rows) => rows[rows.length - 1];

let ctx;
test.beforeEach(async ({ playwright, baseURL }) => { ctx = await session(playwright, baseURL); });
test.afterEach(async () => { await ctx.dispose(); });

test("with no today every portal holds what it always held", async () => {
  await signIn(ctx, "westpaw", VISITOR);
  const j = await getJson(ctx, "/api/accounts?brand=westpaw");
  expect(j.today).toBeNull();
  expect(last(j.months)).toBe(last(MONTHS.months));
  expect(j.accounts.map((a) => a.id)).toEqual(["ACC-EVD", "ACC-OFF", "ACC-RNT", "LN-HOME", "LN-INV"]);
  await signIn(ctx, "pawroll", VISITOR);
  expect((await getJson(ctx, "/api/files?brand=pawroll")).files.some((f) => f.delivered_on > "2027-02-01")).toBe(true);
});

test("today hides rows, months, statements and listed files from after it, in every layer", async () => {
  await signIn(ctx, "westpaw", VISITOR);
  const T = "today=2027-01-31";
  const j = await getJson(ctx, `/api/accounts?brand=westpaw&${T}`);
  expect(j.today).toBe("2027-01-31");
  expect(last(j.months)).toBe("2027-01");
  const evd = j.accounts.find((a) => a.id === "ACC-EVD");
  expect(evd.as_at).toBe("2027-01-31");
  const expected = MONTHS.transactions.filter((t) => t[1] === "ACC-EVD" && t[0] <= "2027-01-31").reduce((s, t) => s + t[3], MONTHS.accounts.find((a) => a.id === "ACC-EVD").opening_balance);
  expect(evd.balance).toBeCloseTo(expected, 2);
  for (const p of evd.presets) expect(p.to <= "2027-01-31", p.label).toBe(true);
  const rows = await getJson(ctx, `/api/accounts?brand=westpaw&account=ACC-EVD&from=2027-01-01&to=2027-03-31&size=500&${T}`);
  expect(rows.rows.length).toBe(MONTHS.transactions.filter((t) => t[1] === "ACC-EVD" && t[0] >= "2027-01-01" && t[0] <= "2027-01-31").length);
  const labels = (await getJson(ctx, `/api/accounts?brand=westpaw&account=ACC-EVD&docs=1&${T}`)).groups.flatMap((g) => g.docs.map((d) => d.label));
  expect(labels).toContain("January 2027 statement");
  expect(labels).not.toContain("February 2027 statement");
  const late = await ctx.get(`/api/export?brand=westpaw&account=ACC-EVD&from=2027-02-01&to=2027-02-28&format=csv&${T}`);
  expect(late.status()).toBe(400);
  expect((await late.json()).error).toContain("2027-01-31");
  const files = await getJson(ctx, `/api/files?brand=westpaw&${T}`);
  expect(files.files.length).toBeGreaterThan(0);
  for (const f of files.files) expect(f.delivered_on <= "2027-01-31", f.name).toBe(true);
});

test("a listing goes by the delivered date: an assessment on its day, a statement the day it arrives", async () => {
  await signIn(ctx, "myguv", VISITOR);
  const has = async (brand, today, name) => (await getJson(ctx, `/api/files?brand=${brand}&today=${today}`)).files.some((f) => f.name === name);
  expect(await has("myguv", "2026-09-05", "Notice-of-Assessment-Mia-FY2026.pdf")).toBe(false);
  expect(await has("myguv", "2026-09-06", "Notice-of-Assessment-Mia-FY2026.pdf")).toBe(true);
  await signIn(ctx, "amewx", VISITOR);
  expect(await has("amewx", "2027-01-15", "Amewx-Statement-2027-01-14.pdf"), "closed on the 14th, delivered on the 16th").toBe(false);
  expect(await has("amewx", "2027-01-16", "Amewx-Statement-2027-01-14.pdf")).toBe(true);
  await signIn(ctx, "pawroll", VISITOR);
  const docs = async (today) => (await getJson(ctx, `/api/accounts?brand=pawroll&account=${encodeURIComponent("Mia@Bayview Health")}&docs=1&today=${today}`)).groups.flatMap((g) => g.docs.map((d) => d.label));
  expect((await docs("2026-07-13")).join("|"), "an income statement arrives two weeks after 30 June").not.toContain("Income statement FY2025-26");
  expect(await docs("2026-07-14")).toContain("Income statement FY2025-26");
});

test("an account opened after today is not there, and a loan shows its balance at the last month closed", async () => {
  await signIn(ctx, "westpaw", VISITOR);
  const T = "today=2021-01-20";
  const j = await getJson(ctx, `/api/accounts?brand=westpaw&${T}`);
  expect(j.accounts.map((a) => a.id)).toEqual(["ACC-EVD", "ACC-OFF", "LN-HOME"]);
  expect(j.accounts.find((a) => a.id === "LN-HOME").balance).toBeCloseTo(-MONTHS.loans["LN-HOME"].months["2020-12"].closing, 2);
  await signIn(ctx, "propertymeow", VISITOR);
  expect((await getJson(ctx, `/api/accounts?brand=propertymeow&${T}`)).accounts).toEqual([]);
  await signIn(ctx, "purrsure", VISITOR);
  const pol = await getJson(ctx, `/api/accounts?brand=purrsure&${T}`);
  expect(pol.accounts.map((a) => a.id).sort()).toEqual(["POL-CAR", "POL-HOME"]);
  for (const p of pol.accounts.flatMap((a) => a.presets)) expect(p.from <= "2021-01-20").toBe(true);
  const r = await ctx.get(`/api/export?brand=purrsure&account=POL-HOME&from=2030-01-01&to=2031-01-01&format=renewal&${T}`);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-disposition"], "falls back to the last period that existed, not a later one").toContain("2020");
});

test("today is one request parameter: wrong is refused, and nothing is remembered between requests", async () => {
  await signIn(ctx, "westpaw", VISITOR);
  expect((await ctx.get("/api/accounts?brand=westpaw&today=31-01-2027")).status()).toBe(400);
  expect((await ctx.get("/api/accounts?brand=westpaw&today=2027-02-31")).status()).toBe(400);
  expect((await getJson(ctx, "/api/accounts?brand=westpaw&today=2023-06-30")).today).toBe("2023-06-30");
  expect((await getJson(ctx, "/api/accounts?brand=westpaw")).today, "the next request stands alone").toBeNull();
  expect((await getJson(ctx, "/api/accounts?brand=westpaw&as_of=2023-06-30")).today, "there is one name for it").toBeNull();
  expect((await getJson(ctx, "/api/accounts?brand=westpaw&chapter=1")).today).toBeNull();
  expect((await ctx.get("/api/clock", { headers: API })).status()).toBe(404);
  expect((await ctx.storageState()).cookies.some((c) => /as_of|today/.test(c.name))).toBe(false);
});

test("a page carries today to every request, and the page says so", async ({ page }) => {
  await page.goto("/westpaw?today=2027-01-16");
  await page.fill("#name", VISITOR);
  await page.fill("#password", "demo");
  await page.click("#loginbtn");
  await expect(page.locator(".greet")).toBeVisible();
  await expect(page.locator("#clockline")).toContainText("16 Jan 2027");
  await expect(page.locator(".acct").first()).toContainText("as at 16 Jan 2027");
  await page.click('.acct[data-account="ACC-EVD"]');
  await expect(page.locator("#from")).toHaveValue("2026-10-19");
  await page.selectOption("#brandswitch", "ping");
  await expect(page).toHaveURL(/\/ping\?today=2027-01-16$/);
  await expect(page.locator(".demo a")).toHaveAttribute("href", "/?today=2027-01-16");
});
