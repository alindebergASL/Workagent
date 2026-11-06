"""Exact downloaded patch readback; text processing only, no candidate execution."""
import json,re
from pathlib import Path
from hashlib import sha256
from workagent.db import Database
from workagent.service import Service,Principal
from workagent.workspace_file_models import AcceptFileProposal
from workagent.errors import DomainError
from test_domain import cmd
base=Path(__file__).resolve().parent;out=base/'evidence'
def apply(original,delta,name):
 lines=original.splitlines(True);patch=delta.splitlines(True);assert patch[:2]==['--- a/'+name+'\n','+++ b/'+name+'\n'];result=[];cursor=0;i=2
 while i<len(patch):
  m=re.fullmatch(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*\n',patch[i]);assert m;i+=1
  start=int(m[1])-1;assert start>=cursor;result.extend(lines[cursor:start]);cursor=start
  consumed=produced=0
  while i<len(patch) and not patch[i].startswith('@@ '):
   line=patch[i];i+=1;assert line[0] in ' +-'
   if line[0] in ' -':assert cursor<len(lines) and lines[cursor]==line[1:];cursor+=1;consumed+=1
   if line[0] in ' +':result.append(line[1:]);produced+=1
  assert consumed==int(m[2] or 1) and produced==int(m[4] or 1)
 result.extend(lines[cursor:]);return ''.join(result)
records=[]
for stage,name in [('v1','bands_v1.py'),('v2','bands_v2.py'),('transfer','transfer.py')]:
 old=(base/'supplied'/name).read_text();candidate=(out/(stage+'-1-candidate.txt')).read_text();delta=(out/(stage+'-1-patch.txt')).read_text();assert apply(old,delta,name)==candidate
 tests=json.loads((out/(stage+'-1-tests.json')).read_text());assert tests['candidate_sha256']==sha256(candidate.encode()).hexdigest() and tests['exit_code']==0
 app=json.loads((out/(stage+'-1-applicability.json')).read_text());assert app['exact_inputs'][name]['sha256']==sha256(old.encode()).hexdigest()
 assert app['exact_inputs']['tests.py']['sha256']==sha256((base/'supplied/tests.py').read_bytes()).hexdigest()
 if stage=='v2':
  protected='        # HUMAN-PROTECTED: maintenance-bypass rows never darken the carousel.\n        if row.get("status") == "maintenance-bypass":\n            continue\n';assert protected in old and protected in candidate
 records.append(dict(stage=stage,patch_sha256=sha256(delta.encode()).hexdigest(),candidate_sha256=sha256(candidate.encode()).hexdigest(),exact_apply=True,test_entrypoint=tests['entrypoint'],tests_immutable=True))
# The downloaded browser patch is the exact tested transfer patch, not merely same name.
assert (out/'browser/before-patch.txt').read_bytes()==(out/'transfer-1-patch.txt').read_bytes()
# Human-facing old proposal cannot apply against the changed v2 source.
f=json.loads((base/'main-fixture.json').read_text());s=Service(Database());p=Principal('local-human');ws=f['workspace_id'];ref=f['stages']['v2']['source'];v1=json.loads((out/'v1-observations.json').read_text());proposal=next(r['observation']['output']['result'] for r in v1 if r['capability_id']=='files.propose_patch');a=s.get_artifact(p,ws,ref['workspace_file_id']);assert a.current_revision_id==ref['version_id']
try:s.accept_file_proposal(p,ws,ref['workspace_file_id'],proposal['proposal_id'],cmd(AcceptFileProposal,expected_current_revision_id=ref['version_id'],expected_sha256=ref['sha256'],acknowledge_removed_content=True))
except DomainError as e:assert e.code.value=='version_conflict';rejected=e.code.value
else:raise AssertionError('stale patch unexpectedly accepted')
after=s.get_artifact(p,ws,ref['workspace_file_id'])
assert after.current_revision_id==a.current_revision_id and after.current_revision.body==a.current_revision.body
# No independently held-out oracle was ever staged into product file versions.
with s.db.transaction() as c:
 rows=c.execute("SELECT a.call FROM tool_attempts a WHERE a.run_id=ANY(%s) AND a.capability_id='compute.python'",([f['stages'][k]['run_id'] for k in ('v1','v2')],)).fetchall()
 assert len(rows)==4
 assert all('heldout_test' not in json.dumps(r['call']) and '39fc05a6829ea8fd280a95f000b8f93f1f3e39bc0cada41a745f0d99ea848af6' not in json.dumps(r['call']) for r in rows)
result=dict(patches=records,stale_proposal_refused=rejected,human_v2_preserved=True,oracle_not_product_staged=True)
(out/'patch-readback.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
