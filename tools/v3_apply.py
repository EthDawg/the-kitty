"""Reference implementation of CHANGES.md version 3 as one Sheets batchUpdate request list.
Usage: python3 tools/v3_apply.py OUT.json [--data] [--checks-row N] [--version-row N]
  --data         also write the Davies rows from data/v3/*.csv (and data/groceries/*.csv if present)
  --checks-row   1-based row for the first new check: two below "Checks needing review" (default 27, the template's)
  --version-row  1-based row of sheet_version on the Kitty tab (default 14)
The new tabs get sheetIds 3001-3005. Typed cells keep codes and text exactly; dates are serials formatted as dates."""
import csv, datetime, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]; out = args[0]
DATA = "--data" in args
def opt(name, d):
    return int(args[args.index(name) + 1]) if name in args else d
CHECKS_ROW, VERSION_ROW = opt("--checks-row", 27), opt("--version-row", 14)
ASOF = "Settings!$B$6"

def serial(iso):
    return (datetime.date.fromisoformat(iso[:10]) - datetime.date(1899, 12, 30)).days
def cell(v, kind=None):
    if v is None or v == "": return {}
    if kind == "date": return {"userEnteredValue": {"numberValue": serial(v)}, "userEnteredFormat": {"numberFormat": {"type": "DATE", "pattern": "d mmm yyyy"}}}
    if kind == "money": return {"userEnteredValue": {"numberValue": float(v)}, "userEnteredFormat": {"numberFormat": {"type": "CURRENCY", "pattern": "$#,##0.00"}}}
    if kind == "num": return {"userEnteredValue": {"numberValue": float(v)}}
    if kind == "bool": return {"userEnteredValue": {"boolValue": str(v).lower() in ("true", "yes", "1")}}
    if isinstance(v, str) and v.startswith("="): return {"userEnteredValue": {"formulaValue": v}}
    return {"userEnteredValue": {"stringValue": str(v)}}

TABS = [
  ("Receipts", 3001, ["Receipt ID","Date","Time","Merchant","Merchant ID","Store","Channel","Person","Items","Total","GST","Savings","Paid with","Entry ID","Account ID","Source","Source kind","Read by","Check","Note"],
   {"S": "=MAP(A2:A,J2:J,I2:I,LAMBDA(id,tot,items,IF(id=\"\",\"\",LET(sum,SUMIFS('Receipt Lines'!K:K,'Receipt Lines'!A:A,id),n,COUNTIFS('Receipt Lines'!A:A,id,'Receipt Lines'!G:G,\"Item\"),IF(ABS(sum-tot)>0.05,\"Lines \"&TEXT(sum,\"0.00\")&\" vs \"&TEXT(tot,\"0.00\"),IF(AND(N(items)>3,n<=1),\"One line for \"&items&\" items\",\"OK\"))))))"},
   {"G": ["In-store","Online delivery","Online pickup","Online"], "M": ["Card","Gift card","Cash","Mixed","Points"], "Q": ["Photo","PDF","Email","Export","Screenshot"]},
   {"B": "date", "I": "num", "J": "money", "K": "money", "L": "money"}),
  ("Receipt Lines", 3002, ["Receipt ID","Line","Printed text","Product","Brand","Group","Kind","Qty","Unit","Unit price","Amount","GST","Pack size","Price per kg or L","Retailer code","Note"],
   {"N": "=MAP(A2:A,K2:K,H2:H,I2:I,M2:M,LAMBDA(id,a,q,u,p,IF(OR(id=\"\",a=\"\"),\"\",IF(OR(u=\"kg\",u=\"L\"),IFERROR(ROUND(a/q,2),\"\"),IFERROR(LET(n,VALUE(REGEXEXTRACT(p,\"[0-9.]+\")),un,LOWER(REGEXEXTRACT(p,\"[A-Za-z]+$\")),f,IFS(un=\"g\",n/1000,un=\"kg\",n,un=\"ml\",n/1000,un=\"l\",n,TRUE,NA()),ROUND(a/(q*f),2)),\"\")))))"},
   {"F": ["Fruit & veg","Meat & seafood","Dairy & eggs","Bakery","Pantry","Snacks & sweets","Drinks","Frozen","Prepared meals","Baby","Health & beauty","Household","Alcohol","Pet","Other"], "G": ["Item","Discount","Fee","Deposit"], "I": ["each","kg","L"], "L": ["Taxable","GST-free"]},
   {"B": "num", "H": "num", "J": "money", "K": "money"}),
  ("Decision Options", 3003, ["Decision ID","Question","Ref","Option","Upfront","Per month","Months","Extra","Total","Recommended","Decide by","Status","Source","Note"],
   {"I": "=MAP(A2:A,E2:E,F2:F,G2:G,H2:H,LAMBDA(id,e,f,g,h,IF(id=\"\",\"\",N(e)+N(f)*N(g)+N(h))))"},
   {"L": ["Open","Decided","Dropped"]},
   {"E": "money", "F": "money", "G": "num", "H": "money", "J": "bool", "K": "date"}),
  ("Goal Levers", 3004, ["Lever ID","Goal","Lever","On","Per month","One-off","Date if on","Date if off","Months moved","Source"],
   {"G": "=MAP(A2:A,B2:B,D2:D,E2:E,F2:F,LAMBDA(id,goal,on,pm,oo,IF(id=\"\",\"\",LET(asof,INDEX(Settings!B:B,MATCH(\"As-of date\",Settings!A:A,0)),r,MATCH(goal,Goals!A:A,0),need,INDEX(Goals!B:B,r)-INDEX(Goals!E:E,r),base,N(INDEX(Goals!I:I,r)),opm,SUMIFS(E:E,B:B,goal,D:D,TRUE)-IF(on,N(pm),0),ooo,SUMIFS(F:F,B:B,goal,D:D,TRUE)-IF(on,N(oo),0),rest,need-ooo-N(oo),rate,base+opm+N(pm),IF(rest<=0,EOMONTH(asof,-1)+1,IF(rate<=0,\"Never\",EOMONTH(asof,CEILING(rest/rate,1)-1)+1))))))",
    "H": "=MAP(A2:A,B2:B,D2:D,E2:E,F2:F,LAMBDA(id,goal,on,pm,oo,IF(id=\"\",\"\",LET(asof,INDEX(Settings!B:B,MATCH(\"As-of date\",Settings!A:A,0)),r,MATCH(goal,Goals!A:A,0),need,INDEX(Goals!B:B,r)-INDEX(Goals!E:E,r),base,N(INDEX(Goals!I:I,r)),opm,SUMIFS(E:E,B:B,goal,D:D,TRUE)-IF(on,N(pm),0),ooo,SUMIFS(F:F,B:B,goal,D:D,TRUE)-IF(on,N(oo),0),rest,need-ooo,rate,base+opm,IF(rest<=0,EOMONTH(asof,-1)+1,IF(rate<=0,\"Never\",EOMONTH(asof,CEILING(rest/rate,1)-1)+1))))))",
    "I": "=MAP(A2:A,G2:G,H2:H,LAMBDA(id,g,h,IF(id=\"\",\"\",IF(OR(g=\"Never\",h=\"Never\"),\"\",(YEAR(h)-YEAR(g))*12+MONTH(h)-MONTH(g)))))"},
   {}, {"D": "bool", "E": "money", "F": "money"}),
  ("Tax Returns", 3005, ["Person","FY","Status","Taxable income","Tax on income","Medicare","Offsets","Withheld","Result","Lodged","Notice","Pack","Source","Note"],
   {"I": "=MAP(A2:A,E2:E,F2:F,G2:G,H2:H,LAMBDA(p,e,f,g,h,IF(p=\"\",\"\",ROUND(N(h)-(N(e)+N(f)-N(g)),2))))"},
   {"C": ["Estimate","Lodged","Assessed","Amended"]},
   {"D": "money", "E": "money", "F": "money", "G": "money", "H": "money", "J": "date", "K": "date"}),
]
col = lambda L: (ord(L) - 65) if len(L) == 1 else (ord(L[0]) - 64) * 26 + ord(L[1]) - 65
def rows_from(name):
    files = {"Decision Options": "data/v3/decision-options.csv", "Goal Levers": "data/v3/goal-levers.csv", "Tax Returns": "data/v3/tax-returns.csv",
             "Receipts": "data/groceries/receipts.csv", "Receipt Lines": "data/groceries/receipt-lines.csv"}
    p = os.path.join(ROOT, files[name])
    return list(csv.DictReader(open(p))) if os.path.exists(p) else []

req = []
for title, sid, headers, formulas, lists, kinds in TABS:
    req.append({"addSheet": {"properties": {"title": title, "sheetId": sid, "gridProperties": {"rowCount": 2000, "columnCount": len(headers), "frozenRowCount": 1}}}})
    req.append({"updateCells": {"start": {"sheetId": sid, "rowIndex": 0, "columnIndex": 0}, "fields": "userEnteredValue,userEnteredFormat.textFormat.bold",
        "rows": [{"values": [{"userEnteredValue": {"stringValue": h}, "userEnteredFormat": {"textFormat": {"bold": True}}} for h in headers]}]}})
    data = rows_from(title) if DATA else []
    if data:
        out_rows = []
        for r in data:
            vals = []
            for i, h in enumerate(headers):
                L = chr(65 + i)
                if L in formulas: vals.append({}); continue
                vals.append(cell(r.get(h, ""), kinds.get(L)))
            out_rows.append({"values": vals})
        req.append({"updateCells": {"start": {"sheetId": sid, "rowIndex": 1, "columnIndex": 0}, "fields": "userEnteredValue,userEnteredFormat.numberFormat", "rows": out_rows}})
    for L, f in formulas.items():
        req.append({"updateCells": {"start": {"sheetId": sid, "rowIndex": 1, "columnIndex": col(L)}, "fields": "userEnteredValue", "rows": [{"values": [{"userEnteredValue": {"formulaValue": f}}]}]}})
    for L, opts in lists.items():
        req.append({"setDataValidation": {"range": {"sheetId": sid, "startRowIndex": 1, "endRowIndex": 2000, "startColumnIndex": col(L), "endColumnIndex": col(L) + 1},
            "rule": {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": o} for o in opts]}, "strict": False, "showCustomUi": True}}})
    for L, k in kinds.items():
        if k == "bool":
            req.append({"setDataValidation": {"range": {"sheetId": sid, "startRowIndex": 1, "endRowIndex": 2000, "startColumnIndex": col(L), "endColumnIndex": col(L) + 1}, "rule": {"condition": {"type": "BOOLEAN"}}}})
        if k in ("date", "money"):
            fmt = {"type": "DATE", "pattern": "d mmm yyyy"} if k == "date" else {"type": "CURRENCY", "pattern": "$#,##0.00"}
            req.append({"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 1, "endRowIndex": 2000, "startColumnIndex": col(L), "endColumnIndex": col(L) + 1}, "cell": {"userEnteredFormat": {"numberFormat": fmt}}, "fields": "userEnteredFormat.numberFormat"}})
    for L in formulas:
        if title == "Goal Levers" and L in "GH":
            req.append({"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 1, "endRowIndex": 2000, "startColumnIndex": col(L), "endColumnIndex": col(L) + 1}, "cell": {"userEnteredFormat": {"numberFormat": {"type": "DATE", "pattern": "mmm yyyy"}}}, "fields": "userEnteredFormat.numberFormat"}})
        if title in ("Decision Options", "Tax Returns"):
            req.append({"repeatCell": {"range": {"sheetId": sid, "startRowIndex": 1, "endRowIndex": 2000, "startColumnIndex": col(L), "endColumnIndex": col(L) + 1}, "cell": {"userEnteredFormat": {"numberFormat": {"type": "CURRENCY", "pattern": "$#,##0.00"}}}, "fields": "userEnteredFormat.numberFormat"}})

# Compliance Checks: six rows inserted before the first blank row after the checks (sheetId 7 in the template)
CC = 7; r0 = CHECKS_ROW - 1
def crow(n, name, typ, items, amount, status, why, where):
    R = CHECKS_ROW + n
    st = status.replace("{C}", f"C{R}")
    return {"values": [cell(name), cell(typ), cell(items), cell(amount) if amount else {}, cell(st), cell(why), cell(where)]}
checks = [
  ("Receipts that don't add up", "Data", "=COUNTIF(Receipts!S:S,\"Lines*\")+COUNTIF(Receipts!S:S,\"One line*\")", "", "=IF({C}>0,\"Review\",\"OK\")", "A receipt whose lines don't sum to its total was read wrongly or is missing a line.", "Receipts, Check"),
  ("Card receipts with no bank row", "Data", "=COUNTIFS(Receipts!M:M,\"Card\",Receipts!N:N,\"\",Receipts!A:A,\"<>\")", "=SUMIFS(Receipts!J:J,Receipts!M:M,\"Card\",Receipts!N:N,\"\")", "=IF({C}>0,\"Review\",\"OK\")", "A card payment should appear on a bank line; if it doesn't, the bank import is missing or the receipt is a duplicate.", "Receipts, Entry ID"),
  ("Spending outside the bank, latest month", "Data", "=COUNTIFS(Receipts!M:M,\"<>Card\",Receipts!M:M,\"<>\",Receipts!B:B,\">\"&EOMONTH(" + ASOF + ",-1),Receipts!B:B,\"<=\"&EOMONTH(" + ASOF + ",0))", "=SUMIFS(Receipts!J:J,Receipts!M:M,\"<>Card\",Receipts!M:M,\"<>\",Receipts!B:B,\">\"&EOMONTH(" + ASOF + ",-1),Receipts!B:B,\"<=\"&EOMONTH(" + ASOF + ",0))", "=IF({C}>0,\"Note\",\"OK\")", "Gift cards, cash and points are still spending. The bank never shows them, so they need a row on their own account.", "Receipts, Paid with"),
  ("Decisions with more than one pick", "Data", "=IFERROR(ROWS(UNIQUE(FILTER('Decision Options'!A2:A,'Decision Options'!J2:J=TRUE,COUNTIFS('Decision Options'!A2:A,'Decision Options'!A2:A,'Decision Options'!J2:J,TRUE)>1))),0)", "", "=IF({C}>0,\"Review\",\"OK\")", "One decision, one recommended option, or the page can't say which it would pick.", "Decision Options, Recommended"),
  ("Decisions past their decide-by date", "Data", "=IFERROR(ROWS(UNIQUE(FILTER('Decision Options'!A2:A,'Decision Options'!L2:L=\"Open\",'Decision Options'!K2:K<>\"\",'Decision Options'!K2:K<" + ASOF + "))),0)", "", "=IF({C}>0,\"Review\",\"OK\")", "A choice left open past its date usually costs money; decide it or move the date.", "Decision Options, Decide by"),
  ("Lodged years without a tax pack", "Tax", "=COUNTIFS('Tax Returns'!C:C,\"<>Estimate\",'Tax Returns'!A:A,\"<>\",'Tax Returns'!L:L,\"\")", "", "=IF({C}>0,\"Note\",\"OK\")", "Keep five years of records. A pack puts the return and every source in one folder.", "Tax Returns, Pack"),
]
req.append({"updateCells": {"start": {"sheetId": CC, "rowIndex": r0, "columnIndex": 0}, "fields": "userEnteredValue", "rows": [crow(i, *c) for i, c in enumerate(checks)]}})
# Kitty!sheet_version
req.append({"updateCells": {"start": {"sheetId": 20, "rowIndex": VERSION_ROW - 1, "columnIndex": 1}, "fields": "userEnteredValue", "rows": [{"values": [{"userEnteredValue": {"numberValue": 3}}]}]}})
json.dump({"requests": req}, open(out, "w"))
print(len(req), "requests;", sum(len(rows_from(t[0])) for t in TABS) if DATA else 0, "data rows")
