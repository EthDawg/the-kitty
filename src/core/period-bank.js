/* Single-bank intake uses the canonical period planner. This adapter only validates its inputs
   and projects a complete, human-reviewable result. No clock, file, provider or write authority. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./period-core.js"), require("./import.js"));
  else root.KittyBank = factory(root.KittyPeriod, root.KittyImport);
})(typeof globalThis !== "undefined" ? globalThis : this, function (period, bank) {
  "use strict";
  const tables = {
    kitty: ["Kitty!A1:B", ["Key", "Value"]],
    accounts: ["Accounts!A1:P", ["Account ID","Account","Institution","Type","Owner","Opening balance ($)","Opening date","Balance at as-of date ($)","Liquid","Class","Valuation method","Currency","Status","Purpose","Linked account","Note"]],
    category_list: ["Categories!A1:H", ["Category ID","Category","Group","Flow","Monthly budget ($)","Essential","Tax treatment","ATO label"]],
    entries: ["Entries!A1:T", ["Entry ID","Kind","Settled at","Account ID","Raw text","Description","Amount","Category ID","Person","Receipt held","Note","Status","Created at","Transfer ID","Transfer account","Foreign amount","Foreign currency","Units","Unit price","Source"]],
    rules: ["Rules!A1:J", ["Rule ID","Pattern","Match","Merchant","Category ID","Person","Tax label","Property","Source","Note"]],
    decisions: ["Decisions!A1:H", ["Decision ID","Ref kind","Ref ID","Decision","Value","By","At","Note"]],
    contracts: ["Contracts!A1:Q", ["Contract ID","Kind","Name","Provider","Owner","Account ID","Category ID","Cadence","Amount ($)","Rate","Start date","End date","Next date","Last used","Cover","Status","Note"]],
    payslips: ["Payslips!A1:G", ["Pay date","Person","Employer","Gross pay","Tax withheld","Super (employer)","Net pay"]],
    assets: ["Assets!A1:A", ["Item ID"]],
    loans: ["Loans!A1:A", ["Loan ID"]]
  };
  const ranges = Object.freeze(Object.fromEntries(Object.entries(tables).map(([key,[a1]]) => [key,a1])));
  const keyOf = s => s.toLowerCase().replace(/\(.*?\)/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
  const blank = v => v === "" || v == null;
  const fail = message => { throw new Error(message); };
  const dayOf = (value, formatted) => {
    if (typeof value === "string" && period.text.isIsoDate(value)) return value;
    if (Number.isInteger(value) && value >= 1 && value <= 200000) return new Date(Date.UTC(1899,11,30) + value * 86400000).toISOString().slice(0,10);
    if (formatted && typeof value === "string") {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
      if (match) { const day = match[3]+"-"+match[2].padStart(2,"0")+"-"+match[1].padStart(2,"0"); if (period.text.isIsoDate(day)) return day; }
    }
    return null;
  };
  function amount(value, formatted) {
    if (formatted && typeof value === "string") {
      try { return Number(bank.money(value)) / 100; } catch (_) { return null; }
    }
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12 && Math.round(value*100)/100 === value ? value : null;
  }
  function utf8Length(text) {
    let length=0;
    for(const character of text){const n=character.codePointAt(0);if(n>=0xd800&&n<=0xdfff)fail("The CSV contains an incomplete UTF-8 character.");length+=n<128?1:n<2048?2:n<65536?3:4;}
    return length;
  }
  function fromGrids(grids, formatted = false) {
    const sheet = {};
    for (const [name,[a1,headers]] of Object.entries(tables)) {
      const rows = grids[name], tab = a1.split("!")[0];
      if (!Array.isArray(rows) || rows.length > 100001) fail("Could not read the complete " + tab + " table.");
      // Physical offsets in Entries, Contracts and Payslips determine writes/preconditions. Never compact gaps.
      const canHaveTitle = ["kitty","assets","loans"].includes(name);
      const headerRows = canHaveTitle ? rows.flatMap((row,i)=>row?.[0]===headers[0]?[i]:[]) : [0];
      const headerIndex = headerRows.length===1 ? headerRows[0] : -1;
      if (headerIndex < 0 || headers.some((header,i)=>rows[headerIndex]?.[i]!==header)) fail("The "+tab+" columns differ from the supported v2 Sheet. Check its header.");
      const keys = headers.map(keyOf), records = [], seen = new Set();
      let last = rows.length - 1;
      while (last>headerIndex && (!rows[last] || rows[last].every(blank))) last--;
      for (let i=headerIndex+1;i<=last;i++) {
        const row=rows[i];
        if (!Array.isArray(row) || blank(row[0])) fail("Missing "+headers[0]+" at "+tab+" row "+(i+1)+". Fill or remove the blank row before importing.");
        const record = Object.fromEntries(keys.map((key,j)=>[key,blank(row[j])?null:row[j]]));
        if (name!=="payslips") {
          if (typeof row[0]!=="string" || !row[0].trim() || seen.has(row[0].trim())) fail("Invalid or repeated "+headers[0]+" at "+tab+" row "+(i+1)+".");
          seen.add(row[0].trim());
        }
        if (name==="accounts" || name==="entries") {
          const date = name==="accounts"?"opening_date":"settled_at", money = name==="accounts"?"opening_balance":"amount";
          record[date]=dayOf(record[date],formatted); record[money]=amount(record[money],formatted);
          if (!record[date] || record[money]===null) fail("Check the date and signed amount in "+tab+" row "+(i+1)+".");
        }
        if (name==="payslips") {
          record.pay_date=dayOf(record.pay_date,formatted);
          if (!record.pay_date) fail("Check the pay date in Payslips row "+(i+1)+".");
        }
        records.push(record);
      }
      sheet[name]=records;
    }
    return sheet;
  }

  function prepare(sheet, file, request) {
    const {account,month,downloadDay,sheetID=null}=request;
    if (!Array.isArray(sheet.entries) || sheet.kitty?.filter(r=>r.key==="sheet_version").length!==1 || String(sheet.kitty.find(r=>r.key==="sheet_version").value)!=="2") fail("Choose a verified version 2 Kitty Sheet.");
    if (!/^[0-9]{4}-(?:0[1-9]|1[0-2])$/.test(month) || !period.text.isIsoDate(downloadDay)) fail("Choose a valid month and download date.");
    if (!/^[a-f0-9]{64}$/.test(file.id) || typeof file.name!=="string" || !file.name.trim() || file.name.length>255 || /[\/\\:\u0000-\u001f\u007f]/.test(file.name) || file.name.startsWith(".") ||
        !Number.isInteger(file.byteLength) || file.byteLength<1 || file.byteLength>5*1024*1024 || file.mimeType!=="text/csv" || !/\.csv$/i.test(file.name) || typeof file.text!=="string" || utf8Length(file.text)!==file.byteLength) fail("Choose the original UTF-8 bank CSV from Files.");
    const choices=(sheet.accounts||[]).filter(a=>a.account_id===account);
    if (choices.length!==1 || /[\/\\:\u0000-\u001f\u007f]/.test(account) || account.startsWith(".") || String(choices[0].valuation_method).toLowerCase()!=="ledger" || String(choices[0].status).toLowerCase()!=="active") fail("Choose one active ledger account from this Sheet.");
    const acct=choices[0], currency=acct.currency || sheet.kitty.find(r=>r.key==="currency")?.value;
    if (!period.adapters.BANK_SHAPES.includes(acct.institution) || ["loan","property"].includes(String(acct.type).toLowerCase())) fail("Choose an account with a supported bank CSV format. Loan and property statements need their own review.");
    if (currency!=="AUD") fail("This bank importer supports Australian-dollar accounts.");
    // Preserve the original source spelling when compiling the period planner's USER_ENTERED escape.
    // Unknown formats still flow to the canonical planner for its institution-specific repair instructions.
    const count=bank.validateBankOriginal(file.text);
    const result=period.plan({months:month,sheet,files:[{name:file.name,account,download_day:downloadDay,text:file.text}],
      inputs:[],options:{as_of:downloadDay,sheet_id:sheetID,review_outside_rows:true,transaction_id_floor:request.transactionIDFloor}});
    const duplicates=result.outcomes.already_in_sheet, repeated=result.outcomes.repeated_across_files;
    const row = r => ({
      line:r.line,date:r.date,raw:r.raw_text ?? r.description,amountCents:r.amount_cents,signedAmount:period.text.plus2(r.amount_cents),
      ...(r.id?{id:r.id,merchant:r.merchant,category:r.category_id,person:r.person}: {})
    });
    const summary={status:result.status,sourceID:file.id,name:file.name,byteLength:file.byteLength,mimeType:file.mimeType,
      account,accountName:acct.account || account,currency,month,downloadDay,sourceRows:count,proposedCount:result.proposed.transactions.length,
      duplicateCount:duplicates.length,allDuplicates:result.status==="ready" && duplicates.length>0 && duplicates.length+result.outcomes.outside_window.reduce((n,o)=>n+o.earlier+o.later,0)===count && !result.plan.writes.length,
      rows:result.proposed.transactions.map(row),duplicates:duplicates.map(row),repeated:repeated.map(row),
      outside:result.outcomes.outside_window.map(window=>({...window,rows:window.rows.map(row)})),
      faults:result.faults.map(x=>[x.what,x.do].filter(Boolean).join(". ")),
      holds:result.holds.map(x=>x.text),review:result.review,checks:result.checks.closing,writes:result.plan.writes,deferred:result.plan.deferred};
    return {plan:result.plan,summary};
  }
  function fromFreshGrids(grids,file,request) { return prepare(fromGrids(grids,false),file,request); }
  return Object.freeze({ranges,fromGrids,prepare,fromFreshGrids});
});
