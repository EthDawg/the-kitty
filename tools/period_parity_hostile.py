"""Hostile cases for tools/period_parity.py, on fictional files built with period-close/test_import.py's helpers. Each test only drives
run_import: the wrapped subprocess.run compares Python and JS on every call, so a case asserts nothing about which answer is right."""
import json
import shutil
import sys
import unittest

import test_import as TI
from test_import import ACCOUNTS, BANK, CARD, HERE, LAST, OWNER, PAYSLIPS, WESTPAC, card, westpac

ANY = (0, 1, 2)
BARK_ACCT = 'ACC-OLD'


def make_pdf(rows):
    """A plain text PDF pdftext.py can read: one Tm/Tj per cell, a row per baseline."""
    ops = []
    for i, cells in enumerate(rows):
        for j, c in enumerate(cells):
            esc = c.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            ops.append(f'BT 1 0 0 1 {50 + j * 200} {780 - i * 20} Tm ({esc}) Tj ET')
    content = '\n'.join(ops).encode()
    return b'%PDF-1.4\n1 0 obj\n<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream\nendobj\n%%EOF\n'


class Hostile(TI.Base):
    def go(self, *more, **kw):
        kw.setdefault('expect', ANY)
        return self.run_import(*more, **kw)

    def again(self, plan):
        """Land the plan in the sheet as a host would, for the next run."""
        doc = json.loads(self.snapshot().read_text())
        sys.modules['__main__'].apply(doc, plan)
        self.extra = {'entries': doc['entries'], 'payslips': doc['payslips'], 'contracts': doc['contracts']}

    def inputs(self, **files):
        d = self.root / 'inputs'
        d.mkdir(exist_ok=True)
        for k, v in files.items():
            (d / f'{k}.csv').write_text(v)
        return '--inputs', str(d)

    # ---------- line review: bugs both importers shared
    def test_new_mate_precondition(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(1, 'HOME LOAN REPAYMENT', debit='3000.00', balance='7000.00')], name='D.csv')
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(1, 'REPAYMENT RECEIVED', credit='3000.00', balance='-597000.00')], name='L.csv')
        self.go()

    def test_newest_first_loan_values_the_latest(self):
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(28, 'INTEREST CHARGED', debit='2500.00', balance='-599500.00'), westpac(3, 'REPAYMENT', credit='3000.00', balance='-597000.00')], name='L.csv')
        self.go()

    def test_newest_first_bank_closes_on_the_latest(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(20, 'B', debit='5.00', balance='8000.00'), westpac(3, 'A', debit='5.00', balance='9995.00')], name='D.csv')
        self.go()

    def test_loan_blank_balance(self):
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(28, 'INTEREST CHARGED', debit='2500.00', balance='')], name='L.csv')
        self.go()

    def test_payslip_blank_cells(self):
        self.file('payslips', '2027-03-02', PAYSLIPS, [['2027-02-18', 'Mia', 'B', '', '', '', '']], name='p.csv')
        self.go()

    def test_valuation_huge(self):
        (self.root / 'sources').mkdir()
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-02-28,RENTAL,1e21\n'))

    def test_loan_balance_huge(self):
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(28, 'INTEREST CHARGED', debit='2500.00', balance='1e21')], name='L.csv')
        self.go()

    def test_mate_already_in_a_transfer(self):
        self.sheet_tx = [LAST, {'txn_id': 'T0002', 'date': '2027-02-03', 'account_id': 'ACC-EVD', 'bank_description': 'HOME LOAN REPAYMENT', 'merchant': 'Harbour', 'amount': -3000.0, 'category_id': 'MORTGAGE', 'person': 'Joint', 'transfer_id': 'X0007', 'transfer_account': 'ACC-SAV'}]
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(3, 'REPAYMENT RECEIVED', credit='3000.00', balance='-597000.00')], name='L.csv')
        self.go()

    def test_row_left_for_review_stays_unpaired(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(2, 'TRANSFER TO SAVER', debit='500.00', balance='9500.00')], name='D.csv')
        self.file('ACC-SAV', '2027-03-01', BANK, [['03/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '601.00'], ['04/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '1101.00']])
        self.go()

    def test_verify_blank_last_id(self):
        self.extra = {'entries': [dict(TI.entry(LAST), entry_id=None)]}
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        _, _, out, _ = self.go()
        (out / 'pre.json').write_text(json.dumps([{'range': 'Entries!A2:A3', 'values': [['ZZZ']]}]))
        TI.subprocess.run([sys.executable, str(HERE / 'verify.py'), str(out / 'write-plan.json'), str(out / 'pre.json'), '--preconditions'], capture_output=True, text=True)

    def test_verify_preconditions_on_held(self):
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'A', '1.00', '', '999.00']])
        _, _, out, _ = self.go()
        (out / 'pre.json').write_text(json.dumps([{'range': 'Entries!A2:A3', 'values': [['T0001']]}]))
        TI.subprocess.run([sys.executable, str(HERE / 'verify.py'), str(out / 'write-plan.json'), str(out / 'pre.json'), '--preconditions'], capture_output=True, text=True)

    def test_sheet_numeric_raw_text(self):
        self.sheet_tx = [LAST, {'txn_id': 'T0002', 'date': '2027-02-03', 'account_id': 'ACC-EVD', 'bank_description': 12345, 'merchant': 'Harbour', 'amount': -3000.0, 'category_id': 'SUBS', 'person': 'Joint'}]
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(3, 'REPAYMENT RECEIVED', credit='3000.00', balance='-597000.00')], name='L.csv')
        self.go()

    def test_sheet_serial_date(self):
        self.sheet_tx = [LAST, {'txn_id': 'T0002', 'date': 46421, 'account_id': 'ACC-EVD', 'bank_description': 'X', 'merchant': 'X', 'amount': -5.0, 'category_id': 'TRANSFER', 'person': 'Joint'}]
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.go()

    def test_sheet_missing_date(self):
        self.sheet_tx = [LAST, {'txn_id': 'T0002', 'date': None, 'account_id': 'ACC-EVD', 'bank_description': 'X', 'merchant': 'X', 'amount': -5.0, 'category_id': 'TRANSFER', 'person': 'Joint'}]
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.go()

    # ---------- reordered files
    def test_names_reorder_overlaps(self):
        self.file('ACC-CC', '2027-03-05', CARD, [card(3, 'ALDI', '50.00'), card(4, 'COLES', '20.00')], name='a.csv')
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(3, 'ALDI', '50.00')], name='z.csv')
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(4, 'COLES', '20.00')], name='b.csv')
        self.go()

    def test_same_key_description_order_is_file_order(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, 'ZED', '5.00'), card(2, 'ALPHA', '5.00')], name='z.csv')
        self.file('ACC-CC', '2027-03-02', CARD, [card(2, 'ALPHA', '5.00'), card(2, 'MID', '5.00')], name='a.csv')
        self.go()

    # ---------- repeated runs
    def test_second_run_plans_nothing_with_pairs_loans_payslips(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(2, 'TRANSFER TO SAVER', debit='500.00', balance='9500.00'), westpac(3, 'HOME LOAN REPAYMENT', debit='3000.00', balance='6500.00')], name='Data.csv')
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '601.00']])
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(3, 'REPAYMENT RECEIVED', credit='3000.00', balance='-597000.00')], name='L.csv')
        self.file('payslips', '2027-03-02', PAYSLIPS, [['2027-02-18', 'Mia', 'Bayview Health', '3090.00', '632.00', '370.80', '2458.00']], name='p.csv')
        _, _, _, plan = self.go()
        self.again(plan)
        _, rows, _, plan2 = self.go(out='out2')
        self.assertEqual(rows, [])
        self.assertEqual(plan2['writes'], [])
        self.again(plan2)
        self.go('--loans', 'now', out='out3')

    def test_third_file_after_the_month_landed(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(2)])
        _, _, _, plan = self.go()
        self.again(plan)
        self.file('ACC-CC', '2027-03-09', CARD, [card(2), card(2), card(2), card(20, 'NEW', '1.00')])
        self.go(out='out2')

    # ---------- legitimate repeats
    def test_triple_same_day_charge(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(2), card(2)])
        self.go()

    def test_repeat_differs_by_case_and_spacing(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, 'Myki  Top Up'), card(2, 'MYKI TOP UP'), card(2, 'myki top  up')])
        self.go()

    def test_repeat_across_files_and_sheet(self):
        self.sheet_tx = [LAST, {**LAST, 'txn_id': 'T0002', 'date': '2027-02-02', 'account_id': 'ACC-CC', 'bank_description': 'MYKI TOP UP', 'amount': -60.0}]
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(2), card(2)], name='a.csv')
        self.file('ACC-CC', '2027-03-02', CARD, [card(2), card(2)], name='b.csv')
        self.go()

    def test_same_description_different_amount(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, 'A', '1.00'), card(2, 'A', '1.01'), card(2, 'A', '1.00')])
        self.go()

    # ---------- overlapping exports
    def test_three_overlapping_windows(self):
        days = [card(d, f'S{d}', f'{d}.25') for d in range(1, 29)]
        self.file('ACC-CC', '2027-03-01', CARD, days[:15], name='a.csv')
        self.file('ACC-CC', '2027-03-02', CARD, days[10:25], name='b.csv')
        self.file('ACC-CC', '2027-03-03', CARD, days[20:], name='c.csv')
        self.go()

    def test_overlap_with_bom_and_crlf_twin(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2), card(3, 'B', '2.00')], bom=True, name='a.csv')
        self.file('ACC-CC', '2027-03-02', None, None, name='b.csv', raw=('\r\n'.join([','.join(CARD), ','.join(card(2)), ','.join(card(3, 'B', '2.00'))]) + '\r\n').encode())
        self.go()

    def test_many_rows_past_the_review_cap(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(1 + i % 28, f'S {i}', '1.00') for i in sorted(range(90), key=lambda i: i % 28)], name='a.csv')
        self.file('ACC-CC', '2027-03-02', CARD, [card(1 + i % 28, f'S {i}', '1.00') for i in sorted(range(90), key=lambda i: i % 28)], name='b.csv')
        self.go()

    def test_leading_apostrophe_formula(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, "'=LITERAL")])
        self.go()

    def test_leading_apostrophe_word(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, "'PLAIN WORD")])
        self.go()

    def test_chunk_boundaries(self):
        for n, name in ((500, 'a'), (501, 'b')):
            d = self.root / 'sources'
            shutil.rmtree(d, ignore_errors=True)
            rows = sorted([card(1 + i % 28, f'S {i}', '1.00') for i in range(n)], key=lambda r: r[0])
            self.file('ACC-CC', '2027-03-01', CARD, rows)
            self.go(out=f'out-{name}')

    # ---------- malformed rows and truncated files
    def test_short_row(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=(','.join(CARD) + '\n' + ','.join(card(2)) + '\n03/02/2027,ALDI\n').encode())
        self.go()

    def test_extra_comma_unquoted(self):
        self.file('ACC-EVD', '2027-03-01', None, None, raw=(','.join(WESTPAC) + '\n033,02/02/2027,CAFE, THE GOOD,5.00,,100.00,,\n').encode())
        self.go()

    def test_truncated_mid_row(self):
        raw = (','.join(CARD) + '\n' + ','.join(card(2)) + '\n03/02/2027,ALDI ST').encode()
        self.file('ACC-CC', '2027-03-01', None, None, raw=raw)
        self.go()

    def test_truncated_mid_quote(self):
        raw = (','.join(CARD) + '\n' + ','.join(card(2)) + '\n03/02/2027,"ALDI ST').encode()
        self.file('ACC-CC', '2027-03-01', None, None, raw=raw)
        self.go()

    def test_truncated_after_header_bytes(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=b'Date,Descri')
        self.go()

    def test_nul_byte(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=(','.join(CARD) + '\n02/02/2027,AL\0DI,J,-41007,5.00\n').encode())
        self.go()

    def test_oversize_field(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=(','.join(CARD) + '\n02/02/2027,"' + 'X' * 140000 + ',J,-41007,5.00\n').encode())
        self.go()

    def test_non_ascii_digits(self):
        self.file('ACC-CC', '2027-03-01', CARD, [['٠٢/٠٢/٢٠٢٧', 'A', 'J', '-41007', '1.00']])
        self.go()

    def test_whitespace_only_file(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=b' \r\n\t\n')
        self.go()

    def test_bom_only_file(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=b'\xef\xbb\xbf')
        self.go()

    def test_not_utf8(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=','.join(CARD).encode() + b'\n02/02/2027,CAF\xe9,J,-41007,5.00\n')
        self.go()

    def test_utf16(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=(','.join(CARD) + '\n').encode('utf-16'))
        self.go()

    def test_blank_lines_keep_row_numbers(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=(','.join(CARD) + '\n\n' + ','.join(card(2)) + '\n\n \n,,,,\n99/99/2027,X,J,1,2.00\n').encode())
        self.go()

    def test_leading_blank_line(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=('\n' + ','.join(CARD) + '\n' + ','.join(card(2)) + '\n').encode())
        self.go()

    def test_header_with_spaces_is_fine(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=(' Date , Description,Card Member ,Account #,Amount\n' + ','.join(card(2)) + '\n').encode())
        self.go()

    def test_near_header_for_each_shape(self):
        self.file('ACC-EVD', '2027-03-01', ['Bank Account', 'Date', 'Narrative', 'Debit', 'Credit Amount', 'Balance', 'Categories', 'Serial'], [])
        self.file('ACC-SAV', '2027-03-01', ['Date', 'Description', 'Balance'], [])
        self.file('ACC-CC', '2027-03-01', ['Date', 'Description', 'Card Member', 'Account #', 'Amount', 'Extra'], [])
        self.go()

    def test_multiline_quoted_narrative(self):
        raw = (','.join(CARD) + '\r\n02/02/2027,"LINE ONE\r\nLINE  TWO",JORDAN,-41007,5.00\r\n03/02/2027,"X\nY""Z",J,-41007,6.00\r\n13/13/2027,BAD,J,1,1.00\r\n').encode()
        self.file('ACC-CC', '2027-03-01', None, None, raw=raw)
        self.go()

    def test_multiline_narrative_ok(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=(','.join(CARD) + '\n02/02/2027,"LINE ONE\nLINE  TWO",JORDAN,-41007,5.00\n03/02/2027,"say ""hi"" now",J,-41007,6.00\n').encode())
        self.go()

    def test_cr_only_lines(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=(','.join(CARD) + '\r' + ','.join(card(2)) + '\r' + ','.join(card(3, 'B', '2.00')) + '\r').encode())
        self.go()

    def test_quote_oddities(self):
        self.file('ACC-CC', '2027-03-01', None, None, raw=(','.join(CARD) + '\n02/02/2027,AB"C,J,-41007,5.00\n03/02/2027,"AB"C,J,-41007,5.00\n04/02/2027,"AB" ,J,-41007,5.00\n05/02/2027,  "AB",J,-41007,5.00\n').encode())
        self.go()

    def test_unicode_and_odd_spaces(self):
        rows = [card(2, 'CAFÉ MÜLLER  STRASSE', '5.00'), card(2, 'cafÉ MÜLLER STRASSE', '5.00'), card(3, 'straße ﬁne 🐈 mcdonald\'s', '6.00'), card(4, 'ÉFEB ÉMAR 7-eleven 123abc', '7.00'),
                card(5, '  PADDED　', '8.00'), card(6, 'NEL\u0085SEP\x1cFS', '9.00'), card(7, '﻿ZWNBSP', '1.00')]
        self.file('ACC-CC', '2027-03-01', CARD, rows)
        self.go()

    def test_formula_like_text(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, '@HANDLE', '5.00'), card(3, '-5 OFF', '5.00'), card(4, "'QUOTED", '5.00'), card(5, "'=X", '5.00')])
        self.go()

    # ---------- dates
    def test_short_and_dotted_dates(self):
        self.file('ACC-CC', '2027-03-01', CARD, [['2/2/2027', 'A', 'J', '-41007', '1.00'], ['03-02-2027', 'B', 'J', '-41007', '1.00'], ['04.02.2027', 'C', 'J', '-41007', '1.00'], ['2027-02-05', 'D', 'J', '-41007', '1.00']])
        self.go()

    def test_two_digit_year(self):
        self.file('ACC-CC', '2027-03-01', CARD, [['02/02/27', 'A', 'J', '-41007', '1.00']])
        self.go()

    def test_month_zero(self):
        self.file('ACC-CC', '2027-03-01', CARD, [['02/00/2027', 'A', 'J', '-41007', '1.00']])
        self.go()

    def test_day_31_april(self):
        self.file('ACC-CC', '2027-05-01', CARD, [['31/04/2027', 'A', 'J', '-41007', '1.00']])
        self.go()

    def test_29_feb_leap_and_not(self):
        self.file('ACC-CC', '2028-03-01', CARD, [['29/02/2028', 'A', 'J', '-41007', '1.00']])
        self.file('ACC-SAV', '2027-03-01', BANK, [['29/02/2027', 'A', '1.00', '', '1.00']])
        self.go(month='2028-02')

    def test_text_in_date(self):
        self.file('ACC-CC', '2027-03-01', CARD, [['Total', 'A', 'J', '-41007', '1.00']])
        self.go()

    def test_blank_date(self):
        self.file('ACC-CC', '2027-03-01', CARD, [['', 'A', 'J', '-41007', '1.00']])
        self.go()

    def test_implausible_years(self):
        self.file('ACC-CC', '2027-03-01', CARD, [['02/02/1999', 'A', 'J', '-41007', '1.00']], name='a.csv')
        self.file('ACC-CC', '2027-03-02', CARD, [['02/02/2101', 'A', 'J', '-41007', '1.00']], name='b.csv')
        self.go()

    def test_bark_ordering_and_bad_line(self):
        self.file(BARK_ACCT, '2027-03-02', None, None, name='a.csv', raw=b'03/02/2027,"-4.00","FEE","+996.00"\r\n28/02/2027,"+0.05","INT","+996.05"\r\n')
        self.file(BARK_ACCT, '2027-03-03', None, None, name='b.csv', raw=b'28/02/2027,"+0.05","INT","+996.05"\r\n03/02/2027,bad\r\n')
        self.go()

    def test_bark_thousands(self):
        self.file(BARK_ACCT, '2027-03-02', None, None, name='a.csv', raw=b'28/02/2027,"+2,470.00","SALARY","+3,470.00"\r\n')
        self.go()

    # ---------- amounts
    def amount_case(self, value, expect=ANY):
        self.file('ACC-CC', '2027-03-01', CARD, [['02/02/2027', 'SHOP', 'J', '-41007', value]])
        self.go()

    # ---------- wrong sequence
    def test_newest_first_harbour_is_accepted(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(20, 'B', debit='1.00', balance='9998.00'), westpac(10, 'A', debit='1.00', balance='9999.00'), westpac(2, 'C', credit='0.00', balance='9999.00')], name='D.csv')
        self.go()

    def test_zigzag_descending_first(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(9), card(4), card(7)])
        self.go()

    def test_flat_then_zigzag(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(4), card(4), card(9), card(7)])
        self.go()

    # ---------- folders
    def test_unknown_account_and_every_other_fault_together(self):
        self.file('ACC-NEW', '2027-03-01', CARD, [card(2)])
        self.file('ACC-CC', 'bad-folder', CARD, [card(2)])
        self.file('ACC-CC', '2027-13-45', CARD, [card(2)])
        self.file('ACC-CC', '2027-03-01', None, None, name='notes.txt', raw=b'hello')
        self.file('ACC-CC', '2027-03-01', None, None, name='noext', raw=b'hello')
        self.file('ACC-CC', '2027-03-02', None, None, name='x.CSV', raw=(','.join(CARD) + '\n' + ','.join(card(2)) + '\n').encode())
        (self.root / 'sources' / 'ACC-CC' / 'stray.csv').write_text('x')
        (self.root / 'sources' / 'ACC-EVD' / '2027-03-01' / 'nested').mkdir(parents=True)
        self.go()

    def test_dot_names_and_empty_folders_are_ignored(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        (self.root / 'sources' / 'ACC-CC' / '2027-03-01' / '.DS_Store').write_bytes(b'\0\1')
        (self.root / 'sources' / '.git').mkdir()
        (self.root / 'sources' / 'ACC-CC' / '.tmp').mkdir()
        (self.root / 'sources' / 'ACC-SAV' / '2027-03-05').mkdir(parents=True)
        self.go()

    def test_empty_unknown_folder_still_stops(self):
        (self.root / 'sources' / 'ACC-NEW').mkdir(parents=True)
        self.go()

    def test_label_on_download_folder(self):
        self.file('ACC-CC', '2027-03-01-jordan', CARD, [card(2)])
        self.file('ACC-SAV', '2027-03-01 mia', BANK, [['02/02/2027', 'X', '1.00', '', '101.00']])
        self.file('ACC-EVD', '2027-03-01_x', WESTPAC, [], name='D.csv')
        self.go()

    def test_sources_folder_missing(self):
        self.go(sources='nothing-here')

    def test_empty_sources_folder(self):
        (self.root / 'sources').mkdir()
        self.go()

    def test_account_without_adapter(self):
        self.extra = {'accounts': ACCOUNTS + [{'account_id': 'ACC-NEW', 'institution': 'Mystery', 'type': 'Savings', 'opening_balance': 0, 'opening_date': '2025-06-30'}]}
        self.file('ACC-NEW', '2027-03-01', CARD, [card(2)])
        self.go()

    def test_no_accounts_tab_falls_back(self):
        self.extra = {'accounts': []}
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'X', '1.00', '', '101.00']])
        self.go()

    def test_wrong_shapes_in_each_folder(self):
        self.file('LN-HOME', '2027-03-01', CARD, [card(2)], name='a.csv')
        self.file('LN-HOME', '2027-03-02', None, None, name='b.csv', raw=b'02/02/2027,"-1.00","X","+1.00"\r\n')
        self.file('RENTAL', '2027-03-01', CARD, [card(2)])
        self.file('payslips', '2027-03-01', CARD, [card(2)])
        self.file('POL-RENTAL', '2027-03-01', CARD, [card(2)])
        self.file('ACC-RNT', '2027-03-01', None, None, name='s.pdf', raw=b'%PDF-1.4\n')
        self.go()

    # ---------- windows and the opening guard
    def test_as_of_cuts_a_later_row(self):
        self.file('ACC-CC', '2027-03-20', CARD, [card(2), ['05/03/2027', 'M', 'J', '-41007', '1.00']])
        self.go('--as-of', '2027-02-28')

    def test_owner_and_payslip_after_as_of(self):
        self.file('RENTAL', '2027-03-20', OWNER, [['05/03/2027', 'A', 'Gross rent', '1.00', '', 'PM']])
        self.file('payslips', '2027-03-20', PAYSLIPS, [['2027-03-05', 'Mia', 'B', '1.00', '0', '0', '1.00']])
        self.go('--as-of', '2027-02-28')

    def test_file_ending_on_the_opening_date(self):
        self.file('ACC-CC', '2025-07-02', CARD, [['20/06/2025', 'OLD', 'J', '-41007', '1.00'], ['30/06/2025', 'OLD2', 'J', '-41007', '1.00']])
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)], name='b.csv')
        self.go()

    def test_file_spanning_the_opening_date(self):
        self.file('ACC-CC', '2025-07-20', CARD, [['20/06/2025', 'OLD', 'J', '-41007', '1.00'], ['05/07/2025', 'NEW', 'J', '-41007', '1.00']])
        self.go()

    def test_history_file_inside_a_range_that_starts_early(self):
        self.file('ACC-CC', '2025-07-02', CARD, [['20/06/2025', 'OLD', 'J', '-41007', '1.00']])
        self.file('ACC-CC', '2025-08-02', CARD, [['20/07/2025', 'NEW', 'J', '-41007', '1.00']], name='b.csv')
        self.go(month='2025-06..2025-07')
        self.go(month='2025-07..2025-08', out='out2')

    def test_earlier_rows_not_in_sheet_are_a_gap(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, month='01'), card(2)], name='a.csv')
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(2, 'X', debit='1.00', balance='9999.00', month='01')], name='D.csv')
        self.file('ACC-EVD', '2027-03-02', WESTPAC, [], name='E.csv')
        self.go()

    def test_download_far_from_month_is_quiet(self):
        self.file('ACC-CC', '2027-01-15', CARD, [])
        self.file('ACC-SAV', '2027-05-15', BANK, [])
        self.go()

    def test_range_crosses_a_year(self):
        self.file('ACC-CC', '2027-02-02', CARD, [['20/12/2026', 'A', 'J', '-41007', '1.00'], ['20/01/2027', 'B', 'J', '-41007', '1.00']])
        self.go(month='2026-12..2027-01')

    # ---------- categorising
    def test_precedence_override_rule_history_new(self):
        self.extra = {'rules': TI.RULES + [{'rule_id': 'R9', 'pattern': 'EXACT SHOP', 'match': 'exact', 'merchant': 'Exact', 'category_id': 'SUBS', 'person': 'Mia'},
                                           {'rule_id': 'R10', 'pattern': 'EXACT SHOP', 'match': 'normalised', 'merchant': 'Norm', 'category_id': 'GROCERIES'},
                                           {'rule_id': 'R11', 'pattern': 'BLANK NAME', 'category_id': 'SUBS'}, {'rule_id': 'R12', 'pattern': '', 'category_id': 'SUBS'}, {'rule_id': 'R13', 'pattern': 'NO CAT'}]}
        base = {**LAST, 'account_id': 'ACC-CC', 'category_id': 'GROCERIES', 'person': 'Mia', 'date': '2027-01-10', 'amount': -1.0}
        self.sheet_tx = [LAST, {**base, 'txn_id': 'T0002', 'bank_description': 'HIST SHOP', 'merchant': 'Hist'}, {**base, 'txn_id': 'T0003', 'bank_description': 'HIST SHOP', 'merchant': 'Hist'},
                         {**base, 'txn_id': 'T0004', 'bank_description': 'HIST SHOP', 'merchant': 'Other', 'category_id': 'SUBS'}, {**base, 'txn_id': 'T0005', 'bank_description': 'TIE', 'merchant': 'One', 'category_id': 'SUBS'},
                         {**base, 'txn_id': 'T0006', 'bank_description': 'TIE', 'merchant': 'Two', 'category_id': 'GROCERIES'}, {**base, 'txn_id': 'T0007', 'bank_description': 'LOOSE 1234 JAN', 'merchant': 'Loose'},
                         {**base, 'txn_id': 'T0008', 'bank_description': 'EXACT SHOP', 'merchant': 'Ignored'}]
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, 'HIST SHOP'), card(3, 'TIE'), card(4, 'LOOSE 9999 FEB'), card(5, 'EXACT SHOP'), card(6, 'exact shop'), card(7, 'BLANK NAME'), card(8, 'REFUND NEWCO * ABC123'), card(9, 'OVER')])
        self.go(*self.inputs(overrides='Description,Merchant,Category ID,Person,Receipt held,Note\nOVER,Over Co,SUBS,Mia,Y,"note, with comma"\nOVER,Second,GROCERIES,Joint,,\nHIST SHOP,Overridden,SUBS,Joint\n'))

    def test_history_file(self):
        hist = self.root / 'data.json'
        rows = [['Txn ID', 'Date', 'Account ID', 'Bank description', 'Merchant', 'Amount', 'Category ID', 'Person', 'Receipt held', 'Note']]
        rows += [['H1', '2024-01-01', 'ACC-CC', 'OLD SHOP', 'Old Shop', -1, 'GROCERIES', 'Mia', '', ''], ['H2', '2024-01-02', 'ACC-CC', 'OLD SHOP 1234', 'Older', -1, 'SUBS', 'Joint', '', '']]
        hist.write_text(json.dumps({'Transactions': rows}))
        self.sheet_tx = [LAST, {**LAST, 'txn_id': 'T0002', 'date': '2027-01-10', 'account_id': 'ACC-CC', 'bank_description': 'OLD SHOP', 'merchant': 'Sheet Shop', 'amount': -1.0, 'category_id': 'SUBS', 'person': 'Jordan'}]
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, 'OLD SHOP'), card(3, 'OLD SHOP 9999')])
        self.go('--history', str(hist))

    def test_override_unknown_category(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, 'OVER')])
        self.go(*self.inputs(overrides='Description,Merchant,Category ID,Person\nOVER,Over,NOPE,Joint\nX,Y,ALSO,Joint\n'))

    def test_override_missing_column(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, 'OVER')])
        self.go(*self.inputs(overrides='Description,Merchant\nOVER,Over\n'))

    def test_normalised_rule_ignores_month_and_refund(self):
        self.extra = {'rules': [{'rule_id': 'R1', 'pattern': 'APPLE.COM/BILL * XYZ', 'match': 'normalised', 'merchant': 'Apple', 'category_id': 'SUBS', 'person': 'Jordan'}]}
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, 'APPLE.COM/BILL * Q1', '1.00'), card(3, 'REFUND APPLE.COM/BILL FEB', '-1.00'), card(4, 'PREMIUM ADJ APPLE.COM/BILL 12345', '2.00')])
        self.go()

    def test_no_categories_tab(self):
        self.extra = {'category_list': []}
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, 'ANYTHING')])
        self.go()

    # ---------- transfers
    def test_ambiguous_mates(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(2, 'TRANSFER TO SAVER', debit='500.00', balance='9500.00')], name='D.csv')
        self.file('ACC-SAV', '2027-03-01', BANK, [['01/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '601.00'], ['03/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '1101.00']])
        self.go()

    def test_same_day_preference(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(2, 'TRANSFER TO SAVER', debit='500.00', balance='9500.00')], name='D.csv')
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '601.00'], ['03/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '1101.00']])
        self.go()

    def test_five_days_is_too_far_four_is_not(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(2, 'TRANSFER TO SAVER', debit='500.00', balance='9500.00'), westpac(9, 'TRANSFER TO SAVER', debit='70.00', balance='9430.00')], name='D.csv')
        self.file('ACC-SAV', '2027-03-01', BANK, [['07/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '601.00'], ['13/02/2027', 'TRANSFER FROM EVERYDAY', '70.00', '', '671.00']])
        self.go()

    def test_mate_already_in_the_sheet_gets_an_update(self):
        self.sheet_tx = [LAST, {'txn_id': 'T0002', 'date': '2027-01-30', 'account_id': 'ACC-EVD', 'bank_description': 'TRANSFER TO SAVER', 'merchant': 'Internal transfer', 'amount': -500.0, 'category_id': 'TRANSFER', 'person': 'Joint'},
                         {'txn_id': 'T0003', 'date': '2027-01-30', 'account_id': 'ACC-SAV', 'bank_description': 'TRANSFER FROM EVERYDAY', 'merchant': 'Internal transfer', 'amount': 70.0, 'category_id': 'TRANSFER', 'person': 'Joint'},
                         {'txn_id': 'T0004', 'date': '2027-01-30', 'account_id': 'ACC-EVD', 'bank_description': 'TRANSFER TO SAVER', 'merchant': 'Internal transfer', 'amount': -70.0, 'category_id': 'TRANSFER', 'person': 'Joint'}]
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '671.00']])
        self.go()

    def test_transfer_numbering_continues(self):
        self.sheet_tx = [LAST, {**LAST, 'txn_id': 'T0002', 'transfer_id': 'X0041', 'transfer_account': 'ACC-EVD'}]
        self.valuations = [('HOME', '2027-01-31', 1.0), ('RENTAL', '2027-01-31', 2.0)]
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(2, 'TRANSFER TO SAVER', debit='500.00', balance='9500.00')], name='D.csv')
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'TRANSFER FROM EVERYDAY', '500.00', '', '601.00']])
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-02-28,HOME,10.5\n'))

    # ---------- loans
    def test_two_equal_repayments_same_day(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(1, 'HOME LOAN REPAYMENT', debit='3000.00', balance='7000.00'), westpac(1, 'HOME LOAN REPAYMENT', debit='3000.00', balance='4000.00')], name='D.csv')
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(1, 'REPAYMENT RECEIVED', credit='3000.00', balance='-597000.00'), westpac(1, 'REPAYMENT RECEIVED', credit='3000.00', balance='-594000.00')], name='L.csv')
        self.go()

    def test_repayment_without_mate_and_regex_mate(self):
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(5, 'EXTRA LOAN PAYMENT', debit='100.00', balance='9900.00')], name='D.csv')
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(5, 'PAYMENT', credit='100.00', balance='-599900.00'), westpac(20, 'PAYMENT', credit='55.00', balance='-599845.00'), westpac(28, 'INTEREST CHARGED', debit='10.00', balance='-599855.00')], name='L.csv')
        self.go()
        self.go('--loans', 'now', out='out2')

    def test_mate_in_the_sheet(self):
        self.sheet_tx = [LAST, {'txn_id': 'T0002', 'date': '2027-01-30', 'account_id': 'ACC-EVD', 'bank_description': 'HOME LOAN REPAYMENT', 'merchant': 'Harbour', 'amount': -3000.0, 'category_id': 'MORTGAGE', 'person': 'Joint'}]
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(1, 'REPAYMENT RECEIVED', credit='3000.00', balance='-597000.00')], name='L.csv')
        self.go()
        self.go('--loans', 'now', out='out2')

    def test_overlapping_statements_and_two_months(self):
        lines = [westpac(1, 'INTEREST', debit='5.00', balance='-600005.00', month='01'), westpac(1, 'INTEREST', debit='6.00', balance='-600011.00')]
        self.file('LN-HOME', '2027-03-01', WESTPAC, lines, name='a.csv')
        self.file('LN-HOME', '2027-03-02', WESTPAC, lines, name='b.csv')
        self.go(month='2027-01..2027-02')

    def test_statement_valuation_disagrees(self):
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(1, 'INTEREST', debit='6.00', balance='-600011.00')], name='a.csv')
        self.file('LN-HOME', '2027-03-02', WESTPAC, [westpac(1, 'INTEREST', debit='6.00', balance='-600012.00')], name='b.csv')
        self.go()

    def test_loans_on_a_one_point_one_sheet(self):
        self.version = 1
        self.extra = {'valuations': [{'month_end': '2027-01-31', 'item_id': 'HOME', 'value': 1}]}
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(1, 'HOME LOAN REPAYMENT', debit='3000.00', balance='7000.00')], name='D.csv')
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(1, 'REPAYMENT', credit='3000.00', balance='-597000.00')], name='L.csv')
        self.go()

    def test_one_point_one_without_valuations(self):
        self.version = 1
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(1, 'I', debit='3.00', balance='-597000.00')], name='L.csv')
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-02-28,HOME,1\n'))

    # ---------- owner statements
    def test_owner_repeats_and_extra_rows(self):
        self.file('ACC-RNT', '2027-03-01', WESTPAC, [westpac(5, 'BAYSIDE PROPERTY MGMT FEE', debit='10.00', balance='2990.00'), westpac(5, 'BAYSIDE PROPERTY MGMT FEE', debit='10.00', balance='2980.00'), westpac(9, 'BAYSIDE PROPERTY MGMT RENT MAR', credit='5.00', balance='2985.00')], name='D.csv')
        self.file('RENTAL', '2027-03-01', OWNER, [['05/02/2027', 'BAYSIDE PROPERTY MGMT FEE', 'Agent', '', '10.00', 'PM'], ['05/02/2027', 'BAYSIDE PROPERTY MGMT FEE', 'Agent', '', '10.00', 'PM'], ['05/02/2027', 'bayside property  mgmt fee', 'Agent', '', '10.00', 'PM']])
        self.go()

    def test_owner_no_linked_account(self):
        self.extra = {'accounts': [dict(a, linked_account=None) for a in ACCOUNTS]}
        self.file('RENTAL', '2027-03-01', OWNER, [['05/02/2027', 'X', 'Agent', '1.00', '', 'PM']])
        self.go()

    def test_owner_bom_and_quiet(self):
        self.file('RENTAL', '2027-03-01', OWNER, [['05/01/2027', 'X', 'Agent', '1.00', '', 'PM']], bom=True, name='a.csv')
        self.file('RENTAL', '2027-03-02', OWNER, [['05/01/2027', 'X', 'Agent', '1.00', '', 'PM']], name='b.csv')
        self.file('RENTAL', '2027-03-03', OWNER, [['05/01/2027', 'X', 'Agent', '1.00', '', 'PM']], name='c.csv')
        self.go()

    def test_owner_money_fault_before_date_fault(self):
        self.file('RENTAL', '2027-03-01', OWNER, [['99/99/2027', 'X', 'Agent', 'abc', '', 'PM']])
        self.go()

    # ---------- payslips
    def test_payslip_conflict_with_sheet_as_ints(self):
        self.payslips = [{'pay_date': '2027-02-04', 'person': 'Mia', 'employer': 'B', 'gross_pay': 3090, 'tax_withheld': 632, 'super': 370.8, 'net_pay': 2458}]
        self.file('payslips', '2027-03-02', PAYSLIPS, [['2027-02-04', 'Mia', 'B', '3090.00', '633.00', '370.80', '2458.00']], name='p.csv')
        self.go()

    def test_payslip_conflict_across_files(self):
        self.file('payslips', '2027-03-02', PAYSLIPS, [['2027-02-04', 'Mia', 'B', '3090.00', '633.00', '370.80', '2458.00']], name='a.csv')
        self.file('payslips', '2027-03-03', PAYSLIPS, [['2027-02-04', 'Mia', 'B', '3090.00', '634.00', '370.80', '2458.50']], name='b.csv')
        self.go()

    def test_payslip_inputs_csv(self):
        self.payslips = []
        self.file('payslips', '2027-03-02', PAYSLIPS, [['2027-01-04', 'Mia', 'B', '1,090.00', '$33.00', '(1.00)', 'A$900.00']], name='a.csv')
        self.go(*self.inputs(payslips='Pay date,Person,Employer,Gross pay,Tax withheld,Super (employer),Net pay\n2027-02-18,Mia,B,3090.0,632,370.8,2458.0\n2027-02-04, Jordan ,N,5254.62,1329,630.55,3925.62\n2027-03-04,Mia,B,1,1,1,1\n'))

    def test_payslip_input_bad_date(self):
        (self.root / 'sources').mkdir()
        self.go(*self.inputs(payslips='Pay date,Person,Employer,Gross pay,Tax withheld,Super (employer),Net pay\n2027-02-30,Mia,B,1,1,1,1\n'))

    def test_payslip_input_comma_amount(self):
        (self.root / 'sources').mkdir()
        self.go(*self.inputs(payslips='Pay date,Person,Employer,Gross pay,Tax withheld,Super (employer),Net pay\n2027-02-18,Mia,B,"3,090.00",632,370.8,2458\n'))

    # ---------- valuations
    def test_valuations_agree_and_conflict(self):
        self.valuations = [('HOME', '2027-02-28', 1200000.0)]
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-02-28,HOME,1200000.00\n2027-02-28,RENTAL,771000\n2027-02-28,RENTAL,771000.00\n2027-03-31,RENTAL,1\n'))

    def test_valuations_conflict_in_run(self):
        (self.root / 'sources').mkdir()
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-02-28,RENTAL,771000\n2027-02-28,RENTAL,771001\n'))

    def test_valuation_bad_month_end(self):
        (self.root / 'sources').mkdir()
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n28/02/2027,RENTAL,771000\n'))

    def test_valuation_impossible_month_end(self):
        (self.root / 'sources').mkdir()
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-02-30,RENTAL,771000\n'))

    def test_valuation_impossible_month_end_in_range(self):
        (self.root / 'sources').mkdir()
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-01-32,RENTAL,771000\n'), month='2027-01..2027-02')

    def test_valuation_comma_value(self):
        (self.root / 'sources').mkdir()
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-02-28,RENTAL,"771,000"\n'))

    def test_valuation_blank_value(self):
        (self.root / 'sources').mkdir()
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-02-28,RENTAL,\n'))

    # ---------- policies
    RENEWAL = [['Rental landlord insurance renewal'], ['Policy number', 'Period of insurance'], ['PS-RENTAL-2027', '15 Sep 2027 to 14 Sep 2028'], ['Total premium', 'Payment due'], ['A$1,802.50', '1 Sep 2027'],
               ['Cover', 'Sum insured or limit'], ['Building', 'A$1.00'], ['Contents', 'A$2.00']]

    def pol(self, rows, day='2027-02-16', name='r.pdf', folder='POL-RENTAL'):
        self.file(folder, day, None, None, name=name, raw=make_pdf(rows))

    def test_renewal_differs(self):
        self.pol(self.RENEWAL)
        self.go()

    def test_superseded_renewal(self):
        shutil.copytree(HERE / 'fixtures', self.root / 'f')
        self.pol(self.RENEWAL)
        d = self.root / 'sources' / 'POL-RENTAL' / '2026-09-16'
        d.mkdir(parents=True)
        shutil.copy(self.root / 'f' / 'Purrsure-RenewalNotice-RENTAL-2026.pdf', d / 'old.pdf')
        self.go()

    def test_policy_in_wrong_folder(self):
        self.pol(self.RENEWAL, folder='POL-HOME')
        self.go()

    def test_policy_unreadable_fields(self):
        self.pol([['Renewal notice'], ['Policy number'], ['PS-RENTAL-2027']])
        self.go()

    def test_policy_not_a_pdf_at_all(self):
        self.file('POL-RENTAL', '2027-02-16', None, None, name='r.pdf', raw=b'hello')
        self.go()

    def test_policy_impossible_date(self):
        rows = [list(r) for r in self.RENEWAL]
        rows[2][1] = '31 Feb 2027 to 14 Sep 2028'
        self.pol(rows)
        self.go()

    def test_policy_one_line_period_and_paid(self):
        rows = [['Certificate of currency'], ['Rental landlord insurance'], ['Policy period 15 Sep 2026 to 14 Sep 2027'], ['Policy number', 'Premium paid', 'Status'], ['PS-RENTAL-2026', '$1,702.00', 'Paid in full']]
        self.pol(rows)
        self.go()

    # ---------- closing checks
    def test_sub_cent_balance(self):
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'A', '1.00', '', '102.004']], name='a.csv')
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(2, 'B', credit='1.00', balance='10001.006')], name='D.csv')
        self.go()

    def test_closing_uses_last_row_of_window(self):
        self.file('ACC-SAV', '2027-04-01', BANK, [['02/02/2027', 'A', '1.00', '', '102.00'], ['05/03/2027', 'B', '1.00', '', '999.00']])
        self.go()

    def test_big_mismatch_groups_thousands(self):
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'A', '1.00', '', '1234567.89']])
        self.go()

    # ---------- IDs and rows
    def test_empty_sheet(self):
        self.sheet_tx = []
        self.payslips = []
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.file('payslips', '2027-03-02', PAYSLIPS, [['2027-02-18', 'Mia', 'B', '1.00', '0', '0', '1.00']], name='p.csv')
        self.go()

    def test_odd_entry_ids(self):
        self.extra = {'entries': [TI.entry(LAST), dict(TI.entry(LAST), entry_id='MANUAL-1'), dict(TI.entry(LAST), entry_id='T9'), dict(TI.entry(LAST), entry_id='T00012', kind='TRANSACTION'), dict(TI.entry(LAST), entry_id='N1', kind='note'), dict(TI.entry(LAST), entry_id='V7', kind='Valuation', account_id='HOME')]}
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.go(*self.inputs(valuations='Month end,Item ID,Value\n2027-02-28,RENTAL,5\n'))

    def test_amount_strings_in_the_sheet(self):
        self.extra = {'entries': [dict(TI.entry(LAST), amount='1.00'), dict(TI.entry(LAST), entry_id='T2', amount='1,000.00'), dict(TI.entry(LAST), entry_id='T3', amount=None)]}
        self.file('ACC-SAV', '2027-03-01', BANK, [['31/01/2027', 'INTEREST CREDIT', '1.00', '', '101.00']])
        self.go()

    def test_sheet_id_option(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.go('--sheet-id', 'abc123')

    def test_reversed_month_range(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2)])
        self.go(month='2027-02..2027-01')

    def test_verify_edges(self):
        self.file('ACC-CC', '2027-03-01', CARD, [card(2, '=X', '5.00')])
        self.file('ACC-EVD', '2027-03-01', WESTPAC, [westpac(1, 'HOME LOAN REPAYMENT', debit='3000.00', balance='7000.00')], name='D.csv')
        self.file('LN-HOME', '2027-03-01', WESTPAC, [westpac(1, 'REPAYMENT', credit='3000.00', balance='-597000.00')], name='L.csv')
        _, _, out, plan = self.go()
        w = plan['writes'][0]
        good = [[v if v != '' else None for v in row] for row in w['values']]
        fix = lambda vals, rng=w['range']: [{'range': rng, 'values': vals}]  # noqa: E731
        def changed(i, v):
            rows = json.loads(json.dumps(good))
            rows[0][i] = v
            return fix(rows)
        reads = {
            'same': fix(good), 'map': {w['range']: good}, 'single': fix(good)[0], 'date': changed(2, '2/2/2027'), 'serial': changed(2, 46421), 'monthname': changed(2, '02 Feb 2027'), 'wrongdate': changed(2, '3/2/2027'),
            'text-num': changed(6, '-3,000.00'), 'halfcent': changed(6, -3000.004), 'cent': changed(6, -3000.01), 'word': changed(3, 'OTHER'), 'trail': fix([r + ['', None] for r in good]), 'extra': fix([r + ['Z'] for r in good]),
            'extra-row': fix(good + [['ZZ']]), 'blank-row': fix(good + [['', None]]), 'missing': [], 'short': fix(good[:1]), 'bool': changed(4, True),
        }
        import subprocess
        for k, doc in reads.items():
            p = out / f'read-{k}.json'
            p.write_text(json.dumps(doc))
            for extra in ([], ['--include-deferred'], ['--preconditions']):
                TI.subprocess.run([sys.executable, str(HERE / 'verify.py'), str(out / 'write-plan.json'), str(p), *extra], capture_output=True, text=True)

    def test_verify_held_and_no_writes(self):
        self.file('ACC-SAV', '2027-03-01', BANK, [['02/02/2027', 'A', '1.00', '', '999.00']])
        _, _, out, plan = self.go()
        (out / 'r.json').write_text('[]')
        TI.subprocess.run([sys.executable, str(HERE / 'verify.py'), str(out / 'write-plan.json'), str(out / 'r.json')], capture_output=True, text=True)
        shutil.rmtree(self.root / 'sources')
        (self.root / 'sources').mkdir()
        _, _, out, plan = self.go(out='out2')
        (out / 'r.json').write_text('[]')
        for extra in ([], ['--preconditions']):
            TI.subprocess.run([sys.executable, str(HERE / 'verify.py'), str(out / 'write-plan.json'), str(out / 'r.json'), *extra], capture_output=True, text=True)


AMOUNTS = {'plain': '12.50', 'dollar': '$1,234.50', 'aud': 'A$5.00', 'paren': '(12.50)', 'half_paren_l': '(5.00', 'half_paren_r': '5.00)', 'neg': '-3.20', 'plus': '+3.20', 'blank': '', 'space': '   ', 'exp': '1e3', 'under': '1_000.50',
           'dotstart': '.5', 'dotend': '5.', 'subcent_down': '1.005', 'subcent_up': '1.015', 'tie_even': '0.125', 'tie_odd': '0.375', 'tie_big': '1234.625', 'text': 'abc', 'dash': '-', 'double_dot': '1.2.3', 'nan': 'nan', 'inf': 'inf',
           'neg_inf': '-Infinity', 'huge_exp': '1e400', 'huge': '1e15', 'zero': '0.00', 'neg_zero_paren': '(0.00)', 'aud_word': 'AUD 5', 'nbsp': ' 5.00'}


def _amount(value):
    def t(self):
        self.amount_case(value)
    return t


for _k, _v in AMOUNTS.items():
    setattr(Hostile, f'test_amount_{_k}', _amount(_v))
