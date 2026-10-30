"""Real-PG exact FileBody target fences on a fresh disposable store."""
from pathlib import Path
import sys, json, uuid
from hashlib import sha256
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'evaluation'),str(ROOT/'backend')]
from verify_recipient_product import Fixture,cmd
from workagent.workspace_file_models import CreateWorkspaceFile,WorkingText
from workagent.general_responses import exact_target
from workagent.message_models import ExactTarget
from workagent.errors import DomainError

out=ROOT/'.local/batch3/b35c/file-target-negatives'/uuid.uuid4().hex
out.mkdir(parents=True,mode=0o700)
f=Fixture(out/'fixture')
file=f.service.create_workspace_file(f.principal,f.workspaces[0],f.cvs[0].id,cmd(CreateWorkspaceFile,expected_work_version=f.cvs[0].work_version,
 source=WorkingText(kind='text',filename='target.txt',mime_type='text/plain',content='Human text',sha256=sha256(b'Human text').hexdigest())))
a=f.service.get_artifact(f.principal,f.workspaces[0],file.workspace_file_id)
target=ExactTarget(artifact_id=a.id,revision_id=a.current_revision_id,body_hash=a.current_revision.body_hash)
with f.runtime.transaction() as c:
    assert exact_target(f.service,c,f.principal,f.workspaces[0],f.cvs[0],target).id==a.current_revision_id
cases=[('wrong_hash',f.workspaces[0],f.cvs[0],target.model_copy(update={'body_hash':'0'*64})),
 ('stale_revision',f.workspaces[0],f.cvs[0],target.model_copy(update={'revision_id':str(uuid.uuid4())})),
 ('wrong_conversation',f.workspaces[0],f.cvs[1],target),
 ('wrong_workspace',f.workspaces[1],f.cvs[1],target)]
rows=[]
for name,ws,cv,t in cases:
    try:
        with f.runtime.transaction() as c:exact_target(f.service,c,f.principal,ws,cv,t)
    except DomainError as e:rows.append(dict(case=name,error=e.code.value))
    else:raise AssertionError(name+' admitted')
with f.owner.transaction() as c:
    assert c.execute('SELECT count(*) n FROM responses_events').fetchone()['n']==0
summary=dict(status='PASS',positive='exact FileBody target',negatives=rows,provider_calls=0,scope='disposable real-PG fences',database=f.name)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(dict(summary,evidence=str(out.relative_to(ROOT))),indent=2));f.close()
