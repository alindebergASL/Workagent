"""Read-only source/receipt integrity check. Run from canonical repo root."""
from hashlib import sha256
import json
from pathlib import Path

root=Path.cwd()
here=Path(__file__).resolve().parent
manifest=json.loads((here/'MANIFEST.json').read_bytes())
for name,expected in manifest['files'].items():
    path=root/name
    assert path.is_file() and not path.is_symlink(),name
    assert sha256(path.read_bytes()).hexdigest()==expected,name
for mode in ['off','reviewed-v1']:
    proof=json.loads((here/(mode+'-proof.json')).read_bytes())
    assert proof['evidence']=='deterministic_worker_local_TLS_not_live_usefulness'
    assert len(proof['request_sha256'])==8 and proof['max_output_tokens']==[8192]*8
    assert len(proof['observations'])==6 and all(o['status']=='observed' for o in proof['observations'])
    assert {o['output']['capability'] for o in proof['observations']}=={
        'research_search','research_capture','files_read_range','files_create_draft','research_cite','artifacts_export'}
    assert len(proof['memory_usage'])==(8 if mode=='reviewed-v1' else 0)
    assert sha256((here/(mode+'-editorial.md')).read_bytes()).hexdigest()==proof['export']['blob']['sha256']
    assert proof['restarted_after_draft'] and proof['duplicate_requests']==proof['paid_product_calls']==0
upgrade=json.loads((here/'upgrade-proof.json').read_bytes())
assert upgrade['old_migrations']==73 and upgrade['new_migrations']==74
assert upgrade['legacy_grants_still_exact_only']==1
assert manifest['live_episodes']==manifest['paid_product_calls']==manifest['ledger_recollections']==0
assert len(manifest['baseline_drift'])==1
assert manifest['baseline_drift'][0]['path'].endswith('/docs/DEVELOPMENT_AUTHORITY.md')
print(json.dumps(dict(ok=True,hashed_files=len(manifest['files']),tests_passed=manifest['tests_passed'],
    scripted_complete_workflows=2,live_episodes=0,upgrade_tables=upgrade['unchanged_table_count'],
    upgrade_rows=upgrade['unchanged_rows'],review=manifest['next_review']),indent=2))
