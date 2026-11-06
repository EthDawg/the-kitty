#!/usr/bin/env node
/* Writes reference/au.json from the dated parameters below. Every row carries a confidence: "secondary" means widely published and
   cross-checked by another reader in this repo; "unverified" means nobody has read it on a primary page yet.
   reference/au-verified.json, when present, is an independent read from primary pages; intake/test.js compares the world's tables with it. */
"use strict";
const fs = require("fs"), path = require("path");
const fy = (y) => [`${y - 1}-07-01`, `${y}-07-01`];
const row = (from, to, value, confidence = "secondary", note) => ({ valid_from: from, valid_to: to, value, source_url: "https://www.ato.gov.au", confidence, ...(note ? { note } : {}) });
const BRACKETS = {
  a: [{ from: 0, rate: 0 }, { from: 18200, rate: 0.19 }, { from: 37000, rate: 0.325 }, { from: 90000, rate: 0.37 }, { from: 180000, rate: 0.45 }],
  b: [{ from: 0, rate: 0 }, { from: 18200, rate: 0.19 }, { from: 45000, rate: 0.325 }, { from: 120000, rate: 0.37 }, { from: 180000, rate: 0.45 }],
  c: [{ from: 0, rate: 0 }, { from: 18200, rate: 0.16 }, { from: 45000, rate: 0.3 }, { from: 135000, rate: 0.37 }, { from: 190000, rate: 0.45 }],
  d: [{ from: 0, rate: 0 }, { from: 18200, rate: 0.15 }, { from: 45000, rate: 0.3 }, { from: 135000, rate: 0.37 }, { from: 190000, rate: 0.45 }],
};
const HELP = {
  2019: [[51957,0.02], [57730,0.04], [64307,0.045], [70882,0.05], [74608,0.055], [80198,0.06], [86856,0.065], [91426,0.07], [100614,0.075], [107214,0.08]],
  2020: [[45881,0.01], [52974,0.02], [56152,0.025], [59522,0.03], [63093,0.035], [66878,0.04], [70891,0.045], [75145,0.05], [79653,0.055], [84433,0.06], [89499,0.065], [94869,0.07], [100561,0.075], [106594,0.08], [112990,0.085], [119770,0.09], [126956,0.095], [134573,0.1]],
  2021: [[46620,0.01], [53827,0.02], [57056,0.025], [60480,0.03], [64109,0.035], [67955,0.04], [72032,0.045], [76355,0.05], [80936,0.055], [85793,0.06], [90940,0.065], [96397,0.07], [102180,0.075], [108310,0.08], [114810,0.085], [121699,0.09], [129000,0.095], [136740,0.1]],
  2022: [[47014,0.01], [54283,0.02], [57539,0.025], [60992,0.03], [64652,0.035], [68530,0.04], [72642,0.045], [77002,0.05], [81621,0.055], [86519,0.06], [91710,0.065], [97213,0.07], [103046,0.075], [109228,0.08], [115782,0.085], [122729,0.09], [130093,0.095], [137898,0.1]],
  2023: [[48361,0.01], [55837,0.02], [59187,0.025], [62739,0.03], [66503,0.035], [70493,0.04], [74723,0.045], [79207,0.05], [83959,0.055], [88997,0.06], [94337,0.065], [99997,0.07], [105997,0.075], [112356,0.08], [119098,0.085], [126244,0.09], [133819,0.095], [141848,0.1]],
  2024: [[51550,0.01], [59519,0.02], [63090,0.025], [66876,0.03], [70889,0.035], [75141,0.04], [79650,0.045], [84430,0.05], [89495,0.055], [94866,0.06], [100558,0.065], [106591,0.07], [112986,0.075], [119765,0.08], [126951,0.085], [134569,0.09], [142643,0.095], [151201,0.1]],
  2025: [[54435,0.01], [62851,0.02], [66621,0.025], [70619,0.03], [74856,0.035], [79347,0.04], [84108,0.045], [89155,0.05], [94504,0.055], [100175,0.06], [106186,0.065], [112557,0.07], [119310,0.075], [126468,0.08], [134057,0.085], [142101,0.09], [150627,0.095], [159664,0.1]],
};
const series = {
  resident_tax_brackets: { unit: "dollars and rate", meaning: "Resident rates, tax-free threshold included.", rows: [row(fy(2019)[0], fy(2021)[0], BRACKETS.a), row(fy(2021)[0], fy(2025)[0], BRACKETS.b), row(fy(2025)[0], fy(2027)[0], BRACKETS.c), row(fy(2027)[0], null, BRACKETS.d, "secondary", "16% to 15% legislated from 1 July 2026.")] },
  medicare_levy_rate: { unit: "ratio", meaning: "Medicare levy.", rows: [row("2014-07-01", null, { rate: 0.02 })] },
  lito: { unit: "dollars", meaning: "Low income tax offset.", rows: [row(fy(2019)[0], fy(2021)[0], { max: 445, tiers: [{ from: 37000, to: 66667, rate: 0.015 }] }), row(fy(2021)[0], null, { max: 700, tiers: [{ from: 37500, to: 45000, rate: 0.05 }, { from: 45000, to: 66667, rate: 0.015 }] })] },
  lmito: { unit: "dollars", meaning: "Low and middle income tax offset.", rows: [row(fy(2019)[0], fy(2022)[0], { base: 255, top: 1080, up: 0.075, down: 0.03, lift: 0 }), row(fy(2022)[0], fy(2023)[0], { base: 255, top: 1080, up: 0.075, down: 0.03, lift: 420 }, "secondary", "The one-off $420 cost-of-living lift.")] },
  help_repayment: { unit: "dollars and rate", meaning: "Compulsory repayment on all repayment income; a marginal system from 2025-26.", rows: [...Object.entries(HELP).map(([y, bands]) => row(fy(+y)[0], fy(+y)[1], { bands }, "unverified")), row(fy(2026)[0], fy(2027)[0], { marginal: { from: 67000, rate: 0.15, second_from: 125000, second_base: 8700, second_rate: 0.17, top_from: 179286, top_rate: 0.1 } }, "unverified"), row(fy(2027)[0], null, { marginal: { from: 69528, rate: 0.15, second_from: 129717, second_base: 9028, second_rate: 0.17, top_from: 186051, top_rate: 0.1 } }, "unverified")] },
  wfh_fixed_rate: { unit: "dollars per hour", meaning: "Work-from-home rate.", rows: [row("2020-03-01", "2022-07-01", { rate: 0.8 }, "secondary", "Shortcut method."), row("2022-07-01", "2024-07-01", { rate: 0.67 }), row("2024-07-01", null, { rate: 0.7 })] },
  concessional_cap: { unit: "dollars", meaning: "Concessional contributions cap.", rows: [row("2017-07-01", "2021-07-01", { amount: 25000 }), row("2021-07-01", "2024-07-01", { amount: 27500 }), row("2024-07-01", "2026-07-01", { amount: 30000 }), row("2026-07-01", null, { amount: 32500 })] },
  sg_rate: { unit: "ratio", meaning: "Super guarantee.", rows: [row("2014-07-01", "2021-07-01", { rate: 0.095 }), row("2021-07-01", "2022-07-01", { rate: 0.1 }), row("2022-07-01", "2023-07-01", { rate: 0.105 }), row("2023-07-01", "2024-07-01", { rate: 0.11 }), row("2024-07-01", "2025-07-01", { rate: 0.115 }), row("2025-07-01", null, { rate: 0.12 })] },
  cgt_discount_individual: { unit: "ratio", meaning: "CGT discount for individuals, held at least 12 months.", rows: [row("1999-09-21", null, { rate: 0.5 })] },
};
// Where the independent read reached a primary page, the row says so and cites it. Values were reconciled to it by hand on 7 November 2026.
const verified = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "reference", "au-verified.json"), "utf8")).series; } catch (e) { return {}; } })();
const twin = { help_repayment: "help_repayment_thresholds", cgt_discount_individual: "cgt_discount" };
for (const [id, s] of Object.entries(series)) for (const r of s.rows) {
  const v = (verified[twin[id] || id] || { rows: [] }).rows.find((x) => x.valid_from <= r.valid_from && (x.valid_to == null || r.valid_from < x.valid_to));
  if (v && v.value != null) { r.confidence = v.confidence; r.source_url = v.source_url; }
}
// Series no one has typed here: taken whole from the independent read, with its own confidence on each row.
const CARRIED = ["div293_threshold", "phi_rebate_percent", "phi_rebate_income_tiers", "medicare_levy_surcharge", "medicare_levy_low_income_thresholds", "help_indexation_rates", "sg_max_contribution_base", "non_concessional_cap", "transfer_balance_cap"];
for (const id of CARRIED) if (verified[id]) series[id] = verified[id];
const out = { _about: "Dated Australian parameters. Ranges are half-open. Reconciled against au-verified.json, the independent read from primary pages. Confidence says how far each row has been checked. Not tax advice.", jurisdiction: "AU", verified_at: null, series };
fs.writeFileSync(path.join(__dirname, "..", "reference", "au.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`${Object.keys(series).length} series.`);
