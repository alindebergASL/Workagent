"""Actual production once, fake elapsed clock, immutable synthetic row doubles."""
from contextlib import nullcontext
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace as NS
import pytest
import retained_read_visits as h
from workagent.general_worker import GeneralWorker, GENERAL_CLAIM_SECONDS
from workagent.errors import DomainError
from workagent.service import digest


def rejection_rows():
    step=dict(phase='selection',request_sha256='a'*64,count_sha256='b'*64,metadata=dict(request_id='b',attempt_id='attempt',step_id='selection'))
    result=dict(state='malformed',issue='schema_validation_failed',usage={'input_tokens':12},request_sha256=step['request_sha256'],metadata=step['metadata'],response_id='r')
    rejection=dict(version='selection-rejection/v1',attempt_id='attempt',phase='selection',result_event_id=5,
        request_sha256=step['request_sha256'],result_sha256=digest(result),response_id='r')
    data=[('count_send',{}),('count_result',dict(request_sha256=step['request_sha256'],count_sha256=step['count_sha256'],input_tokens=12)),
          ('dispatch',{}),('identity',dict(response_id='r')),('result',result),('selection_rejection',rejection)]
    return step,[dict(id=i+1,phase='selection',kind=k,data=v) for i,(k,v) in enumerate(data)]


@pytest.fixture
def f(monkeypatch):
    f=NS(t=0,phase_state='received',native_unknown=False,extra=False,calls=0,held=[],steps=[],events=[])
    start=datetime(2026,10,30,tzinfo=timezone.utc)
    monkeypatch.setattr(h,'now',lambda:start+timedelta(seconds=f.t))
    monkeypatch.setattr(h.time,'monotonic',lambda:f.t)
    monkeypatch.setattr(h.time,'sleep',lambda n:setattr(f,'t',f.t+n))
    f.run=NS(state='running',fence=2,lease_expires_at=start+timedelta(seconds=GENERAL_CLAIM_SECONDS))
    step,rows=rejection_rows();f.steps=[step];f.events=rows[:5]
    def execute(q,params=None):
        if 'FROM run_dispatches d' in q:
            v=[] if f.run.state=='ready' else [dict(workspace_id='ws',run_id='b',data=dict(principal_id='human',fence=f.run.fence))]
            if f.extra:v.append(dict(workspace_id='ws',run_id='other',data=dict(principal_id='human',fence=1)))
        elif q.startswith('SELECT id FROM provider_attempts'):v=[{'id':'attempt'}]
        elif q.startswith('SELECT phase,request_sha256'):v=f.steps
        elif q.startswith('SELECT id,phase,kind,data'):v=f.events
        elif 'pg_locks' in q:v=f.held
        elif 'FROM tool_attempt_events' in q:v=[]
        else:raise AssertionError('unexpected SQL')
        return NS(fetchall=lambda:v,fetchone=lambda:v[0] if v else None)
    service=NS(db=NS(transaction=lambda:nullcontext(NS(execute=execute))),get_run=lambda *a:f.run)
    f.worker=GeneralWorker.__new__(GeneralWorker);f.worker.service=service;f.worker.phases=NS()
    f.ctx=(service,NS(id='human'),'ws')
    monkeypatch.setattr(h,'observations',lambda *a:[NS(state=f.phase_state,phase='selection')])
    monkeypatch.setattr(h,'tools_unresolved',lambda *a:f.native_unknown)
    def work(*a):
        f.calls+=1;assert f.t>=GENERAL_CLAIM_SECONDS
        if f.calls==1:raise DomainError('action_unresolved')  # Empty legitimate deferral.
        if f.calls==2:
            f.events.append(dict(id=6,phase='selection',kind='tool_result',data={'retained':True}))
            return f.run
        f.run.state='ready';return f.run
    f.worker.work=work
    return f


def test_actual_once_empty_deferral_then_progress_then_ready(f):
    assert h.finish_natural_visits(f.ctx,f.worker,'b').state=='ready'
    assert f.calls==3 and f.t==GENERAL_CLAIM_SECONDS


@pytest.mark.parametrize('kind',['count_unknown','outcome_unknown','invalid','counting','dispatching','native','other','lock'])
def test_stop_before_once(f,kind):
    if kind=='native':f.native_unknown=True
    elif kind=='other':f.extra=True
    elif kind=='lock':
        k=h.operation_key('attempt','selection','dispatch',2)&((1<<64)-1)
        f.held=[dict(classid=k>>32,objid=k&((1<<32)-1))]
    else:f.phase_state=kind
    with pytest.raises(AssertionError):h.finish_natural_visits(f.ctx,f.worker,'b')
    assert f.calls==0


@pytest.mark.parametrize('kind',['denied','unknown_after','native_after','interrupt','regression','terminal_regression'])
def test_once_failure_or_history_loss_never_retries(f,kind):
    def work(*a):
        f.calls+=1
        if kind=='denied':raise DomainError('not_found_or_not_authorized')
        if kind=='interrupt':raise InterruptedError()
        if kind=='unknown_after':f.phase_state='outcome_unknown'
        if kind=='native_after':f.native_unknown=True
        if kind.endswith('regression'):f.events.pop()
        if kind=='terminal_regression':f.run.state='ready';return f.run
        raise DomainError('action_unresolved')
    f.worker.work=work
    with pytest.raises((AssertionError,InterruptedError)):h.finish_natural_visits(f.ctx,f.worker,'b')
    assert f.calls==1


def test_empty_deferrals_have_finite_consecutive_budget(f):
    def work(*a):f.calls+=1;raise DomainError('action_unresolved')
    f.worker.work=work
    with pytest.raises(AssertionError,match='empty deferrals exhausted'):h.finish_natural_visits(f.ctx,f.worker,'b')
    assert f.calls==h.MAX_EMPTY_VISITS+1


def test_progress_does_not_reset_overall_visits(f):
    def work(*a):
        f.calls+=1;f.events.append(dict(id=5+f.calls,phase='selection',kind='read',data={'n':f.calls}));return f.run
    f.worker.work=work
    with pytest.raises(pytest.fail.Exception,match='overall visit watchdog'):h.finish_natural_visits(f.ctx,f.worker,'b')
    assert f.calls==h.MAX_VISITS


def test_progress_does_not_reset_wall(f):
    def work(*a):
        f.calls+=1;f.t+=h.MAX_SECONDS;f.events.append(dict(id=6,phase='selection',kind='tool_result',data={}));return f.run
    f.worker.work=work
    with pytest.raises(AssertionError,match='wall watchdog'):h.finish_natural_visits(f.ctx,f.worker,'b')
    assert f.calls==1


def test_known_076_invalid_receipt_reaches_real_once(f):
    step,rows=rejection_rows();f.steps=[step];f.events=rows;f.phase_state='invalid'
    def work(*a):f.calls+=1;f.run.state='ready';return f.run
    f.worker.work=work
    assert h.finish_natural_visits(f.ctx,f.worker,'b').state=='ready' and f.calls==1


@pytest.mark.parametrize('damage',['phase','attempt_id','result_event_id','result_sha256','request_sha256','response_id','usage','metadata','count','missing_identity','missing_result','tool_result'])
def test_forged_or_unbound_invalid_stops(f,damage):
    step,rows=rejection_rows();f.steps=[step];f.events=rows;f.phase_state='invalid'
    if damage in ('phase','attempt_id','result_event_id','result_sha256','request_sha256','response_id'):rows[-1]['data'][damage]='forged'
    elif damage=='usage':rows[4]['data']['usage']=None
    elif damage=='metadata':rows[4]['data']['metadata']={}
    elif damage=='count':rows[1]['data']['count_sha256']='0'*64
    elif damage.startswith('missing_'):rows[:]=[r for r in rows if r['kind']!=damage[8:]]
    else:rows.append(dict(id=7,phase='selection',kind='tool_result',data={}))
    with pytest.raises(AssertionError,match='unbound invalid'):h.finish_natural_visits(f.ctx,f.worker,'b')
    assert f.calls==0


@pytest.mark.parametrize('valid',[True,False])
def test_078_invalid_requires_exact_production_sql_validator(f,monkeypatch,valid):
    step,rows=rejection_rows();rows[-1].update(kind='file_input_rejection',data={'exact':'proof'})
    f.steps=[step];f.events=rows;f.phase_state='invalid';seen=[]
    def check(c,aid,phase,data):seen.append((aid,phase,data));return valid
    monkeypatch.setattr(h,'valid_file_rejection',check)
    def work(*a):f.calls+=1;f.run.state='ready';return f.run
    f.worker.work=work
    if valid:assert h.finish_natural_visits(f.ctx,f.worker,'b').state=='ready'
    else:
        with pytest.raises(AssertionError):h.finish_natural_visits(f.ctx,f.worker,'b')
    assert seen and all(v==('attempt','selection',{'exact':'proof'}) for v in seen)
    assert f.calls==int(valid)


def test_terminal_entry_does_not_dispatch_unrelated_pending(f):
    f.run.state='ready';f.extra=True
    assert h.finish_natural_visits(f.ctx,f.worker,'b') is f.run and f.calls==0


def test_corrected_076_fixture_is_strict_schema_not_078():
    import httpx
    from test_durable_boundary_pg import DistinctProvider
    from test_selection_rejection import BAD
    from workagent import adaptive,file_input_rejection
    from workagent.responses_transport import build_tool_selection,RequestMetadata,Provenance,parse_response
    from workagent.responses_ledger import parsed_data
    from workagent.service import canonical
    bad=deepcopy(BAD);bad['source']['sha256']='not-a-sha256'
    request=build_tool_selection(instructions=adaptive.POLICY,source_context=canonical(dict(run_id='run',messages=[])),
        read_schema=adaptive.DECISION_SCHEMA,metadata=RequestMetadata(request_id='run',attempt_id='attempt',step_id='selection'),
        policy=adaptive.CAPABILITY,phase='selection')
    fake=DistinctProvider([bad])
    doc=fake.handle(httpx.Request('POST','https://synthetic.invalid/v1/responses',content=request.body)).json()
    result=parsed_data(parse_response(doc,request,Provenance('synthetic','https://synthetic.invalid'),require_correlation=True))
    assert result['state']=='malformed' and result['issue']=='schema_validation_failed'
    assert result['usage'] is not None and result['value'] is None
    assert file_input_rejection.candidate(request,result) is None
    assert BAD['source']['sha256']=='0'*64
