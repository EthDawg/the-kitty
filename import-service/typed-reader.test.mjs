import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HEADERS,dateSerial,digest} from './core.mjs';
import {readTypedState,TYPED_HEADERS,RECORD_HEADER} from './typed-google.mjs';
const copy=x=>structuredClone(x);
const accountHeader=['Account ID','Account','Institution','Type','Owner','Opening balance ($)','Opening date','Balance at as-of date ($)','Liquid'];
function fixture(version=1){
  const raw={Settings:[['Settings'],[],['Setting','Value','Note'],['Fiscal start',7],['As-of date',dateSerial('2027-01-31')]],Accounts:[copy(accountHeader),['A','Fictional','Fictional bank','Transaction','Joint',1000,dateSerial('2027-01-31'),1000,'Yes']],Categories:[['Category ID','Category','Group','Flow','Monthly budget ($)','Essential','Tax treatment','ATO label'],['FOOD','Food','Living','Expense',100,'Yes','','']],Payslips:[TYPED_HEADERS.payslips.concat(['Month'])],Valuations:[TYPED_HEADERS.valuations.concat(['Name','Class'])],Assets:[['Item ID','Item','Class','Owner'],['HOME','Fictional house','Property','Joint'],['LOAN','Fictional mortgage','Loans','Joint']],'Compliance Checks':[['Check','Type','Items','Amount ($)','Status','Why it matters','Where to look'],['Inputs present','Close',0,0,'OK','Current inputs','']],Metrics:[['Metric ID','Metric','Value','Unit','Period'],['close.items_missing','Close missing',0,'Count','31 January 2027']]};
  if(version===2){raw.Accounts[0]=accountHeader.concat(['Class','Valuation method','Currency','Status','Purpose','Linked account','Note']);raw.Accounts[1].push('Cash','ledger','AUD','active','','','');raw.Accounts.push(['HOME','Fictional house','','Property','Joint',200000,dateSerial('2027-01-31'),200000,'No','Property','estimate','AUD','active','','',''],['LOAN','Fictional debt','','Loan','Joint',-50000,dateSerial('2027-01-31'),-50000,'No','Loans','statement','AUD','active','','','']);}
  const names=['Kitty','Settings','Accounts','Categories','Payslips','Valuations','Assets','Compliance Checks','Metrics','Transactions',...(version===2?['Entries','Balances']:[])];
  const tabs=Object.fromEntries(names.map((title,i)=>[title,{title,sheetId:i+1,gridProperties:{rowCount:1000,columnCount:title==='Payslips'?8:title==='Valuations'?5:26}}]));
  const legacy={version,currencyPresent:true,currency:'AUD',people:['Joint','Alex'],title:version===1?'Transactions':'Entries',header:HEADERS[version],rows:[],accounts:[{id:'A',name:'Fictional',owner:'Joint'}],categories:[{id:'FOOD',name:'Food'}],inputFormulas:[],formulaFingerprint:'legacy-formulas',receipts:[],receiptValid:true,receiptNextRow:0,nextRowIndex:1,allTabIds:Object.values(tabs).map(t=>t.sheetId)};
  const formulas=[['Payslips',1,7,'=ARRAYFORMULA(IF(A2:A="","",TEXT(A2:A,"yyyy-mm")))'],['Valuations',1,3,'=ARRAYFORMULA(IF(B2:B="","",B2:B))'],['Valuations',1,4,'=ARRAYFORMULA(IF(B2:B="","",B2:B))']];
  const driver={readState:async()=>copy(legacy),request:async(token,value)=>{
    const url=new URL(value),ranges=url.searchParams.getAll('ranges');
    if(url.pathname.endsWith('/values:batchGet'))return {valueRanges:ranges.map(range=>({values:copy(raw[range.split('!')[0].replaceAll("'",'')]??[])}))};
    if(!ranges.length)return {sheets:Object.values(tabs).map(properties=>({properties}))};
    const names=[...new Set(ranges.map(r=>r.split('!')[0].replaceAll("'",'')))];return {sheets:names.map(title=>{
      const data=[];
      if(title==='Settings')for(const [r,row]of raw.Settings.entries())if(row[0]&&row[1]!==undefined)data.push({startRow:r,startColumn:1,rowData:[{values:[{userEnteredValue:typeof row[1]==='number'?{numberValue:row[1]}:{stringValue:row[1]}}]}]});
      for(const [name,r,c,formulaValue]of formulas)if(name===title)data.push({startRow:r,startColumn:c,rowData:[{values:[{userEnteredValue:{formulaValue}}]}]});
      return {properties:{title},data};
    })};
  }};
  return {raw,tabs,legacy,formulas,driver,read:date=>readTypedState(driver,'allowed','fictional_sheet_123456',date)};
}
test('production typed reader preserves empty raw tables and discovers the actual As-of input row',async()=>{
  const f=fixture(),s=await f.read('2027-02-28');assert.equal(s.asOfCell.rowIndex,4);assert.equal(s.baseline.asOf,'2027-01-31');assert.equal(s.tables.payslips.nextRowIndex,1);assert.equal(s.tables.payslips.metadataHeader,'');assert.equal(s.baseline.projectedBalances[0].amountMinor,'100000');assert.equal(s.closeMissing,0);assert.ok(s.formulaFingerprint);
});
test('blank opening/balance/date, wrong raw headers, missing currency and formula inputs fail closed',async()=>{
  for(const alter of [f=>f.raw.Accounts[1][5]='',f=>f.raw.Accounts[1][7]='',f=>f.raw.Accounts[1][5]=1.234,f=>f.raw.Accounts[1][6]='',f=>f.raw.Accounts[1][6]=1.5,f=>f.raw.Accounts[0][5]='Something else',f=>f.legacy.currencyPresent=false,f=>f.legacy.inputFormulas=[[2,1]],f=>f.formulas.push(['Payslips',2,2,'=1']),f=>f.formulas.push(['Valuations',2,0,'=TODAY()'])]){
    const f=fixture();alter(f);await assert.rejects(f.read(),e=>['invalid_sheet_amount','invalid_sheet_date','schema_mismatch','sheet_currency','formula_in_inputs'].includes(e.code));
  }
});
test('reserved metadata initialization refuses custom headers, orphan values and formulas anywhere in the column',async()=>{
  for(const alter of [f=>f.raw.Payslips[0][8]='Private note',f=>f.raw.Payslips.push(['','','','','','','','','custom']),f=>{f.tabs.Payslips.gridProperties.columnCount=9;f.formulas.push(['Payslips',99,8,'=1']);},f=>f.raw.Valuations[0][5]='Household custom']){
    const f=fixture();alter(f);await assert.rejects(f.read(),e=>['metadata_collision','formula_in_inputs'].includes(e.code));
  }
});
test('id-less legacy rows retain their multiplicity, while repeated metadata IDs are refused',async()=>{
  const f=fixture(),row=[dateSerial('2027-01-10'),'Alex','Employer',1000,200,120,800];f.raw.Payslips.push(row,copy(row));const state=await f.read();assert.equal(state.baseline.payslips.length,2);assert.notEqual(state.baseline.payslips[0].legacyLocator,state.baseline.payslips[1].legacyLocator);
  f.raw.Payslips[0][8]=RECORD_HEADER;f.raw.Payslips[1][8]='P_same';f.raw.Payslips[2][8]='P_same';await assert.rejects(f.read(),e=>e.code==='duplicate_existing_id');
});
test('projection uses the opening boundary and posted movements at the requested period, not the current balance',async()=>{
  const f=fixture();for(const [id,date,amount]of [['T0001','2027-01-30',90],['T0002','2027-01-31',80],['T0003','2027-02-10',-25.4],['T0004','2027-03-01',5]])f.legacy.rows.push([id,dateSerial(date),'A','Raw','Merchant',amount,'FOOD','Joint','','']);
  const result=await f.read('2027-02-28');assert.equal(result.baseline.projectedBalances[0].amountMinor,'97460');assert.equal(result.baseline.transactions[0].description,'Raw');assert.equal(result.baseline.transactions[0].bankDescription,'Raw');assert.equal(result.baseline.transactions[0].merchant,'Merchant');assert.equal((await f.read('2027-01-30')).baseline.projectedBalances[0].amountMinor,'0');
});
test('v2 methods/status/currency are explicit, and valuation source annotation never changes configured method',async()=>{
  const f=fixture(2);f.legacy.rows.push(['V0001','valuation',dateSerial('2027-02-28'),'HOME','','',210000,'','','','','settled',dateSerial('2027-02-28'),'','','','','','','totally arbitrary annotation'],['T0001','transaction',dateSerial('2027-02-10'),'A','Original bank text','Reviewed merchant',-25.4,'FOOD','Joint','','','settled',dateSerial('2027-02-10'),'','','','','','','bank export']);const s=await f.read('2027-02-28');assert.equal(s.baseline.items.find(x=>x.id==='HOME').method,'estimate');assert.equal(s.baseline.valuations[0].fields.sourceMethod,undefined);assert.equal(s.baseline.projectedBalances.find(x=>x.accountId==='HOME').amountMinor,'21000000');assert.equal(s.baseline.transactions[0].description,'Original bank text');assert.equal(s.baseline.transactions[0].bankDescription,'Original bank text');assert.equal(s.baseline.transactions[0].merchant,'Reviewed merchant');
  for(const column of [10,11,12]){const bad=fixture(2);bad.raw.Accounts[1][column]='';await assert.rejects(bad.read(),e=>['account_contract','account_currency'].includes(e.code));}
});
test('unknown item classes, missing item identities and duplicate As-of inputs cannot silently infer financial facts',async()=>{
  const f=fixture();f.raw.Assets[1][2]='Unknown';await assert.rejects(f.read(),e=>e.code==='item_class');
  const val=fixture();val.raw.Valuations.push([dateSerial('2027-01-31'),'missing',100]);await assert.rejects(val.read(),e=>e.code==='valuation_item');
  const setting=fixture();setting.raw.Settings.push(['As-of date',dateSerial('2027-02-28')]);await assert.rejects(setting.read(),e=>e.code==='asof_contract');
});
test('blank or absent computed close checks stay unknown rather than becoming a successful zero',async()=>{
  const f=fixture();f.raw.Metrics[1][2]='';f.raw['Compliance Checks'][1][2]='';const s=await f.read();assert.equal(s.closeMissing,null);assert.equal(s.baseline.checks[0].items,null);
  f.raw.Metrics=[];assert.equal((await f.read()).closeMissing,null);
});
test('production reader normalizes the fictional November account ledger to every recorded Sheet balance',async()=>{
  const s=JSON.parse(readFileSync(new URL('../fixtures/snapshot-2026-11.json',import.meta.url))),f=fixture();
  f.raw.Accounts=[accountHeader,...s.accounts.map(a=>[a.account_id,a.account,a.institution,a.type,a.owner,a.opening_balance,a.opening_date,a.balance_at_as_of_date,a.liquid])];
  f.raw.Assets=[f.raw.Assets[0],...s.assets.map(a=>[a.item_id,a.item,a.class,a.owner])];
  f.raw.Payslips=[f.raw.Payslips[0],...s.payslips.map(p=>[p.pay_date,p.person,p.employer,p.gross_pay,p.tax_withheld,p.super,p.net_pay])];
  f.legacy.rows=s.transactions.map(t=>[t.txn_id,t.date,t.account_id,t.bank_description,t.merchant,t.amount,t.category_id,t.person,t.receipt_held??'',t.note??'']);
  const state=await f.read('2026-11-30');assert.equal(state.baseline.transactions.length,825);
  for(const account of state.baseline.accounts)assert.equal(state.baseline.projectedBalances.find(p=>p.accountId===account.id).amountMinor,account.balanceMinor,account.id);
});
