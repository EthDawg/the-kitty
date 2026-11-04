'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const I=require('./import.js');
const accounts=[{id:'A',name:'Everyday',owner:'Joint',currency:'AUD'},{id:'B',name:'Card',owner:'Joint',currency:'AUD'},{id:'C',name:'Savings',owner:'Joint',currency:'AUD'}];
const categories=['FOOD','SHOP','SALARY','UNCAT','TRANSFER','CC-PAY','INTEREST'].map(id=>({id,name:id}));
const header='Date,Description,Amount';
const mapping={confirmed:true,date:'Date',description:'Description',amount:'Amount',sign:'money-in-positive',dateOrder:'dmy'};
function file(text,more={}){return {id:'F1',name:'bank.csv',accountId:'A',text, mapping,...more};}
function prep(files,more={}){return I.prepare({files,accounts,categories,existing:[],decisions:{Coffee:{categoryId:'FOOD'},Salary:{categoryId:'SALARY'}},...more});}
function codes(p){return p.issues.map(i=>i.code);}
function one(more={}){return file(header+'\n03/02/2027,Coffee,-4.50',more);}
function acceptReviews(files,options={}){
  const p=prep(files,options);const decisions={...(options.decisions||{Coffee:{categoryId:'FOOD'},Salary:{categoryId:'SALARY'}}),$review:{acknowledge:p.issues.filter(i=>i.severity==='review').map(i=>i.reviewKey)}};
  return {proposal:prep(files,{...options,decisions}),decisions};
}

test('UMD works without Node globals (iOS JavaScriptCore contract)',()=>{
  const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'import.js'),'utf8'),context);
  assert.equal(context.KittyImport.money('12.34'), '1234');
  assert.equal(context.KittyImport.prepare({files:[]}).canCommit,false);
});
test('CSV supports BOM, CRLF, quoted commas, escaped quotes and multiline fields',()=>{
  const csv=I.parseCSV('\uFEFFDate,Description,Amount\r\n03/02/2027,"Coffee, \"\"large\"\"\nsecond line",-4.50\r\n');
  assert.equal(csv.headers[0],'Date');assert.equal(csv.records.length,1);
  assert.equal(csv.records[0].values[1],'Coffee, "large"\nsecond line');assert.equal(csv.records[0].line,2);
});
test('malformed CSV never silently drops records',()=>{
  for(const text of ['Date,Amount\n"oops,1','Date,Amount\n"ok"junk,1','Date,Amount\nA,1,extra','Date,Date\n1,2','Date,\n1,2'])assert.throws(()=>I.parseCSV(text));
});
test('empty and encoding-corrupt files have actionable errors',()=>{
  assert.throws(()=>I.parseCSV(''),/empty/);assert.throws(()=>I.parseCSV('A,B\n'),/no transactions/);
  assert.throws(()=>I.parseCSV('A,B\n\uFFFD,1'),/UTF-8/);
});
test('exact money handles signs and grouping without binary rounding',()=>{
  assert.equal(I.money('0.29'),'29');assert.equal(I.money('($1,234.56)'),'-123456');assert.equal(I.money('-$4.50'),'-450');
  assert.equal(I.decimalAmount('-1'),'-0.01');assert.equal(I.money('999999999999.99'),'99999999999999');
  for(const s of ['1.001','1e3','NaN','Infinity','1,23.00','--3','(-3)','1000000000000.00'])assert.throws(()=>I.money(s),s);
});
test('strict dates reject impossible dates and ambiguous date order',()=>{
  assert.equal(I.strictDate('29/02/2028','dmy'),'2028-02-29');assert.equal(I.strictDate('02/03/2027','mdy'),'2027-02-03');
  for(const s of ['31/02/2027','01/13/2027','29/02/2027','2027-02-30','02/03','00/01/2027'])assert.throws(()=>I.strictDate(s,'dmy'),s);
  assert.throws(()=>I.strictDate('02/03/2027'),/Confirm/);
});
test('unfamiliar CSV asks for a confirmed mapping instead of claiming success',()=>{
  const p=prep([one({mapping:undefined})]);assert.equal(p.canCommit,false);assert.ok(codes(p).includes('mapping-required'));
});
test('confirmed generic mapping requires a sign convention and date order',()=>{
  const p=prep([one({mapping:{...mapping,sign:undefined}})]);assert.ok(codes(p).includes('mapping-sign'));
  assert.ok(codes(prep([one({mapping:{...mapping,dateOrder:undefined}})])).includes('date-order'));
  assert.equal(prep([one({mapping:{...mapping,dateOrder:undefined}})],{dateOrder:'dmy'}).canCommit,true);
});
test('mapping cannot assign one column two meanings',()=>{
  assert.ok(codes(prep([one({mapping:{...mapping,description:'Amount'}})])).includes('mapping-invalid'));
});
test('unknown account and PDFs are loud failures',()=>{
  assert.ok(codes(prep([one({accountId:'not-an-account'})])).includes('account-unknown'));
  assert.ok(codes(prep([one({name:'statement.pdf'})])).includes('pdf-unsupported'));
  assert.ok(codes(prep([one({text:'%PDF-1.6\nABC'})])).includes('pdf-unsupported'));
});
test('known Harbour BOM export parses signs and running balance',()=>{
  const text='\uFEFFBank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n123,03/02/2027,Coffee,4.50,,95.50,,\n123,04/02/2027,Salary,,100.00,195.50,,';
  const p=prep([file(text,{mapping:undefined,openingMinor:'10000',closingMinor:'19550'})]);
  assert.deepEqual(p.rows.map(r=>r.amountMinor),['-450','10000']);assert.equal(p.files[0].balanceChecks,1);assert.equal(p.canCommit,true);
});
test('card charges normalize negative; payments and refunds positive',()=>{
  const text='Date,Description,Card Member,Account #,Amount\n03/02/2027,Coffee,JORDAN,-1001,4.50\n04/02/2027,Salary,JORDAN,-1001,-100.00';
  const p=prep([file(text,{mapping:undefined})]);assert.deepEqual(p.rows.map(r=>r.amountMinor),['-450','10000']);
});
test('Wattle negative debit convention is independently checked',()=>{
  const text='Date,Description,Credit,Debit,Balance\n03/02/2027,Coffee,,-4.50,95.50\n04/02/2027,Salary,100.00,,195.50';
  const p=prep([file(text,{mapping:undefined})]);assert.equal(p.canCommit,true);
  assert.ok(codes(prep([file(text.replace(',-4.50,',',4.50,'),{mapping:undefined})])).includes('amount-sign'));
});
test('wrong account suffix and multiple account numbers cannot proceed',()=>{
  const text='Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n123,03/02/2027,Coffee,4.50,,95.50,,\n124,04/02/2027,Salary,,100.00,195.50,,';
  assert.ok(codes(prep([file(text,{mapping:undefined})])).includes('multiple-accounts'));
  assert.ok(codes(prep([file(text,{mapping:undefined})],{accounts:[{id:'A',numberSuffix:'999'}]})).includes('account-mismatch'));
});
test('running balance mismatch blocks before any write',()=>{
  const text='Date,Description,Credit,Debit,Balance\n03/02/2027,Coffee,,-4.50,95.50\n04/02/2027,Salary,100.00,,196.50';
  const p=prep([file(text,{mapping:undefined})]);assert.ok(codes(p).includes('balance-mismatch'));assert.equal(p.canCommit,false);
});
test('descending exports and same-day reverse balance order reconcile',()=>{
  const text='Date,Description,Credit,Debit,Balance\n04/02/2027,Salary,100.00,,195.50\n03/02/2027,Coffee,,-4.50,95.50';
  assert.equal(prep([file(text,{mapping:undefined})]).canCommit,true);
  assert.equal(prep([file(text.replace('03/02/2027','04/02/2027'),{mapping:undefined})]).canCommit,true);
});
test('source statement opening and closing reconciliation is independent',()=>{
  const p=prep([one({openingMinor:'10000',closingMinor:'9550'})]);assert.equal(p.files[0].balanceChecks,1);
  assert.ok(codes(prep([one({openingMinor:'10000',closingMinor:'9999'})])).includes('closing-mismatch'));
});
test('pending rows are excluded while unknown status blocks',()=>{
  const text=header+',Status\n03/02/2027,Coffee,-4.50,Pending\n04/02/2027,Salary,100.00,Posted';
  const p=prep([file(text,{mapping:{...mapping,status:'Status'}})]);
  assert.equal(p.rows.length,1);assert.equal(p.counts.pending,1);assert.equal(p.canCommit,true);
  assert.ok(codes(prep([file(text.replace('Pending','something'),{mapping:{...mapping,status:'Status'}})])).includes('status-unknown'));
});
test('same exact file selected twice is read only once',()=>{
  const p=prep([one(),one({id:'another'})]);assert.equal(p.rows.length,1);assert.equal(p.duplicates[0].reason,'same-file');assert.equal(p.canCommit,true);
});
test('same source identifier with different bytes is blocked',()=>{
  const p=prep([one(),one({text:header+'\n04/02/2027,Salary,10.00'})]);assert.ok(codes(p).includes('source-id-conflict'));
});
test('reimport compared with fresh Sheet adds zero rows',()=>{
  const p=prep([one()]);const again=prep([one()],{existing:p.rows});
  assert.equal(again.rows.length,0);assert.equal(again.counts.existing,1);assert.equal(again.counts.errors,0);
});
test('overlapping exports use maximum multiplicity, preserving legitimate repeated charges',()=>{
  const p=prep([one(),one({id:'F2',text:header+'\n03/02/2027,Coffee,-4.50\n03/02/2027,Coffee,-4.50'})]);
  assert.equal(p.rows.length,2);assert.equal(p.counts.overlap,1);assert.ok(codes(p).includes('overlap-review'));assert.ok(codes(p).includes('repeated-charge'));
  assert.equal(p.rows[0].sourceRefs.length,2);assert.notEqual(p.rows[0].id,p.rows[1].id);
});
test('same-day identical charges within a single export remain distinct',()=>{
  const p=prep([one({text:header+'\n03/02/2027,Coffee,-4.50\n03/02/2027,Coffee,-4.50'})]);assert.equal(p.rows.length,2);
  assert.ok(p.rows.every(r=>r.reviewState==='needs-review'));
});
test('reviewed overlaps and repeats become a commit-ready proposal',()=>{
  const files=[one(),one({id:'F2',text:header+'\n03/02/2027,Coffee,-4.50\n03/02/2027,Coffee,-4.50'})];
  const {proposal:p,decisions}=acceptReviews(files);
  assert.equal(p.canCommit,true);assert.equal(p.rows.length,2);
  const again=prep(files,{existing:p.rows,decisions});assert.equal(again.rows.length,0);assert.equal(again.counts.existing,2);
});
test('category changes do not alter source identity',()=>{
  const a=prep([one()]);const b=prep([one()],{decisions:{Coffee:{categoryId:'SHOP'}}});
  assert.equal(a.rows[0].id,b.rows[0].id);assert.equal(a.rows[0].identity,b.rows[0].identity);
});
test('explicit additional identical charge has its own replay-safe source identity',()=>{
  const old=prep([one()]).rows[0];const fresh=one({id:'new-file'});
  const {proposal:p,decisions}=acceptReviews([fresh],{existing:[old],decisions:{Coffee:{categoryId:'FOOD',duplicate:'keep'}}});assert.equal(p.rows.length,1);assert.notEqual(p.rows[0].id,old.id);assert.equal(p.canCommit,true);
  const replay=prep([fresh],{existing:[old,...p.rows],decisions});assert.equal(replay.rows.length,0);assert.equal(replay.counts.existing,1);
});
test('unfamiliar merchant asks for category; explicit uncategorised is supported',()=>{
  const f=one({text:header+'\n03/02/2027,Mystery,-4.50'});
  assert.ok(codes(prep([f])).includes('category-needed'));
  assert.equal(prep([f],{decisions:{Mystery:{acceptUncategorised:true}}}).canCommit,true);
  assert.equal(prep([f],{decisions:{Mystery:{categoryId:'absent'}}}).canCommit,false);
});
test('ambiguous categorisation is held instead of choosing a majority',()=>{
  const existing=[{id:'T1',date:'2027-01-01',accountId:'A',description:'Coffee',amountMinor:'-450',categoryId:'FOOD'},{id:'T2',date:'2027-01-03',accountId:'A',description:'Coffee',amountMinor:'-450',categoryId:'SHOP'}];
  const p=prep([one()],{existing,decisions:{}});assert.ok(codes(p).includes('category-ambiguous'));assert.equal(p.rows[0].categoryId,'UNCAT');
});
test('changed text or settlement date is held as a possible duplicate',()=>{
  const old={id:'T1',date:'2027-02-02',accountId:'A',description:'Coffee REF 123',amountMinor:'-450',categoryId:'FOOD'};
  const f=one({text:header+'\n03/02/2027,Coffee REF 124,-4.50'});
  const p=prep([f],{existing:[old],decisions:{'Coffee REF 124':{categoryId:'FOOD'}}});assert.ok(codes(p).includes('changed-export'));
  assert.equal(prep([f],{existing:[old],decisions:{'Coffee REF 124':{categoryId:'FOOD',duplicate:'skip'}}}).rows.length,0);
});
test('changed descriptions across two uncommitted files are also held',()=>{
  const p=prep([one({text:header+'\n03/02/2027,Coffee REF 123,-4.50'}),one({id:'F2',text:header+'\n03/02/2027,Coffee REF 124,-4.50'})]);
  assert.equal(p.issues.filter(i=>i.code==='changed-export').length,2);
});
test('refund does not inherit certainty about the original purchase',()=>{
  const f=one({text:header+'\n03/02/2027,Coffee REFUND,4.50'});
  assert.ok(codes(prep([f],{decisions:{'Coffee REFUND':{categoryId:'FOOD'}}})).includes('refund-review'));
});
test('unpaired transfers and candidate pairs both require deliberate review',()=>{
  const f=one({text:header+'\n03/02/2027,Transfer,-50.00'});
  const p=prep([f],{decisions:{Transfer:{categoryId:'TRANSFER'}}});assert.ok(codes(p).includes('transfer-review'));assert.match(p.issues.find(i=>i.code==='transfer-review').message,/one side/);
  const paired=prep([f,one({id:'F2',accountId:'C',text:header+'\n03/02/2027,Transfer,50.00'})],{decisions:{Transfer:{categoryId:'TRANSFER'}}});
  assert.equal(paired.issues.filter(i=>i.code==='transfer-review').length,2);assert.ok(paired.issues.filter(i=>i.code==='transfer-review').every(i=>i.candidateIds.length===1));
});
test('provider IDs preserve transaction identity and conflicts block',()=>{
  const m={...mapping,providerId:'ID'};const text=header+',ID\n03/02/2027,Coffee,-4.50,P-1';
  const p=prep([file(text,{mapping:m})]);assert.equal(p.canCommit,true);
  const conflict=prep([file(text,{mapping:m}),file(text.replace('-4.50','-4.51'),{id:'F2',mapping:m})]);assert.ok(codes(conflict).includes('provider-id-conflict'));
  const repeated=prep([file(text+'\n03/02/2027,Coffee,-4.50,P-1',{mapping:m})]);assert.ok(codes(repeated).includes('provider-id-repeated'));
});
test('invalid existing ledger rows prevent committing against a corrupt baseline',()=>{
  const p=prep([one()],{existing:[{id:'T1',date:'2027-02-30',accountId:'A',description:'Coffee',amountMinor:'-450'}]});assert.ok(codes(p).includes('existing-invalid'));assert.equal(p.canCommit,false);
});
test('source narratives remain literal even if spreadsheet formula-like',()=>{
  const p=prep([one({text:header+'\n03/02/2027,=1+1,-4.50'})],{decisions:{'=1+1':{categoryId:'FOOD'}}});assert.equal(p.rows[0].description,'=1+1');
  // The writer must use RAW or typed stringValue. Import core never evaluates text.
});
test('realistic synthetic portal fixtures account for every row and exact movement',()=>{
  const root=path.join(__dirname,'../demo-portals/fixtures');const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  const ids={harbour:'A',southern:'B',wattle:'C'};
  const files=manifest.core.map(m=>file(fs.readFileSync(path.join(root,m.file),'utf8'),{id:m.id,name:path.basename(m.file),accountId:ids[m.id],mapping:undefined,openingMinor:String(m.opening_minor),closingMinor:String(m.closing_minor)}));
  const p=prep(files,{decisions:{}});
  assert.equal(p.counts.source,13);assert.equal(p.counts.parsed,13);assert.equal(p.rows.length,13);assert.equal(p.counts.errors,0);
  const sum=p.rows.reduce((s,r)=>s+Number(r.amountMinor),0);assert.equal(sum,manifest.core.reduce((s,m)=>s+m.closing_minor-m.opening_minor,0));
  const choices={};for(const r of p.rows)choices[r.id]={categoryId:'FOOD'};
  const {proposal:reviewed,decisions}=acceptReviews(files,{decisions:choices});assert.equal(reviewed.canCommit,true);
  const repeat=prep(files,{existing:reviewed.rows,decisions});assert.equal(repeat.rows.length,0);assert.equal(repeat.counts.errors,0);
});
test('persisted review keys remain stable instead of approval flapping',()=>{
  const files=[one({text:header+'\n03/02/2027,Coffee,-4.50\n03/02/2027,Coffee,-4.50'})];
  const {proposal,decisions}=acceptReviews(files);assert.equal(proposal.canCommit,true);
  assert.equal(prep(files,{decisions}).canCommit,true);assert.deepEqual(prep(files,{decisions}).review.acknowledged,proposal.review.acknowledged);
});
test('broad acknowledgement codes grant no approval',()=>{
  const files=[one({text:header+'\n03/02/2027,Coffee,-4.50\n03/02/2027,Coffee,-4.50'})];
  const p=prep(files,{decisions:{Coffee:{categoryId:'FOOD',acknowledge:['repeated-charge']},$review:{acknowledge:['repeated-charge']}}});
  assert.equal(p.canCommit,false);assert.ok(codes(p).includes('repeated-charge'));
});
test('source or baseline changes invalidate old acknowledgements',()=>{
  const files=[one({text:header+'\n03/02/2027,Coffee,-4.50\n03/02/2027,Coffee,-4.50'})];
  const {decisions}=acceptReviews(files);
  const changed=[{...files[0],text:files[0].text+'\n04/02/2027,Salary,100.00'}];assert.equal(prep(changed,{decisions}).canCommit,false);
  const existing=[{id:'T9',date:'2027-01-01',accountId:'A',description:'Salary',amountMinor:'10000',categoryId:'SALARY'}];
  assert.equal(prep(files,{existing,decisions}).canCommit,false);
});
test('changed category cannot reuse an acknowledgement of different row meaning',()=>{
  const files=[one({text:header+'\n03/02/2027,Coffee,-4.50\n03/02/2027,Coffee,-4.50'})];
  const {decisions}=acceptReviews(files);const changed={...decisions,Coffee:{categoryId:'SHOP'}};
  assert.equal(prep(files,{decisions:changed}).canCommit,false);
});
test('disjoint identical same-day exports are held; explicit additional charge survives',()=>{
  const old=prep([one()]).rows[0];
  // Distinct underlying charges cannot be inferred from equal date/text/amount alone.
  // The conservative default proposes excluding the match, with explicit review.
  const fresh=one({id:'second-statement'});
  const raw=prep([fresh],{existing:[old]});assert.equal(raw.rows.length,0);assert.ok(codes(raw).includes('existing-overlap'));assert.equal(raw.counts.existing,0);assert.equal(raw.counts.possibleExisting,1);
  const {proposal}=acceptReviews([fresh],{existing:[old],decisions:{Coffee:{categoryId:'FOOD',duplicate:'keep'}}});
  assert.equal(proposal.rows.length,1);assert.notEqual(proposal.rows[0].id,old.id);
});
test('legacy Sheet tuple match is never claimed as proof of transaction identity',()=>{
  const old={id:'T1',date:'2027-02-03',accountId:'A',description:'Coffee',amountMinor:'-450',categoryId:'FOOD'};
  const p=prep([one()],{existing:[old]});assert.ok(codes(p).includes('existing-overlap'));assert.equal(p.duplicates[0].reason,'possible-existing');
  assert.equal(p.duplicates[0].candidate.description,'Coffee');
});
test('a reviewed disjoint same-day source row can be preserved independently of max overlap',()=>{
  const files=[one(),one({id:'F2',text:header+'\n03/02/2027,Coffee,-4.50\n04/02/2027,Salary,100.00'})];
  const ordinary=prep(files);assert.equal(ordinary.rows.filter(r=>r.description==='Coffee').length,1);assert.ok(codes(ordinary).includes('overlap-review'));
  const choices={Coffee:{categoryId:'FOOD'},Salary:{categoryId:'SALARY'},$sourceRows:{'F2:2':{duplicate:'distinct'}}};
  const {proposal:p,decisions}=acceptReviews(files,{decisions:choices});assert.equal(p.rows.filter(r=>r.description==='Coffee').length,2);assert.equal(p.canCommit,true);
  const again=prep(files,{decisions,existing:p.rows});assert.equal(again.rows.length,0);
});
test('acknowledging a category issue cannot replace an explicit category decision',()=>{
  const files=[one({text:header+'\n03/02/2027,Unknown,-4.50'})];
  const first=prep(files);const tried=prep(files,{decisions:{$review:{acknowledge:first.review.pending}}});
  assert.equal(tried.canCommit,false);assert.ok(codes(tried).includes('category-needed'));
  const chosen=prep(files,{decisions:{Unknown:{categoryId:'UNCAT',acceptUncategorised:true}}});assert.equal(chosen.canCommit,true);
});
test('acknowledgement cannot silently exclude a possible existing charge',()=>{
  const files=[one()];const old={id:'T1',date:'2027-02-03',accountId:'A',description:'Coffee',amountMinor:'-450',categoryId:'FOOD'};
  const first=prep(files,{existing:[old]});const tried=prep(files,{existing:[old],decisions:{$review:{acknowledge:first.review.pending}}});
  assert.ok(codes(tried).includes('existing-overlap'));
});
test('generic mapping cannot silently drop a supplied posting-status column',()=>{
  const p=prep([file(header+',Status\n03/02/2027,Coffee,-4.50,Pending')]);
  assert.ok(codes(p).includes('mapping-status-required'));assert.equal(p.canCommit,false);
});
test('exact source replay of an additional identical charge does not require old local decisions',()=>{
  const old={id:'T1',date:'2027-02-03',accountId:'A',description:'Coffee',amountMinor:'-450',categoryId:'FOOD'};
  const files=[one()];
  const reviewed=prep(files,{existing:[old],decisions:{Coffee:{categoryId:'FOOD',duplicate:'keep'}}});
  assert.equal(reviewed.canCommit,true);
  const replay=prep(files,{existing:[old,...reviewed.rows],decisions:{}});
  assert.equal(replay.rows.length,0);assert.equal(replay.counts.existing,1);assert.equal(replay.counts.possibleExisting,0);
});
test('source replay finds the correct occurrence after identical ledger rows reorder',()=>{
  const files=[one({text:header+'\n03/02/2027,Coffee,-4.50\n03/02/2027,Coffee,-4.50'})];
  const reviewed=acceptReviews(files).proposal;
  const replay=prep(files,{existing:reviewed.rows.slice().reverse(),decisions:{}});
  assert.equal(replay.rows.length,0);assert.equal(replay.counts.existing,2);assert.equal(replay.counts.possibleExisting,0);
});
test('unsupported zero- and three-decimal currencies never become cents',()=>{
  for(const currency of ['JPY','KWD']){
    const selected=prep([one()],{accounts:[{id:'A',name:'Unsupported scale',currency}]});
    assert.equal(selected.canCommit,false);assert.equal(selected.rows.length,0);assert.ok(codes(selected).includes('currency-unsupported'));
    const household=prep([one()],{currency});assert.equal(household.canCommit,false);assert.ok(codes(household).includes('currency-unsupported'));
  }
});
test('supported two-decimal household works but mixed-currency amounts are refused',()=>{
  const usd=[{id:'A',name:'Everyday',currency:'USD'}];
  const p=prep([one()],{accounts:usd,currency:'USD'});assert.equal(p.canCommit,true);assert.equal(p.rows[0].currency,'USD');
  const mixed=prep([one()],{accounts:usd,currency:'AUD'});assert.equal(mixed.rows.length,0);assert.ok(codes(mixed).includes('currency-mismatch'));
});
