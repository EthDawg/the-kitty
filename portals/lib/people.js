// Who is signed in. Any name still signs in with the password demo and sees the whole household, as the portals always did. One of a family's
// own people, by one click or by name, sees what that person holds and meets the friction a real site has. In the benchmark world, who holds
// what comes from the world's ownership tables (estate/benchmark/access.json). A generated family's files say so themselves, in `visible_to`.
"use strict";
const { readEstate, NotBuilt } = require("./estate-files");
const { BENCHMARK, peopleOf } = require("./families");

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

const personOf = (name, family = BENCHMARK) => {
  const n = norm(name);
  return (n && peopleOf(family).find((p) => [p.first_name, p.full_name].map(norm).includes(n))) || null;
};

// Held at this date? A subject with no row in the table is the household's, so everyone in it sees it.
const holds = (person, subject, at) => {
  if (!person) return true;
  let rows;
  try { rows = readEstate("access.json", BENCHMARK).subjects[subject]; } catch (e) { if (e instanceof NotBuilt) return true; throw e; }
  if (!rows) return true;
  return rows.some((r) => r.party === person.party_id && r.from <= at && (!r.to || at < r.to));
};

module.exports = { personOf, holds };
