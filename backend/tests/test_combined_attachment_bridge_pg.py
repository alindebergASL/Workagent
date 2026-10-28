"""B3.1c ordinary attachments enter the existing exact-file substrate, not a data handler."""
from hashlib import sha256
from test_domain import context, cmd, raises
from test_conversations import conversation
from test_memory_parent_worker import activated
from workagent.models import PostMessage
from workagent.service import Service, Principal
from workagent.db import Database


def test_opted_in_attachment_bridge_exact_idempotent_and_private(context):
    s,p,ws,_,admin=context; cv=conversation(context); activated(context,cv)
    content='record_id,elapsed_minutes\r\nr1,1.25\r\nr1,1.25\r\n'
    command=cmd(PostMessage,expected_work_version=cv.work_version,text='Analyze this duration dataset',
                attachments=[dict(filename='observations.csv',mime_type='text/csv',content=content)])
    queued=s.post_message(p,ws,cv.id,command)
    files=s.list_workspace_files(p,ws,cv.id).items
    assert len(files)==1
    f=files[0]; assert f.storage=='source_snapshot' and not f.editable
    assert f.filename=='observations.csv' and f.current.sha256==sha256(content.encode()).hexdigest()
    got=s.read_workspace_file(p,ws,f.workspace_file_id,f.current.version_id,f.current.sha256)
    assert got.text==content
    snap=s.get_source_snapshot(p,ws,got.source_snapshot_id)
    assert snap.locator.message_id==queued.message.id and snap.locator.ref==queued.message.attachments[0].ref
    assert s.post_message(p,ws,cv.id,command)==queued
    assert Service(s.db).list_workspace_files(p,ws,cv.id).items==files
    other=Principal('b31c-other')
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'editor')",(ws,other.id))
    raises('not_found_or_not_authorized',lambda:s.list_workspace_files(other,ws,cv.id))
    raises('not_found_or_not_authorized',lambda:s.read_workspace_file(other,ws,f.workspace_file_id,f.current.version_id,f.current.sha256))
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM tool_grants WHERE workspace_id=%s',(ws,)).fetchone()
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE workspace_id=%s',(ws,)).fetchone()


def test_old_profile_does_not_silently_create_files(context):
    from test_general_alpha_runtime import activate
    s,p,ws,_,_=context; cv=conversation(context); activate(context,cv)
    s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='retain',
      attachments=[dict(filename='evidence.txt',mime_type='text/plain',content='inert text')]))
    assert not s.list_workspace_files(p,ws,cv.id).items
