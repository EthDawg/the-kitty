/** Deliberate bridge from exact boundary envelopes to the existing UI primitives. */
import {validateMetric,validateMoney} from '../contracts/kitty-contracts.mjs';
import {esc,metric,badge} from './kitty.mjs';
export function uiMinor(amount) {
 const errors=validateMoney(amount);if(errors.length)throw new TypeError(errors.join('; '));
 const digits=new Intl.NumberFormat('en-AU',{style:'currency',currency:amount.currency}).resolvedOptions().maximumFractionDigits;
 if(digits!==amount.scale)throw new RangeError('Currency scale is not supported by this renderer');
 const n=Number(amount.minor);if(!Number.isSafeInteger(n)||BigInt(n)!==BigInt(amount.minor))throw new RangeError('Amount exceeds the safe UI renderer range; keep the exact source string');
 return n;
}
function envelopeNotice(envelope) {
 const titles={loading:'Reading source data',empty:'No value supplied',partial:'Incomplete evidence',stale:'Snapshot needs refreshing',error:'Source unavailable'};
 return `<div class="k-state" role="${envelope.state==='error'?'alert':'status'}"><div><strong>${esc(titles[envelope.state]||'Source value')}</strong>${envelope.message?`<p>${esc(envelope.message)}</p>`:''}${envelope.missingInputs.length?`<p>Missing: ${esc(envelope.missingInputs.join(', '))}</p>`:''}</div></div>`;
}
export function renderMetricEnvelope(envelope) {
 const errors=validateMetric(envelope);if(errors.length)throw new TypeError(errors.join('; '));
 const {state,value}=envelope;
 if(['loading','empty','error'].includes(state))return `<section class="k-envelope">${envelopeNotice(envelope)}<p>${esc(envelope.label)}</p>${envelope.message?`<p class="k-muted">${esc(envelope.message)}</p>`:''}</section>`;
 let amount;
 try {amount=value===null?null:uiMinor(value)} catch {return `<section class="k-envelope"><h3>${esc(envelope.label)}</h3><p>Amount needs a compatible display format.</p><p class="k-muted">The exact source value is preserved. No rounded value is substituted.</p></section>`}
 return `<section class="k-envelope">${envelope.basis==='estimate'?badge('Estimate','info'):''}${state!=='ready'?envelopeNotice(envelope):''}${metric({label:envelope.label,minor:amount,currency:value?.currency||'AUD',detail:envelope.message||'',source:envelope.authority.ref,asOf:envelope.asOf,status:state==='ready'?(envelope.basis==='estimate'?'Estimate':'Source value'):state==='stale'?'Stale':'Partial'})}</section>`;
}
