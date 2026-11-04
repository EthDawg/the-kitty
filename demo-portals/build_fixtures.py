"""Reproducible, wholly fictional portal documents. No network or original data mutation."""
import csv, hashlib, json, html
from decimal import Decimal
from pathlib import Path

HERE=Path(__file__).resolve().parent
F=HERE/'fixtures'
def write_csv(name,head,rows):
    p=F/name; p.parent.mkdir(parents=True,exist_ok=True)
    with p.open('w',newline='') as f:
        w=csv.writer(f); w.writerow(head); w.writerows(rows)
    return p

def cash(n): return f'{Decimal(n)/100:.2f}'

def build():
    manifest={'version':1,'household':'The Davies demo household','fictional':True,'period':'2027-02','as_of':'2027-02-28','currency':'AUD','core':[],'evidence':[],'sheet_columns':['Txn ID','Date','Account ID','Bank description','Merchant','Amount','Category ID','Person','Receipt held','Note']}
    specs=[
      ('harbour','Harbour Bank','Harbour a Dollar','ACC-EVD',200000,[
        ('01/02/2027','SALARY NORTHWIND LOGISTICS',400000,'SALARY','Northwind Logistics'),
        ('02/02/2027','TRANSFER TO EMERGENCY SAVER REF DEMO-X1',-60000,'TRANSFER','Emergency saver'),
        ('03/02/2027','SOUTHERN CARD PAYMENT REF DEMO-X2',-50000,'CC-PAY','Southern Card'),
        ('04/02/2027','GUMLEAF GROCER COBURG',-8640,'GROCERIES','Gumleaf Grocer'),
        ('05/02/2027','MYSTERY MERCHANT 047',-4995,None,'Mystery Merchant')]),
      ('southern','Southern Card','Southern X-press','ACC-CC',-30000,[
        ('03/02/2027','PAYMENT FROM EVERYDAY REF DEMO-X2',50000,'CC-PAY','Everyday account'),
        ('04/02/2027','GUMLEAF GROCER COBURG',-4595,'GROCERIES','Gumleaf Grocer'),
        ('06/02/2027','STREAMING PLATYPUS MONTHLY',-2899,'SUBS','Streaming Platypus'),
        ('08/02/2027','FLAT WHITE & FAIR DINKUM',-1850,'DINING','Flat White & Fair Dinkum'),
        ('08/02/2027','FLAT WHITE & FAIR DINKUM',-1850,'DINING','Flat White & Fair Dinkum'),
        ('09/02/2027','FLAT WHITE & FAIR DINKUM REFUND',1850,'DINING','Flat White & Fair Dinkum')]),
      ('wattle','Wattle Credit Union','Wattle You Save','ACC-SAV',1000000,[
        ('02/02/2027','TRANSFER FROM EVERYDAY REF DEMO-X1',60000,'TRANSFER','Everyday account'),
        ('28/02/2027','INTEREST CREDIT',525,'INTEREST','Wattle Credit Union')])]
    reviews={}
    for key,canonical,display,account,opening,rows in specs:
        balance=opening; exported=[]
        for d,desc,amount,category,merchant in rows:
            balance+=amount
            if key=='harbour': exported.append(['xxx-xxx xxxx4771',d,desc,cash(-amount) if amount<0 else '',cash(amount) if amount>0 else '',cash(balance),'',''])
            elif key=='southern': exported.append([d,desc,'JORDAN DAVIES','-41007',cash(-amount)])
            else: exported.append([d,desc,cash(amount) if amount>0 else '',cash(amount) if amount<0 else '',cash(balance)])
            if category: reviews[desc]={'category_id':category,'merchant':merchant,'person':'Joint','basis':'Synthetic fixture author decision; not a learned rule'}
        heads={'harbour':['Bank Account','Date','Narrative','Debit Amount','Credit Amount','Balance','Categories','Serial'],'southern':['Date','Description','Card Member','Account #','Amount'],'wattle':['Date','Description','Credit','Debit','Balance']}
        rel=f'core/{key}-2027-02.csv'; p=write_csv(rel,heads[key],exported)
        manifest['core'].append({'id':key,'canonical_provider':canonical,'display_brand':display,'account_id':account,'label':{'harbour':'Everyday account','southern':'Credit card','wattle':'Emergency saver'}[key],'file':rel,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'rows':len(rows),'opening_minor':opening,'closing_minor':balance,'scope':'core-adapter-tested','format_note':{'harbour':'Separate debit and credit; running balance','southern':'Charges positive; payments and refunds negative','wattle':'Negative debit column; running balance'}[key]})
    for meta in manifest['core']:
        spec_rows=next(s[-1] for s in specs if s[0]==meta['id'])
        meta['preview']=[{'date':d,'description':desc,'amount_minor':amount} for d,desc,amount,_,_ in spec_rows]
        statement='core/'+meta['id']+'-statement-2027-02.html'
        body=''.join('<tr><td>'+html.escape(d)+'</td><td>'+html.escape(desc)+'</td><td class="money">'+cash(amt)+'</td></tr>' for d,desc,amt,_,_ in spec_rows)
        page='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+meta['display_brand']+' — DEMO statement</title><style>body{font:16px/1.6 system-ui;max-width:880px;margin:40px auto;padding:24px;color:#182d2b}h1{color:#174e4a}aside{padding:16px;background:#f7eadb;border:1px solid #d1b59a}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{padding:12px 8px;border-bottom:1px solid #dce9df;text-align:left}.money{text-align:right;font-variant-numeric:tabular-nums}footer{margin-top:32px;font-size:13px} @media print{body{margin:0}}</style><aside><b>FICTIONAL DEMO DOCUMENT</b> · No real account. Do not use for financial, identity or tax purposes.</aside><h1>'+meta['display_brand']+'</h1><h2>Monthly '+meta['label'].lower()+' statement</h2><p>Jordan &amp; Mia Davies · '+meta['account_id']+' · February 2027 · AUD</p><p>Opening balance: $'+cash(meta['opening_minor'])+'<br>Closing balance: $'+cash(meta['closing_minor'])+'</p><table><thead><tr><th>Date</th><th>Description</th><th class="money">Signed amount AUD</th></tr></thead><tbody>'+body+'</tbody></table><footer>Canonical fixture provider: '+meta['canonical_provider']+'. Negative amounts reduce the account balance. Card liability balances are negative. This human-readable statement is a demo companion; import the CSV export. Generated deterministically by demo-portals/build_fixtures.py.</footer></html>'
        (F/statement).write_text(page)
        meta['statement_file']=statement
        meta['statement_sha256']=hashlib.sha256(page.encode()).hexdigest()
    templates=[
      ('payslip','Pay, mate','Payslip','Payroll evidence','payslip.csv',['Document ID','Pay date','Person','Employer','Gross AUD','PAYG AUD','Super AUD','Net AUD','Period start','Period end'],[['DEMO-PAY-001','2027-02-01','Jordan Davies','Northwind Logistics','5250.00','1250.00','630.00','4000.00','2027-01-18','2027-01-31']],'Net pay matches the core salary row; no payroll or tax calculation is performed.'),
      ('property','Proper Tea','Property manager','Property evidence','property.csv',['Property ID','Use','Address label','Owner share percent','Statement period','Gross rent AUD','Management fees AUD','Interest AUD','Repairs AUD','Net rental cash AUD','Evidence status'],[
        ['PROP-HOME','PPOR','Demo family home','50','2027-02','0.00','0.00','0.00','0.00','0.00','Example only'],
        ['PROP-RENT-A','Investment','Demo rental A','50','2027-02','2400.00','160.00','2600.00','0.00','-360.00','Cash shortfall; tax result not determined'],
        ['PROP-RENT-B','Investment','Demo rental B','50','2027-02','2800.00','180.00','1500.00','100.00','1020.00','Cash surplus; tax result not determined']],'Includes a PPOR and two rentals. Cash surplus/shortfall does not establish a taxable profit, loss or negative gearing.'),
      ('insurance','She’ll Be Covered','Insurance','Policy evidence','insurance.csv',['Policy ID','Type','Insured item','Provider','Renewal date','Annual premium AUD','Excess AUD','Evidence status'],[
        ['POL-HEALTH','Health','Davies family','She’ll Be Covered','2027-04-01','4800.00','750.00','Fictional summary; no cover advice'],
        ['POL-CAR','Car','Demo hatchback','She’ll Be Covered','2027-05-01','980.00','800.00','Fictional summary; no cover advice'],
        ['POL-HOME','Home','PROP-HOME','She’ll Be Covered','2027-07-01','1850.00','1000.00','Fictional summary; no cover advice']],'Three renewals and evidence links; no recommendation to buy, cancel or change cover.'),
      ('equity','Share Dinkum','Shares & employee equity','Holdings evidence','equity.csv',['Event ID','Person','Scheme','Instrument','Event','Date','Units','Price currency','Price per unit','FX AUD per unit','Document reference'],[
        ['EQ-RSU-1','Jordan Davies','RSU','DEMO','Vest','2027-02-15','10.000000','USD','100.00','1.55','DEMO-VEST-001'],
        ['EQ-ESPP-1','Jordan Davies','ESPP','DEMO','Purchase','2027-02-15','5.000000','USD','85.00','1.55','DEMO-ESPP-001'],
        ['EQ-OWN-1','Mia Davies','Personal','DEMOETF','Purchase','2027-02-15','20.000000','AUD','50.00','1.00','DEMO-CONTRACT-001']],'Separate vest, purchase and disposal evidence. No ESS discount, cost-base or CGT calculation.'),
      ('crypto','Coinaroo','Crypto','Wallet evidence','crypto.csv',['Event ID','Date UTC','Event','Asset','Quantity','AUD value','Fee AUD','From wallet','To wallet','Chain reference'],[
        ['CR-1','2027-02-03T01:00:00Z','Buy','DEMOCOIN','0.01234567','1000.00','5.00','AUD account','Demo exchange','DEMO-TX-001'],
        ['CR-2','2027-02-04T01:00:00Z','Own-wallet transfer','DEMOCOIN','0.01000000','810.00','2.00','Demo exchange','Demo cold wallet','DEMO-TX-002']],'Synthetic token only. Preserve quantity, AUD valuation and transfer evidence; no tax classification.'),
      ('super','Super, Naturally','Superannuation','Fund evidence','super.csv',['Fund ID','Mode','Structure','Member','Statement date','Balance AUD','Contributions AUD','Evidence status'],[
        ['SUPER-RETAIL','Accumulation','Retail','Jordan Davies','2027-02-28','210000.00','630.00','Fictional fund statement'],
        ['SUPER-SMSF','Accumulation','SMSF','Mia Davies','2027-02-28','165000.00','0.00','Fictional member statement; not a fund audit']],'Retail and SMSF entities remain separate; no compliance, cap or tax calculations.'),
      ('assets','Stuff & Nonsense','Assets & replacement plans','Asset evidence','assets.csv',['Asset ID','Item','Acquired','Purchase AUD','Replacement target AUD','Target date','Valuation date','Estimated value AUD','Plan status'],[
        ['ASSET-CAR','Demo hatchback','2022-07-01','28000.00','35000.00','2030-07-01','2027-02-28','17000.00','Optional plan'],
        ['ASSET-LAPTOP','Demo laptop','2024-07-01','2400.00','2600.00','2028-07-01','2027-02-28','900.00','Optional plan']],'Replacement targets are household choices. Market value, cost and replacement price are separate fields.'),
      ('tax','Deductions & Dragons','Tax evidence','Readiness evidence','tax-readiness.csv',['Evidence ID','Income year end','Domain','Document','State','Owner','Reason'],[
        ['TAX-PAY','2027-06-30','Employment','Final income statement','Missing','Jordan Davies','Income year is not complete'],
        ['TAX-RENT','2027-06-30','Rental A','Annual agent statement','Missing','Joint','Monthly sample is not annual evidence'],
        ['TAX-ESS','2027-06-30','Employee equity','ESS statement','Missing','Jordan Davies','Vest notice alone is insufficient']],'A completeness checklist only; never claim ready to lodge from these sample files.')]
    for ident,brand,label,kind,filename,head,rows,note in templates:
        rel='evidence/'+filename;p=write_csv(rel,head,rows)
        manifest['evidence'].append({'id':ident,'display_brand':brand,'label':label,'kind':kind,'file':rel,'rows':len(rows),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'scope':'experimental-evidence-only','note':note})
    (F/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (F/'known-decisions.json').write_text(json.dumps(reviews,indent=2)+'\n')
    (F/'review-decisions.json').write_text(json.dumps({'MYSTERY MERCHANT 047':{'category_id':'SHOPPING','merchant':'Mystery Merchant','person':'Joint','basis':'Explicit synthetic reviewer decision for this fixture only'}},indent=2)+'\n')
    (HERE/'fixture-data.js').write_text('/* Generated by build_fixtures.py. Synthetic data only. */\nwindow.KITTY_DEMO_FIXTURES = '+json.dumps(manifest,indent=2)+';\n')
    print('Built 3 core source CSVs and 8 optional evidence CSVs.')
if __name__=='__main__': build()
