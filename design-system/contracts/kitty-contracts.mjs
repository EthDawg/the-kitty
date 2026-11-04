/** Kitty staging/display contracts v1. No network, persistence, Sheet writes or tax calculations. */
export const CONTRACT_VERSION = '1.0';
export const DOMAINS = Object.freeze(['everyday','tax-readiness','property','equity','crypto','super','insurance','assets']);
export const METRIC_STATES = Object.freeze(['loading','empty','ready','partial','stale','error']);
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' && v.trim().length > 0;
const id = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const uniqueIds = a => Array.isArray(a) && a.length > 0 && a.every(id) && new Set(a).size === a.length;
const isoDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const timestamp = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(v) && !Number.isNaN(Date.parse(v)) && isoDate(v.slice(0,10));
const canonicalInt = v => typeof v === 'string' && /^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(v) && v.replace('-','').length <= 30;
const known = (v, keys, errors, path) => { for (const k of Object.keys(v)) if (!keys.includes(k)) errors.push(`${path}.${k}: unknown field`); };
const requireThat = (condition, errors, message) => { if (!condition) errors.push(message); };
const version = (v,e) => requireThat(v.schemaVersion === CONTRACT_VERSION,e,'schemaVersion: unsupported; migrate explicitly');
function money(v,e,path) {
  if (!obj(v)) { e.push(`${path}: money object required`); return; }
  known(v,['minor','currency','scale'],e,path);
  requireThat(canonicalInt(v.minor),e,`${path}.minor: canonical integer string required`);
  requireThat(typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency),e,`${path}.currency: uppercase ISO currency code required`);
  requireThat(Number.isInteger(v.scale) && v.scale >= 0 && v.scale <= 6,e,`${path}.scale: integer 0..6 required`);
  if (['AUD','USD','NZD','GBP','EUR'].includes(v.currency)) requireThat(v.scale === 2,e,`${path}.scale: supported fiat uses 2`);
}
export function validateMoney(v) { const errors=[]; money(v,errors,'money'); return errors; }
function base(v,e,keys) {
  if (!obj(v)) { e.push('object required'); return false; }
  known(v,keys,e,'record'); version(v,e); return true;
}
function provenance(v,e) {
  if (!obj(v)) { e.push('provenance: object required'); return; }
  known(v,['sourceIds','sourceLocator','importBatchId','adapterVersion','reviewStatus','reviewedBy','reviewedAt','supersedesId'],e,'provenance');
  requireThat(uniqueIds(v.sourceIds),e,'provenance.sourceIds: nonempty unique IDs required');
  requireThat(str(v.sourceLocator),e,'provenance.sourceLocator: row/page/record reference required');
  requireThat(id(v.importBatchId),e,'provenance.importBatchId: required');
  requireThat(str(v.adapterVersion),e,'provenance.adapterVersion: required');
  requireThat(['unreviewed','accepted','rejected'].includes(v.reviewStatus),e,'provenance.reviewStatus: invalid');
  if (v.reviewStatus !== 'unreviewed') {
    requireThat(id(v.reviewedBy),e,'provenance.reviewedBy: required after review');
    requireThat(timestamp(v.reviewedAt),e,'provenance.reviewedAt: UTC timestamp required after review');
  }
  if (v.supersedesId !== undefined) requireThat(id(v.supersedesId),e,'provenance.supersedesId: invalid');
}
export function validateEvidence(v) {
  const e=[];
  if (!base(v,e,['schemaVersion','sourceId','householdId','ownerIds','providerId','kind','contentSha256','fileName','mimeType','capturedAt','period','storageRef','synthetic'])) return e;
  for (const k of ['sourceId','householdId','providerId']) requireThat(id(v[k]),e,`${k}: ID required`);
  requireThat(uniqueIds(v.ownerIds),e,'ownerIds: nonempty unique IDs required');
  requireThat(['bank-export','card-export','payslip','property-statement','policy','holding-statement','asset-receipt','other'].includes(v.kind),e,'kind: unsupported evidence type');
  requireThat(typeof v.contentSha256 === 'string' && /^[a-f0-9]{64}$/.test(v.contentSha256),e,'contentSha256: lowercase SHA-256 required');
  for (const k of ['fileName','mimeType','storageRef']) requireThat(str(v[k]),e,`${k}: required`);
  requireThat(timestamp(v.capturedAt),e,'capturedAt: UTC timestamp required');
  requireThat(typeof v.synthetic === 'boolean',e,'synthetic: explicit boolean required');
  requireThat(obj(v.period) && isoDate(v.period.start) && isoDate(v.period.end) && v.period.start <= v.period.end,e,'period: ordered ISO start/end dates required');
  return e;
}
export function validateTransaction(v) {
  const e=[];
  if (!base(v,e,['schemaVersion','recordId','householdId','ownerIds','accountId','providerRecordId','descriptionRaw','merchant','categoryId','amount','postingDate','executionDate','status','flow','transferPairId','refundOfId','provenance'])) return e;
  for (const k of ['recordId','householdId','accountId']) requireThat(id(v[k]),e,`${k}: ID required`);
  requireThat(uniqueIds(v.ownerIds),e,'ownerIds: nonempty unique IDs required');
  requireThat(str(v.descriptionRaw),e,'descriptionRaw: original nonempty description required');
  if (v.providerRecordId !== null) requireThat(id(v.providerRecordId),e,'providerRecordId: ID or explicit null required');
  if (v.merchant !== null) requireThat(str(v.merchant),e,'merchant: string or explicit null required');
  if (v.categoryId !== null) requireThat(id(v.categoryId),e,'categoryId: ID or explicit null required');
  money(v.amount,e,'amount');
  requireThat(['pending','posted'].includes(v.status),e,'status: pending or posted required');
  requireThat(v.postingDate === null || isoDate(v.postingDate),e,'postingDate: ISO date or null required');
  requireThat(v.executionDate === null || isoDate(v.executionDate),e,'executionDate: ISO date or null required');
  if (v.status === 'posted') requireThat(isoDate(v.postingDate),e,'postingDate: required for posted transaction');
  if (v.status === 'pending') requireThat(v.postingDate === null,e,'pending transaction cannot claim postingDate');
  requireThat(['income','expense','transfer','refund','unknown'].includes(v.flow),e,'flow: invalid');
  if (v.flow === 'transfer') requireThat(id(v.transferPairId),e,'transferPairId: confirmed transfer relationship required');
  else requireThat(v.transferPairId === null,e,'transferPairId: must be null for non-transfer');
  if (v.refundOfId !== null) requireThat(id(v.refundOfId),e,'refundOfId: ID or null required');
  provenance(v.provenance,e);
  return e;
}
export function validateAccountBalance(v) {
  const e=[];
  if (!base(v,e,['schemaVersion','accountId','householdId','ownerIds','asOf','balanceKind','current','available','creditLimit','provenance'])) return e;
  for (const k of ['accountId','householdId']) requireThat(id(v[k]),e,`${k}: ID required`);
  requireThat(uniqueIds(v.ownerIds),e,'ownerIds: nonempty unique IDs required');
  requireThat(timestamp(v.asOf),e,'asOf: UTC timestamp required');
  requireThat(['provider-snapshot','statement-close'].includes(v.balanceKind),e,'balanceKind: invalid');
  money(v.current,e,'current');
  for (const k of ['available','creditLimit']) {
    if (v[k] !== null) { money(v[k],e,k); if (canonicalInt(v[k]?.minor)) requireThat(BigInt(v[k].minor)>=0n,e,`${k}: cannot be negative`); }
    if (obj(v[k]) && obj(v.current)) requireThat(v[k].currency===v.current.currency && v[k].scale===v.current.scale,e,`${k}: must match current currency/scale`);
  }
  provenance(v.provenance,e);
  return e;
}
export function validateMetric(v) {
  const e=[];
  if (!base(v,e,['schemaVersion','metricId','domain','label','state','value','basis','asOf','sourceIds','authority','message','missingInputs','errorCode','methodRef'])) return e;
  requireThat(id(v.metricId),e,'metricId: required');
  requireThat(DOMAINS.includes(v.domain),e,'domain: invalid');
  requireThat(str(v.label),e,'label: required');
  requireThat(METRIC_STATES.includes(v.state),e,'state: invalid');
  requireThat(['fact','estimate'].includes(v.basis),e,'basis: fact or estimate required');
  requireThat(v.asOf===null || timestamp(v.asOf),e,'asOf: UTC timestamp or null required');
  requireThat(Array.isArray(v.sourceIds) && v.sourceIds.every(id) && new Set(v.sourceIds).size===v.sourceIds.length,e,'sourceIds: unique IDs required');
  requireThat(v.authority===null || (obj(v.authority) && ['sheet','fixture'].includes(v.authority.kind) && str(v.authority.ref)),e,'authority: explicit sheet/fixture reference or null required');
  requireThat(Array.isArray(v.missingInputs) && v.missingInputs.every(str),e,'missingInputs: array of labels required');
  requireThat(v.message===null || str(v.message),e,'message: string or null required');
  requireThat(v.errorCode===null || id(v.errorCode),e,'errorCode: ID or null required');
  requireThat(v.methodRef===null || str(v.methodRef),e,'methodRef: string or null required');
  if (['loading','empty','error'].includes(v.state)) requireThat(v.value === null,e,`${v.state}: value must be null; never substitute zero`);
  if (['ready','stale','partial'].includes(v.state)) {
    if (v.value!==null) money(v.value,e,'value');
    if (v.state==='ready') requireThat(v.value!==null,e,'ready: value required');
    requireThat(timestamp(v.asOf),e,`${v.state}: asOf required`);
    requireThat(v.sourceIds?.length>0 && v.authority!==null,e,`${v.state}: source and authority required`);
  }
  if (v.state==='ready') requireThat(v.missingInputs?.length===0,e,'ready: cannot have missing inputs');
  if (['partial','stale','error','empty'].includes(v.state)) requireThat(str(v.message),e,`${v.state}: explain state and recovery`);
  if (v.state==='partial') requireThat(v.missingInputs?.length>0,e,'partial: missing input labels required');
  if (v.state==='error') requireThat(id(v.errorCode),e,'error: errorCode required');
  if (v.basis==='estimate') requireThat(str(v.methodRef),e,'estimate: methodRef required');
  return e;
}
/** Strictly maps evidence to an invitation. Never changes the canvas or writes financial data. */
export function moduleEligibility(module, context) {
  if (!obj(module) || !DOMAINS.includes(module.domain) || !Array.isArray(module.requires)) return {eligible:false, reason:'Invalid module contract'};
  if (!obj(context) || context.dismissed === true) return {eligible:false, reason:'Not requested'};
  if (context.validation !== 'accepted') return {eligible:false, reason:'Review the imported data first'};
  if (context.reconciled !== true) return {eligible:false, reason:'Reconcile the imported data first'};
  if (context.sourceAvailable !== true) return {eligible:false, reason:'Source evidence is unavailable'};
  const missing = module.requires.filter(field => !Array.isArray(context.availableFields) || !context.availableFields.includes(field));
  if (missing.length) return {eligible:false, reason:'Missing required fields', missing};
  return {eligible:true, reason:module.release==='experimental'?'Optional experimental module available':'Optional module available', action:'offer-add', autoEnable:false};
}
/** Reversible preference; import discovery alone never calls this function. */
export function applyModulePreference(previous, action, {eligible=false,experimental=false,acknowledged=false}={}) {
  if (!['off','on'].includes(previous)) throw new TypeError('Unknown prior preference');
  if (action==='hide') return 'off';
  if (action==='add' && eligible && (!experimental || acknowledged)) return 'on';
  return previous;
}
/** Holdings quantities retain provider precision; never store token units as currency cents. */
export function validateQuantity(v) {
  const e=[];
  if (!obj(v)) return ['quantity: object required'];
  known(v,['decimal','unit'],e,'quantity');
  requireThat(typeof v.decimal==='string' && /^(?:0|[1-9]\d*)(?:\.\d{1,24})?$/.test(v.decimal) && v.decimal.length<=55,e,'quantity.decimal: nonnegative decimal string, max 24 fraction digits');
  requireThat(id(v.unit),e,'quantity.unit: instrument or asset identifier required');
  return e;
}
export function validateWidget(v) {
  const e=[];
  if (!base(v,e,['schemaVersion','widgetId','domain','title','release','metricIds','sizes','states','actions','dataRequired','emptyAction'])) return e;
  requireThat(id(v.widgetId),e,'widgetId: required');
  requireThat(DOMAINS.includes(v.domain),e,'domain: invalid');
  requireThat(str(v.title),e,'title: required');
  requireThat(['foundation','experimental'].includes(v.release),e,'release: invalid');
  requireThat(Array.isArray(v.metricIds) && v.metricIds.every(id),e,'metricIds: array of IDs required');
  requireThat(Array.isArray(v.sizes) && v.sizes.length>0 && v.sizes.every(s=>['compact','wide'].includes(s)),e,'sizes: compact/wide only; renderer owns breakpoint mapping');
  requireThat(Array.isArray(v.states) && METRIC_STATES.every(s=>v.states.includes(s)),e,'states: all six data states must be designed');
  requireThat(Array.isArray(v.actions) && v.actions.every(a=>['drill','review','ask','configure','hide','move','resize'].includes(a)),e,'actions: unsupported action; widgets cannot initiate writes');
  requireThat(Array.isArray(v.dataRequired) && v.dataRequired.every(str),e,'dataRequired: array required');
  requireThat(str(v.emptyAction),e,'emptyAction: one useful next action required');
  return e;
}
/** Cross-record checks supplement shape validation; source files must be hash-verified by the importer. */
export function validateStagedBatch({evidence, transactions}) {
  const errors=[];
  if (!Array.isArray(evidence) || !Array.isArray(transactions)) return ['batch: evidence and transactions arrays required'];
  const byId=new Map();
  for(const source of evidence) {
    errors.push(...validateEvidence(source).map(x=>`source ${source?.sourceId}: ${x}`));
    if(byId.has(source?.sourceId)) errors.push(`duplicate sourceId: ${source?.sourceId}`);
    byId.set(source?.sourceId,source);
  }
  const records=new Set();
  for(const transaction of transactions) {
    errors.push(...validateTransaction(transaction).map(x=>`transaction ${transaction?.recordId}: ${x}`));
    if(records.has(transaction?.recordId)) errors.push(`duplicate recordId: ${transaction?.recordId}`);
    records.add(transaction?.recordId);
    for(const sourceId of (Array.isArray(transaction?.provenance?.sourceIds) ? transaction.provenance.sourceIds : [])) {
      const source=byId.get(sourceId);
      if(!source) errors.push(`unknown source: ${sourceId}`);
      else if(source.householdId!==transaction.householdId) errors.push(`cross-household source: ${sourceId}`);
    }
  }
  return errors;
}
