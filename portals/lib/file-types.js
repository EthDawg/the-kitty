// What each delivered file is served as. server.js and build-vault.js read this; vercel.json repeats it, and test/vault.spec.js holds the two together.
"use strict";
module.exports = {
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".eml": "message/rfc822",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".ofx": "application/x-ofx",
  ".qif": "application/x-qif",
};
