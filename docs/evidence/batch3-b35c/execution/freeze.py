"""Bind truthful partial execution evidence; never calls a provider."""
from pathlib import Path
from hashlib import sha256
from decimal import Decimal as D
import json
import subprocess
import xml.etree.ElementTree as ET

root = Path.cwd()
local = root / '.local/batch3/b35c/execution'
out = root / 'docs/evidence/batch3-b35c/execution'
r = json.loads((local/'ledger/current-reconciliation.json').read_bytes())
v = json.loads((local/'ledger/verification.json').read_bytes())
assert v['passed'] and v['tests_run'] == 9
old = json.loads((root/'.local/batch3/b35c/fresh-pool/ledger/current-reconciliation.json').read_bytes())
assert all(old[k] == r[k] for k in ('union_totals','union_unknowns','deduplication','carry_source_checks'))
rt = root/'docs/evidence/batch3-b35c/runtime/MANIFEST.json'
manifest = json.loads(rt.read_bytes())
for name, digest in manifest['files'].items():
    assert sha256((root/name).read_bytes()).hexdigest() == digest, name
proof = json.loads((local/'public-tools-proof.json').read_bytes())
assert proof['provider_attempts'] == proof['duplicate_snapshot_count'] == 0
assert sha256((local/'public-source-download.txt').read_bytes()).hexdigest() == proof['download_sha256']
attempts = []
for n in range(1,5):
    # Only local pytest-produced JUnit; no uploaded or network XML is parsed.
    x = ET.parse(local/f'public-tools-{n:02}.xml').getroot().find('testsuite')
    assert x is not None
    attempts.append(dict(attempt=n, tests=int(x.attrib['tests']),failures=int(x.attrib['failures']),errors=int(x.attrib['errors'])))
assert [a['failures'] for a in attempts] == [1,1,1,0]
assert all(a['tests']==1 and a['errors']==0 for a in attempts)
files = sorted(p for p in local.rglob('*') if p.is_file() and p.suffix in ('.py','.json','.log','.xml','.txt') and '__pycache__' not in p.parts)
files += [out/'REPORT.md', out/'freeze.py']
result = dict(status='BLOCKED_paid_admission_full_AB_NOT_complete',
    base_head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
    runtime_manifest_sha256=sha256(rt.read_bytes()).hexdigest(),runtime_files_verified=len(manifest['files']),
    new_product_calls=0,new_allocation_usd='0',live_AB_episodes=0,full_AB_episodes_owed=72,full_AB_trajectories_owed=12,
    snapshot_at=r['at'],snapshot_ended_at=r['ended_at'],stores=r['store_count'],readonly_checks=v['tests_run'],
    funding={'ceiling_usd':'100','retained_allocations_usd':r['allocation']['retained_allocation_usd'],
        'global_unallocated_usd':r['allocation']['global_unallocated_usd'],
        'known_usage_estimate_usd':r['union_totals']['known_usage_calculated_usd'],
        'generation_reservations_usd':r['union_totals']['reserved_cost_usd'],
        'unknown_usage_attempts':r['union_totals']['unknown_usage_steps'],
        'unmatched_counts':r['union_totals']['unmatched_count_steps'],
        'settled_bill':None,'categories_overlap_not_additive':True,
        'normal_eight_choice_model_only_reservation_usd':str((D(50000)*D('2.5')+D(8192)*D(10))/D(1000000)*8)},
    diagnostics=attempts,public_download_bytes=proof['download_bytes'],public_download_sha256=proof['download_sha256'],
    proof_level=proof['proof_level'],
    implementation_changes=False,installed_maintenance=False,deployed=False,published=False,
    development_model='gpt-6-astra/openai-codex',development_tool_billing='outside_product_ledger_unreconciled',
    files={str(p.relative_to(root)):sha256(p.read_bytes()).hexdigest() for p in files})
(out/'RECEIPT.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='files'},indent=2))
print('receipt_sha256='+sha256((out/'RECEIPT.json').read_bytes()).hexdigest())
