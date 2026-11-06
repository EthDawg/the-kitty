/* The runtime under Node: shared data from disk, a Folder store on a real folder. Nothing else here may be Node-only. */
"use strict";
const fs = require("fs"), path = require("path");
const K = require("./index");

const root = path.join(__dirname, "..", "..");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
function loadRecipes() {
  const dir = path.join(root, "standard", "recipes");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => readJson(path.join(dir, f)));
}
K.setBase({ recipes: loadRecipes(), merchants: readJson(path.join(root, "merchants", "merchants.json")), categories: readJson(path.join(root, "merchants", "categories.json")) });
const folder = (dir) => K.folderStore({ dir: path.resolve(dir), fs });
module.exports = { ...K, folder };
