// Litterbox and Gmeow: browsable and searchable by a person and through the same read-only API, messy on purpose, and honest about the clock and the person.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { session, signIn, getJson, tool, API } = require("./helpers");

const ESTATE = path.join(__dirname, "..", "estate", "benchmark");
const drive = () => JSON.parse(fs.readFileSync(path.join(ESTATE, "drive.json"), "utf8"));
const mail = () => JSON.parse(fs.readFileSync(path.join(ESTATE, "mail.json"), "utf8"));
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const FOLDER = "application/vnd.google-apps.folder";

let mia, jordan;
test.beforeEach(async ({ playwright, baseURL }) => { [mia, jordan] = await Promise.all([session(playwright, baseURL), session(playwright, baseURL)]); });
test.afterEach(async () => { await Promise.all([mia.dispose(), jordan.dispose()]); });

const search = (ctx, query, extra = {}, url = "/api/drive/search_files") => tool(ctx, url, { query, pageSize: 100, ...extra });
const titles = (j) => j.files.map((f) => f.title);

test.describe("the Drive connector", () => {
  test.beforeEach(async () => { await signIn(mia, "litterbox", "mia"); await signIn(jordan, "litterbox", "jordan"); });

  test("it says what it offers, with the real connector's names, and nothing that writes", async () => {
    const j = await getJson(mia, "/api/drive");
    expect(j.tools.sort()).toEqual(["download_file_content", "get_file_metadata", "list_recent_files", "read_file_content", "search_files"]);
    expect((await tool(mia, "/api/drive/create_file", { title: "x", textContent: "y" })).status, "read-only").toBe(404);
    const hit = (await search(mia, "title contains 'Deductions-Worksheet-Mia-FY2026'")).files[0];
    for (const k of ["id", "title", "mimeType", "parentId", "createdTime", "modifiedTime", "owner", "viewUrl", "fileSize"]) expect(hit[k], k).toBeDefined();
    expect(hit.modifiedTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test("the query language works: and, or, not, brackets, dates, folders and text", async () => {
    expect(titles(await search(mia, "title contains 'scan0003'"))).toEqual(["scan0003.pdf"]);
    expect(titles(await search(mia, "title = 'tax stuff' and mimeType = 'application/vnd.google-apps.folder'"))).toEqual(["tax stuff"]);
    const folder = (await search(mia, "title = 'tax stuff'")).files[0];
    expect(titles(await search(mia, `parentId = '${folder.id}'`))).toEqual(expect.arrayContaining(["scan0003.pdf", "scan0004.pdf", "NOA 2024 final.pdf", "Notice-of-Assessment-Mia-FY2024.pdf"]));
    expect(titles(await search(mia, "(title contains 'NOA' or title contains 'scan0004') and not title contains 'scan'"))).toEqual(["NOA 2024 final.pdf"]);
    expect((await search(mia, "modifiedTime > '2025-10-01T00:00:00Z' and mimeType contains 'image/'")).files).toEqual([]);
    const text = await search(mia, "fullText contains 'Uniform and laundry'");
    expect(titles(text).join()).toContain("Deductions-Worksheet-Mia");
    expect(text.files[0].contentSnippet).toContain("Uniform");
    expect((await search(mia, "colour = 'blue'")).status).toBe(400);
    expect((await search(mia, "title contains")).status).toBe(400);
  });

  test("read, download and metadata, and a file's bytes match the world's hash", async () => {
    const f = (await search(mia, "title = 'Deductions-Worksheet-Mia-FY2026.xlsx'")).files[0];
    expect((await tool(mia, "/api/drive/read_file_content", { fileId: f.id })).content).toContain("Deductions worksheet, Mia Davies");
    const d = await tool(mia, "/api/drive/download_file_content", { fileId: f.id });
    expect(d.encoding).toBe("base64");
    expect(sha256(Buffer.from(d.content, "base64"))).toBe(drive().files.find((x) => x.id === f.id).sha256);
    expect((await tool(mia, "/api/drive/get_file_metadata", { fileId: f.id })).title).toBe(f.title);
    expect((await tool(mia, "/api/drive/read_file_content", { fileId: "nope" })).status).toBe(404);
    const recent = await tool(mia, "/api/drive/list_recent_files", { pageSize: 5 });
    expect(recent.files.length).toBe(5);
    expect(recent.nextPageToken).toBe("5");
    expect(recent.files.every((x) => x.mimeType !== FOLDER)).toBe(true);
    expect(JSON.stringify(recent), "what a file really is stays on the server").not.toContain("truth");
    expect((await mia.get(`/api/drive/read_file_content?fileId=${f.id}`, { headers: API })).status(), "a read works as a GET too").toBe(200);
  });

  test("a token works without a cookie, the way a connector does", async ({ playwright, baseURL }) => {
    const { token } = await signIn(mia, "litterbox", "mia");
    const bare = await playwright.request.newContext({ baseURL });
    expect((await bare.post("/api/drive/search_files", { headers: API, data: { query: "" } })).status()).toBe(401);
    const r = await bare.post("/api/drive/search_files", { headers: { ...API, Authorization: `Bearer ${token}` }, data: { query: "title contains 'scan0003'" } });
    expect((await r.json()).files.length).toBe(1);
    await bare.dispose();
  });

  test("the mess is really there", async () => {
    const f = drive().files, by = (t) => f.find((x) => x.title === t);
    expect(by("NOA 2024 final.pdf").sha256, "an exact duplicate").toBe(by("Notice-of-Assessment-Mia-FY2024.pdf").sha256);
    expect(by("washing machine.png").sha256).toBe(by("Scan-DEV-WASHER.png").sha256);
    expect(by("WFH-Log-FY2025 (Jordan's edits).csv").sha256, "a draft that disagrees").not.toBe(by("WFH-Log-FY2025.csv")?.sha256);
    const scan = (await search(mia, "title = 'scan0003.pdf'")).files[0];
    expect((await tool(mia, "/api/drive/read_file_content", { fileId: scan.id })).content, "a scan has no text layer").toContain("no text layer");
    expect(titles(await search(mia, "fullText contains 'Contract of sale'")), "nor can a search find what is inside it").toEqual([]);
    expect(titles(await search(mia, "title contains 'Screenshot'"))).toEqual(["Screenshot 2025-03-04 at 7.42.18 pm.png"]);
    expect(by("Settlement-Statement-Lydiard-Cottage.pdf").parentId, "Ballarat's settlement is in the Geelong folder").toBe("d_geelong");
    expect(by("Notice-of-Assessment-Mia-FY2023-amended.pdf").parentId, "the amended notice is in Kids").toBe("d_kids");
    expect(titles(await search(mia, "title contains 'Lydiard' and title contains 'Contract'")), "the Ballarat contract is nowhere").toEqual([]);
  });

  test("today: a file saved later is not listed yet, and its id does not reach it through the API", async () => {
    const at = (today, q) => search(mia, q, {}, `/api/drive/search_files?today=${today}`);
    expect(titles(await at("2024-09-13", "title contains 'NOA 2024'"))).toEqual([]);
    expect(titles(await at("2024-09-14", "title contains 'NOA 2024'"))).toEqual(["NOA 2024 final.pdf"]);
    const hidden = drive().files.find((x) => x.title === "scan0003.pdf");
    expect((await tool(mia, "/api/drive/read_file_content?today=2021-01-01", { fileId: hidden.id })).status).toBe(404);
  });

  test("the person: each sees the family folder and their own, and neither sees the other's", async () => {
    const roots = async (ctx) => titles(await search(ctx, "parentId = 'root'")).sort();
    expect(await roots(mia)).toEqual(["Davies family", "Mia's files"]);
    expect(await roots(jordan)).toEqual(["Davies family", "Jordan's files"]);
    const his = drive().files.find((x) => x.title === "wallet-export-FY2025.json");
    expect((await tool(mia, "/api/drive/read_file_content", { fileId: his.id })).status).toBe(404);
    expect((await tool(jordan, "/api/drive/read_file_content", { fileId: his.id })).status).toBe(200);
  });

  test("a type a browser would run never opens in the page", async () => {
    const html = drive().files.find((x) => x.title.endsWith(".html"));
    const r = await mia.get(`/api/drive/open?fileId=${html.id}`);
    expect(r.headers()["content-disposition"]).toContain("attachment");
    expect(r.headers()["content-type"]).toBe("application/octet-stream");
    const pdf = drive().files.find((x) => x.title === "scan0003.pdf");
    const shown = await mia.get(`/api/drive/open?fileId=${pdf.id}`);
    expect(shown.headers()["content-disposition"]).toContain("inline");
    expect(shown.headers()["content-type"]).toBe("application/pdf");
  });
});

test.describe("the mail connector", () => {
  test.beforeEach(async () => { await signIn(mia, "gmeow", "mia"); await signIn(jordan, "gmeow", "jordan"); });
  const find = async (ctx, query, extra = "") => getJson(ctx, `/api/mail/search_threads?${new URLSearchParams({ query, pageSize: "50" })}${extra}`);

  test("search, a thread, an attachment, and nothing that writes", async () => {
    expect((await getJson(mia, "/api/mail")).tools.sort()).toEqual(["get_attachment", "get_thread", "search_threads"]);
    expect((await tool(mia, "/api/mail/send_message", { to: ["a@b.example"] })).status, "read-only").toBe(404);
    const j = await find(mia, "from:paws subject:FY2024 has:attachment");
    expect(j.threads.length).toBeGreaterThan(0);
    const t = await getJson(mia, `/api/mail/get_thread?threadId=${j.threads[0].id}`);
    expect(t.messages[0].plaintextBody).toContain("return");
    const a = t.messages[0].attachments[0];
    expect(a.filename).toBe("Tax-Return-Mia-FY2024.pdf");
    const got = await getJson(mia, `/api/mail/get_attachment?messageId=${t.messages[0].id}&attachmentId=${encodeURIComponent(a.id)}`);
    expect(sha256(Buffer.from(got.content, "base64"))).toBe(mail().messages.flatMap((m) => m.attachments).find((x) => x.id === a.id).sha256);
    expect((await find(mia, "from:\"Geelong Conveyancing\" filename:invoice")).threads.length).toBeGreaterThan(0);
    expect((await find(mia, "after:2027/02/01 before:2027/02/21 subject:Ballarat")).threads.length).toBe(1);
    expect((await mia.get("/api/mail/search_threads?query=nonsense:x", { headers: API })).status()).toBe(400);
  });

  test("real mail, noise and spam: spam stays out of a search unless asked for", async () => {
    expect((await find(mia, "tax refund")).threads.length).toBe(0);
    expect((await find(mia, "in:spam")).threads.length).toBe(2);
    expect((await find(mia, "category:promotions")).total).toBeGreaterThan(50);
    expect((await find(jordan, "subject:\"Amewx statement\"")).total).toBeGreaterThan(50);
  });

  test("the person: Jordan's card notices and returns are not Mia's", async () => {
    expect((await find(mia, "subject:\"Amewx statement\"")).total).toBe(0);
    expect((await find(mia, "filename:Tax-Return-Jordan")).total).toBe(0);
    expect((await find(jordan, "filename:Tax-Return-Jordan")).total).toBeGreaterThan(5);
    expect((await find(jordan, "filename:Tax-Return-Mia")).total).toBe(0);
    const hers = mail().messages.find((m) => m.attachments.some((a) => a.name === "Tax-Return-Mia-FY2024.pdf"));
    expect((await jordan.get(`/api/mail/get_thread?threadId=${hers.threadId}`, { headers: API })).status()).toBe(404);
    expect((await jordan.get(`/api/mail/get_attachment?messageId=${hers.id}&attachmentId=${encodeURIComponent(hers.attachments[0].id)}`, { headers: API })).status()).toBe(404);
  });

  test("today: mail from after it has not arrived", async () => {
    expect((await find(mia, "subject:\"Ballarat contract\"", "&today=2027-02-19")).total).toBe(0);
    const j = await find(mia, "subject:\"Ballarat contract\"", "&today=2027-02-20");
    expect(j.total).toBe(1);
    expect(j.threads[0].messageCount, "a real conversation, in one thread").toBe(2);
  });
});

test("a person uses the Drive: folders, search, preview and download", async ({ page }) => {
  await page.goto("/litterbox");
  await page.getByRole("button", { name: "Continue as Mia" }).click();
  await expect(page.locator(".greet")).toContainText("Mia");
  await expect(page.locator('#dtree a[data-folder="tax stuff"]')).toBeVisible();
  await expect(page.locator('#dtree a[data-folder="Mia\'s files"]')).toBeVisible();
  await expect(page.locator('#dtree a[data-folder="Jordan\'s files"]')).toHaveCount(0);
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
});

test("a phone never scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/litterbox#/");
  await page.getByRole("button", { name: "Continue as Mia" }).click();
  await page.click('#dtree a[data-folder="tax stuff"]');
  await expect(page.locator('tr[data-title="scan0003.pdf"]')).toBeVisible();
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(await sideways(), "the Drive").toBe(false);
  await page.goto("/gmeow#/");
  await expect(page.locator(".mailrow").first()).toBeVisible();
  expect(await sideways(), "the inbox").toBe(false);
});

test("a person uses the inbox: read, search and attachments, one sign-in with the Drive", async ({ page }) => {
  await page.goto("/gmeow");
  await page.getByRole("button", { name: "Continue as Mia" }).click();
  await expect(page.locator(".mailrow").first()).toBeVisible();
  await expect(page.getByText("Compose")).toHaveCount(0);
  await page.fill("#msearch", "from:whisker");
  await page.press("#msearch", "Enter");
  await page.click('.mailrow[data-subject="Settlement complete, 14 Lydiard Cottage Lane"]');
  await expect(page.locator(".message .body")).toContainText("went out by post");
  const chip = page.locator('.chip[data-attachment="Settlement-Statement-Lydiard-Cottage.pdf"]');
  await expect(chip).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), chip.getByText("Download").click()]);
  expect(download.suggestedFilename()).toBe("Settlement-Statement-Lydiard-Cottage.pdf");
  await page.goto("/litterbox");
  await expect(page.locator(".greet")).toContainText("Mia");
});
