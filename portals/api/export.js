"use strict";
const { query, json, attachment } = require("../lib/http");
const { who } = require("../lib/auth");
const { brandById } = require("../lib/data");
const { buildExport, ExportError } = require("../lib/exports");

module.exports = async (req, res) => {
  const qs = query(req);
  const brand = brandById[String(qs.brand || "")];
  if (!brand) return json(res, 404, { error: "No such portal." });
  if (!who(req, brand.id)) return json(res, 401, { error: "Sign in first." });
  try {
    const file = await buildExport({ brand: brand.id, account: String(qs.account || ""), from: String(qs.from || ""), to: String(qs.to || ""), format: String(qs.format || "csv") });
    return attachment(res, file.filename, file.body, file.type);
  } catch (e) {
    if (e instanceof ExportError) return json(res, e.status, { error: e.message });
    throw e;
  }
};
