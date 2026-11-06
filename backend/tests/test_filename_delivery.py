"""In-process HTTP/service controls with SQL doubles; not PG authorization proof."""
from contextlib import contextmanager
from hashlib import sha256
from types import SimpleNamespace as NS
import json
import socket
import pytest
from pydantic import TypeAdapter, ValidationError
from workagent.service import Service, Principal, digest
from workagent.models import Revision, Proposal, SourceRef, now
from workagent.errors import DomainError
from workagent.workspace_files import text_body, native_download
from workagent.workspace_file_models import ExportManifest, ExportFilename
from workagent.artifact_exports import export_filename

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr(socket.socket,'connect',lambda *a,**k:pytest.fail('no DB/network in offline tests'))

def body(text):return text_body(text,sha256(text.encode()).hexdigest(),'text/plain')

class Connection:
    def __init__(self):
        self.calls=[];self.member=True;self.native=True;self.owner='human';self.visible=True
        self.filename='meeting-notes.md';self.mime='text/markdown'
        self.revisions={n:Revision(id=n,artifact_id='file',revision_number=i,parent_revision_id=None,
          author_id='human',author_kind='human',body=body(text),body_hash=digest(body(text)),source_dependencies=[])
          for i,(n,text) in enumerate([('old','\ufeffOld\r\n'),('current','Current\n')],1)}
        self.proposal=Proposal(id='proposal',workspace_id='ws',conversation_id='cv',artifact_id='file',base_revision_id='old',
          base_work_version=1,body=body('Proposed\n'),body_hash=digest(body('Proposed\n')),source_dependencies=[],reason='edit')
        self.artifact=dict(id='file',workspace_id='ws',conversation_id='cv',current_revision_id='current')
    def execute(self,sql,args=()):
        self.calls.append((sql,args));value=None
        if sql.startswith('SELECT * FROM workspaces'):value={'access_generation':1} if args[0]=='ws' else None
        elif sql.startswith('SELECT * FROM memberships'):value={'active':self.member,'role':'editor'}
        elif sql.startswith('SELECT * FROM artifacts'):value=self.artifact if args==('ws','file') else None
        elif sql.startswith('SELECT owner_id,office_source_snapshot_id'):value={'owner_id':self.owner,'office_source_snapshot_id':None} if self.native else None
        elif sql.startswith('SELECT memory_'):value={'ok':self.visible}
        elif sql.startswith('SELECT data FROM revisions'):value={'data':self.revisions[args[2]].model_dump(mode='json')} if args[2] in self.revisions else None
        elif sql.startswith('SELECT data FROM proposals'):value={'data':self.proposal.model_dump(mode='json')}
        elif sql.startswith('SELECT id FROM workspace_files'):value={'id':'file'} if self.native else None
        elif sql.startswith('SELECT * FROM workspace_files'):
            if self.owner==args[2]:value=dict(id='file',workspace_id='ws',conversation_id='cv',artifact_id='file',filename=self.filename,mime_type=self.mime)
        elif sql.startswith('SELECT active FROM source_access'):value={'active':False}
        elif sql.startswith('SELECT * FROM sources'):value={'data':{}}
        elif sql.startswith('INSERT '):pass
        else:raise AssertionError(sql)
        return NS(fetchone=lambda:value)

class DB:
    def __init__(self,c):self.c=c
    @contextmanager
    def transaction(self):yield self.c
    def check_runtime_role(self):pass

@pytest.fixture
def service():
    c=Connection();s=Service(DB(c))
    s._conversation=lambda *args:NS(id='cv',owner_id='human',selected_source_refs=[])
    return s,c,Principal('human')

@pytest.mark.parametrize('which,expected',[({},'Current\n'),({'revision_id':'old'},'\ufeffOld\r\n'),({'proposal_id':'proposal'},'Proposed\n')])
def test_exact_download_authorized_version_or_proposal(service,which,expected):
    s,c,p=service;before=[r.model_dump(mode='json') for r in c.revisions.values()]
    out=s.download_product(p,'ws','file',**which)
    assert (out.filename,out.mime_type,out.content)==('meeting-notes.md','text/markdown',expected)
    assert out.content_sha256==sha256(expected.encode()).hexdigest()
    assert before==[r.model_dump(mode='json') for r in c.revisions.values()]
    assert all(not sql.startswith('INSERT') for sql,_ in c.calls)
    if 'revision_id' in which:
        assert [args[2] for sql,args in c.calls if sql.startswith('SELECT memory_revision_visible')]==['current','old']
    if 'proposal_id' in which:assert any(sql.startswith('SELECT memory_proposal_visible') for sql,_ in c.calls)

@pytest.mark.parametrize('damage',['membership','scope','owner','revision_visibility','proposal_visibility','dependency','foreign_proposal','both_ids','missing_revision'])
def test_denied_authority_or_identity_never_returns_metadata(service,damage):
    s,c,p=service;ws='ws';args={}
    if damage=='membership':c.member=False
    if damage=='scope':ws='other'
    if damage=='owner':c.owner='other'
    if damage in ('revision_visibility','proposal_visibility'):c.visible=False
    if damage=='proposal_visibility':args={'proposal_id':'proposal'}
    if damage=='dependency':
        ref=SourceRef(source_id='source',external_version='v1',observed_at=now())
        c.revisions['current'].source_dependencies=[ref]
        s._conversation=lambda *a:NS(id='cv',owner_id='human',selected_source_refs=[ref])
    if damage=='foreign_proposal':c.proposal.artifact_id='other';args={'proposal_id':'proposal'}
    if damage=='both_ids':args={'revision_id':'old','proposal_id':'proposal'}
    if damage=='missing_revision':args={'revision_id':'absent'}
    with pytest.raises(DomainError):s.download_product(p,ws,'file',**args)

@pytest.mark.parametrize('name,mime',[('notes.md','text/markdown'),('notes.markdown','text/markdown'),('data.csv','text/csv'),('data.json','application/json'),('notes.txt','text/plain')])
def test_native_metadata_safe_supported_types(name,mime):
    out=native_download(body('saved bytes'),dict(filename=name,mime_type=mime))
    assert (out.filename,out.mime_type,out.content)==(name,mime,'saved bytes')

@pytest.mark.parametrize('name,mime',[('x.md\r\nX-Test: yes','text/markdown'),('../x.md','text/markdown'),('x".md','text/markdown'),('x.html','text/html'),('x.csv','text/plain'),('x.txt','text/plain\r\nX: yes')])
def test_native_metadata_unsafe_denied(name,mime):
    with pytest.raises(DomainError):native_download(body('saved bytes'),dict(filename=name,mime_type=mime))

def test_ordinary_file_stays_identical(service):
    s,c,p=service;c.native=False
    expected=c.revisions['current'].body
    assert s.download_product(p,'ws','file')==expected

@pytest.mark.parametrize('name,ext,expected',[('meeting-notes.md','csv','meeting-notes.csv'),('data.csv','md','data.md'),('Quarterly report.pdf','txt','Quarterly_report.txt'),('document.json','docx','document.docx'),('x'*100+'.txt','pdf','x'*81+'.pdf')])
def test_future_export_name(name,ext,expected):
    assert export_filename(name,ext)==expected
    TypeAdapter(ExportFilename).validate_python(expected)

@pytest.mark.parametrize('name',['a\r\nx.txt','../x.txt','a\\b.txt','\x00.txt'])
def test_export_header_or_path_injection_denied(name):
    with pytest.raises(DomainError):export_filename(name,'txt')

@pytest.mark.parametrize('native',[True,False])
def test_retain_future_export_only_changes_name_not_bytes(service,native):
    s,c,p=service;c.native=native;s._event=lambda *a:None;raw=b'\xef\xbb\xbfRetained\r\n'
    result=s._retain_export(c,p,'ws',conversation_id='cv',artifact_id='file',revision_id='old',input_hash='a'*64,
      file_id='file' if native else None,snapshot_id=None,format='markdown',raw=raw,annotations='not_present',omissions=[])
    assert result.filename==('meeting-notes.md' if native else 'export.md')
    assert result.blob.sha256==sha256(raw).hexdigest()
    assert next(args[-1] for sql,args in c.calls if sql.startswith('INSERT INTO generated_blobs'))==raw
    old=result.model_dump(mode='json');old['filename']='export.md'
    assert ExportManifest.model_validate(old).model_dump(mode='json')==old

def test_real_http_endpoint_uses_delivery_headers_and_exact_historical_bytes(service,monkeypatch):
    import workagent.api as api
    s,c,p=service
    monkeypatch.setattr(api,'Service',lambda *a,**kw:s)
    app=api.create_app(api.Settings('unused',True,'local-test-token',p.id))
    endpoint=next(r.endpoint for r in app.routes if r.path=='/v1/workspaces/{workspace_id}/artifacts/{artifact_id}/download')
    r=endpoint('ws','file',p,None,revision_id='old',proposal_id=None)
    assert r.status_code==200
    assert r.body=='\ufeffOld\r\n'.encode()
    assert r.headers['content-disposition']=='attachment; filename="meeting-notes.md"'
    assert r.headers['content-type'].startswith('text/markdown')
    assert r.headers['x-content-type-options']=='nosniff'
    assert r.headers['x-content-sha256']==sha256(r.body).hexdigest()

def test_ordinary_table_delivery_unchanged(service):
    from workagent.product_models import TableBody
    s,c,p=service;c.native=False
    table=TableBody(title='Saved table',source_csv='name\na\n',rounding='ROUND_HALF_UP',columns=['name'],rows=[{'name':'a'}])
    c.revisions['current'].body=table;c.revisions['current'].body_hash=digest(table)
    out=s.download_product(p,'ws','file')
    assert (out.filename,out.mime_type,out.content)==('reconciled.csv','text/csv','name\na\n')

@pytest.mark.parametrize('revoked',[False,True])
def test_existing_export_reads_original_manifest_and_rechecks_dependency(service,revoked):
    s,c,p=service;s._event=lambda *a:None
    source=c.revisions['old'].body;raw=source.content.encode()
    current=s._retain_export(c,p,'ws',conversation_id='cv',artifact_id='file',revision_id='old',
      input_hash=source.content_sha256,file_id='file',snapshot_id=None,format='markdown',raw=raw,annotations='not_present',omissions=[])
    old=current.model_dump(mode='json');old['filename']='export.md';frozen=json.dumps(old,sort_keys=True)
    original=c.execute
    def execute(sql,args=()):
        if sql.startswith('SELECT data FROM artifact_exports'):return NS(fetchone=lambda:{'data':old})
        if sql.startswith('SELECT bytes,sha256,mime_type FROM generated_blobs'):
            return NS(fetchone=lambda:dict(bytes=raw,sha256=sha256(raw).hexdigest(),mime_type='text/markdown'))
        return original(sql,args)
    c.execute=execute;c.visible=not revoked
    if revoked:
        with pytest.raises(DomainError):s.download_export(p,'ws',current.export_id)
    else:
        manifest,data=s.download_export(p,'ws',current.export_id)
        assert manifest.model_dump(mode='json')==old and data==raw
    assert frozen==json.dumps(old,sort_keys=True)
