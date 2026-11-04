/** Bind the displayed ledger bytes to the successful local verifier's exact artifact. */
export async function sha256Text(text) {
 const bytes=new TextEncoder().encode(text);
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function verifiedLedger(report, rawText, hash = sha256Text) {
 if(report?.result!=='passed'||report.readback_equal!==true||!Number.isSafeInteger(report.committed_local_rows)||!/^([a-f0-9]{64})$/.test(report.ledger_sha256||''))throw Error('Readback verification unavailable');
 if(await hash(rawText)!==report.ledger_sha256)throw Error('Ledger changed after verification; rerun the verifier');
 const ledger=JSON.parse(rawText);
 if(!Array.isArray(ledger.rows)||ledger.rows.length!==report.committed_local_rows)throw Error('Ledger row count mismatch');
 for(const row of ledger.rows)if(!Number.isSafeInteger(row.amount_minor))throw Error('Invalid display precision');
 return ledger;
}
