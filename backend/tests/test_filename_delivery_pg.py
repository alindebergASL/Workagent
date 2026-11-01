from hashlib import sha256
from test_domain import context,cmd,raises
from workagent.models import CreateConversation
from workagent.workspace_file_models import CreateWorkspaceFile,WorkingText,ExportFile,EditWorkspaceFile,ProposeFilePatch

def test_named_files_exports_exact_historical_and_proposal_bytes(context):
    s,p,ws,_,_=context
    cv=s.create_conversation(p,ws,cmd(CreateConversation,selected_source_refs=[]))
    text='# Named delivery\n\nSynthetic fixture only.\n'
    f=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,expected_work_version=cv.work_version,source=WorkingText(filename='field-notes.md',mime_type='text/markdown',content=text,sha256=sha256(text.encode()).hexdigest())))
    old=f.current
    body=s.download_product(p,ws,f.workspace_file_id,revision_id=old.version_id)
    assert (body.filename,body.mime_type,body.content)==('field-notes.md','text/markdown',text)
    e=s.export_workspace_file(p,ws,f.workspace_file_id,cmd(ExportFile,version_id=old.version_id,sha256=old.sha256,format='markdown'))
    assert e.filename=='field-notes.md'
    manifest,raw=s.download_export(p,ws,e.export_id);assert raw==text.encode() and manifest==e
    revised=text+'Human revision.\n'
    current=s.edit_workspace_file(p,ws,f.workspace_file_id,cmd(EditWorkspaceFile,expected_work_version=cv.work_version,base_version_id=old.version_id,base_sha256=old.sha256,content=revised,sha256=sha256(revised.encode()).hexdigest()))
    assert s.download_product(p,ws,f.workspace_file_id).content==revised
    assert s.download_product(p,ws,f.workspace_file_id,revision_id=old.version_id).content==text
    proposal=s.propose_file_patch(p,ws,f.workspace_file_id,cmd(ProposeFilePatch,expected_work_version=cv.work_version,base_version_id=current.current.version_id,base_sha256=current.current.sha256,content='Proposed only',sha256=sha256(b'Proposed only').hexdigest(),reason='Synthetic review'))
    proposed=s.download_product(p,ws,f.workspace_file_id,proposal_id=proposal.id)
    assert proposed.filename=='field-notes.md' and proposed.content=='Proposed only'
    assert s.download_product(p,ws,f.workspace_file_id).content==revised
    assert s.download_export(p,ws,e.export_id)[1]==text.encode()
