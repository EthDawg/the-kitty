// Who is signed in. Any name still signs in with the password demo and sees the whole household, as the portals always did.
// A name in life/davies/profile.json signs in as that person: their own things, the things they hold jointly, and the friction
// a real site has. Who holds what comes from the world's own ownership tables (estate/access.json, written by build-vault.js).
"use strict";
const fs = require("fs");
const path = require("path");
const { readEstate, NotBuilt } = require("./estate-files");

// the deployed copy, or the source itself in a checkout that has not built the estate
const profile = () => {
  try { return readEstate("people.json"); } catch (e) {
    if (!(e instanceof NotBuilt)) throw e;
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "life", "davies", "profile.json"), "utf8"));
  }
};
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

const toPerson = (p) => ({ id: p.id, first_name: p.first_name, full_name: `${p.first_name} ${p.family_name}`, party_id: p.world.party_id, world_first_name: p.world.first_name });

const personOf = (name) => {
  const n = norm(name);
  if (!n) return null;
  const p = profile().people.find((x) => x.sign_in && x.sign_in.names.includes(n));
  return p ? toPerson(p) : null;
};

// Held at this date? A subject with no row in the table is the household's, so both adults see it.
const holds = (person, subject, at) => {
  if (!person) return true;
  const rows = readEstate("access.json").subjects[subject];
  if (!rows) return true;
  return rows.some((r) => r.party === person.party_id && r.from <= at && (!r.to || at < r.to));
};

module.exports = { personOf, holds, profile };
