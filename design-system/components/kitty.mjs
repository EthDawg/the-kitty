/** Kitty UI primitives. Rendering only: financial aggregates must come from the owning model. */
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ICONS = new Set(['home','list','insights','goal','setup','search','spark','x','chev','back','check','share','plus','refresh','dl','calendar','card','cat','clock','coffee','edit','expense','filter','gift','groceries','health','income','info','lock','moon','paw','receipt','sheet','shield','sun','transfer','transport','travel','wallet','warning']);
const SPRITE_URL = new URL('../assets/icons/sprite.svg', import.meta.url).href;
export function icon(name) { return `<svg class="k-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="${esc(SPRITE_URL)}#i-${ICONS.has(name) ? name : 'info'}"></use></svg>`; }
export function money(minor, currency = 'AUD', signed = false) {
  if (minor == null) return 'Not available';
  if (!Number.isSafeInteger(minor)) throw new TypeError('Money requires safe integer minor units');
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError('Currency must be ISO-style uppercase code');
  const digits = new Intl.NumberFormat('en-AU',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  // Keep division out of binary floating point: even a safe integer cent value can lose
  // a cent when converted to a large Number amount. Intl formats the whole BigInt;
  // its fraction part is replaced with the exact remainder in currency minor units.
  const units = BigInt(minor), absolute = units < 0n ? -units : units;
  const scale = 10n ** BigInt(digits), whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, '0');
  const signedWhole = units < 0n ? (whole === 0n ? -0 : -whole) : whole;
  const formatter = new Intl.NumberFormat('en-AU',{
    style:'currency',currency,currencyDisplay:'narrowSymbol',
    signDisplay:signed && minor !== 0 ? 'always' : 'auto',
    minimumFractionDigits:digits,maximumFractionDigits:digits
  });
  return formatter.formatToParts(signedWhole).map(part =>
    part.type === 'fraction' ? fraction : part.type === 'minusSign' ? '−' : part.value
  ).join('');
}
export const monogram = name => String(name || '?').trim().split(/\s+/).slice(0,2).map(w => Array.from(w)[0] || '').join('').toUpperCase() || '?';
export function badge(label, tone = 'neutral') {
  const safeTone = ['neutral','good','warning','error','info'].includes(tone) ? tone : 'neutral';
  return `<span class="k-badge k-badge--${safeTone}">${esc(label)}</span>`;
}
export function provenance({source, asOf, status = 'Demo'}) {
  return `<div class="k-provenance">${icon('sheet')}<span>${esc(source)} <span aria-hidden="true">·</span> ${esc(asOf)}</span>${badge(status)}</div>`;
}
export function metric({label, minor, currency='AUD', detail='', source='', asOf='', status='Demo', tone='default'}) {
  return `<div class="k-metric${tone==='hero'?' k-metric--hero':''}"><p class="k-eyebrow">${esc(label)}</p><p class="k-metric-value">${esc(money(minor,currency))}</p><p class="k-metric-detail">${esc(detail)}</p>${source?provenance({source,asOf,status}):''}</div>`;
}
export function progressModel(saved, target) {
  if (!Number.isSafeInteger(saved) || !Number.isSafeInteger(target) || saved < 0 || target <= 0) return {available:false, percent:null, remaining:null};
  return {available:true,percent:saved>=target?100:Math.min(99,Math.round(saved/target*100)),remaining:Math.max(0,target-saved)};
}
export function goal({title,savedMinor,targetMinor,currency='AUD',date}) {
  const p=progressModel(savedMinor,targetMinor);
  if(!p.available) return `<div class="k-goal"><h3>${esc(title)}</h3><p>Progress unavailable</p><p class="k-muted">Add a valid target and confirmed balance.</p></div>`;
  return `<div class="k-goal"><div class="k-ring" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="k-ring-track" cx="60" cy="60" r="48"/><circle class="k-ring-value" cx="60" cy="60" r="48" pathLength="100" stroke-dasharray="${p.percent} 100"/></svg><span>${p.percent}%</span></div><div><p class="k-eyebrow">${esc(title)}</p><h3 class="k-tabular">${esc(money(savedMinor,currency))}<small>of ${esc(money(targetMinor,currency))}</small></h3><p class="k-muted">${esc(money(p.remaining,currency))} to go${date?' · '+esc(date):''}</p></div></div>`;
}
export const transactionStatus = t => t.status==='pending' ? ['Pending','warning'] : t.kind==='transfer' ? ['Transfer','neutral'] : t.kind==='refund' ? ['Refund','info'] : ['Posted','neutral'];
export function transactionRow(t, {selected=false,selectable=false}={}) {
  const [label,tone]=transactionStatus(t);
  return `<tr${selected?' class="is-selected"':''}>${selectable?`<td class="k-select-cell"><input type="checkbox" data-select="${esc(t.id)}" aria-label="Select ${esc(t.merchant)}"${selected?' checked':''}></td>`:''}<td><button type="button" class="k-transaction" data-transaction="${esc(t.id)}"><span class="k-monogram" aria-hidden="true">${esc(monogram(t.merchant))}</span><span class="k-transaction-text"><strong>${esc(t.merchant)}</strong><span>${esc(t.description)}</span><span class="k-mobile-meta"><span>${esc(t.category)} · ${esc(t.date)}</span><span>${badge(label,tone)}${t.review==='needed'?' '+badge('Needs review','warning'):''}</span><span>${esc(t.account)}</span></span></span></button></td><td class="k-category">${esc(t.category)}<span class="k-secondary">${esc(t.account)}</span></td><td class="k-status">${badge(label,tone)}${t.review==='needed'?' '+badge('Needs review','warning'):''}<span class="k-secondary">${esc(t.date)}</span></td><td class="k-amount">${esc(money(t.amountMinor,t.currency,true))}<span class="k-secondary">${esc(t.currency || 'AUD')}</span></td></tr>`;
}
export const STATES = Object.freeze({
 ready:{title:'Your everyday picture',body:'A small set of useful things, with the detail one step away.'},
 loading:{title:'Reading your sheet',body:'Balances are hidden until the read completes. No progress percentage is invented.'},
 empty:{title:'A home for your first account',body:'Start with a bank export. Check the rows before anything enters your ledger.'},
 partial:{title:'One account needs attention',body:'The card export is missing. Cash is shown from the confirmed bank source; total spending is unavailable.'},
 stale:{title:'These figures need a refresh',body:'Observed 20 November; last confirmed 4 November 2026. Historical rows remain visible. Refresh before planning new spending.'},
 error:{title:'Your sheet could not be read',body:'Your last saved data has not been changed. Check the connection and try again.'}
});
export function stateNotice(state) {
 const s=STATES[state]||STATES.ready;
 if(state==='ready') return '';
 const role=state==='error'?'alert':'status';
 return `<div class="k-state k-state--${esc(state)}" role="${role}">${icon(state==='loading'?'refresh':state==='error'?'warning':state==='empty'?'wallet':'info')}<div><strong>${esc(s.title)}</strong><p>${esc(s.body)}</p></div></div>`;
}
export const DEFAULT_LAYOUT = Object.freeze([{id:'cash',size:'wide'},{id:'review',size:'compact'},{id:'activity',size:'wide'},{id:'goal',size:'compact'}]);
export function normaliseLayout(input) {
 if(!Array.isArray(input)) return DEFAULT_LAYOUT.map(x=>({...x}));
 const allowed=new Set(DEFAULT_LAYOUT.map(x=>x.id)),seen=new Set(),out=[];
 for(const x of input){if(x&&allowed.has(x.id)&&!seen.has(x.id)){out.push({id:x.id,size:x.size==='wide'?'wide':'compact'});seen.add(x.id);}}
 for(const x of DEFAULT_LAYOUT)if(!seen.has(x.id))out.push({...x});
 return out;
}
export function moveWidget(layout,id,direction) {
 const out=normaliseLayout(layout),i=out.findIndex(x=>x.id===id),j=i+direction;
 if(![-1,1].includes(direction)||i<0||j<0||j>=out.length)return out;
 [out[i],out[j]]=[out[j],out[i]];return out;
}
export function reorderWidget(layout,id,beforeId) {
 const out=normaliseLayout(layout);if(id===beforeId||!out.some(x=>x.id===id)||!out.some(x=>x.id===beforeId))return out;
 const moved=out.splice(out.findIndex(x=>x.id===id),1)[0];out.splice(out.findIndex(x=>x.id===beforeId),0,moved);return out;
}

/** Use confirmed source coverage before applying UI filters; absent sources never leak into a partial view. */
export function filterByAvailableSources(rows, sourceIds) {
 const available = new Set(sourceIds);
 return rows.filter(row => available.has(row.source));
}
