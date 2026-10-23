"""Home's bounded projection against real disposable PostgreSQL, no providers."""
from contextlib import contextmanager
from datetime import datetime, timezone
import secrets

import pytest
from fastapi.testclient import TestClient

from test_domain import context, cmd, raises, ready
from test_conversations import conversation
from test_flexible_work import publish, table
from workagent.api import Settings, create_app
from workagent.db import Database
from workagent.fixture import seed
from workagent.home_work_summary import read
from workagent.models import (Body, Block, Revision, Proposal, HumanSave,
    DismissProposal, AcceptProposal, CancelConversation, new_id)
from workagent.service import Principal, encoded, digest


AT = datetime(2026, 10, 19, tzinfo=timezone.utc)


def artifact(ctx, cv, aid=None, dependencies=None):
    """Administrative synthetic records; canonical FK/current-revision binding."""
    s,p,ws,_,admin = ctx
    aid = aid or new_id()
    body = Body(title='Recognizable saved work', blocks=[Block(
        block_id='private', kind='paragraph', text='PRIVATE_BODY_NOT_FOR_HOME')])
    rev = Revision(id=new_id(), artifact_id=aid, revision_number=1,
        parent_revision_id=None, author_id=p.id, author_kind='human', body=body,
        body_hash=digest(body), source_dependencies=dependencies or [], created_at=AT)
    with Database(admin).transaction() as c:
        c.execute('INSERT INTO artifacts(workspace_id,id,conversation_id,current_revision_id) VALUES (%s,%s,%s,%s)',
            (ws,aid,cv.id,rev.id))
        c.execute('INSERT INTO revisions(workspace_id,artifact_id,id,revision_number,parent_revision_id,data) VALUES (%s,%s,%s,1,NULL,%s)',
            (ws,aid,rev.id,encoded(rev)))
    return aid,rev


def proposal(ctx, cv, aid, rev, pid, *, status='pending', dependencies=None):
    _,_,ws,_,admin = ctx
    pr = Proposal(id=pid, workspace_id=ws, conversation_id=cv.id,
        artifact_id=aid, base_revision_id=rev.id, base_work_version=cv.work_version,
        body=rev.body, body_hash=rev.body_hash, source_dependencies=dependencies or [],
        reason='PRIVATE_PROPOSAL_REASON', status=status, created_at=AT)
    with Database(admin).transaction() as c:
        c.execute('INSERT INTO proposals(workspace_id,id,artifact_id,base_revision_id,data) VALUES (%s,%s,%s,%s,%s)',
            (ws,pid,aid,rev.id,encoded(pr)))
    return pr


def test_empty_http_auth_and_bounds(context):
    s,p,ws,_,_ = context
    cv = conversation(context)
    settings = Settings(s.db.dsn,True,secrets.token_urlsafe(32),p.id)
    headers = {'Authorization':'Bearer '+settings.local_bearer,
        'X-Schema-Version':'workagent/v1','X-Request-Id':'home-summary'}
    with TestClient(create_app(settings)) as client:
        path = f'/v1/workspaces/{ws}/conversation-work'
        assert client.get(path).status_code == 401
        result = client.get(path,headers=headers)
        assert result.status_code == 200
        assert result.json() == {'items':[], 'next_cursor':None, 'has_more':False}
        assert result.headers['cache-control'] == 'no-store'
        for query in ['?limit=0','?limit=101','?cursor=bad%2Fcursor']:
            assert client.get(path+query,headers=headers).status_code == 422
        assert client.get('/v1/workspaces/missing/conversation-work',headers=headers).status_code == 404
        aid,_ = artifact(context,cv)
        result = client.get(path,headers=headers)
        assert result.status_code == 200 and result.json()['items'][0]['artifact_id'] == aid
        assert 'PRIVATE_BODY' not in result.text


def test_human_current_pending_stale_and_resolution(context):
    s,p,ws,_,_ = context
    cv,_,art = publish(context,table())
    initial = read(s,p,ws).items[0]
    assert initial.kind == 'structured_table' and initial.author_kind == 'worker'
    human_body = art.current_revision.body.model_copy(update={'title':'Human title retained'})
    saved = s.human_save(p,ws,art.id,cmd(HumanSave,
        expected_current_revision_id=art.current_revision_id,body=human_body))
    cv,_,_ = publish(context,table(),cv,artifact_id=art.id,base_revision_id=saved.current_revision_id)
    pending = s.proposals(p,ws,art.id).items[0]
    current = read(s,p,ws).items[0]
    assert current.revision_id == saved.current_revision_id and current.revision_number == 2
    assert current.title == 'Human title retained' and current.author_kind == 'human'
    assert current.author_id == p.id
    assert current.decision.proposal_id == pending.id and current.decision.fresh
    assert current.conversation_work_version == cv.work_version
    assert current.conversation_updated_at == s.get_conversation(p,ws,cv.id).conversation.updated_at
    edited = s.human_save(p,ws,art.id,cmd(HumanSave,
        expected_current_revision_id=saved.current_revision_id,body=human_body))
    assert not read(s,p,ws).items[0].decision.fresh
    assert read(s,p,ws).items[0].revision_id == edited.current_revision_id
    s.dismiss_proposal(p,ws,pending.id,cmd(DismissProposal,
        expected_current_revision_id=edited.current_revision_id,resolution='keep_current'))
    assert read(s,p,ws).items[0].decision is None
    cv,_,_ = publish(context,table(),cv,artifact_id=art.id,base_revision_id=edited.current_revision_id)
    # The list order is by ID, so select the actual pending record.
    pending = next(pr for pr in s.proposals(p,ws,art.id).items if pr.status == 'pending')
    accepted = s.accept_proposal(p,ws,pending.id,cmd(AcceptProposal,
        expected_current_revision_id=edited.current_revision_id,acknowledge_removed_content=True))
    result = read(s,p,ws).items[0]
    assert result.decision is None and result.revision_id == accepted.current_revision_id
    s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=cv.work_version))
    assert read(s,p,ws).items[0].conversation_state == 'cancelled'


def test_canonical_workspace_and_conversation_ownership(context):
    s,p,ws,_,admin = context
    cv = conversation(context)
    aid,rev = artifact(context,cv)
    ready(context)  # Assignment-owned products must not enter this feed.
    other_ws = 'test-'+new_id()
    seed(admin,[],other_ws,'other-person')
    other = (s,Principal('other-person'),other_ws,[],admin)
    other_cv = conversation(other)
    other_aid,_ = artifact(other,other_cv,aid=aid)  # Same ID in another workspace.
    assert [i.artifact_id for i in read(s,p,ws).items] == [aid]
    assert read(s,p,ws).items[0].conversation_id == cv.id
    raises('not_found_or_not_authorized',lambda:read(s,p,other_ws))
    raises('not_found_or_not_authorized',lambda:read(s,Principal('stranger'),ws))
    # Membership, not creator-only filtering, is the canonical read boundary.
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,'viewer','viewer')",(ws,))
    assert read(s,Principal('viewer'),ws).items[0].artifact_id == aid
    with Database(admin).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    raises('not_found_or_not_authorized',lambda:read(s,p,ws))


def test_source_access_and_dependency_isolation(context):
    s,p,ws,refs,admin = context
    cv = conversation(context,refs[:1])
    aid,rev = artifact(context,cv,dependencies=refs[:1])
    visible_cv = conversation(context)
    visible,visible_rev = artifact(context,visible_cv)
    artifact(context,visible_cv,dependencies=refs[:1])  # Not selected by this owner.
    proposal(context,visible_cv,visible,visible_rev,'private-proposal',dependencies=refs[:1])
    assert {i.artifact_id for i in read(s,p,ws).items} == {aid,visible}
    assert next(i for i in read(s,p,ws).items if i.artifact_id==visible).decision is None
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    page = read(s,p,ws,limit=1)
    assert [i.artifact_id for i in page.items] == [visible]
    assert not page.has_more and page.next_cursor is None
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=true WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
        c.execute("UPDATE sources SET data=jsonb_set(data,'{available}','false') WHERE workspace_id=%s AND id=%s",(ws,refs[0].source_id))
    assert [i.artifact_id for i in read(s,p,ws).items] == [visible]


def test_deterministic_pagination_and_latest_pending_no_bodies(context):
    s,p,ws,_,_ = context
    cv = conversation(context)
    for aid in ['c','a','b']:
        artifact(context,cv,aid=aid)
    page = read(s,p,ws,limit=2)
    assert [i.artifact_id for i in page.items] == ['a','b']
    assert page.has_more and page.next_cursor == 'b'
    final = read(s,p,ws,cursor=page.next_cursor,limit=2)
    assert [i.artifact_id for i in final.items] == ['c']
    assert not final.has_more and final.next_cursor is None
    assert read(s,p,ws,cursor='z',limit=2).items == []
    aid,rev = artifact(context,cv,aid='d')
    proposal(context,cv,aid,rev,'proposal-a')
    proposal(context,cv,aid,rev,'proposal-b')  # Timestamp tie resolves by ID DESC.
    proposal(context,cv,aid,rev,'proposal-z',status='dismissed')
    item = read(s,p,ws,cursor='c',limit=1).items[0]
    assert item.kind == 'document' and item.decision.proposal_id == 'proposal-b'
    assert item.updated_at == rev.created_at
    payload = item.model_dump_json()
    assert 'PRIVATE_' not in payload and 'source_dependencies' not in payload
    assert 'body' not in payload and 'outcome' not in payload and 'messages' not in payload


def test_query_count_constant_for_many_artifacts(context,monkeypatch):
    s,p,ws,_,_ = context
    cv = conversation(context)
    original = s.db.transaction
    statements = []
    class Counted:
        def __init__(self,c): self.c = c
        def execute(self,sql,params=None):
            statements.append(sql)
            return self.c.execute(sql,params)
    @contextmanager
    def counted():
        with original() as c:
            yield Counted(c)
    def forbidden(*args,**kwargs):
        raise AssertionError('per-item detail expansion')
    for name in ['get_conversation','get_artifact','proposals','_conversation','_revision']:
        monkeypatch.setattr(s,name,forbidden)
    monkeypatch.setattr(s.db,'transaction',counted)
    for total in [0,1,101]:
        if total == 1:
            artifact(context,cv,aid='item-000')
        elif total == 101:
            for i in range(1,101): artifact(context,cv,aid=f'item-{i:03}')
        statements.clear()
        page = read(s,p,ws)
        assert len(statements) == 3
        assert len(page.items) == min(total,100)
        assert page.has_more == (total > 100)
    final = read(s,p,ws,cursor=page.next_cursor)
    assert len(final.items) == 1 and not final.has_more
