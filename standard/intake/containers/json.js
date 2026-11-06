/* JSON. Flattened into named tables so one recipe language covers it: every array of objects is a table at its dotted path; every scalar is in
   meta.values at its dotted path. rows is the longest table, or a key/value table when there is none. */
"use strict";
const { utf8, stripBom } = require("./text");

const flat = (o, prefix, out) => {
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) flat(v, p, out);
    else out[p] = v;
  }
  return out;
};

function tablesOf(v, path, tables, values) {
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x !== null && typeof x === "object" && !Array.isArray(x))) {
      const objs = v.map((x) => flat(x, "", {}));
      const cols = []; for (const o of objs) for (const k of Object.keys(o)) if (!cols.includes(k)) cols.push(k);
      const str = (x) => (x == null ? "" : typeof x === "object" ? JSON.stringify(x) : String(x));
      tables[path || "$"] = [cols.filter((c) => !objs.some((o) => Array.isArray(o[c]))), ...objs.map((o) => cols.filter((c) => !objs.some((p) => Array.isArray(p[c]))).map((c) => str(o[c])))];
      v.forEach((x, i) => { for (const [k, val] of Object.entries(x)) if (Array.isArray(val)) tablesOf(val, `${path}[${i}].${k}`, tables, values); });
    } else values[path] = v;
    return;
  }
  if (v !== null && typeof v === "object") { for (const [k, x] of Object.entries(v)) tablesOf(x, path ? `${path}.${k}` : k, tables, values); return; }
  values[path] = v;
}

function decode(bytes) {
  const doc = JSON.parse(stripBom(utf8(bytes))), tables = {}, values = {};
  tablesOf(doc, "", tables, values);
  const names = Object.keys(tables).sort((a, b) => tables[b].length - tables[a].length || (a < b ? -1 : 1));
  const rows = names.length ? tables[names[0]] : [["path", "value"], ...Object.entries(values).map(([k, v]) => [k, String(v)])];
  return { rows, meta: { container: "json", tables, values, table: names[0] || null, doc } };
}

module.exports = { decode };
