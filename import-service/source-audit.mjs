import { createRequire } from 'node:module';
import { ImportError, importBaseline } from './core.mjs';
const require=createRequire(import.meta.url);
const KittyImport=require('../native-core/import.js');
const fact = row => JSON.stringify([row.date,row.accountId,row.description,row.amountMinor,row.categoryId,row.merchant,row.person]);
export async function auditSources({files,rows,state,proposal}) {
  const baseline=importBaseline(state);
  const decisions={...(proposal.decisions??{})};
  for(const row of proposal.rows??[])if(row.id && row.decision)decisions[row.originalProposalID??row.id]=row.decision;
  if(proposal.review?.acknowledged)decisions.$review={acknowledge:proposal.review.acknowledged};
  decisions.$sourceRows={...(decisions.$sourceRows??{})};
  for(const row of proposal.rows??[])if(row.distinctSource)decisions.$sourceRows[`${row.sourceId}:${row.sourceRow}`]={duplicate:'distinct'};
  const checked=KittyImport.prepare({...baseline,files,decisions});
  if(!checked.canCommit)throw new ImportError('source_review_required','The original files need review against the current Sheet. Refresh the proposal and resolve its questions.',409);
  const expected=checked.rows.map(fact).sort();
  const submitted=rows.map(fact).sort();
  if(JSON.stringify(expected)!==JSON.stringify(submitted))throw new ImportError('source_facts_mismatch','The proposed rows do not match the original files and review decisions. Nothing was written.',409);
  const identity = row=>JSON.stringify([fact(row),row.proposalId??row.id,row.identity,row.providerId??'',row.distinctSource===true]);
  if(JSON.stringify(checked.rows.map(identity).sort())!==JSON.stringify(rows.map(identity).sort()))throw new ImportError('source_identity_mismatch','The proposed source identity does not match the original files.',409);
  // Provenance is validated independently, including multiplicity across overlapping exports.
  const refs = list => list.map(r=>JSON.stringify([fact(r),(r.sourceRefs??[]).map(s=>[s.sourceId??s.fileId,s.sourceRow??s.row]).sort()])).sort();
  if(JSON.stringify(refs(checked.rows))!==JSON.stringify(refs(rows)))throw new ImportError('source_reference_mismatch','A proposed row points to the wrong source evidence.',409);
}
