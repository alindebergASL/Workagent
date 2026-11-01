"""Offline exact-request cursor and internal native admission transaction controls."""
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace as NS
import json
import pytest
from workagent import adaptive, general_responses, file_input_rejection, selection_rejection
from workagent.general_worker import GeneralWorker
from workagent.responses_transport import build_tool_selection, RequestMetadata
from workagent.service import canonical, digest
from workagent.errors import DomainError
from workagent.capabilities import registry, policy, implementation_releases
from workagent.capabilities.broker import CapabilityBroker, NativeAdmissionDeferred
from workagent.capabilities.models import ToolCallV1


class Rows:
    def __init__(self, values): self.values=values
    def fetchall(self): return self.values
    def fetchone(self): return self.values[0] if self.values else None


def chain(monkeypatch, *, count=2, terminal='continue', rejection=None):
    cap=NS(run_id='run',workspace_id='ws',fence=3)
    receipt=NS(attempt_id='attempt')
    value=dict(goal='Keep distinctive goal 27',success_criteria=[dict(kind='wasm_return',arguments=[2],expected='4')],
               decision=dict(kind='reply',text='Retained answer'))
    rows=[];events={};observations=[];checks=[];native=[]
    for index in range(1,count+1):
        phase=adaptive.phase_name(index)
        ctx=adaptive.continuation_context(dict(run_id='run'),deepcopy(observations),8)
        request=build_tool_selection(instructions=adaptive.POLICY,source_context=canonical(ctx),read_schema=adaptive.DECISION_SCHEMA,
            metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id=phase),policy=adaptive.CAPABILITY,phase=phase)
        from hashlib import sha256
        row=dict(phase=phase,request_bytes=request.body.decode(),request_sha256=request.sha256,
            count_bytes=request.count_body().decode(),count_sha256=sha256(request.count_body()).hexdigest(),
            grant_id='grant',metadata=request.metadata.model_dump())
        rows.append(row);binding=dict(phase=phase)
        stage=dict(binding=binding,status='reply',terminal_outcome=terminal if index==count else 'continue',
            goal=value['goal'],success_criteria=value['success_criteria'],decision=value['decision'],verification={})
        result=dict(request_sha256=request.sha256,metadata=request.metadata.model_dump(),response_id='resp_'+phase,
            provenance=dict(mode='synthetic',origin='local'),state='function_call',usage=dict(input_tokens=10,output_tokens=10,
            total_tokens=20,cached_input_tokens=0,reasoning_tokens=0),value=deepcopy(value),call_id='call_'+phase,
            output_items=canonical([dict(type='function_call',name='choose_general_action',call_id='call_'+phase,arguments=canonical(value))]),issue=None)
        e=dict(count_send={},count_result=dict(request_sha256=request.sha256,metadata=request.metadata.model_dump(),count_sha256=row['count_sha256']),
            dispatch={},identity=dict(request_sha256=request.sha256,metadata=request.metadata.model_dump(),response_id=result['response_id']),result=result,tool_result=stage)
        if rejection and index==count:
            del e['tool_result']
            e[rejection]=dict(terminal_outcome=terminal,feedback=dict(detail='exact rejection'))
            if rejection=='selection_rejection':result.update(state='malformed',value=None,issue='schema_validation_failed')
        events[phase]=e
        observations.append(dict(phase=phase,**stage) if 'tool_result' in e else dict(phase=phase,kind=rejection,status='rejected',**e[rejection]))
    class Conn:
        def execute(self,sql,args=None):
            if 'responses_steps' in sql:return Rows(rows)
            if 'tool_attempts' in sql:return Rows(native)
            if 'provider_grants' in sql:return Rows([dict(data={})])
            raise AssertionError(sql)
    @contextmanager
    def tx():yield Conn()
    service=NS(db=NS(transaction=tx),get_run=lambda *a:NS(state='running'))
    ledger=NS(receipt=receipt,_auth=lambda *a:checks.append('auth'),_events=lambda c,p:deepcopy(events[p]))
    def resolved(s,c,k,r,p):
        checks.append(p)
        result=events[p]['result']['value']
        assert result['goal']==value['goal'] and result['success_criteria']==value['success_criteria']
        return None,NS(),None,None,None,dict(phase=p),None
    monkeypatch.setattr(general_responses,'resolve_selection',resolved)
    monkeypatch.setattr(adaptive,'retained',lambda *a,**kw:deepcopy(observations))
    for mod,kind in ((file_input_rejection,'file_input_rejection'),(selection_rejection,'selection_rejection')):
        def retain(ledger,request,cap,kind=kind):
            checks.append(kind);return deepcopy(events[request.phase][kind])
        monkeypatch.setattr(mod,'retain',retain)
    w=GeneralWorker.__new__(GeneralWorker);w.service=service
    cfg=dict(grant_id='grant',responses=dict(max_steps=8))
    return NS(w=w,cap=cap,ledger=ledger,config=cfg,rows=rows,events=events,checks=checks,native=native,observations=observations)


def cursor(f):return f.w._prepared_selection(f.ledger,f.cap,f.config,adaptive.DECISION_SCHEMA,resume_settled=True)


@pytest.mark.parametrize('terminal',['continue','answered','step_limit','blocked'])
def test_offline_settled_cursor_preserves_exact_chain(monkeypatch,terminal):
    f=chain(monkeypatch,terminal=terminal);before=deepcopy((f.rows,f.events))
    request,index,settled=cursor(f)
    assert index==2 and request.body==f.rows[1]['request_bytes'].encode()
    assert settled[0].value.goal=='Keep distinctive goal 27' and settled[0].value.success_criteria
    assert settled[1]['terminal_outcome']==terminal and settled[2] is None
    assert [x for x in f.checks if x.startswith('selection')]==['selection','selection_2']
    assert (f.rows,f.events)==before


@pytest.mark.parametrize('damage',['missing_phase','missing_result','missing_usage','count_hash','request_hash','identity','binding','projection','criteria_projection','terminal_prefix','native_unknown','native_cost_only','native_reserved','authority'])
def test_offline_settled_cursor_denials(monkeypatch,damage):
    f=chain(monkeypatch);e=f.events['selection']
    if damage=='missing_phase':f.rows.pop(0)
    elif damage=='missing_result':e.pop('result')
    elif damage=='missing_usage':e['result']['usage']=None
    elif damage=='count_hash':e['count_result']['count_sha256']='0'*64
    elif damage=='request_hash':f.rows[0]['request_sha256']='0'*64
    elif damage=='identity':e['identity']['response_id']='resp_wrong'
    elif damage=='binding':e['tool_result']['binding']={'wrong':True}
    elif damage=='projection':f.observations[0]['goal']='changed goal'
    elif damage=='criteria_projection':f.observations[0]['success_criteria']=[]
    elif damage=='terminal_prefix':e['tool_result']['terminal_outcome']='answered'
    elif damage.startswith('native_'):f.native.append(dict(data=None if damage=='native_reserved' else dict(status=damage[7:])))
    else:monkeypatch.setattr(general_responses,'resolve_selection',lambda *a:(_ for _ in ()).throw(DomainError('source_changed')))
    with pytest.raises(DomainError):cursor(f)


@pytest.mark.parametrize('kind',['selection_rejection','file_input_rejection'])
@pytest.mark.parametrize('terminal',['continue','step_limit'])
def test_offline_rejection_cursor_revalidates_without_retain_write(monkeypatch,kind,terminal):
    f=chain(monkeypatch,rejection=kind,terminal=terminal)
    before=deepcopy(f.events);_,index,settled=cursor(f)
    assert index==2 and settled[2]==kind and settled[1]['terminal_outcome']==terminal
    assert f.checks.count(kind)==1 and f.events==before


def test_offline_received_unapplied_stays_at_current_phase(monkeypatch):
    f=chain(monkeypatch);f.events['selection_2'].pop('tool_result');f.observations.pop()
    request,index,settled=cursor(f)
    assert index==2 and request.phase=='selection_2' and settled is None
    assert 'selection' in f.checks and 'selection_2' not in f.checks


@pytest.mark.parametrize('terminal',['continue','answered'])
def test_offline_actual_loop_skips_settled_step_and_stage(monkeypatch,terminal):
    from workagent.models import ProviderGrant
    f=chain(monkeypatch,terminal=terminal);prepared=[];stepped=[]
    monkeypatch.setattr(ProviderGrant,'model_validate',lambda *a: NS(responses=None))
    monkeypatch.setattr(adaptive,'contract',lambda _: (adaptive.POLICY,adaptive.DECISION_SCHEMA))
    monkeypatch.setattr(adaptive,'stage_product',lambda *a:pytest.fail('settled stage replay'))
    f.ledger.snapshot=lambda phase,cap:(None,{})
    f.ledger.prepare=lambda request,cap:prepared.append(request)
    f.w.service.conversation_worker_context=lambda cap:dict(run_id='run')
    f.w.phases=NS(_step=lambda ledger,request,cap,deadline:stepped.append(request.phase),_hook=lambda *a:None)
    result=f.w._adaptive_work(None,'ws',NS(id='run'),f.cap,f.ledger.receipt,f.ledger,None,f.config,999,resume_final=False)
    expected='selection_3' if terminal=='continue' else 'final'
    assert result.state=='running' and stepped==[expected] and [r.phase for r in prepared]==[expected]
    if terminal=='continue':
        projection=json.loads(json.loads(prepared[0].body)['input'][0]['content'])['adaptive']
        assert projection['observations'][0]['goal']=='Keep distinctive goal 27'
        assert projection['observations'][0]['success_criteria']


@pytest.mark.parametrize('defer',[True,False])
def test_offline_actual_worker_catches_only_pre_effect_deferral(monkeypatch,defer):
    from workagent.models import ProviderGrant
    from workagent.responses_transport import PreparedRequest
    from workagent.responses_ledger import restore_result
    f=chain(monkeypatch,count=1);row=f.rows[0];f.events['selection'].pop('tool_result');f.observations.clear()
    request=PreparedRequest(row['request_bytes'].encode(),RequestMetadata.model_validate(row['metadata']),
                            'selection',adaptive.DECISION_SCHEMA,adaptive.CAPABILITY)
    monkeypatch.setattr(ProviderGrant,'model_validate',lambda *a:NS(responses=None))
    monkeypatch.setattr(adaptive,'contract',lambda _:(adaptive.POLICY,adaptive.DECISION_SCHEMA))
    monkeypatch.setattr(file_input_rejection,'retain',lambda *a:None)
    calls=[]
    def stage(*args):
        calls.append(args[-1])
        if defer:raise NativeAdmissionDeferred()
        raise DomainError('not_found_or_not_authorized')
    monkeypatch.setattr(adaptive,'stage_product',stage)
    f.ledger.snapshot=lambda *a:(request,f.events['selection'])
    f.w.phases=NS(_step=lambda *a:restore_result(f.events['selection']['result'],request),_hook=lambda *a:None)
    run=lambda:f.w._adaptive_work(None,'ws',NS(id='run'),f.cap,f.ledger.receipt,f.ledger,None,f.config,999,resume_final=False)
    if defer:assert run().state=='running'
    else:
        with pytest.raises(DomainError):run()
    assert calls==['selection']


class BrokerDB:
    def __init__(self,remaining):
        self.remaining=remaining;self.attempt=None;self.events={};self.costs=[];self.trace=[]
    @contextmanager
    def transaction(self):
        old=deepcopy((self.attempt,self.events,self.costs));self.trace.append('begin')
        try:yield self
        except BaseException:
            self.attempt,self.events,self.costs=old;self.trace.append('rollback');raise
        else:self.trace.append('commit')
    def execute(self,sql,args=None):
        if sql.startswith('SELECT id FROM tool_attempts'):return Rows([dict(id=self.attempt)] if self.attempt else [])
        if "kind='observation'" in sql:return Rows([dict(data=self.events['observation'])] if 'observation' in self.events else [])
        if 'clock_timestamp()' in sql:self.trace.append('clock');return Rows([dict(remaining=self.remaining)])
        if 'dispatch_tool_call' in sql:
            sent='dispatch' not in self.events
            if sent:self.events['dispatch']={}
            self.trace.append('dispatch');return Rows([dict(sent=sent)])
        if 'scope_sha256' in sql:return Rows([dict(scope_sha256='0'*64)])
        if 'settle_tool_call' in sql:
            raw=args[2];data=json.loads(raw) if isinstance(raw,str) else raw.obj
            self.events['observation']=data;self.costs.append('settle');return Rows([dict(observation=data)])
        raise AssertionError(sql)


def broker_fixture(monkeypatch,remaining=40,*,existing=False,fail_auth=0):
    db=BrokerDB(remaining);auth=[];invoked=[];ds=registry.adapters();adapter=ds['files.list']
    def invoke(*args):invoked.append(True);return dict(capability='files_list',version='1',result=dict(items=[],next_after=None))
    ds['files.list']=replace(adapter,invoke_fenced=invoke)
    monkeypatch.setattr(registry,'adapters',lambda:ds)
    def authorize(*a):
        auth.append(True);db.trace.append('authorize')
        if len(auth)==fail_auth:raise DomainError('not_found_or_not_authorized')
    def reserve(*a):
        db.trace.append('reserve');db.attempt=db.attempt or 'attempt';db.costs.append('reserve');return db.attempt
    monkeypatch.setattr(policy,'authorize',authorize)
    monkeypatch.setattr(implementation_releases,'reserve',reserve)
    monkeypatch.setattr(implementation_releases,'require_dispatch',lambda *a:db.trace.append('release'))
    if existing:db.attempt='attempt';db.events['dispatch']={}
    cap=NS(workspace_id='ws',run_id='run',fence=3,secret='synthetic')
    call=ToolCallV1(call_id='selection_2',capability_id='files.list',capability_version=adapter.descriptor.version,
        arguments=dict(kind='files_list',after=None,limit=10),input_refs=[],expected_work_version=1)
    return NS(db=db,broker=CapabilityBroker(NS(db=db),cap),call=call,auth=auth,invoked=invoked)


@pytest.mark.parametrize('remaining',[0,6,34.999,35])
def test_offline_native_admission_atomic_rollback(monkeypatch,remaining):
    f=broker_fixture(monkeypatch,remaining)
    with pytest.raises(NativeAdmissionDeferred):f.broker.call(f.call)
    assert f.db.attempt is None and f.db.events=={} and f.db.costs==[] and f.invoked==[]
    assert f.db.trace==['begin','authorize','reserve','authorize','release','clock','rollback']


def test_offline_native_admission_fresh_clock_after_slow_authority(monkeypatch):
    f=broker_fixture(monkeypatch);authorize=policy.authorize
    def slow(*a):
        authorize(*a)
        if len(f.auth)==2:f.db.remaining=6
    monkeypatch.setattr(policy,'authorize',slow)
    with pytest.raises(NativeAdmissionDeferred):f.broker.call(f.call)
    assert not f.db.attempt and not f.invoked


@pytest.mark.parametrize('post_revoke',[False,True])
def test_offline_native_admission_commit_then_observe_or_cost_only(monkeypatch,post_revoke):
    f=broker_fixture(monkeypatch,35.001,fail_auth=3 if post_revoke else 0)
    result=f.broker.call(f.call)
    assert result.status==('cost_only' if post_revoke else 'observed')
    assert f.invoked==[True] and f.db.trace.index('dispatch')<f.db.trace.index('commit')
    if post_revoke:assert result.output is None and result.error.code=='authority_changed'


@pytest.mark.parametrize('fail_auth',[1,2])
def test_offline_native_denial_is_not_deferral(monkeypatch,fail_auth):
    f=broker_fixture(monkeypatch,6,fail_auth=fail_auth)
    with pytest.raises(DomainError):f.broker.call(f.call)
    assert not f.db.attempt and not f.invoked


def test_offline_existing_unknown_never_admission_defers_or_resends(monkeypatch):
    f=broker_fixture(monkeypatch,6,existing=True)
    with pytest.raises(DomainError) as exc:f.broker.call(f.call)
    assert exc.value.code.value=='action_unresolved' and not f.invoked and 'clock' not in f.db.trace


def test_offline_pg_distinct_provider_actual_response_contract():
    import httpx
    from test_durable_boundary_pg import DistinctProvider, GOAL, CRITERIA
    request=build_tool_selection(instructions=adaptive.POLICY,source_context=canonical(dict(run_id='run',messages=[])),
        read_schema=adaptive.DECISION_SCHEMA,metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id='selection'),
        policy=adaptive.CAPABILITY,phase='selection')
    fake=DistinctProvider([dict(kind='reply',text='Synthetic fixture answer')])
    response=fake.handle(httpx.Request('POST','https://synthetic.invalid/v1/responses',content=request.body)).json()
    value=json.loads(response['output'][0]['arguments'])
    adaptive.DECISION_SCHEMA.model.model_validate(value,strict=True)
    assert value['goal']==GOAL and value['success_criteria']==CRITERIA
    assert fake.responses[response['id']]==response and response['status']=='completed' and response['usage']
