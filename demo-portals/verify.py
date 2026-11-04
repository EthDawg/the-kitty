#!/usr/bin/env python3
"""Run the deterministic local source → review → Sheet-shaped ledger → readback proof."""
import argparse,csv,json,unittest
from pathlib import Path
from pipeline import HERE,MANIFEST,ReviewRequired,stage,commit,sheet_rows,export_csv,flows,fingerprint

def run(download_dir=None):
    files=[((Path(download_dir)/Path(m['file']).name) if download_dir else HERE/'fixtures'/m['file'],m) for m in MANIFEST['core']]
    known=json.loads((HERE/'fixtures'/'known-decisions.json').read_text())
    initial=stage(files,decisions=known)
    assert initial['unresolved']==1
    try: commit(initial)
    except ReviewRequired: blocked=True
    else: raise AssertionError('Unreviewed append was allowed')
    decisions={**known,**json.loads((HERE/'fixtures'/'review-decisions.json').read_text())}
    ready=stage(files,decisions=decisions);assert ready['unresolved']==0
    local=commit(ready)
    out=HERE/'output';out.mkdir(exist_ok=True)
    (out/'staged.json').write_text(json.dumps(initial,indent=2)+'\n')
    (out/'Transactions.rows.json').write_text(json.dumps(sheet_rows(local['rows']),indent=2)+'\n')
    (out/'local-ledger.json').write_text(json.dumps(local,indent=2)+'\n')
    export_csv(out/'Transactions.csv',local['rows'])
    readback=json.loads((out/'local-ledger.json').read_text())
    assert readback==local
    repeat=stage(files,state=readback,decisions=decisions);assert len(repeat['rows'])==0
    duplicate_file=stage(files+[files[0]],decisions=decisions);assert len(duplicate_file['rows'])==len(local['rows'])
    double=[r for r in local['rows'] if r['bank_description']=='FLAT WHITE & FAIR DINKUM']
    assert len(double)==2 and double[0]['txn_id']!=double[1]['txn_id']
    totals=flows(local['rows']);assert totals['transfer_minor']==0
    balances={m['account_id']:{'opening_minor':m['opening_minor'],'closing_minor':m['opening_minor']+sum(r['amount_minor'] for r in local['rows'] if r['account_id']==m['account_id'])} for m in MANIFEST['core']}
    assert all(balances[m['account_id']]['closing_minor']==m['closing_minor'] for m in MANIFEST['core'])
    # Prove the exported table is the actual ten-column contract, not just a report.
    with (out/'Transactions.csv').open(newline='') as f: table=list(csv.reader(f))
    assert table[0]==MANIFEST['sheet_columns'] and all(len(r)==10 for r in table)
    report={'result':'passed','scope':'LOCAL DEMO ONLY — no Google Sheets or Drive write','fixture_period':MANIFEST['period'],'source_files':[{**m,'verified_sha256':fingerprint(p)} for p,m in files],'initial_unresolved':initial['unresolved'],'unreviewed_append_blocked':blocked,'committed_local_rows':len(local['rows']),'readback_equal':True,'ledger_sha256':fingerprint(out/'local-ledger.json'),'repeat_import_new_rows':len(repeat['rows']),'duplicate_batch_rows':len(duplicate_file['rows']),'duplicate_file_extra_rows':len(duplicate_file['rows'])-len(local['rows']),'repeated_charge_rows_preserved':len(double),'balances':balances,'flows':totals,'experimental_evidence_files':len(MANIFEST['evidence']),'external_provider_verification':'not_run','sheet_columns':MANIFEST['sheet_columns']}
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    (out/'readback.json').write_text(json.dumps({'transactions':[{k:r[k] for k in ['txn_id','date','account_id','bank_description','merchant','category_id','person']}|{'amount':r['amount_minor']/100,'receipt_held':None,'note':'Synthetic local fixture; not provider state'} for r in local['rows']]},indent=2)+'\n')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--download-dir',help='Directory containing the three unchanged CSVs downloaded from the demo portal');args=p.parse_args()
    suite=unittest.defaultTestLoader.discover(str(HERE/'tests'),pattern='test_*.py')
    result=unittest.TextTestRunner(verbosity=1).run(suite)
    if not result.wasSuccessful():raise SystemExit(1)
    report=run(args.download_dir)
    print(f"PASS: {report['committed_local_rows']} rows; review gate; balances; local readback; repeat import 0 new; repeated charges preserved.")
    print(f"Evidence: {HERE/'output'/'report.json'}")
    print('Google Sheets/Drive delivery: not run. Optional-domain imports: not implemented.')
