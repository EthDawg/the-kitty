/* Pure versioned Sheet boundary. Load before records.js and close.js in JavaScriptCore. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SheetContract=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MAX_MINOR=99999999999999;
  const currencies=['AUD','USD','NZD','GBP','EUR','CAD','CHF','SGD','HKD'];
  const headers={
    entries:['Entry ID','Kind','Settled at','Account ID','Raw text','Description','Amount','Category ID','Person','Receipt held','Note','Status','Created at','Transfer ID','Transfer account','Foreign amount','Foreign currency','Units','Unit price','Source'],
    payslips:['Pay date','Person','Employer','Gross pay','Tax withheld','Super (employer)','Net pay'],
    accounts:['Account ID','Account','Institution','Type','Owner','Opening balance','Opening date','Balance at as-of date','Liquid'],
    categories:['Category ID','Category','Group','Flow','Monthly budget','Essential','Tax treatment','ATO label']
  };
  const views=['Metrics','Cash Flow','Budget','Savings Finder','Mortgage Scenarios','Tax Forecast','Compliance Checks','Net Worth'];
  function fail(code,message){const error=new Error(message);error.code=code;throw error;}
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
    return JSON.stringify(value===undefined?null:value);
  }
  function minor(value){
    if(typeof value!=='string'||!/^(-?[1-9]\d*|0)$/.test(value)||!Number.isSafeInteger(Number(value))||Math.abs(Number(value))>MAX_MINOR)
      fail('amount-minor','Money must be a canonical integer minor-unit string within the supported exact range.');
    return value;
  }
  function sumMinor(values){
    let total=0;
    for(const value of values){total+=Number(minor(value));if(!Number.isSafeInteger(total)||Math.abs(total)>MAX_MINOR)fail('amount-range','The combined amount exceeds the supported exact range.');}
    return String(total);
  }
  function decimalAmount(value){const n=Number(minor(value));return (n<0?'-':'')+Math.floor(Math.abs(n)/100)+'.'+String(Math.abs(n)%100).padStart(2,'0');}
  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const year=Number(value.slice(0,4)),time=Date.parse(value+'T00:00:00Z');
    return year>=1900&&year<=2200&&Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value;
  }
  function describe(version){
    if(version!==2)fail('unsupported-schema','Choose a Kitty sheet_version 2 household.');
    const transaction={tab:'Entries',range:'A:T',headers:headers.entries,idPrefix:'T',dateColumns:[2,12],kind:'transaction'};
    const payslip={tab:'Payslips',range:'A:G',headers:headers.payslips,dateColumns:[0],metadata:{column:'I',header:'Kitty record ID',idPrefix:'P_',absentPolicy:'all cells must be empty before initialization'}};
    const valuation={tab:'Entries',range:'A:T',headers:headers.entries,dateColumns:[2,12],idPrefix:'V',kind:'valuation'};
    return JSON.parse(JSON.stringify({contractVersion:2,schemaVersion:version,currencies,minorUnitScale:2,
      rawTargets:{transaction,payslip,valuation,statement_balance:null},
      inputs:{Accounts:{headers:headers.accounts.concat(['Class','Valuation method','Currency','Status','Purpose','Linked account','Note']),formulaColumns:['H']},Categories:{headers:headers.categories},Settings:{key:'Setting',value:'Value'},Kitty:{key:'Key',value:'Value'}},
      metadata:{tab:'Kitty',keys:{sheet_version:{required:true,type:'integer',allowed:[2]},currency:{required:true,type:'two-decimal ISO currency'},people:{requiredFor:'payslip',type:'comma-separated exact person names'}}},
      formulaRanges:[{tab:'Payslips',range:'H:H',anchor:'H2'},{tab:'Accounts',range:'H:H'},{tab:'Goals',range:'E:J'},
        {tab:'Entries',range:'U:U',anchor:'U2'},{tab:'Transactions',range:'A:Q',view:true},{tab:'Valuations',range:'A:E',view:true},
        ...views.map(tab=>({tab,range:'ALL',view:true}))],
      close:{tab:'Settings',key:'As-of date',valueColumn:'B',lookup:'unique exact label; never fixed row',allowedChanges:['As-of date','close receipt'],requiresPostWriteVerification:true},
      invariants:['Do not overwrite formula cells.','Statement balances are evidence; never overwrite Accounts balances.','Append only within raw input columns; do not use append_values across helper formulas.','Use explicit date cells and exact minor-unit conversion.','Unknown or occupied metadata columns block writes.'],
      protectedMetadata:{receiptTab:'_KittyImports',headers:['Import ID','Proposal SHA256','Written at','Row IDs','Manifest file']}
    }));
  }
  function validateHeader(actual,expected){
    const normal=value=>String(value==null?'':value).toLowerCase().replace(/[^a-z0-9]/g,'');
    return Array.isArray(actual)&&Array.isArray(expected)&&actual.length>=expected.length&&expected.every((value,index)=>normal(actual[index])===normal(value));
  }
  return {version:2,describe,validateHeader,canonical,minor,sumMinor,decimalAmount,validDate,currencies:currencies.slice(),MAX_MINOR};
});
