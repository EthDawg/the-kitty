/* What the life generator borrows from the Standard's world: integer cents, dates, the seeded generator and the file writers. Imported, never edited. */
"use strict";
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..", "..");
const STD = path.join(REPO, "standard");
const util = require(path.join(STD, "world", "lib", "util"));
const pdf = require(path.join(STD, "world", "lib", "pdf"));
const mail = require(path.join(STD, "world", "lib", "mail"));
const bank = require(path.join(STD, "world", "lib", "bankfiles"));
const { scan } = require(path.join(STD, "world", "lib", "png"));
const { workbook } = require(path.join(STD, "world", "lib", "xlsx"));

module.exports = { REPO, STD, ...util, Doc: pdf.Doc, MUTED: pdf.MUTED, M: pdf.M, period: pdf.period, eml: mail.eml, page: mail.page, row: mail.row, htmlEsc: mail.htmlEsc, ofx: bank.ofx, qif: bank.qif, scan, workbook };
