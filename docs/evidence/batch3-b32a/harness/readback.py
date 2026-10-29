"""Exact authenticated readback, immutable hashes and completed-run zero resend."""
import json,os,sys
from pathlib import Path
from hashlib import sha256
from workagent.db import Database
from workagent.service import Service,Principal,canonical
from workagent.operator_client import OperatorClient
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
base=Path.cwd()/'.local/batch3/b32a';f=json.loads((base/os.environ.get('B32A_FIXTURE_FILE','fixture.json')).read_text());kind,label=sys.argv[1:3];ws=f['workspace_id'];cid=f[kind];client=OperatorClient();s=Service(Database());p=Principal('local-human');ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
def counts():
 with s.db.transaction() as c:
  runs=c.execute('SELECT id FROM runs WHERE workspace_id=%s AND conversation_id=%s ORDER BY id',(ws,cid)).fetchall();ids=[v['id'] for v in runs]
  queries={
   'tool_attempts':('SELECT count(*) n FROM tool_attempts WHERE workspace_id=%s AND run_id=ANY(%s)',(ws,ids)),
   'tool_events':('SELECT count(*) n FROM tool_attempt_events WHERE attempt_id IN (SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=ANY(%s))',(ws,ids)),
   'tool_costs':('SELECT count(*) n FROM tool_cost_entries WHERE attempt_id IN (SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=ANY(%s))',(ws,ids)),
   'provider_events':('SELECT count(*) n FROM responses_events WHERE attempt_id IN (SELECT id FROM provider_attempts WHERE workspace_id=%s AND run_id=ANY(%s))',(ws,ids)),
   'source_snapshots':('SELECT count(*) n FROM source_snapshots s JOIN workspace_files f ON f.workspace_id=s.workspace_id AND f.id=s.workspace_file_id WHERE s.workspace_id=%s AND f.conversation_id=%s',(ws,cid))}
  return {k:c.execute(q,args).fetchone()['n'] for k,(q,args) in queries.items()}
before=counts();detail=client.request('/'+ws+'/conversations/'+cid);sources=client.request('/'+ws+'/work-areas/'+cid+'/research/snapshots')['items'];sources.sort(key=lambda x:x['version_number']);files=client.request('/'+ws+'/work-areas/'+cid+'/files')['items'];file=next(x for x in files if x['filename']=='research-conclusion.txt');art=client.request('/'+ws+'/artifacts/'+file['workspace_file_id']);human=f[kind+'_human'];assert art['current_revision']['body']['content']==human
actual=[]
for snap in sources:
 exact=client.request('/'+ws+'/research/snapshots/'+snap['snapshot_id']);assert exact==snap
 raw=s.read_workspace_file(p,ws,snap['workspace_file_id'],snap['snapshot_id'],snap['extraction_sha256']).text
 assert sha256(raw.encode()).hexdigest()==snap['extraction_sha256']
 with s.db.transaction() as c:blob=c.execute('SELECT bytes FROM generated_blobs WHERE workspace_id=%s AND id=%s',(ws,snap['locator']['blob_id'])).fetchone()['bytes']
 assert sha256(bytes(blob)).hexdigest()==snap['original_sha256']
 actual.append({'snapshot':snap,'raw_utf8':bytes(blob).decode(),'extracted_text':raw})
assert len(actual)==2 and [x['snapshot']['version_number'] for x in actual]==[1,2]
assert '10 units' in actual[0]['extracted_text'] and '12 units' in actual[1]['extracted_text']
proposals=s.proposals(p,ws,art['id']).items
assert len(proposals)==1 and proposals[0].status=='pending'
assert human in proposals[0].body.content and '12 units' in proposals[0].body.content
fake=AlphaProvider([])
for run in detail['runs']:
 assert run['state']=='ready'
 result=worker(ctx,fake,base/'worker-state').work(p,ws,run['id']);assert result.state=='ready'
assert fake.calls==[]
after=counts();assert after==before
report={'label':label,'conversation_id':cid,'workspace_id':ws,'human_body':human,'human_utf8_sha256':sha256(human.encode()).hexdigest(),'artifact':art,'sources':actual,'proposals':[x.model_dump(mode='json') for x in proposals],'before':before,'after':after,'completed_runs':len(detail['runs']),'repeated_provider_calls':fake.calls,'processes':json.loads((base/'processes.json').read_text()),'passed':True}
(base/'evidence'/(label+'-readback.json')).write_text(json.dumps(report,indent=2,default=str));print(json.dumps({'passed':True,'label':label,'counts':after,'completed_runs':len(detail['runs']),'provider_calls':0}))
