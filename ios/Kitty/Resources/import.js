/* Kitty's shared, pure import boundary. No network, clock, filesystem or Sheet writes.
 * UMD intentionally runs unchanged in Node and iOS JavaScriptCore.
 * Source facts stay separate from review decisions. Monetary values use exact cents.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KittyImport = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.0.0';
  const MAX_MINOR = 99999999999999;
  const CURRENCIES = new Set(['AUD','USD','NZD','GBP','EUR','CAD','CHF','SGD','HKD']);
  const HEADERS = {
    harbour: ['Bank Account', 'Date', 'Narrative', 'Debit Amount', 'Credit Amount', 'Balance', 'Categories', 'Serial'],
    southern: ['Date', 'Description', 'Card Member', 'Account #', 'Amount'],
    wattle: ['Date', 'Description', 'Credit', 'Debit', 'Balance']
  };
  const FORMATS = {
    harbour: {id:'harbour', name:'Harbour / separate debit and credit', date:'Date', description:'Narrative', debit:'Debit Amount', credit:'Credit Amount', balance:'Balance', debitSign:'positive', dateOrder:'dmy', account:'Bank Account'},
    southern: {id:'southern', name:'Southern / card charges positive', date:'Date', description:'Description', amount:'Amount', sign:'charges-positive', dateOrder:'dmy', account:'Account #'},
    wattle: {id:'wattle', name:'Wattle / signed debit and credit', date:'Date', description:'Description', debit:'Debit', credit:'Credit', balance:'Balance', debitSign:'negative', dateOrder:'dmy'}
  };
  const str = v => v == null ? '' : String(v);
  const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
  const fail = (code,message) => { const error = new Error(message); error.code=code; throw error; };
  // A display identifier only: identity comparisons always retain the full tuple too.
  function stableID(value) {
    let a=2166136261,b=2246822519;
    for (let i=0;i<value.length;i++) { const c=value.charCodeAt(i); a=Math.imul(a^c,16777619); b=Math.imul(b^c,3266489917); }
    return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
    return JSON.stringify(value===undefined?null:value);
  }
  function parseCSV(text,options) {
    if (typeof text!=='string') fail('file-unreadable','The file could not be read as text. Export a UTF-8 CSV.');
    if (text.length>10000000) fail('file-too-large','This file is larger than the 10 MB import limit. Export a shorter period.');
    text=text.replace(/^\uFEFF/,'');
    if (/^\s*%PDF-/.test(text)) fail('pdf-unsupported','This is a PDF statement. Export a CSV, or prepare a reviewed CSV with your AI assistant.');
    if (text.includes('\u0000') || text.includes('\uFFFD')) fail('file-encoding','The file is not valid UTF-8 text. Export a UTF-8 CSV.');
    const records=[];let cells=[],cell='',quoted=false,afterQuote=false,line=1,startLine=1;
    function field(){cells.push(cell);cell='';afterQuote=false;}
    function record(){field();if(cells.some(v=>v.trim()!==''))records.push({values:cells,line:startLine});cells=[];startLine=line+1;}
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){
        if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;afterQuote=true;}}
        else{cell+=c;if(c==='\n')line++;else if(c==='\r'&&text[i+1]!=='\n')line++;}
      }else if(c===','){field();}
      else if(c==='\n'||c==='\r'){record();if(c==='\r'&&text[i+1]==='\n')i++;line++;}
      else if(c==='"'){if(cell!==''||afterQuote)fail('csv-quote','Unexpected quote on line '+line+'. Check the original CSV export.');quoted=true;}
      else {if(afterQuote)fail('csv-quote','Unexpected text after a closing quote on line '+line+'. Check the original CSV export.');cell+=c;}
    }
    if(quoted)fail('csv-quote','The CSV has an unclosed quoted field. Download the file again.');
    if(cell!==''||cells.length||afterQuote)record();
    if(!records.length)fail('file-empty','The CSV is empty. Select an export containing transactions.');
    const headers=records.shift().values.map(v=>v.trim());
    if(headers.length<2)fail('csv-delimiter','This file is not a comma-separated CSV. Export as CSV or convert it before importing.');
    if(headers.some(v=>!v))fail('csv-header','Every column needs a header. Check the original export.');
    if(new Set(headers).size!==headers.length)fail('csv-header','The file has duplicate column names. Rename them before mapping.');
    records.forEach((r,i)=>{r.row=i+2;if(r.values.length!==headers.length)fail('csv-columns','Line '+r.line+' has '+r.values.length+' fields; expected '+headers.length+'. Check quoting and separators.');});
    if(!records.length&&!(options&&options.allowEmpty===true))fail('file-empty','The CSV has headings but no transactions. Choose a period with activity.');
    return {headers,records};
  }
  function detectFormat(input){
    const headers=Array.isArray(input)?input:parseCSV(input).headers;
    for(const id of Object.keys(HEADERS))if(JSON.stringify(headers)===JSON.stringify(HEADERS[id]))return Object.assign({},FORMATS[id]);
    return null;
  }
  function money(value,blankZero){
    let s=str(value).trim();
    if(!s){if(blankZero)return '0';fail('amount-missing','An amount is missing.');}
    let negative=false;
    if(/^\(.*\)$/.test(s)){negative=true;s=s.slice(1,-1).trim();}
    if(s.startsWith('-')){if(negative)fail('amount-invalid','Amount has two negative signs.');negative=true;s=s.slice(1);}
    else if(s.startsWith('+'))s=s.slice(1);
    s=s.replace(/^\$/, '');
    if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))fail('amount-invalid','Amounts must be decimal currency with at most two decimal places.');
    const parts=s.replace(/,/g,'').split('.');
    const n=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));
    if(!Number.isSafeInteger(n)||n>MAX_MINOR)fail('amount-range','Amount exceeds the supported exact-currency range.');
    return String(negative&&n!==0?-n:n);
  }
  function minor(value){
    const s=str(value);
    if(!/^-?(?:0|[1-9]\d*)$/.test(s)||!Number.isSafeInteger(Number(s))||Math.abs(Number(s))>MAX_MINOR)fail('amount-minor','Stored minor units must be an exact integer within the supported range.');
    return String(Number(s));
  }
  function decimalAmount(value){const n=Number(minor(value));return (n<0?'-':'')+Math.floor(Math.abs(n)/100)+'.'+String(Math.abs(n)%100).padStart(2,'0');}
  function strictDate(value,order){
    const s=str(value).trim();let y,m,d,match;
    if((match=s.match(/^(\d{4})-(\d{2})-(\d{2})$/))){y=+match[1];m=+match[2];d=+match[3];}
    else if((match=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))){
      if(order!=='dmy'&&order!=='mdy')fail('date-order','Confirm whether dates are day/month/year or month/day/year.');
      y=+match[3];m=+(order==='mdy'?match[1]:match[2]);d=+(order==='mdy'?match[2]:match[1]);
    }else fail('date-invalid','Use a full date such as 2027-02-03 or 03/02/2027 with a confirmed date order.');
    const leap=y%4===0&&(y%100!==0||y%400===0);const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
    if(y<1900||y>2200||m<1||m>12||d<1||d>days[m-1])fail('date-invalid','Date does not exist in the calendar.');
    return String(y)+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }
  function tuple(r){return JSON.stringify([r.accountId,r.date,r.description,r.amountMinor]);}
  function normalDescription(s){return str(s).toUpperCase().replace(/\b(?:REFUND|REF|REFERENCE)\b/g,'').replace(/\d+/g,'').replace(/[^A-Z]+/g,' ').trim();}
  function daysApart(a,b){return Math.abs(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;}
  function normalizeExisting(r){
    const amount= r.amountMinor!=null ? minor(r.amountMinor) : r.amount_minor!=null ? minor(r.amount_minor) : money(r.amount,false);
    return {id:str(r.id||r.txn_id),date:strictDate(r.date,'ymd'),accountId:str(r.accountId||r.account_id),description:str(r.description||r.bank_description).trim(),amountMinor:amount,providerId:str(r.providerId||r.provider_id),sourceId:str(r.sourceId||r.source_id),sourceRow:r.sourceRow||r.source_row||null,sourceRefs:Array.isArray(r.sourceRefs)?r.sourceRefs:[],categoryId:str(r.categoryId||r.category_id),merchant:str(r.merchant),person:str(r.person),status:str(r.status||'posted').toLowerCase()};
  }
  function resolveMapping(csv,file){
    const detected=detectFormat(csv.headers);
    if(!file.mapping){if(!detected)fail('mapping-required','This export format is unfamiliar. Confirm its date, description and amount columns.');return detected;}
    const m=Object.assign({id:'custom',name:'Your confirmed mapping'},file.mapping);
    if(m.confirmed!==true)fail('mapping-unconfirmed','Review the column mapping and confirm the debit/credit meaning first.');
    if(csv.headers.some(h=>['status','posting status','transaction status'].includes(h.toLowerCase()))&&!m.status)fail('mapping-status-required','Map the posting-status column so pending transactions are not imported as posted.');
    for(const key of ['date','description'])if(!m[key]||!csv.headers.includes(m[key]))fail('mapping-invalid','Choose an existing '+key+' column.');
    if(m.amount){
      if(!csv.headers.includes(m.amount))fail('mapping-invalid','Choose an existing amount column.');
      if(m.sign!=='money-in-positive'&&m.sign!=='charges-positive')fail('mapping-sign','Confirm whether positive amounts mean money in or card charges.');
      if(m.debit||m.credit)fail('mapping-invalid','Map one amount column or separate debit and credit columns, not both.');
    }else{
      if(!m.debit||!m.credit||!csv.headers.includes(m.debit)||!csv.headers.includes(m.credit)||m.debit===m.credit)fail('mapping-invalid','Choose separate debit and credit columns.');
      if(m.debitSign!=='positive'&&m.debitSign!=='negative')fail('mapping-sign','Confirm whether the debit column uses positive or negative amounts.');
    }
    const mapped=['date','description','amount','debit','credit','status','providerId','balance','account'].filter(k=>m[k]);
    for(const key of mapped)if(!csv.headers.includes(m[key]))fail('mapping-invalid','Mapped '+key+' column is absent from this file.');
    if(new Set(mapped.map(k=>m[k])).size!==mapped.length)fail('mapping-invalid','A source column cannot supply more than one field.');
    if(m.dateOrder&& !['dmy','mdy','ymd'].includes(m.dateOrder))fail('date-order','Choose day first, month first or ISO dates.');
    return m;
  }
  function prepare(input){
    input=input||{};const result={version:VERSION,rows:[],issues:[],excluded:[],duplicates:[],files:[],counts:{source:0,parsed:0,pending:0,invalid:0,overlap:0,existing:0,possibleExisting:0,proposed:0,review:0,errors:0},canCommit:false};
    const accounts=new Map((input.accounts||[]).map(a=>[str(a.id||a.account_id),a]));
    const categories=new Set((input.categories||[]).map(c=>str(c.id||c.category_id)));
    const decisions=input.decisions||{};const existing=[];
    const decisionFor=key=>own(decisions,key)&&decisions[key]&&typeof decisions[key]==='object'&&!Array.isArray(decisions[key])?decisions[key]:null;
    function issue(code,severity,message,recovery,extra){const v=Object.assign({id:'issue-'+result.issues.length,code,severity,message,recovery,rowIds:[]},extra||{});result.issues.push(v);return v;}
    const seenExistingIDs=new Set();
    for(const raw of input.existing||[]){
      try{const r=normalizeExisting(raw);if(!r.accountId||!r.description)throw new Error('Stored row lacks account or original description.');if(r.status==='pending')continue;if(r.id&&seenExistingIDs.has(r.id))throw new Error('Stored transaction IDs are not unique.');seenExistingIDs.add(r.id);existing.push(r);}
      catch(e){issue('existing-invalid','error','The current Sheet contains an invalid transaction.','Repair or refresh the Sheet before importing.',{detail:e.message});}
    }
    if(!Array.isArray(input.files)||!input.files.length)issue('files-missing','error','Choose a source file to import.','Select a bank CSV or try the fictional example.');
    if(!accounts.size)issue('accounts-missing','error','The Sheet has no accounts.','Connect a valid Kitty Sheet and add an account first.');
    if(!categories.size)issue('categories-missing','error','The Sheet has no categories.','Connect a valid Kitty Sheet before importing.');
    const sheetCurrency=str(input.currency||'AUD').trim().toUpperCase();
    if(!CURRENCIES.has(sheetCurrency))issue('currency-unsupported','error','This import supports only the listed two-decimal currencies; '+sheetCurrency+' is not supported.','Use a Sheet in AUD, USD, NZD, GBP, EUR, CAD, CHF, SGD or HKD. Do not relabel an unsupported currency to import it.');
    const all=[];const seenFiles=new Map(),fileIDs=new Map();
    for(const [fileIndex,file] of (input.files||[]).entries()){
      const fileId=str(file.id||'source-'+stableID(str(file.text))),meta={id:fileId,name:str(file.name||'Import '+(fileIndex+1)),accountId:str(file.accountId),status:'blocked',rows:0};result.files.push(meta);
      try{
        if(!accounts.has(meta.accountId))fail('account-unknown','Select an account that exists in your connected Sheet.');
        const selectedAccount=accounts.get(meta.accountId);let openingDate=null;
        if(own(selectedAccount,'openingDate')){
          try{openingDate=strictDate(selectedAccount.openingDate,'ymd');if(openingDate!==selectedAccount.openingDate)throw new Error();}
          catch{fail('opening-anchor-invalid','The selected account has invalid opening settings. Restore the reviewed opening anchor and history settings in the Sheet, then refresh.');}
        }
        const accountCurrency=str(accounts.get(meta.accountId).currency||input.currency||'AUD').trim().toUpperCase();
        if(!CURRENCIES.has(accountCurrency))fail('currency-unsupported','The selected account currency '+accountCurrency+' is not supported by this two-decimal importer.');
        if(input.currency&&accountCurrency!==sheetCurrency)fail('currency-mismatch','The selected account currency differs from the Sheet currency. Currency conversion is not supported.');
        if(/\.pdf$/i.test(meta.name)||file.mimeType==='application/pdf')fail('pdf-unsupported','PDF statements need reviewed extraction. Export a CSV, or prepare one with your AI assistant.');
        if(typeof file.text!=='string')fail('file-unreadable','The file could not be read as text. Choose a UTF-8 CSV.');
        if(fileIDs.has(fileId)&&fileIDs.get(fileId)!==file.text)fail('source-id-conflict','Two different files use the same source identifier. Choose the files again.');
        fileIDs.set(fileId,file.text);
        // Compare exact contents and account, not only an untrusted caller-supplied hash.
        const contentKey=JSON.stringify([meta.accountId,file.text]);
        if(seenFiles.has(contentKey)){meta.status='already-selected';result.duplicates.push({fileId,reason:'same-file',ofFileId:seenFiles.get(contentKey)});continue;}
        seenFiles.set(contentKey,fileId);
        const csv=parseCSV(file.text,{allowEmpty:input.allowEmptyFiles===true});meta.headers=csv.headers;meta.rows=csv.records.length;result.counts.source+=csv.records.length;
        const mapping=resolveMapping(csv,file);if(mapping.id==='custom'&&!mapping.dateOrder&&input.dateOrder)mapping.dateOrder=input.dateOrder;meta.format=mapping.id;meta.mapping=mapping;
        if(!csv.records.length){
          if(mapping.id==='custom'&&!mapping.dateOrder)fail('date-order','Confirm the date order for this empty export’s mapping.');
          // Empty rows establish neither no activity nor an account identity.
          // Typed intake must bind reviewed statement evidence separately.
          meta.empty=true;
        }
        const account=accounts.get(meta.accountId);const expectedSuffix=str(account.numberSuffix||account.accountSuffix).replace(/\W/g,'');
        const get=(record,key)=>mapping[key]?str(record.values[csv.headers.indexOf(mapping[key])]).trim():'';
        const fileRows=[];let previous=null;let balanceChecks=0;let ascending=true,descending=true;const sourceAccounts=new Set();
        for(const rec of csv.records){
          try{
            const status=get(rec,'status').toLowerCase();
            if(status&&['pending','authorised','authorized','processing'].includes(status)){result.excluded.push({fileId,sourceRow:rec.row,reason:'pending',description:get(rec,'description')});result.counts.pending++;continue;}
            if(status&&!['posted','settled','completed','complete','cleared','booked'].includes(status))fail('status-unknown','Unknown posting status “'+status+'”. Confirm whether the transaction is posted.');
            const date=strictDate(get(rec,'date'),mapping.dateOrder);
            if(openingDate && date<=openingDate)fail('transaction-before-opening','The transaction is on or before the opening balance date '+openingDate+'. Export transactions from the following day; earlier activity is already represented by the opening balance.');
            const description=get(rec,'description');if(!description)fail('description-missing','The original bank description is missing.');
            if(expectedSuffix&&mapping.account&&!get(rec,'account').replace(/\W/g,'').endsWith(expectedSuffix))fail('account-mismatch','The file’s account number does not match the selected account.');
            if(mapping.account&&get(rec,'account'))sourceAccounts.add(get(rec,'account'));
            let n;
            if(mapping.amount){n=Number(money(get(rec,'amount'),false));if(mapping.sign==='charges-positive')n=-n;}
            else {const debit=Number(money(get(rec,'debit'),true)),credit=Number(money(get(rec,'credit'),true));
              if(credit<0||(mapping.debitSign==='positive'&&debit<0)||(mapping.debitSign==='negative'&&debit>0)||(debit!==0&&credit!==0))fail('amount-sign','Debit and credit signs conflict with the mapping, or both columns contain money.');
              n=credit+(mapping.debitSign==='positive'?-debit:debit);
            }
            if(!Number.isSafeInteger(n)||Math.abs(n)>MAX_MINOR)fail('amount-range','Combined amount exceeds the exact-currency range.');
            const row={date,accountId:meta.accountId,description,amountMinor:String(n),decimalAmount:decimalAmount(String(n)),currency:accountCurrency,providerId:get(rec,'providerId'),status:'posted',sourceId:fileId,sourceRow:rec.row,sourceLine:rec.line,sourceRefs:[{fileId,row:rec.row,line:rec.line}],balanceMinor:mapping.balance&&get(rec,'balance')!==''?money(get(rec,'balance'),false):null};
            if(previous){if(date<previous.date)ascending=false;if(date>previous.date)descending=false;}previous=row;fileRows.push(row);result.counts.parsed++;
          }catch(e){result.counts.invalid++;issue(e.code||'row-invalid','error',meta.name+', line '+rec.line+': '+e.message,e.code==='transaction-before-opening'?'Choose an export beginning the day after the opening balance date.':'Correct the source or its mapping, then review the import again.',{fileId,sourceRow:rec.row});}
        }
        if(sourceAccounts.size>1)issue('multiple-accounts','error','This file contains more than one account number.','Export each account separately, then select its matching Sheet account.',{fileId});
        // Validate supplied running balances without assuming source sort direction.
        const hasBalances=fileRows.filter(r=>r.balanceMinor!==null).length;
        if(hasBalances&&hasBalances!==fileRows.length)issue('balance-partial','review','Some rows have no running balance.','Check the statement before accepting partial balance evidence.',{fileId});
        if(hasBalances===fileRows.length&&fileRows.length){
          let ordered=ascending?fileRows:descending?fileRows.slice().reverse():[];
          const balancesMatch=rows=>rows.every((r,i)=>i===0||Number(rows[i-1].balanceMinor)+Number(r.amountMinor)===Number(r.balanceMinor));
          // Equal-date runs have no date-order evidence. Try both chronological
          // directions and accept only arithmetic that independently reconciles.
          if(ascending&&descending&&!balancesMatch(ordered)&&balancesMatch(fileRows.slice().reverse()))ordered=fileRows.slice().reverse();
          if(!ordered.length)issue('balance-order','review','The file is not in date order, so running balances were not checked.','Use a chronological export or review the statement totals.',{fileId});
          else {
            for(let i=1;i<ordered.length;i++){
              if(Number(ordered[i-1].balanceMinor)+Number(ordered[i].amountMinor)!==Number(ordered[i].balanceMinor))issue('balance-mismatch','error','The running balance does not match the movement on '+ordered[i].date+'.','Check the account, sign convention and source completeness.',{fileId,sourceRow:ordered[i].sourceRow});else balanceChecks++;
            }
            meta.openingMinor=String(Number(ordered[0].balanceMinor)-Number(ordered[0].amountMinor));meta.closingMinor=ordered[ordered.length-1].balanceMinor;
            if(file.openingMinor!=null&&minor(file.openingMinor)!==meta.openingMinor)issue('opening-mismatch','error','The source does not reconcile to the supplied opening balance.','Check the statement period and missing transactions.',{fileId});
            if(file.closingMinor!=null&&minor(file.closingMinor)!==meta.closingMinor)issue('closing-mismatch','error','The source does not match the supplied closing balance.','Check the statement period and missing transactions.',{fileId});
          }
        }else if(file.openingMinor!=null&&file.closingMinor!=null){
          const net=fileRows.reduce((s,r)=>s+Number(r.amountMinor),0);
          if(!Number.isSafeInteger(net)||Number(minor(file.openingMinor))+net!==Number(minor(file.closingMinor)))issue('closing-mismatch','error','Transactions do not reconcile from opening to closing balance.','Check missing rows and the bank/card sign convention.',{fileId});else balanceChecks++;
        }
        meta.balanceChecks=balanceChecks;meta.balanceBasis=balanceChecks?'source arithmetic':'not established';meta.status='parsed';all.push({fileId,rows:fileRows});
      }catch(e){issue(e.code||'file-invalid','error',meta.name+': '+e.message,e.code==='opening-anchor-invalid'?'Restore the reviewed opening anchor and history settings in the Sheet, then refresh.':'Choose a supported CSV or confirm a mapping before continuing.',{fileId});}
    }
    const existingByTuple=new Map(),existingByProvider=new Map(),existingByID=new Map(),historyByDescription=new Map(),fuzzyCandidates=new Map();
    const fuzzyKey=r=>JSON.stringify([r.accountId,r.amountMinor,normalDescription(r.description)]);
    function indexFuzzy(r){const k=fuzzyKey(r);if(!fuzzyCandidates.has(k))fuzzyCandidates.set(k,[]);fuzzyCandidates.get(k).push(r);}
    for(const r of existing){
      const k=tuple(r);if(!existingByTuple.has(k))existingByTuple.set(k,[]);existingByTuple.get(k).push(r);
      if(r.id)existingByID.set(r.id,r);if(r.providerId)existingByProvider.set(JSON.stringify([r.accountId,r.providerId]),r);
      const hk=JSON.stringify([r.accountId,r.description]);if(!historyByDescription.has(hk))historyByDescription.set(hk,[]);historyByDescription.get(hk).push(r);indexFuzzy(r);
    }
    // Max multiplicity across exports, not sum: one + two identical charges becomes two.
    // We retain every source locator and hold uncertain overlaps for a person.
    const candidates=new Map(),byProvider=new Map();
    for(const source of all){const occurrences=new Map();
      for(const row of source.rows){const key=tuple(row),ordinal=(occurrences.get(key)||0)+1;occurrences.set(key,ordinal);
        const sourceChoices=decisionFor('$sourceRows')||{};
        const sourceChoice=own(sourceChoices,row.sourceId+':'+row.sourceRow)?sourceChoices[row.sourceId+':'+row.sourceRow]:null;
        row.distinctSource=!!(sourceChoice&&sourceChoice.duplicate==='distinct');
        const identity=row.providerId?JSON.stringify(['provider',row.accountId,row.providerId]):row.distinctSource?JSON.stringify(['distinct-source',key,row.sourceId,row.sourceRow]):JSON.stringify(['tuple',key,ordinal]);
        const prior=candidates.get(identity);
        if(prior){
          if(row.providerId&&prior.sourceRefs.some(r=>r.fileId===source.fileId)){issue('provider-id-repeated','error','The same provider transaction ID occurs twice in one source file.','Inspect the source; do not silently merge repeated IDs.',{fileId:source.fileId,sourceRow:row.sourceRow});continue;}
          if(tuple(prior)!==key){issue('provider-id-conflict','error','One provider transaction ID has conflicting financial facts.','Inspect both source records before importing.',{fileId:source.fileId});continue;}
          prior.sourceRefs.push(...row.sourceRefs);result.counts.overlap++;result.duplicates.push({fileId:source.fileId,sourceRow:row.sourceRow,reason:'overlapping-export',rowId:prior.id});continue;
        }
        row.identity=identity;row.id='KI-'+stableID(identity);row.occurrence=ordinal;row.fingerprint=key;row.reviewState='needs-review';candidates.set(identity,row);
        if(row.providerId)byProvider.set(JSON.stringify([row.accountId,row.providerId]),row);
      }
    }
    const tupleCounts=new Map();for(const row of candidates.values()){tupleCounts.set(row.fingerprint,(tupleCounts.get(row.fingerprint)||0)+1);indexFuzzy(row);}
    const ids=new Map();
    for(const row of candidates.values()){
      if(ids.has(row.id)&&ids.get(row.id)!==row.identity){issue('identity-collision','error','Two source records produced the same identifier.','Keep this import uncommitted and contact support.');continue;}ids.set(row.id,row.identity);
      const decision=decisionFor(row.id)||decisionFor(row.description)||{};
      if(decision.duplicate==='skip'){result.excluded.push({rowId:row.id,reason:'reviewed-exclusion',sourceRefs:row.sourceRefs});continue;}
      const storedProvider=row.providerId&&existingByProvider.get(JSON.stringify([row.accountId,row.providerId]));
      if(storedProvider&&tuple(storedProvider)!==row.fingerprint){issue('provider-id-conflict','error','An existing provider transaction changed amount, date or description.','Review it as a correction; do not append it as a new transaction.',{rowIds:[row.id]});}
      const stored=(existingByTuple.get(row.fingerprint)||[]);
      // Provenance identifies the exact source row independently of its position
      // among identical charges. It remains sufficient after local decisions reset.
      const sourceMatch=stored.find(match=>match.sourceId===row.sourceId&&match.sourceRow===row.sourceRow||match.sourceRefs.some(ref=>row.sourceRefs.some(current=>ref.fileId===current.fileId&&ref.row===current.row)));
      if(sourceMatch){result.counts.existing++;result.duplicates.push({rowId:row.id,reason:'already-in-sheet',existingId:sourceMatch.id,sourceRefs:row.sourceRefs});continue;}
      const matches=storedProvider||(!row.providerId&&row.occurrence<=stored.length);
      if(row.distinctSource&&existingByID.has(row.id)){
        result.counts.existing++;result.duplicates.push({rowId:row.id,reason:'already-in-sheet',existingId:row.id,sourceRefs:row.sourceRefs});continue;
      }
      // A user's explicit extra-charge decision has a distinct, source-bound identity.
      // Replaying the SAME reviewed source must still be idempotent.
      if(matches&&decision.duplicate==='keep'&&!row.providerId){
        const extraIdentity=JSON.stringify(['reviewed-additional',row.accountId,row.sourceId,row.sourceRow,row.fingerprint]);
        const extraID='KI-'+stableID(extraIdentity);
        if(existingByID.has(extraID)){result.counts.existing++;result.duplicates.push({rowId:extraID,reason:'already-in-sheet',existingId:extraID,sourceRefs:row.sourceRefs});continue;}
        row.originalProposalID=row.id;row.id=extraID;row.identity=extraIdentity;
      }
      if(storedProvider&&decision.duplicate==='keep')issue('provider-id-existing','error','A provider transaction ID already exists in the Sheet.','A provider ID identifies one transaction; review a correction instead of forcing another copy.',{rowIds:[row.id]});
      if(matches&&decision.duplicate!=='keep'&&!row.distinctSource){
        const match=storedProvider||stored[row.occurrence-1];
        const sameSource=match.sourceId===row.sourceId&&match.sourceRow===row.sourceRow||match.sourceRefs.some(ref=>row.sourceRefs.some(current=>ref.fileId===current.fileId&&ref.row===current.row));
        if(!storedProvider&&!sameSource){
          result.counts.possibleExisting++;
          issue('existing-overlap','review','This matches an existing transaction; the proposed import excludes it.','Confirm it is already recorded, or mark it as an additional real charge. Matching date, text and amount alone cannot prove identity.',{rowIds:[row.id],fileId:row.sourceId});
          result.duplicates.push({rowId:row.id,reason:'possible-existing',existingId:match.id,sourceRefs:row.sourceRefs,candidate:Object.assign({},row)});
        }else{result.counts.existing++;result.duplicates.push({rowId:row.id,reason:'already-in-sheet',existingId:match.id,sourceRefs:row.sourceRefs});}
        continue;
      }
      function rowIssue(code,message,recovery){issue(code,'review',message,recovery,{rowIds:[row.id],fileId:row.sourceId});}
      if(row.sourceRefs.length>1&&!row.providerId)rowIssue('overlap-review','Several exports contain this same transaction.','Confirm these are overlapping exports; keep the source multiplicity shown.');
      const repeated=tupleCounts.get(row.fingerprint)>1;
      if(repeated)rowIssue('repeated-charge','There are identical charges on the same day.','Confirm both charges occurred; do not remove one merely because it looks identical.');
      if(row.distinctSource)rowIssue('distinct-source','This source row is being kept as an additional distinct transaction.','Confirm it is a separate real charge, not the same transaction in another export.');
      // duplicate:'keep' is the explicit, source-bound additional-charge decision.
      // It is not inferred from an acknowledgement of a generic review message.
      const categoryDecision=decision.categoryId||decision.category_id;
      const history=(historyByDescription.get(JSON.stringify([row.accountId,row.description]))||[]).filter(r=>r.categoryId&&r.categoryId!=='UNCAT');
      const historicCategories=[...new Set(history.map(r=>r.categoryId).filter(c=>categories.has(c)))];
      row.categoryId=str(categoryDecision||(historicCategories.length===1?historicCategories[0]:'UNCAT'));
      row.merchant=str(decision.merchant||(history.length?history[0].merchant:'')||row.description);
      row.person=str(decision.person||accounts.get(row.accountId).owner||'Joint');
      if(!categories.has(row.categoryId))issue('category-unknown','error','The selected category is absent from the Sheet.','Choose one of the current Sheet categories.',{rowIds:[row.id]});
      else if(row.categoryId==='UNCAT'&&decision.acceptUncategorised!==true)rowIssue('category-needed','Choose a category for '+row.description+'.','Select a category or explicitly keep it uncategorised for later.');
      if(historicCategories.length>1&&!categoryDecision)rowIssue('category-ambiguous','This description has several categories in your history.','Choose the category for this transaction.');
      if(input.people&& !input.people.includes(row.person))issue('person-unknown','error','The chosen person is absent from this household.','Choose a person from your household or Joint.',{rowIds:[row.id]});
      if(/\brefund\b/i.test(row.description))rowIssue('refund-review','A refund may need the original purchase category.','Confirm the refund’s category; the original purchase has not been linked.');
      // Same amount, nearby date and normalized narrative can be a changed export.
      const possible=(fuzzyCandidates.get(fuzzyKey(row))||[]).filter(r=>r.id!==row.id&&tuple(r)!==row.fingerprint&&daysApart(r.date,row.date)<=3);
      if(possible.length&&decision.duplicate!=='keep')rowIssue('changed-export','This may be an existing transaction with a changed date or description.','Compare the original records; mark it as an existing row or confirm it is new.');
      row.decision=Object.assign({},decision);result.rows.push(row);
    }
    // Transfers are only candidates. Never invent a transfer link from equal amounts.
    const transferRows=result.rows.filter(r=>['TRANSFER','CC-PAY'].includes(r.categoryId));
    const transferByAmount=new Map();for(const row of transferRows.concat(existing).filter(r=>['TRANSFER','CC-PAY'].includes(r.categoryId))){if(!transferByAmount.has(row.amountMinor))transferByAmount.set(row.amountMinor,[]);transferByAmount.get(row.amountMinor).push(row);}
    for(const row of transferRows){
      const mates=(transferByAmount.get(String(-Number(row.amountMinor)))||[]).filter(r=>r.accountId!==row.accountId&&daysApart(r.date,row.date)<=4);
      issue('transfer-review','review',mates.length?'Confirm the matching side of this transfer.':'Only one side of this transfer is present.','Review both accounts; equal amounts alone do not establish a pair.',{rowIds:[row.id],candidateIds:mates.slice(0,20).map(r=>r.id),candidateCount:mates.length});
    }
    // Review acknowledgements are evidence-bound, never broad permission for a code.
    // A change to source bytes, mapping or the current ledger invalidates old review.
    const scope=stableID(canonical({
      files:(input.files||[]).map(f=>({id:f.id,name:f.name,text:f.text,accountId:f.accountId,mapping:f.mapping,openingMinor:f.openingMinor,closingMinor:f.closingMinor})).sort((a,b)=>str(a.id).localeCompare(str(b.id))),
      existing:existing.map(r=>[r.id,r.accountId,r.date,r.description,r.amountMinor,r.categoryId]).sort((a,b)=>canonical(a).localeCompare(canonical(b))),
      categories:[...categories].sort(),currency:sheetCurrency,dateOrder:input.dateOrder||null,
      ...([...accounts.values()].some(a=>own(a,'openingDate'))?{openingDates:[...accounts.entries()].filter(([,a])=>own(a,'openingDate')).map(([id,a])=>[id,a.openingDate]).sort((a,b)=>a[0].localeCompare(b[0]))}:{})
    }));
    const requested=(decisionFor('$review')||{}).acknowledge;
    const acknowledgements=new Set(Array.isArray(requested)?requested.filter(k=>typeof k==='string'):[]);
    const active=[];
    const requiresDecision=new Set(['category-needed','category-ambiguous','existing-overlap','changed-export']);
    const proposedByID=new Map(result.rows.map(r=>[r.id,r]));
    for(const i of result.issues){
      const rowEvidence=i.rowIds.map(id=>proposedByID.get(id)).filter(Boolean).map(r=>[r.identity,r.categoryId,r.merchant,r.person,r.sourceRefs]);
      i.reviewKey=i.code+'@'+stableID(canonical({scope,code:i.code,fileId:i.fileId,sourceRow:i.sourceRow,rowIds:i.rowIds,candidates:i.candidateIds,rowEvidence}));
      i.id='issue-'+i.reviewKey;
      i.requiresDecision=requiresDecision.has(i.code);
      if(i.severity==='review'&&!i.requiresDecision&&acknowledgements.has(i.reviewKey))active.push(i.reviewKey);
    }
    result.issues=result.issues.filter(i=>i.severity!=='review'||i.requiresDecision||!acknowledgements.has(i.reviewKey));
    result.review={acknowledged:active,pending:result.issues.filter(i=>i.severity==='review').map(i=>i.reviewKey)};
    result.rows.sort((a,b)=>a.date.localeCompare(b.date)||a.accountId.localeCompare(b.accountId)||a.sourceRow-b.sourceRow);
    const unresolvedRows=new Set(result.issues.filter(i=>i.severity!=='warning').flatMap(i=>i.rowIds));
    for(const row of result.rows){row.reviewState=unresolvedRows.has(row.id)?'needs-review':'confirmed';}
    result.counts.proposed=result.rows.length;result.counts.review=result.issues.filter(i=>i.severity==='review').length;result.counts.errors=result.issues.filter(i=>i.severity==='error').length;
    result.canCommit=result.counts.errors===0&&result.counts.review===0&&result.rows.length>0;
    return result;
  }
  return {version:VERSION,parseCSV,detectFormat,money,minor,decimalAmount,strictDate,prepare};
});
