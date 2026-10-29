"""Actual restricted-PG imported-office BOM revision and proposal persistence."""
import json
from hashlib import sha256
from test_domain import context,cmd,raises
from test_office_pg import imported
from workagent.workspace_file_models import EditWorkspaceFile,ProposeFilePatch,ExportFile
from workagent.db import Database,migrate


def test_bom_imported_revision_proposal_and_export(context,monkeypatch):
    s,p,ws,_,owner=context
    s.db.check_runtime_role()
    cv,original,draft,detail,raw=imported(context,monkeypatch)
    value={'office_version':'office-v1','kind':'document','paragraphs':['Exact BOM human quotation “unchanged”.'],'annotations':['BOM annotation retained']}
    content='\ufeff'+json.dumps(value,ensure_ascii=False);digest=sha256(content.encode()).hexdigest()
    saved=s.edit_workspace_file(p,ws,draft.workspace_file_id,cmd(EditWorkspaceFile,expected_work_version=cv.work_version,base_version_id=draft.current.version_id,base_sha256=draft.current.sha256,content=content,sha256=digest))
    read=s.read_workspace_file(p,ws,saved.workspace_file_id,saved.current.version_id,saved.current.sha256,limit=8192)
    assert read.text==content and saved.current.sha256==digest
    proposal=s.propose_file_patch(p,ws,saved.workspace_file_id,cmd(ProposeFilePatch,expected_work_version=cv.work_version,base_version_id=saved.current.version_id,base_sha256=saved.current.sha256,content=content,sha256=digest,reason='BOM-preserving correction'))
    with s.db.transaction() as c:
        row=c.execute('SELECT data FROM proposals WHERE workspace_id=%s AND artifact_id=%s',(ws,saved.workspace_file_id)).fetchone()
        assert row['data']['body']['content']==content and row['data']['body']['content_sha256']==digest
        before=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
    migrate(owner);migrate(owner)
    with s.db.transaction() as c:
        assert c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()==before
    assert s.read_workspace_file(p,ws,saved.workspace_file_id,saved.current.version_id,digest,limit=8192).text==content
    exported=s.export_workspace_file(p,ws,saved.workspace_file_id,cmd(ExportFile,version_id=saved.current.version_id,sha256=digest,format='docx'))
    from docx import Document
    import io
    output=s.download_export(p,ws,exported.export_id)[1]
    text='\n'.join(p.text for p in Document(io.BytesIO(output)).paragraphs)
    assert 'Exact BOM human quotation “unchanged”.' in text and 'BOM annotation retained' in text
    assert s.download_document(p,ws,cv.id,detail.document_id)[1]==raw
    invalid='\ufeff{"office_version":"office-v1","kind":"document","paragraphs":42,"annotations":[]}'
    raises('validation_error',lambda:s.edit_workspace_file(p,ws,saved.workspace_file_id,cmd(EditWorkspaceFile,expected_work_version=cv.work_version,base_version_id=saved.current.version_id,base_sha256=digest,content=invalid,sha256=sha256(invalid.encode()).hexdigest())))
