"use strict";
const { readBody, cookies, json, redirect, wantsJson, secure } = require("../lib/http");
const { PASSWORD, doorsOf, signInCookie, cleanName, codeFor, codeOk, makeToken, tokenOf } = require("../lib/auth");
const { brandById } = require("../lib/data");
const { personOf } = require("../lib/people");
const { rulesFor, newRun, runCookie } = require("../lib/view");
const Clock = require("../lib/clock");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST a name and the password demo." });
  const body = await readBody(req);
  const brand = brandById[String(body.brand || "")];
  const name = cleanName(body.name);
  if (!brand) return json(res, 404, { error: "No such portal." });
  if (!name || String(body.password || "") !== PASSWORD) {
    return wantsJson(req) ? json(res, 401, { error: "Any name will do, and the password is demo." }) : redirect(res, `/${brand.id}?error=1`);
  }
  const person = personOf(name);
  if (person && rulesFor(brand.id).second_factor) {
    const how = `${brand.name} would text this to ${person.first_name}'s phone. It is shown here because this is a demo.`;
    if (!body.code) return json(res, 200, { needs_code: true, code: codeFor(brand.id, name), how });
    if (!codeOk(brand.id, name, body.code)) return json(res, 401, { error: "That code is not right. Use the one on screen.", needs_code: true, code: codeFor(brand.id, name), how });
  }
  const wanted = body.today || body.as_of;
  const clock = wanted || body.chapter != null ? Clock.parse(wanted || `chapter-${body.chapter}`) : null;
  const run = (tokenOf(req) || {}).run || cookies(req).kp_run || newRun();
  const set = [...doorsOf(brand.id).map((b) => signInCookie(b, name, secure(req))), runCookie(run, secure(req))];
  if (clock) set.push(Clock.setCookie(clock, secure(req)));
  res.setHeader("Set-Cookie", set);
  const token = makeToken({ brand: brand.id, name, run, as_of: Clock.write(clock || Clock.parse(cookies(req)[Clock.cookieName]) || Clock.NONE) });
  return wantsJson(req) ? json(res, 200, { ok: true, name, brand: brand.id, person, token }) : redirect(res, `/${brand.id}`);
};
