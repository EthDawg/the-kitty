// Sign-in for tests that talk to the API. Each person gets their own cookie jar, the way two people on two phones would.
"use strict";
const API = { "Content-Type": "application/json", Accept: "application/json" };

const session = async (playwright, baseURL) => playwright.request.newContext({ baseURL });

const signIn = async (ctx, brand, name, extra = {}) => {
  let r = await ctx.post("/api/login", { headers: API, data: { brand, name, password: "demo", ...extra } });
  let j = await r.json();
  if (j.needs_code) { r = await ctx.post("/api/login", { headers: API, data: { brand, name, password: "demo", code: j.code, ...extra } }); j = await r.json(); }
  if (!r.ok()) throw new Error(`could not sign in to ${brand} as ${name}: ${JSON.stringify(j)}`);
  return j;
};

const setClock = async (ctx, body) => { const r = await ctx.post("/api/clock", { headers: API, data: body }); if (!r.ok()) throw new Error(await r.text()); return r.json(); };
const getJson = async (ctx, url) => (await ctx.get(url, { headers: API })).json();
const tool = async (ctx, url, data) => { const r = await ctx.post(url, { headers: API, data }); return { status: r.status(), ...(await r.json()) }; };

module.exports = { API, session, signIn, setClock, getJson, tool };
