"""Synthetic decisions, real restricted PostgreSQL; not live usefulness evidence."""
import copy
import json
import pytest
import psycopg
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_work_area_context import saved, document
from test_alpha_budget import grant_for
from test_general_alpha_runtime import AlphaProvider
from test_saved_work_retrieval import CheckedProvider
from test_general_responses import worker
from workagent.db import Database
from workagent.models import HumanSave, CreateConversation, CancelConversation
from workagent.provider_attempts import configure_grant, revoke_grant
from workagent.general_worker import GeneralWorker, ControlledTransport
from workagent.responses_ledger import Ledger
from workagent.service import Service


def setup(context):
    s,p,ws,_,admin=context
    prior,a=saved(context)
    a=s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,
        body=document('Workshop preference: use plain language and limit setup to 15 minutes.')))
    q=post(context,prior,'Workshop preference correction: limit setup to 10 minutes, not 15.')
    GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
    prior=s.get_conversation(p,ws,prior.id).conversation
    current=conversation(context)
    g=grant_for(context,[current,prior],max_steps=8)
    configure_grant(Database(admin),g)
    return current,prior,a,g


SEARCH={'kind':'search_work_context','query':'workshop preference','limit':6}
ANSWER={'kind':'reply','text':'Use plain language and allow ten minutes for setup; the later correction overrides the earlier estimate.'}


def test_skill_search_corrected_context_reply_reopen_and_no_target_authority(context,tmp_path):
    s,p,ws,_,_=context;cv,prior,a,g=setup(context)
    q=post(context,cv,'Use the setup preference from our earlier project.')
    def skill(ctx):
        offered=next(x for x in ctx['composition']['skills'] if x['skill_id']=='context-grounded-response')
        assert '10 minutes' not in json.dumps(ctx['work_context_index'])
        assert ctx['saved_work']['items']==[] and ctx['work_area_context']['offered_targets']==[]
        return {'kind':'load_skill',**{k:offered[k] for k in ('skill_id','version','sha256')}}
    def answer(ctx):
        result=ctx['adaptive']['observations'][1]['capability_result']['result']
        matches=result['matches']
        assert len(matches)==2 and matches[0]['source']['kind']=='human_message'
        assert '10 minutes' in matches[0]['excerpt']
        assert matches[1]['source']['revision_id']==a.current_revision_id
        assert 'plain language' in matches[1]['excerpt']
        return ANSWER
    fake=CheckedProvider([skill,SEARCH,answer]);w=worker(context,fake,tmp_path)
    assert w.work(p,ws,q.run.id).state=='ready'
    if fake.failures: raise fake.failures[0]
    detail=Service(s.db).get_conversation(p,ws,cv.id)
    assert detail.messages[-1].text==ANSWER['text']
    before=list(fake.calls)
    assert worker((Service(s.db),*context[1:]),fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert fake.calls==before and not detail.artifact_ids
    assert s.get_artifact(p,ws,a.id).current_revision_id==a.current_revision_id


@pytest.mark.parametrize('excluded',['not_granted','other_owner','source_bearing','cancelled'])
def test_no_content_or_metadata_for_excluded_conversation(context,excluded):
    from workagent.service import encoded
    s,p,ws,refs,admin=context
    cv=conversation(context);other=s.create_conversation(p,ws,cmd(CreateConversation,
        title='NEVER-EXPOSE-THIS-TITLE',selected_source_refs=refs[:1] if excluded=='source_bearing' else []))
    post(context,other,'NEVER-EXPOSE-THIS-CONTENT')
    other=s.get_conversation(p,ws,other.id).conversation
    g=grant_for(context,[cv] if excluded in ('not_granted','source_bearing') else [cv,other]);configure_grant(Database(admin),g)
    if excluded=='other_owner':
        with Database(admin).transaction() as c:
            c.execute("UPDATE conversations SET data=jsonb_set(data,'{owner_id}','\"another-principal\"'::jsonb) WHERE workspace_id=%s AND id=%s",(ws,other.id))
    if excluded=='cancelled':s.cancel_conversation(p,ws,other.id,cmd(CancelConversation,expected_work_version=other.work_version))
    q=post(context,cv,'Use only permitted context');cap=s.claim_run(p,ws,q.run.id)
    result=s.conversation_worker_context(cap)['work_context_index']
    assert result['items']==[] and result['truncated'] is False
    assert 'NEVER-EXPOSE' not in json.dumps(result) and other.id not in json.dumps(result)


@pytest.mark.parametrize('change',['revision','correction','cancelled','membership','grant'])
def test_frozen_context_reauthorized_before_another_paid_operation(context,tmp_path,change):
    s,p,ws,_,admin=context;cv,prior,a,g=setup(context)
    q=post(context,cv,'Use previous setup context')
    def alter(ctx):
        if change=='revision':s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=document('Workshop preference changed again.')))
        elif change=='correction':post(context,prior,'Workshop preference now five minutes.')
        elif change=='cancelled':s.cancel_conversation(p,ws,prior.id,cmd(CancelConversation,expected_work_version=prior.work_version))
        elif change=='grant':revoke_grant(Database(admin),g.id)
        else:
            with Database(admin).transaction() as c:c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
        return SEARCH
    fake=CheckedProvider([alter,ANSWER]);w=worker(context,fake,tmp_path)
    from workagent.errors import DomainError
    with pytest.raises(DomainError):w.work(p,ws,q.run.id)
    assert len(fake.contexts)==1
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result'",(q.run.id,)).fetchone()['n']==0


def test_search_does_not_authorize_cross_conversation_revision(context,tmp_path):
    s,p,ws,_,_=context;cv,prior,a,g=setup(context)
    q=post(context,cv,'Review the earlier preferences')
    fake=CheckedProvider([SEARCH,{'kind':'publish_artifact','target':{
        'artifact_id':a.id,'revision_id':a.current_revision_id,'body_hash':a.current_revision.body_hash},'body':document('Forbidden overwrite')}])
    from workagent.errors import DomainError
    with pytest.raises(DomainError):worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert not s.proposals(p,ws,a.id).items
    assert s.get_artifact(p,ws,a.id).current_revision_id==a.current_revision_id


def test_sql_rejects_forged_search_result_then_accepts_exact_result(context,tmp_path,monkeypatch):
    s,p,ws,_,_=context;cv,prior,a,g=setup(context);q=post(context,cv,'Read prior preferences')
    original=Ledger.event; checked=[]
    def guard(self,c,phase,kind,data):
        if kind=='tool_result' and data.get('capability_result',{}).get('capability')=='search_work_context':
            for mode in ('excerpt','source','hash','binding','outcome','kind','current_revision'):
                bad=copy.deepcopy(data);hit=bad['capability_result']['result']['matches'][0]
                if mode=='excerpt':hit['excerpt']='Forged content'
                elif mode=='source':hit['source']['conversation_id']=cv.id
                elif mode=='hash':hit['source']['content_sha256']='0'*64
                elif mode=='binding':bad['binding']['selection_request_sha256']='0'*64
                elif mode=='outcome':bad['terminal_outcome']='answered'
                elif mode=='kind':bad['decision']['kind']='read_context'
                else:hit['source']['revision_id']='foreign-revision'
                with pytest.raises(psycopg.Error):
                    with c.transaction():original(self,c,phase,kind,bad)
                checked.append(mode)
        return original(self,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',guard)
    fake=CheckedProvider([SEARCH,ANSWER]);assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    if fake.failures:raise fake.failures[0]
    assert len(checked)==7


def test_search_without_skill_and_empty_matches_are_honest(context,tmp_path):
    s,p,ws,_,_=context;cv,prior,a,g=setup(context);q=post(context,cv,'Look for an unavailable preference')
    def answer(ctx):
        result=ctx['adaptive']['observations'][0]['capability_result']['result']
        assert result['matches']==[]
        return {'kind':'reply','text':'No matching context in the permitted indexed work.'}
    fake=CheckedProvider([{'kind':'search_work_context','query':'zzzzunmatched','limit':1},answer])
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    if fake.failures:raise fake.failures[0]


def test_unused_sibling_context_does_not_block_independent_answer(context,tmp_path):
    s,p,ws,_,_=context;cv,prior,a,g=setup(context)
    q=post(context,cv,'Explain immutable values without prior project context.')
    def answer(ctx):
        post(context,prior,'Unrelated workshop scheduling update.')
        return {'kind':'reply','text':'An immutable value cannot change after creation.'}
    fake=CheckedProvider([answer]);w=worker(context,fake,tmp_path)
    assert w.work(p,ws,q.run.id).state=='ready'
    assert s.get_conversation(p,ws,cv.id).messages[-1].text=='An immutable value cannot change after creation.'
    if fake.failures:raise fake.failures[0]


@pytest.mark.parametrize('change',['cancel','revision','correction'])
def test_restricted_sql_publication_rechecks_consumed_source(context,tmp_path,change):
    from workagent.models import ConversationMessage,TurnResult,TextResult,new_id
    from workagent.errors import DomainError
    s,p,ws,_,_=context;cv,prior,a,g=setup(context);q=post(context,cv,'Use saved plain language preference')
    text='Use plain language, as the earlier saved project requires.'
    fake=CheckedProvider([{'kind':'search_work_context','query':'plain','limit':1},{'kind':'reply','text':text}])
    w=worker(context,fake,tmp_path)
    def hook(name):
        if name!='before_publication':return
        if change=='cancel':s.cancel_conversation(p,ws,prior.id,cmd(CancelConversation,expected_work_version=prior.work_version))
        elif change=='revision':s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=document('Prefer precise technical terms.')))
        else:post(context,prior,'Correction: technical language is now preferred.')
    w.phases.hook=hook
    with pytest.raises(DomainError):w.work(p,ws,q.run.id)
    with s.db.transaction() as c:
        attempt=c.execute('SELECT id,data FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()
        assert c.execute("SELECT 1 FROM responses_events WHERE attempt_id=%s AND phase='final' AND kind='result'",(attempt['id'],)).fetchone()
    message=ConversationMessage(id=new_id(),conversation_id=cv.id,run_id=q.run.id,sequence=2,
        author_id='general-worker',author_kind='assistant',text=text,evidence_origin='synthetic_provider_receipt',
        result=TurnResult(results=[TextResult(text=text)]),model_receipt=attempt['id'])
    with pytest.raises(psycopg.Error,match='retained search'):
        with s.db.transaction() as c:s._append_message(c,ws,message)
    assert [m.author_kind for m in s.get_conversation(p,ws,cv.id).messages]==['human']
