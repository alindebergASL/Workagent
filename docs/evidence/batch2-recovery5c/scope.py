from pathlib import Path
import sys,os,json
ROOT=Path(__file__).resolve().parents[3];sys.path[:0]=[str(ROOT/'backend'),str(ROOT/'backend/tests')]
from workagent.db import Database
from workagent.fixture import seed
from workagent.service import Service,Principal
from workagent.models import CreateConversation
from test_domain import cmd
OUT=ROOT/'docs/evidence/batch2-recovery5c';ws='recovery5c-scope';other='recovery5c-other';s=Service(Database());p=Principal('local-human')
assert '/workagent_test_' in os.environ['DATABASE_URL']
def save(name,data):
 with (OUT/(name+'.json')).open('x') as f:json.dump(data,f,indent=2,default=str)
if sys.argv[1]=='seed':
 assert not (OUT/'scope-fixture.json').exists()
 # Prior failed member-role insert rolled back; preserve its task-owned empty workspace.
 with s.db.transaction() as c:exists=c.execute('SELECT id FROM workspaces WHERE id=%s',(ws,)).fetchone()
 if not exists:seed(os.environ['MIGRATION_DATABASE_URL'],[],ws,p.id)
 with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'owner')",(ws,other))
 a=s.create_conversation(p,ws,cmd(CreateConversation,title='Scope A synthetic draft',selected_source_refs=[]))
 b=s.create_conversation(p,ws,cmd(CreateConversation,title='Scope B no draft',selected_source_refs=[]))
 assert s.get_conversation(Principal(other),ws,a.id).conversation.id==a.id
 save('scope-fixture',{'workspace':ws,'principal_a':p.id,'principal_b':other,'conversation':a.id,'other_conversation':b.id,'authorization':'Both disposable synthetic principals may read the shared conversation; unsent local drafts/bytes must remain principal-private.'})
elif sys.argv[1]=='revoke':
 with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:
  before=c.execute('SELECT to_jsonb(t) value FROM memberships t WHERE workspace_id=%s',(ws,)).fetchall()
  c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
  after=c.execute('SELECT to_jsonb(t) value FROM memberships t WHERE workspace_id=%s',(ws,)).fetchall()
 save('scope-revoked',{'before':before,'after':after})
elif sys.argv[1]=='api':
 import uvicorn
 from workagent.api import create_app,Settings
 app=create_app(Settings(os.environ['DATABASE_URL'],True,os.environ['LOCAL_BEARER_TOKEN'],other,fixture_mode=True))
 uvicorn.run(app,host='127.0.0.1',port=18966,log_level='warning')
