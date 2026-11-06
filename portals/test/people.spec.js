// Who is signed in. Any name still sees the household. Jordan, Mia and Ava, the benchmark world's own people, see their own and meet the friction a real site has.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { session, signIn, getJson, API } = require("./helpers");

const RULES = require("../data/portal-rules.json");
const brands = () => [...require("../public/brands.json"), ...require("../public/vault-brands.json")];
const access = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "estate", "benchmark", "access.json"), "utf8")).subjects;

let mia, jordan, anyone;
test.beforeEach(async ({ playwright, baseURL }) => { [mia, jordan, anyone] = await Promise.all([session(playwright, baseURL), session(playwright, baseURL), session(playwright, baseURL)]); });
test.afterEach(async () => { await Promise.all([mia.dispose(), jordan.dispose(), anyone.dispose()]); });

const ids = async (ctx, brand, extra = "") => (await getJson(ctx, `/api/accounts?brand=${brand}${extra}`)).accounts.map((a) => a.id);

test("any name sees the whole household, and no friction", async () => {
  const j = await signIn(anyone, "pawroll", "Somebody Else");
  expect(j.person).toBeNull();
  expect(await ids(anyone, "pawroll")).toEqual(["Jordan@Northwind Logistics", "Mia@Bayview Health"]);
  expect((await getJson(anyone, "/api/accounts?brand=pawroll")).rules.back_years).toBeNull();
});

test("Mia sees her own payroll and not Jordan's, and the same the other way", async () => {
  expect((await signIn(mia, "pawroll", "mia")).person.id).toBe("mia");
  expect((await signIn(jordan, "pawroll", "Jordan Davies")).person.id).toBe("jordan");
  expect(await ids(mia, "pawroll")).toEqual(["Mia@Bayview Health"]);
  expect(await ids(jordan, "pawroll")).toEqual(["Jordan@Northwind Logistics"]);
  const peek = await mia.get(`/api/accounts?brand=pawroll&account=${encodeURIComponent("Jordan@Northwind Logistics")}&from=2026-01-01&to=2026-02-01`);
  expect(peek.status(), "asking for Jordan's pay by name finds nothing").toBe(404);
  expect((await getJson(mia, "/api/files?brand=pawroll")).streams.map((s) => s.id).sort()).toEqual(["IS-M", "IS-M2", "PAY-M", "PAY-M2"]);
});

test("Danny and Daisy are not in the benchmark world: no one-click, and no person behind the name", async () => {
  const people = (await getJson(anyone, "/api/login")).people.map((p) => p.first_name);
  expect(people).toEqual(["Jordan", "Mia", "Ava"]);
  expect((await anyone.post("/api/login", { headers: API, data: { brand: "westpaw", person: "daisy" } })).status()).toBe(404);
  expect((await signIn(anyone, "pawroll", "Daisy")).person, "typed, it is any name at the old door").toBeNull();
});

test("the card is Jordan's. The joint accounts are both of theirs", async () => {
  await signIn(mia, "amewx", "mia");
  await signIn(jordan, "amewx", "jordan");
  expect(await ids(jordan, "amewx")).toEqual(["ACC-CC"]);
  expect(await ids(mia, "amewx"), "the card company signs in its member").toEqual([]);
  expect((await getJson(mia, "/api/files?brand=amewx")).files).toEqual([]);
  expect((await mia.get("/api/export?brand=amewx&account=ACC-CC&from=2027-01-01&to=2027-01-31&format=csv")).status()).toBe(404);
  await signIn(mia, "westpaw", "mia");
  await signIn(jordan, "westpaw", "jordan");
  expect(await ids(mia, "westpaw")).toEqual(await ids(jordan, "westpaw"));
  expect(await ids(mia, "westpaw")).toContain("ACC-EVD");
});

test("who holds what follows the date: the saver is joint until 1 July 2024, then Mia's", async () => {
  await signIn(jordan, "ping", "jordan");
  await signIn(mia, "ping", "mia");
  expect(await ids(jordan, "ping", "&today=2024-06-30")).toContain("ACC-SAV");
  expect(await ids(mia, "ping", "&today=2024-06-30")).toContain("ACC-SAV");
  expect(await ids(jordan, "ping", "&today=2024-07-01")).not.toContain("ACC-SAV");
  expect(await ids(mia, "ping", "&today=2024-07-01")).toContain("ACC-SAV");
});

test("Ava is a person too: her own childcare papers, and little else", async () => {
  await signIn(anyone, "kittenhood", "ava");
  expect((await getJson(anyone, "/api/files?brand=kittenhood")).files.length).toBeGreaterThan(0);
  await signIn(anyone, "pawroll", "ava");
  expect(await ids(anyone, "pawroll")).toEqual([]);
});

test("the access table comes from the world, with the card as the one stated exception", async () => {
  const a = access();
  const parties = (id) => a[id].map((r) => r.party).sort();
  expect(parties("ACC-EVD")).toEqual(["JORDAN", "MIA"]);
  expect(parties("PAY-J")).toEqual(["JORDAN"]);
  expect(parties("HELP-M")).toEqual(["MIA"]);
  expect(parties("LN-INV2")).toEqual(["MIA"]);
  expect(parties("CHILDCARE"), "a child's paper is theirs and both parents'").toEqual(["AVA", "JORDAN", "MIA"]);
  const ownership = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "standard", ".build", "world", "setup", "ownership.json"), "utf8"));
  expect(ownership.filter((o) => o.subject_id === "ACC-CC" && o.basis === "legal").map((o) => o.party_id).sort(), "the world holds the card 50/50").toEqual(["JORDAN", "MIA"]);
  expect(parties("ACC-CC"), "and the portal signs in the card member").toEqual(["JORDAN"]);
  expect(Object.keys(RULES.access).filter((k) => !k.startsWith("_"))).toEqual(["ACC-CC", "ACC-CC-STMT"]);
});

test("every portal has its friction as data", () => {
  for (const b of brands()) expect(RULES.portals[b.id], b.id).toBeTruthy();
  for (const k of ["second_factor", "back_years", "window_days", "gap_seconds"]) expect(Object.values(RULES.portals).some((r) => r[k]), k).toBeTruthy();
});

test("a mock second factor: no cookie without the code, a wrong code is refused, and the code is on screen", async ({ page }) => {
  const first = await (await mia.post("/api/login", { headers: API, data: { brand: "westpaw", person: "mia" } })).json();
  expect(first.needs_code).toBe(true);
  expect(first.code).toMatch(/^\d{6}$/);
  expect((await mia.get("/api/accounts?brand=westpaw")).status(), "no code, no cookie").toBe(401);
  const wrong = await mia.post("/api/login", { headers: API, data: { brand: "westpaw", person: "mia", code: first.code === "000000" ? "000001" : "000000" } });
  expect(wrong.status()).toBe(401);
  expect((await mia.get("/api/accounts?brand=westpaw")).status()).toBe(401);
  expect((await (await jordan.post("/api/login", { headers: API, data: { brand: "pawroll", person: "jordan" } })).json()).ok, "a portal without one signs in straight away").toBe(true);
  expect((await (await anyone.post("/api/login", { headers: API, data: { brand: "westpaw", name: "Anyone", password: "demo" } })).json()).ok, "any name is never asked").toBe(true);

  await page.goto("/westpaw");
  await page.fill("#name", "Mia");
  await page.fill("#password", "demo");
  await page.click("#loginbtn");
  await expect(page.locator("#codebox")).toBeVisible();
  const code = await page.locator("#codeshown").textContent();
  await expect(page.locator("#view")).toBeHidden();
  await page.fill("#code", code);
  await page.click("#loginbtn");
  await expect(page.locator(".greet")).toContainText("Mia");
  await expect(page.locator("#whoname")).toHaveText("Signed in as Mia Davies");
});

test("one click and no password, by the API: the person is chosen, and the code still stands", async () => {
  expect((await getJson(anyone, "/api/login")).people).toEqual([{ id: "jordan", first_name: "Jordan" }, { id: "mia", first_name: "Mia" }, { id: "ava", first_name: "Ava" }]);
  const first = await (await mia.post("/api/login", { headers: API, data: { brand: "westpaw", person: "mia" } })).json();
  expect(first.needs_code).toBe(true);
  const second = await (await mia.post("/api/login", { headers: API, data: { brand: "westpaw", person: "mia", code: first.code } })).json();
  expect(second.person.id).toBe("mia");
  const seen = await getJson(mia, "/api/accounts?brand=westpaw");
  expect(seen.person.id).toBe("mia");
  expect(seen.rules.back_years, "a person, with a person's friction").toBe(7);
  expect((await anyone.post("/api/login", { headers: API, data: { brand: "westpaw", person: "nobody" } })).status()).toBe(404);
  expect((await anyone.post("/api/login", { headers: API, data: { brand: "westpaw", name: "No Password" } })).status(), "the old door still wants its password").toBe(401);
});

test("one click in a browser: every portal offers it, and nothing is typed, the code included", async ({ page }) => {
  for (const b of brands()) {
    await page.goto(`/${b.id}`);
    for (const who of ["Jordan", "Mia", "Ava"]) await expect(page.getByRole("button", { name: `Continue as ${who}` }), b.id).toBeVisible();
    await expect(page.locator("#name"), `${b.id} keeps the old door`).toBeVisible();
  }
  await page.goto("/westpaw");
  await page.getByRole("button", { name: "Continue as Mia" }).click();
  await expect(page.locator("#codebox")).toBeVisible();
  await expect(page.locator("#codeshown")).toHaveText(/^\d{6}$/);
  await expect(page.locator("#view")).toBeHidden();
  await page.click("#usecode");
  await expect(page.locator(".greet")).toContainText("Mia");
  await expect(page.locator("#whoname")).toHaveText("Signed in as Mia Davies");
  await page.goto("/pawroll");
  await page.getByRole("button", { name: "Continue as Jordan" }).click();
  await expect(page.locator(".greet")).toContainText("Jordan");
  await expect(page.locator(".acct")).toHaveCount(1);
});

test("a code can still be typed after one click, and a person can still type a name and the password", async ({ page }) => {
  await page.goto("/westpaw");
  await page.getByRole("button", { name: "Continue as Jordan" }).click();
  await expect(page.locator("#codebox")).toBeVisible();
  await page.fill("#code", await page.locator("#codeshown").textContent());
  await page.click("#loginbtn");
  await expect(page.locator(".greet")).toContainText("Jordan");
  await page.click("#signout");
  await expect(page.locator("#signin")).toBeVisible();
  await page.fill("#name", "Anyone At All");
  await page.fill("#password", "demo");
  await page.click("#loginbtn");
  await expect(page.locator("#whoname")).toHaveText("Signed in as Anyone At All");
  await expect(page.locator(".acct").first()).toBeVisible();
});

test("statements only go back so many years, and an export only covers so many days", async () => {
  await signIn(mia, "westpaw", "mia");
  const T = "today=2027-01-16"; // seven years back, 366 days at a time
  const dates = (await getJson(mia, `/api/accounts?brand=westpaw&account=ACC-EVD&docs=1&${T}`)).groups.flatMap((g) => g.docs).map((d) => d.to).sort();
  expect(dates[0] >= "2020-01-16", `oldest is ${dates[0]}`).toBe(true);
  for (const f of (await getJson(mia, `/api/files?brand=westpaw&${T}`)).files) expect(f.delivered_on >= "2020-01-16", f.name).toBe(true);
  const old = await mia.get(`/api/export?brand=westpaw&account=ACC-EVD&from=2019-04-01&to=2019-04-30&format=csv&${T}`);
  expect(old.status()).toBe(403);
  expect((await old.json()).error).toContain("7 years");
  const wide = await mia.get(`/api/export?brand=westpaw&account=ACC-EVD&from=2024-01-01&to=2025-06-30&format=csv&${T}`);
  expect(wide.status()).toBe(400);
  expect((await wide.json()).error).toContain("366 days");
  const acct = (await getJson(mia, `/api/accounts?brand=westpaw&${T}`)).accounts.find((a) => a.id === "ACC-EVD");
  expect(acct.presets.every((p) => !p.label.startsWith("Everything"))).toBe(true);
  await signIn(anyone, "westpaw", "Anyone");
  expect((await anyone.get("/api/export?brand=westpaw&account=ACC-EVD&from=2019-04-01&to=2025-06-30&format=csv")).status(), "the any-name door goes through").toBe(200);
});

test("the history limit counts from today, past the end of the world too", async () => {
  await signIn(mia, "kittenhood", "mia");
  expect((await getJson(mia, "/api/files?brand=kittenhood&today=2031-06-30")).files, "two years back from 2031 is after the world ends").toEqual([]);
  expect((await getJson(mia, "/api/files?brand=kittenhood&today=2027-01-16")).files.length).toBeGreaterThan(0);
});

test("one export at a time: a second waits, then goes through", async () => {
  await signIn(mia, "westpaw", "mia");
  const url = "/api/export?brand=westpaw&account=ACC-EVD&from=2027-01-01&to=2027-01-31&format=csv";
  expect((await mia.get(url)).status()).toBe(200);
  const held = await mia.get(url);
  expect(held.status()).toBe(429);
  expect(Number(held.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await held.json()).error).toContain("one document at a time");
  await new Promise((r) => setTimeout(r, 2200));
  expect((await mia.get(url)).status()).toBe(200);
});

test("a person with nothing at a portal gets an empty page that says so, not a crash", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const brand of ["commbark", "purrannuation"]) {
    await page.goto(`/${brand}`);
    await page.getByRole("button", { name: "Continue as Mia" }).click();
    await expect(page.locator("#codebox")).toBeVisible();
    await page.click("#usecode");
    await expect(page.locator("#view")).toContainText("in Mia's name");
  }
  expect(errors).toEqual([]);
});
