"""python3 -m unittest discover -s period-close (or python3 period-close/test_import.py): the importer's promises, on
small fictional files, standard library only. Every audited fault has a test here that fails on the old importer."""
import csv
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import writeplan as W  # noqa: E402

CARD = ['Date', 'Description', 'Card Member', 'Account #', 'Amount']
BANK = ['Date', 'Description', 'Credit', 'Debit', 'Balance']
WESTPAC = ['Bank Account', 'Date', 'Narrative', 'Debit Amount', 'Credit Amount', 'Balance', 'Categories', 'Serial']
OWNER = ['Date', 'Description', 'Rental schedule line', 'Money in', 'Money out', 'Handled by']
PAYSLIPS = ['Pay date', 'Person', 'Employer', 'Gross pay', 'Tax withheld', 'Super (employer)', 'Net pay']
CATS = [{'category_id': c, 'category': c, 'group': g, 'flow': f} for c, g, f in [
    ('SUBS', 'Lifestyle', 'Expense'), ('GROCERIES', 'Essentials', 'Expense'), ('MORTGAGE', 'Housing', 'Expense'), ('RENT-INC', 'Property', 'Income'),
    ('RENT-MGMT', 'Property', 'Expense'), ('RENT-INT', 'Property', 'Expense'), ('INTEREST', 'Income', 'Income'), ('TRANSFER', 'Transfers', 'Transfer'),
    ('CC-PAY', 'Transfers', 'Transfer'), ('UNCAT', 'Uncategorised', 'Expense')]]
ACCOUNTS = [{'account_id': 'ACC-CC', 'institution': 'Southern Card', 'type': 'Credit card', 'opening_balance': 0, 'opening_date': '2025-06-30'},
            {'account_id': 'ACC-SAV', 'institution': 'Wattle Credit Union', 'type': 'Savings', 'opening_balance': 100, 'opening_date': '2025-06-30'},
            {'account_id': 'ACC-EVD', 'institution': 'Harbour Bank', 'type': 'Transaction', 'opening_balance': 10000, 'opening_date': '2025-06-30'},
            {'account_id': 'ACC-RNT', 'institution': 'Harbour Bank', 'type': 'Transaction', 'opening_balance': 3000, 'opening_date': '2025-06-30', 'linked_account': 'RENTAL'},
            {'account_id': 'ACC-OLD', 'institution': 'Bark Bank', 'type': 'Transaction', 'opening_balance': 1000, 'opening_date': '2025-06-30'},
            {'account_id': 'LN-HOME', 'institution': 'Harbour Bank', 'type': 'Loan', 'opening_balance': -600000, 'opening_date': '2025-06-30', 'valuation_method': 'statement', 'owner': 'Joint'},
            {'account_id': 'RENTAL', 'institution': None, 'type': 'Property', 'opening_balance': 736000, 'opening_date': '2025-06-30', 'valuation_method': 'appraisal'},
            {'account_id': 'HOME', 'institution': None, 'type': 'Property', 'opening_balance': 1185000, 'opening_date': '2025-06-30', 'valuation_method': 'appraisal'}]
CONTRACTS = [{'contract_id': 'C0001', 'kind': 'loan', 'name': 'Home loan terms', 'provider': 'Harbour Bank', 'owner': 'Joint', 'account_id': 'LN-HOME', 'category_id': 'MORTGAGE'},
             {'contract_id': 'C0002', 'kind': 'insurance', 'name': 'Landlord insurance', 'provider': 'EBM', 'owner': 'Joint', 'account_id': 'RENTAL', 'category_id': 'RENT-INS',
              'amount': 1702, 'start_date': None, 'end_date': None, 'next_date': '2027-09-15'}]
RULES = [{'rule_id': 'R0001', 'pattern': 'TRANSFER TO SAVER', 'match': 'normalised', 'merchant': 'Internal transfer', 'category_id': 'TRANSFER', 'person': 'Joint'},
         {'rule_id': 'R0002', 'pattern': 'TRANSFER FROM EVERYDAY', 'match': 'normalised', 'merchant': 'Internal transfer', 'category_id': 'TRANSFER', 'person': 'Joint'},
         {'rule_id': 'R0003', 'pattern': 'HOME LOAN REPAYMENT', 'match': 'normalised', 'merchant': 'Harbour Bank', 'category_id': 'MORTGAGE', 'person': 'Joint'},
         {'rule_id': 'R0004', 'pattern': 'BAYSIDE PROPERTY MGMT RENT', 'match': 'normalised', 'merchant': 'Bayside', 'category_id': 'RENT-INC', 'person': 'Joint'},
         {'rule_id': 'R0005', 'pattern': 'BAYSIDE PROPERTY MGMT FEE', 'match': 'normalised', 'merchant': 'Bayside', 'category_id': 'RENT-MGMT', 'person': 'Joint'}]
LAST = {'txn_id': 'T0001', 'date': '2027-01-31', 'account_id': 'ACC-SAV', 'bank_description': 'INTEREST CREDIT', 'merchant': 'Wattle CU', 'amount': 1.0, 'category_id': 'INTEREST', 'person': 'Joint'}


def entry(t, i=None):
    """A 1.1 transaction dict as an Entries row dict."""
    return {'entry_id': t['txn_id'], 'kind': 'transaction', 'settled_at': t['date'], 'account_id': t['account_id'], 'raw_text': t['bank_description'], 'description': t['merchant'],
            'amount': t['amount'], 'category_id': t['category_id'], 'person': t.get('person'), 'receipt_held': None, 'note': None, 'status': 'settled', 'created_at': t['date'],
            'transfer_id': t.get('transfer_id'), 'transfer_account': t.get('transfer_account'), 'foreign_amount': None, 'foreign_currency': None, 'units': None, 'unit_price': None, 'source': 'bank export'}


def card(day, desc='MYKI TOP UP', amount='60.00', month='02'):
    return [f'{day:02d}/{month}/2027', desc, 'JORDAN DAVIES', '-41007', amount]


def westpac(day, desc, debit='', credit='', balance='0.00', number='033-142 812 004 771', month='02'):
    return [number, f'{day:02d}/{month}/2027', desc, debit, credit, balance, '', '']


class Base(unittest.TestCase):
    version = 2

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.sheet_tx = [LAST]
        self.valuations = []
        self.payslips = []
        self.contracts = CONTRACTS
        self.extra = {}

    def file(self, acct, day, head, rows, name='export.csv', bom=False, raw=None):
        d = self.root / 'sources' / acct / day
        d.mkdir(parents=True, exist_ok=True)
        p = d / name
        if raw is not None:
            p.write_bytes(raw)
            return p
        with open(p, 'w', newline='', encoding='utf-8-sig' if bom else 'utf-8') as f:
            w = csv.writer(f)
            if head:
                w.writerow(head)
            w.writerows(rows)
        return p

    def snapshot(self):
        doc = {'accounts': ACCOUNTS, 'category_list': CATS, 'payslips': self.payslips, 'contracts': self.contracts, 'rules': RULES}
        if self.version == 2:
            doc['entries'] = [entry(t) for t in self.sheet_tx] + [{'entry_id': f'V{i + 1:04d}', 'kind': 'valuation', 'settled_at': v[1], 'account_id': v[0], 'amount': v[2], 'status': 'settled', 'created_at': v[1], 'source': 'statement'} for i, v in enumerate(self.valuations)]
        else:
            doc['transactions'] = self.sheet_tx
        doc.update(self.extra)
        (self.root / 'sheet.json').write_text(json.dumps(doc))
        return self.root / 'sheet.json'

    def run_import(self, *more, month='2027-02', expect=(0, 2), out='out', sources='sources'):
        out_dir = self.root / out
        run = subprocess.run([sys.executable, str(HERE / 'import_month.py'), month, '--sheet', str(self.snapshot()), '--sources', str(self.root / sources), '--out', str(out_dir), *more],
                             capture_output=True, text=True)
        self.assertIn(run.returncode, expect, run.stdout + run.stderr)
        rows = json.loads((out_dir / 'rows.json').read_text()) if (out_dir / 'rows.json').exists() else None
        plan = json.loads((out_dir / 'write-plan.json').read_text()) if (out_dir / 'write-plan.json').exists() else None
        return run, rows, out_dir, plan


class Dedupe(Base):
    def test_overlapping_files_take_each_row_once(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(3, 'ALDI STORES COBURG', '50.00')])
        self.file('ACC-CC', '2027-03-05', CARD, [card(3, 'ALDI STORES COBURG', '50.00'), card(4, 'COLES 0457 COBURG', '20.00')])
        run, rows, _, _ = self.run_import()
        self.assertEqual([r[3] for r in rows], ['MYKI TOP UP', 'ALDI STORES COBURG', 'COLES 0457 COBURG'])
        self.assertIn('1 repeated across overlapping files', run.stdout)

    def test_a_calendar_month_and_a_statement_of_the_same_card_do_not_duplicate(self):
        month = [card(d, f'SHOP {d}', f'{d}.00') for d in range(1, 29)]
        self.file('ACC-CC', '2027-03-01', CARD, month, name='activity.csv')
        statement = [card(d, f'SHOP {d}', f'{d}.00') for d in range(15, 29)] + [card(d, f'MARCH {d}', '9.00', month='03') for d in range(1, 15)]
        self.file('ACC-CC', '2027-03-16', CARD, statement, name='activity.csv')
        run, rows, _, plan = self.run_import()
        self.assertEqual(len(rows), 28)
        self.assertEqual(len({(r[1], r[3]) for r in rows}), 28)
        self.assertIn('14 repeated across overlapping files', run.stdout)
        self.assertIn('14 later, left for their month', run.stdout)
        self.assertEqual(plan['totals']['rows_written'], 28)

    def test_a_genuine_double_charge_survives_one_file(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(2)])
        self.assertEqual(len(self.run_import()[1]), 2)

    def test_the_file_with_the_most_copies_decides_never_the_sum(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.file('ACC-CC', '2027-03-05', CARD, [card(2), card(2)])
        self.assertEqual(len(self.run_import()[1]), 2)

    def test_rows_already_in_the_sheet_are_not_taken_again_by_identity(self):
        self.sheet_tx = [LAST, {**LAST, 'txn_id': 'T0002', 'date': '2027-02-02', 'account_id': 'ACC-CC', 'bank_description': 'myki  top up', 'amount': -60.0}]
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(2)])
        run, rows, _, _ = self.run_import()
        self.assertEqual(len(rows), 1, 'case and spacing do not make a new identity')
        self.assertIn('1 already in the sheet', run.stdout)

    def test_a_repeated_month_plans_nothing(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(3, 'ALDI STORES COBURG', '50.00')])
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '600.00', '', '701.00']])
        run, rows, out, plan = self.run_import()
        self.assertEqual(plan['status'], 'ready')
        self.assertEqual(len(rows), 3)
        for r in rows:
            self.sheet_tx.append(dict(zip(['txn_id', 'date', 'account_id', 'bank_description', 'merchant', 'amount', 'category_id', 'person', 'receipt_held', 'note'], r)))
        run2, rows2, _, plan2 = self.run_import(out='out2')
        self.assertEqual(rows2, [])
        self.assertIn('0 rows to append; 3 already in the sheet', run2.stdout)
        self.assertEqual(plan2['writes'], [])
        self.assertEqual(plan2['totals']['rows_written'], 0)


class FailLoud(Base):
    def stop(self, *more, month='2027-02', sources='sources'):
        run, rows, out, plan = self.run_import(*more, month=month, expect=(1,), sources=sources)
        self.assertIn('STOPPED: nothing was planned', run.stdout)
        self.assertIn('What to do:', run.stdout)
        self.assertEqual(rows, [])
        self.assertEqual(plan['status'], 'stopped')
        self.assertEqual(plan['writes'], [])
        return run.stdout

    def test_an_unknown_account_folder_stops_the_run(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.file('ACC-NEW', '2027-03-01', CARD, [card(3)])
        text = self.stop()
        self.assertIn('unknown account folder', text)
        self.assertIn('ACC-NEW', text)
        self.assertIn('Accounts tab', text)

    def test_an_unrecognised_shape_stops_the_run(self):
        self.file('ACC-CC', '2027-03-01', ['When', 'What', 'How much'], [['2/2/2027', 'x', '1']])
        self.assertIn('unrecognised shape', self.stop())

    def test_signed_card_amount_cannot_be_blank_or_whitespace_but_explicit_zero_is_a_transaction(self):
        for amount in ['', ' \t ']:
            with self.subTest(amount=amount):
                self.file('ACC-CC', '2027-03-01', CARD, [card(2, amount=amount)])
                self.assertIn('missing signed card amount', self.stop())
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, amount='0.00')])
        _, rows, _, plan = self.run_import(expect=(0,))
        self.assertEqual([row[5] for row in rows], [0])
        self.assertEqual(plan['totals']['rows_written'], 1)

    def test_literal_apostrophe_before_formula_sign_stops_the_whole_bank_plan(self):
        for sign in '=+-@':
            with self.subTest(sign=sign):
                self.file('ACC-CC', '2027-03-01', CARD, [card(1), card(2, "  '" + sign + 'LITERAL,\nCARD')], bom=True)
                self.assertIn('literal apostrophe', self.stop())

    def test_a_header_mismatch_names_the_missing_column(self):
        self.file('ACC-CC', '2027-03-01', ['Date', 'Description', 'Card Member', 'Amount'], [['02/02/2027', 'MYKI', 'J', '60.00']])
        text = self.stop()
        self.assertIn('header mismatch', text)
        self.assertIn("'Account #'", text)

    def test_a_file_from_another_institution_in_the_folder_stops_the_run(self):
        self.file('ACC-CC', '2027-03-01', BANK, [['02/02/2027', 'X', '1.00', '', '1.00']])
        self.assertIn('Wattle Credit Union file in the ACC-CC folder', self.stop())

    def test_a_pdf_without_an_adapter_stops_the_run(self):
        self.file('ACC-CC', '2027-03-01', None, None, name='statement.pdf', raw=b'%PDF-1.7\n1 0 obj\n<< >>\nendobj\n%%EOF\n')
        text = self.stop()
        self.assertIn('a PDF with no adapter', text)
        self.assertIn('download the CSV export', text)

    def test_an_unreadable_policy_pdf_needs_a_person(self):
        self.file('POL-RENTAL', '2026-09-16', None, None, name='renewal.pdf', raw=b'%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
        self.assertIn('this PDF needs a person', self.stop())

    def test_an_empty_file_stops_the_run(self):
        self.file('ACC-CC', '2027-03-01', None, None, name='activity.csv', raw=b'')
        self.assertIn('empty file (zero bytes)', self.stop())

    def test_a_header_only_export_is_not_a_fault(self):
        self.file('ACC-CC', '2027-03-01', CARD, [])
        run, rows, _, _ = self.run_import(expect=(0,))
        self.assertIn('header only, no rows', run.stdout)
        self.assertEqual(rows, [])

    def test_a_folder_that_is_not_a_download_date_stops_the_run(self):
        self.file('ACC-CC', 'march', CARD, [card(2)])
        self.assertIn('is not a download date', self.stop())

    def test_a_month_first_date_fails_loud(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), ['02/13/2027', 'TARGET', 'J', '-41007', '10.00']])
        text = self.stop()
        self.assertIn('13 is not a month', text)
        self.assertIn('day first', text)
        self.assertIn('row 3', text)

    def test_a_day_that_does_not_exist_fails_loud(self):
        self.file('ACC-CC', '2027-03-01', CARD, [['30/02/2027', 'TARGET', 'J', '-41007', '10.00']])
        self.assertIn('no such day', self.stop())

    def test_a_row_after_the_download_date_fails_loud(self):
        self.file('ACC-CC', '2027-02-10', CARD, [card(5), card(15)])
        text = self.stop()
        self.assertIn('row dated 2027-02-15 in a file downloaded on 2027-02-10', text)

    def test_a_row_after_the_as_of_date_fails_loud(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(5), card(25)])
        self.assertIn('after the as-of date 2027-02-20', self.stop('--as-of', '2027-02-20'))

    def test_a_row_before_the_account_opened_fails_loud(self):
        self.file('ACC-CC', '2027-03-01', CARD, [['02/02/2025', 'OLD', 'J', '-41007', '10.00'], card(2)])
        self.assertIn('before the account opened on 2025-06-30', self.stop())

    def test_a_file_ending_before_the_account_opened_is_history_not_a_fault(self):
        self.file('ACC-CC', '2025-03-02', CARD, [['02/02/2025', 'OLD', 'J', '-41007', '10.00']])
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        run, rows, _, plan = self.run_import()
        self.assertEqual(plan['status'], 'ready')
        self.assertEqual(len(rows), 1)
        self.assertNotIn('OLD', str(rows))

    def test_importing_a_month_before_the_account_opened_still_stops(self):
        self.file('ACC-CC', '2025-03-02', CARD, [['02/02/2025', 'OLD', 'J', '-41007', '10.00']])
        self.assertIn('before the account opened on 2025-06-30', self.stop(month='2025-02'))

    def test_dates_that_zigzag_fail_loud(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(9), card(4)])
        self.assertIn('dates run out of order', self.stop())

    def test_a_bom_is_accepted_and_noted(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(3, 'ALDI STORES COBURG', '50.00')], bom=True)
        run, rows, _, _ = self.run_import(expect=(0,))
        self.assertEqual(len(rows), 2)
        self.assertIn('byte order mark accepted', run.stdout)

    def test_a_valuation_for_an_unknown_item_stops_the_run(self):
        inputs = self.root / 'inputs'
        inputs.mkdir()
        (inputs / 'valuations.csv').write_text('Month end,Item ID,Value\n2027-02-28,BOAT,1000\n')
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.assertIn("'BOAT' is not on the Accounts tab", self.stop('--inputs', str(inputs)))


class Shapes(Base):
    def test_the_cba_shape_reads_newest_first_and_reconciles(self):
        lines = ['28/02/2027,"+0.05","CREDIT INTEREST","+996.05"', '03/02/2027,"-4.00","MONTHLY ACCOUNT FEE","+996.00"']
        self.file('ACC-OLD', '2027-03-02', None, None, name='CSVData.csv', raw=('\r\n'.join(lines) + '\r\n').encode())
        run, rows, _, _ = self.run_import(expect=(0,))
        self.assertEqual([(r[1], r[5]) for r in rows], [('2027-02-03', -4.0), ('2027-02-28', 0.05)])
        self.assertIn('2027-02-28 file 996.05, ledger 996.05, OK', run.stdout)

    def test_a_matching_closing_balance_passes(self):
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '600.00', '', '701.00']])
        run, rows, _, _ = self.run_import(expect=(0,))
        self.assertEqual(len(rows), 1)
        self.assertIn('file 701.00, ledger 701.00, OK', run.stdout)

    def test_a_closing_balance_gap_holds_the_rows(self):
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '600.00', '', '801.00']])
        run, rows, out, plan = self.run_import(expect=(2,))
        self.assertEqual(rows, [])
        self.assertEqual(len(json.loads((out / 'rows.held.json').read_text())), 1)
        self.assertEqual(json.loads((out / 'entries.json').read_text()), [])
        self.assertEqual(len(json.loads((out / 'entries.held.json').read_text())), 1)
        self.assertIn('HOLD', run.stdout)
        self.assertIn('MISMATCH of -100.00', run.stdout)
        self.assertEqual(plan['status'], 'hold')
        self.assertEqual(plan['writes'], [])
        self.assertTrue(plan['held_writes'])

    def test_a_format_without_a_balance_says_so(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.assertIn('not checked, this format prints no balance', self.run_import()[0].stdout)

    def test_transfers_between_own_accounts_are_paired(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(2, 'TRANSFER TO SAVER', debit='500.00', balance='9500.00')], name='Data.csv')
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '601.00']])
        run, rows, out, plan = self.run_import(expect=(0,))
        entries = json.loads((out / 'entries.json').read_text())
        pairs = {(e[3], e[13], e[14]) for e in entries}
        self.assertEqual(pairs, {('ACC-EVD', 'X0001', 'ACC-SAV'), ('ACC-SAV', 'X0001', 'ACC-EVD')})
        self.assertIn('X0001:', run.stdout)

    def test_the_loan_statement_pairs_the_repayment_and_values_the_loan(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(1, 'HOME LOAN REPAYMENT', debit='3000.00', balance='7000.00')], name='Data.csv')
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(1, 'REPAYMENT RECEIVED', credit='3000.00', balance='-597000.00', number='033-142 812 006 310'),
                                                    westpac(28, 'INTEREST CHARGED', debit='2500.00', balance='-599500.00', number='033-142 812 006 310')], name='Westpaw-Loan-LN-HOME-20270228.csv')
        run, rows, out, plan = self.run_import(expect=(0,))
        self.assertEqual(len(rows), 1)
        # the closing balance is a month-end valuation, written now
        entries = json.loads((out / 'entries.json').read_text())
        vals = [e for e in entries if e[1] == 'valuation']
        self.assertEqual([(v[0], v[2], v[3], v[6], v[19]) for v in vals], [('V0001', '2027-02-28', 'LN-HOME', -599500.0, 'statement')])
        # the loan's own lines wait for phase D: interest as a transaction on the loan, the repayment as the mate of the bank row
        self.assertEqual(plan['status'], 'ready')
        deferred = plan['deferred']
        loan_rows = [r for w in deferred if w['op'] == 'append' for r in w['values']]
        self.assertEqual([(r[3], r[4], r[6], r[7], r[13], r[14]) for r in loan_rows],
                         [('LN-HOME', 'REPAYMENT RECEIVED', 3000.0, 'TRANSFER', 'X0001', 'ACC-EVD'), ('LN-HOME', 'INTEREST CHARGED', -2500.0, 'MORTGAGE', '', '')])
        pair = [w for w in deferred if w['op'] == 'update']
        self.assertEqual(len(pair), 1)
        self.assertEqual(pair[0]['range'], 'Entries!H3:O3', 'the bank row planned at row 3 (after the one sheet row) gets category TRANSFER and the transfer id')
        self.assertEqual(pair[0]['values'][0], ['TRANSFER', None, None, None, None, None, 'X0001', 'LN-HOME'])
        self.assertIn('Phase D decides', deferred[0]['why'])
        self.assertIn('repayment received, mate T0002', run.stdout)
        # --loans now writes them with the month, and the bank row carries the pairing itself
        run2, rows2, out2, plan2 = self.run_import('--loans', 'now', expect=(0,), out='out2')
        self.assertEqual(plan2['deferred'], [])
        entries2 = json.loads((out2 / 'entries.json').read_text())
        self.assertEqual(len(entries2), 4)
        bank = next(e for e in entries2 if e[3] == 'ACC-EVD')
        self.assertEqual((bank[7], bank[13], bank[14]), ('TRANSFER', 'X0001', 'LN-HOME'))

    def test_the_owner_statement_reconciles_against_the_rental_account(self):
        self.file('ACC-RNT', '2027-03-01', WESTPAC, [westpac(5, 'BAYSIDE PROPERTY MGMT RENT FEB', credit='2470.00', balance='5470.00', number='033-142 812 005 120'),
                                                    westpac(5, 'BAYSIDE PROPERTY MGMT FEE', debit='163.02', balance='5306.98', number='033-142 812 005 120')], name='Data.csv')
        stmt = [['05/02/2027', 'BAYSIDE PROPERTY MGMT RENT FEB', 'Gross rent', '2470.00', '', 'PropertyMeow'], ['05/02/2027', 'BAYSIDE PROPERTY MGMT FEE', 'Property agent fees and commission', '', '163.02', 'PropertyMeow']]
        self.file('RENTAL', '2027-03-01', OWNER, stmt, name='PropertyMeow-OwnerStatement-RENTAL-20270228.csv')
        run, rows, out, plan = self.run_import(expect=(0,))
        self.assertEqual(len(rows), 2)
        self.assertIn('2 lines in 2027-02, 2 match bank rows on ACC-RNT', run.stdout)
        self.assertEqual(plan['status'], 'ready')
        # a line the bank does not show holds the run and points at the clearing-account path
        stmt.append(['20/02/2027', 'PLUMBER, DEDUCTED FROM RENT', 'Repairs and maintenance', '', '240.00', 'PropertyMeow'])
        self.file('RENTAL', '2027-03-01', OWNER, stmt, name='PropertyMeow-OwnerStatement-RENTAL-20270228.csv')
        run2, rows2, out2, plan2 = self.run_import(expect=(2,), out='out2')
        self.assertIn('HOLD', run2.stdout)
        self.assertIn('has no bank row on ACC-RNT', run2.stdout)
        self.assertIn('clearing-account path', run2.stdout)
        self.assertEqual(rows2, [])

    def test_payslips_dedupe_by_pay_date_person_and_employer(self):
        self.payslips = [{'pay_date': '2027-02-04', 'person': 'Mia', 'employer': 'Bayview Health', 'gross_pay': 3090.0, 'tax_withheld': 632.0, 'super': 370.8, 'net_pay': 2458.0}]
        rows = [['2027-02-04', 'Mia', 'Bayview Health', '3090.00', '632.00', '370.80', '2458.00'], ['2027-02-18', 'Mia', 'Bayview Health', '3090.00', '632.00', '370.80', '2458.00']]
        self.file('payslips', '2027-03-02-mia', PAYSLIPS, rows, name='payslips.csv')
        self.file('payslips', '2027-03-02-mia-again', PAYSLIPS, rows, name='payslips.csv')
        run, _, _, plan = self.run_import(expect=(0,))
        pays = [w for w in plan['writes'] if w['tab'] == 'Payslips']
        self.assertEqual(len(pays), 1)
        self.assertEqual(pays[0]['range'], 'Payslips!A3:G3')
        self.assertEqual(pays[0]['values'], [['2027-02-18', 'Mia', 'Bayview Health', 3090.0, 632.0, 370.8, 2458.0]])
        self.assertIn('2 payslips in 2027-02, 1 new', run.stdout)
        self.assertIn('2 payslips in 2027-02, 0 new', run.stdout)

    def test_a_valuation_that_disagrees_with_the_sheet_holds(self):
        self.valuations = [('HOME', '2027-02-28', 1200000.0)]
        inputs = self.root / 'inputs'
        inputs.mkdir()
        (inputs / 'valuations.csv').write_text('Month end,Item ID,Value\n2027-02-28,HOME,1250000\n2027-02-28,RENTAL,771000\n')
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        run, rows, _, plan = self.run_import('--inputs', str(inputs), expect=(2,))
        self.assertIn('HOME at 2027-02-28 is 1,250,000.00, the sheet already holds 1,200,000.00', run.stdout)
        self.assertEqual(plan['status'], 'hold')

    def test_the_insurer_renewal_plans_a_contract_update_and_the_certificate_confirms(self):
        import shutil
        d = self.root / 'sources' / 'POL-RENTAL' / '2026-09-16'
        d.mkdir(parents=True)
        shutil.copy(HERE / 'fixtures' / 'Purrsure-RenewalNotice-RENTAL-2026.pdf', d / 'Purrsure-RenewalNotice-RENTAL-2026.pdf')
        d2 = self.root / 'sources' / 'POL-HOME' / '2026-03-04'
        d2.mkdir(parents=True)
        shutil.copy(HERE / 'fixtures' / 'Purrsure-CertificateOfCurrency-HOME-2026.pdf', d2 / 'Purrsure-CertificateOfCurrency-HOME-2026.pdf')
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        run, rows, _, plan = self.run_import(expect=(0,))
        ups = [w for w in plan['writes'] if w['tab'] == 'Contracts']
        self.assertEqual(len(ups), 1)
        self.assertEqual(ups[0]['range'], 'Contracts!I3:M3')
        self.assertEqual(ups[0]['values'][0], [1702.0, None, '2026-09-15', '2027-09-14', '2027-09-15'])
        self.assertEqual(ups[0]['precondition'], {'range': 'Contracts!A3', 'expect': [['C0002']]})
        self.assertIn('Building sum insured A$520,000.00', run.stdout)
        self.assertIn('certificate of currency', run.stdout)
        self.assertIn('no insurance row for HOME', run.stdout)


class Plan(Base):
    def test_the_plan_appends_from_the_next_empty_row_in_chunks_of_500(self):
        self.sheet_tx = [LAST] + [{**LAST, 'txn_id': f'T{i:04d}', 'date': '2027-01-30'} for i in range(2, 12)]  # 11 entries: rows 2..12, next empty 13
        rows = [card(1 + i % 28, f'SHOP {i}', f'{1 + i % 90}.00') for i in range(1200)]
        rows.sort(key=lambda r: int(r[0][:2]))
        self.file('ACC-CC', '2027-03-01', CARD, rows)
        run, out_rows, out, plan = self.run_import(expect=(0,))
        self.assertEqual(len(out_rows), 1200)
        appends = [w for w in plan['writes'] if w['tab'] == 'Entries']
        self.assertEqual([(w['range'], w['rows']) for w in appends], [('Entries!A13:T512', 500), ('Entries!A513:T1012', 500), ('Entries!A1013:T1212', 200)])
        self.assertEqual(plan['preconditions'][0], {'range': 'Entries!A12:A13', 'expect': [['T0011'], []], 'why': plan['preconditions'][0]['why']})
        self.assertEqual(appends[0]['values'][0][0], 'T0012')
        self.assertEqual(appends[-1]['values'][-1][0], 'T1211')
        self.assertEqual(plan['assumes']['last_ids']['T'], 'T0011')
        self.assertTrue(all(len(v) == 20 for w in appends for v in w['values']))

    def test_a_one_point_one_sheet_plans_the_transactions_tab(self):
        self.version = 1
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        run, rows, out, plan = self.run_import(expect=(0,))
        self.assertEqual(plan['sheet']['version'], 1)
        self.assertEqual([w['range'] for w in plan['writes']], ['Transactions!A3:J3'])
        self.assertEqual(plan['writes'][0]['values'][0][:4], ['T0002', '2027-02-02', 'ACC-CC', 'MYKI TOP UP'])
        self.assertEqual(json.loads((out / 'entries.json').read_text())[0][1], 'transaction')

    def test_text_that_would_read_as_a_formula_is_escaped(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, '=SUM(A1) SHOP', '5.00'), card(3, '+PLUS SHOP', '5.00')])
        run, rows, out, plan = self.run_import(expect=(0,))
        raw = [v[4] for v in plan['writes'][0]['values']]
        self.assertEqual(raw, ["'=SUM(A1) SHOP", "'+PLUS SHOP"])
        self.assertTrue(W.same(raw[0], '=SUM(A1) SHOP'))
        for row, entered_text in zip(rows, raw):
            self.sheet_tx.append({**LAST, 'txn_id': row[0], 'date': row[1], 'account_id': row[2],
                                  'bank_description': W.plain(entered_text), 'amount': row[5]})
        _, repeated, _, replay = self.run_import(out='replay', expect=(0,))
        self.assertEqual(repeated, [])
        self.assertEqual(replay['writes'], [])

    def test_runs_are_kept_and_dry_run_writes_nothing(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.run_import(expect=(0,))
        self.run_import(expect=(0,))
        runs = sorted((self.root / 'out' / 'runs').iterdir())
        self.assertEqual(len(runs), 2)
        for r in runs:
            self.assertEqual(sorted(p.name for p in r.iterdir()), ['entries.json', 'review.md', 'rows.json', 'write-plan.json'])
        run, rows, out, plan = self.run_import('--dry-run', expect=(0,), out='dry')
        self.assertFalse((self.root / 'dry').exists())
        self.assertIn('1 rows to append', run.stdout)

    def test_verify_agrees_with_a_faithful_reread_and_names_a_changed_cell(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(3, 'ALDI STORES COBURG', '50.00')])
        self.file('payslips', '2027-03-02-mia', PAYSLIPS, [['2027-02-18', 'Mia', 'Bayview Health', '3090.00', '632.00', '370.80', '2458.00']], name='payslips.csv')
        run, rows, out, plan = self.run_import(expect=(0,))
        # the sheet reads dates back as serials and trims trailing blanks, as the API does
        def as_read(v):
            if isinstance(v, str) and len(v) == 10 and v[4] == '-' and v[7] == '-':
                import datetime as dt
                return (dt.date.fromisoformat(v) - dt.date(1899, 12, 30)).days
            return W.plain(v)
        reread = []
        for w in plan['writes']:
            vals = []
            for row in w['values']:
                r = [as_read(v) for v in row]
                while r and r[-1] == '':
                    r.pop()
                vals.append(r)
            reread.append({'range': w['range'], 'values': vals})
        (out / 'reread.json').write_text(json.dumps(reread))
        v = subprocess.run([sys.executable, str(HERE / 'verify.py'), str(out / 'write-plan.json'), str(out / 'reread.json')], capture_output=True, text=True)
        self.assertEqual(v.returncode, 0, v.stdout)
        self.assertIn('VERIFIED 3 rows over 2 ranges', v.stdout)
        reread[0]['values'][1][6] = -51.0
        (out / 'reread2.json').write_text(json.dumps(reread))
        v2 = subprocess.run([sys.executable, str(HERE / 'verify.py'), str(out / 'write-plan.json'), str(out / 'reread2.json')], capture_output=True, text=True)
        self.assertEqual(v2.returncode, 1)
        self.assertIn('MISMATCH Entries!A3:T4 at G4: planned -50.0, sheet has -51.0', v2.stdout)
        pre = [{'range': 'Entries!A2:A3', 'values': [['T0001']]}, {'range': 'Payslips!A2', 'values': []}]
        (out / 'pre.json').write_text(json.dumps(pre))
        v3 = subprocess.run([sys.executable, str(HERE / 'verify.py'), str(out / 'write-plan.json'), str(out / 'pre.json'), '--preconditions'], capture_output=True, text=True)
        self.assertEqual(v3.returncode, 0, v3.stdout)
        pre[0]['values'] = [['T0001'], ['T0002']]
        (out / 'pre2.json').write_text(json.dumps(pre))
        v4 = subprocess.run([sys.executable, str(HERE / 'verify.py'), str(out / 'write-plan.json'), str(out / 'pre2.json'), '--preconditions'], capture_output=True, text=True)
        self.assertEqual(v4.returncode, 1)
        self.assertIn('the sheet moved', v4.stdout)


class Range(Base):
    def test_a_backfill_range_imports_every_month_in_one_run(self):
        self.file('ACC-CC', '2027-02-02', CARD, [card(d, f'JAN {d}', '1.00', month='01') for d in (3, 9, 20)], name='activity.csv')
        self.file('ACC-CC', '2027-03-02', CARD, [card(d, f'FEB {d}', '1.00') for d in (3, 9)], name='activity.csv')
        self.file('ACC-CC', '2027-04-02', CARD, [card(d, f'MAR {d}', '1.00', month='03') for d in (3,)], name='activity.csv')
        run, rows, out, plan = self.run_import(month='2027-01..2027-03', expect=(0,))
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[0][1], '2027-01-03')
        self.assertEqual(rows[-1][1], '2027-03-03')
        self.assertEqual(plan['months'], ['2027-01', '2027-02', '2027-03'])
        self.assertIn('6 rows to append', run.stdout)


if __name__ == '__main__':
    unittest.main()
