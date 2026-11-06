"use strict";
const { query, json, attachment } = require("../lib/http");
const { brandById } = require("../lib/data");
const { buildExport, ExportError } = require("../lib/exports");
const { viewOf } = require("../lib/view");
const { mustWait, stamp } = require("../lib/friction");

module.exports = async (req, res) => {
  const qs = query(req);
  const brand = brandById[String(qs.brand || "")];
  if (!brand) return json(res, 404, { error: "No such portal." });
  try {
    const view = viewOf(req, brand.id);
    if (!view.name) return json(res, 401, { error: "Sign in first." });
    if (mustWait(req, res, brand, view)) return undefined;
    const file = await buildExport({ brand: brand.id, account: String(qs.account || ""), from: String(qs.from || ""), to: String(qs.to || ""), format: String(qs.format || "csv"), view });
    stamp(req, res, brand, view);
    return attachment(res, file.filename, file.body, file.type);
  } catch (e) {
    if (e instanceof ExportError || e.status) return json(res, e.status || 500, { error: e.message });
    throw e;
  }
};
