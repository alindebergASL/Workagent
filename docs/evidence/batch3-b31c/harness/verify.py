"""Independent arithmetic oracle and actual HTTP/PG/request/no-repeat verification."""
import csv,io,json,os
from pathlib import Path
from fractions import Fraction
from hashlib import sha256
from workagent.db import Database
from workagent.service import Service,Principal
from workagent.operator_client import OperatorClient
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
root=Path.cwd();proof=root.parent;out=proof/'evidence';f=json.loads((proof/'fixture.json').read_text());ws=f['workspace_id'];s=Service(Database());p=Principal('local-human');client=OperatorClient();ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
# Explicit manually enumerated valid unique observations, independent of the
# model-selected CSV parser, its dedup implementation, and denominator code.
truth={'initial':{'North':[60,180],'South':[240]},'later':{'North':[90,270],'South':[120,360]},'control':{'North':[90,270],'South':[120,360]},'native100':{'North':[30,150],'South':[240,120]},'forgotten':{'North':[90,270],'South':[120,360]}}
checks=[];processes=[];success_runs=[]
for label,groups in truth.items():
 receipt=json.loads((out/(label+'-result.json')).read_text());success_runs.append(receipt['run_id']);processes.append(receipt['pid']);raw=(out/(label+'-summary.csv')).read_bytes();actual=list(csv.DictReader(io.StringIO(raw.decode())))
 expected=[dict(group=g,unique_valid_observations=str(len(values)),total_seconds=f'{float(sum(Fraction(x) for x in values)):.3f}',mean_seconds=f'{float(sum(Fraction(x) for x in values)/len(values)):.3f}') for g,values in sorted(groups.items())]
 assert actual==expected,(label,actual,expected)
 assert len(receipt['downloads'])==2 and receipt['tool_observations']==4
 contexts=json.loads((out/(label+'-contexts.json')).read_text());want=[f['memory']['revision_id']] if label in ('later','native100') else []
 for c in contexts:
  assert [x['revision_id'] for x in c['memory_manifest']]==want
  text=json.dumps(c);assert 'CONFIDENTIAL SYNTHETIC' not in text and 'watering frequency' not in text
  if label=='forgotten':assert f['lesson'] not in text and f['memory']['memory_id'] not in text
 for u in receipt['usage']['items']: assert [x['revision_id'] for x in u['entries']]==want
 coverage=json.loads((out/(label+'-coverage.json')).read_text());assert coverage['reviewed_procedure_revisions']==want
 # Successful run opened by another process after memory erasure never dispatches.
 provider=AlphaProvider([dict(kind='reply',text='MUST NOT RESEND')]);r=worker(ctx,provider,proof/'worker-state').work(p,ws,receipt['run_id']);assert r.state=='ready' and not provider.calls
 checks.append(dict(label=label,run_id=r.id,expected=expected,actual=actual,output_sha256=sha256(raw).hexdigest(),memory_revisions=want,context_count=len(contexts),usage_count=len(receipt['usage']['items']),fresh_process_no_repeat=True,oracle='Independent explicit Fraction observations; not model output'))
assert len(set(processes))==len(processes)
# Equal tools, same changed input, no-memory control: no claimed causal uplift.
a=json.loads((out/'later-tool-grant.json').read_text());b=json.loads((out/'control-tool-grant.json').read_text());assert a['capabilities']==b['capabilities'] and a['effects']==b['effects']
assert (out/'later-summary.csv').read_bytes()==(out/'control-summary.csv').read_bytes()==(out/'forgotten-summary.csv').read_bytes()
# Exact human revision and original source retained after worker/client restarts.
files=client.request('/'+ws+'/work-areas/'+f['first']+'/files')['items'];edited=next(x for x in files if x['filename']=='summary.csv');ref=edited['current'];path='/'+ws+'/files/'+edited['workspace_file_id']+'/versions/'+ref['version_id']+'?sha256='+ref['sha256'];human=client.request(path)
assert human['text']==f['human']['revised'];assert human['text'].count('Human annotation:')==1;assert ref['sha256']==sha256(human['text'].encode()).hexdigest()
with s.db.transaction() as c:
 artifact=s.get_artifact(p,ws,edited['workspace_file_id']);assert artifact.current_revision.author_kind=='human'
 original=next(x for x in files if x['filename']=='observations.csv');source=s.read_workspace_file(p,ws,original['workspace_file_id'],original['current']['version_id'],original['current']['sha256']);assert source.text=='observation_id,zone,latency_seconds\nr1,North,60\nr2,North,180\nr3,South,240\nr4,South,\n'
 compute=c.execute("SELECT a.id,a.run_id,e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' WHERE a.workspace_id=%s AND a.capability_id='compute.python' ORDER BY a.id",(ws,)).fetchall()
 assert len(compute)==len(truth) and all(x['data']['status']=='observed' and x['data']['output']['result']['status']=='succeeded' for x in compute)
 # Old unknown model dispatch has no compute attempt and is NOT retried.
 unknown=json.loads((out/'unknown-no-repeat.json').read_text());assert not any(x['run_id']==unknown['run_id'] for x in compute)
forgot=client.request('/'+ws+'/memory/'+f['memory']['memory_id']);assert forgot['current']['status']=='forgotten' and all(r['content'] is None for r in forgot['revisions'])
for label in ('later','forgotten','control'):
 listing=client.request('/'+ws+'/memory?conversation_id='+f[label]);assert not listing['items']
# Assert native downloadable output belongs to the new, not an older, summary.
native=json.loads((out/'pty/native100-result.json').read_text());assert native['download_text']==(out/'native100-summary.csv').read_text()
small=json.loads((out/'pty/native80-result.json').read_text());assert small['download_text']==human['text']
report=dict(passed=True,controlled_transport=True,paid_calls=0,causal_usefulness_claim=False,comparisons=checks,worker_processes=processes,verifier_pid=os.getpid(),human_revision=dict(file_id=edited['workspace_file_id'],revision_id=ref['version_id'],sha256=ref['sha256'],author_kind='human',exact_text=human['text']),compute_observation_count=len(compute),equal_tools_no_memory_same_result=True,negative_scope_transfer_absent=True,forget_payloads_erased=True,unknown_no_repeat=unknown)
(out/'combined-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
