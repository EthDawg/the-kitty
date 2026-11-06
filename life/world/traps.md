# Traps, by chapter

Written before any run, so a score cannot be fitted afterwards. Each trap has a stable id. `truth.json` carries the instance
of every trap for the family it was built for (`traps[id]`: dates, cents, accounts), so a scorer reads this page for the
meaning and `truth.json` for the numbers. A variant family carries the same traps with its own numbers.

A trap is something a correct household gets right and a careless one gets silently wrong. Anything added after the first
soundness run is marked **added after**, with the reason. Nothing here is removed because it scored badly. The page was
committed before the first run (`c6385df`). One wording changed afterwards: T2-MISFILED said "a super statement", and a
family whose fund issues no half-yearly PDF has a different statement to misfile. The trap is the same.

Australian rules come from `pace-setter/lifecycle/research.md` Part A and `standard/reference/au-verified.json`. Where the
research says "unconfirmed" this page says so too. Fictional family, not tax advice.

## Chapter 0: the first recipe

| Id | Trap | Correct |
|---|---|---|
| T0-NO-RECIPE | The acting person's bank export has no public recipe. The file is unknown, not wrong. | Unread by public recipes, named as `no_recipe`. An agent writes a recipe from a few rows and it passes the gate. Nothing is imported by guesswork. |
| T0-SECOND-ACCOUNT-FREE | The saver at the same bank has the same layout. | The recipe from T0-NO-RECIPE reads it with no second recipe: one fingerprint, cached. |
| T0-DATE-ORDER | A short window where most days are 12 or under. | The gate proves the date reading from a day above 12 or the balance chain. A file whose order cannot be proved is refused, never guessed. |

## Chapter 1: blank Kitty, one account, three months

| Id | Trap | Correct |
|---|---|---|
| T1-OPENING-FROM-FILE | No opening balance is typed anywhere. | The first line's stated balance gives the opening. The three month-ends tie to the cent. |
| T1-CARD-PAYMENT-NO-CARD | The everyday account pays a card the Kitty has not heard of. | An open item or a transfer to an unknown account. Never spending. |
| T1-SALARY-NO-PAYSLIP | Salary arrives as a net bank credit with no payslip yet. | Income at the net amount from the line alone, and gross is shown as not known, not as zero. |
| T1-TRANSFER-TO-SAVER | Money moves to a saver the Kitty does not hold yet. | A transfer with one side, shown as open. Not spending. |

## Chapter 2: first close

| Id | Trap | Correct |
|---|---|---|
| T2-OVERLAP-WINDOW | The backfill file overlaps the first dropped file by two weeks. | Overlapping lines count once. |
| T2-SAME-DAY-TWINS | Two identical purchases on one day inside the overlap. | Stay two. Identity is a multiset, not a set. |
| T2-STATEMENT-AND-ACTIVITY | A card's activity CSV and its statement PDF are two witnesses to one set of lines. | Each purchase is spending once. |
| T2-CARD-CYCLE | The card closes on the 14th, the books close at month end. | Balances move on posting. A statement period is not a month. |
| T2-PAYMENT-TWO-SIDES | The repayment shows on the everyday account and on the card. | One own transfer. Not spending, not income. |
| T2-HELP-NO-BANK-LINE | HELP lives only on the government page: indexation on 1 June, repayments inside an assessment. | A liability with no cash. Nothing in the spending view. |
| T2-SALARY-PACKAGING | Salary packaging: the payslip's gross is after the package, and the packaged money arrives as a separate credit from the provider. | The credit is the person's pay, not a refund and not a gift. Public recipes do not read the package line, which is a finding, not a trap to hide. |
| T2-DRIVE-MISSING-MONTH | The family's Drive holds every month but one. | Coverage names the month. The portal still has it. |
| T2-BYTE-DUPLICATE | `Statement (1).csv` is the same bytes as its original. | One source. |
| T2-SCAN | `scan0003.pdf` and a phone screenshot of a receipt have no text layer. | Agent tier, a model reads the image. No recipe may claim them. |
| T2-MISFILED | A statement sits in a folder called Car. | Identity comes from the content, never the folder. |

## Chapter 3: they join

| Id | Trap | Correct |
|---|---|---|
| T3-JOINT-TWICE | Both people downloaded the joint account, with different windows, cadences and file names, so the bytes differ. | Every joint line counts once and the joint balance ties. |
| T3-JOINT-SAME-FILE | One month is also byte-identical between them. | One source, whoever dropped it first. |
| T3-PRIVATE-HISTORY | History from before joining stays private. | `person` and `visible_to` hold: each person's payslips and solo accounts are not the other's. A merged view shows what was shared, not all of it. |
| T3-SALARY-CHANGE-MID-MONTH | A pay rise on the 15th. One fortnight straddles it. | The blended fortnight is one payslip. Its gross is on no annual salary. Nothing infers a new salary from it. |
| T3-COUPLE-TRANSFER | Before joining, one pays the other their half of a bond. In each solo Kitty this looks like spending and a gift. | Once merged it is an own transfer, and the solo reading is re-decided, not double counted. |
| T3-BOND | A rental bond leaves the joint account. | Not spending. Money held by a third party that returns later (see T5-BOND-BACK). |
| T3-TWO-NAMES-ONE-ACCOUNT | Each person's setup calls the joint account something different. | One account after merge, by the account number. |

## Chapter 4: first joint tax time

| Id | Trap | Correct |
|---|---|---|
| T4-AMENDMENT | A prior-year return is amended. Both notices exist, version 1 and version 2. | The later version stands for that year, the first is kept, and the extra tax is one bank line. |
| T4-HELP-IN-ASSESSMENT | Compulsory HELP repayment arrives inside the assessment as a smaller refund, with no bank line. | The debt falls by the repayment. The refund is the refund. |
| T4-JOINT-INTEREST-SHARE | Joint interest. | Household counts it once. Each return counts a share. |
| T4-PHI-1-APRIL | Health rebate rates reset each 1 April, inside the financial year. | A year has two rates. One rate for the whole year does not reproduce the rebate. |
| T4-CGT-VALUE-30-JUNE | CGT assets held at 30 June 2027 need a market value on that day, per Act 49 of 2026 as read by the research, **unconfirmed** past search extracts. The value sits on the plan portal and is not in any file the household downloaded. | The household knows it needs the value and names the gap. An asset with no value on that day breaks silently otherwise. |
| T4-OWNER-NOT-NAME | One account's interest is declared by who owns the money, not by the name on it (see T6-CHILD-INTEREST-OWNER for the later case). Here: a saver in one person's name holding the couple's shared money from March 2027. | The interest splits by beneficial ownership from that date. Pre-fill shows it all on the named holder. |
| T4-REFUND-OLD-ACCOUNT | A refund lands on the account the tax office still holds, not the joint one. | Income tax refund, not income, wherever it lands. |
| T4-ACCOUNTANT-ZIP | The accountant takes a zip, no links. | Pack holds evidence by value. A link is a gap. |

## Chapter 5: home, Salt, the estate

| Id | Trap | Correct |
|---|---|---|
| T5-SETTLEMENT | A deposit months earlier and a settlement statement that nets loan funds against cash. | One purchase. Cost base includes duty and legal. No spending. |
| T5-CGT-TWO-REGIMES | A share disposal after 1 July 2027 spans two regimes: discount on the gain to 30 June 2027, indexation after. **Unconfirmed.** | The disposal is held with the mid-2027 value and flagged. A single-regime gain is a wrong number stated confidently. |
| T5-OFFSET-INTEREST | Offset reduces daily interest. | Interest charged is the lender's and ties to rate times balance net of offset. |
| T5-RATE-BACKDATED | A lender backdates a rate cut. | Rate history gains rows. Interest already charged stays. |
| T5-MORTGAGE-SPLIT | A repayment is part interest, part principal. | Cash lens: repayment. Economic lens: interest only. Net worth: principal. |
| T5-PARENTAL-LEAVE-MONTH | A month where employer leave pay ends and the government's pay begins. | Two payers, both income. A low month is not a missing month. |
| T5-BOND-BACK | The bond returns across a month end, less a cleaning charge. | Not income. The charge is the only spending. |
| T5-REFUND-ACROSS-MONTH | A card refund posts the month after the purchase. | Lowers spending in the month it posts, on the same category. Not income. |
| T5-GIFT-DEPOSIT | Family money towards the deposit. | Not income for tax. Moves net worth. |
| T5-WARRANTY | A receipt in email carries a warranty date. | A durable thing, with a date, off the balance sheet. |
| T5-WILL-NO-KIND | Wills and a certificate of currency sit in Drive. A will has no money in it. | Held as evidence by hash and not read. No recipe may invent a number from it. |
| T5-CCS | A childcare statement shows gross fee, subsidy and gap. The bank shows only the gap. | Spending is the gap. The statement clears the line. |
| T5-NEW-DEPENDANT | A child joins the household. | `membership` from the birth date. Age comes from `birth_date`. |

## Chapter 6: pocket money

| Id | Trap | Correct |
|---|---|---|
| T6-MEMO | Pocket money is the family's intent, not bank data. | A memo account with a running balance from the family's words. No bank line, no income, no spending in the household totals. |
| T6-CHILD-INTEREST-OWNER | A saver in a parent's name holds the child's gifted money. Who owns the money decides who declares it, not the name on it. | The interest is the child's for tax, under the $416 line. |
| T6-PREFILL-WRONG-PERSON | Pre-fill follows the TFN on the account, so the child's interest lands on the parent's pre-fill. | The Kitty disagrees with pre-fill, says so, and does not add it twice. |
| T6-TEN-YEARS-OF-LAW | Every year past `verified_at` uses the last known table. | Tax past coverage is marked assumed, never stated as law. |

## Later chapters, simplified

| Id | Trap | Correct |
|---|---|---|
| T7-GST-FREE | Private physiotherapy is mostly GST-free, and GST-free sales still count to the registration threshold. Simplified stream. | BAS shows sales at the GST-free label. The research's own caution applies: check the rule when chapter 7 is built. |
| T9-UNDER-18-SUPER | Super for an under-18 is owed only in weeks over 30 actual hours for that employer, with no averaging. | Most of a teenager's payslips show no super. 12% across the board is wrong. |
| T9-MEMO-TO-REAL | The child's memo balance becomes a real account. | The memo closes against the first deposit and nothing is counted twice. |
