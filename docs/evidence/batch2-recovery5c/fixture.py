"""Append-only, canonical synthetic fixtures; no network/model transport."""
from pathlib import Path
import sys, os, json, hashlib, copy
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from workagent.db import Database
from workagent.service import Service,Principal
from workagent.models import CreateConversation,HumanSave
from workagent.flexible_models import StructuredTableBody
from workagent.fixture import seed
from test_domain import cmd
from test_flexible_work import publish,table
from test_proposal_review_pg import candidate
OUT=ROOT/'docs/evidence/batch2-recovery5c'
assert '/workagent_test_' in os.environ['DATABASE_URL']
s=Service(Database());p=Principal('local-human');ws='recovery5c-workspace'
ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
def save(name,data):
 with (OUT/(name+'.json')).open('x') as f:json.dump(data,f,indent=2,ensure_ascii=False,default=str);f.write('\n')
def bodyof(art):return art.current_revision.body.model_dump(mode='json')
def audit():
 with s.db.transaction() as c:
  identity=c.execute('SELECT current_database() db,current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
  names=[r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE '%ledger%' OR tablename LIKE '%dispatch%' OR tablename LIKE '%grant%' OR tablename LIKE '%usage%')").fetchall()]
  tables={n:c.execute('SELECT to_jsonb(t) value FROM '+n+' t ORDER BY to_jsonb(t)::text').fetchall() for n in names}
  old=c.execute("SELECT to_jsonb(t) value FROM source_access t WHERE workspace_id='recovery5a-workspace' ORDER BY to_jsonb(t)::text").fetchall()
 return {'identity':dict(identity),'ledger_tables':{n:{'count':len(r),'sha256':hashlib.sha256(json.dumps(r,sort_keys=True,default=str).encode()).hexdigest()} for n,r in tables.items()},'preexisting_source_access_sha256':hashlib.sha256(json.dumps(old,sort_keys=True,default=str).encode()).hexdigest()}
mode=sys.argv[1]
if mode=='seed':
 assert not (OUT/'fixture.json').exists()
 manifest=json.loads((ROOT/'docs/evidence/batch2-recovery5b/source-manifest.json').read_text())
 assert len(manifest)==602 and all(hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==h for f,h in manifest.items())
 save('source-binding',{'files':len(manifest),'drift':[],'manifest_sha256':hashlib.sha256((ROOT/'docs/evidence/batch2-recovery5b/source-manifest.json').read_bytes()).hexdigest()})
 save('audit-before',audit())
 five=['Venue shortlist:\n- Hall A\n- Hall B\n- Hall C\n- Hall D','  Deposit due Friday.  ','Contacts\n\nMara (catering)\nIo (AV)\n','Single line.','Budget\n  draft 1\n  draft 2\n\t(rounded)\n']
 ten=['  duplicate 雪\n\nend\n','  duplicate 雪\n\nend\n']+[f'n{i}\n\n  exact ♪\n' for i in range(3,11)]
 assert len(five)==5 and len('\n'.join(five).split('\n'))==17 and len(ten)==10
 bodies={}
 for name,notes in [('five',five),('ten',ten),('removals',[])]:
  b=table();b['title']='Recovery5c '+name;b['notes']=notes
  if name=='removals':b['rows']=[{'row_id':f'row-{i:02}','cells':[{'field_key':'plant','value':f'Plant {i:02}'},{'field_key':'height','value':'12.5'}]} for i in range(26)]
  bodies[name]=StructuredTableBody.model_validate(b).model_dump(mode='json')
 # All canonical bodies validated before first fixture write.
 save('canonical-inputs',bodies)
 seed(os.environ['MIGRATION_DATABASE_URL'],[],ws,p.id)
 result={'workspace':ws,'principal':p.id,'origin':'synthetic; inline ControlledTransport fixture builder only; no model or provider worker process','items':{}}
 for name,b in bodies.items():
  cv=s.create_conversation(p,ws,cmd(CreateConversation,title='Recovery5c '+name,selected_source_refs=[]))
  cv,_,art=publish(ctx,b,cv)
  art=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=b))
  read=s.get_artifact(p,ws,art.id);assert bodyof(read)==b
  result['items'][name]={'conversation':cv.id,'artifact':art.id,'revision':read.current_revision_id,'body_hash':read.current_revision.body_hash,'body':b}
  if name=='removals':
   proposed=copy.deepcopy(b);proposed['rows']=[]
   prop=candidate(ctx,art,StructuredTableBody.model_validate(proposed).model_dump(mode='json'))
   result['items'][name]['proposal']=prop.id
 save('fixture',result);save('audit-seeded',audit());print(json.dumps({k:{f:v for f,v in x.items() if f not in ['body']} for k,x in result['items'].items()},indent=2))
elif mode in ('newer','stale'):
 f=json.loads((OUT/'fixture.json').read_text())['items']['removals'];art=s.get_artifact(p,ws,f['artifact']);body=bodyof(art)
 if mode=='newer':
  body['rows']=[];prop=candidate(ctx,art,body);read=s.proposals(p,ws,art.id);assert any(x.id==prop.id for x in read.items);save('newer-'+prop.id,{'proposal':prop.id,'base':art.current_revision_id,'proposals':read.model_dump(mode='json')})
 else:
  body['notes']=['Human concurrent correction: keep exact base fence.'];new=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body));assert bodyof(s.get_artifact(p,ws,art.id))==body;save('stale-base',new.model_dump(mode='json'))
elif mode.startswith('audit-'):save(mode,audit());print('audit captured')
