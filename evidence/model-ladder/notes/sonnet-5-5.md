# Notes (Mulcahy-Bonetti, Jul 2023 - Jun 2026). Scripts in ../w (main.py builds result.json).
Method: bank/card/loan/super ledgers rebuilt, each reconciled to its own running balance or stated closing balance, then classified.
## Tricky finds
- Joint Q1-2025 file stops 10 Mar 2025; next file opens 1,347.37 lower. Rebuilt 11-31 Mar from payslips (3 x pay), loan TSV (2 x 1,240), Bupaw FY25 statement (305 missing), rates notice (1,276), card payment 1,242.98 with no matching debit, board, Tess rent; the rest (797.73) is a plug booked as cash spending. Mar-2025 split is least certain.
- Saver 2025-07 "(1)" OFX is another account (0093318842, Mum's term saver, RAD 420k): ignored. 2024-08-12 saver file overlaps Jul file: deduped (same txns, different FITIDs).
- Card CSV 24 Sep 2024 Reef Stay 620.18 is a pending hold; statement shows only the 626.40 settlement: dropped. Overlapping card files deduped.
- Card CSV dates are posting dates; statements show purchase dates (CSV 0-8 days later). Used purchase date as "charge date"; card month-end balance is by charge date (differs from statement balances at the 14th by unposted items). Aug-2025 statement missing, so that cycle uses CSV dates.
- Mum's money passing through our accounts is excluded: age pension in/out (ties to 0 incl. recovery after death), Carlo's care share, top-ups, Lakeside fees, rates on 33 Liebig (BPAY 40877 + her repayment), funeral 9,480 (paid by our card, repaid by estate), her 168,000 for the granny flat (in and out to Otway in 4 stages). Mum's card-paid care costs (physio, podiatry, mobility, Dr Nair) excluded; her reimbursements net 1,956.84 residual against spending.
- Payee names misled: "OSKO TO A BONETTI WATER" 270.34 is our own May-2025 water bill (only unpaid one): spending. "BPAY MOYNE COAST HEALTH PATIENT" is a medical bill, not pay. SA 8812 = Mum's pension, SA 7741 = Dee's carer (bereavement payment and 620 debt counted as Dee's).
- Dishonoured 1,240 loan debit (Aug 2024): reversal nets to zero, 9 fee spent; loan statement never counted it.
## Calls
- Income = wages (net banked), carer, board (Liam, Mum), interest, gifts, uniform claims, inheritance. Medicare/insurance/shop refunds net against spending. Tax refunds/payments, transfers, card payments, super, Mum's loan (30k in, 14 x 500 out), redraw 3,500, caravan sale 31.5k out.
- Packaged salary (346.15 to loan) is neither income nor spending, but cuts the loan. Home-loan cash repayments are spending, incl. the 100,000 lump in Jun 2026.
- Bathroom 26,400, roof 8,300 (7,300 claim netted), stairlift 4,280, Tess rent, footy tips: spending.
- Mum's flat money treated as pass-through (not gift). If it is a gift: add 16.8k Sep-23, 50.4k Nov-23, Jan-24, Mar-24 to BOTH income and spending.
- Estate: 286,400 + 11,224.30 from joint-name saver = inheritance income; 50,000 sent to Carlo (half of first payment) netted off Apr-26 income.
- Net worth: cash + super + home + car + caravan - card - home loan - Mum loan (forgiven 9 Feb 2026). Mum's two accounts excluded though listed in balances.
- Home: latest valuation at or before month-end (step, not interpolated); Pawprice quarterly, valuer 908k on 30 Apr 2024 for Apr/May 2024. Car flat 19,000; caravan 34,000 until sale 3 Feb 2024.
- Liabilities in "balances" are positive amounts owed.
## Unsure
- Granny-flat treatment, Carlo's share, whether the 11,224.30 and unpaid half of estate are ours, card date convention, March-2025 plug, home value between quarters.
