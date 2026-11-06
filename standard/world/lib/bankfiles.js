/* OFX 1.x and QIF, the two older bank formats. */
"use strict";
const { fix, pad } = require("./util");

const stamp = (iso) => iso.replace(/-/g, "");

function ofx({ account, bankId, from, to, rows, closing, asOf }) {
  const trn = rows.map((r, i) => `<STMTTRN>\r\n<TRNTYPE>${r.cents >= 0 ? "CREDIT" : "DEBIT"}\r\n<DTPOSTED>${stamp(r.date)}120000\r\n<TRNAMT>${fix(r.cents)}\r\n<FITID>${stamp(r.date)}${pad(i + 1, 3)}\r\n<NAME>${r.desc.slice(0, 32)}\r\n${r.memo ? `<MEMO>${r.memo}\r\n` : ""}</STMTTRN>\r\n`).join("");
  return `OFXHEADER:100\r\nDATA:OFXSGML\r\nVERSION:102\r\nSECURITY:NONE\r\nENCODING:USASCII\r\nCHARSET:1252\r\nCOMPRESSION:NONE\r\nOLDFILEUID:NONE\r\nNEWFILEUID:NONE\r\n\r\n<OFX>\r\n<SIGNONMSGSRSV1>\r\n<SONRS>\r\n<STATUS>\r\n<CODE>0\r\n<SEVERITY>INFO\r\n</STATUS>\r\n<LANGUAGE>ENG\r\n</SONRS>\r\n</SIGNONMSGSRSV1>\r\n<BANKMSGSRSV1>\r\n<STMTTRNRS>\r\n<TRNUID>1\r\n<STATUS>\r\n<CODE>0\r\n<SEVERITY>INFO\r\n</STATUS>\r\n<STMTRS>\r\n<CURDEF>AUD\r\n<BANKACCTFROM>\r\n<BANKID>${bankId}\r\n<ACCTID>${account}\r\n<ACCTTYPE>SAVINGS\r\n</BANKACCTFROM>\r\n<BANKTRANLIST>\r\n<DTSTART>${stamp(from)}\r\n<DTEND>${stamp(to)}\r\n${trn}</BANKTRANLIST>\r\n<LEDGERBAL>\r\n<BALAMT>${fix(closing)}\r\n<DTASOF>${stamp(asOf || to)}\r\n</LEDGERBAL>\r\n</STMTRS>\r\n</STMTTRNRS>\r\n</BANKMSGSRSV1>\r\n</OFX>\r\n`;
}

// Bark Bank's QIF: day first with a two digit year, an opening-balance record first
function qif({ rows, opening, from }) {
  const d = (iso) => { const [y, m, dd] = iso.split("-"); return `${dd}/${m}/${y.slice(2)}`; };
  let out = `!Type:Bank\r\nD${d(from)}\r\nT${fix(opening)}\r\nCX\r\nPOpening Balance\r\n^\r\n`;
  for (const r of rows) out += `D${d(r.date)}\r\nT${fix(r.cents)}\r\nP${r.desc}\r\n^\r\n`;
  return out;
}

module.exports = { ofx, qif };
