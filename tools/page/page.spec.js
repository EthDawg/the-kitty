/* Chapters 1 and 2 of the Davies' life, played on the real page with a generated file, in a real browser, asserting the words a person reads. The host is fake and the page
   is not: the runtime comes out of the page's own gzip when someone clicks Start yours. KITTY_LIFE_OUT points at life/world/out, KITTY_SHOTS at a folder for screenshots. */
const path = require("path"), fs = require("fs");
const root = path.join(__dirname, "..", "..");
const { test, expect } = require(path.join(root, "portals", "node_modules", "@playwright", "test"));
const OUT = process.env.KITTY_LIFE_OUT || path.join(root, "life", "world", "out"), SHOTS = process.env.KITTY_SHOTS || "";
const FILE = path.join(OUT, "davies/sources/EVERY-A/2027-01-09/Transactions.csv"), manifest = () => JSON.parse(fs.readFileSync(path.join(OUT, "davies/manifest.json"), "utf8"));
const VENDOR = { "d3.min.js": "d3-7.9.0.min.js", "d3-sankey.min.js": "d3-sankey-0.12.3.min.js", "confetti.browser.min.js": "canvas-confetti-1.9.3.browser.js", "qrcode.min.js": "qrcode-generator-1.4.4.js", "gridstack-all.min.js": "gridstack-14.0.0-all.js" };
const shot = async (page, name, o) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, name), ...o }); } };
const NOT_OURS = /Davies|Jordan|Harbour|Bayside|Geelong|Brunswick|offset|1 accounts|Japan/;
// Setup's bank guide quotes a real bank's own words about its offset account, and its button names the door back to the demo.
const clean = (t, words) => (t === "setup" ? words.replace(/See the Davies/g, "").replace(/[^\n]*OFFSET SAVING[^\n]*/g, "") : words);

async function open(page, { today = "2027-01-16", host = {}, url = "/local-v2.html?noanim" } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/^https:\/\//, (r) => { const f = VENDOR[r.request().url().split("/").pop()]; return f ? r.fulfill({ path: path.join(root, "src/vendor", f), contentType: "text/javascript" }) : r.abort(); });
  await page.clock.setFixedTime(new Date(`${today}T10:00:00+11:00`));
  await page.addInitScript(`window.__HOST__ = ${JSON.stringify(host)};`);
  await page.addInitScript({ path: path.join(__dirname, "fake-host.js") });
  await page.goto(url);
  return errors;
}
const name = async (page, who = "Daisy") => { await page.click("[data-door=yours]"); await page.fill("#hname", who); await page.click("#hnext"); };
const onDevice = async (page, who) => { await name(page, who); await page.click("[data-where=device]"); await page.click("#hnext"); await page.waitForSelector("#hfile"); };
const dropFirst = async (page) => { await page.setInputFiles("#hfile", FILE); await page.waitForSelector("#hyes"); };
const keep = async (page) => { await page.click("#hyes"); await page.waitForSelector("text=Got it."); };
const tab = async (page, t) => { await page.click(`nav.tabs [data-tab=${t}]`); return (await page.locator(`#v-${t}`).innerText()); };
async function everyTab(page) { const out = {}; for (const t of ["home", "activity", "insights", "goals", "records", "setup"]) out[t] = await tab(page, t); return out; }

test("two doors: the Davies are one click away and unchanged, and a viewer who chose goes straight there next time", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator("#onb")).toContainText("See the Davies");
  await expect(page.locator("#onb")).toContainText("Start yours");
  await shot(page, "ch01-1-two-doors.png");
  await page.click("[data-door=demo]");
  await expect(page.locator("#onb")).toBeHidden();
  await expect(page.locator("#v-home")).toContainText("Demo household: the Davies");
  await page.reload();
  await expect(page.locator("#v-home")).toContainText("Demo household: the Davies");
  await expect(page.locator("#onb")).toBeHidden();
  expect(errors).toEqual([]);
});
test("chapter 1: from Start yours to a true Home on one dropped file, with no Davies anywhere", async ({ page }) => {
  const errors = await open(page);
  await onDevice(page);
  await expect(page.locator("#onb")).toContainText("Add your first bank file.");
  await expect(page.locator("#onb")).toContainText("On this device, not saved to your Sheet yet.");
  await page.click("#hlater");

  // A blank Kitty, before any file: every tab reads truthfully and warmly.
  await expect(page.locator(".kh-next")).toContainText("Add your first bank file.");
  await expect(page.locator(".kh-next")).toContainText("One file from your everyday account is enough");
  await expect(page.locator("#v-home")).toContainText("This Kitty is all yours.");
  await shot(page, "ch01-2-blank-kitty.png");
  const blank = await everyTab(page);
  for (const [t, words] of Object.entries(blank)) expect(clean(t, words), t).not.toMatch(NOT_OURS);
  expect(blank.activity).toContain("No lines yet.");
  expect(blank.insights).toContain("Nothing to show yet.");
  expect(blank.goals).toContain("Nothing to save for yet.");
  expect(blank.records).toContain("No records yet.");
  expect(blank.home).not.toMatch(/\$0|net worth|savings rate|safety net/i);
  await tab(page, "home");

  // The file, read by its columns, shown on three rows, kept when she says yes.
  await page.setInputFiles("#hnextfile", FILE);
  await page.waitForSelector("#hyes");
  await expect(page.locator("#drawer")).toContainText("Here's how we read Transactions.csv.");
  await expect(page.locator("#drawer")).toContainText("Balance adds up on every one of the 45 lines");
  await expect(page.locator("#drawer")).toContainText("1 October 2026: RENT PAYMENT FLAT AGENT, $1,980.00 out, leaving $1,095.67.");
  await page.click("#hyes");
  await expect(page.locator("#drawer")).toContainText("45 lines from 1 October 2026 to 31 December 2026, in Everyday.");
  await expect(page.locator("#drawer")).toContainText("The file itself is kept on this device.");
  await page.click("#dclose");

  const home = page.locator("#v-home");
  await expect(home).toContainText("Some of your money went to an account we haven't met yet.");
  await expect(home).toContainText("$2,710.05");
  await expect(home).toContainText("across the 1 account we know about");
  await expect(home).toContainText("The last 3 months");
  await expect(home).toContainText("Not asked yet: a credit card");
  await expect(home).toContainText("On this device, not saved to your Sheet yet.");
  const words = await everyTab(page);
  for (const [t, text] of Object.entries(words)) expect(clean(t, text), t).not.toMatch(NOT_OURS);
  expect(words.home).not.toMatch(/savings rate|safety net|net worth|a year the sheet/i);
  expect(words.activity).toContain("EFTPOS");
  expect(words.activity).not.toContain("Everyone");
  expect(words.records).toContain("Transactions.csv");
  expect(words.goals).toContain("Nothing to save for yet.");
  await tab(page, "activity");
  await expect(page.locator("#reviewcard")).toContainText("25 entries");
  await expect(page.locator("#reviewcard")).not.toContainText("Looks right");
  await page.locator("#rcards .rcard").first().locator('[data-ract="pick"]').first().click();
  await expect(page.locator("#reviewcard")).toContainText("entries");
  await expect(page.locator("#reviewcard")).not.toContainText("25 entries");
  await page.click("nav.tabs [data-tab=goals]");
  await page.click("#haddgoal"); await page.fill("#gn", "A holiday"); await page.fill("#gt", "2,000"); await page.click("#gsave");
  await expect(page.locator("#v-goals")).toContainText("A holiday");
  await expect(page.locator("#v-goals")).toContainText("$2,000");
  await expect(page.locator("#v-goals")).toContainText("Pace isn't worked out yet.");
  await tab(page, "home");

  // A viewer who has started goes straight to their own, and it is still there.
  await page.reload();
  await expect(page.locator(".kh-next")).toContainText("Some of your money went");
  await expect(page.locator("#onb")).toBeHidden();
  await expect(page.locator("#v-home")).toContainText("$2,710.05");
  expect(errors).toEqual([]);
});
test("start to first value in the first-run flow, the way the steering screenshots show it", async ({ page }) => {
  await open(page);
  await onDevice(page);
  await dropFirst(page);
  await keep(page);
  await shot(page, "ch01-3-file-dropped.png");
  await page.click("#hdone");
  await expect(page.locator(".kh-next")).toBeVisible();
  await shot(page, "ch01-4-first-home.png", { fullPage: true });
});
test("drag and drop works on the first-run flow, on Home and on Setup", async ({ page }) => {
  await open(page);
  await onDevice(page);
  const drop = (selector) => page.evaluate(async ({ selector, text }) => {
    const dt = new DataTransfer(); dt.items.add(new File([text], "Transactions.csv", { type: "text/csv" }));
    document.querySelector(selector).dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { selector, text: fs.readFileSync(FILE, "utf8") });
  await drop("#onb [data-drop]");
  await page.waitForSelector("#hyes");
  await keep(page);
  await page.click("#hdone");
  await drop("#v-home [data-drop]");
  await expect(page.locator("#drawer")).toContainText("Transactions.csv is already in your Kitty.");
  await page.click("#dclose");
  await page.click("nav.tabs [data-tab=setup]");
  await drop("#v-setup [data-drop]");
  await expect(page.locator("#drawer")).toContainText("Nothing was added twice.");
});
test("try it here, then move it to your Sheet: every line goes across and the numbers are the same", async ({ page }) => {
  await open(page);
  await onDevice(page);
  await dropFirst(page);
  await keep(page);
  await page.click("#hdone");
  await page.click("#v-home [data-kh2=connect]");
  await page.fill("#hsheet2", "1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  await page.click("#hmove");
  await expect(page.locator("#trustpill")).toContainText("Your Sheet");
  await expect(page.locator("#v-home")).toContainText("$2,710.05");
  await expect(page.locator("#v-home")).toContainText("Saved in your Google Sheet.");
  await page.reload();
  await expect(page.locator("#v-home")).toContainText("$2,710.05");
  await expect(page.locator("#v-home")).toContainText("25 lines need a look");
});
test("make one for me: with Drive, the page makes the sheet", async ({ page }) => {
  await open(page);
  await name(page);
  await page.click("[data-where=sheet]");
  await page.click("#hmake");
  await page.waitForSelector("#hfile");
  expect(await page.evaluate(() => window.__fake.sheet.title)).toBe("Daisy Kitty");
  expect(await page.evaluate(() => window.__fake.log.filter((c) => c.tool === "update_spreadsheet").length)).toBeGreaterThan(0);
});
test("the gate refuses the page's own reading, Claude writes a recipe, and she sees three rows", async ({ page }) => {
  const csv = "Date,Details,Money In,Money Out,Balance\n01/07/2026,RENT,1980.00,,8020.00\n02/07/2026,PAY,,2500.00,10520.00\n15/07/2026,SHOP,45.50,,10474.50\n";
  const recipe = { id: "swapped", version: 1, tier: "table", container: "csv", fingerprints: [], defaults: { date: "dmy" }, table: { header: 1, order: "oldest_first" }, emit: [{ kind: "txn_line", fields: { account_ref: { stream: true }, posting_date: { col: "Date", as: "date" }, description: { col: "Details" }, amount_cents: { credit: "Money Out", debit: "Money In" }, balance_after_cents: { col: "Balance", as: "cents" } } }], statement: { from: "chain" }, controls: [{ law: "balance_chain" }] };
  await open(page, { host: { sample: JSON.stringify({ recipe }) } });
  await onDevice(page);
  await page.setInputFiles("#hfile", { name: "swapped.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.waitForSelector("#hclaude");
  await expect(page.locator("#onb")).toContainText("the numbers didn't add up, so we stopped there");
  await page.click("#hclaude");
  await expect(page.locator("#onb")).toContainText("1 July 2026: RENT, $1,980.00 out");
  await keep(page);
});
test("a whole family on the same page: every tab draws, the widgets come on, and nothing says first month", async ({ page }) => {
  // The benchmark world, written to this device's store the way the page would, then opened by the page. Davies words are expected here: this is the far end of the same path.
  const world = path.join(root, "standard/.build/world");
  await page.route("**/world.json", (r) => { const { loadWorld } = require(path.join(root, "src/household/world")), w = loadWorld(world); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ...w, files: w.files.map((f) => ({ ...f, bytes: Buffer.from(f.bytes).toString("base64") })) }) }); });
  const errors = await open(page, { today: "2027-02-01" });
  await onDevice(page);
  await page.evaluate(async () => {
    const w = await (await fetch("/world.json")).json();
    for (const f of w.files) { const b = atob(f.bytes), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); f.bytes = a; }
    const H = window.KittyHousehold, sheet = new H.FakeSheet(), store = H.googleStore({ mcp: H.fakeConnector({ sheet }), spreadsheetId: "this-device", hasDrive: false, deviceFiles: true, retries: 0, sleep: async () => {} });
    await H.replayWorld(store, w, { today: "2027-02-01" });
    await new Promise((ok, no) => { const r = indexedDB.open("kitty-household", 1); r.onsuccess = () => { const t = r.result.transaction("kv", "readwrite"); t.objectStore("kv").put(JSON.stringify(sheet.sheets), "sheet"); t.oncomplete = ok; t.onerror = no; }; r.onerror = no; });
  });
  await page.reload();
  await expect(page.locator(".kh-next")).toBeVisible({ timeout: 60000 });
  const words = await everyTab(page);
  for (const [t, text] of Object.entries(words)) expect(text, t).not.toContain("couldn't be drawn");
  expect(words.home).toMatch(/across the \d+ accounts we know about/);
  expect(words.home).toContain("The last 12 months");
  for (const w of ["Property", "Super", "Shares"]) expect(words.home).toContain(w);
  expect(words.home).not.toContain("1 accounts");
  expect(words.activity).toContain("Everyone");
  expect(errors).toEqual([]);
});
test("no name for an account the file doesn't name: the person calls it what they like, and it reads back", async ({ page }) => {
  await open(page);
  await onDevice(page);
  await dropFirst(page);
  await page.fill("#hacct", "Bills");
  await keep(page);
  await expect(page.locator("#onb")).toContainText("in Bills.");
});
test("your own Sheet: the page writes a blank Kitty to an empty sheet, and keeps the file in Drive", async ({ page }) => {
  await open(page);
  await name(page);
  await page.click("[data-where=sheet]");
  await expect(page.locator("#onb")).toContainText("Make an empty sheet at sheets.new");
  await page.fill("#hsheet", "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit");
  await page.click("#hnext");
  await page.waitForSelector("#hfile");
  const tabs = await page.evaluate(() => window.__fake.sheet.sheets.map((s) => s.title));
  expect(tabs).toContain("About"); expect(tabs).not.toContain("Sheet1"); expect(tabs.length).toBe(43);
  await dropFirst(page);
  await keep(page);
  await expect(page.locator("#onb")).toContainText("kept in your Google Drive");
  expect(await page.evaluate(() => window.__fake.files.size)).toBe(1);
  await page.click("#hdone");
  await expect(page.locator("#trustpill")).toContainText("Your Sheet");
  await expect(page.locator("#v-home")).toContainText("Saved in your Google Sheet.");
  await page.reload();
  await expect(page.locator("#v-home")).toContainText("$2,710.05");
});
test("a sheet with something in it is refused, by name, and nothing is changed", async ({ page }) => {
  await open(page);
  await name(page);
  await page.click("[data-where=sheet]");
  await page.waitForSelector("#hsheet");
  await page.evaluate(() => { const s = window.__fake.sheet.sheets[0]; s.rows[0] = ["my thesis"]; });
  await page.fill("#hsheet", "1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  await page.click("#hnext");
  await expect(page.locator("#onb")).toContainText("This is not empty, and it is not a Kitty. Nothing was changed.");
});
test("with no connector, it says plainly what to do, and this device still works", async ({ page }) => {
  await open(page, { host: { mcp: false } });
  await name(page);
  await page.click("[data-where=sheet]");
  await expect(page.locator("#onb")).toContainText("This view has no Google connector yet.");
  await expect(page.locator("#onb")).toContainText("Settings, then Connectors");
  await page.click("[data-where=device]");
  await page.click("#hnext");
  await page.waitForSelector("#hfile");
});
test("no Drive: the bytes are marked on this device, and the file still reads", async ({ page }) => {
  await open(page, { host: { drive: false } });
  await name(page);
  await page.click("[data-where=sheet]");
  await page.fill("#hsheet", "1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  await page.click("#hnext");
  await page.waitForSelector("#hfile");
  await dropFirst(page);
  await keep(page);
  await expect(page.locator("#onb")).toContainText("kept on this device");
});
const ODD = "Entered|What|Change|Left\n1 Jul|COFFEE|-4.50|95.50\n13 Jul|LUNCH|-15.50|80.00\n20 Jul|REFUND|5.00|85.00\n";
const dropOdd = async (page) => { await page.setInputFiles("#hfile", { name: "export.csv", mimeType: "text/csv", buffer: Buffer.from(ODD) }); await page.waitForSelector("#hcopy"); };
test("a format nobody can read by its columns: nothing is lost, the prompt is there, and a wrong recipe is refused", async ({ page }) => {
  await open(page);
  await onDevice(page);
  await dropOdd(page);
  const onb = page.locator("#onb");
  await expect(onb).toContainText("We can't read export.csv yet.");
  await expect(onb).toContainText("kept on this device, and nothing from it is in your numbers. Nothing is lost.");
  await expect(onb).not.toContainText("Ask Claude to read it");
  const prompt = await page.inputValue("#hprompt");
  expect(prompt).toContain("standard/RECIPES.md"); expect(prompt).toContain("fp1:"); expect(prompt).toContain("COFFEE");
  await page.fill("#hrecipe", "not json at all");
  await page.click("#hcheck");
  await expect(onb).toContainText("That isn't JSON yet.");
  await page.fill("#hrecipe", JSON.stringify({ id: "wrong", version: 1, tier: "table", container: "csv", fingerprints: [prompt.match(/fp1:\w+/)[0]], defaults: { date: "dmy" }, table: { header: 1, order: "oldest_first" }, emit: [{ kind: "txn_line", fields: { account_ref: { stream: true }, posting_date: { col: "Entered", as: "date" }, description: { col: "What" }, amount_cents: { col: "Change", as: "cents" } } }], controls: [] }));
  await page.click("#hcheck");
  await expect(onb).toContainText("That recipe didn't pass, so nothing was read.");
});
const RECIPE = () => JSON.parse(fs.readFileSync(path.join(OUT, "davies/answers/recipes/life-ping2026-csv.json"), "utf8"));
test("she says no: the page's own Claude writes the recipe, the gate judges it, and she still sees three rows before it's kept", async ({ page }) => {
  await open(page, { host: { sample: JSON.stringify({ recipe: RECIPE() }) } });
  await onDevice(page);
  await dropFirst(page);
  await page.click("#hno");
  await page.click("#hclaude");
  await expect(page.locator("#onb")).toContainText("Claude wrote a reading of this file, and it passed our checks.");
  await expect(page.locator("#onb")).toContainText("1 October 2026: RENT PAYMENT FLAT AGENT, $1,980.00 out");
  await keep(page);
  await expect(page.locator("#onb")).toContainText("45 lines from 1 October 2026");
});
test("a recipe from Claude that does not add up is refused, and nothing is kept", async ({ page }) => {
  const bad = RECIPE(); bad.emit[0].fields.amount_cents = { credit: "Money Out", debit: "Money In" };
  await open(page, { host: { sample: JSON.stringify({ recipe: bad }) } });
  await onDevice(page);
  await dropFirst(page);
  await page.click("#hno");
  await page.click("#hclaude");
  await expect(page.locator("#onb")).toContainText("That recipe didn't pass, so nothing was read.");
  await expect(page.locator("#hyes")).toHaveCount(0);
});
test("she says no to the reading: Claude if the host has it, then her agent, and nothing is kept", async ({ page }) => {
  await open(page);
  await onDevice(page);
  await dropFirst(page);
  await page.click("#hno");
  await expect(page.locator("#onb")).toContainText("We can't read Transactions.csv yet.");
  await expect(page.locator("#hcopy")).toBeVisible();
  await page.click("#hdone");
  await expect(page.locator(".kh-next")).toContainText("We can't read Transactions.csv yet.");
  await page.click("[data-kh=recipe]");
  await expect(page.locator("#drawer")).toContainText("Here's how we read Transactions.csv.");
});
// What she would say. The generator's truth has the same answers; these are the words on her statements.
const ANSWERS = [[/RENT/, "RENT-PAID"], [/PURRSURE|REGO/, "CAR"], [/ENERGY/, "UTILITIES"], [/BENEFITS/, "SALARY-ALLOW"], [/BUPAW/, "HEALTH"], [/PANTRY|FRESHPAW|GROCER/, "GROCERIES"], [/SHORT BACK/, "PERSONAL"], [/PAWPUMP/, "TRANSPORT"], [/KOALATEL/, "TELCO"], [/SECOND CUP|NOODLE/, "DINING"], [/STREAM/, "SUBS"]];
test("chapter 2: more files, some questions, and a first close", async ({ page }) => {
  const errors = await open(page);
  await onDevice(page);
  await dropFirst(page);
  await keep(page);
  await page.click("#hdone");
  // February: she brings the rest of what chapter 2 holds. The clock moves on, as it does for a person.
  await page.clock.setFixedTime(new Date("2027-02-14T10:00:00+11:00"));
  await page.reload();
  await expect(page.locator(".kh-next")).toBeVisible();
  const held = manifest().files.filter((f) => f.held_from_chapter === 2 && f.path.startsWith("sources/"));
  const drop = async (paths, account) => {
    await page.click("nav.tabs [data-tab=setup]");
    await page.setInputFiles("#hsetupfile", paths);
    await page.waitForFunction(() => document.querySelector("#drawer.on"));
    await page.waitForTimeout(100);
    const yes = page.locator("#hyes"), named = page.locator("#hacctgo");
    if (await yes.count()) { await page.fill("#hacct", account); await yes.click(); await page.waitForTimeout(150); }
    if (await named.count()) { await page.fill("#hacct", account); await named.click(); await page.waitForTimeout(150); }
    await page.click("#dclose");
  };
  const of = (re) => held.filter((f) => re.test(f.stream)).map((f) => path.join(OUT, "davies", f.path));
  for (const p of of(/^EVERY-A$/)) await drop([p], "Everyday");
  for (const p of of(/^SAVE-A$/)) await drop([p], "Saver");
  await drop(of(/^(CARD-A|CARD-A-STMT|PAY-A|SUPER-A|SUPER-A-STMT|HELP-A|TAX-A)$/), "Everyday");
  await page.click("nav.tabs [data-tab=home]");
  // Whatever Home asks next, she answers, until a month can close. One step at a time is the whole point.
  let closed = "";
  for (let i = 0; i < 80 && !closed; i++) {
    const id = await page.locator(".kh-next").getAttribute("data-step");
    if (id === "close") { closed = await page.locator(".kh-next h1").innerText(); await page.click("[data-kh=close]"); await page.waitForTimeout(150); break; }
    if (id === "categorise") { const said = await page.locator(".kh-next h1").innerText(), hit = ANSWERS.find(([re]) => re.test(said)); await page.selectOption("#hcat", hit ? hit[1] : "SHOPPING"); await page.click("[data-kh=categorise]"); }
    else if (id === "scope" || id === "payslips") await page.locator("[data-kh=scope]").nth(1).click();
    else if (id === "no_balance") { await page.fill("#hcents", "1000"); await page.click("[data-kh=balance]"); }
    else if (id === "other_side" || id === "does_not_add_up" || id === "review") { await page.click(".kh-next [data-kh=review], .kh-next label"); if (await page.locator("#hreason2").count()) { await page.fill("#hreason2", "Looked at it."); await page.click("#haccept"); } else break; }
    else break;
    await page.waitForFunction((was) => { const n = document.querySelector(".kh-next"); return n && (n.dataset.step !== was || true); }, id);
    await page.waitForTimeout(60);
  }
  expect(closed, `Home stopped at ${await page.locator(".kh-next h1").innerText()}`).toMatch(/^Close /);
  await expect(page.locator("#v-home")).toContainText("closed");
  await shot(page, "ch02-1-first-close.png", { fullPage: true });
  expect(errors).toEqual([]);
});
for (const scheme of ["light", "dark"]) test(`a phone, ${scheme}: chapter 1 fits, with nothing wider than the screen`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: scheme });
  await open(page);
  await onDevice(page);
  await dropFirst(page);
  await keep(page);
  await page.click("#hdone");
  await expect(page.locator(".kh-next")).toBeVisible();
  for (const t of ["home", "activity", "insights", "goals", "records", "setup"]) {
    await page.evaluate((x) => document.querySelector(`nav.tabs [data-tab=${x}]`).click(), t);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), t).toBe(true);
  }
  await page.evaluate(() => document.querySelector("nav.tabs [data-tab=home]").click());
  if (scheme === "dark") await shot(page, "ch01-5-phone.png");
});
test("the parity table enumerates what the page really reads: every model read in a real render is on its list", async ({ page }) => {
  // The engine's model wrapped in a recorder, on the demo, and every tab and a few drawers drawn. A read the source scan missed would be a field parity never compared.
  await page.addInitScript(() => {
    const reads = (window.__reads = new Set()), seen = new WeakMap();
    const wrap = (o, at) => {
      if (!o || typeof o !== "object" || o instanceof Set || o instanceof Map) return o;
      if (seen.has(o)) return seen.get(o);
      const array = Array.isArray(o);
      const p = new Proxy(o, { get(t, k, r) { const v = Reflect.get(t, k, r); if (typeof k === "symbol") return v; if (array) { if (/^\d+$/.test(k)) return wrap(v, at); return typeof v === "function" ? v.bind(p) : v; } if (k in t) reads.add(`${at}.${k}`); return at === "m" ? wrap(v, k) : v; } });
      seen.set(o, p); return p;
    };
    let real;
    Object.defineProperty(window, "Engine", { configurable: true, get: () => real, set(v) { real = v; const model = v.model; v.model = (s) => wrap(model(s), "m"); } });
  });
  await open(page, { url: "/local-v2.html?noonb&noanim" });
  await page.waitForSelector("#canvas .wcell");
  for (const t of ["activity", "insights", "goals", "records", "setup", "home"]) await tab(page, t);
  await page.evaluate(() => document.querySelector("#heronum").click());
  const reads = await page.evaluate(() => [...window.__reads]);
  const E = require(path.join(root, "src", "engine.js")), { fieldsRead } = require(path.join(root, "tools", "page-parity.js"));
  const v2 = E.model(JSON.parse(fs.readFileSync(path.join(root, "data", "snapshot-v2.json"), "utf8"))), listed = fieldsRead(v2), tops = new Set(listed.map((f) => f.top)), rows = new Set(listed.map((f) => (f.key ? `${f.top}.${f.key}` : f.top)));
  const skip = /^m\.(acctById|catById|entryById|merMemo|ruleIndex|fetchedAt|asOf|people|sheetVersion|householdName|firstSeen|dupes|settings|kitty|metrics|mortgage|tax|reviewQueue|unstated|cfcats)$/;
  const missed = reads.filter((r) => { const [a, b] = r.split("."); if (a === "m") return !skip.test(r) && !tops.has(b); return !["settings", "kitty", "metrics", "tax", "mortgage", "acctById", "catById", "entryById", "merMemo", "ruleIndex"].includes(a) && !rows.has(`${a}.${b}`) && !["entries", "row", "mer", "decisions", "reviewed", "lastUsedRaw"].includes(b) && b !== "length"; });
  expect(reads.length).toBeGreaterThan(60);
  expect(missed).toEqual([]);
});
