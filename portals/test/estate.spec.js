// Litterbox and Gmeow: usable by a person in a browser and by an agent through the same API, messy on purpose, and honest about the clock and the person.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { session, signIn, setClock, getJson, tool, API } = require("./helpers");

const ESTATE = path.join(__dirname, "..", "estate");
const drive = () => JSON.parse(fs.readFileSync(path.join(ESTATE, "drive.json"), "utf8"));
const mail = () => JSON.parse(fs.readFileSync(path.join(ESTATE, "mail.json"), "utf8"));
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const FOLDER = "application/vnd.google-apps.folder";

let daisy, danny;
test.beforeEach(async ({ playwright, baseURL }) => { [daisy, danny] = await Promise.all([session(playwright, baseURL), session(playwright, baseURL)]); });
test.afterEach(async () => { await Promise.all([daisy.dispose(), danny.dispose()]); });

const search = (ctx, query, extra = {}) => tool(ctx, "/api/drive/search_files", { query, pageSize: 100, ...extra });
const titles = (j) => j.files.map((f) => f.title);

test.describe("the Drive connector", () => {
  test.beforeEach(async () => { await signIn(daisy, "litterbox", "Daisy"); await signIn(danny, "litterbox", "Danny"); });

  test("it says what it offers, with the real connector's tool names and arguments", async () => {
    const j = await getJson(daisy, "/api/drive");
    expect(j.tools.sort()).toEqual(["create_file", "download_file_content", "get_file_metadata", "list_recent_files", "read_file_content", "search_files"]);
    const hit = (await search(daisy, "title contains 'Deductions-Worksheet-Mia-FY2026'")).files[0];
    for (const k of ["id", "title", "mimeType", "parentId", "createdTime", "modifiedTime", "owner", "viewUrl", "fileSize"]) expect(hit[k], k).toBeDefined();
    expect(hit.modifiedTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test("the query language works: and, or, not, brackets, dates, folders and text", async () => {
    expect(titles(await search(daisy, "title contains 'scan0003'"))).toEqual(["scan0003.pdf"]);
    expect(titles(await search(daisy, "title = 'tax stuff' and mimeType = 'application/vnd.google-apps.folder'"))).toEqual(["tax stuff"]);
    const folder = (await search(daisy, "title = 'tax stuff'")).files[0];
    const inside = await search(daisy, `parentId = '${folder.id}'`);
    expect(titles(inside)).toEqual(expect.arrayContaining(["scan0003.pdf", "scan0004.pdf", "NOA 2024 final.pdf", "Notice-of-Assessment-Mia-FY2024.pdf"]));
    expect(titles(await search(daisy, "(title contains 'NOA' or title contains 'scan0004') and not title contains 'scan'"))).toEqual(["NOA 2024 final.pdf"]);
    const late = await search(daisy, "modifiedTime > '2025-10-01T00:00:00Z' and mimeType contains 'image/'");
    expect(late.files).toEqual([]);
    const text = await search(daisy, "fullText contains 'Uniform and laundry'");
    expect(titles(text).join()).toContain("Deductions-Worksheet-Mia");
    expect(text.files[0].contentSnippet).toContain("Uniform");
    expect((await search(daisy, "colour = 'blue'")).status).toBe(400);
    expect((await search(daisy, "title contains")).status).toBe(400);
  });

  test("read, download and metadata, and a file's bytes match the world's hash", async () => {
    const f = (await search(daisy, "title = 'Deductions-Worksheet-Mia-FY2026.xlsx'")).files[0];
    expect((await tool(daisy, "/api/drive/read_file_content", { fileId: f.id })).content).toContain("Deductions worksheet, Mia Davies");
    const d = await tool(daisy, "/api/drive/download_file_content", { fileId: f.id });
    expect(d.encoding).toBe("base64");
    expect(sha256(Buffer.from(d.content, "base64"))).toBe(drive().files.find((x) => x.id === f.id).sha256);
    expect((await tool(daisy, "/api/drive/get_file_metadata", { fileId: f.id })).title).toBe(f.title);
    expect((await tool(daisy, "/api/drive/read_file_content", { fileId: "nope" })).status).toBe(404);
    const recent = await tool(daisy, "/api/drive/list_recent_files", { pageSize: 5 });
    expect(recent.files.length).toBe(5);
    expect(recent.nextPageToken).toBe("5");
    expect(recent.files.every((x) => x.mimeType !== FOLDER)).toBe(true);
    expect(JSON.stringify(recent), "what a file really is stays on the server").not.toContain("truth");
    const q = await daisy.get(`/api/drive/read_file_content?fileId=${f.id}`, { headers: API });
    expect(q.status(), "a read works as a GET too").toBe(200);
  });

  test("a token works without a cookie, the way a connector does", async ({ playwright, baseURL }) => {
    const { token } = await signIn(daisy, "litterbox", "Daisy");
    const bare = await playwright.request.newContext({ baseURL });
    expect((await bare.post("/api/drive/search_files", { headers: API, data: { query: "" } })).status()).toBe(401);
    const r = await bare.post("/api/drive/search_files", { headers: { ...API, Authorization: `Bearer ${token}` }, data: { query: "title contains 'scan0003'" } });
    expect((await r.json()).files.length).toBe(1);
    await bare.dispose();
  });

  test("the mess is really there", async () => {
    const f = drive().files;
    const by = (t) => f.find((x) => x.title === t);
    expect(by("NOA 2024 final.pdf").sha256, "an exact duplicate").toBe(by("Notice-of-Assessment-Mia-FY2024.pdf").sha256);
    expect(by("washing machine.png").sha256).toBe(by("Scan-DEV-WASHER.png").sha256);
    expect(by("WFH-Log-FY2025 (Danny's edits).csv").sha256, "a draft that disagrees").not.toBe(by("WFH-Log-FY2024 copy.csv").sha256);
    const scan = (await search(daisy, "title = 'scan0003.pdf'")).files[0];
    expect((await tool(daisy, "/api/drive/read_file_content", { fileId: scan.id })).content, "a scan has no text layer").toContain("no text layer");
    expect(titles(await search(daisy, "fullText contains 'Contract of sale'")), "nor can a search find what is inside it").toEqual([]);
    expect(titles(await search(daisy, "title contains 'Screenshot'"))).toEqual(["Screenshot 2025-03-04 at 7.42.18 pm.png"]);
    expect(by("Settlement-Statement-Lydiard-Cottage.pdf").parentId, "Ballarat's settlement is in the Geelong folder").toBe("d_geelong");
    expect(by("Notice-of-Assessment-Mia-FY2023-amended.pdf").parentId, "the amended notice is in Kids").toBe("d_kids");
    expect(titles(await search(daisy, "title contains 'Lydiard' and title contains 'Contract'")), "the Ballarat contract is nowhere").toEqual([]);
  });

  test("the clock: a file saved later is not there yet", async () => {
    await setClock(daisy, { as_of: "2024-09-13" });
    expect(titles(await search(daisy, "title contains 'NOA 2024'"))).toEqual([]);
    await setClock(daisy, { as_of: "2024-09-14" });
    expect(titles(await search(daisy, "title contains 'NOA 2024'"))).toEqual(["NOA 2024 final.pdf"]);
    await setClock(daisy, { as_of: "2021-01-01" });
    expect(titles(await search(daisy, "title contains 'scan0003'"))).toEqual([]);
    const hidden = drive().files.find((x) => x.title === "scan0003.pdf");
    expect((await tool(daisy, "/api/drive/read_file_content", { fileId: hidden.id })).status, "nor can its id reach it").toBe(404);
  });

  test("the person: each sees the family folder and their own, and neither sees the other's", async () => {
    const roots = async (ctx) => titles(await search(ctx, "parentId = 'root'")).sort();
    expect(await roots(daisy)).toEqual(["Daisy's files", "Davies family"]);
    expect(await roots(danny)).toEqual(["Danny's files", "Davies family"]);
    const his = drive().files.find((x) => x.title === "wallet-export-FY2025.json");
    expect((await tool(daisy, "/api/drive/read_file_content", { fileId: his.id })).status).toBe(404);
    expect((await tool(danny, "/api/drive/read_file_content", { fileId: his.id })).status).toBe(200);
  });

  test("create: text, bytes and folders, in this run only, inside the folder's sharing", async ({ playwright, baseURL }) => {
    const family = (await search(daisy, "title = 'Davies family'")).files[0];
    const made = await tool(daisy, "/api/drive/create_file", { title: "notes for the accountant.txt", parentId: family.id, textContent: "Ask about the Ballarat contract.", contentMimeType: "text/plain" });
    expect(made.status).toBe(200);
    expect(made.id).toMatch(/^f_/);
    expect((await tool(daisy, "/api/drive/read_file_content", { fileId: made.id })).content).toContain("Ballarat contract");
    const bytes = Buffer.from([0, 1, 2, 3, 250]);
    const raw = await tool(daisy, "/api/drive/create_file", { title: "blob.bin", base64Content: bytes.toString("base64"), contentMimeType: "application/octet-stream" });
    expect(Buffer.from((await tool(daisy, "/api/drive/download_file_content", { fileId: raw.id })).content, "base64").equals(bytes)).toBe(true);
    const dir = await tool(daisy, "/api/drive/create_file", { title: "2027 tax", contentMimeType: FOLDER });
    expect(dir.mimeType).toBe(FOLDER);
    expect((await tool(daisy, "/api/drive/create_file", { title: "x", parentId: "d_danny", textContent: "y", contentMimeType: "text/plain" })).status, "not into Danny's folder").toBe(404);
    expect((await tool(daisy, "/api/drive/create_file", { title: "", textContent: "y" })).status).toBe(400);
    const other = await playwright.request.newContext({ baseURL });
    await signIn(other, "litterbox", "Daisy");
    expect(titles(await search(other, "title contains 'notes for the accountant'")), "another run has its own Drive").toEqual([]);
    await other.dispose();
  });

  test("a type a browser would run never opens in the page", async () => {
    const made = await tool(daisy, "/api/drive/create_file", { title: "page.html", textContent: "<script>alert(1)</script>", contentMimeType: "text/html" });
    const r = await daisy.get(`/api/drive/open?fileId=${made.id}`);
    expect(r.headers()["content-disposition"]).toContain("attachment");
    expect(r.headers()["content-type"]).toBe("application/octet-stream");
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
    const pdf = drive().files.find((x) => x.title === "scan0003.pdf");
    const shown = await daisy.get(`/api/drive/open?fileId=${pdf.id}`);
    expect(shown.headers()["content-disposition"]).toContain("inline");
    expect(shown.headers()["content-type"]).toBe("application/pdf");
  });
});

test.describe("the mail connector", () => {
  test.beforeEach(async () => { await signIn(daisy, "gmeow", "Daisy"); await signIn(danny, "gmeow", "Danny"); });
  const find = async (ctx, query) => getJson(ctx, `/api/mail/search_threads?${new URLSearchParams({ query, pageSize: "50" })}`);

  test("search, a thread, an attachment", async () => {
    const j = await find(daisy, "from:paws subject:FY2024 has:attachment");
    expect(j.threads.length).toBeGreaterThan(0);
    const t = await getJson(daisy, `/api/mail/get_thread?threadId=${j.threads[0].id}`);
    expect(t.messages[0].plaintextBody).toContain("return");
    const a = t.messages[0].attachments[0];
    expect(a.filename).toBe("Tax-Return-Mia-FY2024.pdf");
    const got = await getJson(daisy, `/api/mail/get_attachment?messageId=${t.messages[0].id}&attachmentId=${encodeURIComponent(a.id)}`);
    expect(sha256(Buffer.from(got.content, "base64"))).toBe(mail().messages.flatMap((m) => m.attachments).find((x) => x.id === a.id).sha256);
    expect((await find(daisy, "from:\"Geelong Conveyancing\" filename:invoice")).threads.length).toBeGreaterThan(0);
    expect((await find(daisy, "after:2027/02/01 before:2027/02/21 subject:Ballarat")).threads.length).toBe(1);
    expect((await daisy.get("/api/mail/search_threads?query=nonsense:x", { headers: API })).status()).toBe(400);
  });

  test("real mail, noise and spam: spam stays out of a search unless asked for", async () => {
    expect((await find(daisy, "tax refund")).threads.length).toBe(0);
    expect((await find(daisy, "in:spam")).threads.length).toBe(2);
    expect((await find(daisy, "category:promotions")).total).toBeGreaterThan(50);
    expect((await find(danny, "subject:\"Amewx statement\"")).total).toBeGreaterThan(50);
  });

  test("the person: Danny's card notices and returns are not Daisy's", async () => {
    expect((await find(daisy, "subject:\"Amewx statement\"")).total).toBe(0);
    expect((await find(daisy, "filename:Tax-Return-Jordan")).total).toBe(0);
    expect((await find(danny, "filename:Tax-Return-Jordan")).total).toBeGreaterThan(5);
    expect((await find(danny, "filename:Tax-Return-Mia")).total).toBe(0);
    const hers = mail().messages.find((m) => m.attachments.some((a) => a.name === "Tax-Return-Mia-FY2024.pdf"));
    expect((await danny.get(`/api/mail/get_thread?threadId=${hers.threadId}`, { headers: API })).status()).toBe(404);
    expect((await danny.get(`/api/mail/get_attachment?messageId=${hers.id}&attachmentId=${encodeURIComponent(hers.attachments[0].id)}`, { headers: API })).status()).toBe(404);
  });

  test("the clock: mail from after it has not arrived", async () => {
    await setClock(daisy, { as_of: "2027-02-19" });
    expect((await find(daisy, "subject:\"Ballarat contract\"")).total).toBe(0);
    await setClock(daisy, { as_of: "2027-02-20" });
    expect((await find(daisy, "subject:\"Ballarat contract\"")).total).toBe(1);
    const t = (await find(daisy, "subject:\"Ballarat contract\"")).threads[0];
    expect(t.messageCount, "a real conversation, in one thread").toBe(2);
  });

  test("mail to the household arrives, and anything else bounces: nothing leaves", async () => {
    const sent = await tool(daisy, "/api/mail/send_message", { to: ["the.davies@mail.example"], subject: "Note to self", body: "Find the contract." });
    expect(sent.status).toBe(200);
    expect((await find(daisy, "subject:\"Note to self\"")).total).toBe(1);
    const out = await tool(daisy, "/api/mail/send_message", { to: ["someone@gmail.example"], subject: "Hello", body: "Anyone there?" });
    const t = await getJson(daisy, `/api/mail/get_thread?threadId=${out.threadId}`);
    expect(t.messages.length).toBe(2);
    expect(t.messages[1].plaintextBody).toContain("nothing leaves it");
    expect((await tool(daisy, "/api/mail/send_message", { subject: "No one" })).status).toBe(400);
    expect((await tool(daisy, "/api/mail/send_message", { to: ["a@b.example"], attachments: [{ filename: "big.bin", content: Buffer.alloc(3600000).toString("base64") }] })).status).toBe(413);
  });
});

test("a person uses the Drive: folders, search, preview, download and upload", async ({ page }) => {
  await page.goto("/litterbox");
  await page.fill("#name", "Daisy");
  await page.fill("#password", "demo");
  await page.click("#loginbtn");
  await expect(page.locator(".greet")).toContainText("Daisy");
  await expect(page.locator('#dtree a[data-folder="tax stuff"]')).toBeVisible();
  await expect(page.locator('#dtree a[data-folder="Daisy\'s files"]')).toBeVisible();
  await expect(page.locator('#dtree a[data-folder="Danny\'s files"]')).toHaveCount(0);
  await page.click('#dtree a[data-folder="tax stuff"]');
  await expect(page.locator('tr[data-title="scan0003.pdf"]')).toBeVisible();

  await page.click('tr[data-title="scan0003.pdf"] a');
  await expect(page.locator("iframe.previewframe")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#ddownload")]);
  expect(download.suggestedFilename()).toBe("scan0003.pdf");
  expect(fs.readFileSync(await download.path()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto("/litterbox#/");
  await page.fill("#dsearch", "Uniform and laundry");
  await page.press("#dsearch", "Enter");
  await expect(page.locator('tr[data-title="Deductions-Worksheet-Mia-FY2026.xlsx"]')).toBeVisible();
  await page.click('tr[data-title="Deductions-Worksheet-Mia-FY2026.xlsx"] a');
  await expect(page.locator("#dtext")).toContainText("Deductions worksheet");

  await page.goto("/litterbox#/");
  await page.setInputFiles("#dfile", { name: "new-note.txt", mimeType: "text/plain", buffer: Buffer.from("hello from a person") });
  await expect(page.locator('tr[data-title="new-note.txt"]')).toBeVisible();
});

test("a person uses the inbox: read, search, attachments, compose with a Drive file", async ({ page }) => {
  await page.goto("/gmeow");
  await page.fill("#name", "Daisy");
  await page.fill("#password", "demo");
  await page.click("#loginbtn");
  await expect(page.locator(".mailrow").first()).toBeVisible();
  await page.fill("#msearch", "from:whisker");
  await page.press("#msearch", "Enter");
  await page.click('.mailrow[data-subject="Settlement complete, 14 Lydiard Cottage Lane"]');
  await expect(page.locator(".message .body")).toContainText("went out by post");
  const chip = page.locator('.chip[data-attachment="Settlement-Statement-Lydiard-Cottage.pdf"]');
  await expect(chip).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), chip.getByText("Download").click()]);
  expect(download.suggestedFilename()).toBe("Settlement-Statement-Lydiard-Cottage.pdf");
  await chip.getByText("Save to Litterbox").click();
  await expect(page.locator("#mstatus")).toContainText("Saved");

  await page.goto("/gmeow#/compose");
  await page.fill("#mto", "the.davies@mail.example");
  await page.fill("#msubject", "From the browser");
  await page.fill("#mbody", "With a file from the Drive.");
  await page.fill("#mdrive", "scan0003");
  await page.click("#mdrivego");
  await page.click('button[data-attach]');
  await expect(page.locator('.chip[data-attached="scan0003.pdf"]')).toBeVisible();
  await page.click("#msend");
  await expect(page.locator(".message .body")).toContainText("With a file from the Drive.");
  await expect(page.locator('.chip[data-attachment="scan0003.pdf"]')).toBeVisible();
});
