// Files as delivered. A list for one portal, or one file's bytes. /vault/<path> rewrites to here, so a file's address has not moved,
// but it now answers to the clock and the person like everything else.
"use strict";
const { query, json, send } = require("../lib/http");
const { who } = require("../lib/auth");
const { brandById } = require("../lib/data");
const { viewOf } = require("../lib/view");
const { filesFor, fileAt } = require("../lib/vault");
const { fileBytes } = require("../lib/estate-files");
const { mustWait, stamp } = require("../lib/friction");

module.exports = async (req, res) => {
  const qs = query(req);
  try {
    if (qs.path) {
      const f = fileAt(`vault/${String(qs.path).replace(/^vault\//, "")}`);
      if (!f) return json(res, 404, { error: "No such file." });
      if (!who(req, f.brand)) return json(res, 401, { error: `Sign in to ${brandById[f.brand].name} first.` });
      const view = viewOf(req, f.brand);
      if (!filesFor(f.brand, view).files.some((x) => x.path === f.path)) return json(res, 404, { error: "No such file." });
      if (mustWait(req, res, brandById[f.brand], view)) return undefined;
      const bytes = fileBytes(f.path);
      stamp(req, res, brandById[f.brand], view);
      return send(res, 200, bytes, { "Content-Type": f.type, "Content-Disposition": `attachment; filename="${f.name.replace(/["\\\r\n]/g, "")}"`, "Content-Length": String(bytes.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    }
    const brand = brandById[String(qs.brand || "")];
    if (!brand) return json(res, 404, { error: "No such portal." });
    if (!who(req, brand.id)) return json(res, 401, { error: "Sign in first." });
    return json(res, 200, filesFor(brand.id, viewOf(req, brand.id)));
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    throw e;
  }
};
