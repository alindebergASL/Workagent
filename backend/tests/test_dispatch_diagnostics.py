"""Safe operator evidence does not make unknown dispatches retryable."""
import json
from types import SimpleNamespace
import httpx
import pytest
from test_domain import context
from test_conversations import conversation,post
from test_general_alpha_runtime import activate,AlphaProvider
from test_general_responses import worker,totals
from test_adaptive_execution import finish_safe_visits
from workagent.responses_worker import dispatch_diagnostic
from workagent.responses_transport import TransportError


@pytest.mark.parametrize('mode,code',[
    ('network','network_outcome_unknown'),('http','http_error'),('malformed','malformed_response')])
def test_third_dispatch_diagnostic_preserves_unknown(context,tmp_path,caplog,monkeypatch,mode,code):
    class Failure(AlphaProvider):
        def handle(self,request):
            if request.method=='POST' and not request.url.path.endswith('input_tokens'):
                if json.loads(request.content)['metadata']['step_id']=='selection_3':
                    self.calls.append((request.method,request.url.path))
                    if mode=='network':raise httpx.ReadError('SECRET network details')
                    if mode=='http':return httpx.Response(502,json={'error':'SECRET body'})
                    return httpx.Response(200,content='SECRET non-JSON')
            return super().handle(request)
    s,p,ws,_,_=context;cv=conversation(context);g=activate(context,cv)
    fake=Failure([{'kind':'read_context','section':'messages'},
                  {'kind':'discover_capabilities'}])
    q=post(context,cv,'A synthetic three-stage diagnostic with no external effects.')
    w=worker(context,fake,tmp_path);original=w.phases._step;yielded=[]
    def safe_yield(ledger,request,*args,**kwargs):
        if request.phase=='selection_3' and not yielded:
            yielded.append(True);return None  # Before reservation, not an I/O failure.
        return original(ledger,request,*args,**kwargs)
    monkeypatch.setattr(w.phases,'_step',safe_yield)
    finish_safe_visits(context,w,q.run.id,
        stop_when=lambda:any(r.name=='workagent.responses_worker' and
            json.loads(r.message).get('event')=='provider_dispatch_problem' for r in caplog.records))
    assert yielded==[True]
    records=[json.loads(r.message) for r in caplog.records if r.name=='workagent.responses_worker']
    assert len(records)==1 and records[0]['event']=='provider_dispatch_problem'
    assert records[0]['run_id']==q.run.id and records[0]['phase']=='selection_3'
    assert records[0]['code']==code and 'SECRET' not in caplog.text
    if mode=='http':assert records[0]['http_status']==502
    with s.db.transaction() as c:
        kinds={r['kind'] for r in c.execute('SELECT kind FROM responses_events WHERE attempt_id=%s AND phase=%s',
            (records[0]['attempt_id'],'selection_3')).fetchall()}
    assert kinds=={'count_send','count_result','dispatch'}
    before=list(fake.calls);budget=totals(s,g)
    worker(context,fake,tmp_path).work(p,ws,q.run.id)
    assert fake.calls==before and totals(s,g)==budget
    assert budget['request_counts']=={'count_send':3,'dispatch':3,'read':0,'cancel':0}
    assert not s.get_conversation(p,ws,cv.id).artifact_ids


@pytest.mark.parametrize('code,status',[('SECRET token',403),('http_error','SECRET'),('http_error',True),('http_error',999)])
def test_diagnostic_drops_unapproved_values(code,status):
    request=SimpleNamespace(metadata=SimpleNamespace(request_id='run',attempt_id='attempt'),phase='selection_3')
    value=dispatch_diagnostic(request,TransportError(code,http_status=status))
    assert 'SECRET' not in json.dumps(value) and 'http_status' not in value
