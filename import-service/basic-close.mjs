import {buildTemplate} from '../templates/build.mjs';

// These projections cover the pinned basic profile only. Comparing its actual
// formula/input contract first prevents replacing a custom check's meaning.
const plan=buildTemplate({profile:'au-aud-basic',sheetVersion:1,householdName:'Contract fixture',people:['Person'],openingDate:'2000-01-31',accounts:[{id:'ACCOUNT',name:'Account',institution:'Example',type:'Transaction',owner:'Person',openingMinor:'0'}]});
const titles=new Map(plan.verification.sheets.map(sheet=>[sheet.sheetId,sheet.title]));
export const isBasicCheckCell=(tab,row,column)=>
  tab==='Compliance Checks'&&row>=4&&row<=27&&column<7 ||
  tab==='Settings'&&column===1&&[6,7,8,9,33,35].includes(row) ||
  tab==='Transactions'&&row===1&&column>=10&&column<=16 ||
  tab==='Payslips'&&row===1&&column===7;
export const basicCheckInputs=()=>plan.verification.cells.filter(cell=>isBasicCheckCell(titles.get(cell.sheetId),cell.rowIndex,cell.columnIndex)).map(cell=>({tab:titles.get(cell.sheetId),rowIndex:cell.rowIndex,columnIndex:cell.columnIndex,userEnteredValue:structuredClone(cell.userEnteredValue)}));
const key=cell=>`${cell.tab}:${cell.rowIndex}:${cell.columnIndex}`;
const canonical=value=>JSON.stringify(value);
const expectedInputs=new Map(basicCheckInputs().map(cell=>[key(cell),cell.userEnteredValue]));
const values=new Map(basicCheckInputs().map(cell=>[key(cell),cell.userEnteredValue.stringValue]));
const checkRows=Array.from({length:24},(_,i)=>i+4).filter(row=>['Close','Data','Tax','Cash'].includes(values.get(`Compliance Checks:${row}:1`)));
const expectedIds=checkRows.map(row=>values.get(`Compliance Checks:${row}:0`));
const sum=rows=>rows.reduce((total,row)=>total+BigInt(row.amountMinor),0n);
const abs=value=>value<0n?-value:value;
const fy=date=>Number(date.slice(0,4))+(Number(date.slice(5,7))>=7?1:0);
const addMonths=(date,n)=>{const d=new Date(date+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.toISOString().slice(0,10);};
const ci=value=>String(value??'').toLowerCase();
const criterion=(pattern,value)=>{
  let expression='';const literal=character=>character.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&');
  for(let i=0;i<pattern.length;i++){const c=pattern[i];if(c==='~'&&i+1<pattern.length&&'*?~'.includes(pattern[i+1]))expression+=literal(pattern[++i]);else expression+=c==='*'?'.*':c==='?'?'.':literal(c);}
  return new RegExp('^'+expression+'$','iu').test(String(value??''));
};
const idsAndTypes=rows=>rows.map(row=>[row.id,row.type]).sort((a,b)=>a[0].localeCompare(b[0]));

export function projectBasicCloseChecks({baseline,inputs,subscriptions},periodEnd){
  const fail=message=>({checks:[...baseline.checks,{id:'Target-period diagnostic contract',type:'Close',items:null,status:'Review',message}],issues:[{code:'close_projection_unavailable',message}]});
  try{
    if(!Array.isArray(inputs))return fail('The basic template diagnostic formulas could not be verified for the target period.');
    const actual=new Map(inputs.filter(cell=>isBasicCheckCell(cell.tab,cell.rowIndex,cell.columnIndex)).map(cell=>[key(cell),cell.userEnteredValue]));
    if(actual.size!==expectedInputs.size||[...expectedInputs].some(([k,v])=>canonical(actual.get(k))!==canonical(v)))return fail('A basic template diagnostic or helper formula changed. Restore the supported formulas before closing this period.');
    const scope=checkRows.map(row=>({id:values.get(`Compliance Checks:${row}:0`),type:values.get(`Compliance Checks:${row}:1`)}));
    if(canonical(idsAndTypes(baseline.checks))!==canonical(idsAndTypes(scope)))return fail('The basic template diagnostic rows changed. Review the complete target-period check scope before closing.');
    if(!Array.isArray(subscriptions)||subscriptions[0]?.[0]!=='Service'||subscriptions[0]?.[1]!=='Merchant')return fail('The subscription merchant list is unavailable for its target-period diagnostic.');
    const tx=baseline.transactions,through=tx.filter(row=>row.date<=periodEnd),currentFY=fy(periodEnd),priorFY=currentFY-1;
    const historyStart=baseline.accounts[0]?.openingDate&&new Date(Date.parse(baseline.accounts[0].openingDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    if(!historyStart||baseline.accounts.some(account=>account.openingDate!==baseline.accounts[0].openingDate))return fail('The target-period checks need the same verified opening anchor for every account.');
    const categoryMap=new Map(baseline.categories.map(row=>[row.id,row]));
    const payTotal=predicate=>baseline.payslips.filter(row=>predicate(row.fields.payDate)).reduce((total,row)=>total+BigInt(row.fields.netMinor),0n);
    const tuple=row=>canonical([row.date,ci(row.accountId),row.amountMinor]),groups=new Map(),matched=new Map();
    for(const row of through){const key=tuple(row);if(!groups.has(key))groups.set(key,new Map());const group=groups.get(key),merchant=ci(row.merchant);group.set(merchant,(group.get(merchant)??0)+1);}
    let comparisons=0;
    const duplicateCount=row=>{const group=groups.get(tuple(row)),pattern=String(row.merchant??'');if(!/[*?~]/.test(pattern))return group.get(ci(pattern))??0;const key=tuple(row)+pattern;if(!matched.has(key)){let count=0;for(const [merchant,n]of group){if(++comparisons>1000000)throw new Error('Diagnostic scope limit.');if(criterion(pattern,merchant))count+=n;}matched.set(key,count);}return matched.get(key);};
    const duplicates=new Set(through.filter(row=>row.flow==='Expense'&&duplicateCount(row)>1).map(row=>canonical([row.date,row.accountId,row.merchant,row.amountMinor])));
    const knownMerchants=subscriptions.slice(1).map(row=>String(row[1]??''));
    const seenSubscriptions=new Set(through.filter(row=>row.categoryId==='SUBS'&&row.date>addMonths(periodEnd,-2)).map(row=>String(row.merchant??'')));
    const counts=new Map();
    // Row numbers refer to the pinned v1 profile; facts are derived from raw
    // records at periodEnd, never from a stale current-As-of calculated count.
    for(const row of [5,6,7,8,9])counts.set(row,{items:null,status:'Unavailable'});
    if(historyStart<=`${priorFY-1}-07-01`){const difference=payTotal(date=>fy(date)===priorFY)-sum(tx.filter(row=>row.categoryId==='SALARY'&&fy(row.date)===priorFY));counts.set(10,{items:abs(difference)>100n?1:0});}
    else counts.set(10,{items:null,status:'Unavailable'});
    counts.set(11,{items:through.filter(row=>row.categoryId==='UNCAT').length});
    counts.set(12,{items:through.filter(row=>row.categoryId&&(!categoryMap.has(row.categoryId)||categoryMap.get(row.categoryId).name==='Unknown category')).length});
    counts.set(13,{items:duplicates.size});
    counts.set(14,{items:abs(sum(through.filter(row=>row.flow==='Transfer')))>1n?1:0});
    counts.set(15,{items:through.filter(row=>row.categoryId==='FEES'&&/INTEREST/i.test(row.bankDescription??row.description??'')&&row.date>addMonths(periodEnd,-12)).length});
    counts.set(16,{items:tx.filter(row=>row.date>periodEnd).length});
    counts.set(17,{items:baseline.items.filter(item=>!baseline.valuations.some(row=>row.fields.itemId===item.id&&row.fields.date===periodEnd)).length});
    const salaryDifference=sum(through.filter(row=>row.categoryId==='SALARY'&&fy(row.date)===currentFY))-payTotal(date=>date<=periodEnd&&fy(date)===currentFY);
    counts.set(18,{items:abs(salaryDifference)>100n?1:0});
    counts.set(19,{items:baseline.accounts.filter(account=>!through.some(row=>row.accountId===account.id&&row.date.slice(0,7)===periodEnd.slice(0,7))).length});
    counts.set(20,{items:[...seenSubscriptions].filter(merchant=>!knownMerchants.some(value=>criterion(merchant,value))).length});
    counts.set(21,{items:tx.length-new Set(tx.map(row=>row.id)).size});
    counts.set(25,{items:tx.filter(row=>row.date<=baseline.accounts[0].openingDate).length});
    counts.set(26,{items:tx.filter(row=>!baseline.accounts.some(account=>account.id===row.accountId)).length});
    counts.set(27,{items:tx.filter(row=>!row.person||!baseline.people.includes(row.person)).length});
    counts.set(28,{items:periodEnd<baseline.accounts[0].openingDate?1:0});
    const checks=checkRows.map((row,index)=>{const source=baseline.checks.find(check=>check.id===expectedIds[index]),fact=counts.get(row+1);return {...source,items:fact.items,status:fact.status??(fact.items>0?'Review':'OK')};});
    return {checks,issues:[]};
  }catch{return fail('The target-period diagnostics could not be calculated from exact current raw records.');}
}

export function verifyBasicCloseChecks(state){
  if(!state.closeProjection)return [];
  if(state.closeProjection.issues.length)return state.closeProjection.issues;
  const comparable=rows=>rows.map(({id,type,items,status})=>({id,type,items,status})).sort((a,b)=>a.id.localeCompare(b.id));
  return canonical(comparable(state.actualChecks))===canonical(comparable(state.baseline.checks))?[]:[{code:'close_diagnostic_readback',message:'The actual Sheet diagnostic counts or statuses differ from the target-period review. Keep this receipt and check again; the close will not be repeated.'}];
}
