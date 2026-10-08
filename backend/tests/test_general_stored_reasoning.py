"""Async stored reasoning survives GET and exact final replay, with real Wasmtime."""
import json
import httpx
from test_domain import context
from test_conversations import conversation,post
from test_adaptive_execution import activate,AdaptiveProvider
from test_general_responses import worker


class StoredReasoningProvider(AdaptiveProvider):
    def handle(self,request):
        result=super().handle(request)
        if request.method=='GET' and getattr(self,'pending',False):
            return httpx.Response(200,json={**result.json(),'status':'in_progress','usage':None,'output':[]})
        if request.method=='POST' and request.url.path.endswith('/responses'):
            data=result.json()
            data['output'].insert(0,{'type':'reasoning','id':'rs_'+data['id'],'summary':[]})
            self.responses[data['id']]=data
            return httpx.Response(200,json={**data,'status':'in_progress','usage':None,'output':[]})
        return result


def test_stored_background_reasoning_failure_repair_and_final_replay(context,tmp_path):
    s,p,ws,_,_=context
    cv=conversation(context);grant=activate(context,cv);fake=StoredReasoningProvider()
    queued=post(context,cv,'Build an invoice calculator and verify quantity3 price1250.')
    assert worker(context,fake,tmp_path).work(p,ws,queued.run.id).state=='partial'
    detail=s.get_conversation(p,ws,cv.id)
    assert len(detail.turns[0].adaptive.steps)==2
    assert detail.turns[0].adaptive.steps[0].status=='rejected'
    assert detail.turns[0].adaptive.steps[1].verification.model_tests_passed
    assert detail.turns[0].retained_local_result.published
    with s.db.transaction() as c:
        rows=c.execute("SELECT request_bytes FROM responses_steps WHERE grant_id=%s AND phase='final'",(grant.id,)).fetchall()
    history=json.loads(rows[0]['request_bytes'])['input']
    reasoning=next(item for item in history if item.get('type')=='reasoning')
    assert set(reasoning)=={'type','id','summary'} and reasoning['id'].startswith('rs_resp_adaptive_')
    assert sum(method=='GET' for method,_ in fake.calls)==3
    assert sum(method=='POST' and path.endswith('/responses') for method,path in fake.calls)==3


def test_reviewed_successor_reads_original_pending_response_without_regeneration(context,tmp_path,monkeypatch):
    from datetime import timedelta
    from workagent.responses_recovery import SuccessorApproval,install_successor
    from workagent.models import now
    from workagent.db import Database
    from workagent.service import digest
    import workagent.general_responses as general
    s,p,ws,_,admin=context
    cv=conversation(context);grant=activate(context,cv);fake=StoredReasoningProvider();fake.pending=True
    q=post(context,cv,'Build and test the calculator.')
    assert worker(context,fake,tmp_path,poll_limit=1).work(p,ws,q.run.id).state=='running'
    monkeypatch.setattr(general,'consumer_hash',lambda:'f'*64)
    approval=SuccessorApproval(grant_id=grant.id,original_consumer_sha256=grant.consumer_sha256,
        successor_consumer_sha256=general.consumer_hash(),original_grant_sha256=digest(grant),
        expires_at=now()+timedelta(minutes=30),reason='Reviewed exact stored reasoning parser correction; preserve prior response and budgets.')
    assert install_successor(Database(admin),approval)==approval
    fake.pending=False
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert sum(method=='POST' and path.endswith('/responses') for method,path in fake.calls)==3
    with s.db.transaction() as c:
        phases=c.execute("SELECT phase,count(*) AS n FROM responses_events WHERE attempt_id IN (SELECT id FROM provider_attempts WHERE run_id=%s) AND kind='dispatch' GROUP BY phase",(q.run.id,)).fetchall()
        uses=c.execute('SELECT * FROM responses_consumer_uses WHERE grant_id=%s',(grant.id,)).fetchall()
    assert {r['phase']:r['n'] for r in phases}=={'selection':1,'selection_2':1,'final':1}
    assert len(uses)==1 and uses[0]['actual_consumer_sha256']=='f'*64
