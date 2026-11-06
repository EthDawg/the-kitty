/* Email and web pages as they arrive: multipart/alternative with a plain and an HTML part, quoted-printable and base64; a saved page with a
   table. Addresses are all on .example domains. */
"use strict";
const { pad, MONTHS, weekday } = require("./util");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const rfc2822 = (iso, time) => { const [y, m, d] = iso.split("-").map(Number); return `${DAYS[weekday(iso)]}, ${pad(d)} ${MONTHS[m - 1]} ${y} ${time || "09:14:02"} +1000`; };
const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
const qp = (s) => {
  const bytes = Buffer.from(s, "utf8"); let out = "", col = 0;
  const emit = (t) => { if (col + t.length > 75) { out += "=\r\n"; col = 0; } out += t; col += t.length; };
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 10) { out += "\r\n"; col = 0; continue; }
    if (c === 13) continue;
    if (c === 61 || c > 126 || (c < 32 && c !== 9)) emit(`=${c.toString(16).toUpperCase().padStart(2, "0")}`); else emit(String.fromCharCode(c));
  }
  return out;
};
const htmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* m: { from, to, subject, date, time, id, text, html, attachments: [{name, type, bytes}], plainEnc } */
function eml(m) {
  const b = `==kitty_${m.id.replace(/[^a-zA-Z0-9]/g, "")}==`;
  const head = [`From: ${m.from}`, `To: ${m.to}`, `Subject: ${m.subject}`, `Date: ${rfc2822(m.date, m.time)}`, `Message-ID: <${m.id}@mail.example>`, "MIME-Version: 1.0"];
  const alt = `--${b}a\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(m.text)}\r\n--${b}a\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(m.html)}\r\n--${b}a--\r\n`;
  if (!m.attachments || !m.attachments.length) return `${head.join("\r\n")}\r\nContent-Type: multipart/alternative; boundary="${b}a"\r\n\r\n${alt}`;
  let body = `--${b}\r\nContent-Type: multipart/alternative; boundary="${b}a"\r\n\r\n${alt}`;
  for (const f of m.attachments) body += `--${b}\r\nContent-Type: ${f.type}; name="${f.name}"\r\nContent-Disposition: attachment; filename="${f.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(f.bytes).toString("base64").replace(/(.{76})/g, "$1\r\n")}\r\n`;
  return `${head.join("\r\n")}\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n${body}--${b}--\r\n`;
}

/* a saved page with the junk a saved page has */
function page(title, bodyHtml) {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${htmlEsc(title)}</title><style>body{font:14px sans-serif}table{border-collapse:collapse}td,th{padding:4px 8px}</style><script>window.dataLayer=[];</script></head>\n<body>\n<nav><a href="#">Home</a> <a href="#">Bills</a> <a href="#">Help</a></nav>\n<main>\n${bodyHtml}\n</main>\n<footer><p>Fictional page from The Kitty's Davies world. A parody, not a real provider.</p></footer>\n</body></html>\n`;
}
const row = (cells, tag = "td") => `<tr>${cells.map((c) => `<${tag}>${htmlEsc(c)}</${tag}>`).join("")}</tr>`;

module.exports = { eml, page, row, htmlEsc };
