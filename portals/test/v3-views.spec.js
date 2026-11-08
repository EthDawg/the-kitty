// The sheet-version-3 views over a simulated connector and a tiny fictional household. No Google requests or credentials.
// Live mode reads the five v3 tabs, keeps a view dark when its tab is missing, and a lever switch writes exactly one cell:
// Goal Levers column D on the lever's row, found by Lever ID, after the confirm step.
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const url = pathToFileURL(path.join(__dirname, "../../dist/local-v2.html")).href;

function household({ missing }) {
  const tabs = {
    Kitty: [["Key", "Value"], ["sheet_version", "3"], ["household_name", "Fictional lever test"], ["people", "Ann, Bo"]],
    Settings: [["Setting", "Value"], ["As-of date", "2027-01-31"]],
    Accounts: [["Account ID", "Account", "Type"], ["A01", "Fictional everyday", "Transaction"], ["A02", "Fictional saver", "Savings"]],
    Categories: [["Category ID", "Category", "Group", "Flow"], ["FOOD", "Food", "Essentials", "Expense"]],
    Entries: [["Entry ID", "Kind", "Settled at", "Account ID", "Raw text", "Description", "Amount", "Category ID"]],
    Balances: [["Month end"]], Rules: [["Rule ID"]],
    Contracts: [["Contract ID", "Kind", "Name", "Provider", "Owner", "Account ID", "Category ID", "Cadence", "Amount", "Rate", "Start date", "End date", "Next date", "Last used", "Cover", "Status", "Note"],
      ["C1", "subscription", "Fictional streaming", "Fictional Co", "Ann", "", "FOOD", "Monthly", "$12.00", "", "", "", "14 Feb 2027", "", "", "active", ""]],
    Decisions: [["Decision ID", "Ref kind", "Ref ID", "Decision", "Value", "By", "At", "Note"]],
    Goals: [["Goal", "Target amount", "Target date", "Linked account", "Balance now", "Progress", "Months left", "Needed per month", "Saved per month (last 3 months)", "Status"],
      ["Rainy day", "$10,000.00", "31 Dec 2027", "A02", "$4,000.00", "40.0%", "11", "$545.45", "$500.00", "Behind"]],
    "Goal Levers": [["Lever ID", "Goal", "Lever", "On", "Per month", "One-off", "Date if on", "Date if off", "Months moved", "Source"],
      ["GL-1", "Rainy day", "A fictional $200 transfer", "TRUE", "$200.00", "$0.00", "Oct 2027", "Jan 2028", "3", "Test"],
      ["GL-2", "Rainy day", "A fictional $300 cut", "FALSE", "$300.00", "$0.00", "Jul 2027", "Oct 2027", "3", "Test"]],
    "Decision Options": [["Decision ID", "Question", "Ref", "Option", "Upfront", "Per month", "Months", "Extra", "Total", "Recommended", "Decide by", "Status", "Source", "Note"],
      ["DQ-1", "Keep the fictional streaming?", "C1", "Keep", "$0.00", "$12.00", "12", "$0.00", "$144.00", "FALSE", "28 Feb 2027", "Open", "Price list", ""],
      ["DQ-1", "", "C1", "Cancel", "$0.00", "$0.00", "12", "$0.00", "$0.00", "TRUE", "28 Feb 2027", "Open", "", ""]],
    "Tax Returns": [["Person", "FY", "Status", "Taxable income", "Tax on income", "Medicare", "Offsets", "Withheld", "Result", "Lodged", "Notice", "Pack", "Source", "Note"],
      ["Ann", "FY26", "Assessed", "$80,000.00", "$15,788.00", "$1,600.00", "$0.00", "$18,000.00", "$612.00", "1 Sep 2026", "20 Sep 2026", "", "", ""]],
    Receipts: [["Receipt ID", "Date", "Time", "Merchant", "Merchant ID", "Store", "Channel", "Person", "Items", "Total", "GST", "Savings", "Paid with", "Entry ID", "Account ID", "Source", "Source kind", "Read by", "Check", "Note"],
      ["R0001", "20 Jan 2027", "10:00", "Fictional Grocer", "", "Testville", "In-store", "Ann", "2", "$7.50", "$0.00", "$0.00", "Cash", "", "", "", "Photo", "Test", "OK", ""]],
    "Receipt Lines": [["Receipt ID", "Line", "Printed text", "Product", "Brand", "Group", "Kind", "Qty", "Unit", "Unit price", "Amount", "GST", "Pack size", "Price per kg or L", "Retailer code", "Note"],
      ["R0001", "1", "MILK 2L", "Milk 2L", "", "Dairy & eggs", "Item", "1", "each", "$3.50", "$3.50", "GST-free", "2L", "$1.75", "0783", ""],
      ["R0001", "2", "BREAD", "Bread", "", "Bakery", "Item", "1", "each", "$4.00", "$4.00", "GST-free", "", "", "", ""]],
  };
  for (const t of missing) delete tabs[t];
  return tabs;
}

async function openLive(page, missing) {
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.addInitScript(({ tabs, missing }) => {
    window.kittyV3 = { calls: [], writes: [] };
    const state = window.kittyV3;
    const mcp = {
      invalidate: async () => {},
      callTool: async (_server, tool, input) => {
        state.calls.push(tool);
        let payload;
        if (tool === "get_spreadsheet") payload = { sheets: Object.keys(tabs).map((title) => ({ properties: { title, gridProperties: { rowCount: 25 } } })) };
        else if (tool === "get_values") {
          const [tab, cells] = input.range.split("!"), title = tab.replace(/^'(.*)'$/, "$1");
          if (missing.includes(title)) throw { code: "tool_error", message: `Unable to parse range: ${input.range}` };   // the tab does not exist
          const all = tabs[title] || [], rows = /^A1:A$/.test(cells) ? all.map((r) => [r[0]]) : all;
          payload = { range: input.range, majorDimension: "ROWS", values: rows };
        } else if (tool === "update_values") {
          state.writes.push({ range: input.range, values: input.values });
          const m = /^'Goal Levers'!D(\d+)$/.exec(input.range);
          if (!m) throw new Error("an unexpected write: " + input.range);
          tabs["Goal Levers"][+m[1] - 1][3] = input.values[0][0] ? "TRUE" : "FALSE";
          payload = { updatedCells: 1 };
        } else throw new Error("unexpected tool " + tool);
        return { payload, cache: { storedAt: Date.now() } };
      },
    };
    window.claude = { use: async (c) => (c === "mcp" ? mcp : c === "user" ? { isOwner: async () => true, me: async () => ({ name: "Fictional owner" }), id: async () => null } : null) };
  }, { tabs: household({ missing }), missing });
  await page.goto(url + "?noonb&noanim&layout=default");
  await expect(page.locator("#trustpill")).toHaveText(/^Live demo · \d{1,2} \w{3} \d{4}$/);   // the pill carries the data date
}

test("a version 3 sheet opens Live with Things and Tax lit, and reading it writes nothing", async ({ page }) => {
  await openLive(page, []);
  await expect(page.locator('nav.tabs [data-tab="things"]')).toBeVisible();
  await expect(page.locator('nav.tabs [data-tab="tax"]')).toBeVisible();
  await page.locator('nav.tabs [data-tab="things"]').click();
  await expect(page.locator("#v-things")).toContainText("Keep the fictional streaming?");
  await page.locator('nav.tabs [data-tab="tax"]').click();
  await expect(page.locator("#v-taxview")).toContainText("Ann");
  await page.locator('nav.tabs [data-tab="insights"]').click();
  await expect(page.locator("#grochost")).toContainText("Fictional Grocer");
  const calls = await page.evaluate(() => window.kittyV3.calls);
  expect(calls.filter((t) => t !== "get_values" && t !== "get_spreadsheet")).toEqual([]);
});

test("a lever switch asks first, then writes only that lever's On cell, found by its Lever ID", async ({ page }) => {
  await openLive(page, []);
  await page.locator('nav.tabs [data-tab="goals"]').click();
  const board = page.locator("#leverhost");
  await expect(board).toContainText("Rainy day");
  await expect(board).toContainText("A switch writes the lever's On box on the Goal Levers tab");
  await board.locator('[data-switch="GL-2"]').click();
  await expect(board.locator(".kx-lv-ask")).toContainText("in the sheet?");
  expect(await page.evaluate(() => window.kittyV3.writes)).toEqual([]);
  await board.locator(".kx-lv-yes").click();
  await expect(page.locator("#toast")).toContainText("Switched on in the sheet");
  expect(await page.evaluate(() => window.kittyV3.writes)).toEqual([{ range: "'Goal Levers'!D3", values: [[true]] }]);
  await expect(board.locator('[data-switch="GL-2"]')).toHaveAttribute("aria-checked", "true");
});

test("missing version 3 tabs keep their views dark and the rest of the page Live", async ({ page }) => {
  await openLive(page, ["Tax Returns", "Receipts", "Receipt Lines", "Goal Levers", "Decision Options"]);
  await page.locator('nav.tabs [data-tab="goals"]').click();
  await expect(page.locator("#leverhost")).toBeHidden();
  await page.locator('nav.tabs [data-tab="insights"]').click();
  await expect(page.locator("#grochost")).toBeHidden();
  await expect(page.locator("#v-taxview")).toBeEmpty();
  // Things still lights from Contracts alone, without decision cards
  await page.locator('nav.tabs [data-tab="things"]').click();
  await expect(page.locator("#v-things")).toContainText("Fictional streaming");
  await expect(page.locator("#v-things .kx-th-dec")).toHaveCount(0);
});
