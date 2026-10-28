"""Controlled selections only: real HTTP, restricted PG and gVisor; NOT live usefulness.
The same tools and program run for memory and no-memory controls. No expected
values or old result numbers are inserted into product context or production code.
"""
import json,os,sys,subprocess,time
from pathlib import Path
from hashlib import sha256
from datetime import timedelta
from unittest.mock import patch
from workagent.db import Database
from workagent.service import Service,Principal
from workagent.models import new_id,now,CreateWorkArea
from workagent.fixture import seed
from workagent.operator_client import OperatorClient
from workagent.memory.runtime import POLICY,SCHEMA
from workagent.capabilities import registry,policy
from workagent.capabilities.models import ToolGrantV1,CapabilityPin,InputRef
from test_standing_admission import standing_grant
from test_domain import cmd
from test_general_responses import worker
from test_general_alpha_runtime import AlphaProvider
from test_adaptive_execution import finish_safe_visits
from workagent.provider_attempts import configure_grant
ROOT=Path.cwd();PROOF=ROOT.parent;OUT=PROOF/'evidence'; OUT.mkdir(exist_ok=True)
s=Service(Database());p=Principal('local-human');client=OperatorClient()
def save(name,value): (OUT/(name+'.json')).write_text(json.dumps(value,indent=2,default=str)+'\n')
def load():return json.loads((PROOF/'fixture.json').read_text())
def initialize():
 ws='b31c-'+new_id();seed(os.environ['MIGRATION_DATABASE_URL'],json.loads((ROOT/'fixtures/actor/solo-v0.1/initial_records.json').read_text()),ws,p.id)
 ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL']);s.db.check_runtime_role()
 with patch('test_alpha_budget.POLICY',POLICY),patch('test_alpha_budget.DECISION_SCHEMA',SCHEMA):
  g=standing_grant(ctx,max_runs=30,continuity_version='sustained-v1',max_steps=6)
 configure_grant(Database(ctx[4]),g)
 f=dict(workspace_id=ws,grant_id=g.id,projects={})
 for key,title in [('study','Duration study'),('irrelevant','Plant inventory'),('confidential','Confidential synthetic project')]:
  f['projects'][key]=s.create_work_area(p,ws,cmd(CreateWorkArea,title=title,goal='Synthetic scoped work',kind='project')).id
 (PROOF/'fixture.json').write_text(json.dumps(f,indent=2));save('fixture-public',f); print(json.dumps(f))

# This is model-selected code in the CONTROLLED TRANSPORT, not an application handler.
# Column mapping comes only from the current human's explicit JSON specification.
PROGRAM='''import csv,json
from decimal import Decimal,ROUND_HALF_UP
from collections import defaultdict
spec=SPEC
rows=list(csv.DictReader(open('/inputs/data.csv',newline='')))
seen=set(); groups=defaultdict(list); omitted=[]
for r in rows:
    identity=r[spec['id']]
    if identity in seen:
        omitted.append({'id':identity,'reason':'duplicate observation'});continue
    seen.add(identity)
    if not r[spec['value']].strip():
        omitted.append({'id':identity,'reason':'missing duration is not zero'});continue
    value=Decimal(r[spec['value']])*Decimal(spec['seconds_per_unit'])
    groups[r[spec['group']]].append(value)
import io
out=io.StringIO();w=csv.writer(out,lineterminator='\\n')
w.writerow(['group','unique_valid_observations','total_seconds','mean_seconds'])
for key,values in sorted(groups.items()):
    total=sum(values);mean=total/len(values)
    w.writerow([key,len(values),str(total.quantize(Decimal('.001'),rounding=ROUND_HALF_UP)),str(mean.quantize(Decimal('.001'),rounding=ROUND_HALF_UP))])
text=out.getvalue()
open('/outputs/summary.csv','w').write(text)
open('/outputs/coverage.json','w').write(json.dumps({'spec':spec,'rows_supplied':len(rows),'excluded':omitted,'reviewed_procedure_revisions':REVISIONS},sort_keys=True))
print(json.dumps({'filename':'summary.csv','content':text}))
'''
def objects(value):
 if isinstance(value,dict):
  yield value
  for v in value.values():yield from objects(v)
 elif isinstance(value,list):
  for v in value:yield from objects(v)

def execute(cid,label):
 f=load();ws=f['workspace_id'];ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
 detail=client.request('/'+ws+'/conversations/'+cid)
 run=detail['runs'][-1];rid=run['id']
 message=next(m for m in detail['messages'] if m['run_id']==rid and m['author_kind']=='human')
 if not message['attachments']:
  provider=AlphaProvider([{'kind':'reply','text':'Ready to work with the supplied dataset. Controlled transport; not a live model evaluation.'}])
 else:
  files=s.list_workspace_files(p,ws,cid).items
  assert files,'Ordinary upload must reach exact-file substrate without operator staging'
  current=next(x for x in files if x.current.sha256==message['attachments'][0]['sha256'])
  ds=[registry.adapters()[name].descriptor for name in ['files.list','files.read_range','compute.python','files.create_draft']]
  grant=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=rid,scope_id=cid,
   capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
   resource_selectors=[InputRef(kind='workspace_file',id=current.workspace_file_id,version=current.current.version_id,sha256=current.current.sha256)],
   effects=sorted(set(e for d in ds for e in d.effects)),privacy_classes=['workspace_private'],egress='none',expires_at=now()+timedelta(hours=1),
   access_generation=run['access_generation'],budget_account_id=new_id())
  policy.install(Database(ctx[4]),grant,limits={'local_compute':10,'rendering':5})
  save(label+'-tool-grant',grant.model_dump(mode='json'))
  def read(c):
   entries=[v for v in objects(c) if v.get('workspace_file_id')==current.workspace_file_id and 'current' in v]
   assert entries,'file list must actually be in provider context'
   return dict(kind='files_read_range',ref=entries[0]['current'],offset=0,limit=8192)
  def compute(c):
   reads=[v for v in objects(c) if isinstance(v.get('ref'),dict) and v['ref'].get('workspace_file_id')==current.workspace_file_id and 'chunk_sha256' in v]
   assert reads and reads[0]['text']==message['attachments'][0]['content']
   spec=json.loads(message['text'].split('Column mapping: ',1)[1])
   # Inspect recalled procedure as advisory evidence. It never grants execution.
   revisions=[v['revision']['revision_id'] for v in c.get('memory_context',{}).get('items',[]) if v['revision']['kind']=='procedure' and v['revision']['origin']=='human_reviewed']
   code=PROGRAM.replace('SPEC',repr(spec)).replace('REVISIONS',repr(revisions))
   save(label+'-selected-code',{'code':code,'sha256':sha256(code.encode()).hexdigest(),'reviewed_revisions':revisions})
   return dict(kind='compute_python',code=code,inputs=[dict(name='data.csv',ref=reads[0]['ref'])])
  def publish(c):
   observations=[v for v in objects(c) if v.get('profile')=='python-analysis-v1' and 'stdout' in v]
   assert observations and observations[0]['status']=='succeeded',c
   actual=json.loads(observations[0]['stdout']);text=actual['content']
   return dict(kind='files_create_draft',source=dict(kind='text',filename=actual['filename'],mime_type='text/csv',content=text,sha256=sha256(text.encode()).hexdigest()))
  provider=AlphaProvider([dict(kind='files_list',after=None,limit=25),read,compute,publish,dict(kind='reply',text='Computed a fresh summary in confined Python. Open summary.csv in Files to inspect or download; source rows remain unchanged. Controlled transport demonstrates mechanisms, not live usefulness.')],explanation='Real confined execution; draft output is not independent verification.')
 result=finish_safe_visits(ctx,worker(ctx,provider,PROOF/'worker-state'),rid)
 save(label+'-contexts',provider.contexts)
 assert result.state=='ready',result
 usages=client.request('/'+ws+'/runs/'+rid+'/memory-usage')
 with s.db.transaction() as c:
  observations=c.execute("SELECT a.id,a.capability_id,e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' WHERE a.workspace_id=%s AND a.run_id=%s ORDER BY a.id",(ws,rid)).fetchall()
  for u in usages['items']:
   r=c.execute('SELECT request_sha256 FROM responses_steps WHERE attempt_id=%s AND phase=%s',(u['attempt_id'],u['phase'])).fetchone();assert r['request_sha256']==u['request_sha256']
 save(label+'-observations',observations)
 downloads=[]
 for o in observations:
  assert o['data']['status']=='observed'
  if o['capability_id']!='compute.python':continue
  result=o['data']['output']['result'];assert result['status']=='succeeded' and result['cleanup_verified']
  for ex in result['outputs']:
   import httpx
   # Ordinary authenticated byte endpoint, not a service-only read.
   response=httpx.get(os.environ['WORKAGENT_OPERATOR_URL']+'/v1/workspaces/'+ws+'/exports/'+ex['export_id']+'/download',headers={'Authorization':'Bearer '+client.token,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()},timeout=20)
   assert response.status_code==200,response.text
   assert sha256(response.content).hexdigest()==ex['blob']['sha256']==response.headers['x-content-sha256']
   (OUT/(label+'-'+ex['filename'])).write_bytes(response.content)
   downloads.append(dict(export_id=ex['export_id'],filename=ex['filename'],sha256=ex['blob']['sha256'],headers=dict(response.headers)))
 before=list(provider.calls);again=worker(ctx,provider,PROOF/'worker-state').work(p,ws,rid)
 assert again.state=='ready' and before==provider.calls
 save(label+'-result',dict(pid=os.getpid(),process_start=Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()[19],conversation_id=cid,run_id=rid,state='ready',usage=usages,downloads=downloads,tool_observations=len(observations),calls=provider.calls,restart_no_repeat=True,controlled_transport=True,paid_calls=0))
 print(label,'PASS',rid)

if __name__=='__main__':
 if sys.argv[1]=='seed':initialize()
 elif sys.argv[1]=='run':execute(sys.argv[2],sys.argv[3])
