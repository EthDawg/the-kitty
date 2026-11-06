// The vault: the portals hand over the Davies world's files exactly as delivered. A browser signs in to two of the new
// portals, downloads a PDF and a CSV, and each file's hash must equal the world's. Builds the world and the vault first,
// if they are not there, so it needs nothing a checkout does not have.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const WORLD = path.join(ROOT, "standard", ".build", "world");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const local = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", p), "utf8"));

test.beforeAll(() => {
  if (fs.existsSync(path.join(__dirname, "..", "estate", "vault.json"))) return;
  for (const script of ["standard/world/build.js", "portals/build-vault.js"]) execFileSync("node", [script], { cwd: ROOT, stdio: "pipe" });
});

test("two new portals sign in and hand over the world's files byte for byte, and every world file has one home", async ({ page }) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(WORLD, "manifest.json"), "utf8"));
  const vault = local("estate/vault.json");
  const brands = [...local("public/brands.json"), ...local("public/vault-brands.json")];
  const holders = brands.filter((b) => !b.holdsNoFiles);
  const types = require("../lib/file-types");
  const config = local("vercel.json");

  await test.step("every world file sits in exactly one portal, and every portal holds some", () => {
    const home = new Map(vault.files.map((f) => [`sources/${f.path.slice("vault/".length)}`, f]));
    expect(vault.files.length).toBe(manifest.files.length);
    expect(home.size).toBe(manifest.files.length);
    for (const f of manifest.files) { expect(home.get(f.path)?.sha256, f.path).toBe(f.sha256); expect(home.get(f.path).size, f.path).toBe(f.bytes); }
    expect([...new Set(vault.files.map((f) => f.brand))].sort()).toEqual(holders.map((b) => b.id).sort());
  });

  await test.step("vercel.json routes every portal and keeps the vault behind the function that asks the clock and the person", () => {
    const route = config.rewrites.find((r) => r.destination === "/portal");
    const routed = route.source.match(/\(([^)]+)\)/)[1].split("|").sort();
    expect(routed).toEqual(brands.map((b) => b.id).sort());
    expect(config.rewrites.find((r) => r.source === "/vault/:path*").destination).toBe("/api/files?path=:path*");
    expect(fs.existsSync(path.join(__dirname, "..", "public", "vault")), "no file is static").toBe(false);
    expect(fs.existsSync(path.join(__dirname, "..", "public", "vault.json")), "no listing is static").toBe(false);
  });

  const take = async (brand, stream, ext) => {
    const file = vault.files.filter((f) => f.brand === brand && f.stream === stream && f.name.endsWith(ext)).sort((a, b) => (a.date < b.date ? 1 : -1))[1];
    await page.goto(`/${brand}#/files/${stream}`);
    await expect(page.locator("#signin")).toBeVisible();
    await expect(page.locator("#view")).toBeHidden();
    await page.fill("#name", "A visitor");
    await page.fill("#password", "wrong");
    await page.click("#loginbtn");
    await expect(page.locator("#loginerror")).toBeVisible();
    await page.fill("#password", "demo");
    await page.click("#loginbtn");
    await expect(page.locator("#whoname")).toContainText("A visitor");
    await expect(page.locator(`a.acct[data-stream="${stream}"]`)).toHaveAttribute("aria-current", "true");
    const year = page.locator(`details.fy[data-year="${file.year}"]`);
    if ((await year.getAttribute("open")) === null) await year.locator("summary").click();
    const [download] = await Promise.all([page.waitForEvent("download"), year.locator(`a[data-file="${file.name}"]`).click()]);
    expect(download.suggestedFilename()).toBe(file.name);
    const bytes = fs.readFileSync(await download.path());
    const delivered = manifest.files.find((f) => f.stream_id === stream && f.download_date === file.date && f.name === file.name);
    expect(sha256(bytes), "the world's hash").toBe(delivered.sha256);
    expect(bytes.equals(fs.readFileSync(path.join(WORLD, delivered.path))), "the world's bytes").toBe(true);
    return { bytes, file };
  };

  await test.step("a PDF from Bupaw", async () => { expect((await take("bupaw", "PHI-M", ".pdf")).bytes.subarray(0, 5).toString()).toBe("%PDF-"); });
  await test.step("a file answers to its own portal's sign-in", async () => {
    const f = vault.files.find((x) => x.brand === "waterbowl");
    expect((await page.request.get(`/${f.path}`)).status()).toBe(401);
  });
  await test.step("a CSV from Purrannuation, a separate sign-in", async () => { expect((await take("purrannuation", "SUPER-J", ".csv")).bytes.toString()).toContain("Investment"); });

  await test.step("scans, email and workbooks download with their own content types", async () => {
    for (const [ext, brand] of [[".png", "litterbox"], [".eml", "gmeow"], [".xlsx", "litterbox"], [".html", "kittenhood"], [".ofx", "ping"], [".qif", "commbark"]]) {
      await page.request.post("/api/login", { data: { brand, name: "A visitor", password: "demo" }, headers: { Accept: "application/json" } });
      const f = vault.files.find((x) => x.brand === brand && x.name.endsWith(ext));
      const r = await page.request.get(`/${f.path}`);
      expect(r.status(), f.path).toBe(200);
      expect(r.headers()["content-type"], f.path).toBe(types[ext]);
      expect(r.headers()["content-disposition"], f.path).toMatch(/^attachment/);
      expect(sha256(await r.body()), f.path).toBe(f.sha256);
    }
  });

  await test.step("an original portal keeps its exports and adds the files as delivered", async () => {
    await page.goto("/ping"); // signed in by the step above
    await expect(page.locator(".greet")).toBeVisible();
    await page.click('nav.primary a[href="#/files"]');
    await expect(page.locator(".pagehead h1")).toHaveText("Files as delivered");
    await page.click('a.acct[data-stream="ACC-WAT"]');
    await expect(page.locator("#docs")).toContainText("OFX");
  });
});
