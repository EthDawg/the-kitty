# TEMPLATE blank Kitty: change list

Template spreadsheet: 1ym0cNBMcRtkxaQIhWFccDdz210e9nanH1B0_OCDi89U (https://docs.google.com/spreadsheets/d/1ym0cNBMcRtkxaQIhWFccDdz210e9nanH1B0_OCDi89U/edit)
Folder: a private test folder in the author's Drive (fictional data only).
Source: 16BNQv2jTt9G3Yfbkj1NwgaAxDjBibCth40wdNXWf3aA, never written. Its etag and modified time (2026-11-06T11:22:40Z) are the same before and after.
Copy method: Drive create_file with the folder mime type, then Drive copy_file with fileId, parentId and title. Worked first time.

## Adding a new account row

Write into the first Accounts row where column A is empty. Fill A to G and I to P; leave H alone.
Do not use values.append: H2:H19 hold formulas, so an append lands on row 20 and leaves rows 2 to 19 empty.
Past row 19, copy H down from the row above. The formula is relative and needs nothing else.
K = ledger balances from transaction rows; any other K balances from valuation rows and puts the account on Assets.
M must be active. J must be a Net Worth column: Cash, Property, Super, Shares, Vehicle or Loans.
The same rule is on README row 32.

## Data removed

- Entries A2:T (1,082 rows), Rules A2:J, Decisions A2:H, Payslips A2:G, Goals A2:D, Loans A2:H, Contracts A2:L and N2:Q, Accounts A2:G and I2:P.
- Settings: B5 "Your household"; B6 30/06/2023; A11, A12, A14 to A17 relabelled Person 1 and Person 2; B14 to B17 set to 0; B18 and B19 set to 0 and notes C18, C19 cleared. Those two were the Davies rental depreciation schedule and would have given every household a deduction.
- Settings B11 stays 50%, a neutral split. C11 gained a note saying who Person 1 and Person 2 are.
- Kitty: household_name "Your household". people, lead_goal, greeting_name, pay_cycle, onboarded_at cleared.
- Dashboard B2: "Digital Davies" dropped from the title.
- Categories untouched (cell-for-cell identical), as asked. That means the Davies monthly budget amounts in column E stay.

One departure from "keep every formula": Contracts I19, J19, L19, I20, J20, L20 are removed. They were the Amount, Rate and End date of the two Davies loan contracts (=Loans!K2, F2, G2, then K3, F3, G3). Left in place they would sit stranded in an empty table and push appended contracts to row 21. A new loan contract row writes the same links by hand. Every other original formula is present: 1,862 before, 1,860 now (6 removed, 4 added).

## Formula changes

1. Accounts H2:H19. Was two position-dependent formulas (rows 2 to 7 ledger, rows 8 to 19 valuation), so a household listing accounts in another order got silently wrong balances. Now one formula that branches on $K: IF($K2="ledger", <old ledger formula>, <old valuation formula>).
2. Metrics C14. Was hard-coded to "ACC-SAV". Now SUMIFS(Goals!E:E,Goals!A:A,"Emergency fund"), so emergency cover reads the balance of the goal with that exact name. No goal of that name gives 0 months.
3. Tax Forecast B4:E4. Were typed Jordan, Mia. B4 and C4 now take the first and second names from Kitty people, falling back to "Person 1" and "Person 2"; D4 =B4, E4 =C4.
4. Tax Forecast B7:E7 and B16:E16. Were hard-coded B$4="Jordan". Now compare with $B$4.
5. Subscriptions A2. FILTER wrapped in IFERROR(...,). With no subscription contract, #N/A ran through Savings Finder, Metrics savings and the Dashboard ranking and did not clear with more transactions.
6. Assets A2. Same wrapper. A household with only ledger accounts had a Close check stuck on #N/A, so its month could never close.
7. Savings Finder C10. Wrapped in MAX(0,...). With no loan, the offset saving went negative and reduced the headline savings total (seen at -$32 in preflight).

## Data validation changes

- Payslips B2:B: strict dropdown of Jordan, Mia removed. It would have rejected any other household's names.
- Transactions H2:H: dropdown of Jordan, Mia, Joint removed. Column is a formula view.

## README changes

- A1 title, A2 description: Davies and sample wording gone.
- A6:B8: tab lists now match reality. Entries, Payslips, Decisions are raw; Transactions, Valuations, Assets, Subscriptions and Balances are views; Contracts, Rules and Kitty are inputs. Tab colour labels dropped from those three rows because the colours no longer line up.
- C7: Entries is written in columns A to T only.
- B13: Transactions and Valuations filter Entries by Kind.
- "What the sample data is built to show" deleted, rows and all.
- New rows: People, Emergency fund (these two document fixes 2 and 3), Transaction rows, Valuation rows (kind = valuation), Adding an account.
- Writing and Closing a month now say Entries, Payslips and Contracts in place of Transactions, Valuations and Subscriptions.
- Valuations limit no longer calls values fictional.

## Preflight

First pass: 3 accounts, not 2, because a valuation needs a non-ledger account; 6 Entries rows (purchase, salary, transfer pair, cafe, valuation). The valuation account sat in row 4, an old ledger-formula slot. Balances correct ($3,690.50, $700, $305,000) and the Balance change explained check passed.
Second pass, added to prove the fixes: people "Alex, Sam", a payslip, an Emergency fund goal, a subscription contract with its charge, a decision, a loan with its account and valuation. Payslip write was accepted, Tax Forecast showed Alex and Sam, emergency cover was 24.6 months, Subscriptions, Contracts next date, Assets and Mortgage Scenarios all computed. Errors fell from 150 to 7.
Parsed with Python from saved grid reads over all 26 tabs, including notes, links and validation. All test rows removed.

## Blank state, confirmed

As-of 30/06/2023. Zero hits for Davies, Jordan, Mia, Harbour or any Davies account id, merchant or place anywhere in the saved read. No notes, no links, 1 chart, 26 tabs. No typed cell left in any raw area.

128 error values remain. All natural:
- Transactions A2, Valuations A2: FILTER with nothing to show. Clear on the first row of that kind.
- Balances A2:F2 (6 cells): no accounts. Clears on the first account.
- Loans J2:K3 (4), Mortgage Scenarios (104), Metrics C21, C22, F22: no loan in Loans row 2.
- Metrics C24, F24, C27, E27, F27, G27: no spending.
- Dashboard B7 (#DIV/0!, no net worth 12 months back), B29 (#VALUE!, no flagged subscription), H29 (#N/A, no compliance review).

## Still broken or worth knowing

1. Silent, and the one that matters: Settings holds tax brackets for FY26 and FY27 only. With As-of 30/06/2023 the Tax Forecast finds no bracket for FY22 to FY25, so income tax is $0 with no error and refunds are overstated (preflight: $45,600 salary, income tax $0, refund $8,688). Fixing it means adding ATO rates for those years to Settings E:H, which is data I was not given. Left alone.
2. Mortgage Scenarios and Savings Finder rows 10 and 11 read Loans row 2 only, so the home loan must be first. A household with no loan keeps the Mortgage errors and Metrics C21, C22, F22. Guarding it means rewriting about 100 cells. A household with one loan keeps #NUM! on Loans J3:K3, which nothing reads.
3. Dashboard B7, Metrics C24 and F24 stay in error until there are 12 months of history. Dashboard B29 and H29 stay in error whenever nothing is flagged. Self-contained, so left alone.
4. Goals E:J formulas exist on rows 2 to 4 only, and empty rows show "Reached". A fourth goal needs E:J copied down.
5. Tax Forecast holds two people. Accounts H is filled to row 19.
6. Kitty public_feed stays "yes". Fine for fictional data, wrong if this template ever holds real money.
7. Dashboard B3 still says "Demo Data (Fictional)", and Compliance Checks F17 still says "both loans". Neither blocks anything.
8. Any Apps Script bound to the source travels with a Drive copy. These tools cannot read it, so it is unchecked.
