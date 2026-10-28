"""Restricted-PG HTTP persistence/race/ACL evidence. Parent executes on disposable DB."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import secrets
import pytest
from fastapi.testclient import TestClient
from test_domain import context, cmd, raises
from workagent.api import create_app, Settings
from workagent.models import CreateConversation, PostMessage, new_id, HumanSave
from workagent.workspace_file_models import (CreateWorkspaceFile, WorkingText, EditWorkspaceFile,
    ProposeFilePatch, AcceptFileProposal, ExportFile, AttachmentEvidence)
from workagent.service import Service, Principal
from workagent.db import Database
from workagent.errors import DomainError


def text(value, filename='sample.txt', mime='text/plain'):
    return WorkingText(filename=filename, mime_type=mime, content=value, sha256=sha256(value.encode()).hexdigest())


def make(context, value='\ufeffα😀\r\nHuman note\r\n'):
    s,p,ws,_,_=context
    cv=s.create_conversation(p,ws,cmd(CreateConversation,selected_source_refs=[]))
    command=cmd(CreateWorkspaceFile,expected_work_version=cv.work_version,source=text(value))
    file=s.create_workspace_file(p,ws,cv.id,command)
    return cv,file,command


def test_http_create_range_edit_export_digest_restart(context):
    s,p,ws,_,_=context
    token=secrets.token_urlsafe(32)
    settings=Settings(s.db.dsn,True,token,p.id)
    headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':new_id()}
    prefix=f'/v1/workspaces/{ws}'
    content='\ufeffα😀\r\nHuman note\r\n'
    with TestClient(create_app(settings)) as client:
        response=client.post(prefix+'/conversations',headers=headers,json=cmd(CreateConversation,selected_source_refs=[]).model_dump(mode='json'))
        assert response.status_code==201,response.text
        cv=response.json()
        command=cmd(CreateWorkspaceFile,expected_work_version=cv['work_version'],source=text(content))
        route=prefix+f'/work-areas/{cv["id"]}/files'
        response=client.post(route,headers=headers,json=command.model_dump(mode='json'))
        assert response.status_code==201,response.text
        file=response.json();ref=file['current'];fid=file['workspace_file_id']
        assert client.post(route,headers=headers,json=command.model_dump(mode='json')).json()==file
        page=client.get(route,headers=headers).json()
        assert len(page['items'])==1
        path=prefix+f'/files/{fid}/versions/{ref["version_id"]}'
        response=client.get(path,headers=headers,params={'sha256':ref['sha256'],'offset':3,'limit':6})
        assert response.status_code==200,response.text
        assert response.json()['text']=='α😀'
        export=cmd(ExportFile,version_id=ref['version_id'],sha256=ref['sha256'],format='txt')
        response=client.post(prefix+f'/files/{fid}/exports',headers=headers,json=export.model_dump(mode='json'))
        assert response.status_code==201,response.text
        manifest=response.json();download=prefix+f'/exports/{manifest["export_id"]}/download'
        response=client.get(download,headers=headers)
        assert response.content==content.encode() and response.headers['x-content-sha256']==sha256(response.content).hexdigest()
        assert response.headers['x-content-type-options']=='nosniff'
        assert response.headers['content-disposition'].startswith('attachment;')
        changed=content+'Saved human amendment\r\n'
        edit=cmd(EditWorkspaceFile,expected_work_version=cv['work_version'],base_version_id=ref['version_id'],
                 base_sha256=ref['sha256'],content=changed,sha256=sha256(changed.encode()).hexdigest())
        response=client.post(prefix+f'/files/{fid}/versions',headers=headers,json=edit.model_dump(mode='json'))
        assert response.status_code==201,response.text
        assert response.json()['current']['version_id']!=ref['version_id']
        assert client.get(path,headers=headers,params={'sha256':ref['sha256']}).json()['text']==content
    # A new service/app instance reads retained originals/exports; no resupply.
    with TestClient(create_app(settings)) as restarted:
        assert restarted.get(download,headers=headers).content==content.encode()
        assert restarted.get(path,headers=headers,params={'sha256':ref['sha256']}).json()['text']==content


def test_cross_workspace_owner_ids_counts_and_artifact_alias_denied(context):
    s,p,ws,_,admin=context;cv,file,_=make(context)
    other=Principal('other-'+new_id())
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'editor')",(ws,other.id))
    ref=file.current
    for actor,space in [(other,ws),(p,'absent-'+ws)]:
        raises('not_found_or_not_authorized',lambda:s.list_workspace_files(actor,space,cv.id))
        raises('not_found_or_not_authorized',lambda:s.read_workspace_file(actor,space,file.workspace_file_id,ref.version_id,ref.sha256))
        raises('not_found_or_not_authorized',lambda:s.get_artifact(actor,space,file.workspace_file_id))
    export=s.export_workspace_file(p,ws,file.workspace_file_id,cmd(ExportFile,version_id=ref.version_id,sha256=ref.sha256,format='txt'))
    raises('not_found_or_not_authorized',lambda:s.download_export(other,ws,export.export_id))


def test_exact_hash_edit_race_pending_proposal_and_acceptance(context):
    s,p,ws,_,_=context;cv,file,_=make(context);ref=file.current;fid=file.workspace_file_id
    proposal=s.propose_file_patch(p,ws,fid,cmd(ProposeFilePatch,expected_work_version=cv.work_version,
        base_version_id=ref.version_id,base_sha256=ref.sha256,content='Proposed',sha256=sha256(b'Proposed').hexdigest(),reason='review'))
    assert s.get_artifact(p,ws,fid).current_revision_id==ref.version_id
    def save(value, base_hash=ref.sha256):
        return s.edit_workspace_file(p,ws,fid,cmd(EditWorkspaceFile,expected_work_version=cv.work_version,
            base_version_id=ref.version_id,base_sha256=base_hash,content=value,sha256=sha256(value.encode()).hexdigest()))
    raises('source_changed',lambda:save('wrong hash','0'*64))
    def race(value):
        try:return save(value)
        except DomainError as exc:return exc.code.value
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(race,['Human A','Human B']))
    assert results.count('version_conflict')==1
    current=s.get_artifact(p,ws,fid).current_revision
    raises('version_conflict',lambda:s.accept_file_proposal(p,ws,fid,proposal.id,cmd(AcceptFileProposal,
        expected_current_revision_id=current.id,expected_sha256=current.body.content_sha256,acknowledge_removed_content=True)))
    assert s.proposals(p,ws,fid).items[0].status=='pending'
    fresh=s.propose_file_patch(p,ws,fid,cmd(ProposeFilePatch,expected_work_version=cv.work_version,
        base_version_id=current.id,base_sha256=current.body.content_sha256,content='Reviewed human choice',
        sha256=sha256(b'Reviewed human choice').hexdigest(),reason='review again'))
    accepted=s.accept_file_proposal(p,ws,fid,fresh.id,cmd(AcceptFileProposal,
        expected_current_revision_id=current.id,expected_sha256=current.body.content_sha256,acknowledge_removed_content=True))
    assert accepted.current.version_id!=current.id
    assert s.get_artifact(p,ws,fid).current_revision.author_kind=='human'
    compare=s.compare_workspace_files(p,ws,fid,ref.version_id,ref.sha256,accepted.current.version_id,accepted.current.sha256)
    assert not compare.identical and 'Reviewed human choice' in compare.diff


def test_source_refresh_retains_original_attachment_versions_after_restart(context):
    s,p,ws,_,_=context
    cv=s.create_conversation(p,ws,cmd(CreateConversation,selected_source_refs=[]))
    from test_b24_runtime_pg import activate
    activate(context,cv)  # Synthetic installed authority only; no dispatcher/provider call.
    queued=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Retain evidence',
        attachments=[{'filename':'original.txt','mime_type':'text/plain','content':'\ufeffOld α\r\n'},
                     {'filename':'refreshed.txt','mime_type':'text/plain','content':'\ufeffNew β\r\n'}]))
    messages=s.get_conversation(p,ws,cv.id).messages
    message=next(m for m in messages if m.author_kind=='human');a=message.attachments[0]
    first=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,expected_work_version=queued.conversation.work_version,
        source=AttachmentEvidence(kind='attachment',message_id=message.id,ref=a.ref,sha256=a.sha256)))
    # Refresh from a distinct retained original, preserving both immutable versions.
    newer=message.attachments[1]
    refreshed=s.create_workspace_file(p,ws,cv.id,cmd(CreateWorkspaceFile,expected_work_version=queued.conversation.work_version,
        source=AttachmentEvidence(kind='attachment',message_id=message.id,ref=newer.ref,sha256=newer.sha256),
        refresh_workspace_file_id=first.workspace_file_id,expected_version_id=first.current.version_id))
    assert refreshed.current.version_id!=first.current.version_id
    restarted=Service(Database(s.db.dsn))
    old=restarted.get_source_snapshot(p,ws,first.current.version_id)
    new=restarted.get_source_snapshot(p,ws,refreshed.current.version_id)
    assert new.parent_snapshot_id==old.snapshot_id and new.version_number==2 and old.locator!=new.locator
    assert restarted.read_workspace_file(p,ws,first.workspace_file_id,old.snapshot_id,old.extraction_sha256).text==a.content
    assert restarted.get_conversation(p,ws,cv.id).messages[0].attachments[0]==a
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM source_snapshots WHERE workspace_id=%s',(ws,)).fetchone()['n']==2
        assert c.execute('SELECT count(*) AS n FROM revisions WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
