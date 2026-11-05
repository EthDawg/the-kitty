# Digital Davies v2 loan payment dates

`Contracts!M2` owns the array formula for **Next date**. The original formula schedules both monthly loans on the first. The home loan’s 19 repayments on `ACC-EVD` fall on the first, and all 19 investment interest payments on `ACC-RNT` fall on the 28th. The fictional bank export for February records the same two days. Both date generators agree ([past history](../portals/history.py), [future months](../period-close/simulate.py)).

For a monthly loan with a unique loan category, estimate the next day from the two most recent negative transactions in that category through the Sheet’s as-of date. Require one payment in each of two consecutive months and a matching day after allowing for shorter months. The most recent payment must be in the current or previous month. Return a blank when the history is sparse, stale, or ambiguous. This estimate describes the payment schedule. The loan agreement owns the contractual obligation.

| As-of date | Last two payments | Next date |
| --- | --- | --- |
| 31 Jan 2027 | 1 Dec and 1 Jan | 1 Feb 2027 |
| 31 Jan 2027 | 28 Dec and 28 Jan | 28 Feb 2027 |
| 10 Feb 2027 | 28 Dec and 28 Jan | 28 Feb 2027 |
| 31 Jan 2027 | 31 Dec and 31 Jan | 28 Feb 2027 |
| 28 Feb 2027 | 31 Jan and 28 Feb | 31 Mar 2027 |
| 31 Jan 2027 | 18 Dec and 28 Jan | blank |

The following Python function transforms the known original formula. It stops on a different source revision and preserves the lease, subscription, and empty-row branches byte for byte.

```python
ORIGINAL = '=MAP(A2:A,B2:B,C2:C,G2:G,H2:H,LAMBDA(id,kind,name,cat,cad,IF(LEN(id),IF(kind="loan",EOMONTH(Settings!$B$6,0)+1,IF(kind="lease",EDATE(MAXIFS(Transactions!$B:$B,Transactions!$G:$G,cat,Transactions!$B:$B,"<="&Settings!$B$6),1),IFERROR(IF(REGEXMATCH(VLOOKUP(name,Subscriptions!$A:$P,16,FALSE),"Cancelled|Stopped"),"",EDATE(VLOOKUP(name,Subscriptions!$A:$H,8,FALSE),12/VLOOKUP(cad,Settings!$J:$K,2,FALSE))),""))),)))'
LOAN = (
    'IFERROR(IF(AND(cad="Monthly",cat<>"",COUNTIFS($B$2:$B,"loan",$G$2:$G,cat)=1,ISNUMBER(Settings!$B$6)),'
    'LET(asOfDay,INT(Settings!$B$6),'
    'paidDates,SORT(FILTER(Entries!$C$2:$C,Entries!$B$2:$B="transaction",Entries!$H$2:$H=cat,'
    'ISNUMBER(Entries!$G$2:$G),Entries!$G$2:$G<0,ISNUMBER(Entries!$C$2:$C),Entries!$C$2:$C>0,Entries!$C$2:$C<=asOfDay),1,FALSE),'
    'lastPaid,INDEX(paidDates,1,1),priorPaid,INDEX(paidDates,2,1),payDay,MAX(DAY(lastPaid),DAY(priorPaid)),'
    'monthEnd,EOMONTH(asOfDay,0),thisDue,MIN(monthEnd,EOMONTH(asOfDay,-1)+payDay),'
    'IF(AND(EOMONTH(priorPaid,1)=EOMONTH(lastPaid,0),EOMONTH(lastPaid,0)>=EOMONTH(asOfDay,-1),'
    'SUMPRODUCT(--(paidDates>EOMONTH(priorPaid,-1)))=2,DAY(lastPaid)=MIN(payDay,DAY(EOMONTH(lastPaid,0))),'
    'DAY(priorPaid)=MIN(payDay,DAY(EOMONTH(priorPaid,0)))),IF(thisDue>asOfDay,thisDue,MIN(EOMONTH(asOfDay,1),monthEnd+payDay)),"")),""),"")'
)


def replacement(current_formula):
    old_loan = 'EOMONTH(Settings!$B$6,0)+1'
    if current_formula != ORIGINAL or current_formula.count(old_loan) != 1:
        raise ValueError('Read Contracts!M2 again and review its current formula.')
    return current_formula.replace(old_loan, LOAN, 1)
```

To apply to the fictional Sheet, capture the original M2 formula and every evaluated `Contract ID → Next date` first. Constrain the edit to M2 and require an exact, case-sensitive whole-formula match to `ORIGINAL`. The Sheets API supports this through `findReplace` with `range`, `includeFormulas` and `matchEntireCell`. Read back the resulting formula, numeric date values and date formatting. Compare every contract, including blank results. `C0018` should remain `46419` and only `C0019` should move from `46419` to `46446`. If validation fails, use the same whole-cell comparison to restore the saved original, then verify the original values. Refresh `data/snapshot-v2.json` from the verified Sheet and run `python3 fixtures/make-v2-fixtures.py`. [Google Sheets find-and-replace request](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#findreplacerequest)

**Live check, 5 November 2026:** the original formula in M2 matched exactly; the conditional replacement changed one formula. A fresh read of all 20 populated Contracts rows (A:Q) found exactly one different effective value: C0019 / M20, 46419 → 46446, formatted as a date (28 February 2027). C0018 / M19 stayed 46419 (1 February 2027). The ledger search found all 19 investment interest postings on day 28.
