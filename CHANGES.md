# Changes to the Sheet

Each heading is a sheet version. A household's own harness reads the notes since its `Kitty!sheet_version`, plans against the Sheet in front of it, writes one batch, reads Compliance Checks and moves `sheet_version` on. Say: "Read the Kitty changes since sheet version 2 and apply them to my Sheet. Show me the plan first."

Each note says why, what changes, what good looks like, and how to treat a household's own tailoring.

## 3, 8 November 2026: receipts, choices, levers and tax years

Five new tabs. Nothing that exists changes. A page built for version 3 keeps a view dark until its tab exists, so a household that has not upgraded loses nothing.

Write each tab with typed cells (`update_spreadsheet`, `updateCells`) so codes like `0783` and dates stay as written. The formula columns below go in row 2 only; they fill the column themselves. As with Entries, write rows by explicit range, never by append: the formula columns make the tab look full to an append.

### Receipts and Receipt Lines (raw data)
- Why: a bank line says "WOOLWORTHS 3021 $336.31". A receipt says what was bought, what was GST-free, what was on special, and whether it was paid by a gift card the bank will never show. Paying with a gift card, cash or points is still spending.
- Change: add `Receipts` with headers `Receipt ID, Date, Time, Merchant, Merchant ID, Store, Channel, Person, Items, Total, GST, Savings, Paid with, Entry ID, Account ID, Source, Source kind, Read by, Check, Note` and `Receipt Lines` with `Receipt ID, Line, Printed text, Product, Brand, Group, Kind, Qty, Unit, Unit price, Amount, GST, Pack size, Price per kg or L, Retailer code, Note`.
- Lists: Channel `In-store, Online delivery, Online pickup, Online`; Paid with `Card, Gift card, Cash, Mixed, Points`; Source kind `Photo, PDF, Email, Export, Screenshot`; Group `Fruit & veg, Meat & seafood, Dairy & eggs, Bakery, Pantry, Snacks & sweets, Drinks, Frozen, Prepared meals, Baby, Health & beauty, Household, Alcohol, Pet, Other`; Kind `Item, Discount, Fee, Deposit`; Unit `each, kg, L`; GST `Taxable, GST-free`.
- Formulas:
  - `Receipts!S2`: `=MAP(A2:A,J2:J,I2:I,LAMBDA(id,tot,items,IF(id="","",LET(lsum,SUMIFS('Receipt Lines'!K:K,'Receipt Lines'!A:A,id),lcount,COUNTIFS('Receipt Lines'!A:A,id,'Receipt Lines'!G:G,"Item"),IF(ABS(lsum-tot)>0.05,"Lines "&TEXT(lsum,"0.00")&" vs "&TEXT(tot,"0.00"),IF(AND(N(items)>3,lcount<=1),"One line for "&items&" items","OK"))))))`
  - `Receipt Lines!N2`: `=MAP(A2:A,K2:K,H2:H,I2:I,M2:M,LAMBDA(id,a,q,u,p,IF(OR(id="",a=""),"",IF(OR(u="kg",u="L"),IFERROR(ROUND(a/q,2),""),IFERROR(LET(n,VALUE(REGEXEXTRACT(p,"[0-9.]+")),un,LOWER(REGEXEXTRACT(p,"[A-Za-z]+$")),f,IFS(un="g",n/1000,un="kg",n,un="ml",n/1000,un="l",n,TRUE,NA()),ROUND(a/(q*f),2)),"")))))`
- How to fill: one Receipts row per receipt or order; one Receipt Lines row per printed line in printed order; a multi-buy or promotion is its own negative line with Kind `Discount`. A refund or return is its own receipt with a negative Total and negative lines, so it takes money off spending. Never write one line for a whole docket to make it tie: if the lines can't be read, leave the receipt for a person (the Check says "One line for N items"). When a card paid, set Entry ID to the Entries row it explains. When a gift card, cash or points paid, leave Entry ID blank and add a spending row on Entries against that payment's account (a gift card is an account), so totals see it. Supermarket GST markers differ: ALDI prints `A` for GST-free and `B` for taxable; Coles marks taxable lines `%`.
- Good is: every receipt's Check reads OK, every card receipt has an Entry ID, refunds are negative, and Transactions' "Receipt held" can read Receipts.

### Decision Options (input)
- Why: a decision is easier when every option is costed on the same horizon and someone has said which they would pick.
- Change: add `Decision Options` with `Decision ID, Question, Ref, Option, Upfront, Per month, Months, Extra, Total, Recommended, Decide by, Status, Source, Note`. Recommended is a checkbox; Status `Open, Decided, Dropped`.
- Formula: `I2`: `=MAP(A2:A,E2:E,F2:F,G2:G,H2:H,LAMBDA(id,e,f,g,h,IF(id="","",N(e)+N(f)*N(g)+N(h))))`
- How to fill: one row per option. Repeat the Decision ID; the question may sit on the first row only. Months is how long the per-month cost runs under that option (0 when there is none); the page compares every option over the longest of them, so totals line up. Anything still owed at the end of that horizon goes in Extra. When decided, set every row's Status and record the choice on Decisions.

### Goal Levers (input)
- Why: "when do we get there" is one date; "what moves it" is the useful question.
- Change: add `Goal Levers` with `Lever ID, Goal, Lever, On, Per month, One-off, Date if on, Date if off, Months moved, Source`. On is a checkbox.
- Formulas (the goal's remaining amount is Goals Target less Balance now; its pace is Goals' saved per month over the last three months):
  - `G2`: `=MAP(A2:A,B2:B,D2:D,E2:E,F2:F,LAMBDA(id,goal,on,pm,oo,IF(id="","",LET(asof,INDEX(Settings!B:B,MATCH("As-of date",Settings!A:A,0)),r,MATCH(goal,Goals!A:A,0),need,INDEX(Goals!B:B,r)-INDEX(Goals!E:E,r),base,N(INDEX(Goals!I:I,r)),opm,SUMIFS(E:E,B:B,goal,D:D,TRUE)-IF(on,N(pm),0),ooo,SUMIFS(F:F,B:B,goal,D:D,TRUE)-IF(on,N(oo),0),rest,need-ooo-N(oo),rate,base+opm+N(pm),IF(rest<=0,EOMONTH(asof,-1)+1,IF(rate<=0,"Never",EOMONTH(asof,CEILING(rest/rate,1)-1)+1))))))`
  - `H2`: the same with this lever left out: `rest,need-ooo` and `rate,base+opm`.
  - `I2`: `=MAP(A2:A,G2:G,H2:H,LAMBDA(id,g,h,IF(id="","",IF(OR(g="Never",h="Never"),"",(YEAR(h)-YEAR(g))*12+MONTH(h)-MONTH(g)))))` (positive means the lever, when on, brings the date earlier).
- Good is: with the levers as set, Date if on for any lever that is on equals the plan date the page shows.

### Tax Returns (raw data)
- Why: Tax Forecast estimates this year. Last year's lodged result and the years before are history the household already has on notices.
- Change: add `Tax Returns` with `Person, FY, Status, Taxable income, Tax on income, Medicare, Offsets, Withheld, Result, Lodged, Notice, Pack, Source, Note`. Status `Estimate, Lodged, Assessed, Amended`.
- Formula: `I2`: `=MAP(A2:A,E2:E,F2:F,G2:G,H2:H,LAMBDA(p,e,f,g,h,IF(p="","",ROUND(N(h)-(N(e)+N(f)-N(g)),2))))` (positive is a refund).
- How to fill: from each notice of assessment; an amended year keeps one row with Status `Amended` and a Note. Pack links the year's tax pack folder (an index document and copies of every source, made by the harness on request).

### Compliance Checks
Write six rows below the "Checks needing review" row, leaving one blank row between. Do not insert rows: inserting moves that row and rewrites the references Metrics holds to it. Its open range (`E5:E`) and Metrics' open ranges count the new rows where they are. Columns as the existing rows: Check, Type, Items, Amount, Status, Why it matters, Where to look. `<as-of>` is `Settings!$B$6`; `<n>` is the row's own number.

| Check | Type | Items | Amount | Status | Why it matters | Where to look |
|---|---|---|---|---|---|---|
| Receipts that don't add up | Data | `=COUNTIF(Receipts!S:S,"Lines*")+COUNTIF(Receipts!S:S,"One line*")` | | `=IF(C<n>>0,"Review","OK")` | A receipt whose lines don't sum to its total was read wrongly or is missing a line. | Receipts, Check |
| Card receipts with no bank row | Data | `=COUNTIFS(Receipts!M:M,"Card",Receipts!N:N,"",Receipts!A:A,"<>")` | `=SUMIFS(Receipts!J:J,Receipts!M:M,"Card",Receipts!N:N,"")` | `=IF(C<n>>0,"Review","OK")` | A card payment should appear on a bank line; if it doesn't, the import is missing or the receipt is a duplicate. | Receipts, Entry ID |
| Spending outside the bank, latest month | Data | `=COUNTIFS(Receipts!M:M,"<>Card",Receipts!M:M,"<>",Receipts!B:B,">"&EOMONTH(<as-of>,-1),Receipts!B:B,"<="&EOMONTH(<as-of>,0))` | `=SUMIFS(Receipts!J:J,Receipts!M:M,"<>Card",Receipts!M:M,"<>",Receipts!B:B,">"&EOMONTH(<as-of>,-1),Receipts!B:B,"<="&EOMONTH(<as-of>,0))` | `=IF(C<n>>0,"Note","OK")` | Gift cards, cash and points are still spending. The bank never shows them, so each needs a row on its own account. | Receipts, Paid with |
| Decisions with more than one pick | Data | `=IFERROR(ROWS(UNIQUE(FILTER('Decision Options'!A2:A,'Decision Options'!J2:J=TRUE,COUNTIFS('Decision Options'!A2:A,'Decision Options'!A2:A,'Decision Options'!J2:J,TRUE)>1))),0)` | | `=IF(C<n>>0,"Review","OK")` | One decision, one recommended option, or the page can't say which it would pick. | Decision Options, Recommended |
| Decisions past their decide-by date | Data | `=IFERROR(ROWS(UNIQUE(FILTER('Decision Options'!A2:A,'Decision Options'!L2:L="Open",'Decision Options'!K2:K<>"",'Decision Options'!K2:K<<as-of>))),0)` | | `=IF(C<n>>0,"Review","OK")` | A choice left open past its date usually costs money; decide it or move the date. | Decision Options, Decide by |
| Lodged years without a tax pack | Tax | `=COUNTIFS('Tax Returns'!C:C,"<>Estimate",'Tax Returns'!A:A,"<>",'Tax Returns'!L:L,"")` | | `=IF(C<n>>0,"Note","OK")` | Keep five years of records. A pack puts the return and every source in one folder. | Tax Returns, Pack |

### The README tab
- In its "How the workbook is organised" table, add Receipts, Receipt Lines and Tax Returns to Raw data, and Decision Options and Goal Levers to Inputs. This is the one existing tab the note edits.
- Checkbox columns (Recommended, On) hold FALSE in every row once validated, so those tabs look full to an append: write their rows by explicit range.

### The Kitty tab
- `sheet_version` becomes 3 only when all five tabs are present or mapped to the household's own. If any part waits on the household's answer (a name collision, say), leave it at 2, apply the rest, and record "version 3 in part: <what waits>" on Decisions. The page reads each tab on its own, so nothing is lost while it waits.

### Test before you finish
Empty tabs hide formula mistakes: in a trial of nine runs, two wrote Date if off wrongly and every check still read OK. So before moving `sheet_version`, write one temporary row on each new tab, read the results, then clear the rows:
- Goal Levers: a lever with Per month 200, On ticked, on a goal with money still to save. Date if off must be later than Date if on, and Months moved must equal the difference. Untick it: Date if on must move later instead.
- Decision Options: Upfront 100, Per month 25, Months 5, Extra 0. Total must read 225. Tick Recommended on two rows of one decision: "Decisions with more than one pick" must read 1.
- Tax Returns: Withheld 10,000, Tax on income 8,000, Medicare 500, Offsets 0. Result must read 1,500.
- Receipts and Receipt Lines: one receipt with Total 10.00 and two lines of 4.00 and 6.00. Check must read OK; change one line to 5.00 and it must read "Lines 9.00 vs 10.00".
Clear every test cell and untick the boxes. Report what each test read.

A name inside `LET` or `LAMBDA` is never also a function's name (`n`, `sum`, `count`, `max`). Sheets then reads `N(...)` as a call to the name, and every row errors. The first cut of this note named them `sum` and `n` in the Receipts check, and on the Davies sheet all 94 receipts read #N/A until the names were changed to `lsum` and `lcount`.

### Tailoring
- A household that already keeps receipts, quotes or returns in its own tab keeps that tab. Map it rather than copying it: either add the version 3 tab as formulas over theirs, or record on Decisions that their tab is the source and leave the version 3 tab out. Ask before either.
- Never rename, reorder or rewrite an existing tab, header or formula. A name collision (the household already has a tab called `Receipts`) is a question, not an overwrite. A page reads a version 3 tab only when its headers match, so a household's own tab of the same name is never mistaken for it.
- If the household renamed a tab the formulas use (Goals, say), use their name in the new formulas and record it on Decisions.
- Good is: every cell that existed before the upgrade reads the same afterwards, except `sheet_version` and the new Compliance Checks rows.

### Fixes
A reader's audit of the public page (8 November 2026) found three of the sheet's own derived columns reading the wrong rows. The page now reads these from the rows and keeps the sheet's figure beside its own, so each drawer can say where they differ. These notes fix the sheet so the two agree again. They are the one exception to "nothing that exists changes" above: afterwards Subscriptions, the Next date on Contracts for subscriptions and insurance, the duplicate check and two Savings Finder lines read differently. Every formula below is written against the Transactions view's columns (A Txn ID, B Date, C Account ID, D Bank description, E Merchant, F Amount, G Category ID, H Person, I Receipt held, J Note). Adapt the ranges to the Sheet in front of you; if a household has rewritten one of these columns, show the plan and ask first.

#### A duplicate with a receipt or a note on each row is two purchases
- Why: two Qantas fares on 19 Dec 2026, $2,418 each, both with a receipt and the note "Japan flights, April 2027", were counted as a double charge "worth disputing". They are two tickets for two adults. The check, the Savings Finder line and the Metrics row `savings.one_off` all carried the $2,418.
- Change: in Compliance Checks, `Possible duplicate charges` counts a same-day group (same Date, Account ID, Merchant and Amount, below zero) only when not every row in the group holds a receipt and not every row carries a note. Items, with the same body for the amount using `-amt*(n-1)/n` in place of `(n-1)/n`:
  `=SUM(MAP(Transactions!A2:A,Transactions!B2:B,Transactions!C2:C,Transactions!E2:E,Transactions!F2:F,LAMBDA(id,d,a,mer,amt,IF(OR(id="",N(amt)>=0),0,LET(n,COUNTIFS(Transactions!B:B,d,Transactions!C:C,a,Transactions!E:E,mer,Transactions!F:F,amt),y,COUNTIFS(Transactions!B:B,d,Transactions!C:C,a,Transactions!E:E,mer,Transactions!F:F,amt,Transactions!I:I,"Y"),t,COUNTIFS(Transactions!B:B,d,Transactions!C:C,a,Transactions!E:E,mer,Transactions!F:F,amt,Transactions!J:J,"<>"),IF(AND(n>1,y<n,t<n),(n-1)/n,0))))))`
  Savings Finder's duplicate line reads the same items and amount, and is renamed `Check charges that look doubled`; "Why it matters" says "Check whether these are two purchases before disputing".
- Good is: on the Davies sheet the check reads 2 items, $295.80 (JB Hi-Fi on 14 Mar 2026 and Uber Eats on 9 Jul 2026), and the Qantas pair is not in it.

#### A premium adjustment is not a price, and a refund is not a charge
- Why: Bupa's lowest charge in the look-back was a $31.20 row, `BUPA HEALTH INSURANCE PREMIUM ADJ` on 30 Dec 2026, so the sheet read a $388.15 price rise and $4,657.80 a year to push back on. The premium went from $398.20 to $419.35, which is $253.80 a year. Paramount+'s latest charge was the +$9.99 refund on 24 Jan 2027, so its annual cost read −$119.88 and the cancel saving shrank by $239.76.
- Change: in Subscriptions, Last charged, Latest charge and Lowest charge in look-back read only rows with an Amount below zero whose Bank description is not an adjustment or refund. The test for that is `NOT(REGEXMATCH(UPPER(Transactions!D:D),"\b(ADJ|ADJUSTMENT|REFUND|REVERSAL|REVERSED)\b"))`, added to each `FILTER` or `SUMIFS`-style lookup beside the merchant test. Annual cost is `MAX(0, …)`. When Price rise per charge is more than half the lowest charge, Annual cost of price rise is 0 and the row's Usage flag gains `· check the price`; such a jump is usually a different product or a one-off, not a rise.
- Good is: Bupa reads $398.20 to $419.35 and $253.80 a year; Paramount+ reads last charged 19 Jan 2027, $9.99, annual $119.88; Savings Finder's price-rise line reads $313.80 and the unused-subscriptions line $1,349.16.

#### A merchant's rows are matched on category too
- Why: Allianz sells car and travel insurance. The 15 Jan 2027 row `ALLIANZ TRAVEL INSURANCE` ($312, Holidays, note "Japan trip") became the car policy's latest charge, so Subscriptions showed car insurance at $312 a year and Contracts dated its renewal 15 Jan 2028. The car policy renewed at $1,348 on 14 Aug 2026.
- Change: every Subscriptions lookup above also requires `Transactions!G:G` to equal the row's Category ID. On Contracts, a subscription or insurance row's Next date and Amount follow its Subscriptions row: the latest charge and its date plus one cadence.
- Good is: Car insurance reads $1,348, last charged 14 Aug 2026, next 14 Aug 2027.
- Tailoring: a household that files one provider's two products under one category keeps its rows; ask whether to split the category or add a Rules row that tells the products apart.

## 2.1, 7 November 2026: the blank template

The v2 Sheet was emptied into a blank template and tested from it. These changes let a household that is not the Davies use it.

### Accounts balance follows the account's method
- Why: Accounts H2:H19 held two position-dependent formulas, so listing accounts in another order gave silently wrong balances.
- Change: one formula in H that branches on K: `IF($K2="ledger", <ledger balance>, <valuation balance>)`.
- Good is: every account's H matches Balances for the As-of month, in any row order.
- Tailoring: keep the household's row order.

### Emergency cover reads a goal
- Why: Metrics C14 read a fixed account id, so a household without that account saw zero months of cover.
- Change: `Metrics!C14 = SUMIFS(Goals!E:E, Goals!A:A, "Emergency fund")`.
- Good is: emergency cover equals the balance of the Goals row named Emergency fund; with no such row it reads 0.
- Tailoring: if the household renamed that goal, use their name and record it on Decisions.

### Tax Forecast names come from the Kitty tab
- Why: B4:E4 and the comparisons in rows 7 and 16 were typed Davies names.
- Change: B4 and C4 take the first two names under `people` on the Kitty tab, falling back to Person 1 and Person 2; the comparisons use `$B$4`.
- Good is: Tax Forecast shows the household's own two people.

### Empty lists show nothing
- Why: with no subscription contract, or only ledger accounts, `FILTER` returned `#N/A` and it ran through Savings Finder, Metrics and the Dashboard; a month could never close.
- Change: `Subscriptions!A2`, `Assets!A2` and `Budget!A7` wrapped in `IFERROR(…, "")`; `Savings Finder!C10` wrapped in `MAX(0, …)`.
- Good is: an empty household shows blanks, not errors, and Compliance Checks can reach OK.

### Neutral starting values
- Why: the template still carried one family's budgets, names and a public-feed switch.
- Change: category budgets set to 0; Payslips and Transactions person dropdowns removed; the Dashboard's demo label removed; `Kitty!public_feed` set to `no`.
- Good is: nothing in a new copy names another household, and the bound script's feed refuses until the owner turns it on.
- Tailoring: a household that set its own budgets keeps them.

## 2, 4 November 2026: the ledger

The baseline. One Entries tab holds every bank line and valuation; Transactions, Valuations, Balances and the reports are formulas over it.
