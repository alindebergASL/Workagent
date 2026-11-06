"""Package only public review evidence; never include raw study state/oracles."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
h = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
for name, count in [('existing-tests.log', 15), ('independent-probes-03.log', 11)]:
    assert re.search(rf'\b{count} passed\b', (HERE/name).read_text())
manifest = ROOT/'docs/evidence/batch3-b35c/controller/MANIFEST.json'
for path, expected in json.loads(manifest.read_text())['files'].items():
    assert h(ROOT/path) == expected, path
additive = ROOT/'docs/evidence/batch3-b35c/execution/ADDITIVE_BINDING.json'
for path, expected in json.loads(additive.read_text())['files'].items():
    assert h(ROOT/path) == expected, path
files = {str(p.relative_to(ROOT)): h(p) for p in sorted(HERE.iterdir())
         if p.is_file() and p.name != 'RECEIPT.json'}
receipt = {
    'task_id': 't_f251a5a9',
    'review_phase': 'complete',
    'review_outcome': 'changes_required_before_live_ready_approval',
    'reviewed_head': '1762d69f0b2b0d0773cb4bb8ce3a319932032df4',
    'controller_manifest_sha256': h(manifest),
    'retained_additive_binding_sha256': h(additive),
    'findings': [
        {'id':'R1','priority':'P1','title':'Dropped environment pins and per-episode dependency rebaselining'},
        {'id':'R2','priority':'P1','title':'Cold-start B0 source lacks accepted immutable anchor'},
        {'id':'R3','priority':'P1','title':'Aliased official longitudinal scopes admitted'},
        {'id':'R4','priority':'P2','title':'Substituted scoring packet passes verifier'},
    ],
    'tests': {'existing_tests_rerun':15,'independent_probes':11,
              'defect_reproducer_tests':5,'retained_guard_tests':6,
              'accepted_baseline_files':103,'controller_manifest_files':13,'run102_additive_files':57},
    'retained_scripted_verification': json.loads((HERE/'retained-verification.json').read_text()),
    'new_full_worker_campaign':False,
    'implementation_edited':False,
    'paid_calls':0,'allocations':0,'installed_mutations':0,'ledger_recollections':0,
    'postgresql_databases_provisioned':0,'live_episodes':0,
    'original_run102_closure':'parent verified; not a new independent PASS',
    'integration_owner':'t_fedd7a60','execution_owner':'t_e07c8870','publication_owner':'t_82b30c02',
    'development_model':'gpt-6-astra/openai-codex',
    'development_tool_billing':'outside product ledger, unreconciled',
    'files': files,
}
receipt_path = HERE/'RECEIPT.json'
assert not receipt_path.exists(), 'additive review receipt must not be overwritten'
receipt_path.write_text(json.dumps(receipt,sort_keys=True,indent=2)+'\n')
archive = ROOT/'.local/batch3/b35c/controller-review/B3.5c-scoped-controller-review.zip'
archive.parent.mkdir(exist_ok=True,parents=True)
with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
    for path in [*files,str(receipt_path.relative_to(ROOT))]:
        z.write(ROOT/path,path)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for path, expected in files.items():
        assert hashlib.sha256(z.read(path)).hexdigest() == expected
print(json.dumps({'archive':str(archive),'archive_sha256':h(archive),
                  'receipt_sha256':h(receipt_path),'files_bound':len(files),'zip_members':len(files)+1},indent=2))
