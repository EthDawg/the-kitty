/* The answer key: the recipes a family's agent would write for layouts no public recipe reads. Used to prove a variant is fair, and kept in answers/ so a blind actor never sees it. */
"use strict";
const path = require("path");
const { STD } = require("./std");
const { decode } = require(path.join(STD, "intake", "containers"));
const { fingerprint } = require(path.join(STD, "intake", "fingerprint"));
const { hostInflate } = require(path.join(STD, "intake"));
const { recipeFor } = require("./shapes");

function answerKey(cast, files) {
  const out = [], seen = new Set(), inflate = hostInflate();
  for (const [role, inst] of Object.entries(cast.institutions)) {
    const spec = inst.spec;
    if (!spec || spec.family || spec.special) continue;
    const f = files.find((x) => x.shape === role); if (!f) continue;
    const fp = fingerprint(decode(f.bytes, { inflate })), id = spec.key || `answer-${inst.brand}-${inst.shape}`;
    if (seen.has(id)) continue;
    seen.add(id); out.push(recipeFor(id, spec, fp));
  }
  return out;
}

module.exports = { answerKey };
