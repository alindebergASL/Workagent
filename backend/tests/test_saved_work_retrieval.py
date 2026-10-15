"""Controlled decisions on disposable PostgreSQL; not model-quality evidence."""
import copy
import pytest
from test_domain import context, cmd, raises
from test_work_area_context import saved, document
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker, target
from workagent.models import PostMessage, HumanSave



class CheckedProvider(AlphaProvider):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.failures=[]

    def handle(self,request):
        try: return super().handle(request)
        except Exception as exc:
            self.failures.append(exc)
            raise


def large_work(context, blocks=2):
    s,p,ws,_,_=context
    cv,a=saved(context)
    body=document()
    body['blocks']=[{'block_id':f'section-{i}','kind':'paragraph','text':'Synthetic content. '*330,'checked':None} for i in range(blocks)]
    body['blocks'].append({'block_id':'human-note','kind':'protected_note','text':'Human correction: keep this exact\nline, café and  Ω.','checked':None})
    a=s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=body))
    return cv,a


def read_choice(ctx):
    item=ctx['saved_work']['items'][0]
    assert item['title']=='Synthetic current work'
    assert item['body_bytes']>8192
    assert ctx['target_body'] is None
    assert ctx['work_area_context']['artifacts'][0]['body'] is None
    return {'kind':'read_saved_work','target':item['target']}


def test_large_untargeted_current_work_read_edit_and_resume(context,tmp_path):
    s,p,ws,_,_=context
    cv,a=large_work(context)
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Shorten the first section; keep my note.'))
    def revise(ctx):
        result=ctx['adaptive']['observations'][0]['capability_result']['result']
        assert result['status']=='complete'
        assert result['body']==a.current_revision.body.model_dump(mode='json')
        assert result['target']==target(a).model_dump(mode='json')
        body=copy.deepcopy(result['body'])
        body['blocks'][0]['text']='A shorter proposed section.'
        return {'kind':'publish_artifact','target':result['target'],'body':body}
    fake=CheckedProvider([read_choice,revise],explanation='A revision is proposed, not applied.')
    w=worker(context,fake,tmp_path)
    result=w.work(p,ws,q.run.id)
    if fake.failures: raise fake.failures[0]
    assert result.state=='partial'
    proposal=s.proposals(p,ws,a.id).items[0]
    assert proposal.status=='pending' and proposal.base_revision_id==a.current_revision_id
    assert proposal.body.blocks[-1]==a.current_revision.body.blocks[-1]
    assert proposal.body.blocks[1]==a.current_revision.body.blocks[1]
    assert s.get_artifact(p,ws,a.id).current_revision_id==a.current_revision_id
    assert s.get_conversation(p,ws,cv.id).messages[-2].target is None
    calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert fake.calls==calls and len(s.proposals(p,ws,a.id).items)==1


@pytest.mark.parametrize('change',['human_save','membership','grant'])
@pytest.mark.parametrize('when',['before_read','after_read','before_publication'])
def test_large_work_rechecks_authority_and_revision(context,tmp_path,change,when):
    from workagent.db import Database
    from workagent.provider_attempts import revoke_grant
    from workagent.errors import DomainError
    s,p,ws,_,admin=context
    cv,a=large_work(context); grant=activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Revise the saved work'))
    changed=False
    def alter():
        nonlocal changed
        if changed: return
        changed=True
        if change=='human_save':
            body=a.current_revision.body.model_dump(mode='json'); body['blocks'][0]['text']='Newer human edit wins'
            s.human_save(p,ws,a.id,cmd(HumanSave,expected_current_revision_id=a.current_revision_id,body=body))
        elif change=='grant': revoke_grant(Database(admin),grant.id)
        else:
            with Database(admin).transaction() as c:
                c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s',(ws,))
    def choose(ctx):
        result=read_choice(ctx)
        if when=='before_read': alter()
        return result
    def revise(ctx):
        result=ctx['adaptive']['observations'][0]['capability_result']['result']
        return {'kind':'publish_artifact','target':result['target'],'body':result['body']}
    fake=CheckedProvider([choose,revise]); w=worker(context,fake,tmp_path)
    def hook(name):
        if name==('after_tool_result' if when=='after_read' else when): alter()
    w.phases.hook=hook
    with pytest.raises(DomainError) as exc: w.work(p,ws,q.run.id)
    assert exc.value.code.value in ('source_changed','version_conflict','not_found_or_not_authorized','action_unresolved')
    with Database(admin).transaction() as c:
        assert c.execute('SELECT count(*) n FROM proposals WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
        reads=c.execute("SELECT data FROM responses_events WHERE kind='tool_result' AND data->'capability_result'->>'capability'='read_saved_work' AND attempt_id IN (SELECT id FROM provider_attempts WHERE workspace_id=%s)",(ws,)).fetchall()
        assert bool(reads)==(when!='before_read')


@pytest.mark.parametrize('invalid',['unread','cross_conversation','explicit_switch','wrong_hash'])
def test_retrieval_cannot_widen_scope_or_publish_unread(context,tmp_path,invalid):
    s,p,ws,_,_=context
    cv,a=large_work(context)
    if invalid=='cross_conversation': _,other=large_work(context)
    else: other=a
    explicit=None
    if invalid=='explicit_switch':
        from workagent.general_worker import GeneralWorker, ControlledTransport
        q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Create other',operation={'kind':'publish_artifact','body':document()}))
        GeneralWorker(s,transport=ControlledTransport()).work(p,ws,q.run.id)
        detail=s.get_conversation(p,ws,cv.id); cv=detail.conversation
        explicit=target(s.get_artifact(p,ws,next(i for i in detail.artifact_ids if i!=a.id)))
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Continue',target=explicit))
    selected=target(other).model_dump(mode='json')
    if invalid=='wrong_hash': selected['body_hash']='0'*64
    decision={'kind':'publish_artifact','target':selected,'body':document('Not allowed')} if invalid=='unread' else {'kind':'read_saved_work','target':selected}
    raises('not_found_or_not_authorized',lambda:worker(context,AlphaProvider([decision]),tmp_path).work(p,ws,q.run.id))


def test_read_limit_is_explicit_not_truncated_or_editable(context,tmp_path):
    s,p,ws,_,_=context
    cv,a=large_work(context,blocks=6)
    activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Review this work'))
    def stop(ctx):
        result=ctx['adaptive']['observations'][0]['capability_result']['result']
        assert result['status']=='size_limit' and result['body'] is None
        assert result['body_bytes']>32768 and result['limit_bytes']==32768
        return {'kind':'reply','text':'The saved work exceeds the bounded read limit; it was not revised.'}
    assert worker(context,AlphaProvider([read_choice,stop]),tmp_path).work(p,ws,q.run.id).state=='ready'
    assert not s.proposals(p,ws,a.id).items


def test_reads_share_one_byte_budget_and_cannot_replay_around_it(context,tmp_path):
    s,p,ws,_,_=context
    cv,a=large_work(context); activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Inspect current saved work'))
    def check(ctx):
        results=[o['capability_result']['result'] for o in ctx['adaptive']['observations']]
        assert [r['status'] for r in results]==['complete','complete','size_limit']
        assert results[-1]['body'] is None
        assert sum(r['body_bytes'] for r in results if r['status']=='complete')<=32768
        return {'kind':'reply','text':'Inspected; no changes made.'}
    fake=CheckedProvider([read_choice,read_choice,read_choice,check])
    outcome=worker(context,fake,tmp_path).work(p,ws,q.run.id)
    if fake.failures: raise fake.failures[0]
    assert outcome.state=='ready'
    assert not s.proposals(p,ws,a.id).items


def test_resume_after_retained_read_does_not_repeat_read(context,tmp_path):
    s,p,ws,_,_=context
    cv,a=large_work(context); activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Propose a clearer title, keep all content'))
    def revise(ctx):
        result=ctx['adaptive']['observations'][0]['capability_result']['result']
        body=copy.deepcopy(result['body']); body['title']='A clearer title'
        return {'kind':'publish_artifact','target':result['target'],'body':body}
    fake=CheckedProvider([read_choice,revise]); w=worker(context,fake,tmp_path)
    def stop(name):
        if name=='after_tool_result': raise RuntimeError('controlled restart after read retention')
    w.phases.hook=stop
    with pytest.raises(RuntimeError,match='controlled restart'): w.work(p,ws,q.run.id)
    assert len(fake.contexts)==1
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert len(fake.contexts)==3  # read selection, edit selection, final explanation
    proposal=s.proposals(p,ws,a.id).items[0]
    assert proposal.body.blocks==a.current_revision.body.blocks


@pytest.mark.parametrize('mutation',['body','target','bytes','limit','remaining','provenance','author','base','completion','receipt_rehashed','receipt_without_automatic','null_terminal','attempt_id','request_hash','decision_hash','operation_hash'])
def test_sql_refuses_forged_saved_read_evidence(context,tmp_path,monkeypatch,mutation):
    import psycopg
    from workagent.responses_ledger import Ledger
    from workagent.service import encoded
    from workagent.models import new_id
    s,p,ws,_,_=context
    cv,a=large_work(context); activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Inspect this saved work'))
    captured={}; original=Ledger.event
    def intercept(self,c,phase,kind,data):
        if kind=='tool_result':
            captured.update(attempt=self.receipt.attempt_id,phase=phase,data=copy.deepcopy(data))
            raise RuntimeError('controlled before read retention')
        return original(self,c,phase,kind,data)
    monkeypatch.setattr(Ledger,'event',intercept)
    with pytest.raises(RuntimeError,match='controlled before read retention'):
        worker(context,CheckedProvider([read_choice]),tmp_path).work(p,ws,q.run.id)
    value=captured['data']; result=value['capability_result']['result']
    if mutation=='body': result['body']['blocks'][-1]['text']='Forged human note'
    elif mutation=='target': result['target']['revision_id']=new_id()
    elif mutation=='bytes': result['body_bytes']=1
    elif mutation=='limit': result['limit_bytes']=999999
    elif mutation=='remaining': result['remaining_bytes']=32768
    elif mutation=='provenance': result['provenance']='model_guess'
    elif mutation=='author': result['author_kind']='worker'
    elif mutation=='base': value['binding']['base_hash']='0'*64
    elif mutation in ('receipt_rehashed','receipt_without_automatic','attempt_id','request_hash','decision_hash','operation_hash'):
        from workagent.service import digest
        key={'attempt_id':'attempt_id','request_hash':'selection_request_sha256','decision_hash':'decision_sha256','operation_hash':'operation_hash'}.get(mutation,'selection_response_id')
        value['binding'][key]='f'*64
        if mutation=='receipt_without_automatic': value['verification'].pop('automatic',None)
        else: value['verification']['automatic']['staged_sha256']=digest({k:value[k] for k in ('status','body','file','output','binding')})
    elif mutation=='null_terminal': value['terminal_outcome']=None
    else: value['verification']['satisfied']=True
    with pytest.raises(psycopg.errors.RaiseException):
        with s.db.transaction() as c:
            c.execute('INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,%s,%s,%s)',
                (new_id(),captured['attempt'],captured['phase'],'tool_result',encoded(value)))
    assert not s.proposals(p,ws,a.id).items


@pytest.mark.parametrize('mutation',['omit','change','rename','unprotect'])
def test_model_cannot_remove_or_change_protected_human_note(context,tmp_path,mutation):
    s,p,ws,_,_=context
    cv,a=large_work(context); activate(context,cv)
    q=s.post_message(p,ws,cv.id,cmd(PostMessage,expected_work_version=cv.work_version,text='Shorten the first section; keep my note'))
    def revise(ctx):
        result=ctx['adaptive']['observations'][0]['capability_result']['result']
        body=copy.deepcopy(result['body'])
        if mutation=='omit': body['blocks']=body['blocks'][:-1]
        elif mutation=='change': body['blocks'][-1]['text']='Changed note'
        elif mutation=='rename': body['blocks'][-1]['block_id']='another-id'
        else: body['blocks'][-1]['kind']='paragraph'
        return {'kind':'publish_artifact','target':result['target'],'body':body}
    def recover(ctx):
        assert ctx['adaptive']['observations'][-1]['status']=='rejected'
        return {'kind':'stop','outcome':'blocked','text':'The proposed change did not preserve your protected note; no revision was proposed.'}
    fake=CheckedProvider([read_choice,revise,recover]); outcome=worker(context,fake,tmp_path).work(p,ws,q.run.id)
    if fake.failures: raise fake.failures[0]
    assert not s.proposals(p,ws,a.id).items
    assert s.get_artifact(p,ws,a.id).current_revision_id==a.current_revision_id
