"""Preserve first freeze and add the concurrently received authority record."""
from pathlib import Path
import hashlib
import json
import zipfile
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parent
RUN=ROOT/'.local/batch3/b35c/integration-01'
def sha(data): return hashlib.sha256(data).hexdigest()
def main():
    original=RUN/'B3.5c-live-ready-engineering-handoff.zip'
    assert sha(original.read_bytes())=='c321247ab422b8d844f78401bb4b2a41901a2626a167a93c2c9781bbe3b2fb43'
    additions=[HERE/'CURRENT_HANDOFF.md', HERE/'ADDITIVE_JOURNAL_BINDING.json',Path(__file__),ROOT/'docs/TEST_BUDGET_ACCOUNTING_AUTHORIZATION.md']
    receipt={'scope':'current_owner_approval_addendum_no_product_change', 'original_archive_sha256':sha(original.read_bytes()),
             'files':{str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in additions},
             'approval':'scoped_test_accounting_correction_approved_conditions_not_yet_executed',
             'execution_owner':'t_e07c8870','paid_calls':0,'installed_mutations':0,'release':None}
    receipt_path=HERE/'FINAL_PACKAGE_RECEIPT.json'
    with receipt_path.open('x') as f: json.dump(receipt,f,sort_keys=True,indent=2); f.write('\n')
    final=RUN/'B3.5c-final-engineering-handoff.zip'
    with zipfile.ZipFile(original) as old, zipfile.ZipFile(final,'x',zipfile.ZIP_DEFLATED) as new:
        for name in old.namelist(): new.writestr(name,old.read(name))
        for p in additions+[receipt_path]: new.write(p,str(p.relative_to(ROOT)))
    with zipfile.ZipFile(final) as z,zipfile.ZipFile(original) as old:
        assert z.testzip() is None
        for name in old.namelist(): assert z.read(name)==old.read(name)
        for p,h in receipt['files'].items(): assert sha(z.read(p))==h
        count=len(z.namelist())
    print(json.dumps({'archive':str(final),'archive_sha256':sha(final.read_bytes()),'files':count,'bytes':final.stat().st_size,'final_receipt_sha256':sha(receipt_path.read_bytes())},sort_keys=True))
if __name__=='__main__': main()
