/* The Davies' digital estate: how a family's Drive and inbox really look. The world says what exists; this says where it landed and what state
   it is in. Everything here is fiction, and every file is either a world file (by name) or made below. `truth` is what a person would find on
   opening the file. It stays on the server: the accountant reads it, and nothing hands it to a client. */
"use strict";

const BOTH = ["danny", "daisy"];

// id, name, parent, who can see it. Everyone's root holds the family folder and their own.
const FOLDERS = [
  ["family", "Davies family", "root", BOTH],
  ["tax-stuff", "tax stuff", "family", BOTH],
  ["receipts", "Receipts", "family", BOTH],
  ["house", "House", "family", BOTH],
  ["geelong", "Geelong", "family", BOTH],
  ["car", "Car", "family", BOTH],
  ["kids", "Kids", "family", BOTH],
  ["old", "old stuff to sort", "family", BOTH],
  ["danny", "Danny's files", "root", ["danny"]],
  ["danny-deductions", "Deductions", "danny", ["danny"]],
  ["danny-crypto", "crypto backups", "danny", ["danny"]],
  ["daisy", "Daisy's files", "root", ["daisy"]],
  ["daisy-deductions", "Deductions", "daisy", ["daisy"]],
  ["daisy-ballarat", "Ballarat cottage", "daisy", ["daisy"]],
];

// Where the files the household keeps for itself landed. First match wins; every Litterbox file in the world lands somewhere.
const HOMES = [
  { name: /^Deductions-Worksheet-Jordan-FY2026/, folder: "tax-stuff", owner: "danny" },
  { name: /^Deductions-Worksheet-Mia-FY2024/, folder: "old", owner: "daisy" },
  { stream: "DED-J", folder: "danny-deductions", owner: "danny" },
  { stream: "DED-M", folder: "daisy-deductions", owner: "daisy" },
  { stream: "WFH-J", folder: "danny-deductions", owner: "danny" },
  { stream: "LOGBOOK", folder: "car", owner: "danny" },
  { stream: "CRYPTO-COLD", folder: "danny-crypto", owner: "danny" },
  { stream: "RECEIPTS", folder: "receipts", owner: "daisy" },
];

// Copies the household saved from a portal or an email, sometimes twice, sometimes in the wrong place. `saved` is when it landed.
const COPIES = [
  { from: "Notice-of-Assessment-Mia-FY2024.pdf", folder: "tax-stuff", owner: "daisy", saved: "2024-09-14", truth: "A true copy of the notice of assessment." },
  { from: "Notice-of-Assessment-Mia-FY2024.pdf", as: "NOA 2024 final.pdf", folder: "tax-stuff", owner: "daisy", saved: "2024-09-14", truth: "An exact duplicate of Notice-of-Assessment-Mia-FY2024.pdf.", duplicate: true },
  { from: "Notice-of-Assessment-Jordan-FY2025.pdf", folder: "tax-stuff", owner: "danny", saved: "2025-09-02", truth: "A true copy of the notice of assessment." },
  { from: "Bupaw-Tax-Statement-Mia-FY2026.pdf", folder: "tax-stuff", owner: "daisy", saved: "2026-08-03", truth: "A true copy of the health statement." },
  { from: "Deductions-Worksheet-Mia-FY2025.xlsx", as: "Deductions-Worksheet-Mia-FY2025 (1).xlsx", folder: "daisy-deductions", owner: "daisy", saved: "2025-08-02", truth: "An exact duplicate.", duplicate: true },
  { from: "Scan-DEV-WASHER.png", as: "washing machine.png", folder: "receipts", owner: "daisy", saved: "2025-03-05", truth: "An exact duplicate of Scan-DEV-WASHER.png.", duplicate: true },
  { from: "WFH-Log-FY2024.csv", as: "WFH-Log-FY2024 copy.csv", folder: "tax-stuff", owner: "danny", saved: "2024-08-11", truth: "An exact duplicate.", duplicate: true },
  { from: "QS-Schedule-Moorabool-Lane.xlsx", folder: "geelong", owner: "danny", saved: "2021-10-14", truth: "A true copy of the depreciation schedule." },
  { from: "Settlement-Statement-Lydiard-Cottage.pdf", folder: "geelong", owner: "daisy", saved: "2023-11-25", truth: "Misfiled. This is the Ballarat settlement, sitting in the Geelong folder.", misfiled: true },
  { from: "Notice-of-Assessment-Mia-FY2023-amended.pdf", folder: "kids", owner: "daisy", saved: "2024-03-20", truth: "Misfiled. The amended notice for FY2023, sitting in the Kids folder.", misfiled: true },
  { from: "Water-RENTAL2-2026-03-26.pdf", folder: "car", owner: "daisy", saved: "2026-03-30", truth: "Misfiled. A Ballarat water bill, sitting in the Car folder.", misfiled: true },
  { from: "Kittenhood-Statement-2025-03.html", folder: "house", owner: "daisy", saved: "2025-03-18", truth: "Misfiled. A childcare statement, sitting in the House folder.", misfiled: true },
  { from: "VicPaws-Rego-2024.pdf", folder: "car", owner: "danny", saved: "2024-09-20", truth: "A true copy of the registration notice." },
  { from: "Rates-HOME-2026-07-27.pdf", folder: "house", owner: "daisy", saved: "2026-08-02", truth: "A true copy of the home's rates notice." },
];

/* Files no world domain writes. Each states facts the world already holds (price, dates, matter numbers) and adds none that a domain would contradict.
   drive: a folder. mail: goes out with a message below. scan: an image with no text layer. */
const MADE = [
  { id: "contract-geelong", kind: "scan-pdf", folder: "tax-stuff", title: "scan0003.pdf", source: "Contract-of-Sale-Moorabool-Lane.pdf", owner: "danny", saved: "2021-09-02", truth: "The contract of sale for the Geelong townhouse, scanned with no text layer. The name says nothing.", tags: ["contract_of_sale"],
    lines: (w) => ["CONTRACT OF SALE OF REAL ESTATE", "", "VENDOR: R AND T ACKLAND", `PURCHASER: ${w.joint.toUpperCase()}`, "PROPERTY: 7/41 MOORABOOL LANE, GEELONG VIC 3220", "PRICE: $640,000.00", "DEPOSIT: $64,000.00 BY DEPOSIT BOND", "DAY OF SALE: 16 JUNE 2021", "SETTLEMENT: 20 AUGUST 2021", "CONVEYANCER: GEELONG CONVEYANCING PTY LTD", "MATTER: GC-21-0817", "", "SIGNED BY THE PARTIES", "FICTIONAL DOCUMENT. DEMO."] },
  { id: "drawing", kind: "scan-pdf", folder: "tax-stuff", title: "scan0004.pdf", source: "A-Drawing.pdf", owner: "daisy", saved: "2025-11-30", truth: "A child's drawing of a cat, scanned by mistake.", tags: [],
    lines: () => ["          /\\_/\\", "         ( O.O )", "          > * <", "", "   MY CAT BY SALT", "", "FICTIONAL DOCUMENT. DEMO."] },
  { id: "screenshot", kind: "png", folder: "receipts", title: "Screenshot 2025-03-04 at 7.42.18 pm.png", source: "Uniform-Receipt-FY2025.png", owner: "daisy", saved: "2025-03-04", truth: "A screenshot of a receipt for work uniforms: $285.00, the D3 claim on the FY2025 worksheet.", tags: ["receipt"],
    lines: () => ["PAWFESSIONAL UNIFORMS", "ORDER 58812   4 MAR 2025", "3 X CLINIC POLO   $285.00", "GST INCLUDED      $25.91", "PAID BY CARD ENDING 4771", "THANKS FOR YOUR ORDER", "FICTIONAL. DEMO."] },
  { id: "wfh-draft", kind: "edit", folder: "tax-stuff", title: "WFH-Log-FY2025 (Danny's edits).csv", from: "WFH-Log-FY2025.csv", source: "WFH-Log-FY2025-draft.csv", owner: "danny", saved: "2025-07-22", truth: "A stale draft. One month's hours differ from the log that was claimed, so the two disagree.", tags: [], stale: true },
  { id: "invoice-geelong", kind: "invoice", mail: true, title: "GC-21-0817-Tax-Invoice.pdf", source: "Legal-Invoice-Moorabool-Lane.pdf", saved: "2021-08-27", truth: "The conveyancer's tax invoice for the Geelong purchase, $1,650.00, the legal line on the settlement statement.", tags: ["legal_invoice"],
    invoice: { firm: "Geelong Conveyancing Pty Ltd", number: "GC-21-0817", dated: "27 Aug 2021", client: "joint", property: "7/41 Moorabool Lane, Geelong VIC 3220", lines: [["Professional fees for the purchase", "1,272.73"], ["GST on fees", "127.27"], ["Title and council searches (no GST)", "250.00"]], total: "1,650.00" } },
];

// The messages that give the inbox its mess. People, then a thread if it belongs to one.
const MAIL = [
  { id: "geelong-fwd", date: "2021-09-02", from: "jordan", to: "mia", subject: "Fwd: Settlement complete, 7/41 Moorabool Lane", people: BOTH, attach: ["Settlement-Statement-Moorabool-Lane.pdf", "GC-21-0817-Tax-Invoice.pdf"], body: "For the tax file. I scanned the contract too, it is in the Drive somewhere.\n\n---------- Forwarded message ---------\nFrom: Geelong Conveyancing Pty Ltd\n\nSettlement went through on 20 August. Statement and our invoice attached." },
  { id: "ballarat-paper", date: "2023-11-22", thread: "ballarat", from: "Whisker Lane Conveyancing <settlements@whiskerlane.example>", to: "mia", subject: "Settlement complete, 14 Lydiard Cottage Lane", people: ["daisy"], attach: ["Settlement-Statement-Lydiard-Cottage.pdf"], body: "Dear {mia},\n\nSettlement went through on 15 November. Your statement is attached.\n\nYour signed contract and our tax invoice went out by post to Albion Crescent, as you asked. We do not keep an electronic copy of the contract once a matter closes, so please hold on to it.\n\nWhisker Lane Conveyancing. A parody; a fictional document." },
  { id: "agent-link", date: "2025-08-14", from: "Paws and Claws Tax Agents <returns@pawsandclaws.example>", to: "joint", subject: "Your documents are in our client portal", people: BOTH, body: "Hi {jordan} and {mia},\n\nYour FY2025 documents are ready. Find them in our client portal: https://portal.pawsandclaws.example/d/8841\n\nA parody; fictional." },
  { id: "ballarat-ask", date: "2027-02-20", thread: "ballarat-q", from: "mia", to: "jordan", subject: "Ballarat contract?", people: BOTH, body: "Did you ever see the Ballarat contract? I think it came in the post and I can't find it anywhere. Not in the Drive. The new accountant will want it." },
  { id: "ballarat-no", date: "2027-02-20", thread: "ballarat-q", from: "jordan", to: "mia", subject: "Re: Ballarat contract?", people: BOTH, body: "No idea. Try the box in the spare room? I found the Geelong one, it is in tax stuff, but I never renamed the scan." },
  { id: "spam-1", date: "2024-02-12", from: "Parcel Express <track@parcel-xpress.example>", to: "joint", subject: "Your parcel is waiting. Pay $2.99 to release it", people: BOTH, labels: ["SPAM"], body: "A fictional scam, of the kind every inbox gets. Nothing here is real." },
  { id: "spam-2", date: "2025-10-30", from: "myGuv Refunds <refund@not-myguv.example>", to: "joint", subject: "You have a tax refund waiting", people: BOTH, labels: ["SPAM"], body: "A fictional scam, of the kind every inbox gets. Nothing here is real." },
];

// Wrapping a file that arrived by email. The world says it came that way; this says who sent it.
const SENDERS = {
  "agent-return-pdf": { from: "Paws and Claws Tax Agents <returns@pawsandclaws.example>", subject: (f) => `Your ${f.name.match(/FY\d{4}/)[0]} tax return${/amended/.test(f.name) ? ", amended" : ""}`, body: () => "Your return is attached. Your notice of assessment will appear on myGuv once it issues.\n\nPaws and Claws Tax Agents. A parody; fictional." },
  "appraisal-pdf": { from: "Paws and Pillars Valuers <reports@pawsandpillars.example>", subject: (f) => `Valuation report, ${f.name.replace(/^Valuation-|\.pdf$/g, "")}`, body: () => "Your valuation is attached.\n\nPaws and Pillars Valuers. A parody; fictional." },
  "cedar-contract-note-pdf": { from: "Cedar Trade <confirmations@cedartrade.example>", subject: (f) => `Contract note ${f.name.match(/CN\d+/)[0]}`, body: () => "Your contract note is attached.\n\nCedar Trade. A parody; fictional." },
  "qs-schedule-xlsx": { from: "Tabby and Tom Quantity Surveyors <reports@tabbytom.example>", subject: (f) => `Depreciation schedule, ${f.name.replace(/^QS-Schedule-|\.xlsx$/g, "").replace(/-/g, " ")}`, body: () => "Your depreciation schedule is attached. Keep it for the life of the property.\n\nTabby and Tom Quantity Surveyors. A parody; fictional." },
  "receipt-pdf": { from: "Orders <orders@store.example>", subject: () => "Your invoice", body: () => "Thanks for your order. Your invoice is attached.\n\nA fictional receipt from a parody store." },
  "settlement-pdf": { from: "Geelong Conveyancing Pty Ltd <settlements@geelongconveyancing.example>", subject: () => "Settlement complete, 7/41 Moorabool Lane", body: () => "Settlement went through on 20 August. Statement and our invoice attached.\n\nGeelong Conveyancing Pty Ltd. A parody; fictional.", attach: ["GC-21-0817-Tax-Invoice.pdf"], only: /Moorabool/ },
};

// One note per document, pointing at the portal, the way real statements arrive.
const NOTICES = [
  { stream: "ACC-CC-STMT", from: "Amewx <no-reply@amewx.example>", subject: "Your Amewx statement is ready", body: "Your statement is ready. Sign in to Amewx to view it. We do not attach statements to email." },
  { stream: "OWN-RENTAL", from: "PropertyMeow <statements@propertymeow.example>", subject: "Your owner statement is ready", body: "Your owner statement is ready in the owner portal." },
  { stream: "OWN-RENTAL2", from: "RentPurrfect <statements@rentpurrfect.example>", subject: "Your owner statement is ready", body: "Your owner statement is ready in the owner portal." },
  { stream: "CHILDCARE", from: "Kittenhood Early Learning <accounts@kittenhood.example>", subject: "Your statement of account", body: "Your statement of account is on the family portal." },
];
const PROMOS = ["JB Hi-Fur <deals@jbhifur.example>|Massive tech sale, this weekend only", "Myaw <news@myaw.example>|Your Myaw member offers", "Bunnypaws Warehouse <hello@bunnypaws.example>|Lowest prices are just the beginning"];

/* What each chapter needs, and where it is. build-vault.js checks every line against the built estate at that chapter's clock and writes
   life/davies/ESTATE.md, so this table cannot quietly go stale. `file` matches a file's real name, whatever it has been renamed to. No `file`
   means nothing in the world could be it yet. */
const NEEDS = [
  [1, "Everyday joint, the last three months", /Harbour-Transactions-ACC-EVD-2026-12/],
  [1, "Daisy's latest payslip", /Pawroll-Payslip-Mia-2027-01/],
  [2, "A card in Daisy's own name", null, "The only card here is Danny's. The generated life gives Daisy one."],
  [2, "Danny's card statements", /Amewx-Statement-2027-01/],
  [2, "Daisy's latest super statement", /HESTAbby-Statement-2026-12-31/],
  [2, "Daisy's HELP balance", /myGuv-HELP-account-FY2026/],
  [2, "Daisy's deductions worksheet, FY2026", /Deductions-Worksheet-Mia-FY2026/],
  [2, "The roof invoice", /Scan-Roof-Invoice/],
  [3, "Everyday joint, as Danny imports it", /Harbour-Transactions-ACC-EVD-2027-02/],
  [3, "Danny's old everyday account", /^CSVData\.csv$/],
  [3, "Danny's super activity", /Purrannuation-Activity-2027-02/],
  [3, "Danny's RSU holdings", /ETreat-Holdings-2027-01-31/],
  [3, "Danny's crypto wallet export", /wallet-export/],
  [4, "Daisy's full FY2026 return with schedules", /Tax-Return-Mia-FY2026/],
  [4, "Danny's full FY2026 return with schedules", /Tax-Return-Jordan-FY2026/],
  [4, "Daisy's FY2026 notice of assessment", /Notice-of-Assessment-Mia-FY2026/],
  [4, "The FY2023 amendment, return and notice", /Mia-FY2023-amended/],
  [4, "Geelong purchase contract", /Contract-of-Sale-Moorabool-Lane/],
  [4, "Geelong settlement statement", /Settlement-Statement-Moorabool-Lane/],
  [4, "Geelong legal invoice", /Legal-Invoice-Moorabool-Lane/],
  [4, "Geelong depreciation schedule", /QS-Schedule-Moorabool-Lane/],
  [4, "Ballarat purchase contract", null, "Posted to the house in 2023 and lost. The conveyancer keeps no copy."],
  [4, "Ballarat settlement statement", /Settlement-Statement-Lydiard-Cottage/],
  [4, "Ballarat legal invoice", null, "Posted with the contract."],
  [4, "Ballarat depreciation schedule", /QS-Schedule-Lydiard-Cottage/],
  [4, "FY2026 home and rental loan statements", /Westpaw-LoanStatement-LN-INV-FY2026/],
  [4, "FY2027 income statements", null, "The world ends on 31 March 2027."],
  [4, "FY2027 owner statements to June", null, "The world ends on 31 March 2027."],
  [4, "FY2027 annual tax statements for the shares", null, "The world ends on 31 March 2027."],
  [4, "FY2027 private health statements", null, "The world ends on 31 March 2027."],
  [4, "FY2027 returns and notices, back from the accountant", null, "The world has no FY2027 assessment."],
  [5, "Home purchase contract and settlement, 2019", null, "The world opens on 1 March 2019 and holds settlement papers for the two rentals only."],
  [5, "Home insurance renewal", /Purrsure-RenewalNotice-HOME-2026/],
  [5, "Warranties and receipts", /Receipt-DEV-TV/],
  [5, "Wills and powers of attorney", null, "No world domain writes them."],
  [5, "A year of bank files after March 2027", null, "The world ends on 31 March 2027."],
  [6, "Salt's pocket money", null, "Memo money, no document. The account has to be made."],
  [6, "School fees, birth papers for the younger two", null, "The world ends on 31 March 2027."],
  [7, "ABN registration, client invoices, BAS", null, "The world records no business."],
  [8, "A second store to move to", null, "A real Microsoft demo account does not exist yet. The Drive API is the swap point."],
  [9, "Salt's TFN, first payslip and super", null, "The world ends on 31 March 2027."],
  [10, "Separation papers, consent orders, child support", null, "The world holds no such branch."],
  [11, "Downsizing contract, pension statements", null, "The world ends on 31 March 2027."],
  [12, "Will, grant of probate, a death certificate", null, "The world ends on 31 March 2027."],
];

module.exports = { BOTH, FOLDERS, HOMES, COPIES, MADE, MAIL, SENDERS, NOTICES, PROMOS, NEEDS };
