# Mulcahy-Bonetti notes (Jul 2023 to Jun 2026)

Method: built one ledger from bank CSV/QIF/OFX, card CSV, PING TSV and payslips. Each row gets one kind: income, spend, or none (transfer, loan, pass-through). Income and spend are by bank date. Balances are month-end, liabilities negative.

Reconciliations (all tie unless noted):
- Joint (Harbour): every bank row's running balance ties; cross-file chain ties except a gap (below).
- Saver (Wattle OFX): LEDGERBAL ties at all 12 good quarter-ends.
- Dee (Bark QIF): each file's Opening Balance equals the prior close.
- Card (Amewx): every statement ties to the cent; the missing Aug 2025 statement is implied by the Sep 2025 "previous balance".
- PING: ties to all six half-yearly statements.
- HESTAbby: ties to FY24/25/26 annual statements. Purrannuation: chain ties.
- Paul's 154 payslips match joint deposits, except 3 Mar 2025 pays missing from the bank file, one 14 Aug 2025 deposit with no payslip, and a 27 Jun 2024 pay banked 1 Jul (bank date used).

Traps and calls:
1. Joint gap 11 Mar to 2 Apr 2025: the bank file stops at 10 Mar and resumes at 3 Apr; the balance chain is short by 1,347.37. I added the 3 missing pays (income), 2 PING debits (14 and 28 Mar), the 1 Apr Amewx payment (per card statement), and 3 weekly POA board receipts inferred from a strict weekly pattern. A residual of 2,798.73 is booked as everyday spending on 31 Mar. It may hide some EFTPOS that is not really spending. Unverified.
2. "(1)" Wattle saver OFX: its own balances do not chain (TS-suffixed rows, incl. a 420,000 "Lakeside RAD" debit). Excluded entirely.
3. Saver 2024-08-12 file overlaps the 2024-07-01 file to 30 Sep 2024 (5,770.74 double). Dropped the overlap.
4. Card overlap 25-30 Sep 2024: kept once. A 24 Sep USD hotel pre-auth (620.18) is not on any statement (the 2 Oct settlement of 626.40 is); dropped.
5. Mum (Assunta) is not household. Her Age Pension (paid to Dee, forwarded to her) nets to zero with the recovery; her granny-flat money (168,000 in, 168,000 paid to builder), aged-care fees (Lakeside), Carlo's contributions, POA reimbursements, funeral (card 9,480 and estate reimbursement) are pass-through, excluded both sides.
6. Mum's board (180/week, Mar 2024 to Jun 2025, including POA-paid), XMAS gifts and rates contributions are income. Mum's loan (30,000 in; 500/month out) is excluded; the 23,000 balance is forgiven 9 Feb 2026 (net worth only).
7. Estate: 286,400 from Brauer Legal to saver (28 Apr and 16 Jun 2026) counted as inheritance income. The 50,000 "estate share" to Carlo (29 Apr 2026) is excluded as someone else's money. Judgement; if Carlo's share is a gift instead, income is 50,000 lower and spending 50,000 higher.
8. Mum's saver (ACC-MUMJT): Mum's money to 9 Feb 2026, then Dee's. Included in net worth only from Feb 2026. Its 11,224.30 transfer to the household saver (2 Mar 2026) is an own transfer, not income.
9. Mortgage: cash repayments are spending (definition). That includes the 100,000 lump prepayment from the saver on 23 Jun 2026, so June 2026 spending is inflated. Interest charged and salary-packaged PAWPACK (Dee, 346.15 x18, non-cash) are not cash flow; they only move the loan balance.
10. Home loan redraw (3,500, Jan 2025) is debt, not income. Dishonoured 16 Aug 2024 payment reversed and re-presented: net nil.
11. Bathroom (26,400) and roofing (8,300) are spending (home maintenance); the Purrsure home claim (7,300) is a refund against spending. Stairlift on card (4,280) is spending. Judgement on the renovations.
12. Income includes Medicare and other government payments, Liam's board (120/week), carer payments, bereavement (3,912.40), uniform reimbursement. Overpayment debt (620) is negative income. Tax refunds and payments, super contributions, own transfers, and family loans are excluded.
13. Tess (dependant) is paid 420 fortnightly as "rent": treated as spending. If she is a household member, that is internal and spending is overstated by about 25,620 in total.
14. Car held at 19,000 and van at 34,000 until sold 3 Feb 2024 (proceeds 31,500 in the bank, so net worth drops by 2,500). No depreciation data; car value unchanged.
15. Home value is a step function: Pawprice quarterly estimates, with the Apr 2024 valuer's opinion (908,000) used from 30 Apr 2024.
16. Net worth includes all of Dee's and the joint account, including money held temporarily for Mum (pass-through balances). Not split out.
17. Not settled: exact timing of the 2025 gap; whether Tess rent, Acorn stairlift, Mobility Plus, physio and podiatry on the card belong to Mum (all kept as household spending); Medicare treatment; the Carlo estate share; whether the June 2026 lump should be spending at all.
18. Two items with no evidence: the 3 inferred POA board receipts (540) and the 31 Mar residual.
