/* The pack, for anything that loads it as one thing. ORDER is the load order for a page, where each file adds itself to window.KittyPack. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require);
  else root.KittyPack.ready = true;
})(typeof self !== "undefined" ? self : this, function (req) {
  "use strict";
  const ORDER = ["pack", "formula", "zip", "xlsx", "pdf", "tfn", "evidence", "tax", "workbookTax", "workbookGeneric", "bundle", "takeback", "lender", "blank"];
  const FILE = { workbookTax: "workbook-tax", workbookGeneric: "workbook-generic" };
  const out = { ORDER, FILE };
  for (const m of ORDER) out[m] = req(`./${FILE[m] || m}.js`);
  return out;
});
