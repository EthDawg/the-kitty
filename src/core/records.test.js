const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const C=require('./sheet-contract.js');
const R=require('./records.js');
const Import=require('./import.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const source={id:'a'.repeat(64),name:'example.pdf',mimeType:'application/pdf',byteLength:100};
const baseline=()=>({schemaVersion:2,currency:'AUD',people:['Alex'],accounts:[{id:'A',currency:'AUD',ledger:true}],items:[{id:'HOME',kind:'asset',currency:'AUD',method:'appraisal'},{id:'LOAN',kind:'liability',currency:'AUD',method:'statement'}],payslips:[],valuations:[]});
function record(kind,fields,id='record-1'){
  const basis=kind==='payslip'?'current-period':kind==='valuation'?'valuation':'statement-close';
  return {kind,recordId:id,fields,sourceRefs:[{id:'s1',fileId:source.id,page:1,bbox:[0,0,1,1],basis}],extraction:{method:'manual',version:'1'},confirmedFields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{value:copy(value),sourceRefIds:['s1']}]))};
}
const pay=()=>record('payslip',{payDate:'2027-02-10',person:'Alex',employer:'Example employer',currency:'AUD',valueBasis:'current-period',grossMinor:'100000',taxMinor:'20000',superMinor:'12000',netMinor:'80000'});
const value=(amount='20000000')=>record('valuation',{date:'2027-02-28',itemId:'HOME',currency:'AUD',valueKind:'asset',valueMinor:amount});
const prepare=(records,extra={})=>R.prepare({files:[source],records,baseline:baseline(),...extra});
const codes=result=>result.issues.map(row=>row.code);

test('contract explicitly separates raw cells, helper formulas and v2 valuation view',()=>{
  assert.throws(()=>C.describe(1),{code:'unsupported-schema'});
  assert.equal(C.describe(2).rawTargets.payslip.metadata.column,'I');
  const v2=C.describe(2);assert.equal(v2.rawTargets.valuation.tab,'Entries');assert.equal(v2.rawTargets.valuation.kind,'valuation');assert.equal(v2.rawTargets.valuation.idPrefix,'V');
  assert.ok(v2.formulaRanges.some(row=>row.tab==='Valuations'&&row.view));assert.equal(v2.rawTargets.statement_balance,null);
  v2.rawTargets.payslip.headers[0]='mutated';assert.equal(C.describe(2).rawTargets.payslip.headers[0],'Pay date');
  assert.throws(()=>C.describe(3),{code:'unsupported-schema'});assert.throws(()=>C.describe('2'),{code:'unsupported-schema'});
});
test('exact minor units reject fractional, numeric, noncanonical and overflow values',()=>{
  for(const invalid of [0,1.25,'01','-0','1.2','1e2','100000000000000'])assert.throws(()=>C.minor(invalid));
  assert.equal(C.sumMinor(['99999999999998','1']),'99999999999999');
  assert.throws(()=>C.sumMinor(['99999999999999','1']));assert.equal(C.decimalAmount('-101'),'-1.01');
});
test('employer super stays separate from net pay',()=>{
  const result=prepare([pay()]);assert.equal(result.canCommit,true);assert.equal(result.counts.new,1);assert.equal(result.records[0].fields.superMinor,'12000');
  const wrong=pay();wrong.fields.netMinor='68000';wrong.confirmedFields.netMinor.value='68000';
  assert.ok(codes(prepare([wrong])).includes('payslip-net-mismatch'));
});
test('evidenced deductions and reimbursements permit genuine nonstandard net pay',()=>{
  const fields={...pay().fields,deductions:[{label:'Union fee',amountMinor:'500'}],reimbursements:[{label:'Travel reimbursement',amountMinor:'1250'}],netMinor:'80750'};
  assert.equal(prepare([record('payslip',fields)]).canCommit,true);
  fields.deductions[0].amountMinor='-500';assert.ok(codes(prepare([record('payslip',fields)])).includes('payslip-adjustments'));
});
test('YTD cannot be silently used as current-period pay',()=>{
  const row=pay();row.sourceRefs[0].basis='ytd';assert.ok(codes(prepare([row])).includes('payslip-basis'));
  row.fields.valueBasis='ytd';row.confirmedFields.valueBasis.value='ytd';assert.ok(codes(prepare([row])).includes('payslip-basis'));
  const valid=pay();valid.fields.ytd={grossMinor:'900000',taxMinor:'180000'};valid.sourceRefs.push({id:'ytd',fileId:source.id,page:1,basis:'ytd'});valid.confirmedFields.ytd={value:copy(valid.fields.ytd),sourceRefIds:['ytd']};
  assert.equal(prepare([valid]).canCommit,true);assert.equal(prepare([valid]).records[0].fields.grossMinor,'100000');
});
test('edits invalidate field confirmation and unknown source links cannot be confirmed',()=>{
  const row=pay();row.fields.employer='Changed employer';assert.ok(codes(prepare([row])).includes('confirmation-stale'));
  row.confirmedFields.employer.value=row.fields.employer;row.confirmedFields.employer.sourceRefIds=['missing'];assert.ok(codes(prepare([row])).includes('confirmation-stale'));
  const absent=pay();absent.sourceRefs[0].fileId='b'.repeat(64);assert.ok(codes(prepare([absent])).includes('source-reference'));
});
test('manual page review needs no invented quote; supplied text quotes must match the original',()=>{
  assert.equal(prepare([pay()]).canCommit,true);
  const row=pay();row.sourceRefs[0].quote='invented amount';
  const files=[{...source,name:'source.txt',mimeType:'text/plain',text:'Original exact text'}];
  assert.ok(codes(prepare([row],{files})).includes('source-quote'));
  row.sourceRefs[0].quote='Original exact text';assert.equal(prepare([row],{files}).canCommit,true);
});
test('unknown people, items and mixed currencies are refused',()=>{
  const p=pay();p.fields.person='Unknown';p.confirmedFields.person.value='Unknown';assert.ok(codes(prepare([p])).includes('unknown-person'));
  const v=value();v.fields.itemId='Missing';v.confirmedFields.itemId.value='Missing';assert.ok(codes(prepare([v])).includes('unknown-item'));
  const foreign=pay();foreign.fields.currency='USD';foreign.confirmedFields.currency.value='USD';assert.ok(codes(prepare([foreign])).includes('currency-mismatch'));
});
test('valuation sign and existing same-date conflict are not resolved by acknowledgment',()=>{
  assert.ok(codes(prepare([value('-1')])).includes('valuation-sign'));
  const loan=record('valuation',{date:'2027-02-28',itemId:'LOAN',currency:'AUD',valueKind:'liability',valueMinor:'-10000'});assert.equal(prepare([loan]).canCommit,true);
  const b=baseline();b.valuations=[value('19000000')];const result=prepare([value()],{baseline:b,review:{acknowledged:['valuation-conflict']}});
  assert.equal(result.canCommit,false);assert.ok(codes(result).includes('valuation-conflict'));
});
test('identity uses raw facts, not client record IDs; existing exact record becomes evidence without append',()=>{
  const b=baseline();b.payslips=[pay()];const same=pay();same.recordId='another-proposal';
  const result=prepare([same],{baseline:b});assert.equal(result.canCommit,true);assert.equal(result.counts.new,0);assert.equal(result.counts.alreadyPresent,1);
  same.fields.netMinor='70000';same.fields.taxMinor='30000';same.confirmedFields.netMinor.value='70000';same.confirmedFields.taxMinor.value='30000';assert.ok(codes(prepare([same],{baseline:b})).includes('record-conflict'));
});
test('statement observations retain signed balance evidence and never request an account overwrite',()=>{
  const row=record('statement_balance',{accountId:'A',periodStart:'2027-02-01',periodEnd:'2027-02-28',currency:'AUD',balanceKind:'statement-close',balanceConvention:'money-in-positive',openingMinor:'-10000',closingMinor:'-5000'});
  const result=prepare([row]);assert.equal(result.canCommit,true);assert.equal(result.counts.new,0);assert.equal(result.counts.evidence,1);assert.equal(result.records[0].disposition,'evidence-only');
  row.fields.balanceKind='available';row.confirmedFields.balanceKind.value='available';assert.ok(codes(prepare([row])).includes('balance-kind'));
});
test('untrusted extra write fields and malformed proposals cannot bypass the record boundary',()=>{
  const row=pay();row.fields.range='Accounts!H2';row.confirmedFields.range={value:'Accounts!H2',sourceRefIds:['s1']};
  assert.ok(codes(prepare([row])).includes('field-unknown'));assert.equal(prepare([null]).canCommit,false);
  const other=pay();other.recordId='different';assert.ok(codes(prepare([pay(),other])).includes('proposal-duplicate'));
});
test('fictional December and January payslips and signed valuations validate without changing values',()=>{
  const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'../../data/snapshot-v2.json')));
  for(const [month,payCount,total] of [['2026-12',5,'1669286'],['2027-01',4,'1276724']]){
    const b=baseline();b.people=['Jordan','Mia'];b.items=snapshot.assets.map(item=>({id:item.item_id,currency:'AUD',kind:item.class==='Loans'?'liability':'asset',method:item.class==='Loans'?'statement':'estimate'}));
    const files=[],records=[];
    for(const type of ['payslips','valuations']){
      const name=month+'/'+type+'.csv',text=fs.readFileSync(path.join(__dirname,'../../period-close',name),'utf8'),id=createHash('sha256').update(text).digest('hex');
      files.push({id,name,mimeType:'text/csv',byteLength:Buffer.byteLength(text),text});
      for(const [index,row] of Import.parseCSV(text).records.entries()){
        const r=row.values,fields=type==='payslips'?{payDate:r[0],person:r[1],employer:r[2],grossMinor:Import.money(r[3]),taxMinor:Import.money(r[4]),superMinor:Import.money(r[5]),netMinor:Import.money(r[6]),currency:'AUD',valueBasis:'current-period'}:{date:r[0],itemId:r[1],valueMinor:Import.money(r[2]),valueKind:r[1].startsWith('LN-')?'liability':'asset',currency:'AUD'};
        const proposed=record(type==='payslips'?'payslip':'valuation',fields,type+'-'+index);proposed.sourceRefs=[{id:'s1',fileId:id,line:row.line,basis:type==='payslips'?'current-period':'valuation'}];records.push(proposed);
      }
    }
    const result=R.prepare({baseline:b,files,records});assert.equal(result.canCommit,true,JSON.stringify(result.issues));assert.equal(result.counts.payslip,payCount);assert.equal(result.counts.valuation,8);
    assert.equal(C.sumMinor(result.records.filter(row=>row.kind==='payslip').map(row=>row.fields.netMinor)),total);
  }
});
test('shared modules also run as browser/JSC globals with no Node APIs',()=>{
  const context=vm.createContext({});for(const file of ['sheet-contract.js','records.js','close.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
  assert.equal(vm.runInContext('SheetContract.describe(2).rawTargets.valuation.kind',context),'valuation');
  context.request=JSON.parse(JSON.stringify({baseline:baseline(),files:[source],records:[pay()]}));assert.equal(vm.runInContext('Records.prepare(request).canCommit',context),true);
  assert.equal(vm.runInContext('Close.prepare({}).canClose',context),false);
});
