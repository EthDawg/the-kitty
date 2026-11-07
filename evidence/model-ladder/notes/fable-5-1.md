# Notes, Mulcahy-Bonetti household, Jul 2023 to Jun 2026

Built by work/load.py (parse every ledger), work/build.py (classify, reconcile, write result.json). Bank rows are the truth for cash; payslips, statements and bills were used only to check them.

## Reconciliation
- ACC-JOINT running balance chains row to row except one break: the Jan-Mar 2025 download stops at 10 Mar 2025 and the next starts 3 Apr 2025, net -1,347.37 missing. I rebuilt the gap from counterparts: three Paul pays (payslips 1,435.00, 1,435.00, 1,764.34), three 180.00 board payments (Mum's ledger), the 1,242.98 Amewx debit (card ledger). The unexplained remainder, 5,278.73, is booked as March 2025 spending (it covers two loan repayments, Tess's rent, Bupaw and ordinary spending). March 2025 month-end balance is inferred (6,731.29), assuming nothing on 1-2 Apr.
- ACC-SAVE: the Oct-Dec 2024 file overlaps the prior quarter by three rows (deduped). The file "Wattle_saver_2025-07-01 (1).ofx" is not the saver at all: its ACCTID is 0093318842, Mum's term saver (RAD 420,000 out, interest). Ignored. After that every quarterly LEDGERBAL matches to the cent from an implied 1 Jul 2023 opening of 58,000.00.
- ACC-CARD: Sep 2024 files overlap by six rows (deduped). The 24 Sep 2024 "REEF STAY USD 412" at 620.18 is a pending authorisation; the statement shows it posted once at 626.40 on 2 Oct. Dropped the 620.18. The card then reconciles to all 36 statement balances. Opening owed 30 Jun 2023 derived as 2,279.06.
- ACC-DEE: each QIF opening balance equals the prior running balance. ACC-HOMELOAN and both super ledgers chain cleanly and agree with the PING half-yearly statements and HESTAbby annual statements.
- Payslips vs bank: Paul's Jun 2024 last pay banked in Jul; one Aug 2025 payslip is missing from the folder but the pay is in the bank; Dee's 9,800 final pay in Mar 2024 was banked as 4,000 (Mar) + 2,860 (Apr). Bank dates and amounts used.

## Calls (why)
- Dee receives Mum's age pension and forwards it; Carlo's 250/month "MUM CARE" is forwarded quarterly as "CARLO SHARE"; Dee's top-up loans to Mum (5,000) were repaid; Mum's 33 Liebig rates (855, 876) passed through JOINT. All pass-through, excluded. The post-death pension (19 Feb 2026) and its Services Australia recovery 1,203.10 are likewise excluded.
- Lakeside aged-care fees paid by Dee are pass-through (family's own record). Mum's monthly "REIMB" transfers first repay the fronted Lakeside fee; the remainder is treated as a refund of Dee's spending (negative spending), because the costs it reimburses sit unlabelled among her EFTPOS rows.
- Mum's 168,000 for the granny flat (Sep 2023 to Mar 2024) is booked as gift income and the matching Otway Granny Flats payments as spending. The flat sits on the family's title and the home estimate jumped. A reader who sees it as Mum paying her own builder would remove 16,800 / 50,400 / 50,400 / 50,400 from both income and spending in Sep, Nov 2023, Jan, Mar 2024.
- Funeral: 9,480 on the card (Feb 2026) and the 9,480 estate reimbursement (Mar 2026) are both excluded as the estate's money. Alternative: spend in Feb, refund in Mar.
- Estate: Apr 2026 100,000 received less 50,000 passed to Carlo = 50,000 inheritance income; Jun 2026 186,400 taken as Dee's share (no onward transfer seen). ACC-MUMJT is Mum's until her death (excluded from net worth and income), Dee's from Feb 2026 month-end; its closure into the saver is an own transfer.
- Loan from Mum: 30,000 liability from 14 Oct 2024, 500/month from Jan 2025, 23,000 forgiven on 9 Feb 2026 (liability to zero, no income, not cash).
- Loan repayments counted as spending at cash amount, including the 100,000 lump in Jun 2026 (definition wording). Redraw 3,500 excluded. PAWPACK salary packaging (346.15 a fortnight to the loan, Jul 2023 to Mar 2024) never touched a cash account: excluded from income and spending, visible only in the loan balance.
- Refunds netted against spending: Medicare rebates, Purrsure claim 7,300 (roof), hospital refund 215, Canopy 189, the 1,240 dishonour reversal. Services Australia carer debt 620 is negative income. Uniform claims and the carer bereavement payment are income. Water 270.34 repaid to Mum (she paid the family's bill) is spending.
- Excluded as told: ATO refunds and payments, spouse super contribution 3,000, caravan sale 31,500, all transfers between own accounts and card payments.

## Balances and net worth
- Liabilities are negative in "balances" (card, home loan, loan from Mum). ACC-MUM is listed for reference only (memo, not in net worth). ACC-MUMJT is listed every month but enters net worth only from Feb 2026.
- Home: latest Pawprice estimate on or before month end, with the 908,000 valuer opinion for Apr and May 2024. Car 19,000 throughout (agreed value on all three renewals). Caravan 34,000 to Jan 2024, nil after the 3 Feb 2024 sale.
- Super balances from the fund ledgers at month end.

## Not settled
- March 2025 JOINT spending split and month-end balance are inferred, not seen. The REIMB split between Mum's costs and Dee's own is inferred. Whether the 186,400 estate payment is wholly Dee's is assumed. Flat, funeral and lump-repayment treatments are judgement calls stated above.
