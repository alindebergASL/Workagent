"""Additive pre-funding source amendment; preserves original plans and grants.

Only FileBody exact-target type admission changed in product. Source hashes in
provider grants remain historical provenance per general_responses.validate_grant;
loaded runtime and issuer/recipient plan bind the new source explicitly.
"""
import json
from hashlib import sha256
from pathlib import Path
from network_harness import REPO as ROOT, inventory
from study_binding import SOURCE_HASHES, canonical, digest, validate_sources
from study_controller import load_schedule

out=ROOT/'.local/batch3/b35c/live-study'
original=out/'recipient-plans.json'
doc=json.loads(original.read_text())
_,schedule=load_schedule()
by_id={t['blind_id']:t['variant'] for t in schedule}
validate_sources({arm:inventory(ROOT/('.local/batch3/b35b/baseline/workagent' if arm=='B0' else 'backend/workagent')) for arm in SOURCE_HASHES})
for p in doc['plans']:
    p['prior_plan_sha256']=p.pop('binding_sha256')
    p['source_manifest_sha256']=SOURCE_HASHES[by_id[p['blind_id']]]
    p['amendment']='FileBody exact-target admission; source-only pre-funding correction; original grant bytes unchanged'
    p['binding_sha256']=digest(canonical(p))
doc['prior_document_sha256']=sha256(original.read_bytes()).hexdigest()
doc['candidate_source_files']={'backend/workagent/general_responses.py':sha256((ROOT/'backend/workagent/general_responses.py').read_bytes()).hexdigest()}
path=out/'recipient-plans-file-target.json'
with path.open('x') as f:json.dump(doc,f,indent=2);f.write('\n')
print(json.dumps(dict(path=str(path.relative_to(ROOT)),prior_document_sha256=doc['prior_document_sha256'],new_document_sha256=sha256(path.read_bytes()).hexdigest(),plans=len(doc['plans']),provider_calls=0,grant_mutations=0)))
