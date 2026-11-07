// Which family a request is about. The benchmark world, 2019 to 2027, is the default; a generated life is chosen with ?family=. estate/families.json
// says who is here, written by build-vault.js. In a checkout with no estate built, the benchmark's cast still works.
"use strict";
const { readEstate, NotBuilt } = require("./estate-files");
const CAST = require("../data/cast.json");

const BENCHMARK = "benchmark";
const benchmarkPeople = () => CAST.people.map((p) => ({ id: p.id, first_name: p.first_name, full_name: `${p.first_name} ${CAST.family_name}`, party_id: p.party_id }));

const families = () => {
  try { return readEstate("families.json").families; } catch (e) {
    if (!(e instanceof NotBuilt)) throw e;
    return [{ id: BENCHMARK, people: benchmarkPeople() }];
  }
};

const familyOf = (value) => {
  const id = String(value || BENCHMARK);
  if (families().some((f) => f.id === id)) return id;
  const e = new Error("No such family here."); e.status = 404; throw e;
};
const peopleOf = (family) => families().find((f) => f.id === family).people;

module.exports = { BENCHMARK, benchmarkPeople, familyOf, peopleOf, families };
