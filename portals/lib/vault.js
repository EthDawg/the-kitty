// The vault as one view sees it: exists yet, theirs to see, and recent enough for this portal to still keep it.
"use strict";
const { readEstate } = require("./estate-files");
const { holds } = require("./people");
const { has } = require("./clock");
const { lastDay, firstDay } = require("./data");

const pathIndex = () => {
  const v = readEstate("vault.json");
  if (v.byPath !== undefined) return v.byPath;
  Object.defineProperty(v, "byPath", { value: new Map(v.files.map((f) => [f.path, f])), enumerable: false });
  return v.byPath;
};
const fileAt = (p) => pathIndex().get(p) || null;

const visible = (f, view) => {
  const oldest = firstDay(view), at = lastDay(view);
  return has(view, f.exists_from) && (!oldest || f.exists_from >= oldest) && holds(view.person, f.stream, at);
};

const filesFor = (brandId, view) => {
  const v = readEstate("vault.json");
  const files = v.files.filter((f) => f.brand === brandId && visible(f, view));
  const streams = v.streams.filter((s) => s.brand === brandId).map(({ brand, id, name }) => {
    const mine = files.filter((f) => f.stream === id).map((f) => f.date).sort();
    return { brand, id, name, files: mine.length, first: mine[0], last: mine[mine.length - 1] };
  }).filter((s) => s.files);
  return { streams, files };
};

module.exports = { fileAt, filesFor, visible };
