import test from 'node:test';
import assert from 'node:assert/strict';
import {basicCheckInputs,projectBasicCloseChecks,verifyBasicCloseChecks} from './basic-close.mjs';

export function basicCheckRows(){
  const inputs=basicCheckInputs(),value=(row,column)=>inputs.find(cell=>cell.tab==='Compliance Checks'&&cell.rowIndex===row&&cell.columnIndex===column)?.userEnteredValue.stringValue;
  return Array.from({length:24},(_,i)=>i+4).filter(row=>['Data','Tax','Cash','Close'].includes(value(row,1))).map(row=>({id:value(row,0),type:value(row,1),message:value(row,5),items:[4,5,6,7,8,9,18].includes(row)?null:0,status:row===18?'Awaiting first close':row<=9?'Unavailable':'OK'}));
}
export function basicFixture(){return {inputs:basicCheckInputs(),subscriptions:[['Service','Merchant']],baseline:{schemaVersion:1,currency:'AUD',asOf:'2027-01-31',people:['Alex','Joint'],accounts:[{id:'A',currency:'AUD',ledger:true,openingDate:'2027-01-31',openingMinor:'100000',balanceMinor:'100000'}],categories:[{id:'FOOD',name:'Food'},{id:'SUBS',name:'Subscriptions'},{id:'FEES',name:'Fees'},{id:'SALARY',name:'Salary'},{id:'TRANSFER',name:'Transfers'},{id:'UNCAT',name:'Uncategorised'}],transactions:[],payslips:[],valuations:[],items:[],checks:basicCheckRows(),unresolvedReviews:[],projectedBalances:[{accountId:'A',date:'2027-02-28',amountMinor:'100000'}]}};}
const check=(result,prefix)=>result.checks.find(row=>row.id.startsWith(prefix));

test('basic profile no-activity facts target the month being closed before As-of changes',()=>{
  const input=basicFixture(),before=projectBasicCloseChecks(input,'2027-02-28');assert.deepEqual(before.issues,[]);assert.equal(check(before,'Accounts with no activity').items,1);assert.equal(check(before,'Accounts with no activity').status,'Review');assert.equal(input.baseline.checks.find(row=>row.id.startsWith('Accounts with no activity')).status,'Awaiting first close');
  input.baseline.asOf='2027-02-28';input.baseline.checks=before.checks;assert.deepEqual(projectBasicCloseChecks(input,'2027-02-28'),before);
});
test('target reviews include subscriptions, interest, duplicates and future records before a close can write',()=>{
  const input=basicFixture();input.baseline.transactions=[
    {id:'one',date:'2027-02-02',accountId:'A',merchant:'Film service',bankDescription:'Card',amountMinor:'-1000',categoryId:'SUBS',flow:'Expense',person:'Alex'},
    {id:'two',date:'2027-02-02',accountId:'A',merchant:'Film service',bankDescription:'Card',amountMinor:'-1000',categoryId:'SUBS',flow:'Expense',person:'Alex'},
    {id:'three',date:'2027-02-05',accountId:'A',merchant:'Bank',bankDescription:'CARD INTEREST',amountMinor:'-200',categoryId:'FEES',flow:'Expense',person:'Alex'},
    {id:'future',date:'2027-03-01',accountId:'A',merchant:'Food',bankDescription:'Card',amountMinor:'-100',categoryId:'FOOD',flow:'Expense',person:'Alex'}];
  const result=projectBasicCloseChecks(input,'2027-02-28');assert.deepEqual(result.issues,[]);for(const name of ['Subscriptions charged','Card interest','Possible duplicate','Transactions after']){assert.equal(check(result,name).items,1);assert.equal(check(result,name).status,'Review');}assert.equal(check(result,'Accounts with no activity').items,0);
  input.subscriptions.push(['Video','Film service']);assert.equal(check(projectBasicCloseChecks(input,'2027-02-28'),'Subscriptions charged').items,0);
});
test('target counts preserve nonwaivable raw financial checks and precise current-year salary arithmetic',()=>{
  const input=basicFixture();input.baseline.transactions=[{id:'salary',date:'2027-02-10',accountId:'A',amountMinor:'80000',categoryId:'SALARY',flow:'Income',person:'Alex'},{id:'overlap',date:'2027-01-31',accountId:'A',amountMinor:'-100',categoryId:'FOOD',flow:'Expense',person:'Alex'}];
  const result=projectBasicCloseChecks(input,'2027-02-28');assert.equal(check(result,'Salary deposits without').items,1);assert.equal(check(result,'Transactions overlap').items,1);input.baseline.payslips=[{fields:{payDate:'2027-02-10',netMinor:'80000'}}];assert.equal(check(projectBasicCloseChecks(input,'2027-02-28'),'Salary deposits without').items,0);
});
test('merchant wildcard criteria match the pinned COUNTIF diagnostics rather than literal membership',()=>{
  const input=basicFixture();input.subscriptions.push(['Example service','PAYPAL NETFLIX']);input.baseline.transactions=[{id:'one',date:'2027-02-02',accountId:'A',merchant:'PAYPAL *',amountMinor:'-1000',categoryId:'SUBS',flow:'Expense',person:'Alex'},{id:'two',date:'2027-02-02',accountId:'A',merchant:'PAYPAL NETFLIX',amountMinor:'-1000',categoryId:'SUBS',flow:'Expense',person:'Alex'}];
  const result=projectBasicCloseChecks(input,'2027-02-28');assert.equal(check(result,'Subscriptions charged').items,0);assert.equal(check(result,'Possible duplicate').items,1);
});
test('changed formulas, missing helper evidence, custom diagnostics or unavailable merchant list fail closed',()=>{
  for(const change of [i=>i.inputs.pop(),i=>i.inputs.find(c=>c.userEnteredValue.formulaValue).userEnteredValue.formulaValue='=0',i=>i.baseline.checks.push({id:'Custom close rule',type:'Close',items:0,status:'OK'}),i=>i.subscriptions=undefined]){const input=basicFixture();change(input);const result=projectBasicCloseChecks(input,'2027-02-28');assert.equal(result.issues[0].code,'close_projection_unavailable');assert.equal(result.checks.at(-1).type,'Close');assert.equal(result.checks.at(-1).items,null);}
});
test('actual post-close diagnostics must match reviewed target facts, including counts that still say OK',()=>{
  const input=basicFixture(),projection=projectBasicCloseChecks(input,'2027-02-28'),state={baseline:{checks:projection.checks},actualChecks:structuredClone(projection.checks),closeProjection:projection};assert.deepEqual(verifyBasicCloseChecks(state),[]);check({checks:state.actualChecks},'Accounts with no activity').items=0;assert.equal(verifyBasicCloseChecks(state)[0].code,'close_diagnostic_readback');
});
