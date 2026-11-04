// Statements, payslips and renewal notices through pdf-lib. One small layout helper, six documents.
// Every page carries the brand's original wordmark, a DEMO watermark and a footer that says what this is.
"use strict";
const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");
const { fmtDate, fmtMonth, D, fyStart, fyLabel, round2 } = require("./data");

const A4 = [595.28, 841.89];
const M = 44; // margin
const hex = (h) => { const n = parseInt(h.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const INK = rgb(0.09, 0.08, 0.14), MUTED = rgb(0.42, 0.4, 0.5), LINE = rgb(0.86, 0.85, 0.88), SOFT = rgb(0.95, 0.945, 0.93);
const clean = (s) => String(s == null ? "" : s).replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
const money = (n, blankZero = false) => { if (n == null || (blankZero && Math.abs(n) < 0.005)) return ""; const a = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return (n < -0.005 ? "-" : "") + a; };
const aud = (n) => (n < -0.005 ? "-A$" : "A$") + money(Math.abs(n));

class Doc {
  static async create(brand, title, kicker) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${brand.name} - ${title}`); pdf.setAuthor(`${brand.name} (a parody portal from The Kitty)`); pdf.setSubject("Fictional demo document");
    const d = new Doc(); d.pdf = pdf; d.brand = brand; d.title = title; d.kicker = kicker;
    d.font = await pdf.embedFont(StandardFonts.Helvetica); d.bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    d.pages = []; d.newPage(); return d;
  }
  get W() { return A4[0]; }
  newPage() {
    const p = this.pdf.addPage(A4); this.page = p; this.pages.push(p);
    const col = hex(this.brand.colors.brand);
    p.drawRectangle({ x: 0, y: A4[1] - 64, width: A4[0], height: 64, color: col });
    // the wordmark: two ears over a round head, then the name
    p.drawCircle({ x: M + 11, y: A4[1] - 34, size: 9, color: rgb(1, 1, 1) });
    p.drawSvgPath("M0 0 L4 -9 L9 0 Z", { x: M + 2, y: A4[1] - 38, color: rgb(1, 1, 1) });
    p.drawSvgPath("M0 0 L5 -9 L9 0 Z", { x: M + 11, y: A4[1] - 38, color: rgb(1, 1, 1) });
    p.drawCircle({ x: M + 8, y: A4[1] - 33, size: 1.2, color: col }); p.drawCircle({ x: M + 14, y: A4[1] - 33, size: 1.2, color: col });
    p.drawText(this.brand.name, { x: M + 28, y: A4[1] - 40, size: 20, font: this.bold, color: rgb(1, 1, 1) });
    p.drawText(clean(this.brand.tagline), { x: M + 28, y: A4[1] - 54, size: 8, font: this.font, color: rgb(1, 1, 1), opacity: 0.85 });
    const tag = "DEMO  -  fictional document"; const tw = this.bold.widthOfTextAtSize(tag, 9);
    p.drawRectangle({ x: A4[0] - M - tw - 16, y: A4[1] - 44, width: tw + 16, height: 22, color: rgb(1, 1, 1), opacity: 0.18, borderColor: rgb(1, 1, 1), borderWidth: 1 });
    p.drawText(tag, { x: A4[0] - M - tw - 8, y: A4[1] - 37, size: 9, font: this.bold, color: rgb(1, 1, 1) });
    p.drawText("DEMO", { x: 110, y: 230, size: 150, font: this.bold, color: col, opacity: 0.07, rotate: degrees(32) });
    this.y = A4[1] - 64 - 36;
    if (this.pages.length > 1) { this.text(M, this.y, `${this.title} (continued)`, { size: 10, color: MUTED }); this.y -= 20; }
  }
  ensure(h) { if (this.y - h < 70) this.newPage(); }
  text(x, y, s, o = {}) {
    s = clean(s); const font = o.bold ? this.bold : this.font; const size = o.size || 10;
    let w = font.widthOfTextAtSize(s, size);
    if (o.maxWidth && w > o.maxWidth) { while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > o.maxWidth) s = s.slice(0, -1); s += "..."; w = font.widthOfTextAtSize(s, size); }
    const xx = o.align === "right" ? x - w : x;
    this.page.drawText(s, { x: xx, y, size, font, color: o.color || INK });
    return w;
  }
  h1(s) { this.ensure(40); this.text(M, this.y, this.kicker || "", { size: 9, color: MUTED }); this.y -= 18; this.text(M, this.y, s, { size: 18, bold: true }); this.y -= 22; }
  h2(s) { this.ensure(30); this.y -= 6; this.text(M, this.y, s, { size: 12, bold: true }); this.y -= 8; this.page.drawLine({ start: { x: M, y: this.y }, end: { x: this.W - M, y: this.y }, thickness: 0.8, color: hex(this.brand.colors.brand) }); this.y -= 14; }
  para(s, o = {}) {
    const words = clean(s).split(/\s+/); const size = o.size || 9.5; const maxW = this.W - 2 * M; let line = "";
    const flush = () => { this.ensure(14); this.text(M, this.y, line, { size, color: o.color || INK }); this.y -= size + 4; line = ""; };
    for (const w of words) { const t = line ? line + " " + w : w; if (this.font.widthOfTextAtSize(t, size) > maxW) flush(); line = line ? line + " " + w : w; }
    if (line) flush(); this.y -= 4;
  }
  kv(pairs, cols = 2) {
    const colW = (this.W - 2 * M) / cols; const rows = Math.ceil(pairs.length / cols);
    this.ensure(rows * 26 + 6);
    pairs.forEach(([k, v], i) => { const x = M + (i % cols) * colW, y = this.y - Math.floor(i / cols) * 26; this.text(x, y, k, { size: 8, color: MUTED }); this.text(x, y - 12, v, { size: 10.5, bold: true, maxWidth: colW - 10 }); });
    this.y -= rows * 26 + 8;
  }
  table(cols, rows, opts = {}) {
    const total = cols.reduce((s, c) => s + c.w, 0), scale = (this.W - 2 * M) / total; const rowH = 15;
    const head = () => {
      this.ensure(rowH + 4);
      this.page.drawRectangle({ x: M, y: this.y - 4, width: this.W - 2 * M, height: rowH, color: SOFT });
      let x = M; for (const c of cols) { const w = c.w * scale; this.text(c.align === "right" ? x + w - 4 : x + 4, this.y, c.label, { size: 8, bold: true, color: MUTED, align: c.align }); x += w; }
      this.y -= rowH;
    };
    head();
    for (const r of rows) {
      if (this.y - rowH < 70) { this.newPage(); head(); }
      let x = M; r.forEach((v, i) => { const c = cols[i], w = c.w * scale; this.text(c.align === "right" ? x + w - 4 : x + 4, this.y, v, { size: 8.5, align: c.align, maxWidth: w - 8, bold: c.bold }); x += w; });
      this.page.drawLine({ start: { x: M, y: this.y - 4 }, end: { x: this.W - M, y: this.y - 4 }, thickness: 0.4, color: LINE });
      this.y -= rowH;
    }
    if (opts.foot) {
      if (this.y - rowH < 70) { this.newPage(); }
      let x = M; opts.foot.forEach((v, i) => { const c = cols[i], w = c.w * scale; this.text(c.align === "right" ? x + w - 4 : x + 4, this.y, v, { size: 8.5, bold: true, align: c.align }); x += w; });
      this.y -= rowH;
    }
    this.y -= 6;
  }
  async finish() {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      p.drawLine({ start: { x: M, y: 50 }, end: { x: this.W - M, y: 50 }, thickness: 0.5, color: LINE });
      const f = `Fictional document from The Kitty's demo portals (github.com/EthDawg/the-kitty). ${this.brand.name} is a parody; not a bank, lender, agent, employer or insurer. Nothing here is advice.`;
      p.drawText(clean(f), { x: M, y: 38, size: 7, font: this.font, color: MUTED, maxWidth: this.W - 2 * M - 60, lineHeight: 9 });
      const pg = `Page ${i + 1} of ${n}`; p.drawText(pg, { x: this.W - M - this.font.widthOfTextAtSize(pg, 7), y: 38, size: 7, font: this.font, color: MUTED });
    });
    return this.pdf.save();
  }
}

const period = (from, to) => `${fmtDate(from)} to ${fmtDate(to)}`;

async function bankStatement({ brand, account, from, to, opening, rows }) {
  const isCard = brand.kind === "card";
  const d = await Doc.create(brand, isCard ? "Card statement" : "Account statement", period(from, to));
  d.h1(account.name);
  const totalIn = round2(rows.filter((r) => r[2] > 0).reduce((s, r) => s + r[2], 0)), totalOut = round2(rows.filter((r) => r[2] < 0).reduce((s, r) => s - r[2], 0));
  const closing = round2(opening + totalIn - totalOut);
  d.kv(isCard
    ? [["Card member", "JORDAN DAVIES"], ["Account", account.number], ["Previous balance", aud(-opening)], ["New balance", aud(-closing)], ["Payments and credits", aud(totalIn)], ["New charges", aud(totalOut)]]
    : [["Account number", account.number], ["Account holder", account.owner === "Joint" ? "Jordan and Mia Davies" : `${account.owner} Davies`], ["Opening balance", aud(opening)], ["Closing balance", aud(closing)], ["Total deposits", aud(totalIn)], ["Total withdrawals", aud(totalOut)]], 3);
  d.h2("Transactions");
  let bal = opening;
  if (isCard) {
    d.table([{ label: "Date", w: 68 }, { label: "Description", w: 292 }, { label: "Amount", w: 80, align: "right" }],
      rows.map(([dt, desc, amt]) => [fmtDate(dt), desc, money(-amt)]), { foot: ["", "New balance", money(-closing)] });
  } else {
    d.table([{ label: "Date", w: 68 }, { label: "Description", w: 222 }, { label: "Withdrawals", w: 70, align: "right" }, { label: "Deposits", w: 70, align: "right" }, { label: "Balance", w: 75, align: "right" }],
      rows.map(([dt, desc, amt]) => { bal = round2(bal + amt); return [fmtDate(dt), desc, amt < 0 ? money(-amt) : "", amt > 0 ? money(amt) : "", money(bal)]; }),
      { foot: ["", "Closing balance", money(totalOut), money(totalIn), money(closing)] });
  }
  if (!rows.length) d.para("No transactions in this period.", { color: MUTED });
  return d.finish();
}

async function loanStatement({ brand, loanId, loan, months, from, to }) {
  const d = await Doc.create(brand, "Loan statement", period(from, to));
  d.h1(loan.name);
  const first = months[0][1], last = months[months.length - 1][1];
  const interest = round2(months.reduce((s, [, x]) => s + x.interest, 0)), repaid = round2(months.reduce((s, [, x]) => s + x.repayments, 0));
  d.kv([["Loan number", loan.number], ["Borrowers", "Jordan and Mia Davies"], ["Interest rate", `${(loan.rate * 100).toFixed(2)}% p.a. variable`], ["Repayment type", loan.repayment_type],
    ["Opening balance", aud(first.opening)], ["Closing balance", aud(last.closing)], ["Interest charged", aud(interest)], ["Repayments received", aud(repaid)],
    ["Repaid from", D.accounts.find((a) => a.id === loan.repaid_from)?.name || loan.repaid_from], ["Offset account", loan.offset_account ? (D.accounts.find((a) => a.id === loan.offset_account)?.name || loan.offset_account) : "None"], ["Loan ends", fmtDate(loan.end_date)], ["Purpose", loan.purpose]], 4);
  d.h2("Monthly summary");
  d.table([{ label: "Month", w: 100 }, { label: "Rate", w: 50, align: "right" }, { label: "Opening", w: 85, align: "right" }, { label: "Interest charged", w: 85, align: "right" }, { label: "Repayments", w: 85, align: "right" }, { label: "Closing", w: 85, align: "right" }],
    months.map(([m, x]) => [fmtMonth(m), `${x.rate.toFixed(2)}%`, money(x.opening), money(x.interest), money(x.repayments), money(x.closing)]), { foot: ["Total", "", "", money(interest), money(repaid), money(last.closing)] });
  d.para(`Interest is calculated daily on the balance less any linked offset and charged on the last day of the month. Repayments include any extra repayments made from the offset account. The rate column shows the variable rate that applied at the start of each month.`, { color: MUTED, size: 8.5 });
  return d.finish();
}

async function ownerStatement({ brand, propertyId, property, from, to, months }) {
  const d = await Doc.create(brand, "Owner statement", period(from, to));
  d.h1(property.name);
  const lines = months.flatMap(([, x]) => x.lines).filter((l) => l[0] >= from && l[0] <= to);
  const rent = round2(lines.filter((l) => l[3] === "RENT-INC").reduce((s, l) => s + l[2], 0)), fees = round2(-lines.filter((l) => l[3] === "RENT-MGMT").reduce((s, l) => s + l[2], 0));
  const ownerPaid = round2(-lines.filter((l) => !l[5] && l[2] < 0).reduce((s, l) => s + l[2], 0));
  d.kv([["Owner", "Jordan and Mia Davies"], ["Property", property.address], ["Managed by", `${brand.name}, Geelong office`], ["Rent collected", aud(rent)], ["Management fees", aud(fees)], ["Paid to owner", aud(round2(rent - fees))], ["Owner-paid expenses in period", aud(ownerPaid)], ["Rental account", D.accounts.find((a) => a.id === property.account)?.name || property.account]], 3);
  d.h2("Statement lines");
  d.table([{ label: "Date", w: 70 }, { label: "Description", w: 178 }, { label: "Rental schedule line", w: 125 }, { label: "Money in", w: 60, align: "right" }, { label: "Money out", w: 62, align: "right" }, { label: "By", w: 60 }],
    lines.map(([dt, desc, amt, , line, agent]) => [fmtDate(dt), desc, line, amt > 0 ? money(amt) : "", amt < 0 ? money(-amt) : "", agent ? brand.name : "Owner"]));
  d.para("Rent is paid to the owner's rental account in full on receipt and the management fee is debited separately, which is why both appear as their own lines in the owner's bank export. Lines marked Owner were paid by the owner from the rental account and are listed here so the rental schedule is complete.", { color: MUTED, size: 8.5 });
  // financial year to date by ATO rental schedule line
  const fy = fyStart(to); const ytd = {};
  for (const [, x] of Object.entries(property.months)) for (const l of x.lines) if (l[0] >= fy && l[0] <= to) ytd[l[4]] = round2((ytd[l[4]] || 0) + l[2]);
  d.h2(`Rental schedule, financial year to date (${fmtDate(fy)} to ${fmtDate(to)})`);
  const order = ["Gross rent", "Property agent fees and commission", "Interest on loans", "Council rates", "Water charges", "Body corporate fees", "Insurance", "Repairs and maintenance", "Sundry rental expenses"];
  const rowsY = order.filter((k) => ytd[k] != null).map((k) => [k, money(Math.abs(ytd[k]))]);
  const monthsIn = Object.keys(property.months).filter((m) => `${m}-01` >= fy && `${m}-01` <= to).length;
  const cw = round2(D.capital_works_per_year / 12 * monthsIn);
  rowsY.push([`Capital works deduction, Div 43 (${monthsIn} of 12 months)`, money(cw)]);
  const net = round2(Object.values(ytd).reduce((s, v) => s + v, 0) - cw);
  d.table([{ label: "ATO rental schedule line", w: 300 }, { label: "Amount", w: 100, align: "right" }], rowsY, { foot: [net < 0 ? "Net rental loss, year to date" : "Net rental income, year to date", money(Math.abs(net))] });
  d.para("Schedule lines follow the ATO's rental property schedule. Your tax agent decides what is claimable; this summary only adds up what was recorded.", { color: MUTED, size: 8.5 });
  return d.finish();
}

async function payslips({ brand, person, employer, rows, from, to }) {
  const d = await Doc.create(brand, "Payslips", period(from, to));
  const all = D.payslips.filter((p) => p[1] === person && p[2] === employer);
  rows.forEach((p, i) => {
    if (i > 0) d.newPage();
    const [dt, , , gross, tax, sup, net] = p;
    const fy = fyStart(dt); const ytd = all.filter((q) => q[0] >= fy && q[0] <= dt);
    const sum = (k) => round2(ytd.reduce((s, q) => s + q[k], 0));
    d.h1(`Payslip for ${person} Davies`);
    d.kv([["Employer", employer], ["Pay date", fmtDate(dt)], ["Pay period", `${fmtDate(new Date(Date.parse(dt) - 13 * 864e5).toISOString().slice(0, 10))} to ${fmtDate(dt)}`], ["Pay frequency", "Fortnightly"]], 3);
    d.h2("This pay");
    d.table([{ label: "Item", w: 300 }, { label: "This pay", w: 90, align: "right" }, { label: "Year to date", w: 90, align: "right" }], [
      ["Ordinary hours, salary", money(gross), money(sum(3))],
      ["PAYG withholding", money(-tax), money(-sum(4))],
      ["Superannuation guarantee (paid to fund quarterly)", money(sup), money(sum(5))],
    ], { foot: ["Net pay, to Everyday joint", money(net), money(sum(6))] });
    d.para(`Net pay of ${aud(net)} was paid on ${fmtDate(dt)} to the account ending 4771 with the description SALARY ${employer.toUpperCase()}. Year to date covers the financial year from ${fmtDate(fy)}.`, { color: MUTED, size: 8.5 });
  });
  if (!rows.length) { d.h1(`Payslips for ${person} Davies`); d.para("No pay dates in this period."); }
  return d.finish();
}

async function incomeStatement({ brand, person, employer, rows, fy, to }) {
  const d = await Doc.create(brand, "Income statement", `${fyLabel(fy)}, 1 Jul ${fy - 1} to ${fmtDate(to)}`);
  d.h1(`Income statement for ${person} Davies`);
  const sum = (i) => round2(rows.reduce((s, p) => s + p[i], 0));
  const final = to >= `${fy}-06-30`;
  d.kv([["Payer", employer], ["Payee", `${person} Davies`], ["Income year", `1 July ${fy - 1} to 30 June ${fy}`], ["Status", final ? "Tax ready" : `Year to date, to ${fmtDate(to)}`], ["Pays in the year", String(rows.length)], ["Payment basis", "Salary and wages, fortnightly"]], 3);
  d.h2("Amounts reported");
  d.table([{ label: "Item", w: 300 }, { label: "Amount", w: 100, align: "right" }], [
    ["Gross payments (salary, wages, allowances, bonuses)", money(sum(3))],
    ["Tax withheld (PAYG withholding)", money(sum(4))],
    ["Reportable employer superannuation contributions", money(0)],
    ["Superannuation guarantee paid on your behalf (for information)", money(sum(5))],
    ["Net pay received", money(sum(6))],
  ]);
  d.h2("Pays in the year");
  d.table([{ label: "Pay date", w: 90 }, { label: "Gross", w: 80, align: "right" }, { label: "Tax withheld", w: 80, align: "right" }, { label: "Super", w: 80, align: "right" }, { label: "Net", w: 80, align: "right" }],
    rows.map((p) => [fmtDate(p[0]), money(p[3]), money(p[4]), money(p[5]), money(p[6])]), { foot: ["Total", money(sum(3)), money(sum(4)), money(sum(5)), money(sum(6))] });
  d.para("An income statement is what an employer reports to the tax office each year through Single Touch Payroll; the figures here add up the payslips above. Fictional employer, fictional employee.", { color: MUTED, size: 8.5 });
  return d.finish();
}

async function renewalNotice({ brand, policy, per }) {
  const d = await Doc.create(brand, "Renewal notice", `Policy period ${period(per.from, per.to)}`);
  d.h1(`${policy.name} renewal`);
  const paidFrom = D.accounts.find((a) => a.id === per.paid_from);
  d.kv([["Policy number", `${policy.id.replace("POL-", "PS-")}-${per.from.slice(0, 4)}`], ["Insured", "Jordan and Mia Davies"], ["Situation", policy.address], ["Period of insurance", `${fmtDate(per.from)} to ${fmtDate(per.to)}, 4pm`],
    ["Total premium", aud(per.premium)], ["Payment due", fmtDate(per.from)], ["Status", `Paid ${fmtDate(per.paid_on)} from ${paidFrom ? paidFrom.name : per.paid_from}`], ["Premium includes", "GST, stamp duty and levies"]], 4);
  d.h2("Your cover");
  d.table([{ label: "Cover", w: 260 }, { label: "Sum insured or limit", w: 140, align: "right" }], Object.entries(policy.cover).map(([k, v]) => [k, typeof v === "number" ? aud(v) : String(v)]));
  d.para("Your policy renews automatically when the premium is paid by the due date. Read the Product Disclosure Statement for what is and is not covered. This notice was generated for a fictional household; no policy exists.", { color: MUTED, size: 8.5 });
  return d.finish();
}

async function certificate({ brand, policy, per }) {
  const d = await Doc.create(brand, "Certificate of currency", `Issued ${fmtDate(per.to < "2027-03-31" ? per.to : "2027-03-31")}`);
  d.h1("Certificate of currency");
  d.kv([["Policy number", `${policy.id.replace("POL-", "PS-")}-${per.from.slice(0, 4)}`], ["Policy", policy.name], ["Insured", "Jordan and Mia Davies"], ["Situation", policy.address], ["Period of insurance", `${fmtDate(per.from)} to ${fmtDate(per.to)}`], ["Premium paid", aud(per.premium)]], 3);
  d.h2("Cover in force");
  d.table([{ label: "Cover", w: 260 }, { label: "Sum insured or limit", w: 140, align: "right" }], Object.entries(policy.cover).map(([k, v]) => [k, typeof v === "number" ? aud(v) : String(v)]));
  d.para("This certificate confirms that the policy described is current for the period shown. It is a summary only and does not alter the policy. Fictional, for a demo.", { color: MUTED, size: 8.5 });
  return d.finish();
}

module.exports = { bankStatement, loanStatement, ownerStatement, payslips, incomeStatement, renewalNotice, certificate, money };
