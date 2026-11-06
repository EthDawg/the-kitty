/* A separate world-side calculator: labels in, assessment out, integer cents. Taxable income is whole dollars, label by label, as the ATO does it. Not advice. */
"use strict";
const T = require("./tables");

const whole = (c) => Math.trunc(c / 100) * 100;
const INCOME = ["1", "10", "11S", "11T", "11U", "12", "13U", "13C", "13Q", "18A", "20M", "24"];

function scale(fy, incomeDollars) {
  const b = T.brackets(fy); let tax = 0;
  for (let i = 0; i < b.length; i++) { const lo = b[i][0], hi = i + 1 < b.length ? b[i + 1][0] : Infinity; if (incomeDollars > lo) tax += (Math.min(incomeDollars, hi) - lo) * b[i][1]; }
  return Math.round(tax * 100);
}

/* labels: {label: cents}; extra: {payg_cents, help_debt_cents, phi_cents, add_back_cents, rounding_cents} */
function assess(fy, labels, extra) {
  const get = (k) => labels[k] || 0;
  const income = INCOME.reduce((s, k) => s + whole(get(k)), 0);
  const rent = whole(get("21P")) - whole(get("21Q")) - whole(get("21F")) - whole(get("21X"));
  const deductions = Object.keys(labels).filter((k) => /^D\d+$/.test(k)).reduce((s, k) => s + whole(labels[k]), 0);
  const total = income + rent, taxable = Math.max(0, total - deductions), dollars = Math.round(taxable / 100);
  const gross = scale(fy, dollars);
  const lito = Math.round(T.lito(fy, dollars) * 100), lmito = Math.round(T.lmito(fy, dollars) * 100), fito = get("20O");
  const offsets = Math.min(gross, lito + lmito + fito);
  const levy = Math.round(dollars * 2);
  const repaymentIncome = Math.max(0, dollars + Math.max(0, -Math.round(rent / 100)) + Math.round((extra.add_back_cents || 0) / 100));
  const help = extra.help_debt_cents > 0 ? Math.min(extra.help_debt_cents, Math.round(T.helpRepayment(fy, repaymentIncome) * 100)) : 0;
  const phi = extra.phi_cents || 0;
  const franking = get("11U") + get("13Q");
  const credits = extra.payg_cents + franking + (extra.rounding_cents || 0);
  const net = gross - offsets + levy + help + phi;
  return { total_income_cents: total, deductions_cents: deductions, rent_cents: rent, taxable_income_cents: taxable, gross_tax_cents: gross, lito_cents: lito, lmito_cents: lmito, fito_cents: fito, offsets_cents: offsets, medicare_levy_cents: levy, mls_cents: 0, help_cents: help, repayment_income: repaymentIncome, phi_cents: phi, payg_credits_cents: extra.payg_cents, franking_cents: franking, rounding_cents: extra.rounding_cents || 0, other_credits_cents: franking + (extra.rounding_cents || 0), result_cents: credits - net };
}

module.exports = { assess, scale, whole, INCOME };
