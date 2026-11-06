"""Read-only offline hash check; no provider, DB, scoring, or execution mode.
Run from the canonical checkout: python3 -B docs/evidence/batch3-b35c/functional/verify.py
External input/oracle custody is required. Missing external files is FAIL, not success.
"""
from pathlib import Path
import hashlib
import json
import sys

HERE = Path(__file__).resolve().parent
manifest = json.loads((HERE/'MANIFEST.json').read_bytes())
errors = []
for name, expected in manifest['files'].items():
    p = Path(name)
    if not p.is_file() or p.is_symlink():
        errors.append({'path':name,'error':'missing_or_linked'})
    elif hashlib.sha256(p.read_bytes()).hexdigest() != expected:
        errors.append({'path':name,'error':'hash_drift'})
b = json.loads((HERE/'INPUT_BINDINGS.json').read_bytes())
assert b['primary_trajectories'] == len(b['selected_order']) == 12
assert b['primary_episodes'] == sum(len(b['case_inputs'][t['case']]) for t in b['selected_order']) == 72
assert len(b['case_inputs']) == len(b['oracle_references']) == 4
for case, episodes in b['case_inputs'].items():
    assert {t['variant'] for t in b['selected_order'] if t['case']==case} == {'B0','B1','M1'}
    assert [ep['episode'] for ep in episodes] == list(range(1,7))
    for ep in episodes:
        for row in ep['inputs']:
            p = Path(b['external_root'])/'fixtures'/case/str(ep['episode'])/row['name']
            assert manifest['files'][str(p)] == row['sha256']
print(json.dumps({'ok':not errors,'files_checked':len(manifest['files']),
                  'primary_trajectories':12,'primary_episodes':72,
                  'errors':errors,'paid_authority':False},indent=2))
sys.exit(bool(errors))
