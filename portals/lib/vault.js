// The vault as one view lists it: delivered by today, theirs to see, and recent enough for this portal to still keep it.
// The files are static, so this filters what is listed. It does not, and cannot, stop a fetch of an address someone already has.
"use strict";
const { readEstate } = require("./estate-files");
const { holds } = require("./people");
const { has } = require("./clock");
const { lastDay, yearsBefore } = require("./data");

const visible = (f, view, last) => {
  const at = view.today || last, oldest = view.rules.back_years ? yearsBefore(at, view.rules.back_years) : null;
  if (!has(view, f.delivered_on) || (oldest && f.delivered_on < oldest)) return false;
  if (f.visible_to) return !view.person || f.visible_to.includes(view.person.id);
  return holds(view.person, f.stream, lastDay(view));
};

const filesFor = (brandId, view) => {
  const v = readEstate("vault.json", view.family);
  const files = v.files.filter((f) => f.brand === brandId && visible(f, view, v.last));
  const streams = v.streams.filter((s) => s.brand === brandId).map(({ brand, id, name }) => {
    const mine = files.filter((f) => f.stream === id).map((f) => f.date).sort();
    return { brand, id, name, files: mine.length, first: mine[0], last: mine[mine.length - 1] };
  }).filter((s) => s.files);
  return { streams, files };
};

module.exports = { filesFor, visible };
