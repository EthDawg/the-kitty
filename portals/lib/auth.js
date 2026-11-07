// Sign-in is a cookie per brand and family: one click as a person, or any name with the password "demo". Nothing is stored anywhere. A person
// may also get a mock second factor, shown on screen. The Drive and mail connectors take the same sign-in as a bearer token, because that is how
// a connector works. Neither is a real secret: this is a parody with a fictional household behind it.
"use strict";
const crypto = require("crypto");
const { cookies } = require("./http");

const PASSWORD = "demo";
// One account, two doors: Gmeow and Litterbox sign in together, the way a mail account and its drive do.
const ACCOUNT = ["gmeow", "litterbox"];
const doorsOf = (brand) => (ACCOUNT.includes(brand) ? ACCOUNT : [brand]);
const cookieName = (brand, family) => (family && family !== "benchmark" ? `kp_${family}_${brand}` : `kp_${brand}`);

const signInCookie = (brand, name, isSecure, family) =>
  `${cookieName(brand, family)}=${encodeURIComponent(name)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${isSecure ? "; Secure" : ""}`;
const signOutCookie = (brand, isSecure, family) => `${cookieName(brand, family)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? "; Secure" : ""}`;

const who = (req, brand, family) => {
  const name = cookies(req)[cookieName(brand, family)];
  return name && name.length <= 60 ? name : null;
};

const cleanName = (name) => String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);

// The mock second factor: six digits that hold for the hour. The page shows them, where a real site would text them.
const codeFor = (brand, name, hoursAgo = 0) => {
  const hour = Math.floor(Date.now() / 3600000) - hoursAgo;
  const n = crypto.createHash("sha256").update(`${brand}|${String(name).toLowerCase()}|${hour}`).digest().readUInt32BE(0);
  return String(n % 1000000).padStart(6, "0");
};
const codeOk = (brand, name, code) => [0, 1].some((h) => codeFor(brand, name, h) === String(code || "").trim());

const makeToken = (t) => Buffer.from(JSON.stringify(t)).toString("base64url");
const tokenOf = (req) => {
  const m = String(req.headers.authorization || "").match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  try { const t = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")); return t && t.name && t.brand ? t : null; } catch { return null; }
};

module.exports = { PASSWORD, doorsOf, signInCookie, signOutCookie, who, cleanName, codeFor, codeOk, makeToken, tokenOf };
