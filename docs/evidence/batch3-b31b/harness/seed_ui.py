"""Isolated synthetic UI fixture; no provider execution or installed-data writes."""
import json, os
from pathlib import Path
from workagent.db import Database
from workagent.fixture import seed
from workagent.models import CreateConversation, CreateWorkArea, new_id
from workagent.service import Service, Principal
from workagent.memory.models import RememberMemory
root=Path.cwd(); out=root/'.local/batch3/b31b'
p=Principal('local-human'); ws='b31b-ui-'+new_id()
records=json.loads((root/'fixtures/actor/solo-v0.1/initial_records.json').read_text())
seed(os.environ['MIGRATION_DATABASE_URL'],records,ws,p.id)
s=Service(Database());s.db.check_runtime_role()
def cmd(cls,**kw):return cls(schema_version='workagent/v1',request_id=new_id(),command_id=new_id(),**kw)
fixture=dict(workspace_id=ws,conversations={},projects={},memories={},evidence='synthetic fixture, real restricted PostgreSQL')
for label in ['desktop','mobile','pty100','pty80']:
 area=s.create_work_area(p,ws,cmd(CreateWorkArea,title='Memory '+label,goal='Inspect scoped synthetic memory',kind='project'))
 cv=s.create_conversation(p,ws,cmd(CreateConversation,title='Later '+label))
 fixture['projects'][label]=area.id;fixture['conversations'][label]=cv.id
 if label.startswith('pty'):
  m=s.remember_memory(p,ws,cmd(RememberMemory,kind='preference',scope_kind='task',scope_id=cv.id,
    subject_key='reports',predicate_key='heading_style',content='Native concise headings '+label,
    confidence_basis='Explicit synthetic human preference'))
  fixture['memories'][label]=m.model_dump(mode='json')
(out/'ui-fixture.json').write_text(json.dumps(fixture,indent=2)+'\n')
print('Seeded isolated UI fixture',ws)
