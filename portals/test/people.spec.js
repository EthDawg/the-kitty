// Who is signed in. Any name still sees the household. Danny and Daisy see their own, and meet the friction a real site has.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { session, signIn, setClock, getJson, API } = require("./helpers");

const RULES = require("../data/portal-rules.json");
const brands = () => [...require("../public/brands.json"), ...require("../public/vault-brands.json")];
const access = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "estate", "access.json"), "utf8")).subjects;

let daisy, danny, anyone;
test.beforeEach(async ({ playwright, baseURL }) => { [daisy, danny, anyone] = await Promise.all([session(playwright, baseURL), session(playwright, baseURL), session(playwright, baseURL)]); });
test.afterEach(async () => { await Promise.all([daisy.dispose(), danny.dispose(), anyone.dispose()]); });

const ids = async (ctx, brand) => (await getJson(ctx, `/api/accounts?brand=${brand}`)).accounts.map((a) => a.id);

test("any name sees the whole household, and no friction", async () => {
  const j = await signIn(anyone, "pawroll", "Somebody Else");
  expect(j.person).toBeNull();
  expect(await ids(anyone, "pawroll")).toEqual(["Jordan@Northwind Logistics", "Mia@Bayview Health"]);
  expect((await getJson(anyone, "/api/accounts?brand=pawroll")).rules.back_years).toBeNull();
});

test("Daisy sees her own payroll and not Danny's, and the same the other way", async () => {
  expect((await signIn(daisy, "pawroll", "Daisy")).person.id).toBe("daisy");
  expect((await signIn(danny, "pawroll", "danny davies")).person.id).toBe("danny");
  expect(await ids(daisy, "pawroll")).toEqual(["Mia@Bayview Health"]);
  expect(await ids(danny, "pawroll")).toEqual(["Jordan@Northwind Logistics"]);
  const peek = await daisy.get(`/api/accounts?brand=pawroll&account=${encodeURIComponent("Jordan@Northwind Logistics")}&from=2026-01-01&to=2026-02-01`);
  expect(peek.status(), "asking for Danny's pay by name finds nothing").toBe(404);
  const file = await daisy.get("/vault/PAY-J/2027-01-14/Pawroll-Payslip-Jordan-2027-01-14.pdf");
  expect(file.status(), "nor does his payslip's address").toBe(404);
  expect((await getJson(daisy, "/api/files?brand=pawroll")).streams.map((s) => s.id).sort()).toEqual(["IS-M", "IS-M2", "PAY-M", "PAY-M2"]);
});

test("the old names sign in as the same people", async () => {
  expect((await signIn(daisy, "pawroll", "Mia")).person.id).toBe("daisy");
  expect((await signIn(danny, "pawroll", "Jordan Davies")).person.id).toBe("danny");
});

test("the card is Danny's. The joint accounts are both of theirs", async () => {
  await signIn(daisy, "amewx", "Daisy");
  await signIn(danny, "amewx", "Danny");
  expect(await ids(danny, "amewx")).toEqual(["ACC-CC"]);
  expect(await ids(daisy, "amewx"), "the card company signs in its member").toEqual([]);
  expect((await getJson(daisy, "/api/files?brand=amewx")).files).toEqual([]);
  expect((await daisy.get("/api/export?brand=amewx&account=ACC-CC&from=2027-01-01&to=2027-01-31&format=csv")).status()).toBe(404);
  await signIn(daisy, "westpaw", "Daisy");
  await signIn(danny, "westpaw", "Danny");
  expect(await ids(daisy, "westpaw")).toEqual(await ids(danny, "westpaw"));
  expect(await ids(daisy, "westpaw")).toContain("ACC-EVD");
});

test("who holds what follows the date: the saver is joint until 1 July 2024, then Daisy's", async () => {
  await signIn(danny, "ping", "Danny");
  await signIn(daisy, "ping", "Daisy");
  await setClock(danny, { as_of: "2024-06-30" });
  await setClock(daisy, { as_of: "2024-06-30" });
  expect(await ids(danny, "ping")).toContain("ACC-SAV");
  expect(await ids(daisy, "ping")).toContain("ACC-SAV");
  await setClock(danny, { as_of: "2024-07-01" });
  await setClock(daisy, { as_of: "2024-07-01" });
  expect(await ids(danny, "ping")).not.toContain("ACC-SAV");
  expect(await ids(daisy, "ping")).toContain("ACC-SAV");
});

test("the access table comes from the world, with the card as the one stated exception", async () => {
  const a = access();
  const parties = (id) => a[id].map((r) => r.party).sort();
  expect(parties("ACC-EVD")).toEqual(["JORDAN", "MIA"]);
  expect(parties("PAY-J")).toEqual(["JORDAN"]);
  expect(parties("HELP-M")).toEqual(["MIA"]);
  expect(parties("LN-INV2")).toEqual(["MIA"]);
  expect(parties("CHILDCARE"), "a child's paper is both parents'").toEqual(["JORDAN", "MIA"]);
  const ownership = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "standard", ".build", "world", "setup", "ownership.json"), "utf8"));
  expect(ownership.filter((o) => o.subject_id === "ACC-CC" && o.basis === "legal").map((o) => o.party_id).sort(), "the world holds the card 50/50").toEqual(["JORDAN", "MIA"]);
  expect(parties("ACC-CC"), "and the portal signs in the card member").toEqual(["JORDAN"]);
  expect(Object.keys(RULES.access).filter((k) => !k.startsWith("_"))).toEqual(["ACC-CC", "ACC-CC-STMT"]);
});

test("every portal has its friction as data", () => {
  for (const b of brands()) expect(RULES.portals[b.id], b.id).toBeTruthy();
  const kinds = ["second_factor", "back_years", "window_days", "gap_seconds"];
  for (const k of kinds) expect(Object.values(RULES.portals).some((r) => r[k]), k).toBeTruthy();
});

test("a mock second factor: no cookie without the code, a wrong code is refused, and the code is on screen", async ({ page }) => {
  const first = await (await daisy.post("/api/login", { headers: API, data: { brand: "westpaw", name: "Daisy", password: "demo" } })).json();
  expect(first.needs_code).toBe(true);
  expect(first.code).toMatch(/^\d{6}$/);
  expect((await daisy.get("/api/accounts?brand=westpaw")).status(), "no code, no cookie").toBe(401);
  const wrong = await daisy.post("/api/login", { headers: API, data: { brand: "westpaw", name: "Daisy", password: "demo", code: first.code === "000000" ? "000001" : "000000" } });
  expect(wrong.status()).toBe(401);
  expect((await daisy.get("/api/accounts?brand=westpaw")).status()).toBe(401);
  // a portal without one signs in straight away, and any name is never asked
  expect((await (await danny.post("/api/login", { headers: API, data: { brand: "pawroll", name: "Danny", password: "demo" } })).json()).ok).toBe(true);
  expect((await (await anyone.post("/api/login", { headers: API, data: { brand: "westpaw", name: "Anyone", password: "demo" } })).json()).ok).toBe(true);

  await page.goto("/westpaw");
  await page.fill("#name", "Daisy");
  await page.fill("#password", "demo");
  await page.click("#loginbtn");
  await expect(page.locator("#codebox")).toBeVisible();
  const code = await page.locator("#codeshown").textContent();
  await expect(page.locator("#view")).toBeHidden();
  await page.fill("#code", code);
  await page.click("#loginbtn");
  await expect(page.locator(".greet")).toContainText("Daisy");
  await expect(page.locator("#whoname")).toHaveText("Signed in as Daisy Davies");
});

test("statements only go back so many years, and an export only covers so many days", async () => {
  await signIn(daisy, "westpaw", "Daisy");
  await setClock(daisy, { chapter: 1 }); // seven years back, 366 days at a time
  const docs = await getJson(daisy, "/api/accounts?brand=westpaw&account=ACC-EVD&docs=1");
  const froms = docs.groups.flatMap((g) => g.docs).map((d) => d.to).sort();
  expect(froms[0] >= "2020-01-31", `oldest is ${froms[0]}`).toBe(true);
  const vault = await getJson(daisy, "/api/files?brand=westpaw");
  for (const f of vault.files) expect(f.exists_from >= "2020-01-31", f.name).toBe(true);
  const old = await daisy.get("/api/export?brand=westpaw&account=ACC-EVD&from=2019-04-01&to=2019-04-30&format=csv");
  expect(old.status()).toBe(403);
  expect((await old.json()).error).toContain("7 years");
  const wide = await daisy.get("/api/export?brand=westpaw&account=ACC-EVD&from=2024-01-01&to=2025-06-30&format=csv");
  expect(wide.status()).toBe(400);
  expect((await wide.json()).error).toContain("366 days");
  const acct = (await getJson(daisy, "/api/accounts?brand=westpaw")).accounts.find((a) => a.id === "ACC-EVD");
  expect(acct.presets.every((p) => !p.label.startsWith("Everything"))).toBe(true);
  // the same questions from the any-name door go through
  await signIn(anyone, "westpaw", "Anyone");
  expect((await anyone.get("/api/export?brand=westpaw&account=ACC-EVD&from=2019-04-01&to=2025-06-30&format=csv")).status()).toBe(200);
});

test("the history limit counts from the clock, past the end of the world too", async () => {
  await signIn(daisy, "kittenhood", "Daisy");
  expect((await getJson(daisy, "/api/files?brand=kittenhood&as_of=2031-06-30")).files, "two years back from 2031 is after the world ends").toEqual([]);
  expect((await getJson(daisy, "/api/files?brand=kittenhood&as_of=2027-01-31")).files.length).toBeGreaterThan(0);
});

test("one document at a time: a second download waits, then goes through", async () => {
  await signIn(daisy, "westpaw", "Daisy");
  const url = "/api/export?brand=westpaw&account=ACC-EVD&from=2027-01-01&to=2027-01-31&format=csv";
  expect((await daisy.get(url)).status()).toBe(200);
  const held = await daisy.get(url);
  expect(held.status()).toBe(429);
  expect(Number(held.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await held.json()).error).toContain("one document at a time");
  await new Promise((r) => setTimeout(r, 2200));
  expect((await daisy.get(url)).status()).toBe(200);
});

test("a person with nothing at a portal gets an empty page that says so, not a crash", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const brand of ["commbark", "purrannuation"]) {
    await page.goto(`/${brand}`);
    await page.fill("#name", "Daisy");
    await page.fill("#password", "demo");
    await page.click("#loginbtn");
    await expect(page.locator("#codebox")).toBeVisible();
    await page.fill("#code", await page.locator("#codeshown").textContent());
    await page.click("#loginbtn");
    await expect(page.locator("#view")).toContainText("in Daisy's name");
  }
  expect(errors).toEqual([]);
});
