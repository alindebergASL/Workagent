"""Independent review regressions: real restricted-role SQL and fake Responses.

Synthetic provider receipts exercise the production worker; no provider/network.
"""
from copy import deepcopy
from types import SimpleNamespace
import psycopg
import pytest
from test_domain import context, cmd
from test_responsibility_action_authority import pause_before_stage
from test_responsibility_action import record
from test_general_alpha_runtime import AlphaProvider, activate
from test_general_responses import worker, totals
from test_conversations import conversation, post
from test_runtime import expire
from test_bounded_verifier_pure import GOAL, CSV
from workagent.message_models import AttachmentInput
from workagent.responses_ledger import Ledger
from workagent.service import encoded
from workagent.provider_attempts import revoke_grant
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import new_id


def capture(context, tmp_path, monkeypatch):
    s,p,ws,_,_=context
    cv,g,q,fake,w,cap,receipt=pause_before_stage(context,tmp_path)
    got={}
    def capture_event(self,c,phase,kind,data):
        assert kind=='tool_result'
        got['stage']=deepcopy(data)
        got['assignment']=c.execute('SELECT * FROM assignments WHERE workspace_id=%s AND responsibility_recording IS NOT NULL',(ws,)).fetchone()
        got['conversation']=c.execute('SELECT data FROM conversations WHERE workspace_id=%s AND id=%s',(ws,cv.id)).fetchone()['data']
        raise RuntimeError('capture rollback')
    with monkeypatch.context() as m:
        m.setattr(Ledger,'event',capture_event)
        with pytest.raises(RuntimeError,match='capture rollback'):
            s.stage_general_product(cap,receipt)
    assert not s.get_conversation(p,ws,cv.id).assignment_ids
    return s,p,ws,cv,g,q,receipt,got


def raw_receipt(c,receipt,got):
    c.execute("INSERT INTO responses_events(id,attempt_id,phase,kind,data) VALUES (%s,%s,%s,'tool_result',%s)",
        (new_id(),receipt.attempt_id,got.get('phase','selection'),encoded(got['stage'])))


def capture_next_receipt(context,tmp_path,monkeypatch):
    """A genuine second selection receipt, not a duplicate journal primary key."""
    s,p,ws,_,_=context
    cv,g,q,fake,w,cap,receipt=pause_before_stage(context,tmp_path,[record,record])
    s.stage_general_product(cap,receipt)
    got={}; original=Ledger.event
    def capture_event(self,c,phase,kind,data):
        if kind!='tool_result' or phase!='selection_2': return original(self,c,phase,kind,data)
        got.update(stage=deepcopy(data),phase=phase)
        raise RuntimeError('capture second receipt rollback')
    with monkeypatch.context() as m:
        m.setattr(Ledger,'event',capture_event)
        with pytest.raises(RuntimeError,match='capture second receipt rollback'): w.work(p,ws,q.run.id)
    assert got['phase']=='selection_2'
    return s,p,ws,cv,g,q,receipt,got


def raw_apply(c,ws,cv,receipt,got):
    a=got['assignment']
    c.execute('INSERT INTO assignments(workspace_id,id,conversation_id,data,responsibility_lifecycle) VALUES (%s,%s,%s,%s,%s)',
        (ws,a['id'],cv.id,encoded(a['data']),encoded(a['responsibility_lifecycle'])))
    c.execute('UPDATE conversations SET data=%s WHERE workspace_id=%s AND id=%s',(encoded(got['conversation']),ws,cv.id))
    c.execute('UPDATE assignments SET responsibility_recording=%s WHERE workspace_id=%s AND id=%s',
        (encoded(a['responsibility_recording']),ws,a['id']))
    raw_receipt(c,receipt,got)


@pytest.mark.parametrize('isolation',['REPEATABLE READ','SERIALIZABLE'])
@pytest.mark.parametrize('boundary',['recording','receipt'])
def test_stale_snapshot_cannot_commit_recording_or_receipt(context,tmp_path,monkeypatch,isolation,boundary):
    s,p,ws,cv,g,q,receipt,got=(capture_next_receipt(context,tmp_path,monkeypatch)
        if boundary=='receipt' else capture(context,tmp_path,monkeypatch))
    # Explicit commit is inside the rejection assertion; no deferred failure is ignored.
    with pytest.raises(psycopg.Error,match='responsibility.*read committed'):
        with s.db.transaction() as c:
            c.execute('SET TRANSACTION ISOLATION LEVEL '+isolation)
            assert c.execute('SELECT active FROM provider_grants WHERE id=%s',(g.id,)).fetchone()['active']
            assert revoke_grant(Database(context[4]),g.id)
            if boundary=='recording': raw_apply(c,ws,cv,receipt,got)
            else: raw_receipt(c,receipt,got)
            c.commit()
    with s.db.transaction() as c:
        assert not c.execute('SELECT active FROM provider_grants WHERE id=%s',(g.id,)).fetchone()['active']
        expected=int(boundary=='receipt')
        assert c.execute('SELECT count(*) n FROM assignments WHERE workspace_id=%s AND responsibility_recording IS NOT NULL',(ws,)).fetchone()['n']==expected
        assert c.execute("SELECT count(*) n FROM responses_events WHERE attempt_id=%s AND kind='tool_result'",(receipt.attempt_id,)).fetchone()['n']==expected


@pytest.mark.parametrize('fault',['identity','conversation','lifecycle_removed','json_identity','json_scope'])
def test_recording_stays_bound_to_canonical_assignment(context,tmp_path,monkeypatch,fault):
    s,p,ws,cv,g,q,receipt,got=capture(context,tmp_path,monkeypatch)
    with s.db.transaction() as c: raw_apply(c,ws,cv,receipt,got)
    aid=got['assignment']['id']
    other=conversation(context) if fault=='conversation' else None
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            if fault=='identity':
                c.execute('UPDATE assignments SET id=%s WHERE workspace_id=%s AND id=%s',('moved-'+aid,ws,aid))
            elif fault=='conversation':
                c.execute('UPDATE assignments SET conversation_id=%s WHERE workspace_id=%s AND id=%s',(other.id,ws,aid))
            elif fault=='lifecycle_removed':
                c.execute('UPDATE assignments SET responsibility_lifecycle=NULL WHERE workspace_id=%s AND id=%s',(ws,aid))
            else:
                key='id' if fault=='json_identity' else 'conversation_id'
                c.execute('UPDATE assignments SET data=jsonb_set(data,%s,%s) WHERE workspace_id=%s AND id=%s',([key],encoded('detached'),ws,aid))
            c.commit()
    with s.db.transaction() as c:
        row=c.execute('SELECT * FROM assignments WHERE workspace_id=%s AND id=%s',(ws,aid)).fetchone()
        assert row==got['assignment']


@pytest.mark.parametrize('fault',['string_version','null_version','fraction_version','bool_version','extra_effect_key','missing_result','null_effect','extra_result_key','null_binding','extra_binding_key','null_request'])
def test_closed_recording_shape_rejected_at_commit(context,tmp_path,monkeypatch,fault):
    s,p,ws,cv,g,q,receipt,got=capture(context,tmp_path,monkeypatch)
    effect=got['assignment']['responsibility_recording']
    if fault=='string_version': effect['conversation_work_version']=str(effect['conversation_work_version'])
    elif fault=='null_version': effect['conversation_work_version']=None
    elif fault=='fraction_version': effect['conversation_work_version']=2.5
    elif fault=='bool_version': effect['conversation_work_version']=True
    elif fault=='extra_effect_key': effect['grant_id']='invented-authority'
    elif fault=='missing_result': del effect['result']
    elif fault=='null_effect': got['assignment']['responsibility_recording']=None
    elif fault=='extra_result_key': effect['result']['completed']=True
    elif fault=='null_binding': effect['binding']=None
    elif fault=='extra_binding_key': effect['binding']['grant_id']='invented'
    elif fault=='null_request': effect['request']=None
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            raw_apply(c,ws,cv,receipt,got)
            c.commit()
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) n FROM assignments WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
        assert c.execute("SELECT count(*) n FROM responses_events WHERE attempt_id=%s AND kind='tool_result'",(receipt.attempt_id,)).fetchone()['n']==0


@pytest.mark.parametrize('fault',['string_version','null_version','extra_key','missing_result','null_result','detached','missing_lifecycle'])
def test_malformed_persisted_recording_denied_at_read(context,tmp_path,monkeypatch,fault):
    from workagent.responsibility_action import recording, offer
    s,p,ws,cv,g,q,receipt,got=capture(context,tmp_path,monkeypatch)
    row=deepcopy(got['assignment']); effect=row['responsibility_recording']
    if fault=='string_version': effect['conversation_work_version']=str(effect['conversation_work_version'])
    elif fault=='null_version': effect['conversation_work_version']=None
    elif fault=='extra_key': effect['extra']=True
    elif fault=='missing_result': del effect['result']
    elif fault=='null_result': effect['result']=None
    elif fault=='detached': row['id']='missing'
    else: row['responsibility_lifecycle']=None
    # Legacy/corrupt read fixture only: never disable a SQL trigger or relax authority.
    class Read:
        def execute(self,*args): return self
        def fetchone(self): return row
    run=SimpleNamespace(workspace_id=ws,id=q.run.id,conversation_id=cv.id,principal_id=p.id)
    with pytest.raises(DomainError): recording(Read(),run)
    with pytest.raises(DomainError): offer(Read(),run,cv,SimpleNamespace(author_kind='human'),{})


@pytest.mark.parametrize('operation',['csv','team'])
@pytest.mark.parametrize('interrupt',[None,'after_tool_result','before_publication'])
def test_record_then_verified_local_work_and_recovery(context,tmp_path,operation,interrupt):
    from test_team_verifier_pure import GOAL as TEAM_GOAL, GOOD
    s,p,ws,_,_=context
    cv=conversation(context); g=activate(context,cv)
    q=post(context,cv,GOAL if operation=='csv' else TEAM_GOAL,
        attachments=[AttachmentInput(filename='input.csv',mime_type='text/csv',content=CSV)] if operation=='csv' else [])
    def calculate(ctx):
        if operation=='team':
            return {'kind':'run_wasm','target':None,'code':GOOD,'entrypoint':'choose','arguments':[60,30],
                'input_form':[{'name':'n','label':'Candidates'},{'name':'k','label':'People'}]}
        msg=next(m for m in ctx['messages'] if m['run_id']==ctx['run_id'] and m['author_kind']=='human')
        attachment=msg['attachments'][0]
        return {'kind':'reconcile_csv','attachment':{k:attachment[k] for k in ('ref','sha256')},'target':None,'rounding':'ROUND_HALF_UP'}
    fake=AlphaProvider([record,calculate]); w=worker(context,fake,tmp_path)
    fired=[]
    def crash(name):
        if name==interrupt and not fired:
            if name=='after_tool_result':
                detail=s.get_conversation(p,ws,cv.id)
                if len(detail.turns[0].adaptive.steps)<2: return
            fired.append(name)
            raise RuntimeError('lost verified-local ACK')
    if interrupt:
        w.phases.hook=crash
        with pytest.raises(RuntimeError,match='lost verified-local ACK'): w.work(p,ws,q.run.id)
        before=s.get_conversation(p,ws,cv.id)
        assert len(before.assignment_ids)==1 and not before.artifact_ids
        assert before.turns[0].adaptive.steps[-1].verification.automatic.passed
        expire(context,q.run.id)
        w=worker(context,fake,tmp_path)
    assert w.work(p,ws,q.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id); turn=detail.turns[0]
    assert len(detail.assignment_ids)==1 and len(detail.artifact_ids)==2
    assert len(turn.adaptive.steps)==2 and turn.adaptive.outcome=='needs_validation'
    verified=turn.adaptive.steps[-1]
    assert verified.outcome=='completed' and verified.verification.satisfied
    assert verified.verification.automatic.passed and verified.verification.automatic.failures==[]
    assert turn.responsibility_recording.outcome_status=='unverified'
    life=s.get_responsibility(p,ws,detail.assignment_ids[0])
    assert life.lifecycle.outcome_status=='unverified' and life.lifecycle.state=='waiting_person'
    assert life.lifecycle.execution_status=='not_admitted' and not life.assignment.run_ids
    assert turn.retained_local_result.published and turn.explanation.published
    assert 'Verified all ' in detail.messages[-1].text and 'Local responsibility recorded' in detail.messages[-1].text
    assert 'outcome still needs validation' in detail.messages[-1].text
    calls=list(fake.calls); budget=totals(s,g)
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert fake.calls==calls and totals(s,g)==budget
    assert s.get_conversation(p,ws,cv.id).artifact_ids==detail.artifact_ids
    assert budget['request_counts']['dispatch']==3


def test_recording_allows_human_goal_version_and_lifecycle_edits(context,tmp_path,monkeypatch):
    from workagent.responsibility_models import UpdateResponsibility, ControlResponsibility
    from workagent.responsibility_action import recording, offer
    s,p,ws,cv,g,q,receipt,got=capture(context,tmp_path,monkeypatch)
    with s.db.transaction() as c: raw_apply(c,ws,cv,receipt,got)
    aid=got['assignment']['id']; original=got['assignment']['responsibility_recording']
    with s.db.transaction() as c:
        c.execute("UPDATE assignments SET data=jsonb_set(jsonb_set(data,'{goal}',%s),'{work_version}',to_jsonb((data->>'work_version')::int+1)) WHERE workspace_id=%s AND id=%s",
            (encoded('Human-edited ongoing goal'),ws,aid))
    human=s.get_responsibility(p,ws,aid)
    assert human.assignment.goal=='Human-edited ongoing goal'
    updated=record()['plan']; updated['current_outcome']='A human updated the local plan.'
    human=s.update_responsibility(p,ws,aid,cmd(UpdateResponsibility,
        expected_work_version=human.assignment.work_version,**updated))
    for operation in ('pause','resume','cancel'):
        human=s.control_responsibility(p,ws,aid,cmd(ControlResponsibility,
            expected_work_version=human.assignment.work_version,operation=operation))
    assert human.lifecycle.state=='cancelled' and human.assignment.goal=='Human-edited ongoing goal'
    run=s.get_run(p,ws,q.run.id)
    with s.db.transaction() as c:
        assert recording(c,run)==original
        with pytest.raises(DomainError,match='version_conflict'):
            offer(c,run,s.get_conversation(p,ws,cv.id).conversation,SimpleNamespace(author_kind='human'),{})


@pytest.mark.parametrize('final_failure',[False,True])
def test_dispatcher_reports_retained_recording_without_artifact(context,tmp_path,final_failure):
    import json
    import httpx
    from workagent.responses_dispatcher import ResponsesDispatcher, general_dispatch_status
    s,p,ws,_,_=context
    cv=conversation(context); g=activate(context,cv)
    q=post(context,cv,'Track the local handoff; wait for a human update.')
    class Provider(AlphaProvider):
        def handle(self,request):
            body=json.loads(request.content) if request.content else {}
            if final_failure and request.url.path.endswith('/input_tokens') and body.get('tool_choice')=='none':
                self.calls.append(('POST',request.url.path))
                return httpx.Response(500,json={'error':{'message':'synthetic count failure'}})
            return super().handle(request)
    fake=Provider([record,{'kind':'reply','text':'Tracked locally.'}])
    d=ResponsesDispatcher(worker(context,fake,tmp_path),workspace=ws,grant_id=g.id)
    result=d.once()['results']
    assert len(result)==1 and result[0]['run_id']==q.run.id
    assert result[0]['status']==('outcome_unknown' if final_failure else 'result_needs_review')
    detail=s.get_conversation(p,ws,cv.id); turn=detail.turns[0]
    assert turn.responsibility_recording.outcome_status=='unverified'
    assert not detail.artifact_ids and not turn.retained_local_result.published
    if final_failure: assert turn.explanation is None
    else: assert turn.explanation.published and turn.state=='replied'
    calls=list(fake.calls); budget=totals(s,g)
    repeat=ResponsesDispatcher(worker(context,fake,tmp_path),workspace=ws,grant_id=g.id).once()
    assert fake.calls==calls and totals(s,g)==budget
    assert repeat['results']==([{'run_id':q.run.id,'status':'outcome_unknown'}] if final_failure else [])
