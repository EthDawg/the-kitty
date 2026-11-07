// One document at a time. A named person who asks for a second export inside the portal's gap waits, the way a real site makes you wait. The
// stamp lives in a cookie for that portal, so it holds across serverless instances. Files as delivered are static and cannot be held back this
// way. Second factors are in login.js; history and window limits are read by lib/data.js and lib/exports.js from the same rule row.
"use strict";
const { cookies, json, secure } = require("./http");

const stampName = (brand) => `kp_dl_${brand}`;

// Sends the refusal and returns true when the person must wait.
const mustWait = (req, res, brand, view) => {
  const gap = view.rules.gap_seconds;
  if (!gap) return false;
  const wait = Number(cookies(req)[stampName(brand.id)] || 0) + gap * 1000 - Date.now();
  if (wait <= 0) return false;
  const seconds = Math.ceil(wait / 1000);
  res.setHeader("Retry-After", String(seconds));
  json(res, 429, { error: `${brand.name} hands over one document at a time. Wait ${seconds} second${seconds === 1 ? "" : "s"}, then try again.`, retry_after: seconds });
  return true;
};

// A download that went through starts the gap. A refused one costs nothing.
const stamp = (req, res, brand, view) => {
  if (view.rules.gap_seconds) res.setHeader("Set-Cookie", `${stampName(brand.id)}=${Date.now()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure(req) ? "; Secure" : ""}`);
};

module.exports = { mustWait, stamp };
