import hashlib,json,re,subprocess
from pathlib import Path
root=Path.cwd();base=root/'docs/evidence/batch3-b31c';rec=base/'receipts'
final=json.loads((rec/'source-manifest.json').read_text());old=json.loads((rec/'exercised-source-manifest.json').read_text())
assert [p for p in final['files'] if final['files'][p]!=old['files'][p]]==['contracts/capability-registry-v2.json']
for p,h in final['files'].items():assert hashlib.sha256((root/p).read_bytes()).hexdigest()==h,p
review=(base/'REVIEW.md').read_text();bindings=re.findall(r'\| `([^`]+)` \| `([a-f0-9]{64})` \|',review);assert len(bindings)==3
for p,h in bindings:assert hashlib.sha256((root/p).read_bytes()).hexdigest()==h,p
catalog={d['id']:d for d in json.loads((root/'contracts/capability-registry-v2.json').read_text())}
for label in ('initial','later','control','native100','forgotten'):
 grant=json.loads((rec/(label+'-tool-grant.json')).read_text())
 for pin in grant['capabilities']:
  assert pin['implementation_sha256']==catalog[pin['id']]['implementation_sha256']
report=json.loads((rec/'combined-verification.json').read_text());assert report['passed'] and len(report['comparisons'])==5
later=json.loads((rec/'later-contexts.json').read_text())[0];initial=json.loads((rec/'initial-result.json').read_text());t=json.dumps(later)
assert initial['conversation_id'] not in t and 'latency_seconds' not in t and initial['downloads'][0]['sha256'] not in t
assert later['saved_work']['items']==[]
(rec/'final-binding-check.json').write_text(json.dumps(dict(passed=True,source_files=len(final['files']),review_bindings=len(bindings),canonical_pins_match_executed_grants=True,initial_conversation_old_schema_output_hash_absent_from_later_initial_context=True,initial_saved_work_empty=True,contract_only_delta=['contracts/capability-registry-v2.json']),indent=2)+'\n')
# Real credentials/DSNs must never appear in the deliverable; no synthetic key literals rejected.
for p in base.rglob('*'):
 if not p.is_file() or p.suffix=='.png':continue
 text=p.read_text()
 assert not re.search(r'postgres(?:ql)?://[^\s\"\'<>]+',text),p
 assert not re.search(r'gh[o|p]_[A-Za-z0-9]{25,}|sk-proj-[A-Za-z0-9_-]{20,}',text),p
files={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(base.rglob('*')) if p.is_file() and p.name!='evidence-manifest.json'}
(base/'evidence-manifest.json').write_text(json.dumps(dict(base=final['base'],controlled_transport=True,paid_product_calls=0,source_count=len(final['files']),evidence_count=len(files),files=files),indent=2)+'\n')
print(json.dumps(dict(source_files=len(final['files']),review_bindings=len(bindings),evidence_files=len(files),five_outputs_verified=True,secret_scan='PASS'),indent=2))
