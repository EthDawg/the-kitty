#!/usr/bin/env node
// Screenshots a built demo at 1280x900 and 390x844, light and dark: node tools/kit-demo/shot.js <module> [outdir] [w=home]
"use strict";
const path = require("path");
const pwPath = [path.join(__dirname, "..", "..", "portals", "node_modules", "playwright"), path.join(process.env.HOME, "Developer/the-kitty/portals/node_modules/playwright")].find((p) => { try { require.resolve(p); return true; } catch (e) { return false; } });
const pw = require(pwPath);
const mod = process.argv[2], out = process.argv[3] || path.join(__dirname, "out"), extra = process.argv[4] || "";
(async () => {
  const b = await pw.chromium.launch();
  const errs = [];
  for (const [w, h] of [[1280, 900], [390, 844]]) for (const theme of ["light", "dark"]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: theme });
    p.on("pageerror", (e) => errs.push(`${w}/${theme}: ${e.message}`)); p.on("console", (m) => { if (m.type() === "error") errs.push(`${w}/${theme}: ${m.text()}`); });
    await p.goto("file://" + path.join(__dirname, "out", `${mod}.html`) + `?theme=${theme}${extra ? "&" + extra : ""}`);
    await p.waitForFunction(() => window.__ready, null, { timeout: 5000 }).catch(() => errs.push("not ready"));
    await p.waitForTimeout(400);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (sw > 0) errs.push(`${w}/${theme}: page scrolls sideways by ${sw}px`);
    await p.screenshot({ path: path.join(out, `${mod}${extra ? "-" + extra.replace(/\W/g, "") : ""}-${w}-${theme}.png`), fullPage: true });
    await p.close();
  }
  await b.close();
  console.log(errs.length ? errs.join("\n") : "no errors");
})();
