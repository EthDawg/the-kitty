// A real page, an editor's simulated connector and an intentionally tiny v2 household.
// No Google requests or credentials. This catches accidental writes on app startup.
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const url = pathToFileURL(path.join(__dirname, "../../dist/local-v2.html")).href;

for (const broken of [false, true]) {
  test(broken ? "a missing Decisions tab cannot be shown as Live" : "opening a v2 Sheet as an editor performs only reads", async ({ page }) => {
    await page.route(/^https?:\/\//, route => route.abort());
    await page.addInitScript(({ broken }) => {
      const tabs = {
        Kitty: [["Key", "Value"], ["sheet_version", "2"], ["household_name", "Fictional reader test"]],
        Settings: [["Setting", "Value"], ["As-of date", "2027-01-31"]],
        Accounts: [["Account ID", "Account", "Type"], ["A01", "Fictional everyday", "Transaction"]],
        Categories: [["Category ID", "Category", "Group", "Flow"], ["FOOD", "Food", "Essentials", "Expense"]],
        Entries: [["Entry ID", "Kind", "Settled at", "Account ID", "Raw text", "Description", "Amount", "Category ID"]],
        Balances: [["Month end"]], Contracts: [["Contract ID"]], Rules: [["Rule ID"]],
        Decisions: [["Decision ID", "Ref kind", "Ref ID", "Decision", "Value", "By", "At", "Note"]]
      };
      window.kittyReadCheck = { calls: [] };
      const state = window.kittyReadCheck;
      const mcp = { callTool: async (_server, tool, input) => {
        state.calls.push(tool);
        let payload;
        if (tool === "get_spreadsheet") {
          payload = { sheets: Object.keys(tabs).map(title => ({ properties: { title, gridProperties: { rowCount: 25 } } })) };
        } else if (tool === "get_values") {
          const title = input.range.split("!")[0].replaceAll("'", "");
          if (title === "Decisions" && broken) throw { code: "tool_error", message: "missing tab" };
          payload = { range: input.range, majorDimension: "ROWS", values: tabs[title] || [] };
        } else throw new Error("A read attempted a mutation");
        return { payload, cache: { storedAt: Date.now() } };
      }};
      window.claude = { use: async capability => capability === "mcp" ? mcp : capability === "user"
        ? { isOwner: async () => true, me: async () => ({ name: "Fictional editor" }) } : null };
    }, { broken });
    await page.goto(url + "?noonb&noanim");
    await expect(page.locator("#trustpill")).toHaveText(broken ? "Sheet unreadable" : "Live demo · 31 Jan 2027");
    const calls = await page.evaluate(() => window.kittyReadCheck.calls);
    expect(calls).toContain("get_spreadsheet");
    expect(calls).toContain("get_values");
    expect(calls.filter(tool => !["get_values", "get_spreadsheet"].includes(tool))).toEqual([]);
  });
}

test("the Setup card restores only the native host's verified result and clears it on disconnect", async ({ page }) => {
  await page.route(/^https?:\/\//, route => route.abort());
  await page.addInitScript(() => {
    window.KITTY_HOST = "native";
    let wrongFile = true, disconnected = false;
    window.fixtureRecognisesDemo = () => { wrongFile = false; document.dispatchEvent(new Event("kitty:google-status")); };
    window.KittyNative = { environment: {}, google: {
      status: async () => ({ configured: true, verified: disconnected ? null : {
        sheetID: wrongFile ? "a-different-fixture" : window.KITTY_SHEET,
        title: "Fictional connection check", sheetVersion: 2, canEdit: false
      } }),
      disconnect: async () => { disconnected = true; }
    } };
  });
  await page.goto(url + "?noonb&noanim&tab=setup");
  const status = page.locator("#nativeconnection [role=status]");
  await expect(status).toHaveText("Sheet not verified yet.");
  await page.evaluate(() => window.fixtureRecognisesDemo());
  await expect(status).toContainText("Verified in Google: Fictional connection check · Kitty v2 · viewer");
  await expect(page.locator("#trustpill")).not.toContainText("Live");
  await page.getByRole("button", { name: "Disconnect Google" }).click();
  await expect(status).toHaveText("Disconnected from Google.");
  await page.evaluate(() => document.dispatchEvent(new Event("kitty:google-status")));
  await expect(status).not.toContainText("Verified in Google");
});
