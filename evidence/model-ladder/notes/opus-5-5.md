# Mulcahy-Bonetti, July 2023 to June 2026: notes

## How it reconciles
- Saver ties to all 12 OFX ledger balances. Card ties to all 36 statements on file, and the missing Aug 2025 statement is bridged by activity (321.95). Loan ties to all 36 PING month closes. Paul's super ties to its annual statements. Dee's QIF openings chain with no break. Cash roll-forward closes to the cent. All pass-through flows net to 0.00.
- Conventions: liabilities in `balances` are positive amounts owed, as stated. Snapshot assets hold their last value (no interpolation). ACC-MUM and ACC-MUMJT balances are memo at face value and are not in net worth, except as below.

## Bad or messy files
- Joint Q1 2025 file stops on 10 Mar, a gap of -1,347.37 to the next balance. Rebuilt from other documents: 3 Paul pays, 3 board, 2 PING, Bupaw 305 (proved by FY25 statement), rent, rates 1,276, Amewx 1,242.98. Residual 797.73 taken as unseen EFTPOS/ATM spending; a normal three weeks is about 780. Its parts are unknowable, only the total. 31 Mar balance 6,731.29 assumes no 1-2 Apr rows, and none appear.
- `Wattle_saver_2025-07-01 (1).ofx` is account 0093318842, Mum's term saver, misfiled. Excluded, including the 420,000 RAD.
- Overlapping downloads removed: 3 Saver rows (FITIDs differ, so matched on content) and 6 card rows.
- REEF STAY 620.18 is a pending row on no statement; the settled 626.40 on 2 Oct 2024 replaced it.
- Card dates: activity date is the charge date, because statements bucket on it. Statement dates are earlier (purchase dates), up to 11 days.

## Calls on timing
- Paul's 27 Jun 2024 pay banked 1 Jul, so July. Dee's final 6,860 net banked 4,000 in Mar and 2,860 in Apr 2024. Both follow the bank, not the payslip.
- Pawpack 346.15 a fortnight goes straight to the loan and never touches cash: in neither income nor spending, but in the loan balance.

## Calls on what money is
- Mum's money through our accounts, left out both ways: age pension via Dee (41 in, 40 out, last recovered after death), Carlo's 5,500, aged-care fees, rates on 33 Liebig, funeral 9,480 (estate repaid it).
- Mum's care on Paul's card, left out: every REIMB matched exactly to the prior month's podiatry, physio, mobility, Dr Nair net of Medicare 3318, and specific chemist rows. Each month's chemist subset was unique. Other chemist rows stay as household spending.
- Board counts as income even when it arrives named D BONETTI POA; the money is Mum's. Top-ups to Mum and their repayment are family loans.
- Refunds net off spending: Purrsure claim 7,300, hospital 215, Medicare 2291, Canopy 189 (refunded to another account), dishonour reversal 1,240.
- Water 270.34 paid to Mum on 4 Jun 2025 is household spending: she paid our May bill from her account by mistake.
- Tess's rent is spending; she has no in-scope account. S Mulcahy +250 and R Mulcahy -250 look like a pair but are different people: gift and spending.
- Services Australia DEBT -620 is negative income. Bereavement 3,912.40 is income. Uniform claims 220.40 are income, per the family's REIMBURSE category.
- ACC-MUMJT is out of net worth until she died on 9 Feb 2026, then Dee's. Loan from Mum (23,000 left) drops to zero that day: a net worth gain, not income.
- Home: Pawprice quarterly, plus the valuer's 908,000 for Apr and May 2024. Car 19,000 flat, matching the agreed value. Caravan 34,000 until sold.

## Judgement calls that move numbers: please check
- Flat 168,000: Mum's money in, builder out next day, treated as pass-through. If it is a gift plus an expense, add to income and spending: Sep 2023 16,800; Nov 2023, Jan 2024, Mar 2024 50,400 each.
- Lump 100,000 on 23 Jun 2026 counted as spending under "loan repayments at cash amount". June 2026 spending is 5,970.07 without it.
- Redraw 3,500 (Jan 2025) left out as an own transfer. PING nets it against repayments; netting would cut Jan 2025 spending by 3,500.
- MUMJT sweep 11,224.30 on 2 Mar 2026 treated as an own transfer, as Dee already owned it. If you see survivorship as inheritance, add it to Mar 2026 income.
- Estate 286,400 counted as a gift, less Carlo's 50,000 passed on. I assumed that is all of it; I never saw the estate accounts, so Dee's true share is unconfirmed.

## Could not settle
- Net worth has no receivable for money Mum owed us: top-ups up to 5,000 (May-Sep 2024), monthly REIMB float, funeral 9,480 at Feb 2026.
- Joint-to-card payments leave a day before the card shows them, so month-ends with that float understate net worth slightly. Stated balances kept.
- Dee's super has no annual statement, so only its internal running balance is proved. The car has no real valuation.
