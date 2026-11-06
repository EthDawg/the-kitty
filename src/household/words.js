/* How the runtime says things. Short sentences, money as money. Everything a person reads goes through here or next.js. */
"use strict";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function money(cents) {
  const neg = cents < 0, c = Math.abs(Math.round(cents)), whole = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${whole}.${String(c % 100).padStart(2, "0")}`;
}
const day = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const dayYear = (d) => `${day(d)} ${d.slice(0, 4)}`;
const monthName = (m) => MONTHS[Number(m.slice(5, 7)) - 1];
const monthYear = (m) => `${monthName(m)} ${m.slice(0, 4)}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
module.exports = { money, day, dayYear, monthName, monthYear, plural, list };
