/* The Kitty period core: the one importer, shared by the page and the iOS WebView. plan(input) reads the host's files and the sheet and
   returns a deterministic write plan; verify(plan, reread, opts) compares a saved re-read with it. See period-CONTRACT.md. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./period-plan.js"), require("./period-writeplan.js"), require("./period-adapters.js"), require("./period-text.js"));
  else root.KittyPeriod = factory(root.KittyPeriodPlan, root.KittyPeriodWritePlan, root.KittyPeriodAdapters, root.KittyPeriodText);
})(typeof self !== "undefined" ? self : this, function (P, W, A, T) {
  "use strict";
  return { plan: P.plan, verify: W.verify, PeriodInputError: P.PeriodInputError, SCHEMA: W.SCHEMA, text: T, adapters: A, writeplan: W };
});
