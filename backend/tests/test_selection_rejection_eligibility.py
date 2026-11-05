"""Actual provider-result eligibility SQL negatives; no installed effects."""
import json,httpx,pytest,psycopg
from test_domain import context
from test_selection_rejection import BAD
from test_gateway_rejection_feedback import prepare
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.responses_ledger import Ledger
from workagent.provider_attempts import ReceiptCapability
from workagent.service import WorkerCapability
from workagent.errors import DomainError

class Ineligible(AlphaProvider):
    def __init__(self,shape):super().__init__([BAD]);self.shape=shape
    def handle(self,request):
        response=super().handle(request)
        if request.url.path.endswith('input_tokens'):return response
        doc=response.json()
        if self.shape=='usage':doc['usage']=None
        elif self.shape=='ambiguous':doc['output'].append(dict(doc['output'][0],call_id='call_other'))
        elif self.shape=='pending':doc.update(status='in_progress',output=[],usage=None)
        self.responses[doc['id']]=doc
        return httpx.Response(200,json=doc)

@pytest.mark.parametrize('shape',['usage','ambiguous','pending'])
def test_sql_denies_noneligible_receipts(context,tmp_path,shape):
    s,p,ws,_,_=context;cv,q,g=prepare(context);fake=Ineligible(shape);w=worker(context,fake,tmp_path)
    try:r=w.work(p,ws,q.run.id)
    except DomainError as exc:assert shape=='usage' and exc.code.value=='action_unresolved'
    saved=w.phases.state.load(ws,q.run.id);receipt=ReceiptCapability(**saved['receipt']);cap=WorkerCapability(**saved['worker'])
    ledger=Ledger(s,receipt)
    with s.db.transaction() as c:
        events=ledger._events(c,'selection')
        if shape=='usage':assert events['result']['usage'] is None
        elif shape=='ambiguous':assert events['result']['issue']!='schema_validation_failed'
        else:assert 'result' not in events
    # Valid worker fence avoids turning this into a stale-worker-only denial.
    with pytest.raises(psycopg.Error,match='known unexecuted terminal schema rejection required'),s.db.transaction() as c:
        ledger.event(c,'selection','selection_rejection',{'worker_fence':cap.fence})
    assert not s.get_conversation(p,ws,cv.id).artifact_ids
