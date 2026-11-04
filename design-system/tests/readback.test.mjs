import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {verifiedLedger} from '../../demo-portals/readback.mjs';
const hash=async s=>createHash('sha256').update(s).digest('hex');
const raw=JSON.stringify({rows:[{amount_minor:12345,category_id:'GROCERIES'}]});
const report={result:'passed',readback_equal:true,committed_local_rows:1,ledger_sha256:await hash(raw)};
test('display accepts exactly the bytes checked by the local verifier',async()=>assert.equal((await verifiedLedger(report,raw,hash)).rows[0].amount_minor,12345));
test('same row count with changed cents or category invalidates readback',async()=>{await assert.rejects(verifiedLedger(report,raw.replace('12345','12346'),hash));await assert.rejects(verifiedLedger(report,raw.replace('GROCERIES','SHOPPING'),hash));});
test('legacy report without bound ledger hash cannot claim verified',async()=>await assert.rejects(verifiedLedger({...report,ledger_sha256:null},raw,hash)));
