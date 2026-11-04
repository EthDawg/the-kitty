// Sign-in is a cookie per brand: any name, the password "demo". Nothing is stored anywhere.
"use strict";
const { cookies } = require("./http");

const PASSWORD = "demo";
const cookieName = (brand) => `kp_${brand}`;

const signInCookie = (brand, name, isSecure) =>
  `${cookieName(brand)}=${encodeURIComponent(name)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${isSecure ? "; Secure" : ""}`;
const signOutCookie = (brand, isSecure) => `${cookieName(brand)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure ? "; Secure" : ""}`;

const who = (req, brand) => {
  const name = cookies(req)[cookieName(brand)];
  return name && name.length <= 60 ? name : null;
};

const cleanName = (name) => String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);

module.exports = { PASSWORD, signInCookie, signOutCookie, who, cleanName };
