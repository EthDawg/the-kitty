"use strict";
const { readBody, json, redirect, wantsJson, secure } = require("../lib/http");
const { PASSWORD, signInCookie, cleanName } = require("../lib/auth");
const { brandById } = require("../lib/data");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST a name and the password demo." });
  const body = await readBody(req);
  const brand = brandById[String(body.brand || "")];
  const name = cleanName(body.name);
  if (!brand) return json(res, 404, { error: "No such portal." });
  if (!name || String(body.password || "") !== PASSWORD) {
    return wantsJson(req) ? json(res, 401, { error: "Any name will do, and the password is demo." }) : redirect(res, `/${brand.id}?error=1`);
  }
  res.setHeader("Set-Cookie", signInCookie(brand.id, name, secure(req)));
  return wantsJson(req) ? json(res, 200, { ok: true, name, brand: brand.id }) : redirect(res, `/${brand.id}`);
};
