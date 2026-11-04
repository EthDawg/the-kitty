import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildTemplate} from '../templates/build.mjs';
import {verifyWorkbook} from './verify.mjs';
import {smallPlan,initializedState,input} from './test-support.mjs';

const captured=JSON.parse(readFileSync(new URL('./fixtures/custom-validation-readback.json',import.meta.url)));
const actualPlan=buildTemplate({profile:'au-aud-basic',sheetVersion:1,householdName:'Fictional validation fixture',people:['Avery','Casey'],openingDate:'2026-10-31',accounts:[{id:'ACC-CASH',name:'Cash',institution:'Example institution',type:'Transaction',owner:'Joint',openingMinor:'0'}]});
function fixture(){
  const plan=smallPlan(input),transactions=plan.verification.sheets.find(sheet=>sheet.title==='Transactions');
  transactions.rowCount=2001;plan.profile=structuredClone(actualPlan.profile);plan.sourceSha256=actualPlan.sourceSha256;
  const request=structuredClone(actualPlan.batchUpdate.requests.find(request=>request.repeatCell?.cell.dataValidation?.condition.type==='CUSTOM_FORMULA'));
  request.repeatCell.range.sheetId=transactions.sheetId;plan.batchUpdate.requests.push(request);
  const state=initializedState(plan);
  // Model the observed provider expansion, then replace the independently
  // captured sample rows verbatim (first, next, interior and last record).
  for(let row=1;row<=captured.count;row++){
    const sample=structuredClone(captured.cells.find(cell=>cell.rowIndex===row)??captured.cells[0]);
    if(sample.rowIndex!==row){sample.rowIndex=row;sample.dataValidation.condition.values[0].userEnteredValue=sample.dataValidation.condition.values[0].userEnteredValue.replaceAll('B2',`B${row+1}`);}
    state.cells.push({sheetId:transactions.sheetId,...sample});
  }
  return {plan,state,request,cell:row=>state.cells.find(cell=>cell.sheetId===transactions.sheetId&&cell.columnIndex===1&&cell.rowIndex===row)};
}
const hasMismatch=result=>result.status==='conflict'&&result.issues.some(issue=>issue.code==='validation_mismatch');

test('Google custom-formula readback expands all 2,000 relative dates and omits showCustomUi',()=>{
  const f=fixture();assert.equal(f.request.repeatCell.cell.dataValidation.showCustomUi,true);
  for(const sample of captured.cells)assert.deepEqual(f.cell(sample.rowIndex).dataValidation,sample.dataValidation);
  assert.equal(verifyWorkbook(f.state,f.plan).status,'verified');
  assert.equal(f.cell(2000).dataValidation.condition.values[0].userEnteredValue,'=AND(ISNUMBER(B2001),B2001>INDIRECT("Settings!B35"))');
});
test('relative validation fixes still reject missing coverage, wrong references, relaxed strictness and changed messages',()=>{
  for(const mutate of [
    f=>delete f.cell(2000).dataValidation,
    f=>f.cell(1000).dataValidation.condition.values[0].userEnteredValue='=AND(ISNUMBER(B2),B2>INDIRECT("Settings!B35"))',
    f=>f.cell(2).dataValidation.condition.values[0].userEnteredValue='=AND(ISNUMBER(B3),B3>INDIRECT("Settings!B36"))',
    f=>f.cell(2).dataValidation.condition.values[0].userEnteredValue='=AND(ISNUMBER(C3),C3>INDIRECT("Settings!B35"))',
    f=>f.cell(32).dataValidation.strict=false,
    f=>delete f.cell(32).dataValidation.strict,
    f=>f.cell(32).dataValidation.inputMessage='Different guidance',
    f=>f.cell(32).dataValidation.condition.type='NUMBER_GREATER',
    f=>f.state.cells.push({...structuredClone(f.cell(1)),columnIndex:0})
  ]){const f=fixture();mutate(f);assert.ok(hasMismatch(verifyWorkbook(f.state,f.plan)),String(mutate));}
});
test('only the exact pinned opening-date rule is expanded',()=>{
  for(const mutate of [
    f=>f.plan.profile.version='future',
    f=>f.plan.sourceSha256='0'.repeat(64),
    f=>f.request.repeatCell.cell.dataValidation.condition.values[0].userEnteredValue='=B2>0',
    f=>f.request.repeatCell.range.startRowIndex=2
  ]){const f=fixture();mutate(f);assert.ok(hasMismatch(verifyWorkbook(f.state,f.plan)));}
});
test('showCustomUi normalization is limited to custom formulas and never weakens strict validation',()=>{
  for(const flag of [undefined,false,true]){
    const f=fixture();if(flag!==undefined)f.cell(2).dataValidation.showCustomUi=flag;
    assert.equal(verifyWorkbook(f.state,f.plan).status,'verified');
  }
  const f=fixture(),rule={condition:{type:'ONE_OF_LIST',values:[{userEnteredValue:'Avery'},{userEnteredValue:'Casey'}]},strict:true,showCustomUi:true};
  f.plan.batchUpdate.requests.push({repeatCell:{range:{sheetId:1002,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:1},cell:{dataValidation:rule},fields:'dataValidation'}});
  const cell={sheetId:1002,rowIndex:1,columnIndex:0,dataValidation:structuredClone(rule)};f.state.cells.push(cell);assert.equal(verifyWorkbook(f.state,f.plan).status,'verified');
  delete cell.dataValidation.showCustomUi;assert.ok(hasMismatch(verifyWorkbook(f.state,f.plan)));
  cell.dataValidation.showCustomUi=true;cell.dataValidation.strict=false;assert.ok(hasMismatch(verifyWorkbook(f.state,f.plan)));
});
