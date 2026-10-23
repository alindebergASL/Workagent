"""Real-PG regressions for parent execution on the existing disposable fixture.

Synthetic local bodies only. No services, provider calls, or paid work.
"""
from datetime import timedelta

import psycopg
import pytest

from test_domain import context, cmd, raises
from test_conversations import conversation
from test_flexible_work import publish
from test_proposal_review import document, table
from workagent.models import AcceptProposal, DismissProposal, HumanSave, Proposal, now, new_id
from workagent.service import Principal, digest, encoded


def candidate(ctx, art, body, *, id=None, created_at=None, deps=None):
    s,p,ws,_,_=ctx
    proposal=Proposal(id=id or new_id(),workspace_id=ws,conversation_id=art.conversation_id,
        assignment_id=art.assignment_id,artifact_id=art.id,base_revision_id=art.current_revision_id,
        base_work_version=1,body=body,body_hash=digest(body),
        source_dependencies=deps or [],reason='Synthetic review candidate',created_at=created_at or now())
    # Simulate a retained pre-interface row; never add the new projection to it.
    raw=proposal.model_dump(mode='json',exclude={'review'},exclude_none=True)
    with s.db.transaction() as c:
        c.execute('INSERT INTO proposals(workspace_id,id,artifact_id,base_revision_id,data) VALUES (%s,%s,%s,%s,%s)',
                  (ws,proposal.id,art.id,art.current_revision_id,encoded(raw)))
    return proposal


def snapshot(ctx):
    s,_,ws,_,_=ctx
    with s.db.transaction() as c:
        return {name:c.execute(f'SELECT to_jsonb(t) AS value FROM {name} t WHERE workspace_id=%s ORDER BY to_jsonb(t)::text',(ws,)).fetchall()
                for name in ('artifacts','revisions','proposals','commands','audit','outbox')}


def accept(ctx, art, proposal, **flags):
    s,p,ws,_,_=ctx
    return s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=art.current_revision_id,**flags))


@pytest.mark.parametrize('make_body',[table,document])
def test_removed_human_notes_block_until_ack_without_mutation(context,make_body):
    s,p,ws,_,_=context
    _,_,art=publish(context,make_body())
    # The protected content is in an actual saved human revision.
    art=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=make_body()))
    body=make_body()
    if hasattr(body,'notes'): body.notes=[]
    else: body.blocks.pop()
    prop=candidate(context,art,body)
    original=snapshot(context)
    review=s.proposals(p,ws,art.id).items[0].review
    assert review.is_latest and review.latest_pending_proposal_id==prop.id
    assert review.removed_content_count>0
    assert snapshot(context)==original
    raises('review_required',lambda:accept(context,art,prop))
    assert snapshot(context)==original
    result=accept(context,art,prop,acknowledge_removed_content=True)
    assert result.current_revision.body==body
    with s.db.transaction() as c:
        raw=c.execute('SELECT data FROM proposals WHERE workspace_id=%s AND id=%s',(ws,prop.id)).fetchone()['data']
    old=original['proposals'][0]['value']['data']
    assert {k:v for k,v in raw.items() if k not in ('status','accepted_revision_id')}=={k:v for k,v in old.items() if k not in ('status','accepted_revision_id')}
    assert 'review' not in raw


def test_latest_safe_candidate_and_retry(context):
    s,p,ws,_,_=context
    _,_,art=publish(context,table())
    bad=table(); bad.notes=[]
    candidate(context,art,bad)
    body=table(); body.notes.append('Additional evidence')
    prop=candidate(context,art,body)
    request=cmd(AcceptProposal,expected_current_revision_id=art.current_revision_id)
    result=s.accept_proposal(p,ws,prop.id,request)
    before=snapshot(context)
    assert s.accept_proposal(p,ws,prop.id,request)==result
    assert snapshot(context)==before


def test_full_query_chronology_ties_older_ack_and_history(context):
    s,p,ws,_,_=context
    _,_,art=publish(context,table())
    stamp=now()
    proposals=[candidate(context,art,table(),id=f'candidate-{i:03}',created_at=stamp) for i in range(30)]
    # High UUID/ID does not win over chronology; newest falls outside first page.
    candidate(context,art,table(),id='zz-old',created_at=stamp-timedelta(days=1))
    original=snapshot(context)
    page=s.proposals(p,ws,art.id)
    assert len(page.items)==25 and page.next_cursor
    assert all(x.review.latest_pending_proposal_id==proposals[-1].id for x in page.items)
    assert not any(x.review.is_latest for x in page.items)
    second=s.proposals(p,ws,art.id,cursor=page.next_cursor)
    assert sum(x.review.is_latest for x in second.items)==1
    raises('review_required',lambda:accept(context,art,proposals[0]))
    assert snapshot(context)==original
    accept(context,art,proposals[0],acknowledge_older_proposal=True)
    statuses={x.id:x.status for x in s.proposals(p,ws,art.id,limit=50).items}
    assert statuses[proposals[0].id]=='accepted'
    assert all(statuses[x.id]=='pending' for x in proposals[1:])


def test_both_acknowledgements_independent_and_stale_not_bypassable(context):
    s,p,ws,_,_=context
    _,_,art=publish(context,table())
    bad=table(); bad.notes=[]
    prop=candidate(context,art,bad)
    candidate(context,art,table())
    for flags in ({},{'acknowledge_removed_content':True},{'acknowledge_older_proposal':True}):
        raises('review_required',lambda:accept(context,art,prop,**flags))
    changed=table(); changed.notes.append('New human qualification')
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=changed))
    original=snapshot(context)
    for base in (art,saved):
        raises('version_conflict',lambda:accept(context,base,prop,acknowledge_removed_content=True,acknowledge_older_proposal=True))
    assert snapshot(context)==original


def test_foreign_scope_acl_source_revocation_remain_enforced(context):
    s,p,ws,refs,admin=context
    cv=conversation(context,refs)
    _,_,art=publish(context,table(),cv)
    prop=candidate(context,art,table(),deps=refs)
    flags=cmd(AcceptProposal,expected_current_revision_id=art.current_revision_id,
              acknowledge_removed_content=True,acknowledge_older_proposal=True)
    raises('not_found_or_not_authorized',lambda:s.proposals(Principal('foreign'),ws,art.id))
    raises('not_found_or_not_authorized',lambda:s.accept_proposal(Principal('foreign'),ws,prop.id,flags))
    raises('not_found_or_not_authorized',lambda:s.accept_proposal(p,'foreign-workspace',prop.id,flags))
    with psycopg.connect(admin) as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    original=snapshot(context)
    raises('not_found_or_not_authorized',lambda:s.proposals(p,ws,art.id))
    raises('not_found_or_not_authorized',lambda:s.accept_proposal(p,ws,prop.id,flags))
    assert snapshot(context)==original


def test_dismiss_does_not_store_projection(context):
    s,p,ws,_,_=context
    _,_,art=publish(context,table())
    prop=candidate(context,art,table())
    old=snapshot(context)['proposals'][0]['value']['data']
    s.proposals(p,ws,art.id)
    s.dismiss_proposal(p,ws,prop.id,cmd(DismissProposal,expected_current_revision_id=art.current_revision_id,resolution='dismiss'))
    raw=snapshot(context)['proposals'][0]['value']['data']
    assert raw=={**old,'status':'dismissed'}


def test_new_candidate_after_read_requires_explicit_older_choice(context):
    s,p,ws,_,_=context
    _,_,art=publish(context,table())
    prop=candidate(context,art,table())
    assert s.proposals(p,ws,art.id).items[0].review.is_latest
    candidate(context,art,table())
    original=snapshot(context)
    raises('review_required',lambda:accept(context,art,prop))
    assert snapshot(context)==original
    accept(context,art,prop,acknowledge_older_proposal=True)


def test_source_change_and_replay_revocation_cannot_be_acknowledged(context):
    s,p,ws,refs,admin=context
    cv=conversation(context,refs)
    _,_,art=publish(context,table(),cv)
    prop=candidate(context,art,table(),deps=refs)
    request=cmd(AcceptProposal,expected_current_revision_id=art.current_revision_id,
                acknowledge_removed_content=True,acknowledge_older_proposal=True)
    result=s.accept_proposal(p,ws,prop.id,request)
    assert s.accept_proposal(p,ws,prop.id,request)==result
    # Cached success is still fenced by current source access.
    with psycopg.connect(admin) as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    original=snapshot(context)
    raises('not_found_or_not_authorized',lambda:s.accept_proposal(p,ws,prop.id,request))
    assert snapshot(context)==original


def test_ack_does_not_bypass_source_version_or_field_type_guard(context):
    s,p,ws,refs,admin=context
    cv=conversation(context,refs)
    _,_,art=publish(context,table(),cv)
    prop=candidate(context,art,table(),deps=refs)
    with psycopg.connect(admin) as c:
        c.execute("UPDATE sources SET data=jsonb_set(data,'{external_version}',%s) WHERE workspace_id=%s AND id=%s",
                  (encoded('changed-version'),ws,refs[0].source_id))
    original=snapshot(context)
    raises('source_changed',lambda:accept(context,art,prop,acknowledge_removed_content=True,acknowledge_older_proposal=True))
    assert snapshot(context)==original
    # Acknowledgement is not permission to reinterpret a surviving field key.
    _,_,other=publish(context,table())
    body=table(); body.fields[0].editable=False
    incompatible=candidate(context,other,body)
    raises('unsupported_operation',lambda:accept(context,other,incompatible,acknowledge_removed_content=True,acknowledge_older_proposal=True))


def test_http_projection_and_review_error(context):
    from fastapi.testclient import TestClient
    from workagent.api import create_app,Settings
    s,p,ws,_,_=context
    _,_,art=publish(context,table())
    body=table(); body.notes=[]
    prop=candidate(context,art,body)
    bearer='synthetic-proposal-review-test-token'
    client=TestClient(create_app(Settings(s.db.dsn,True,bearer,p.id)))
    headers={'Authorization':'Bearer '+bearer,'X-Schema-Version':'workagent/v1','X-Request-Id':'review'}
    original=snapshot(context)
    response=client.get(f'/v1/workspaces/{ws}/artifacts/{art.id}/proposals',headers=headers)
    assert response.status_code==200
    assert response.json()['items'][0]['review']['removed_content_count']==2
    request=cmd(AcceptProposal,expected_current_revision_id=art.current_revision_id)
    url=f'/v1/workspaces/{ws}/proposals/{prop.id}/accept'
    response=client.post(url,headers=headers,json=request.model_dump(mode='json'))
    assert response.status_code==409 and response.json()['code']=='review_required'
    assert response.json()['details']['fields']==['acknowledge_removed_content']
    assert snapshot(context)==original
    request.acknowledge_removed_content=True
    assert client.post(url,headers=headers,json=request.model_dump(mode='json')).status_code==200
    after=snapshot(context)
    assert client.post(url,headers=headers,json=request.model_dump(mode='json')).status_code==200
    assert snapshot(context)==after


def test_latest_excludes_dismissed_stale_and_other_artifacts(context):
    s,p,ws,_,_=context
    _,_,art=publish(context,table())
    stale=candidate(context,art,table())
    saved=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=table()))
    current=candidate(context,saved,table())
    dismissed=candidate(context,saved,table())
    s.dismiss_proposal(p,ws,dismissed.id,cmd(DismissProposal,expected_current_revision_id=saved.current_revision_id,resolution='dismiss'))
    _,_,other=publish(context,table())
    candidate(context,other,table(),created_at=now()+timedelta(days=1))
    items={x.id:x for x in s.proposals(p,ws,art.id).items}
    assert all(x.review.latest_pending_proposal_id==current.id for x in items.values())
    assert not items[stale.id].review.is_latest and not items[dismissed.id].review.is_latest
    assert items[current.id].review.is_latest
    accept(context,saved,current)
    assert all(x.review.latest_pending_proposal_id is None for x in s.proposals(p,ws,art.id).items)


def test_membership_revocation_blocks_review_and_ack(context):
    s,p,ws,_,admin=context
    _,_,art=publish(context,table())
    prop=candidate(context,art,table())
    with psycopg.connect(admin) as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    original=snapshot(context)
    raises('not_found_or_not_authorized',lambda:s.proposals(p,ws,art.id))
    raises('not_found_or_not_authorized',lambda:accept(context,art,prop,acknowledge_removed_content=True,acknowledge_older_proposal=True))
    assert snapshot(context)==original
