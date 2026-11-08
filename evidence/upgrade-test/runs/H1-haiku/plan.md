# Plan: Sheet 1A-Q3ansPwFKO_KZ1lFGstxIBTbQQvKGzVbD59UWlhWw, version 2 to 3

Read first: Kitty!B14 sheet_version = 2. Tabs present: Dashboard, Kitty, README, Metrics, Cash Flow, Budget, Savings Finder, Mortgage Scenarios, Tax Forecast, Compliance Checks, Net Worth, Entries, Balances, Contracts, Decisions, Rules, Transactions, Payslips, Valuations, Subscriptions, Goals, Accounts, Categories, Loans, Assets, Settings. None of Receipts, Receipt Lines, Decision Options, Goal Levers, Tax Returns exists, so no name collision. Goals has three empty rows, Decisions has only its header, Kitty people is blank. Nothing looks tailored that the note touches. Settings As-of date is B6 (30/06/2023).

Steps:
1. Insert 6 rows at Compliance Checks row 24 (the blank row above the "Checks needing review" summary). The summary is =COUNTIF(E5:E,"Review"), open-ended, so it picks up the new rows.
2. Add five tabs at the end, with frozen header row: Receipts (A to T), Receipt Lines (A to P), Decision Options (A to N), Goal Levers (A to J), Tax Returns (A to N). Headers exactly as the note.
3. Row 2 formulas exactly as the note: Receipts!S2, Receipt Lines!N2, Decision Options!I2, Goal Levers!G2, H2, I2, Tax Returns!I2. The note's <as-of> is INDEX(Settings!B:B,MATCH("As-of date",Settings!A:A,0)).
4. Dropdowns from the note's lists on the new tabs. Recommended (Decision Options J), On (Goal Levers D) as checkboxes. The GST list (Taxable, GST-free) is applied only to Receipt Lines L, since the note does not say which GST column it means.
5. Compliance Checks rows 24 to 29: the six checks from the note. Status is Review when Items is above zero for Data and Review checks, and Note for the two Note rows. The amount-only check has no Items formula. "Why" and "Where" text is mine, short, because the note gives none.
6. Kitty!B14 = 3.

Not touched: any existing tab, header or formula; Transactions "Receipt held" (the note says it can read Receipts, but that is a good-is line, not a change it asks for); Entries; Dashboard.

Questions for Ethan (left out of the apply, listed in the report): none block the apply. The Status rule for the Note rows and the Type of the Review-labelled check are my reading of the parentheses and are flagged in the report.
