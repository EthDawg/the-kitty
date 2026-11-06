/* The Davies world, read from disk as replayWorld wants it. Node only: tests and the browser proof use it, the bundle does not. */
"use strict";
const fs = require("fs"), path = require("path");
const { walkRoot } = require("../../standard/intake");

function loadWorld(dir) {
  const json = (p) => JSON.parse(fs.readFileSync(path.join(dir, p), "utf8"));
  const setup = {};
  for (const f of fs.readdirSync(path.join(dir, "setup"))) setup[f.replace(".json", "")] = json(path.join("setup", f));
  const facts = new Map(json("manifest.json").files.map((m) => [m.path, m]));
  const files = walkRoot(dir).map((f) => { const m = facts.get(f.path) || {}; return { ...f, origin: m.origin, issued_on: m.issued_on }; });
  return { setup, files, decisions: json("decisions/person.json"), rules: json("decisions/rules.json") };
}
module.exports = { loadWorld };
