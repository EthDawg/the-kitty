/* The law by year, the world's own copy, so the oracle is independent of the engine. Australian resident scales. FY is the year ending 30 June.
   standard/reference/au.json was not there when this was written; the test compares the two once it exists. Corrected against reference/au-verified.json on 7 November 2026. The 20% HELP reduction of 2025 is not modelled. */
"use strict";

const OLD = [[0, 0], [18200, 0.19], [37000, 0.325], [90000, 0.37], [180000, 0.45]];
const MID = [[0, 0], [18200, 0.19], [45000, 0.325], [120000, 0.37], [180000, 0.45]];
const NEW = [[0, 0], [18200, 0.16], [45000, 0.3], [135000, 0.37], [190000, 0.45]];
const brackets = (fy) => (fy <= 2020 ? OLD : fy <= 2024 ? MID : NEW);

function lito(fy, income) {
  if (fy <= 2020) return Math.max(0, 445 - Math.max(0, income - 37000) * 0.015);
  let v = 700;
  v -= Math.max(0, Math.min(income, 45000) - 37500) * 0.05;
  v -= Math.max(0, Math.min(income, 66667) - 45000) * 0.015;
  return Math.max(0, v);
}
function lmito(fy, income) {
  if (fy > 2022) return 0;
  // FY2019 keeps the offset as first legislated: the Davies refunds that year were fitted to it, and a fictional refund cannot move. The reference holds the law as amended, so the scoreboard shows that gap.
  const [base, top, up] = fy === 2019 ? [200, 530, 0.03] : [255, 1080, 0.075];
  const lift = fy === 2022 ? 420 : 0;
  let v;
  if (income <= 37000) v = base;
  else if (income <= 48000) v = base + (income - 37000) * up;
  else if (income <= 90000) v = top;
  else v = Math.max(0, top - (income - 90000) * (fy === 2019 ? 0.015 : 0.03));
  return v + lift;
}

// compulsory repayment bands: [from, rate on all repayment income]
const HELP = {
  2019: [[51957,0.02], [57730,0.04], [64307,0.045], [70882,0.05], [74608,0.055], [80198,0.06], [86856,0.065], [91426,0.07], [100614,0.075], [107214,0.08]],
  2020: [[45881,0.01], [52974,0.02], [56152,0.025], [59522,0.03], [63093,0.035], [66878,0.04], [70891,0.045], [75145,0.05], [79653,0.055], [84433,0.06], [89499,0.065], [94869,0.07], [100561,0.075], [106594,0.08], [112990,0.085], [119770,0.09], [126956,0.095], [134573,0.1]],
  2021: [[46620,0.01], [53827,0.02], [57056,0.025], [60480,0.03], [64109,0.035], [67955,0.04], [72032,0.045], [76355,0.05], [80936,0.055], [85793,0.06], [90940,0.065], [96397,0.07], [102180,0.075], [108310,0.08], [114810,0.085], [121699,0.09], [129000,0.095], [136740,0.1]],
  2022: [[47014,0.01], [54283,0.02], [57539,0.025], [60992,0.03], [64652,0.035], [68530,0.04], [72642,0.045], [77002,0.05], [81621,0.055], [86519,0.06], [91710,0.065], [97213,0.07], [103046,0.075], [109228,0.08], [115782,0.085], [122729,0.09], [130093,0.095], [137898,0.1]],
  2023: [[48361,0.01], [55837,0.02], [59187,0.025], [62739,0.03], [66503,0.035], [70493,0.04], [74723,0.045], [79207,0.05], [83959,0.055], [88997,0.06], [94337,0.065], [99997,0.07], [105997,0.075], [112356,0.08], [119098,0.085], [126244,0.09], [133819,0.095], [141848,0.1]],
  2024: [[51550,0.01], [59519,0.02], [63090,0.025], [66876,0.03], [70889,0.035], [75141,0.04], [79650,0.045], [84430,0.05], [89495,0.055], [94866,0.06], [100558,0.065], [106591,0.07], [112986,0.075], [119765,0.08], [126951,0.085], [134569,0.09], [142643,0.095], [151201,0.1]],
  2025: [[54435,0.01], [62851,0.02], [66621,0.025], [70619,0.03], [74856,0.035], [79347,0.04], [84108,0.045], [89155,0.05], [94504,0.055], [100175,0.06], [106186,0.065], [112557,0.07], [119310,0.075], [126468,0.08], [134057,0.085], [142101,0.09], [150627,0.095], [159664,0.1]],
};
function helpRepayment(fy, income) {
  if (fy >= 2026) {
    const [from, second, base, top] = fy === 2026 ? [67000, 125000, 8700, 179286] : [69528, 129717, 9028, 186051];
    if (income <= from) return 0;
    if (income >= top) return income * 0.1;
    return income <= second ? (income - from) * 0.15 : base + (income - second) * 0.17;
  }
  let r = 0; for (const [from, rate] of HELP[fy]) if (income >= from) r = rate;
  return income * r;
}
const HELP_INDEX = { 2021: 0.006, 2022: 0.039, 2023: 0.032, 2024: 0.04, 2025: 0.032, 2026: 0.028 }; // applied 1 June; 2023 and 2024 at the capped rates

const WFH = { 2019: 0.52, 2020: 0.8, 2021: 0.8, 2022: 0.8, 2023: 0.67, 2024: 0.67, 2025: 0.7, 2026: 0.7 }; // the shortcut rate to FY2022, the fixed rate after

// the private health rebate for under 65s: rate by tier, 1 April to 31 March, and the family income tiers
const PHI_RATE = { 2018: [0.25415, 0.16943, 0.08471], 2019: [0.25059, 0.16706, 0.08352], 2020: [0.24827, 0.16551, 0.08275], 2021: [0.24608, 0.16405, 0.08202], 2022: [0.24608, 0.16405, 0.08202], 2023: [0.24608, 0.16405, 0.08202], 2024: [0.24608, 0.16405, 0.08202], 2025: [0.24288, 0.16192, 0.08095], 2026: [0.24288, 0.16192, 0.08095] };
const PHI_TIER = (fy) => (fy <= 2023 ? [180000, 210000, 280000] : fy === 2024 ? [186000, 216000, 288000] : fy === 2025 ? [194000, 226000, 302000] : [202000, 236000, 316000]);

module.exports = { brackets, lito, lmito, helpRepayment, HELP_INDEX, WFH, PHI_RATE, PHI_TIER, HELP };
