// The Drive connector's query language: `title contains 'tax' and modifiedTime > '2024-01-01T00:00:00Z'`, with and, or, not and parentheses.
// parseQuery turns one into a test on a file and its text. A query this does not understand is refused in words, the way the real one is.
"use strict";

class QueryError extends Error { constructor(message) { super(message); this.status = 400; } }

const tokens = (q) => {
  const out = [];
  const re = /\s*(?:(\(|\))|('(?:\\.|[^'\\])*')|(<=|>=|!=|=|<|>)|([A-Za-z_][\w.]*))/y;
  let at = 0;
  while (at < q.length) {
    re.lastIndex = at;
    const m = re.exec(q);
    if (!m) { if (!q.slice(at).trim()) break; throw new QueryError(`Could not read the query at: ${q.slice(at, at + 20)}`); }
    at = re.lastIndex;
    if (m[1]) out.push({ t: m[1] });
    else if (m[2]) out.push({ t: "str", v: m[2].slice(1, -1).replace(/\\(.)/g, "$1") });
    else if (m[3]) out.push({ t: "op", v: m[3] });
    else out.push({ t: "word", v: m[4] });
  }
  return out;
};

const cmp = (a, op, b) => (op === "=" ? a === b : op === "!=" ? a !== b : op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b);
const when = (s) => { const d = String(s); return d.length === 10 ? `${d}T09:00:00Z` : d; };

const clause = (field, op, value, view) => {
  const low = String(value).toLowerCase();
  const need = (ops) => { if (!ops.includes(op)) throw new QueryError(`${field} takes ${ops.join(", ")}, not ${op}`); };
  switch (field) {
    case "title": need(["contains", "=", "!="]); return (i) => (op === "contains" ? i.title.toLowerCase().includes(low) : cmp(i.title, op, value));
    case "fullText": need(["contains"]); return (i, text) => i.title.toLowerCase().includes(low) || (text || "").toLowerCase().includes(low);
    case "mimeType": need(["contains", "=", "!="]); return (i) => (op === "contains" ? i.mimeType.includes(value) : cmp(i.mimeType, op, value));
    case "modifiedTime": case "createdTime": case "viewedByMeTime": need(["<", "<=", "=", "!=", ">", ">="]); return (i) => cmp(when(i[field] || i.modifiedTime || i.createdTime), op, when(value));
    case "parentId": need(["=", "!="]); return (i) => cmp(i.parentId, op, value);
    case "owner": need(["=", "!="]); return (i) => { const me = value === "me" ? (view.person && view.person.id) : low.split(/[\s@]/)[0]; return cmp(i.owner, op, me); };
    case "trashed": need(["=", "!="]); return () => cmp(false, op, low === "true");
    case "starred": case "sharedWithMe": need(["=", "!="]); return (i) => { const shared = field === "sharedWithMe" && i.people.length > 1 && (!view.person || i.owner !== view.person.id); return cmp(shared, op, low === "true"); };
    default: throw new QueryError(`Unknown term: ${field}`);
  }
};

const parseQuery = (query, view) => {
  const q = String(query == null ? "" : query).trim();
  if (!q) return () => true;
  const toks = tokens(q);
  let p = 0;
  const peek = () => toks[p];
  const word = (w) => peek() && peek().t === "word" && peek().v.toLowerCase() === w;
  const expr = () => { let left = term(); while (word("or")) { p++; const a = left, b = term(); left = (i, t) => a(i, t) || b(i, t); } return left; };
  const term = () => { let left = factor(); while (word("and")) { p++; const a = left, b = factor(); left = (i, t) => a(i, t) && b(i, t); } return left; };
  const factor = () => {
    if (word("not")) { p++; const a = factor(); return (i, t) => !a(i, t); }
    if (peek() && peek().t === "(") { p++; const a = expr(); if (!peek() || peek().t !== ")") throw new QueryError("A bracket is not closed."); p++; return a; }
    const f = toks[p++];
    if (!f || f.t !== "word") throw new QueryError("Expected a term such as title or fullText.");
    const o = toks[p++];
    const op = o && (o.t === "op" ? o.v : o.t === "word" && o.v === "contains" ? "contains" : null);
    if (!op) throw new QueryError(`Expected an operator after ${f.v}.`);
    const v = toks[p++];
    if (!v || (v.t !== "str" && v.t !== "word")) throw new QueryError(`Expected a value after ${f.v} ${op}.`);
    return clause(f.v, op, v.v, view);
  };
  const test = expr();
  if (p < toks.length) throw new QueryError("There is something left over at the end of the query.");
  return test;
};

module.exports = { parseQuery, QueryError };
