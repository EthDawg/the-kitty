"""Bounded local demo staging. Never writes a provider or the repository's source data.

Calls the application's existing bank adapters, then independently validates amount/date
semantics with Decimal. Canonical amounts are integer minor units; float adapter values
are comparison-only. File hashes stop repeat ingestion; repeated rows within a source
remain distinct. Different files with overlapping rows are held for review, not merged.
"""
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
import csv, hashlib, importlib.util, json

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('kitty_existing_adapters',HERE.parent/'period-close'/'adapters.py')
A=importlib.util.module_from_spec(spec);spec.loader.exec_module(A)
MANIFEST=json.loads((HERE/'fixtures'/'manifest.json').read_text())
CATEGORIES={c['category_id'] for c in json.loads((HERE.parent/'data'/'snapshot.json').read_text())['category_list']}

class ReviewRequired(ValueError): pass

def minor(value):
    s=str(value).strip()
    if not s: return 0
    try: n=Decimal(s)
    except InvalidOperation as e: raise ValueError('Invalid money value') from e
    if not n.is_finite() or n*100 != (n*100).to_integral_value():
        raise ValueError('Money must be finite with at most two decimal places')
    if abs(n)>Decimal('999999999999.99'): raise ValueError('Amount outside demo range')
    return int(n*100)

def decimal_string(value): return f'{Decimal(value)/100:.2f}'
def fingerprint(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def key(r): return (r['date'],r['account_id'],r['bank_description'],r['amount_minor'])

def load_file(path,meta):
    p=Path(path)
    if fingerprint(p)!=meta['sha256']: raise ValueError(f'{p.name}: source hash differs from the published fixture')
    try:
        provider,reader=A.sniff(p)
    except (SystemExit, AssertionError, StopIteration) as error:
        raise ValueError('Unrecognised or empty source header') from error
    if provider!=meta['canonical_provider']: raise ValueError('Account/provider mismatch')
    adapted=reader(p,meta['account_id'])
    with p.open(newline='') as f: raw=list(csv.DictReader(f))
    if len(raw)!=meta['rows'] or len(adapted)!=len(raw): raise ValueError('Unexpected row count')
    result=[]; running=meta['opening_minor']
    for i,(source,normal) in enumerate(zip(raw,adapted),2):
        if meta['id']=='harbour':
            debit,credit=minor(source['Debit Amount']),minor(source['Credit Amount'])
            if debit<0 or credit<0 or (debit and credit): raise ValueError('Ambiguous debit/credit')
            amount=credit-debit;desc=source['Narrative']
        elif meta['id']=='southern': amount=-minor(source['Amount']);desc=source['Description']
        else:
            debit,credit=minor(source['Debit']),minor(source['Credit'])
            if debit>0 or credit<0 or (debit and credit): raise ValueError('Ambiguous debit/credit')
            amount=credit+debit;desc=source['Description']
        d=date.fromisoformat(normal[0]).isoformat()
        if not d.startswith(MANIFEST['period']+'-'): raise ValueError('Date outside fixture period')
        if not desc.strip(): raise ValueError('Missing bank description')
        if (normal[1],normal[2],minor(str(normal[3])))!=(meta['account_id'],desc.strip(),amount):
            raise ValueError('Existing adapter and independent Decimal parser disagree')
        running+=amount
        if 'Balance' in source and minor(source['Balance'])!=running: raise ValueError('Running balance mismatch')
        result.append({'source_id':meta['sha256'],'source_file':meta['file'],'source_row':i,'date':d,'account_id':meta['account_id'],'bank_description':desc.strip(),'amount_minor':amount,'currency':'AUD','status':'posted'})
    if running!=meta['closing_minor']: raise ValueError('Closing balance mismatch')
    return result

def stage(files,state=None,decisions=None):
    state=state or {'sources':[],'rows':[]}; decisions=decisions or {}
    staged=[];skipped=[];seen=set(state['sources']);existing_keys={key(r) for r in state['rows']}
    batch_keys=set()
    for path,meta in files:
        digest=fingerprint(path)
        if digest in seen: skipped.append({'file':str(path),'reason':'Exact source already seen'});continue
        rows=load_file(path,meta)
        # Within one file repeated charges remain two distinct source rows. Across files
        # there is no safe identity evidence, so overlap cannot silently append.
        overlap={key(r) for r in rows} & (existing_keys|batch_keys)
        if overlap: raise ReviewRequired('Different source overlaps existing transactions; review the source identity')
        batch_keys.update(key(r) for r in rows); seen.add(digest)
        for r in rows:
            decision=decisions.get(r['bank_description'])
            if decision:
                if decision.get('category_id') not in CATEGORIES: raise ValueError('Unknown category ID')
                if decision.get('person') not in {'Jordan','Mia','Joint'}: raise ValueError('Unknown person')
                if not decision.get('basis') or not decision.get('merchant'): raise ValueError('Decision needs evidence and merchant')
            r.update({'category_id':decision['category_id'] if decision else 'UNCAT','merchant':decision['merchant'] if decision else r['bank_description'],'person':decision['person'] if decision else 'Joint','review_state':'confirmed' if decision else 'needs_review','review_basis':decision.get('basis','') if decision else ''})
            staged.append(r)
    return {'rows':staged,'skipped':skipped,'sources':sorted(seen),'unresolved':sum(r['review_state']!='confirmed' for r in staged)}

def commit(staged,state=None):
    if staged['unresolved'] or any(r['review_state']!='confirmed' for r in staged['rows']): raise ReviewRequired('Resolve every review before local append')
    prior=(state or {'rows':[]})['rows']
    rows=[dict(r) for r in prior]
    for row in staged['rows']:
        r=dict(row);r['txn_id']=f'DEMO-T{len(rows)+1:04d}';rows.append(r)
    return {'sources':staged['sources'],'rows':rows}

def sheet_rows(rows):
    return [[r['txn_id'],r['date'],r['account_id'],r['bank_description'],r['merchant'],decimal_string(r['amount_minor']),r['category_id'],r['person'],'',f"Demo; source {r['source_file']} row {r['source_row']}; {r['review_basis']}"] for r in rows]

def safe_csv_cell(v):
    # CSV opened directly in spreadsheet software can execute leading formula text.
    # Preserve raw data in JSON. Add an apostrophe only to exported text cells.
    if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@')): return "'"+v
    return v

def export_csv(path,rows):
    with Path(path).open('w',newline='') as f:
        w=csv.writer(f);w.writerow(MANIFEST['sheet_columns'])
        for row in sheet_rows(rows):
            # Amount is a strictly validated numeric string, not a free text field.
            w.writerow([v if i==5 else safe_csv_cell(v) for i,v in enumerate(row)])

def flows(rows):
    result={'income_minor':0,'expense_minor':0,'transfer_minor':0}
    for r in rows:
        if r['category_id'] in {'TRANSFER','CC-PAY'}: result['transfer_minor']+=r['amount_minor']
        elif r['category_id'] in {'SALARY','INTEREST'}: result['income_minor']+=r['amount_minor']
        else: result['expense_minor']-=r['amount_minor']
    return result
