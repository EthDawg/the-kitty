// Who is signed in. Any name still signs in with the password demo and sees the whole household, as the portals always did.
// A name in data/cast.json signs in as that person: their own things, the things they hold jointly, and the friction
// a real site has. Who holds what comes from the world's own ownership tables (estate/access.json, written by build-vault.js).
"use strict";
const { readEstate } = require("./estate-files");
const CAST = require("../data/cast.json");

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

const personOf = (name) => {
  const n = norm(name);
  const p = n && CAST.people.find((x) => x.names.includes(n));
  if (!p) return null;
  const first = n.startsWith(p.papers_say.toLowerCase()) ? p.papers_say : p.first_name; // greet people by the name they gave
  return { id: p.id, first_name: first, full_name: `${first} ${CAST.family_name}`, party_id: p.party_id, papers_say: p.papers_say };
};

// Held at this date? A subject with no row in the table is the household's, so both adults see it.
const holds = (person, subject, at) => {
  if (!person) return true;
  const rows = readEstate("access.json").subjects[subject];
  if (!rows) return true;
  return rows.some((r) => r.party === person.party_id && r.from <= at && (!r.to || at < r.to));
};

module.exports = { personOf, holds, CAST };
