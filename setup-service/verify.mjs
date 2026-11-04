import {createHash} from 'node:crypto';
import {PROFILE,SOURCE_SHA256} from '../templates/build.mjs';

export const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
export const sha256=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
const key=cell=>`${cell.sheetId}:${cell.rowIndex}:${cell.columnIndex}`;
const entered=value=>value&&Object.keys(value).length&&!(Object.keys(value).length===1&&value.stringValue==='')?value:null;
const effective=cell=>{const value=cell?.effectiveValue;return value?.numberValue??value?.stringValue??value?.boolValue;};
const blank=value=>value===undefined||value===null||value==='';
const issue=(code,message)=>({code,message});
const column=text=>[...text].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
export function rangeCells(range,sheets){
  const match=range.match(/^'(.*)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if(!match)throw new Error('Unsupported verification range.');
  const title=match[1].replaceAll("''","'"),sheet=sheets.find(s=>s.title===title);
  if(!sheet)throw new Error('Verification tab is missing.');
  const fromRow=Number(match[3])-1,toRow=Number(match[5]??match[3])-1,fromColumn=column(match[2]),toColumn=column(match[4]??match[2]);
  if(fromRow<0||fromColumn<0||toRow<fromRow||toColumn<fromColumn||toRow>=sheet.rowCount||toColumn>=sheet.columnCount)throw new Error('Verification range is outside its tab.');
  return {sheetId:sheet.sheetId,fromRow,toRow,fromColumn,toColumn};
}
function rules(plan){
  const formats=new Map(),validations=new Map();
  for(const request of plan.batchUpdate.requests){
    const repeat=request.repeatCell;if(!repeat)continue;
    const r=repeat.range;
    for(let rowIndex=r.startRowIndex;rowIndex<r.endRowIndex;rowIndex++)for(let columnIndex=r.startColumnIndex;columnIndex<r.endColumnIndex;columnIndex++){
      const k=key({sheetId:r.sheetId,rowIndex,columnIndex});
      if(repeat.fields==='userEnteredFormat.numberFormat')formats.set(k,repeat.cell.userEnteredFormat.numberFormat);
      else if(repeat.fields==='dataValidation')validations.set(k,validationAt(plan,repeat,rowIndex));
    }
  }
  return {formats,validations};
}
function validationAt(plan,repeat,rowIndex){
  const value=repeat.cell.dataValidation,r=repeat.range;
  const transactions=plan.verification.sheets.find(sheet=>sheet.title==='Transactions');
  // Google expands this repeatCell's relative B2 references on each row. Only
  // the pinned template's known rule is supported here; do not rewrite quoted
  // INDIRECT text or attempt a general spreadsheet-formula transformation.
  if(plan.profile?.id!==PROFILE.id || plan.profile?.version!==PROFILE.version || plan.sourceSha256!==SOURCE_SHA256 ||
    r.sheetId!==transactions?.sheetId || r.startRowIndex!==1 || r.startColumnIndex!==1 || r.endColumnIndex!==2 ||
    value?.condition?.type!=='CUSTOM_FORMULA' || value.condition.values?.length!==1 ||
    value.condition.values[0].userEnteredValue!=='=AND(ISNUMBER(B2),B2>INDIRECT("Settings!B35"))')return value;
  const expanded=structuredClone(value);
  expanded.condition.values[0].userEnteredValue=`=AND(ISNUMBER(B${rowIndex+1}),B${rowIndex+1}>INDIRECT("Settings!B35"))`;
  return expanded;
}
function rule(value){
  if(!value)return null;
  const result=structuredClone(value);
  // The API omits false defaults. showCustomUi is ignored altogether for a
  // custom formula; retain it for list and other validation types.
  for(const flag of ['strict','showCustomUi'])if(result[flag]===false)delete result[flag];
  if(result.condition?.type==='CUSTOM_FORMULA')delete result.showCustomUi;
  return result;
}
export function blankWorkbook(state,plan){
  const issues=[];
  if(state.sheets.length>10)issues.push(issue('unexpected_blank_tabs','The new workbook has unexpected initial tabs.'));
  if(state.cells.some(cell=>entered(cell.userEnteredValue)||!blank(effective(cell))||cell.dataValidation))issues.push(issue('workbook_not_empty','The new workbook already has content. Initialization will not replace it.'));
  if(state.sheets.some(s=>s.hasStructuralFeatures))issues.push(issue('workbook_not_empty','The new workbook has unexpected merged, protected or conditional content.'));
  if(state.hasWorkbookStructure)issues.push(issue('workbook_not_empty','The new workbook already has named ranges or metadata.'));
  if(state.sheets.some(s=>plan.verification.sheets.some(expected=>expected.sheetId===s.sheetId||expected.title===s.title)))issues.push(issue('initial_tab_collision','An initial tab conflicts with a generated tab identity. Nothing will be replaced.'));
  return {ok:issues.length===0,issues};
}
export function verifyWorkbook(state,plan){
  const issues=[],calculationIssues=[];
  const expected=plan.verification;
  if(state.properties?.title!==plan.spreadsheetCreate.properties.title||state.properties?.locale!==plan.spreadsheetCreate.properties.locale||state.properties?.timeZone!==plan.spreadsheetCreate.properties.timeZone)issues.push(issue('workbook_properties_changed','The workbook title, locale or time zone differs from the approved template.'));
  const shape=sheet=>[sheet.sheetId,sheet.title,sheet.rowCount,sheet.columnCount];
  if(canonical(state.sheets.map(shape).sort((a,b)=>a[0]-b[0]))!==canonical(expected.sheets.map(shape).sort((a,b)=>a[0]-b[0])))issues.push(issue('tab_mismatch','The workbook tabs or bounds differ from the approved template.'));
  if(state.hasWorkbookStructure||state.sheets.some(s=>s.hasStructuralFeatures))issues.push(issue('unexpected_structure','The workbook has structure outside the approved template.'));
  const actualCells=new Map(state.cells.map(cell=>[key(cell),cell]));
  if(actualCells.size!==state.cells.length)issues.push(issue('ambiguous_cells','The provider returned repeated cell locations.'));
  const wanted=new Map(expected.cells.filter(cell=>entered(cell.userEnteredValue)).map(cell=>[key(cell),cell.userEnteredValue]));
  const actual=new Map(state.cells.filter(cell=>entered(cell.userEnteredValue)).map(cell=>[key(cell),cell.userEnteredValue]));
  if(actual.size!==wanted.size||[...wanted].some(([k,value])=>canonical(actual.get(k))!==canonical(value)))issues.push(issue('cell_mismatch','An input or formula differs from the approved template, or unexpected content is present.'));
  const expectedRules=rules(plan);
  if([...expectedRules.formats].some(([k,value])=>canonical(actualCells.get(k)?.numberFormat)!==canonical(value)))issues.push(issue('number_format_mismatch','A required number/date format did not read back correctly.'));
  if([...expectedRules.validations].some(([k,value])=>canonical(rule(actualCells.get(k)?.dataValidation))!==canonical(rule(value)))||state.cells.some(cell=>cell.dataValidation&&!expectedRules.validations.has(key(cell))))issues.push(issue('validation_mismatch','The configured entry validation did not read back correctly.'));
  const errors=state.cells.filter(cell=>cell.effectiveValue?.errorValue);
  if(errors.length)calculationIssues.push(issue('calculation_error','The new workbook still has a calculation error. Check this same setup again; initialization will not be repeated.'));
  for(const check of expected.checks){
    try{
      const r=rangeCells(check.range,expected.sheets);let pass=true;
      for(let row=r.fromRow;row<=r.toRow;row++)for(let column=r.fromColumn;column<=r.toColumn;column++){
        const value=effective(actualCells.get(key({sheetId:r.sheetId,rowIndex:row,columnIndex:column}))),target=check.expected?.[row-r.fromRow]?.[column-r.fromColumn];
        if(check.kind==='blank')pass=pass&&blank(value);
        else if(check.kind==='exact')pass=pass&&canonical(value)===canonical(target);
        else if(check.kind==='minor')pass=pass&&check.currency==='AUD'&&typeof value==='number'&&Number.isFinite(value)&&Math.abs(value*100)<=99999999999999&&String(Math.round(value*100))===target;
        else pass=false;
      }
      if(!pass)calculationIssues.push(issue('check_failed',`The setup check ${check.id} is not verified.`));
    }catch{calculationIssues.push(issue('check_unavailable',`The setup check ${check.id} could not be read.`));}
  }
  // An empty cell is not a recorded zero, and no imported transactions are invented.
  for(const range of expected.rawRecordRanges){
    try{const r=rangeCells(range,expected.sheets);if(state.cells.some(cell=>cell.sheetId===r.sheetId&&cell.rowIndex>=r.fromRow&&cell.rowIndex<=r.toRow&&cell.columnIndex>=r.fromColumn&&cell.columnIndex<=r.toColumn&&(entered(cell.userEnteredValue)||!blank(effective(cell)))))issues.push(issue('unexpected_raw_records','The new workbook contains unexpected raw financial records.'));}
    catch{issues.push(issue('raw_contract_missing','The raw-record verification range is unavailable.'));}
  }
  const kitty=expected.sheets.find(s=>s.title==='Kitty');
  const feed=state.cells.filter(c=>c.sheetId===kitty?.sheetId&&c.columnIndex===0&&String(effective(c)??'').trim()==='public_feed').sort((a,b)=>a.rowIndex-b.rowIndex)[0];
  if(!feed||String(effective(actualCells.get(`${kitty.sheetId}:${feed.rowIndex}:1`))??'').trim().toLowerCase()!=='no')issues.push(issue('public_feed_not_off','The known Kitty JSON feed is not explicitly off.'));
  return {status:issues.length?'conflict':calculationIssues.length?'unknown':'verified',issues:[...issues,...calculationIssues]};
}
