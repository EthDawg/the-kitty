// The clock: a chapter set in 2027 sees only what existed by then, and with no clock the portals are as they always were.
const { test, expect } = require("@playwright/test");
const { session, signIn, setClock, getJson, API } = require("./helpers");
const MONTHS = require("../data/months.json");

const VISITOR = "Clock test"; // any name: the whole household, no friction, so only the clock is under test
const last = (rows) => rows[rows.length - 1];

let ctx;
test.beforeEach(async ({ playwright, baseURL }) => { ctx = await session(playwright, baseURL); });
test.afterEach(async () => { await ctx.dispose(); });

test("with no clock every portal holds what it always held", async () => {
  await signIn(ctx, "westpaw", VISITOR);
  const j = await getJson(ctx, "/api/accounts?brand=westpaw");
  expect(j.as_of).toBeNull();
  expect(last(j.months)).toBe(last(MONTHS.months));
  expect(j.accounts.map((a) => a.id)).toEqual(["ACC-EVD", "ACC-OFF", "ACC-RNT", "LN-HOME", "LN-INV"]);
  await signIn(ctx, "pawroll", VISITOR);
  const files = await getJson(ctx, "/api/files?brand=pawroll");
  expect(files.files.some((f) => f.exists_from > "2027-02-01")).toBe(true);
});

test("a clock hides rows, months, statements and files from after it, in every layer", async () => {
  await signIn(ctx, "westpaw", VISITOR);
  await setClock(ctx, { today: "2027-01-31" });
  const j = await getJson(ctx, "/api/accounts?brand=westpaw");
  expect(j.as_of).toBe("2027-01-31");
  expect(j.today).toBe("2027-01-31");
  expect(last(j.months)).toBe("2027-01");
  const evd = j.accounts.find((a) => a.id === "ACC-EVD");
  expect(evd.as_at).toBe("2027-01-31");
  const expected = MONTHS.transactions.filter((t) => t[1] === "ACC-EVD" && t[0] <= "2027-01-31").reduce((s, t) => s + t[3], MONTHS.accounts.find((a) => a.id === "ACC-EVD").opening_balance);
  expect(evd.balance).toBeCloseTo(expected, 2);
  for (const p of evd.presets) expect(p.to <= "2027-01-31", p.label).toBe(true);

  const rows = await getJson(ctx, "/api/accounts?brand=westpaw&account=ACC-EVD&from=2027-01-01&to=2027-03-31&size=500");
  expect(rows.rows.length).toBe(MONTHS.transactions.filter((t) => t[1] === "ACC-EVD" && t[0] >= "2027-01-01" && t[0] <= "2027-01-31").length);

  const docs = await getJson(ctx, "/api/accounts?brand=westpaw&account=ACC-EVD&docs=1");
  const labels = docs.groups.flatMap((g) => g.docs.map((d) => d.label));
  expect(labels).toContain("January 2027 statement");
  expect(labels).not.toContain("February 2027 statement");

  const late = await ctx.get("/api/export?brand=westpaw&account=ACC-EVD&from=2027-02-01&to=2027-02-28&format=csv");
  expect(late.status()).toBe(400);
  expect((await late.json()).error).toContain("2027-01-31");

  const files = await getJson(ctx, "/api/files?brand=westpaw");
  expect(files.files.length).toBeGreaterThan(0);
  for (const f of files.files) expect(f.exists_from <= "2027-01-31", f.name).toBe(true);
  const gone = await ctx.get("/vault/ACC-EVD/2027-03-02/Harbour-Transactions-ACC-EVD-2027-02.csv");
  expect(gone.status(), "a file from after the clock is not there at all").toBe(404);
});

test("a statement exists from its issue date, an assessment from its assessed date", async () => {
  await signIn(ctx, "myguv", VISITOR);
  const has = async (asOf, name) => (await getJson(ctx, `/api/files?brand=myguv&as_of=${asOf}`)).files.some((f) => f.name === name);
  expect(await has("2026-09-05", "Notice-of-Assessment-Mia-FY2026.pdf")).toBe(false);
  expect(await has("2026-09-06", "Notice-of-Assessment-Mia-FY2026.pdf")).toBe(true);
  await signIn(ctx, "amewx", VISITOR);
  const amewx = async (asOf) => (await getJson(ctx, `/api/files?brand=amewx&as_of=${asOf}`)).files.map((f) => f.name);
  expect(await amewx("2027-01-13")).not.toContain("Amewx-Statement-2027-01-14.pdf");
  expect(await amewx("2027-01-14")).toContain("Amewx-Statement-2027-01-14.pdf");
  await signIn(ctx, "pawroll", VISITOR);
  const pay = await getJson(ctx, `/api/accounts?brand=pawroll&account=${encodeURIComponent("Mia@Bayview Health")}&docs=1&as_of=2026-07-13`);
  const labels = pay.groups.flatMap((g) => g.docs.map((d) => d.label));
  expect(labels.join("|"), "an income statement arrives two weeks after 30 June").not.toContain("Income statement FY2025-26");
  const pay2 = await getJson(ctx, `/api/accounts?brand=pawroll&account=${encodeURIComponent("Mia@Bayview Health")}&docs=1&as_of=2026-07-14`);
  expect(pay2.groups.flatMap((g) => g.docs.map((d) => d.label))).toContain("Income statement FY2025-26");
});

test("an account opened after the clock is not there, and a loan shows its balance at the last month closed", async () => {
  await signIn(ctx, "westpaw", VISITOR);
  const j = await getJson(ctx, "/api/accounts?brand=westpaw&as_of=2021-01-20");
  expect(j.accounts.map((a) => a.id)).toEqual(["ACC-EVD", "ACC-OFF", "LN-HOME"]);
  expect(j.accounts.find((a) => a.id === "LN-HOME").balance).toBeCloseTo(-MONTHS.loans["LN-HOME"].months["2020-12"].closing, 2);
  await signIn(ctx, "propertymeow", VISITOR);
  expect((await getJson(ctx, "/api/accounts?brand=propertymeow&as_of=2021-01-20")).accounts).toEqual([]);
  await signIn(ctx, "purrsure", VISITOR);
  const pol = await getJson(ctx, "/api/accounts?brand=purrsure&as_of=2021-01-20");
  expect(pol.accounts.map((a) => a.id).sort()).toEqual(["POL-CAR", "POL-HOME"]);
  for (const p of pol.accounts.flatMap((a) => a.presets)) expect(p.from <= "2021-01-20").toBe(true);
  const r = await ctx.get(`/api/export?brand=purrsure&account=POL-HOME&from=2030-01-01&to=2031-01-01&format=renewal&as_of=2021-01-20`);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-disposition"], "falls back to the last period that existed, not a later one").toContain("2020");
});

test("a chapter stands on the day the life plays it, and the clock's words are today or as_of", async () => {
  await signIn(ctx, "westpaw", VISITOR);
  const set = await setClock(ctx, { chapter: 1 });
  expect(set).toMatchObject({ today: "2027-01-16", chapter: 1 });
  expect((await getJson(ctx, "/api/accounts?brand=westpaw")).chapter).toBe(1);
  expect((await getJson(ctx, "/api/accounts?brand=westpaw&chapter=4")).as_of).toBe("2027-10-31");
  expect((await getJson(ctx, "/api/accounts?brand=westpaw&today=2026-06-30")).as_of).toBe("2026-06-30");
  expect((await getJson(ctx, "/api/accounts?brand=westpaw&as_of=2026-06-30")).as_of).toBe("2026-06-30");
  expect((await getJson(ctx, "/api/clock")).chapters.find((c) => c.chapter === 6)).toEqual({ chapter: 6, today: "2036-03-31" });
  expect(JSON.stringify((await getJson(ctx, "/api/clock")).chapters), "the days, not the story").not.toContain("separate");
});

test("a clock written wrongly is refused, and one clock holds across every portal in a browser", async () => {
  await signIn(ctx, "westpaw", VISITOR);
  expect((await ctx.get("/api/accounts?brand=westpaw&as_of=31-01-2027")).status()).toBe(400);
  expect((await ctx.post("/api/clock", { headers: API, data: { as_of: "2027-02-31" } })).status()).toBe(400);
  expect((await ctx.post("/api/clock", { headers: API, data: { chapter: 99 } })).status()).toBe(400);
  const chapters = (await getJson(ctx, "/api/clock")).chapters;
  expect(chapters.map((c) => c.chapter)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  await setClock(ctx, { as_of: "2023-06-30" });
  await signIn(ctx, "ping", VISITOR);
  expect((await getJson(ctx, "/api/accounts?brand=ping")).as_of).toBe("2023-06-30");
  expect((await getJson(ctx, "/api/accounts?brand=westpaw")).as_of).toBe("2023-06-30");
  expect((await getJson(ctx, "/api/accounts?brand=ping&as_of=2027-01-31")).as_of, "the query beats the cookie").toBe("2027-01-31");
  await setClock(ctx, { as_of: "" });
  expect((await getJson(ctx, "/api/accounts?brand=ping")).as_of).toBeNull();
});

test("a chapter link sets the clock in a browser, and the page says so", async ({ page }) => {
  await page.goto("/westpaw?chapter=1");
  await page.fill("#name", VISITOR);
  await page.fill("#password", "demo");
  await page.click("#loginbtn");
  await expect(page.locator(".greet")).toBeVisible();
  await expect(page.locator("#clockline")).toContainText("16 Jan 2027");
  await expect(page.locator(".acct").first()).toContainText("as at 16 Jan 2027");
});
