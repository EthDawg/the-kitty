// Files as delivered: the list for one portal, as this view may see it. The files themselves are static, under /vault/.
"use strict";
const { query, json } = require("../lib/http");
const { brandById } = require("../lib/data");
const { viewOf } = require("../lib/view");
const { filesFor } = require("../lib/vault");

module.exports = async (req, res) => {
  const qs = query(req), brand = brandById[String(qs.brand || "")];
  if (!brand) return json(res, 404, { error: "No such portal." });
  try {
    const view = viewOf(req, brand.id);
    if (!view.name) return json(res, 401, { error: "Sign in first." });
    return json(res, 200, filesFor(brand.id, view));
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    throw e;
  }
};
