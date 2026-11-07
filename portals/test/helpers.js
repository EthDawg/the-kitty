// Sign-in for tests that talk to the API. Each person gets their own cookie jar, the way two people on two phones would.
"use strict";
const API = { "Content-Type": "application/json", Accept: "application/json" };

const session = async (playwright, baseURL) => playwright.request.newContext({ baseURL });

// One click: a person, and the code if the portal wants one. Any other name goes through the old door.
const signIn = async (ctx, brand, who, extra = {}) => {
  const door = /^[a-z]+$/.test(who) ? { person: who } : { name: who, password: "demo" };
  let r = await ctx.post("/api/login", { headers: API, data: { brand, ...door, ...extra } });
  let j = await r.json();
  if (j.needs_code) { r = await ctx.post("/api/login", { headers: API, data: { brand, ...door, code: j.code, ...extra } }); j = await r.json(); }
  if (!r.ok()) throw new Error(`could not sign in to ${brand} as ${who}: ${JSON.stringify(j)}`);
  return j;
};

const getJson = async (ctx, url) => (await ctx.get(url, { headers: API })).json();
const tool = async (ctx, url, data) => { const r = await ctx.post(url, { headers: API, data }); return { status: r.status(), ...(await r.json()) }; };

module.exports = { API, session, signIn, getJson, tool };
