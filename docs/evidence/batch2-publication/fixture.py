"""Fresh isolated deterministic runtime fixture; never a live-model result."""
from pathlib import Path
import hashlib
import json
import os
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from workagent.db import Database
from workagent.fixture import seed
from workagent.service import Service, Principal
from workagent.models import CreateConversation, HumanSave
from workagent.flexible_models import StructuredTableBody
from test_domain import cmd
from test_flexible_work import publish, table
OUT=ROOT/'docs/evidence/batch2-publication'
assert '/workagent_test_' in os.environ['DATABASE_URL']
assert not (OUT/'fixture.json').exists()
s=Service(Database());p=Principal('local-human');ws='batch2-publication-smoke-final'
s.db.check_runtime_role()
with s.db.transaction() as c:
 workspace_exists=c.execute('SELECT id FROM workspaces WHERE id=%s',(ws,)).fetchone()
if not workspace_exists:seed(os.environ['MIGRATION_DATABASE_URL'],[],ws,p.id)
ctx=(s,p,ws,[],os.environ['MIGRATION_DATABASE_URL'])
b=table();b['title']='Synthetic garden plan';b['notes']=['Human note: keep Saturday morning.']
b=StructuredTableBody.model_validate(b).model_dump(mode='json')
with s.db.transaction() as c:
 existing=c.execute('SELECT id FROM conversations WHERE workspace_id=%s',(ws,)).fetchall()
if existing:
 assert len(existing)==1
 cv=s.get_conversation(p,ws,existing[0]['id']).conversation
 with s.db.transaction() as c:
  artifacts=c.execute('SELECT id FROM artifacts WHERE workspace_id=%s',(ws,)).fetchall()
 assert len(artifacts)==1
 art=s.get_artifact(p,ws,artifacts[0]['id'])
else:
 cv=s.create_conversation(p,ws,cmd(CreateConversation,title='Publication smoke — volunteer garden',selected_source_refs=[]))
 cv,_,art=publish(ctx,b,cv)
 art=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=b))
assert s.get_artifact(p,ws,art.id).current_revision.body.model_dump(mode='json')==b
with s.db.transaction() as c:
 identity=dict(c.execute('SELECT current_database() AS database,current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone())
 assert not identity['rolsuper'] and not identity['rolbypassrls']
 migrations=[dict(x) for x in c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall()]
 provider_attempts=c.execute('SELECT count(*) AS n FROM provider_attempts').fetchone()['n']
 assert provider_attempts==0
out={'workspace':ws,'conversation':cv.id,'artifact':art.id,'revision':art.current_revision_id,'body_hash':art.current_revision.body_hash,'body':b,'identity':identity,'migrations':migrations,'provider_attempts':provider_attempts,'mode':'controlled synthetic transport only; no paid authority, worker or provider calls'}
(OUT/'fixture.json').write_text(json.dumps(out,indent=2,default=str)+'\n')
print(json.dumps({k:out[k] for k in ['workspace','conversation','artifact','provider_attempts','mode']}))
