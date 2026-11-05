const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Close=require('./close.js');
const R=require('./records.js');
const C=require('./sheet-contract.js');
const Import=require('./import.js');
const copy=value=>JSON.parse(JSON.stringify(value));
function record(kind,fields,id){
  return {kind,recordId:id,fields,sourceRefs:[{id:'s1',fileId:'a'.repeat(64),page:1,basis:kind==='payslip'?'current-period':kind==='valuation'?'valuation':'statement-close'}],extraction:{method:'manual',version:'1'},confirmedFields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{value:copy(value),sourceRefIds:['s1']}]))};
}
function fixture(){
  const p=record('payslip',{payDate:'2027-02-10',person:'Alex',employer:'Example',currency:'AUD',valueBasis:'current-period',grossMinor:'100000',taxMinor:'20000',superMinor:'12000',netMinor:'80000'},'pay-1');
  const v=record('valuation',{date:'2027-02-28',itemId:'HOME',currency:'AUD',valueKind:'asset',valueMinor:'20000000'},'value-1');
  const tx=(id,accountId,amountMinor,categoryId,person='Joint',transferGroup='')=>({id,accountId,amountMinor,categoryId,person,transferGroup,date:'2027-02-10',status:'posted'});
  const accounts=[['A','1000000'],['B','50000'],['C','20000']].map(([id,openingMinor])=>({id,currency:'AUD',ledger:true,openingMinor,openingDate:'2027-01-31',status:'active'}));
  const statements=[['A','1000000','1065000'],['B','50000','60000'],['C','20000','20000']].map(([accountId,openingMinor,closingMinor])=>record('statement_balance',{accountId,openingMinor,closingMinor,periodStart:'2027-02-01',periodEnd:'2027-02-28',currency:'AUD',balanceKind:'statement-close',balanceConvention:'money-in-positive'},'statement-'+accountId));
  return {periodEnd:'2027-02-28',baseline:{schemaVersion:2,currency:'AUD',asOf:'2027-01-31',accounts,people:['Alex'],items:[{id:'HOME',currency:'AUD',kind:'asset',method:'estimate',valuationRequired:true}],transactions:[tx('salary','A','80000','SALARY','Alex'),tx('out','A','-10000','TRANSFER','Joint','pair-1'),tx('in','B','10000','TRANSFER','Joint','pair-1'),tx('spend','A','-5000','FOOD')],payslips:[{kind:'payslip',recordId:'sheet-pay',fields:copy(p.fields)}],valuations:[{kind:'valuation',recordId:'sheet-value',fields:copy(v.fields)}],projectedBalances:statements.map(row=>({accountId:row.fields.accountId,date:'2027-02-28',amountMinor:row.fields.closingMinor})),checks:[{id:'Close inputs',type:'Close',status:'OK',items:0}],unresolvedReviews:[]},evidence:{imports:[{importId:'accepted-one',proposalDigest:'b'.repeat(64),receiptVerified:true,records:[p,v,...statements]}]},review:{}};
}
const codes=result=>result.issues.map(row=>row.code);
function changeField(row,key,value){row.fields[key]=value;row.confirmedFields[key].value=copy(value);}
const evidence=input=>input.evidence.imports[0].records;
function acknowledge(result,input){for(const issue of result.issues.filter(row=>row.severity==='review')){input.review.decisions=input.review.decisions||{};input.review.decisions[issue.id]={action:'acknowledge',reason:'Reviewed this exact recorded item.',recordIds:issue.recordIds,evidenceKey:issue.evidenceKey};}}

test('complete account, pay, valuation and paired-transfer proofs permit preflight, not a verified close',()=>{
  const result=Close.prepare(fixture());assert.equal(result.canClose,true,JSON.stringify(result.issues));assert.equal(result.expectedAsOf,'2027-01-31');assert.equal(result.targetAsOf,'2027-02-28');assert.equal(result.postCloseRequired,true);assert.equal(result.issues.length,0);
});
test('month close cannot skip periods or claim a partial month as a full close',()=>{
  const input=fixture();input.periodEnd='2027-03-31';assert.ok(codes(Close.prepare(input)).includes('close-sequence'));
  input.periodEnd='2027-02-27';assert.ok(codes(Close.prepare(input)).includes('close-period'));
  input.periodEnd='2027-02-28';input.baseline.asOf='2027-01-15';assert.ok(codes(Close.prepare(input)).includes('close-as-of'));
});
test('a no-activity account still requires original statement evidence',()=>{
  const input=fixture();input.evidence.imports[0].records=evidence(input).filter(row=>row.recordId!=='statement-C');
  const result=Close.prepare(input);assert.equal(result.canClose,false);assert.ok(result.issues.some(row=>row.code==='account-statement'&&row.recordIds.includes('C')));
});
test('statement opening, posted movement, closing and canonical projection all have to agree exactly',()=>{
  const input=fixture();changeField(evidence(input).find(row=>row.recordId==='statement-A'),'closingMinor','1065001');
  const result=Close.prepare(input);assert.ok(codes(result).includes('statement-movement'));assert.ok(codes(result).includes('statement-canonical'));
  const badProjection=fixture();badProjection.baseline.projectedBalances[0].amountMinor='1065001';assert.ok(codes(Close.prepare(badProjection)).includes('balance-projection'));
  const opening=fixture();changeField(evidence(opening).find(row=>row.recordId==='statement-A'),'openingMinor','999999');assert.ok(codes(Close.prepare(opening)).includes('statement-opening'));
});
test('missing target-date projection is unresolved even when account snapshot happens to match',()=>{
  const input=fixture();input.baseline.projectedBalances=[];input.baseline.accounts[0].balanceMinor='1065000';
  assert.ok(codes(Close.prepare(input)).includes('balance-projection'));
});
test('a split salary requires an explicit exact group and each payslip can be used only once',()=>{
  const input=fixture(),salary=input.baseline.transactions[0];salary.amountMinor='30000';input.baseline.transactions.push({...salary,id:'salary-2',amountMinor:'50000'});
  assert.equal(Close.prepare(input).canClose,false);
  input.review.salaryMatches=[{payslipRecordIds:['pay-1'],transactionIds:['salary','salary-2'],reason:'This payslip was split across two deposits.'}];
  assert.equal(Close.prepare(input).canClose,true,JSON.stringify(Close.prepare(input).issues));
  input.review.salaryMatches.push(copy(input.review.salaryMatches[0]));assert.ok(codes(Close.prepare(input)).includes('salary-match'));
});
test('salary timing needs an explicit timing decision; amount-only matching is insufficient',()=>{
  const input=fixture();input.baseline.transactions[0].date='2027-02-11';assert.equal(Close.prepare(input).canClose,false);
  input.review.salaryMatches=[{payslipRecordIds:['sheet-pay'],transactionIds:['salary'],reason:'Bank posting was one day after pay date.'}];assert.equal(Close.prepare(input).canClose,false);
  input.review.salaryMatches[0].allowTiming=true;assert.equal(Close.prepare(input).canClose,true,JSON.stringify(Close.prepare(input).issues));
});
test('current payslip A:G can be reconciled using evidenced deductions retained in the receipt',()=>{
  const input=fixture(),pay=evidence(input)[0];pay.fields.deductions=[{label:'Union fee',amountMinor:'500'}];pay.fields.reimbursements=[{label:'Travel',amountMinor:'500'}];
  pay.confirmedFields.deductions={value:copy(pay.fields.deductions),sourceRefIds:['s1']};pay.confirmedFields.reimbursements={value:copy(pay.fields.reimbursements),sourceRefIds:['s1']};
  assert.equal(Close.prepare(input).canClose,true);
  // A true net difference is also supported while the raw A:G values remain exact.
  changeField(pay,'netMinor','79500');pay.fields.reimbursements=[];pay.confirmedFields.reimbursements.value=[];
  input.baseline.payslips[0].fields.netMinor='79500';input.baseline.transactions[0].amountMinor='79500';input.baseline.projectedBalances[0].amountMinor='1064500';changeField(evidence(input).find(row=>row.recordId==='statement-A'),'closingMinor','1064500');
  assert.equal(Close.prepare(input).canClose,true,JSON.stringify(Close.prepare(input).issues));
});
test('a global transfer total of zero never proves the actual pairs',()=>{
  const input=fixture();for(const tx of input.baseline.transactions)tx.transferGroup='';
  assert.ok(codes(Close.prepare(input)).includes('transfer-covered'));
  input.review.transferPairs=[{transactionIds:['out','in'],reason:'Reviewed both matching bank transfer records.'}];assert.equal(Close.prepare(input).canClose,true);
  input.baseline.transactions[2].accountId='A';assert.ok(codes(Close.prepare(input)).includes('transfer-pair'));
});
test('conflicting transfer group identities cannot be overridden by a convenient opposite amount',()=>{
  const input=fixture();input.baseline.transactions[2].transferGroup='different';input.review.transferPairs=[{transactionIds:['out','in'],reason:'Trying to override the existing different pair.'}];
  assert.ok(codes(Close.prepare(input)).includes('transfer-pair'));
});
test('required valuation proof must exist at the close date and still match the raw Sheet',()=>{
  const input=fixture();input.evidence.imports[0].records=evidence(input).filter(row=>row.kind!=='valuation');assert.ok(codes(Close.prepare(input)).includes('valuation-evidence'));
  const changed=fixture();changed.baseline.valuations[0].fields.valueMinor='20000001';assert.ok(codes(Close.prepare(changed)).includes('evidence-current'));
  const conflict=fixture();conflict.baseline.valuations.push(copy(conflict.baseline.valuations[0]));assert.ok(codes(Close.prepare(conflict)).includes('current-valuation'));
});
test('specific unresolved reviews are bound to the actual facts and cannot be blanket acknowledged',()=>{
  const input=fixture();input.baseline.transactions[3].categoryId='UNCAT';input.review.acknowledged=['all'];
  const first=Close.prepare(input);assert.equal(first.canClose,false);acknowledge(first,input);assert.equal(Close.prepare(input).canClose,true);
  input.baseline.transactions[3].person='Alex';assert.equal(Close.prepare(input).canClose,false);
});
test('failing Close/unknown-ID checks cannot be waived, other recorded reviews remain explicit',()=>{
  const input=fixture();input.baseline.checks[0].status='Review';input.baseline.checks[0].items=1;acknowledge(Close.prepare(input),input);assert.ok(codes(Close.prepare(input)).includes('sheet-check'));
  const tax=fixture();tax.baseline.checks.push({id:'Tax receipt',type:'Tax',status:'Review',items:1,message:'Review recorded missing receipt.'});
  const initial=Close.prepare(tax);assert.ok(codes(initial).includes('sheet-review'));acknowledge(initial,tax);assert.equal(Close.prepare(tax).canClose,true);
});
test('unverified receipts, stale field confirmation and missing recorded Close checks remain unresolved',()=>{
  const input=fixture();input.evidence.imports[0].receiptVerified=false;assert.ok(codes(Close.prepare(input)).includes('accepted-receipt'));
  const tamper=fixture();evidence(tamper)[0].fields.employer='Edited after approval';assert.ok(codes(Close.prepare(tamper)).includes('confirmation-stale'));
  const empty=fixture();empty.baseline.checks=[];assert.ok(codes(Close.prepare(empty)).includes('close-check-scope'));
});
test('an OK label with missing or null Close count cannot authorize an As-of change',()=>{
  for(const value of [undefined,null,'0']){
    const input=fixture();input.baseline.checks[0].items=value;
    const result=Close.prepare(input);assert.equal(result.canClose,false);assert.ok(result.issues.some(row=>['sheet-check','sheet-check-definition'].includes(row.code)));
  }
});
test('malformed input fails closed and repeated prepare is deterministic without mutating inputs',()=>{
  for(const input of [null,{},fixture()]){const before=copy(input),result=Close.prepare(input);assert.deepEqual(input,before);assert.deepEqual(Close.prepare(input),result);}
  const bad=fixture();bad.evidence.imports[0].records=[null];assert.equal(Close.prepare(bad).canClose,false);
  const empty=fixture();empty.baseline.accounts=[];assert.equal(Close.prepare(empty).canClose,false);
});
test('the existing December/January fiction cannot silently close without statement and pair evidence',()=>{
  const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/snapshot-v2.json')));
  for(const [month,previous] of [['2026-12','2026-11-30'],['2027-01','2026-12-31']]){
    const periodEnd=month+'-31',records=[],b={schemaVersion:2,currency:'AUD',asOf:previous,people:['Jordan','Mia'],accounts:[],items:[],transactions:[],payslips:[],valuations:[],checks:[{id:'Raw fixture close',type:'Close',status:'OK',items:0}],unresolvedReviews:[],projectedBalances:[]};
    b.accounts=snapshot.accounts.filter(row=>row.valuation_method==='ledger').map(row=>({id:row.account_id,currency:'AUD',ledger:true,status:'active',openingDate:row.opening_date,openingMinor:Import.money(row.opening_balance.toFixed(2))}));
    b.items=snapshot.assets.map(row=>({id:row.item_id,currency:'AUD',kind:row.class==='Loans'?'liability':'asset',method:row.class==='Loans'?'statement':'estimate'}));
    b.transactions=snapshot.entries.filter(row=>row.kind==='transaction'&&row.settled_at<=periodEnd).map(row=>({id:row.entry_id,date:row.settled_at,accountId:row.account_id,amountMinor:Import.money(Number(row.amount).toFixed(2)),categoryId:row.category_id,person:row.person,status:'posted',transferGroup:''}));
    b.projectedBalances=b.accounts.map(account=>({accountId:account.id,date:periodEnd,amountMinor:C.sumMinor([account.openingMinor,...b.transactions.filter(row=>row.accountId===account.id).map(row=>row.amountMinor)])}));
    for(const type of ['payslips','valuations']){
      const csv=Import.parseCSV(fs.readFileSync(path.join(__dirname,'../../period-close',month,type+'.csv'),'utf8'));
      for(const [i,row] of csv.records.entries()){
        const v=row.values,f=type==='payslips'?{payDate:v[0],person:v[1],employer:v[2],grossMinor:Import.money(v[3]),taxMinor:Import.money(v[4]),superMinor:Import.money(v[5]),netMinor:Import.money(v[6]),currency:'AUD',valueBasis:'current-period'}:{date:v[0],itemId:v[1],valueMinor:Import.money(v[2]),currency:'AUD',valueKind:v[1].startsWith('LN-')?'liability':'asset'};
        const r=record(type==='payslips'?'payslip':'valuation',f,type+'-'+i);records.push(r);b[type].push({kind:r.kind,recordId:'raw-'+r.recordId,fields:copy(f)});
      }
    }
    const input={periodEnd,baseline:b,evidence:{imports:[{importId:'fixture-'+month,proposalDigest:'c'.repeat(64),receiptVerified:true,records}]}};
    const result=Close.prepare(input);assert.equal(result.canClose,false);
    const missing=result.issues.filter(row=>row.code==='account-statement');assert.equal(missing.length,6);assert.ok(missing.some(row=>row.recordIds.includes('ACC-OFF')));
    assert.ok(result.issues.some(row=>row.code==='transfer-covered'));
    assert.ok(!result.issues.some(row=>row.code==='payslip-salary-covered'),JSON.stringify(result.issues));
    assert.ok(!result.issues.some(row=>row.code==='valuation-evidence'),JSON.stringify(result.issues));
  }
});
