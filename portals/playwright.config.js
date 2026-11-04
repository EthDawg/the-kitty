// Chromium only, one worker: the run signs in, downloads, then hands the files to the Python importer.
const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "./test",
  testMatch: /.*\.spec\.js/,
  timeout: 180000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:4173", acceptDownloads: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "node server.js", url: "http://127.0.0.1:4173/", reuseExistingServer: !process.env.CI, timeout: 30000 },
  projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 860 } } }],
});
