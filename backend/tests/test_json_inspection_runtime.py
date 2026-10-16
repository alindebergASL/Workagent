"""Controlled selections on restricted PostgreSQL; not live model usefulness."""
import copy
import json
import pytest
import psycopg
from test_domain import context,cmd,raises
from test_conversations import conversation,post
from test_general_alpha_runtime import activate,skill
from test_general_responses import worker,totals,target
from test_saved_work_retrieval import CheckedProvider
from test_work_area_context import document,saved
from test_runtime import expire
from workagent.models import PostMessage,AttachmentInput,CancelConversation
from workagent.responses_ledger import Ledger
from workagent.provider_attempts import revoke_grant
from workagent.db import Database


def setup(context,**grant):
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,cv,**grant)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,
        text='Inspect this supplied configuration and explain what needs attention.',
        attachments=[AttachmentInput(filename='configuration.json',mime_type='text/plain',
            content='{"service":{"enabled":false,"owner":null,"timeout":0.10000000000000001}}')]))
    return cv,g,q


def inspect_choice(ctx):
    message=next(m for m in ctx['messages'] if m['run_id']==ctx['run_id'] and m['author_kind']=='human')
    a=message['attachments'][0]
    return {'kind':'inspect_json','attachment':{k:a[k] for k in ('ref','sha256')},'path':['service']}


def answer(ctx):
    value=ctx['adaptive']['observations'][-1]['capability_result']['result']
    assert value['status']=='complete'
    assert json.loads(value['selected_json'])['owner'] is None
    assert '0.10000000000000001' in value['selected_json']
    return {'kind':'reply','text':'The supplied service is disabled and has no owner; this is local inspection, not a deployment or availability check.'}


@pytest.mark.parametrize('with_skill',[False,True])
def test_inspection_composes_with_optional_guidance_and_reply(context,tmp_path,with_skill):
    s,p,ws,_,_=context;cv,g,q=setup(context)
    def choose_skill(ctx):
        offered=next(x for x in ctx['composition']['skills'] if x['skill_id']=='inspect-structured-evidence')
        return {'kind':'load_skill',**{k:offered[k] for k in ('skill_id','version','sha256')}}
    fake=CheckedProvider(([choose_skill] if with_skill else [])+[inspect_choice,answer])
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    if fake.failures:raise fake.failures[0]
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.messages[-1].text.startswith('The supplied service is disabled')
    assert not detail.artifact_ids and not detail.turns[0].adaptive.steps[-1].verification.satisfied
    assert totals(s,g)['request_counts']['dispatch']==(4 if with_skill else 3)


def test_inspection_then_existing_draft_publication(context,tmp_path):
    s,p,ws,_,_=context;cv,g,q=setup(context)
    def publish(ctx):
        answer(ctx)
        return {'kind':'publish_artifact','target':None,'body':document('Service disabled. Owner not supplied. No remote service was inspected.')}
    fake=CheckedProvider([inspect_choice,publish])
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    if fake.failures:raise fake.failures[0]
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.artifact_ids)==1 and detail.turns[0].adaptive.outcome=='needs_validation'


@pytest.mark.parametrize('change',['hash','ref','mime','prior_turn'])
def test_only_exact_current_json_attachment_authorized(context,tmp_path,change):
    s,p,ws,_,_=context;cv,g,q=setup(context)
    if change in ('mime','prior_turn'):
        # Finish the first immutable turn, then admit a distinct one.
        assert worker(context,CheckedProvider([{'kind':'reply','text':'First turn.'}]),tmp_path).work(p,ws,q.run.id).state=='ready'
        previous=s.get_conversation(p,ws,cv.id).messages[0].attachments[0]
        cv=s.get_conversation(p,ws,cv.id).conversation
        attachments=[] if change=='prior_turn' else [AttachmentInput(filename='other.csv',mime_type='text/csv',content='a,b\n1,2')]
        q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='New scoped turn',attachments=attachments))
    def invalid(ctx):
        if change=='prior_turn':return {'kind':'inspect_json','attachment':{'ref':previous.ref,'sha256':previous.sha256},'path':[]}
        d=inspect_choice(ctx)
        if change=='hash':d['attachment']['sha256']='0'*64
        if change=='ref':d['attachment']['ref']='not-offered'
        return d
    fake=CheckedProvider([invalid]);raises('not_found_or_not_authorized',lambda:worker(context,fake,tmp_path).work(p,ws,q.run.id))
    if fake.failures:raise fake.failures[0]


def test_receipt_restart_does_not_reparse(context,tmp_path,monkeypatch):
    import workagent.json_inspection as parser
    s,p,ws,_,_=context;cv,g,q=setup(context);fake=CheckedProvider([inspect_choice,answer]);w=worker(context,fake,tmp_path)
    def crash(name):
        if name=='after_tool_result':raise RuntimeError('synthetic interruption after retained inspection')
    w.phases.hook=crash
    with pytest.raises(RuntimeError):w.work(p,ws,q.run.id)
    expire(context,q.run.id)
    monkeypatch.setattr(parser,'inspect_json',lambda *_: (_ for _ in ()).throw(AssertionError('must not reparse')))
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    assert totals(s,g)['request_counts']['dispatch']==3


@pytest.mark.parametrize('change',['grant','cancel','membership'])
def test_inspection_does_not_grant_continuation_authority(context,tmp_path,change):
    s,p,ws,_,admin=context;cv,g,q=setup(context);fake=CheckedProvider([inspect_choice,answer]);w=worker(context,fake,tmp_path)
    def alter(name):
        if name!='after_tool_result':return
        if change=='grant':revoke_grant(Database(admin),g.id)
        elif change=='cancel':s.cancel_conversation(p,ws,cv.id,cmd(CancelConversation,expected_work_version=q.conversation.work_version))
        else:
            with Database(admin).transaction() as c:c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    w.phases.hook=alter
    from workagent.errors import DomainError
    with pytest.raises(DomainError):w.work(p,ws,q.run.id)
    assert len(fake.contexts)==1


def test_inspection_step_limit_is_not_answer_or_completion(context,tmp_path):
    s,p,ws,_,_=context;cv,g,q=setup(context,max_steps=1)
    fake=CheckedProvider([inspect_choice]);assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert detail.turns[0].adaptive.outcome=='step_limit' and not detail.artifact_ids


def test_sql_rejects_forged_selection_source_content_and_completion(context,tmp_path,monkeypatch):
    s,p,ws,_,_=context;cv,g,q=setup(context);original=Ledger.event;checked=[]
    def guard(self,c,phase,kind,data):
        if kind=='tool_result' and data.get('capability_result',{}).get('capability')=='inspect_json':
            for mode in ('source','path','content','bytes','limit','binding','outcome','kind','capability','body','verified','absent'):
                bad=copy.deepcopy(data);r=bad['capability_result']['result']
                if mode=='source':r['attachment']['sha256']='0'*64
                elif mode=='path':r['path']=[]
                elif mode=='content':r['selected_json']='{"forged":true}'
                elif mode=='bytes':r['value_bytes']=1
                elif mode=='limit':r['limit_bytes']=999999
                elif mode=='binding':bad['binding']['operation_hash']='0'*64
                elif mode=='outcome':bad['terminal_outcome']='answered'
                elif mode=='kind':bad['decision']['kind']='read_context'
                elif mode=='capability':bad['capability_result']['capability']='read_context'
                elif mode=='body':bad['body']=document('forged')
                elif mode=='verified':bad['verification']['satisfied']=True
                else:r.pop('status')
                with pytest.raises(psycopg.Error):
                    with c.transaction():original(self,c,phase,kind,bad)
                checked.append(mode)
        return original(self,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',guard)
    fake=CheckedProvider([inspect_choice,answer]);assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    if fake.failures:raise fake.failures[0]
    assert len(checked)==12


@pytest.mark.parametrize('content,path,status',[
    ('{"a/b":{"~":[null,false,"Norge 🇳🇴"]}}',['a/b','~','2'],'complete'),
    ('{"ratio":1.25e-8,"id":12345678901234567890,"zero":-0.00}',[],'complete'),
    ('{"key":"line\\n\\t\\b\\f\\r\\u001f\\\\\\\""}',[],'complete'),
    ('[null]', ['0'],'complete'),
    ('{"01":"literal"}',['01'],'complete'),
    ('[null]', ['01'],'not_found'),
    ('[null]', ['0','x'],'not_found'),
    (json.dumps({'large':'x'*17000}),['large'],'size_limit'),
    ('{"x":1,"x":2}',[],'invalid_input'),
    ('[1e999999999999999999999999999999]',[],'invalid_input'),
    ('["\\u0000"]',[],'invalid_input'),
])
def test_same_vectors_through_python_and_restricted_sql(context,tmp_path,content,path,status):
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,
        text='Inspect the supplied synthetic JSON without external actions.',
        attachments=[AttachmentInput(filename='records.json',mime_type='text/plain',content=content)]))
    def choose(ctx):return {**inspect_choice(ctx),'path':path}
    def reply(ctx):
        r=ctx['adaptive']['observations'][0]['capability_result']['result']
        assert r['status']==status
        return {'kind':'reply','text':'Local inspection returned '+status+'. No service was accessed.'}
    fake=CheckedProvider([choose,reply]);assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready'
    if fake.failures:raise fake.failures[0]


def test_inspection_cannot_ignore_explicit_human_target(context,tmp_path):
    s,p,ws,_,_=context;cv,a=saved(context);activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,
        text='Use this exact work target.',target=target(a),
        attachments=[AttachmentInput(filename='records.json',mime_type='text/plain',content='{}')]))
    fake=CheckedProvider([inspect_choice])
    raises('not_found_or_not_authorized',lambda:worker(context,fake,tmp_path).work(p,ws,q.run.id))


def test_closed_literal_path_schema():
    from pydantic import ValidationError
    from workagent.composition import InspectJSON
    base={'kind':'inspect_json','attachment':{'ref':'synthetic','sha256':'0'*64},'path':[]}
    for change in ({'path':['x']*13},{'path':['x'*129]},{'path':[0]},{'url':'https://example.test'}):
        with pytest.raises(ValidationError):InspectJSON.model_validate({**base,**change},strict=True)
