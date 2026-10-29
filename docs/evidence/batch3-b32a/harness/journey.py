"""Actual product runtime + TLS fixtures with CONTROLLED transport. Zero model calls."""
import json,os,sys
from pathlib import Path
from hashlib import sha256
from datetime import timedelta
from unittest.mock import patch
from workagent.db import Database
from workagent.service import Service,Principal
from workagent.models import new_id,now
from workagent.fixture import seed
from workagent.operator_client import OperatorClient
from workagent.capabilities.research_composition import POLICY,SCHEMA
from workagent.capabilities import registry,policy,research_adapters as R
from workagent.capabilities.models import ToolGrantV1,CapabilityPin,InputRef
from test_standing_admission import standing_grant
from test_general_responses import worker
from test_general_alpha_runtime import AlphaProvider
from test_adaptive_execution import finish_safe_visits
from workagent.provider_attempts import configure_grant
from research_fixture import fixture,URL,QUERY
ROOT=Path.cwd();OUT=ROOT/'.local/batch3/b32a';E=OUT/'evidence';E.mkdir(exist_ok=True)
s=Service(Database());p=Principal('local-human');client=OperatorClient()
def save(name,v):(E/(name+'.json')).write_text(json.dumps(v,indent=2,default=str)+'\n')
FIXTURE=OUT/os.environ.get('B32A_FIXTURE_FILE','fixture.json')
def load():return json.loads(FIXTURE.read_text())
def objects(value):
 if isinstance(value,dict):
  yield value
  for v in value.values():yield from objects(v)
 elif isinstance(value,list):
  for v in value:yield from objects(v)
def initialize():
 ws='b32a-'+new_id();seed(os.environ['MIGRATION_DATABASE_URL'],json.loads((ROOT/'fixtures/actor/solo-v0.1/initial_records.json').read_text()),ws,p.id)
 ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL']);s.db.check_runtime_role()
 with patch('test_alpha_budget.POLICY',POLICY),patch('test_alpha_budget.DECISION_SCHEMA',SCHEMA):g=standing_grant(ctx,max_runs=30,continuity_version='sustained-v1',max_steps=6)
 configure_grant(Database(ctx[4]),g)
 f=dict(workspace_id=ws,grant_id=g.id);FIXTURE.write_text(json.dumps(f,indent=2));save('fixture-public-'+FIXTURE.stem,f);print(json.dumps(f))

def run(cid,mode,label):
 f=load();ws=f['workspace_id'];ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL']);detail=client.request('/'+ws+'/conversations/'+cid)
 run=detail['runs'][-1];rid=run['id'];capreq=R.ResearchCapture(kind='research_capture',url=URL,allow_browser=False)
 selectors=[];names=[];steps=[]
 if mode=='document':
  from test_work_area_context import document
  steps=[dict(kind='publish_artifact',target=None,body=document('Synthetic east-depot assessment. Evidence will be captured separately; no organization-wide conclusion.'))]
 elif mode=='captureonly':
  names=['research.capture'];selectors=R.input_refs(capreq);steps=[capreq.model_dump()]
 elif mode in ('initial','initialdoc'):
  req=R.ResearchSearch(kind='research_search',query=QUERY)
  names=['research.search','research.capture']+(['files.create_draft'] if mode=='initial' else []);selectors=R.input_refs(req)+R.input_refs(capreq)
  def draft(c):
   captures=[v for v in objects(c) if v.get('status')=='captured' and v.get('snapshot')]
   assert captures,'Must consume actual capture, not a search snippet'
   snapshot=captures[-1]['snapshot'];source=snapshot['locator']['text']
   line=next(x for x in source.splitlines() if x.startswith('Current public capacity:'))
   text='Research conclusion (proposed)\n'+line+'\nScope: synthetic east depot only.\nThe search snippet is not evidence.\n'
   if mode=='initialdoc':
    from test_work_area_context import document
    return dict(kind='publish_artifact',target=None,body=document(text))
   return dict(kind='files_create_draft',source=dict(kind='text',filename='research-conclusion.txt',mime_type='text/plain',content=text,sha256=sha256(text.encode()).hexdigest()))
  steps=[req.model_dump(),capreq.model_dump(),draft]
 elif mode in ('cite','doccite','doccite_latest'):
  if mode.startswith('doccite'):art=s.get_artifact(p,ws,detail['artifact_ids'][0])
  else:
   files=s.list_workspace_files(p,ws,cid).items;file=next(v for v in files if v.filename=='research-conclusion.txt')
   art=s.get_artifact(p,ws,file.workspace_file_id)
  with s.db.transaction() as c:
   rows=c.execute("SELECT s.data FROM source_snapshots s JOIN workspace_files f ON f.workspace_id=s.workspace_id AND f.id=s.workspace_file_id WHERE s.workspace_id=%s AND f.conversation_id=%s AND s.data->'locator'->>'kind'='public_source' ORDER BY s.version_number",(ws,cid)).fetchall()
  snapshot=rows[-1 if mode=='doccite_latest' else 0]['data'];text=snapshot['locator']['text'];quote=next(x for x in text.splitlines() if x.startswith('Current public capacity:'));start=text.index(quote)
  cite=R.ResearchCite(kind='research_cite',artifact_id=art.id,revision_id=art.current_revision_id,body_hash=art.current_revision.body_hash,
      claim='The synthetic east-depot source reports: '+quote,evidence=[dict(workspace_file_id=snapshot['workspace_file_id'],snapshot_id=snapshot['snapshot_id'],text_sha256=snapshot['extraction_sha256'],start=start,end=start+len(quote),quote=quote,relation='supports')])
  unsupported=cite.model_copy(update={'claim':'The entire organization has expanded to 99 units.','evidence':[]})
  names=['research.cite'];selectors=R.input_refs(cite);steps=[cite.model_dump(),unsupported.model_dump()]
 elif mode=='docrefresh':
  names=['research.capture'];selectors=R.input_refs(capreq);steps=[capreq.model_dump()]
 elif mode=='refresh':
  file=next(v for v in s.list_workspace_files(p,ws,cid).items if v.filename=='research-conclusion.txt')
  ref=file.current
  current=s.read_workspace_file(p,ws,ref.workspace_file_id,ref.version_id,ref.sha256).text
  names=['research.capture','files.propose_patch'];selectors=R.input_refs(capreq)+[InputRef(kind='workspace_file',id=ref.workspace_file_id,version=ref.version_id,sha256=ref.sha256)]
  def proposal(c):
   captures=[v for v in objects(c) if v.get('status')=='captured' and v.get('snapshot')]
   source=captures[-1]['snapshot']['locator']['text'];line=next(x for x in source.splitlines() if x.startswith('Current public capacity:'))
   text=current+'\nProposed source update (not accepted): '+line+'\n'
   return dict(kind='files_propose_patch',ref=ref.model_dump(),content=text,sha256=sha256(text.encode()).hexdigest(),reason='New immutable source version; retain the protected human conclusion until explicit review.')
  steps=[capreq.model_dump(),proposal]
 else:raise ValueError(mode)
 ds=[registry.adapters()[name].descriptor for name in names]
 grant=None
 if ds:
  grant=ToolGrantV1(id=new_id(),workspace_id=ws,principal_id=p.id,run_id=rid,scope_id=cid,
   capabilities=[CapabilityPin(id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256) for d in ds],
   resource_selectors=list({r.model_dump_json():r for r in selectors}.values()),effects=sorted(set(e for d in ds for e in d.effects)),privacy_classes=['public','workspace_private'],egress='public_https',
   expires_at=now()+timedelta(hours=2),access_generation=run['access_generation'],budget_account_id=new_id())
  policy.install(Database(ctx[4]),grant,limits={'local_compute':10,'search':5,'extraction':10})
 provider=AlphaProvider(steps+[dict(kind='reply',text='Exact captured sources and citations are available in Files and the saved result. A changed source is a proposal, not permission to replace your conclusion. Controlled transport and local TLS fixtures; no live search/model usefulness claim.')])
 with fixture(OUT/'tls',version='B' if mode in ('refresh','docrefresh') else 'A') as transport:
  result=finish_safe_visits(ctx,worker(ctx,provider,OUT/'worker-state'),rid)
  save(label+'-tls-requests',transport['calls']);save(label+'-source-bytes',{'raw_utf8':transport['raw'].decode(),'sha256':sha256(transport['raw']).hexdigest(),'fixture':True})
 save(label+'-contexts',provider.contexts)
 with s.db.transaction() as c:
  observations=c.execute("SELECT a.id,a.capability_id,e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' WHERE a.workspace_id=%s AND a.run_id=%s ORDER BY e.created_at",(ws,rid)).fetchall()
 save(label+'-observations',observations)
 save(label+'-result',{'run_id':rid,'conversation_id':cid,'state':result.state,'mode':mode,'product_provider_calls':0,'grant_id':grant.id if grant else None})
 assert result.state=='ready',result.state
 assert all(o['data']['status']=='observed' for o in observations),[(o['capability_id'],o['data']['status']) for o in observations]
 print(label,'actual worker/TLS PASS',rid)

if __name__=='__main__':
 if sys.argv[1]=='init':initialize()
 elif sys.argv[1]=='run':run(*sys.argv[2:5])
