"""Additive non-self-referential checkpoint binding. Never rewrites run101."""
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/evidence/batch3-b35c/execution'
PREP=ROOT/'.local/batch3/b35c/preparation'
def digest(p):return sha256(Path(p).read_bytes()).hexdigest()
def save(path,data):
    with Path(path).open('x') as f:json.dump(data,f,sort_keys=True,indent=2);f.write('\n')

old=OUT/'RECEIPT.json'
assert digest(old)=='05ced2c9fc9c7ca951fdbe1dba8e7fec108a6c27e1ef5c6623bc15534334b550'
r=json.loads(old.read_text());bad={n:{'expected':d,'observed':digest(ROOT/n)} for n,d in r['files'].items() if digest(ROOT/n)!=d}
assert list(bad)==['.local/batch3/b35c/execution/freeze.log']
assert len(r['files'])==28
assert bad[next(iter(bad))]['expected']==sha256(b'').hexdigest()
rt=ROOT/'docs/evidence/batch3-b35c/runtime/MANIFEST.json'
manifest=json.loads(rt.read_text())
assert len(manifest['files'])==278
assert all(digest(ROOT/n)==d for n,d in manifest['files'].items())
public=json.loads((PREP/'evaluator/MANIFEST.json').read_text())
# Explicit current-iteration files; excludes mutable stdout and this receipt.
files=[ROOT/'evaluation'/n for n in ['public_ab_inputs.py','network_harness.py','network_worker.py','funding_disposition.py','test_network_preparation.py','bind_preparation.py']]
files += [OUT/n for n in ['FUNDING_DISPOSITION_ADDENDUM.md','PREPARATION_CHECKPOINT.md']]
files += [p for p in (PREP/'network-13').rglob('*') if p.is_file() and '/product/' not in str(p) and '/state/' not in str(p)]
files += [PREP/'review-fix-regressions-02.log',PREP/'funding-disposition.json',PREP/'evaluator/MANIFEST.json',PREP/'evaluator/schedule.json',PREP/'review/REVIEW.md',PREP/'review/REVIEW.json']
value={'status':'zero_provider_checkpoint_NOT_full_AB','original_receipt_sha256':digest(old),
 'original_log_current_sha256':digest(ROOT/'.local/batch3/b35c/execution/freeze.log'),
 'original_receipt_matching_files':27,'original_mismatch':bad,
 'explanation':'freeze.py hashed redirected stdout before its final JSON was printed; receipt and log preserved. Not source drift.',
 'runtime_manifest_sha256':digest(rt),'runtime_hashes_verified':278,
 'base_head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
 'new_paid_product_calls':0,'new_allocation_usd':'0','new_installed_mutations':0,'ledger_recollections':0,
 'original_trajectories':12,'original_episodes':72,'live_episodes':0,
 'independent_review':'initial findings retained; parent fix verification, not new independent PASS',
 'final_network_readiness':'network-13 PASS B1/M1 scripted actual workers/public HTTPS/restricted SQL',
 'regression_tests_passed':4,'full_live_harness':'not established; funded transport and longitudinal orchestration remain',
 'ownership':'same execution card t_e07c8870; root t_82b30c02 publication/acceptance; no successor release',
 'files':{str(p.relative_to(ROOT)):digest(p) for p in sorted(files)}}
save(OUT/'ADDITIVE_BINDING.json',value)
# Human-safe checkpoint, with no oracle bodies, raw inputs, DSNs, worker state or real public text.
archive=PREP/'B3.5c-zero-provider-checkpoint.zip'
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
    for p in [OUT/'PREPARATION_CHECKPOINT.md',OUT/'FUNDING_DISPOSITION_ADDENDUM.md',OUT/'ADDITIVE_BINDING.json',PREP/'funding-disposition.json',PREP/'review-fix-regressions-02.log']:
        z.write(p,p.name)
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
print(json.dumps({'receipt':str(OUT/'ADDITIVE_BINDING.json'),'sha256':digest(OUT/'ADDITIVE_BINDING.json'),'bound_files':len(value['files']),'archive':str(archive),'archive_sha256':digest(archive)},indent=2))
