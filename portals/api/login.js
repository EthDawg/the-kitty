"use strict";
const { query, readBody, json, redirect, wantsJson, secure } = require("../lib/http");
const { PASSWORD, doorsOf, signInCookie, cleanName, codeFor, codeOk, makeToken } = require("../lib/auth");
const { brandById } = require("../lib/data");
const { personOf } = require("../lib/people");
const { rulesFor } = require("../lib/view");
const { familyOf, peopleOf } = require("../lib/families");

// Two doors. `person` is one click, with no password, because an agent must not type one, even a fake one. `name` and the password demo is the old door.
module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const family = familyOf(query(req).family);
      return json(res, 200, { family, people: peopleOf(family).map((p) => ({ id: p.id, first_name: p.first_name })), sign_in: "POST a person, or a name and the password demo." });
    }
    if (req.method !== "POST") return json(res, 405, { error: "POST a person, or a name and the password demo." });
    const body = await readBody(req);
    const brand = brandById[String(body.brand || "")];
    if (!brand) return json(res, 404, { error: "No such portal." });
    const family = familyOf(body.family || query(req).family);
    const chosen = body.person ? peopleOf(family).find((p) => p.id === String(body.person).toLowerCase()) : null;
    if (body.person && !chosen) return json(res, 404, { error: "No such person in this family." });
    const name = chosen ? chosen.first_name : cleanName(body.name);
    if (!chosen && (!name || String(body.password || "") !== PASSWORD)) {
      return wantsJson(req) ? json(res, 401, { error: "Any name will do, and the password is demo." }) : redirect(res, `/${brand.id}?error=1`);
    }
    const person = personOf(name, family);
    if (person && rulesFor(brand.id).second_factor) {
      const how = `${brand.name} would text this to ${person.first_name}'s phone. It is shown here because this is a demo.`;
      if (!body.code) return json(res, 200, { needs_code: true, code: codeFor(brand.id, name), how });
      if (!codeOk(brand.id, name, body.code)) return json(res, 401, { error: "That code is not right. Use the one on screen.", needs_code: true, code: codeFor(brand.id, name), how });
    }
    res.setHeader("Set-Cookie", doorsOf(brand.id).map((b) => signInCookie(b, name, secure(req), family)));
    const token = makeToken({ brand: brand.id, name, family });
    return wantsJson(req) ? json(res, 200, { ok: true, name, brand: brand.id, family, person, token }) : redirect(res, `/${brand.id}`);
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    throw e;
  }
};
