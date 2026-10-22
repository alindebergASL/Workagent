"""Scoped discovery, proposed edits, and later continuation on real isolated PG.
Synthetic transport only; these are authority/continuity tests, not model quality.
"""
import copy
from datetime import timedelta
from unittest.mock import patch

import psycopg
import pytest
from test_domain import context, cmd
from test_conversations import post
from test_work_area_context import saved, document
from test_sustained_continuity import activate, advance
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker, target
from test_adaptive_execution import finish_safe_visits
from test_responsibility_execution import dispatch, admitted
from workagent.models import PostMessage, HumanSave, new_id
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.service import Service, encoded


def page(after=None):
    return {'kind':'discover_saved_work','after_artifact_id':after,'limit':12}


def observation(ctx,index=-1):
    return ctx['adaptive']['observations'][index]['capability_result']['result']


def test_discover_omitted_work_read_propose_and_restart(context,tmp_path):
    s,p,ws,_,_=context
    cv,first=saved(context)
    for i in range(12):
        q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,
            text='Synthetic saved item',operation={'kind':'publish_artifact','body':document(str(i))}))
        GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
        cv=s.get_conversation(p,ws,cv.id).conversation
    artifacts=s.get_conversation(p,ws,cv.id).artifact_ids
    omitted=s.get_artifact(p,ws,sorted(artifacts)[-1])
    body=omitted.current_revision.body.model_dump(mode='json')
    body['blocks'].append({'block_id':'keep','kind':'protected_note','text':'Human correction stays verbatim Ω','checked':None})
    omitted=s.human_save(p,ws,omitted.id,cmd(HumanSave,expected_current_revision_id=omitted.current_revision_id,body=body))
    from workagent.models import StandingResponsesBinding
    def standing_binding(**kw):
        return StandingResponsesBinding(**(kw|{'conversation_ids':[]}))
    with patch('test_general_alpha_runtime.GeneralAlphaResponsesBinding',standing_binding):
        activate(context,cv,max_steps=5,admission_policy='principal-workspace-v1')
    q=post(context,cv,'Find the saved item with my correction and propose a clearer title.')
    def first_page(ctx):
        assert len(ctx['saved_work']['items'])==12
        assert target(omitted).model_dump(mode='json') not in [x['target'] for x in ctx['saved_work']['items']]
        return page()
    def second_page(ctx):
        r=observation(ctx)
        assert len(r['items'])==12 and r['has_more']
        return page(r['next_after_artifact_id'])
    def read(ctx):
        r=observation(ctx)
        assert len(r['items'])==1 and not r['has_more'] and r['next_after_artifact_id'] is None
        assert r['items'][0]['target']==target(omitted).model_dump(mode='json')
        return {'kind':'read_saved_work','target':r['items'][0]['target']}
    def revise(ctx):
        r=observation(ctx)
        assert r['status']=='complete' and r['body']==body
        proposed=copy.deepcopy(r['body']); proposed['title']='Clearer proposed title'
        return {'kind':'publish_artifact','target':r['target'],'body':proposed}
    fake=AlphaProvider([first_page,second_page,read,revise,{'kind':'reply','text':'Proposed title only; your correction is unchanged.'}])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    proposals=s.proposals(p,ws,omitted.id).items
    assert len(proposals)==1 and proposals[0].body.blocks==omitted.current_revision.body.blocks
    assert s.get_artifact(p,ws,omitted.id).current_revision_id==omitted.current_revision_id
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==calls and len(s.proposals(p,ws,omitted.id).items)==1


def test_background_dependency_revision_next_action_and_later_event(context,tmp_path):
    s,p,ws,_,_=context
    from test_responsibilities import delegate
    from workagent.responsibility_models import ActivateResponsibility, ResponsibilityDependency, ResponsibilityNextAction
    cv,art=saved(context)
    a=delegate(context,cv,'Maintain a useful readiness plan')
    g=activate(context,cv,max_steps=5)
    initial=s.activate_responsibility(p,ws,a.id,cmd(ActivateResponsibility,
        expected_work_version=a.work_version,current_outcome='Saved checklist exists.',
        next_action=ResponsibilityNextAction(kind='continue_work',description='Improve the saved plan'),
        dependencies=[ResponsibilityDependency(kind='artifact_revision',object_id=art.id,expected_version=art.current_revision_id)]))
    expected=target(art).model_dump(mode='json')
    def discover(ctx):
        assert ctx['responsibility']['goal']=='Maintain a useful readiness plan'
        assert ctx['durable_work']['saved_dependencies']==ctx['responsibility']['observations']
        assert ctx['durable_work']['latest_human_steering']['text']
        return page()
    def read(ctx):
        r=observation(ctx)
        assert r['scope']=='responsibility_dependencies' and [x['target'] for x in r['items']]==[expected]
        return {'kind':'read_saved_work','target':expected}
    def revise(ctx):
        r=observation(ctx)
        body=copy.deepcopy(r['body'])
        if 'body_reference' in body:
            # Packing retains identical content once, at this exact trusted path.
            from workagent.service import digest
            ref=body['body_reference']
            assert ref['path']=='#/dependencies/0/content'
            body=copy.deepcopy(ctx['dependencies'][0]['content'])
            assert digest(body)==ref['sha256']==expected['body_hash']
        body['title']='Proposed dependency revision'
        return {'kind':'publish_artifact','target':expected,'body':body}
    fake=AlphaProvider([discover,read,revise,advance,{'kind':'reply','text':'Proposed a revision; scheduled further review, without accepting changes.'}])
    d,fake,w=dispatch(context,tmp_path,g,fake); d.once()
    if fake.failures: raise fake.failures[0]
    rows=admitted(s,ws); assert len(rows)==1
    assert finish_safe_visits(context,w,rows[0]['run_id']).state=='ready'
    proposals=s.proposals(p,ws,art.id).items
    assert len(proposals)==1 and proposals[0].base_revision_id==art.current_revision_id
    state=s.get_responsibility(p,ws,a.id)
    assert state.lifecycle.outcome_status=='evidenced_preparation'
    assert state.lifecycle.next_action.description=='Check the bound inputs later and improve the next preparation step.'
    future=state.lifecycle.next_check_in_at+timedelta(seconds=1)
    def later(ctx):
        assert ctx['responsibility']['current_outcome']==state.lifecycle.current_outcome
        assert ctx['responsibility']['next_action']==state.lifecycle.next_action.model_dump(mode='json')
        prior=ctx['durable_work']['prior_results']
        assert len(prior)==1 and prior[0]['run_id']==rows[0]['run_id']
        assert any(x.get('proposal_id')==proposals[0].id for x in prior[0]['saved_references'])
        assert ctx['durable_work']['saved_dependencies'][0]['object_id']==art.id
        return {'kind':'reply','text':'Reopened the saved proposed revision and the maintained next action.'}
    fresh=(Service(s.db),*context[1:])
    d2,provider,w2=dispatch(fresh,tmp_path,g,AlphaProvider([later]))
    with patch('workagent.responsibilities.now',return_value=future): d2.once()
    if provider.failures: raise provider.failures[0]
    rows2=admitted(s,ws); assert len(rows2)==2
    later_id=next(x['run_id'] for x in rows2 if x['run_id']!=rows[0]['run_id'])
    assert finish_safe_visits(fresh,w2,later_id).state=='ready'
    assert s.get_artifact(p,ws,art.id).current_revision_id==art.current_revision_id
    assert len(s.proposals(p,ws,art.id).items)==1


def test_sql_discovery_rejects_forged_page_and_cross_conversation(context,tmp_path,monkeypatch):
    from workagent.responses_ledger import Ledger
    s,p,ws,_,_=context
    cv,art=saved(context); other_cv,other=saved(context)
    activate(context,cv,max_steps=3)
    q=post(context,cv,'Inspect saved work')
    original=Ledger.event; capture={}
    def intercept(self,c,phase,kind,data):
        if kind=='tool_result':
            capture.update(attempt=self.receipt.attempt_id,phase=phase,data=copy.deepcopy(data))
            raise RuntimeError('before discovery retention')
        return original(self,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',intercept)
    with pytest.raises(RuntimeError,match='before discovery retention'):
        worker(context,AlphaProvider([page()]),tmp_path).work(p,ws,q.run.id)
    for mutation in ('foreign','title','cursor','receipt','envelope'):
        data=copy.deepcopy(capture['data']); result=data['capability_result']['result']
        if mutation=='foreign': result['items'][0]['target']=target(other).model_dump(mode='json')
        elif mutation=='title': result['items'][0]['title']='invented'
        elif mutation=='cursor': result['has_more']=True
        elif mutation=='envelope': data['capability_result']['invented_context']='not canonical'
        else: data['binding']['selection_response_id']='forged'
        with pytest.raises(psycopg.errors.RaiseException):
            with s.db.transaction() as c:
                c.execute('INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,%s,%s,%s)',
                    (new_id(),capture['attempt'],capture['phase'],'tool_result',encoded(data)))
    with s.db.transaction() as c:
        for mutation in (False,True):
            assert not c.execute('SELECT saved_work_target_permitted(%s,%s,%s,%s) ok',
                (capture['attempt'],'selection_2',encoded(target(other).model_dump(mode='json')),mutation)).fetchone()['ok']
    assert not s.proposals(p,ws,art.id).items


def test_discovery_revalidates_target_after_human_edit(context,tmp_path):
    from workagent.errors import DomainError
    s,p,ws,_,_=context
    cv,art=saved(context); activate(context,cv,max_steps=3)
    q=post(context,cv,'Inspect saved work')
    def read(ctx):
        selected=observation(ctx)['items'][0]['target']
        s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=document('Newer human edit wins')))
        return {'kind':'read_saved_work','target':selected}
    with pytest.raises(DomainError):
        finish_safe_visits(context,worker(context,AlphaProvider([page(),read]),tmp_path),q.run.id)
    assert not s.proposals(p,ws,art.id).items
    assert s.get_artifact(p,ws,art.id).current_revision.body.blocks[0].text=='Newer human edit wins'


def test_recorded_instructions_survive_newer_human_steering(context,tmp_path):
    from test_conversations import conversation
    from test_responsibility_action import record
    from workagent.responsibility_execution import durable_context
    s,p,ws,_,_=context
    cv=conversation(context); activate(context,cv,max_steps=3)
    original='Keep the handoff current. Never remove the owner notes; use explicit uncertainty.'
    q=post(context,cv,original)
    assert finish_safe_visits(context,worker(context,AlphaProvider([record,{'kind':'reply','text':'Tracking the handoff locally.'}]),tmp_path),q.run.id).state in ('ready','partial')
    detail=s.get_conversation(p,ws,cv.id)
    r=s.get_responsibility(p,ws,detail.assignment_ids[0])
    correction=post(context,detail.conversation,'Also retain the new source labels.')
    # Inspect the production durable projection independently of the prompt
    # window. Later human text is not substituted for the exact recorded request.
    with s.db.transaction() as c:
        projected=durable_context(c,correction.run,correction.message,
            {'assignment_id':r.assignment.id,'observations':[]})
    assert projected['recorded_human_request']['text']==original
    assert projected['recorded_human_request']['message_id']==q.message.id
    assert projected['request_available']
