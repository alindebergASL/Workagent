"""Canonical Space metadata; controlled publication is not model usefulness."""
import pytest
from test_domain import context, cmd, raises
from workagent.db import Database
from workagent.models import *
from workagent.service import Service
from workagent.general_worker import GeneralWorker, ControlledTransport


def test_create_replay_promote_restart_cas(context):
    s,p,ws,_,_=context
    request=cmd(CreateWorkArea,title='Service launch',goal='Prepare a bounded service offer',kind='project')
    cv=s.create_work_area(p,ws,request)
    assert cv.work_area.origin=='human'
    assert s.create_work_area(p,ws,request)==cv
    assert s.list_work_areas(p,ws).items[0].id==cv.id
    assert Service(Database()).get_work_area(p,ws,cv.id).conversation.work_area==cv.work_area
    updated=s.promote_work_area(p,ws,cv.id,cmd(PromoteWorkArea,expected_work_version=1,title='My title',goal='Keep scope small',kind='workflow'))
    assert updated.work_version==2 and updated.title=='My title'
    raises('version_conflict',lambda:s.promote_work_area(p,ws,cv.id,cmd(PromoteWorkArea,expected_work_version=1,title='stale',goal='stale',kind='project')))
    assert s.list_assignments(p,ws).items==[]


def test_worker_identification_plain_chat_and_human_preservation(context):
    s,p,ws,_,_=context
    cv=s.create_conversation(p,ws,cmd(CreateConversation))
    turn=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=1,text='Develop a synthetic service offer'))
    result={'results':[{'kind':'text','text':'Controlled fixture: scope and rationale.'}], 'work_area':{'title':'Service offer','goal':'Launch a bounded offer','kind':'project'}}
    worker=GeneralWorker(s,transport=ControlledTransport([result]))
    worker.work(p,ws,turn.run.id)
    detail=s.get_work_area(p,ws,cv.id)
    assert detail.conversation.work_area.origin=='agent'
    assert detail.conversation.work_area.identified_by_run_id==turn.run.id
    cv=s.promote_work_area(p,ws,cv.id,cmd(PromoteWorkArea,expected_work_version=detail.conversation.work_version,title='Human title',goal='Human scope',kind='workflow'))
    turn=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Keep my scope'))
    GeneralWorker(s,transport=ControlledTransport([result])).work(p,ws,turn.run.id)
    assert s.get_work_area(p,ws,cv.id).conversation.work_area.title=='Human title'
    plain=s.create_conversation(p,ws,cmd(CreateConversation))
    turn=s.post_message(p,ws,plain.id,cmd(PostMessage,expected_work_version=1,text='Hello'))
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,turn.run.id)
    assert s.get_conversation(p,ws,plain.id).conversation.work_area is None
    assert len(s.list_work_areas(p,ws).items)==1


def test_revocation_rechecks_replay_list_and_detail(context):
    s,p,ws,refs,admin=context
    request=cmd(CreateWorkArea,title='Private',goal='Private source',kind='project',selected_source_refs=refs[:1])
    cv=s.create_work_area(p,ws,request)
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s',(ws,))
    assert s.list_work_areas(p,ws).items==[]
    raises('not_found_or_not_authorized',lambda:s.create_work_area(p,ws,request))
    raises('not_found_or_not_authorized',lambda:s.get_work_area(p,ws,cv.id))


def test_controlled_typed_decision_publication_and_exact_target(context,tmp_path):
    from test_general_alpha_runtime import activate, AlphaProvider
    from test_general_responses import worker
    from workagent.composition import DECISION_SCHEMA
    from workagent.service import digest
    import json
    s,p,ws,_,_=context
    cv=s.create_conversation(p,ws,cmd(CreateConversation))
    body={'title':'Synthetic service offer','blocks':[{'block_id':'scope','kind':'paragraph','text':'CONTROLLED: a two-week pilot; no on-call support.','checked':None}]}
    decision={'goal':'Bound a synthetic service offer','success_criteria':[], 'decision':{'kind':'publish_artifact','target':None,'body':body,'work_area':{'title':'Service launch','goal':'Bound the offer before launch','kind':'project'}}}
    DECISION_SCHEMA.validate(json.dumps(decision))
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=1,text='Prepare my service offer'))
    assert worker(context,AlphaProvider([decision['decision']],explanation='CONTROLLED: a narrow pilot bounds delivery risk.'),tmp_path).work(p,ws,q.run.id).state=='partial'
    detail=s.get_work_area(p,ws,cv.id)
    a=s.get_artifact(p,ws,detail.artifact_ids[0])
    target=ExactTarget(artifact_id=a.id,revision_id=a.current_revision.id,body_hash=a.current_revision.body_hash)
    decision['decision']['target']=target.model_dump(mode='json')
    decision['decision']['body']['blocks'][0]['text']='CONTROLLED: a one-week pilot; no on-call support.'
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=detail.conversation.work_version,text='Make it one week',target=target))
    worker(context,AlphaProvider([decision['decision']],explanation='CONTROLLED: one week keeps the commitment smaller.'),tmp_path).work(p,ws,q.run.id)
    proposals=s.proposals(p,ws,a.id).items
    assert len(proposals)==1 and proposals[0].base_revision_id==target.revision_id
    assert s.get_artifact(p,ws,a.id).current_revision.body_hash==target.body_hash
    result=s.accept_proposal(p,ws,proposals[0].id,cmd(AcceptProposal,expected_current_revision_id=target.revision_id))
    assert 'one-week' in result.current_revision.body.blocks[0].text


def test_alpha_reply_identifies_only_when_schema_selects_area(context,tmp_path):
    from test_general_alpha_runtime import activate,AlphaProvider
    from test_general_responses import worker
    s,p,ws,_,_=context
    plain=s.create_conversation(p,ws,cmd(CreateConversation))
    activate(context,plain)
    q=s.post_message(p,ws,plain.id,cmd(PostMessage,expected_work_version=1,text='This contains the word project, but is just a definition question.'))
    worker(context,AlphaProvider([{'kind':'reply','text':'CONTROLLED: a short definition.'}]),tmp_path).work(p,ws,q.run.id)
    assert s.get_conversation(p,ws,plain.id).conversation.work_area is None
    cv=s.get_conversation(p,ws,plain.id).conversation
    decision={'kind':'reply','text':'CONTROLLED: ongoing scope identified.','work_area':{'title':'Ongoing offer','goal':'Validate demand','kind':'project'}}
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Help me develop the offer over several turns.'))
    runner=worker(context,AlphaProvider([decision]),tmp_path)
    assert runner.work(p,ws,q.run.id).state=='ready'
    assert runner.work(p,ws,q.run.id).state=='ready'
    detail=s.get_work_area(p,ws,cv.id)
    assert detail.conversation.work_area.origin=='agent'
    human=s.promote_work_area(p,ws,cv.id,cmd(PromoteWorkArea,expected_work_version=detail.conversation.work_version,title='Human choice',goal='Keep this scope',kind='workflow'))
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=human.work_version,text='Keep going'))
    worker(context,AlphaProvider([decision]),tmp_path).work(p,ws,q.run.id)
    assert s.get_work_area(p,ws,cv.id).conversation.work_area.goal=='Keep this scope'


def test_http_space_authority_and_replay(context):
    from fastapi.testclient import TestClient
    from workagent.api import create_app,Settings
    s,p,ws,_,_=context
    import os
    api=TestClient(create_app(Settings(database_url=os.environ['DATABASE_URL'],local_test_mode=True,local_bearer='fixture-only-'+'x'*40,principal_id=p.id)))
    route=f'/v1/workspaces/{ws}/work-areas'
    request=cmd(CreateWorkArea,title='HTTP Space',goal='A real shared context',kind='workflow').model_dump(mode='json')
    assert api.post(route,json=request).status_code==401
    headers={'Authorization':'Bearer fixture-only-'+'x'*40}
    response=api.post(route,json=request,headers=headers)
    assert response.status_code==201
    assert api.post(route,json=request,headers=headers).json()==response.json()
    headers.update({'X-Schema-Version':'workagent/v1','X-Request-Id':'read-space'})
    assert api.get(route,headers=headers).json()['items'][0]['id']==response.json()['id']
    assert api.get(route+'/'+response.json()['id'],headers=headers).json()['conversation']['work_area']['kind']=='workflow'
    assert api.get('/v1/workspaces/other/work-areas/'+response.json()['id'],headers=headers).status_code==404


def test_scope_change_cancels_admitted_work_and_is_in_context(context):
    s,p,ws,_,_=context
    cv=s.create_work_area(p,ws,cmd(CreateWorkArea,title='Original',goal='Original goal',kind='project'))
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=1,text='Start work'))
    cv=s.promote_work_area(p,ws,cv.id,cmd(PromoteWorkArea,expected_work_version=q.conversation.work_version,title='Human scope',goal='Respect this updated scope',kind='workflow'))
    assert s.get_run(p,ws,q.run.id).state=='cancelled'
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Continue'))
    cap=s.claim_run(p,ws,q.run.id)
    assert s.conversation_worker_context(cap)['work_area']['goal']=='Respect this updated scope'


def test_cancelled_space_cannot_promote_or_publish(context):
    s,p,ws,_,_=context
    cv=s.create_work_area(p,ws,cmd(CreateWorkArea,title='Closed',goal='Closed scope',kind='project'))
    cv=s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=1))
    raises('action_unresolved',lambda:s.promote_work_area(p,ws,cv.id,cmd(PromoteWorkArea,expected_work_version=cv.work_version,title='No',goal='No',kind='project')))
