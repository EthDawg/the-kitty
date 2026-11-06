// The real page, in a real browser, from nothing. Run from portals/, which holds Playwright:
//   npx playwright test --config=../tools/page/playwright.config.js --output=<a private folder>
const path = require("path");
const { defineConfig } = require(path.join(__dirname, "..", "..", "portals", "node_modules", "@playwright", "test"));
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.js/,
  timeout: 120000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4188", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: `node ${path.join(__dirname, "serve.js")}`, url: "http://127.0.0.1:4188/kitty-v2.html", reuseExistingServer: !process.env.CI, timeout: 15000 },
  projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1100, height: 820 } } }],
});
