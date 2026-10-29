"""Retain genuine exported binaries as immutable sources for client imports."""
import base64,json,os,sys
from pathlib import Path
from hashlib import sha256
from workagent.db import Database
from workagent.service import Service,Principal
from workagent.models import IngestDocument
from workagent.workspace_file_models import CreateWorkspaceFile,DocumentEvidence
from workagent.office_sandbox import FORMATS
from test_domain import cmd
root=Path.cwd();base=root/'.local/batch3/b32b';f=json.loads((base/'fixture.json').read_text());s=Service(Database());p=Principal('local-human');out=[]
assert not (base/'import-sources.json').exists()
for lane in ('web','native'):
 cv=s.get_conversation(p,f['workspace_id'],f[lane]).conversation
 for fmt in ('docx','xlsx','pdf'):
  files=sorted((base/'evidence/outputs').glob('*.'+fmt));path=files[0];raw=path.read_bytes()
  d=s.ingest_document(p,f['workspace_id'],cv.id,cmd(IngestDocument,filename='original.'+fmt,mime_type=FORMATS[fmt][1],content_base64=base64.b64encode(raw).decode(),sha256=sha256(raw).hexdigest()))
  file=s.create_workspace_file(p,f['workspace_id'],cv.id,cmd(CreateWorkspaceFile,expected_work_version=cv.work_version,source=DocumentEvidence(kind='document',document_id=d.document_id,sha256=d.sha256)))
  out.append(dict(lane=lane,format=fmt,source_path=str(path.relative_to(root)),file=file.model_dump(mode='json')))
(base/'import-sources.json').write_text(json.dumps(out,indent=2));print('Retained',len(out),'actual binary sources')
