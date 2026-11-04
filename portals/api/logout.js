"use strict";
const { query, readBody, json, redirect, wantsJson, secure } = require("../lib/http");
const { signOutCookie } = require("../lib/auth");
const { brandById } = require("../lib/data");

module.exports = async (req, res) => {
  const body = req.method === "POST" ? await readBody(req) : {};
  const brand = brandById[String(body.brand || query(req).brand || "")];
  if (!brand) return json(res, 404, { error: "No such portal." });
  res.setHeader("Set-Cookie", signOutCookie(brand.id, secure(req)));
  return wantsJson(req) ? json(res, 200, { ok: true }) : redirect(res, `/${brand.id}`);
};
