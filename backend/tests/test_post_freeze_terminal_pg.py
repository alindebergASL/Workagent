"""NEW normally provisioned restricted PG only. Scripted HTTP, never provider."""
import json
from copy import deepcopy
import httpx
import pytest
from test_domain import context
from test_conversations import conversation,post
from test_adaptive_execution import finish_safe_visits
from test_general_responses import worker,totals
from test_general_alpha_runtime import AlphaProvider,activate
from test_local_rejection_settlement import journal,requests
from test_runtime import expire
from workagent.db import Database
from workagent.errors import DomainError


class TerminalProvider(AlphaProvider):
    def __init__(self,phase,state,decisions=None):
        super().__init__(decisions or [{'kind':'reply','text':'Controlled reply.'}]);self.phase=phase;self.end=state
    def handle(self,request):
        response=super().handle(request)
        if request.method=='POST' and not request.url.path.endswith('input_tokens'):
            data=json.loads(request.content)
            if data['metadata']['step_id']==self.phase:
                result=response.json();result.update(status=self.end,output=[])
                if self.end=='incomplete':result['incomplete_details']={'reason':'max_output_tokens'}
                if self.end=='failed':result['error']={'code':'server_error'}
                self.responses[result['id']]=result
                return httpx.Response(200,json=result)
        return response


@pytest.mark.parametrize('phase,state',[('selection','incomplete'),('selection','failed'),('selection','cancelled'),('final','incomplete'),('final','failed'),('final','cancelled')])
def test_terminal_result_restart_exact_no_resend(context,tmp_path,phase,state,monkeypatch):
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,cv)
    q=post(context,cv,'Respond to the controlled request.');fake=TerminalProvider(phase,state)
    import workagent.general_responses as G
    with monkeypatch.context() as m:
        m.setattr(G,'stop_terminal_response',lambda *a:(_ for _ in ()).throw(InterruptedError('before terminal settlement')))
        with pytest.raises(InterruptedError):finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    before=journal(s,ws,q.run.id);original=requests(s,ws,q.run.id);cost=totals(s,g);sent=list(fake.calls)
    assert before[phase,'result']['state']==state
    expire(context,q.run.id)
    result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='partial' and result.stop_reason=='blocked' and state in result.unresolved[0]
    assert journal(s,ws,q.run.id)==before and requests(s,ws,q.run.id)==original and fake.calls==sent and totals(s,g)==cost
    with s.db.transaction() as c:
        cp=c.execute("SELECT data FROM run_checkpoints WHERE run_id=%s AND checkpoint_kind='settlement'",(q.run.id,)).fetchone()['data']
        assert cp['waiting']=='blocked' and cp['next_safe_action']=='await_person'
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert fake.calls==sent and journal(s,ws,q.run.id)==before
    from post_freeze_packets import collect_packet
    packet=collect_packet(s,p,ws,q.run.id)
    assert packet['state']=='partial' and packet['explanatory_unresolved'] and packet['external_unknown'] is False


def test_normal_completed_and_new_ordinary_turn(context,tmp_path):
    s,p,ws,_,_=context;cv=conversation(context);activate(context,cv)
    q=post(context,cv,'Reply.');fake=AlphaProvider([{'kind':'reply','text':'Controlled answer.'}])
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    before=journal(s,ws,q.run.id);calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready' and fake.calls==calls
    cv=s.get_conversation(p,ws,cv.id).conversation
    new=post(context,cv,'A separate ordinary next turn.')
    assert new.run.id!=q.run.id and journal(s,ws,q.run.id)==before


def test_targeted_hash_invalid_create_rejected_then_new_authorized_action(context,tmp_path):
    from test_target_create_rejection import prepare
    from test_gateway_target_rejection import material,assert_human_unchanged
    cv,q,grant,human,choice,fake=prepare(context)
    choices=deepcopy(fake.decisions);choices[0]['source']['sha256']='0'*64
    fake=AlphaProvider(choices)
    s,p,ws,_,_=context;before=material(context)
    def hook(name):
        if name=='after_selection_rejection':raise InterruptedError('strict rejection retained')
    with pytest.raises(InterruptedError):finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    events=journal(s,ws,q.run.id)
    assert events['selection','result']['state']=='malformed'
    assert ('selection','selection_rejection') in events and ('selection','file_input_rejection') not in events
    assert material(context)==before;assert_human_unchanged(context,human)
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='ready'
    assert all(journal(s,ws,q.run.id)[k]==v for k,v in events.items())
    assert material(context)==before;assert_human_unchanged(context,human)
    calls=list(fake.calls);assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='ready';assert fake.calls==calls
    with s.db.transaction() as c:assert not c.execute("SELECT 1 FROM tool_attempts WHERE run_id=%s AND call_id='selection'",(q.run.id,)).fetchone()


@pytest.mark.parametrize('kind',['terminal','targeted_input'])
def test_revoked_authority_never_becomes_rejection_or_settlement(context,tmp_path,monkeypatch,kind):
    from workagent.responses_ledger import Ledger
    from workagent.provider_attempts import ReceiptCapability
    from workagent.service import WorkerCapability
    import workagent.file_input_rejection as F
    import workagent.general_responses as G
    s,p,ws,_,admin=context
    if kind=='terminal':
        cv=conversation(context);activate(context,cv);q=post(context,cv,'Reply.')
        fake=TerminalProvider('selection','incomplete');module,name=G,'stop_terminal_response'
    else:
        from test_target_create_rejection import prepare
        cv,q,_,_,_,original=prepare(context)
        choices=deepcopy(original.decisions);choices[0]['source']['sha256']='0'*64
        fake=AlphaProvider(choices);module,name=F,'retain'
    w=worker(context,fake,tmp_path)
    original_call=getattr(module,name)
    with monkeypatch.context() as m:
        m.setattr(module,name,lambda *a:(_ for _ in ()).throw(InterruptedError()))
        with pytest.raises(InterruptedError):finish_safe_visits(context,w,q.run.id)
    state=w.phases.state.load(ws,q.run.id)
    cap=WorkerCapability(**state['worker']);receipt=ReceiptCapability(**state['receipt']);ledger=Ledger(s,receipt)
    request,_=ledger.snapshot('selection',cap)
    before=journal(s,ws,q.run.id);old_requests=requests(s,ws,q.run.id);sent=list(fake.calls)
    with Database(admin).transaction() as c:
        c.execute('UPDATE provider_grants SET active=false WHERE id=(SELECT grant_id FROM provider_attempts WHERE id=%s)',(receipt.attempt_id,))
    with pytest.raises(DomainError):
        if kind=='terminal':original_call(s,cap,receipt,'selection')
        else:original_call(ledger,request,cap)
    assert journal(s,ws,q.run.id)==before and requests(s,ws,q.run.id)==old_requests and fake.calls==sent
    assert s.get_run(p,ws,q.run.id).state=='running'


def test_partial_material_collected_without_success_then_new_turn(context,tmp_path):
    from post_freeze_packets import collect_packet
    from test_local_rejection_settlement import readiness_document
    from test_sustained_continuity import activate as activate_continuity
    s,p,ws,_,_=context;cv=conversation(context);activate_continuity(context,cv,max_steps=2)
    q=post(context,cv,'Create a local draft, then ask for review.')
    fake=AlphaProvider([dict(kind='publish_artifact',target=None,body=readiness_document()),
        dict(kind='read_context',section='messages')])
    result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='partial' and result.stop_reason=='step_limit'
    before=journal(s,ws,q.run.id);old_requests=requests(s,ws,q.run.id);sent=list(fake.calls)
    packet=collect_packet(s,p,ws,q.run.id)
    assert packet['state']=='partial' and packet['artifacts'] and packet['external_unknown'] is False
    assert packet['scoring']=='unscored' and 'goal_complete' not in packet
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial' and fake.calls==sent
    cv=s.get_conversation(p,ws,cv.id).conversation
    follow=post(context,cv,'Review the saved draft in a new bounded turn.')
    assert follow.run.id!=q.run.id and follow.run.state=='queued'
    assert journal(s,ws,q.run.id)==before and requests(s,ws,q.run.id)==old_requests


def test_terminal_after_retained_work_preserves_material(context,tmp_path):
    from test_local_rejection_settlement import readiness_document
    from test_gateway_target_rejection import material
    from post_freeze_packets import collect_packet
    from test_sustained_continuity import activate as activate_continuity
    s,p,ws,_,_=context;cv=conversation(context);activate_continuity(context,cv,max_steps=3)
    q=post(context,cv,'Prepare a document then continue.')
    fake=TerminalProvider('selection_2','incomplete',[
        dict(kind='publish_artifact',target=None,body=readiness_document()),dict(kind='reply',text='unused')])
    result=finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id)
    assert result.state=='partial' and result.stop_reason=='blocked'
    packet=collect_packet(s,p,ws,q.run.id)
    assert packet['artifacts'] and packet['explanatory_unresolved'] and not packet['external_unknown']
    saved=material(context);events=journal(s,ws,q.run.id);calls=list(fake.calls)
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert material(context)==saved and journal(s,ws,q.run.id)==events and fake.calls==calls


@pytest.mark.parametrize('phase,case',[
    ('selection','correlation'),('selection','envelope'),('selection','unknown_status'),
    ('selection','usage'),('final','correlation'),
])
def test_indeterminate_parser_result_stays_unknown_no_resend(context,tmp_path,phase,case):
    """Real worker/parser/SQL checkpoint. Controlled HTTP only; no wire provider."""
    from test_post_freeze_parser_boundary import damage_document,INDETERMINATE
    from workagent.provider_attempts import ReceiptCapability
    from workagent.service import WorkerCapability
    from workagent.responses_ledger import Ledger
    from workagent.general_responses import stop_terminal_response,terminal_failure_bound
    from workagent.run_checkpoints import record
    from post_freeze_packets import require_observed,collect_packet
    class DamagedProvider(AlphaProvider):
        def handle(self,request):
            reply=super().handle(request)
            if request.method=='POST' and not request.url.path.endswith('input_tokens'):
                if json.loads(request.content)['metadata']['step_id']==phase:
                    changed=damage_document(reply.json(),case)
                    self.responses[changed['id']]=changed
                    return httpx.Response(200,json=changed)
            return reply
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,cv)
    q=post(context,cv,'Controlled parser correlation test.')
    fake=DamagedProvider([dict(kind='reply',text='Known selection before final.')]);w=worker(context,fake,tmp_path)
    result=w.work(p,ws,q.run.id)
    assert result.state=='running'
    before=journal(s,ws,q.run.id);original=requests(s,ws,q.run.id);cost=totals(s,g);sent=list(fake.calls)
    assert before[phase,'result']['state']=='malformed' and before[phase,'result']['issue']==INDETERMINATE[case]
    state=w.phases.state.load(ws,q.run.id);cap=WorkerCapability(**state['worker']);receipt=ReceiptCapability(**state['receipt'])
    ledger=Ledger(s,receipt)
    with s.db.transaction() as c:
        step=c.execute('SELECT * FROM responses_steps WHERE attempt_id=%s AND phase=%s',(receipt.attempt_id,phase)).fetchone()
        events=ledger._events(c,phase)
        assert not terminal_failure_bound(step,events)
        with pytest.raises(DomainError,match='action_unresolved'):require_observed(step,events)
        _,run,scope=s._check_capability(c,cap)
        checkpoint=record(s,c,run,scope,phase,'stop')
        assert checkpoint.data.waiting=='unknown' and checkpoint.data.next_safe_action=='reconcile'
        assert not c.execute("SELECT 1 FROM run_checkpoints WHERE run_id=%s AND checkpoint_kind='settlement'",(q.run.id,)).fetchone()
    with pytest.raises(DomainError,match='action_unresolved'):stop_terminal_response(s,cap,receipt,phase)
    with pytest.raises(DomainError,match='action_unresolved'):collect_packet(s,p,ws,q.run.id)
    # Restart with the genuine saved capability/receipt, no fake expiry/retry.
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='running'
    assert journal(s,ws,q.run.id)==before and requests(s,ws,q.run.id)==original and totals(s,g)==cost and fake.calls==sent
