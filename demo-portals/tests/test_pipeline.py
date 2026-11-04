import copy,csv,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from pipeline import *
class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.files=[(HERE/'fixtures'/m['file'],m) for m in MANIFEST['core']]
        self.decisions={**json.loads((HERE/'fixtures'/'known-decisions.json').read_text()),**json.loads((HERE/'fixtures'/'review-decisions.json').read_text())}
    def test_all_three_existing_adapters_match_decimal(self):
        for p,m in self.files:
            rows=load_file(p,m);self.assertEqual(len(rows),m['rows']);self.assertEqual(sum(r['amount_minor'] for r in rows),m['closing_minor']-m['opening_minor'])
    def test_repeat_import_has_zero_new_rows(self):
        state=commit(stage(self.files,decisions=self.decisions));self.assertEqual(stage(self.files,state,self.decisions)['rows'],[])
    def test_duplicate_file_is_ignored_but_repeated_rows_survive(self):
        s=stage(self.files+[self.files[1]],decisions=self.decisions)
        self.assertEqual(len(s['rows']),13);self.assertEqual(sum(r['bank_description']=='FLAT WHITE & FAIR DINKUM' for r in s['rows']),2)
    def test_missing_review_prevents_append(self):
        s=stage(self.files)
        with self.assertRaises(ReviewRequired):commit(s)
    def test_unknown_category_rejected(self):
        d=copy.deepcopy(self.decisions);d['INTEREST CREDIT']['category_id']='DOES-NOT-EXIST'
        with self.assertRaises(ValueError):stage(self.files,decisions=d)
    def test_money_rejects_invalid_precision_nan_inf(self):
        self.assertEqual(minor('0.10')+minor('0.20'),30)
        for n in ['1.001','NaN','Infinity','abc']:
            with self.assertRaises(ValueError):minor(n)
    def test_tampered_source_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'changed.csv';p.write_bytes(self.files[0][0].read_bytes()+b'\n')
            with self.assertRaises(ValueError):load_file(p,self.files[0][1])
    def test_different_overlapping_source_is_held(self):
        state=commit(stage(self.files,decisions=self.decisions))
        state['sources']=[]
        with self.assertRaises(ReviewRequired):stage(self.files,state,self.decisions)
    def test_transfer_pairs_excluded_from_income(self):
        totals=flows(stage(self.files,decisions=self.decisions)['rows'])
        self.assertEqual(totals['income_minor'],400525);self.assertEqual(totals['transfer_minor'],0)
    def test_sheet_contract_and_formula_safety(self):
        rows=commit(stage(self.files,decisions=self.decisions))['rows'];self.assertTrue(all(len(r)==10 for r in sheet_rows(rows)))
        self.assertEqual(safe_csv_cell('=1+1'),"'=1+1");self.assertEqual(safe_csv_cell('Normal description'),'Normal description')
    def test_invalid_header_date_and_money_fail_closed(self):
        p,meta=self.files[0]
        for old,new in [('Bank Account','Unknown column'),('01/02/2027','31/02/2027'),('4000.00','4000.001')]:
            with self.subTest(case=old), tempfile.TemporaryDirectory() as d:
                changed=Path(d)/'bad.csv';changed.write_text(p.read_text().replace(old,new,1))
                adapted=dict(meta);adapted['sha256']=fingerprint(changed)
                with self.assertRaises(ValueError):load_file(changed,adapted)
    def test_csv_formula_text_is_escaped_but_raw_json_retained(self):
        rows=commit(stage(self.files,decisions=self.decisions))['rows']
        rows[0]['bank_description']='=HYPERLINK("https://example.invalid","Click")'
        raw=sheet_rows(rows)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'export.csv';export_csv(p,rows)
            with p.open(newline='') as f: exported=list(csv.reader(f))
            self.assertEqual(raw[0][3][0],'=')
            self.assertEqual(exported[1][3][0],"'")
    def test_fixture_hashes_cover_optional_documents(self):
        for m in MANIFEST['evidence']:
            self.assertEqual(fingerprint(HERE/'fixtures'/m['file']),m['sha256'])
if __name__=='__main__':unittest.main()
