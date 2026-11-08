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
  - `Receipts!S2`: `=MAP(A2:A,J2:J,I2:I,LAMBDA(id,tot,items,IF(id="","",LET(sum,SUMIFS('Receipt Lines'!K:K,'Receipt Lines'!A:A,id),n,COUNTIFS('Receipt Lines'!A:A,id,'Receipt Lines'!G:G,"Item"),IF(ABS(sum-tot)>0.05,"Lines "&TEXT(sum,"0.00")&" vs "&TEXT(tot,"0.00"),IF(AND(N(items)>3,n<=1),"One line for "&items&" items","OK"))))))`
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

### Tailoring
- A household that already keeps receipts, quotes or returns in its own tab keeps that tab. Map it rather than copying it: either add the version 3 tab as formulas over theirs, or record on Decisions that their tab is the source and leave the version 3 tab out. Ask before either.
- Never rename, reorder or rewrite an existing tab, header or formula. A name collision (the household already has a tab called `Receipts`) is a question, not an overwrite. A page reads a version 3 tab only when its headers match, so a household's own tab of the same name is never mistaken for it.
- If the household renamed a tab the formulas use (Goals, say), use their name in the new formulas and record it on Decisions.
- Good is: every cell that existed before the upgrade reads the same afterwards, except `sheet_version` and the new Compliance Checks rows.

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
