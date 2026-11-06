#!/usr/bin/env node
/* node standard/intake/fp.js <file>: a file's fingerprint and its decoded head, what a recipe writer needs to see. */
"use strict";
const fs = require("fs");
const { decode } = require("./containers");
const { fingerprint, structure } = require("./fingerprint");
const { hostInflate } = require("./index");

const file = process.argv[2];
if (!file) { console.error("usage: node standard/intake/fp.js <file>"); process.exit(2); }
const d = decode(new Uint8Array(fs.readFileSync(file)), { inflate: hostInflate() });
console.log(fingerprint(d));
console.log(JSON.stringify(structure(d)));
for (const r of (d.rows || []).slice(0, 8)) console.log(`row  ${JSON.stringify(r)}`);
for (const l of (d.lines || []).slice(0, 40)) console.log(`p${l.page} ${l.xs ? `x${l.xs.map((x) => Math.round(x)).join(",")} ` : ""}${l.text}`);
