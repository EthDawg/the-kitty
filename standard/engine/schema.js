/* The schema as data: parse the compact column form, validate rows. One source, every projection generated from it. */
"use strict";

function parseColumn(spec) {
  const [name, type, ...flags] = spec.split(":");
  const col = { name, type, pk: false, required: false, fk: null, enum: null };
  for (const f of flags) {
    if (f === "pk") { col.pk = true; col.required = true; }
    else if (f === "req") col.required = true;
    else if (f.startsWith("fk=")) { const [table, column] = f.slice(3).split("."); col.fk = { table, column }; }
    else if (f.startsWith("enum=")) col.enum = f.slice(5).split("|");
  }
  return col;
}
function tables(schema) {
  const out = {};
  for (const [name, t] of Object.entries(schema.tables)) out[name] = { name, plane: t.plane, temporal: t.temporal, doc: t.doc, columns: t.columns.map(parseColumn) };
  return out;
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/, ISO_TIME = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/;
function checkValue(col, v) {
  if (v === null || v === undefined || v === "") return col.required ? "required" : null;
  switch (col.type) {
    case "date": return ISO_DATE.test(v) ? null : `not a date: ${v}`;
    case "datetime": return ISO_TIME.test(v) ? null : `not a timestamp: ${v}`;
    case "cents": case "int": case "bps": return Number.isInteger(v) ? null : `not an integer: ${v}`;
    case "bool": return typeof v === "boolean" ? null : `not a boolean: ${v}`;
    case "units": case "rate": return /^-?\d+(\.\d+)?$/.test(String(v)) ? null : `not a decimal: ${v}`;
    default: break;
  }
  if (col.enum && !col.enum.includes(v)) return `not in ${col.enum.join("|")}: ${v}`;
  return null;
}
function validateRow(t, row) {
  const errs = [];
  for (const col of t.columns) {
    const e = checkValue(col, row[col.name]);
    if (e) errs.push(`${t.name}.${col.name}: ${e}`);
  }
  return errs;
}
module.exports = { parseColumn, tables, validateRow, checkValue };
