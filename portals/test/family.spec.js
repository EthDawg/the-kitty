// A second family: the portals serve any family the life generator writes, from its manifest, chosen by a parameter, with the benchmark as the default.
// The fixture is hand-made and keeps the contract, so this proves the portals without waiting for the generator.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { session, signIn, getJson, tool, API } = require("./helpers");

const ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(__dirname, "fixtures", "families", "fixture");
const estate = (f) => path.join(__dirname, "..", "estate", f);
const F = "family=fixture";

test.beforeAll(() => {
  const built = fs.existsSync(estate("families.json")) && JSON.parse(fs.readFileSync(estate("families.json"), "utf8")).families.some((f) => f.id === "fixture");
  if (!built) execFileSync("node", ["portals/build-vault.js", "--fixture"], { cwd: ROOT, stdio: "pipe" });
});

let wren, ash;
test.beforeEach(async ({ playwright, baseURL }) => { [wren, ash] = await Promise.all([session(playwright, baseURL), session(playwright, baseURL)]); });
test.afterEach(async () => { await Promise.all([wren.dispose(), ash.dispose()]); });

test("the benchmark is the default, a family is a parameter, and an unknown one is refused", async () => {
  expect((await getJson(wren, "/api/login")).people.map((p) => p.first_name)).toEqual(["Jordan", "Mia", "Ava"]);
  expect((await getJson(wren, `/api/login?${F}`)).people.map((p) => p.first_name)).toEqual(["Wren", "Ash"]);
  expect((await wren.get("/api/login?family=nobody", { headers: API })).status()).toBe(404);
  expect((await wren.post("/api/login", { headers: API, data: { brand: "ping", person: "mia", family: "fixture" } })).status(), "Mia is not in this family").toBe(404);
  expect((await wren.post("/api/login", { headers: API, data: { brand: "ping", person: "wren" } })).status(), "and Wren is not in the benchmark").toBe(404);
});

test("a family's people sign in with one click and the code, and a sign-in does not cross families", async () => {
  const j = await signIn(wren, "ping", "wren", { family: "fixture" });
  expect(j.person.full_name).toBe("Wren Testcat");
  const a = await getJson(wren, `/api/accounts?brand=ping&${F}`);
  expect(a.person.id).toBe("wren");
  expect(a.accounts, "a generated family's portals list files, and generate nothing").toEqual([]);
  expect((await wren.get("/api/accounts?brand=ping")).status(), "the benchmark's Ping still wants its own sign-in").toBe(401);
});

test("a listing comes from the manifest, by person and by delivered date", async () => {
  await signIn(wren, "ping", "wren", { family: "fixture" });
  await signIn(ash, "ping", "ash", { family: "fixture" });
  const names = async (ctx, brand, extra = "") => (await getJson(ctx, `/api/files?brand=${brand}&${F}${extra}`)).files.map((f) => f.name).sort();
  expect(await names(wren, "ping")).toEqual(["Transactions-2.csv", "Transactions.csv"]);
  expect(await names(wren, "ping", "&today=2027-01-31"), "the second was delivered on 9 February").toEqual(["Transactions.csv"]);
  expect(await names(ash, "ping"), "Wren's account is not Ash's").toEqual([]);
  const s = (await getJson(wren, `/api/files?brand=ping&${F}`)).streams;
  expect(s).toEqual([{ brand: "ping", id: "EVERY-A", name: "Wren's everyday", files: 2, first: "2027-01-09", last: "2027-02-09" }]);
  await signIn(wren, "westpaw", "wren", { family: "fixture" });
  await signIn(ash, "westpaw", "ash", { family: "fixture" });
  expect(await names(wren, "westpaw"), "a joint account is both of theirs").toEqual(["Data.csv"]);
  expect(await names(ash, "westpaw")).toEqual(["Data.csv"]);
});

test("the files are in the same static place, with the manifest's bytes", async ({ request }) => {
  await signIn(wren, "ping", "wren", { family: "fixture" });
  const f = (await getJson(wren, `/api/files?brand=ping&${F}`)).files[0];
  expect(f.path.startsWith("vault/fixture/")).toBe(true);
  const r = await request.get(`/${f.path}`);
  expect(r.status()).toBe(200);
  expect((await r.body()).equals(fs.readFileSync(path.join(FIXTURE, f.path.replace("vault/fixture/", ""))))).toBe(true);
});

test("its Drive and inbox come from its own mess, and the benchmark's stay out", async () => {
  await signIn(wren, "litterbox", "wren", { family: "fixture" });
  await signIn(ash, "litterbox", "ash", { family: "fixture" });
  const q = (ctx, query, extra = "") => tool(ctx, `/api/drive/search_files?${F}${extra}`, { query, pageSize: 100 });
  const titles = (j) => j.files.map((f) => f.title).sort();
  expect(titles(await q(wren, "parentId = 'root'"))).toEqual(["Family", "Wren's files"]);
  expect(titles(await q(ash, "parentId = 'root'"))).toEqual(["Family"]);
  expect(titles(await q(wren, "title contains 'scan0001'"))).toEqual(["scan0001.csv"]);
  expect(titles(await q(wren, "title contains 'scan0001'", "&today=2027-01-15")), "the mess lands at its chapter's day").toEqual([]);
  expect(titles(await q(wren, "title contains 'Deductions'")), "a file the manifest keeps in a Drive").toEqual(["Deductions-FY2026.csv"]);
  expect(titles(await q(wren, "title contains 'scan0003'")), "no benchmark files").toEqual([]);
  const scan = (await q(wren, "title contains 'scan0001'")).files[0];
  expect((await tool(wren, `/api/drive/read_file_content?${F}`, { fileId: scan.id })).content).toContain("fixture");
  expect((await tool(ash, `/api/drive/read_file_content?${F}`, { fileId: scan.id })).status).toBe(404);

  const mail = async (ctx, query, extra = "") => getJson(ctx, `/api/mail/search_threads?${new URLSearchParams({ query })}&${F}${extra}`);
  expect((await mail(wren, "subject:fixture")).total).toBe(1);
  expect((await mail(wren, "subject:fixture", "&today=2027-01-31")).total).toBe(0);
  expect((await mail(ash, "subject:fixture")).total).toBe(0);
  const withFile = (await mail(wren, "has:attachment")).threads.find((t) => t.subject === "Your return");
  const t = await getJson(wren, `/api/mail/get_thread?threadId=${withFile.id}&${F}`);
  expect(t.messages[0].attachments.map((a) => a.filename), "an email carries the file it says it carries").toEqual(["Tax-Return-Wren-FY2026.csv"]);
});

test("Tabby Tax has its own checklist for a family, and reads its people", async () => {
  await signIn(wren, "tabbytax", "wren", { family: "fixture" });
  const list = await getJson(wren, `/api/tabby/checklist?${F}`);
  expect(list.items.map((i) => i.id)).toEqual(["prior-return", "year-summary"]);
  const r = await tool(wren, `/api/tabby/message?${F}`, { body: "Hello.", attachments: [{ filename: "Tax-Return-Wren-FY2026.csv", content: fs.readFileSync(path.join(FIXTURE, "sources/TAX-A/2026-09-14/Tax-Return-Wren-FY2026.csv")).toString("base64") }] });
  expect(r.reply).toContain("Hi Wren,");
  expect(r.items.find((i) => i.id === "prior-return").state).toBe("received");
  expect(r.reply).not.toContain("Geelong");
});

test("a person uses a family's portals in a browser, and every link keeps the family", async ({ page }) => {
  await page.goto(`/ping?${F}`);
  await expect(page.getByRole("button", { name: "Continue as Wren" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue as Mia" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue as Wren" }).click();
  await expect(page.locator("#codebox")).toBeVisible();
  await page.click("#usecode");
  await expect(page.locator(".greet")).toContainText("Wren");
  await expect(page.locator("#docs")).toContainText("Wren's everyday");
  await page.selectOption("#brandswitch", "litterbox");
  await expect(page).toHaveURL(/\/litterbox\?family=fixture$/);
  await page.getByRole("button", { name: "Continue as Wren" }).click();
  await expect(page.locator('#dtree a[data-folder="tax stuff"]')).toBeVisible();
  await page.goto(`/?${F}`);
  await expect(page.locator('.brandcard[href="/ping?family=fixture"]')).toBeVisible();
});

test("a broken manifest stops the build rather than serving half a family", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kitty-family-")), out = fs.mkdtempSync(path.join(os.tmpdir(), "kitty-estate-"));
  const { buildFamily } = require("../build-family");
  const brands = [...require("../public/brands.json"), ...require("../public/vault-brands.json")];
  const m = JSON.parse(fs.readFileSync(path.join(FIXTURE, "manifest.json"), "utf8"));
  const tryWith = async (change) => {
    const copy = JSON.parse(JSON.stringify(m)); change(copy);
    fs.rmSync(dir, { recursive: true, force: true }); fs.cpSync(FIXTURE, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(copy));
    fs.mkdirSync(path.join(out, "public"), { recursive: true });
    return buildFamily({ dir, ESTATE: out, PUBLIC: path.join(out, "public"), brands });
  };
  return Promise.all([]).then(async () => {
    await expect(tryWith((x) => { delete x.files[0].delivered_on; })).rejects.toThrow(/no delivered_on/);
    await expect(tryWith((x) => { delete x.files[0].person; })).rejects.toThrow(/no person/);
    await expect(tryWith((x) => { x.files[0].sha256 = "0".repeat(64); })).rejects.toThrow(/hash/);
    await expect(tryWith((x) => { x.files[0].brand = "not-a-portal"; })).rejects.toThrow(/no portal called/);
    await expect(tryWith((x) => { x.family = "benchmark"; })).rejects.toThrow(/reserved/);
    await expect(tryWith((x) => { x.files[0].path = "../../../etc/passwd"; })).rejects.toThrow(/leaves the family's folder/);
    await expect(tryWith(() => {})).resolves.toBeTruthy();
  });
});
