"""Synthetic UI records; no live model or consent account is installed."""
import json,sys
from pathlib import Path
from datetime import timedelta
from uuid import uuid4
from test_domain import context,cmd
from test_conversations import conversation
from test_memory_pg import remember
from workagent.memory.models import MemorySource
from workagent.models import now
from workagent.db import Database
from workagent.workspace_file_models import CreateWorkspaceFile,WorkingText
root=Path.cwd();base=root/'.local/batch3/b35a';records=[]
for label in ['web1440','web390','web320','pty120','pty80']:
 ctx=context.__wrapped__();s,p,ws,refs,admin=ctx;cv=conversation(ctx)
 m,_=remember(ctx,cv,content='Use concise synthetic headings '+label)
 rev,_=remember(ctx,cv,subject_key='revocable',content='Revocable synthetic context '+label,source_refs=[MemorySource(ref=refs[0])])
 body=WorkingText(kind='text',filename='human-notes-'+label+'.txt',mime_type='text/plain',content='Protected human notes '+label,sha256=__import__('hashlib').sha256(('Protected human notes '+label).encode()).hexdigest())
 human=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,expected_work_version=cv.work_version,source=body))
 cid=str(uuid4())
 with Database(admin).transaction() as c:
  c.execute("INSERT INTO connector_accounts(workspace_id,id,principal_id,state,expires_at,credential_ref) VALUES (%s,%s,%s,'connected',%s,%s)",(ws,cid,p.id,now()+timedelta(hours=4),'synthetic-unavailable-vault-'+cid))
 records.append(dict(label=label,workspace_id=ws,conversation_id=cv.id,memory_id=m.memory_id,revision_id=m.revision_id,revocable_memory_id=rev.memory_id,source_id=refs[0].source_id,connector_id=cid,human_file=human.model_dump(mode='json')))
(base/'ui-fixture-v2.json').write_text(json.dumps(records,indent=2)+'\n')
print('Created five isolated synthetic client journeys; no provider credentials or sends')
