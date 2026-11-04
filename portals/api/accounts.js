"use strict";
const { query, json } = require("../lib/http");
const { who } = require("../lib/auth");
const { brandById, accountsFor, presets, today, D } = require("../lib/data");
const { preview, ExportError } = require("../lib/exports");

module.exports = async (req, res) => {
  const qs = query(req);
  const brand = brandById[String(qs.brand || "")];
  if (!brand) return json(res, 404, { error: "No such portal." });
  const name = who(req, brand.id);
  if (!name) return json(res, 401, { error: "Sign in first." });
  try {
    if (qs.account) return json(res, 200, preview({ brand: brand.id, account: qs.account, from: qs.from, to: qs.to }));
    const accounts = accountsFor(brand.id).map((a) => ({ ...a, presets: presets(brand.id, a.kind, a.id) }));
    return json(res, 200, { brand: brand.id, name, today, sheet_through: D.sheet_through, simulated: D.simulated, months: D.months, accounts });
  } catch (e) {
    if (e instanceof ExportError) return json(res, e.status, { error: e.message });
    throw e;
  }
};
