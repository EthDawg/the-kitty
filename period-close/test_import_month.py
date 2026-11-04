"""python3 -m unittest discover -s period-close: the importer's promises, on small fictional files."""
import csv
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
CARD = ['Date', 'Description', 'Card Member', 'Account #', 'Amount']
BANK = ['Date', 'Description', 'Credit', 'Debit', 'Balance']
ACCOUNTS = [{'account_id': 'ACC-CC', 'institution': 'Southern Card', 'opening_balance': 0},
            {'account_id': 'ACC-SAV', 'institution': 'Wattle Credit Union', 'opening_balance': 100}]
LAST = {'txn_id': 'T0001', 'date': '2027-01-31', 'account_id': 'ACC-SAV', 'bank_description': 'INTEREST CREDIT', 'merchant': 'Wattle CU',
        'amount': 1.0, 'category_id': 'INTEREST', 'person': 'Joint'}


def card(day, desc='MYKI TOP UP', amount='60.00'):
    return [f'{day:02d}/02/2027', desc, 'JORDAN DAVIES', '-41007', amount]


class Import(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.sheet = [LAST]

    def file(self, acct, day, head, rows):
        d = self.root / 'sources' / acct / day
        d.mkdir(parents=True, exist_ok=True)
        with open(d / 'export.csv', 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(head)
            w.writerows(rows)

    def run_import(self):
        (self.root / 'sheet.json').write_text(json.dumps({'transactions': self.sheet, 'accounts': ACCOUNTS}))
        out = self.root / 'out'
        run = subprocess.run([sys.executable, str(HERE / 'import_month.py'), '2027-02', '--sheet', str(self.root / 'sheet.json'),
                              '--sources', str(self.root / 'sources'), '--out', str(out)], capture_output=True, text=True)
        self.assertIn(run.returncode, (0, 2), run.stderr)
        return run, json.loads((out / 'rows.json').read_text()), out

    def test_overlapping_files_take_each_row_once(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(3, 'ALDI STORES COBURG', '50.00')])
        self.file('ACC-CC', '2027-03-05', CARD, [card(3, 'ALDI STORES COBURG', '50.00'), card(4, 'COLES 0457 COBURG', '20.00')])
        run, rows, _ = self.run_import()
        self.assertEqual([r[3] for r in rows], ['MYKI TOP UP', 'ALDI STORES COBURG', 'COLES 0457 COBURG'])
        self.assertIn('1 repeated across overlapping files', run.stdout)

    def test_a_genuine_double_charge_survives_one_file(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(2)])
        self.assertEqual(len(self.run_import()[1]), 2)

    def test_the_file_with_the_most_copies_decides(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.file('ACC-CC', '2027-03-05', CARD, [card(2), card(2)])
        self.assertEqual(len(self.run_import()[1]), 2)

    def test_rows_already_in_the_sheet_are_not_taken_again(self):
        self.sheet = [LAST, {**LAST, 'txn_id': 'T0002', 'date': '2027-02-02', 'account_id': 'ACC-CC', 'bank_description': 'MYKI TOP UP', 'amount': -60.0}]
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(2)])
        self.assertEqual(len(self.run_import()[1]), 1)

    def test_a_matching_closing_balance_passes(self):
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '600.00', '', '701.00']])
        run, rows, _ = self.run_import()
        self.assertEqual(run.returncode, 0)
        self.assertEqual(len(rows), 1)
        self.assertIn('file 701.00, ledger 701.00, OK', run.stdout)

    def test_a_closing_balance_gap_holds_the_rows(self):
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '600.00', '', '801.00']])
        run, rows, out = self.run_import()
        self.assertEqual(run.returncode, 2)
        self.assertEqual(rows, [])
        self.assertEqual(len(json.loads((out / 'rows.held.json').read_text())), 1)
        self.assertIn('HOLD', run.stdout)
        self.assertIn('MISMATCH of -100.00', run.stdout)

    def test_a_format_without_a_balance_says_so(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.assertIn('not checked, this format prints no balance', self.run_import()[0].stdout)


if __name__ == '__main__':
    unittest.main()
