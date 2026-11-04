import test from 'node:test';
import assert from 'node:assert/strict';
import {esc,money,metric,progressModel,goal,transactionRow,normaliseLayout,moveWidget,reorderWidget,DEFAULT_LAYOUT,icon,provenance,filterByAvailableSources} from '../components/kitty.mjs';
test('money preserves signs, exact cent formatting and distinguishes unavailable from zero',()=>{
 assert.equal(money(-8640),'−$86.40');assert.equal(money(324000,'AUD',true),'+$3,240.00');assert.equal(money(0),'$0.00');assert.equal(money(null),'Not available');assert.equal(money(123,'JPY'),'¥123');assert.throws(()=>money(12.5),TypeError);assert.throws(()=>money(Number.MAX_SAFE_INTEGER+1),TypeError);assert.throws(()=>money(100,'<AUD>'),TypeError);
});
test('untrusted source text, attributes and currency cannot introduce markup',()=>{
 assert.equal(esc('<img src=x onerror="bad()">'), '&lt;img src=x onerror=&quot;bad()&quot;&gt;');
 const row=transactionRow({id:'" autofocus onfocus="bad',merchant:'<script>bad()</script>',description:'<img>',category:'<b>',account:'x',date:'today',amountMinor:-1,currency:'AUD',status:'posted'}, {selectable:true});
 assert(!row.includes('<script>'));assert(!row.includes('<img>'));assert(row.includes('&quot; autofocus'));assert(!icon('" onload="bad').includes('onload'));assert(provenance({source:'<iframe>',asOf:'today'}).includes('&lt;iframe&gt;'));
});
test('missing metric never becomes a zero',()=>{assert(metric({label:'Cash',minor:null}).includes('Not available'));assert(!metric({label:'Cash',minor:null}).includes('$0.00'));assert(metric({label:'Cash',minor:0,source:'Source',asOf:'4 Nov',status:'Stale'}).includes('Stale'));});
test('progress invalid and over-target semantics',()=>{
 assert.deepEqual(progressModel(12000,10000),{available:true,percent:100,remaining:0});assert.equal(progressModel(9999,10000).percent,99);assert.deepEqual(progressModel(0,10000),{available:true,percent:0,remaining:10000});for(const [s,t] of [[null,100],[100,0],[-1,100],[100,-1],[10,NaN]])assert.equal(progressModel(s,t).available,false);
 assert(goal({title:'Unknown',savedMinor:10,targetMinor:0}).includes('Progress unavailable'));
});
test('status does not conflate pending with posted or refund with income',()=>{
 const t={id:'a',merchant:'Shop',amountMinor:100,currency:'AUD',status:'pending'};assert(transactionRow(t).includes('Pending'));assert(!transactionRow(t).includes('Posted'));
 assert(transactionRow({...t,review:'needed'}).includes('Needs review'));assert(transactionRow({...t,review:'needed'}).includes('Pending'));assert(transactionRow({...t,status:'posted',kind:'refund',review:'needed'}).includes('Needs review'));assert(transactionRow({...t,status:'posted',kind:'refund'}).includes('Refund'));assert(transactionRow({...t,status:'posted',kind:'transfer'}).includes('Transfer'));
});
test('layout normalisation removes corrupt, repeated and injected records without losing known widgets',()=>{
 const got=normaliseLayout([{id:'cash',size:'<script>'},{id:'evil',size:'wide'},{id:'cash',size:'wide'},null,{id:'goal',size:'wide'}]);assert.equal(got.length,4);assert.equal(got[0].size,'compact');assert.equal(got[1].id,'goal');assert.equal(new Set(got.map(x=>x.id)).size,4);assert.deepEqual(normaliseLayout({}),DEFAULT_LAYOUT);
});
test('keyboard and drag ordering preserve same card identities and constrained boundaries',()=>{
 const base=normaliseLayout(DEFAULT_LAYOUT);assert.deepEqual(moveWidget(base,'cash',-1),base);assert.deepEqual(moveWidget(base,'goal',1),base);assert.deepEqual(moveWidget(base,'cash',999),base);
 assert.deepEqual(moveWidget(base,'review',-1).map(x=>x.id),['review','cash','activity','goal']);assert.deepEqual(reorderWidget(base,'goal','cash').map(x=>x.id),['goal','cash','review','activity']);assert.deepEqual(reorderWidget(base,'goal','unknown'),base);assert.deepEqual(base,DEFAULT_LAYOUT);
});

test('partial coverage excludes unavailable-source rows before UI filters',()=>{const rows=[{id:'bank-1',source:'bank-export.csv'},{id:'card-1',source:'card-activity.csv'}];assert.deepEqual(filterByAvailableSources(rows,['bank-export.csv']).map(x=>x.id),['bank-1']);assert.deepEqual(filterByAvailableSources(rows,[]),[]);assert.equal(rows.length,2);});

test('large safe-integer minor amounts retain their last cent without binary rounding',()=>{
 assert.equal(money(Number.MAX_SAFE_INTEGER,'AUD'), '$90,071,992,547,409.91');
 assert.equal(money(-Number.MAX_SAFE_INTEGER,'AUD'), '−$90,071,992,547,409.91');
});
test('signed sub-unit values preserve negative zero whole parts and positive signs',()=>{
 assert.equal(money(-1,'AUD'), '−$0.01');
 assert.equal(money(-1,'AUD',true), '−$0.01');
 assert.equal(money(1,'AUD',true), '+$0.01');
 assert.equal(money(0,'AUD',true), '$0.00');
});
test('zero-decimal currencies use whole minor units and correct signs at boundaries',()=>{
 assert.equal(money(1,'JPY',true), '+¥1');
 assert.equal(money(-1,'JPY',true), '−¥1');
 assert.equal(money(Number.MAX_SAFE_INTEGER,'JPY'), '¥9,007,199,254,740,991');
 assert.equal(money(0,'JPY',true), '¥0');
});
