"""Controlled transport + real disposable PostgreSQL; not live model quality."""
import pytest
from test_domain import context, cmd, raises
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker
from workagent.db import Database
from workagent.models import *
from workagent.service import Service
from workagent.general_worker import GeneralWorker, ControlledTransport


def document(text='CONTROLLED original'):
    return {'title':'Synthetic current work','blocks':[{'block_id':'scope','kind':'paragraph','text':text,'checked':None}]}


def saved(context):
    s,p,ws,_,_=context
    cv=s.create_work_area(p,ws,cmd(CreateWorkArea,title='Synthetic Space',goal='Keep current work coherent',kind='project'))
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Create draft',
        operation={'kind':'publish_artifact','body':document()}))
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
    detail=s.get_conversation(p,ws,cv.id)
    return detail.conversation,s.get_artifact(p,ws,detail.artifact_ids[0])


def test_projection_api_runtime_and_human_revision_reopen(context):
    from fastapi.testclient import TestClient
    from workagent.api import create_app,Settings
    s,p,ws,_,_=context
    cv,a=saved(context)
    edited=s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=document('Human correction')))
    reopened=Service(Database()).get_work_area_context(p,ws,cv.id)
    assert reopened.purpose==cv.work_area
    assert reopened.artifacts[0].revision_id==edited.current_revision_id
    assert reopened.artifacts[0].author_kind=='human'
    assert reopened.artifacts[0].body.blocks[0].text=='Human correction'
    token='context-fixture-only-'+'x'*32
    with TestClient(create_app(Settings(s.db.dsn,True,token,p.id))) as client:
        headers={'Authorization':'Bearer '+token,'X-Schema-Version':'workagent/v1','X-Request-Id':'read-context'}
        response=client.get(f'/v1/workspaces/{ws}/conversations/{cv.id}/work-context',headers=headers)
        assert response.status_code==200
        assert response.json()==reopened.model_dump(mode='json')
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Continue'))
    cap=s.claim_run(p,ws,q.run.id)
    current=s.get_work_area_context(p,ws,cv.id)
    assert s.conversation_worker_context(cap)['work_area_context']==current.model_dump(mode='json')


def test_untargeted_selection_uses_offered_current_body_and_stages_only(context,tmp_path):
    s,p,ws,_,_=context
    cv,a=saved(context)
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Make it shorter'))
    def choose(ctx):
        assert ctx['work_area_context']['artifacts'][0]['body']['blocks'][0]['text']=='CONTROLLED original'
        return {'kind':'publish_artifact','target':ctx['work_area_context']['offered_targets'][0],'body':document('Shorter draft')}
    fake=AlphaProvider([choose],explanation='CONTROLLED proposed shorter version.')
    w=worker(context,fake,tmp_path)
    assert w.work(p,ws,q.run.id).state=='partial'
    proposals=s.proposals(p,ws,a.id).items
    assert len(proposals)==1
    assert proposals[0].base_revision_id==a.current_revision_id
    assert s.get_artifact(p,ws,a.id).current_revision_id==a.current_revision_id
    calls=list(fake.calls)
    w.work(p,ws,q.run.id)
    assert fake.calls==calls and len(s.proposals(p,ws,a.id).items)==1
    assert s.get_conversation(p,ws,cv.id).messages[-2].target is None


def propose(context,cv,a,text='CONTROLLED candidate'):
    s,p,ws,_,_=context
    before={x.id for x in s.proposals(p,ws,a.id).items}
    current=s.get_conversation(p,ws,cv.id).conversation
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=current.work_version,text='Controlled edit',
        operation={'kind':'publish_artifact','artifact_id':a.id,'base_revision_id':a.current_revision_id,'body':document(text)}))
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
    return next(x for x in s.proposals(p,ws,a.id).items if x.id not in before)


def test_proposal_status_bases_staleness_and_acceptance_current_revision(context):
    s,p,ws,_,_=context
    cv,a=saved(context)
    pending=propose(context,cv,a)
    dismissed=propose(context,cv,a)
    s.dismiss_proposal(p,ws,dismissed.id,cmd(DismissProposal,expected_current_revision_id=a.current_revision_id,resolution='dismiss'))
    accepted=propose(context,cv,a)
    s.accept_proposal(p,ws,accepted.id,cmd(AcceptProposal,expected_current_revision_id=a.current_revision_id))
    projection=Service(Database()).get_work_area_context(p,ws,cv.id)
    items={item.proposal_id:item for item in projection.proposals}
    assert items[dismissed.id].status=='dismissed' and not items[dismissed.id].stale
    assert items[pending.id].status=='pending' and items[pending.id].stale
    assert not items[pending.id].base_is_current
    assert items[accepted.id].status=='accepted' and not items[accepted.id].stale
    assert projection.artifacts[0].revision_id==items[accepted.id].accepted_revision_id
    assert all(item.base_revision_id==a.current_revision_id for item in items.values())


def test_responsibility_projection_updates_and_other_conversation_is_absent(context):
    from test_responsibilities import delegate,activate as activate_lifecycle,plan
    from workagent.responsibility_models import UpdateResponsibility,ResponsibilityWait
    s,p,ws,_,_=context
    cv,a=saved(context)
    other,b=saved(context)
    assignment=delegate(context,cv)
    detail=activate_lifecycle(context,assignment,artifact=a)
    foreign=delegate(context,other)
    activate_lifecycle(context,foreign,artifact=b)
    before=s.get_work_area_context(p,ws,cv.id)
    assert [r.assignment_id for r in before.responsibilities]==[assignment.id]
    assert [r.artifact_id for r in before.artifacts]==[a.id]
    changed=s.update_responsibility(p,ws,assignment.id,cmd(UpdateResponsibility,
        expected_work_version=detail.assignment.work_version,
        **plan(artifact=a,current_outcome='Human is deciding; no action sent.',
               wait=ResponsibilityWait(kind='person',reason='Awaiting a local answer.'))))
    current=Service(Database()).get_work_area_context(p,ws,cv.id).responsibilities[0]
    assert current.work_version==changed.assignment.work_version
    assert current.lifecycle==changed.lifecycle
    assert current.lifecycle.current_outcome=='Human is deciding; no action sent.'
    assert current.lifecycle.state=='waiting_person' and current.lifecycle.execution_status=='not_admitted'
    assert current.lifecycle.next_action.kind=='await_event'
    assert current.lifecycle.wait.kind=='person'
    assert current.lifecycle_sha256!=before.responsibilities[0].lifecycle_sha256


@pytest.mark.parametrize('change',['human_save','accept','purpose','revoke','cancel','membership'])
@pytest.mark.parametrize('when',['selection','before_publication'])
def test_inferred_target_freshness_fences(context,tmp_path,change,when):
    from workagent.provider_attempts import revoke_grant
    from workagent.errors import DomainError
    s,p,ws,_,admin=context
    cv,a=saved(context)
    prior=propose(context,cv,a,'Human may accept this')
    cv=s.get_conversation(p,ws,cv.id).conversation
    grant=activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Shorten this'))
    original=[]
    def alter():
        with s.db.transaction() as c:
            original.append(c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                (ws,q.run.id)).fetchone()['data'])
        if change=='human_save':
            s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=document('Human revision wins')))
        elif change=='accept':
            s.accept_proposal(p,ws,prior.id,cmd(AcceptProposal,expected_current_revision_id=a.current_revision_id))
        elif change=='purpose':
            s.promote_work_area(p,ws,cv.id,cmd(PromoteWorkArea,expected_work_version=q.conversation.work_version,
                title='Changed human purpose',goal='Do not pursue the old goal',kind='project'))
        elif change=='cancel':
            s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
        elif change=='revoke': revoke_grant(Database(admin),grant.id)
        else:
            with Database(admin).transaction() as c:
                c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    def choose(ctx):
        decision={'kind':'publish_artifact','target':ctx['work_area_context']['offered_targets'][0],'body':document('Forbidden stale draft')}
        if when=='selection': alter()
        return decision
    w=worker(context,AlphaProvider([choose]),tmp_path)
    def hook(name):
        if name==when: alter()
    w.phases.hook=hook
    with pytest.raises(DomainError) as exc: w.work(p,ws,q.run.id)
    assert exc.value.code.value in ('source_changed','version_conflict','not_found_or_not_authorized','action_unresolved')
    with Database(admin).transaction() as c:
        assert c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
            (ws,q.run.id)).fetchone()['data']==original[0]
        assert c.execute('SELECT count(*) n FROM proposals WHERE workspace_id=%s AND artifact_id=%s',
            (ws,a.id)).fetchone()['n']==1
        assert c.execute("SELECT count(*) n FROM conversation_messages WHERE workspace_id=%s AND data->>'run_id'=%s AND data->>'author_kind'='assistant'",
            (ws,q.run.id)).fetchone()['n']==0
        revision=c.execute('SELECT current_revision_id FROM artifacts WHERE workspace_id=%s AND id=%s',(ws,a.id)).fetchone()['current_revision_id']
        assert (revision!=a.current_revision_id)==(change in ('accept','human_save'))


@pytest.mark.parametrize('invalid',['explicit_switch','cross_conversation','unoffered'])
def test_only_offered_targets_and_explicit_target_cannot_switch(context,tmp_path,invalid):
    from test_general_responses import target
    s,p,ws,_,_=context
    cv,a=saved(context)
    if invalid=='cross_conversation':
        other,b=saved(context)
    else:
        q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Create another',
            operation={'kind':'publish_artifact','body':document('x'*10000 if invalid=='unoffered' else 'Second editable')}))
        GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
        detail=s.get_conversation(p,ws,cv.id)
        b=s.get_artifact(p,ws,next(i for i in detail.artifact_ids if i!=a.id))
    cv=s.get_conversation(p,ws,cv.id).conversation
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Change the draft',
        target=target(a) if invalid=='explicit_switch' else None))
    def choose(ctx):
        offered=ctx['work_area_context']['offered_targets']
        if invalid=='explicit_switch': assert target(b).model_dump(mode='json') in offered
        else: assert target(b).model_dump(mode='json') not in offered
        return {'kind':'publish_artifact','target':target(b).model_dump(mode='json'),'body':document('Not permitted')}
    raises('not_found_or_not_authorized',lambda:worker(context,AlphaProvider([choose]),tmp_path).work(p,ws,q.run.id))
    assert not s.proposals(p,ws,a.id).items and not s.proposals(p,ws,b.id).items


def test_record_own_responsibility_then_infer_keeps_immutable_snapshot(context,tmp_path):
    from test_responsibility_action import record
    from test_responsibilities import delegate,activate as activate_lifecycle
    s,p,ws,_,_=context
    cv,a=saved(context)
    existing=delegate(context,cv)
    activate_lifecycle(context,existing,artifact=a)
    cv=s.get_conversation(p,ws,cv.id).conversation
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Track this and shorten the draft'))
    snapshots=[]
    def choose(ctx):
        assert [x['assignment_id'] for x in ctx['work_area_context']['responsibilities']]==[existing.id]
        return {'kind':'publish_artifact','target':ctx['work_area_context']['offered_targets'][0],'body':document('Proposed, not saved')}
    fake=AlphaProvider([record,choose])
    w=worker(context,fake,tmp_path)
    def hook(name):
        if name=='after_tool_result':
            with s.db.transaction() as c:
                snapshots.append(c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                    (ws,q.run.id)).fetchone()['data'])
    w.phases.hook=hook
    assert w.work(p,ws,q.run.id).state=='partial'
    assert len(snapshots)==2 and snapshots[0]==snapshots[1]
    assert len(s.get_work_area_context(p,ws,cv.id).responsibilities)==2
    assert s.get_artifact(p,ws,a.id).current_revision_id==a.current_revision_id
    assert len(s.proposals(p,ws,a.id).items)==1
    before=list(fake.calls)
    w.work(p,ws,q.run.id)
    assert fake.calls==before and len(s.get_work_area_context(p,ws,cv.id).responsibilities)==2


def test_plain_answer_no_skill_or_automatic_space_artifact_assignment(context,tmp_path):
    s,p,ws,_,_=context
    cv=s.create_conversation(p,ws,cmd(CreateConversation))
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Explain briefly'))
    def choose(ctx):
        current=ctx['work_area_context']
        assert current['purpose'] is None and not current['artifacts'] and not current['responsibilities']
        return {'kind':'reply','text':'A controlled concise explanation.'}
    assert worker(context,AlphaProvider([choose]),tmp_path).work(p,ws,q.run.id).state=='ready'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.conversation.work_area is None and not detail.artifact_ids and not detail.assignment_ids
    assert len(detail.turns[0].adaptive.steps)==1
    assert detail.turns[0].adaptive.steps[0].capability_result is None


def test_projection_bounds_count_body_budget_and_no_materialization_outside_scope(context,monkeypatch):
    from test_responsibilities import delegate,activate as activate_lifecycle
    from workagent.service import canonical
    s,p,ws,_,_=context
    cv,a=saved(context)
    foreign,b=saved(context)
    artifacts=[a]
    for i in range(12):
        current=s.get_conversation(p,ws,cv.id).conversation
        q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=current.work_version,text='Controlled fixture',
            operation={'kind':'publish_artifact','body':document('Synthetic bounded '+str(i))}))
        GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
        ids=s.get_conversation(p,ws,cv.id).artifact_ids
        artifacts.append(s.get_artifact(p,ws,next(x for x in ids if x not in {a.id for a in artifacts})))
    for i in range(21): propose(context,cv,a,'Candidate '+str(i))
    for _ in range(9): activate_lifecycle(context,delegate(context,cv),current_outcome='x'*10000)
    for art in artifacts:
        s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=document('x'*7000)))
    original=s._artifact
    seen=[]
    def guarded(c,p,ws,aid):
        assert aid!=b.id, 'Foreign body must never be materialized'
        seen.append(aid)
        return original(c,p,ws,aid)
    monkeypatch.setattr(s,'_artifact',guarded)
    projection=s.get_work_area_context(p,ws,cv.id)
    assert len(projection.artifacts)==12 and projection.omissions.artifacts==1
    assert len(projection.proposals)==20 and projection.omissions.proposals==1
    assert len(projection.responsibilities)==8 and projection.omissions.responsibilities==1
    assert projection.omissions.lifecycles==8
    assert projection.omissions.saved_bodies==8  # Four 7KB bodies fit the 32KiB shared budget.
    assert len(projection.offered_targets)==4
    assert all(r.body_omitted==(r.body is None) for r in projection.artifacts)
    assert projection.truncated and len(canonical(projection).encode())<65536
    assert set(seen).issubset({x.id for x in artifacts})


def test_api_context_authority_checked_before_materialization(context,monkeypatch):
    s,p,ws,_,admin=context
    cv,a=saved(context)
    with Database(admin).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    monkeypatch.setattr(s,'_artifact',lambda *args:pytest.fail('No body read after revoked membership'))
    raises('not_found_or_not_authorized',lambda:s.get_work_area_context(p,ws,cv.id))


def test_system_continuation_keeps_exact_dependency_scope(context,tmp_path):
    from test_responsibility_execution import setup,edit,dispatch,answer,admitted
    from workagent.service import canonical
    s,p,ws,_,_=context
    cv,unrelated=saved(context)
    cv,art,assignment,grant,life=setup(context,cv=cv)
    seen=[]
    def choose(ctx):
        seen.append(ctx)
        assert 'work_area_context' not in ctx
        assert 'CONTROLLED original' not in canonical(ctx)
        assert [d['binding']['object_id'] for d in ctx['dependencies']]==[art.id]
        assert unrelated.id not in [x['artifact_id'] for x in ctx['bindable_artifacts']]
        return answer(ctx)
    d,fake,w=dispatch(context,tmp_path,grant,AlphaProvider([choose]))
    edit(context,art)
    d.once()
    if fake.failures: raise fake.failures[0]
    assert len(seen)==1 and admitted(s,ws)[0]['data']['state']=='ready'
