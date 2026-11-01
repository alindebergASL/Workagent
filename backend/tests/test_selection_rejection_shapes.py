"""Shape and ambiguous result controls through real worker + restricted SQL."""
import json
from copy import deepcopy
import httpx,pytest,psycopg
from test_domain import context
from test_selection_rejection import BAD
from test_selection_rejection_controls import rejected_fixture
from test_gateway_rejection_feedback import prepare
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_runtime import expire
from test_local_rejection_settlement import journal
from workagent.responses_ledger import Ledger
from workagent.errors import DomainError
from workagent.selection_rejection import observation

class Shapes(AlphaProvider):
    def __init__(self,value):super().__init__([BAD]*3);self.value=value
    def handle(self,request):
        response=super().handle(request)
        if request.method=='POST' and request.url.path=='/v1/responses':
            doc=response.json();doc['output'][0]['arguments']=json.dumps(self.value)
            self.responses[doc['id']]=doc
            return httpx.Response(200,json=doc)
        return response

@pytest.mark.parametrize('value',[[],{'decision':None},{'decision':{'kind':'files_create_draft','source':[]}}])
def test_nonobject_schema_rejection_restart_and_exhaustion(context,tmp_path,value):
    s,p,ws,_,_=context;cv,q,g=prepare(context);fake=Shapes(value)
    def hook(name):
        if name=='after_selection_rejection':raise InterruptedError('restart')
    with pytest.raises(InterruptedError):finish_safe_visits(context,worker(context,fake,tmp_path,hook=hook),q.run.id)
    initial=journal(s,ws,q.run.id)
    expire(context,q.run.id)
    assert finish_safe_visits(context,worker(context,fake,tmp_path),q.run.id).state=='partial'
    events=journal(s,ws,q.run.id)
    assert all(events[k]==v for k,v in initial.items())
    rejections=[v for k,v in events.items() if k[1]=='selection_rejection']
    assert len(rejections)==3 and all(v['feedback']['generated_text'] is None for v in rejections)
    with s.db.transaction() as c:
        cp=c.execute("SELECT data FROM run_checkpoints WHERE workspace_id=%s AND run_id=%s AND phase='final'",(ws,q.run.id)).fetchone()['data']
        assert cp['waiting']!='unknown' and cp['next_safe_action']!='reconcile'
    assert not s.get_conversation(p,ws,cv.id).artifact_ids

@pytest.mark.parametrize('change',['usage','pending','unknown_identity','ambiguous','effected'])
def test_noneligible_exact_receipts_rejected(context,tmp_path,monkeypatch,change):
    original=Ledger.event
    def event(self,c,phase,kind,data):
        if kind=='result':
            data=deepcopy(data)
            if change=='usage':data['usage']=None
            elif change=='pending':data['state']='in_progress'
            elif change=='unknown_identity':data['response_id']='resp_other'
            elif change=='ambiguous':data['issue']='ambiguous_output'
        return original(self,c,phase,kind,data)
    # Exercise rejected eligibility directly in observation validator for changed
    # facts, retaining the actual immutable original receipt in PostgreSQL.
    cv,q,g,fake,w,ledger,cap,request,events,row=rejected_fixture(context,tmp_path,monkeypatch)
    changed=deepcopy(row)
    if change=='usage':changed['data']['usage']=None
    elif change=='pending':changed['data']['state']='in_progress'
    elif change=='unknown_identity':changed['data']['response_id']='resp_other'
    elif change=='ambiguous':changed['data']['issue']='ambiguous_output'
    else:changed['data'].update(state='function_call',issue=None,value={'invented':'effect'})
    with pytest.raises(DomainError):observation(request,changed,row['data']['rejection_diagnostic'],3,cap.fence)
    assert ledger.snapshot('selection',cap)[1]['result']==row['data']


def test_interruption_after_new_dispatch_observes_not_resends(context,tmp_path,monkeypatch):
    from test_selection_rejection import good
    s,p,ws,_,_=context;cv,q,g=prepare(context)
    fake=AlphaProvider([BAD,good,{'kind':'reply','text':'Saved the validated draft.'}],lose_phase='selection_2')
    w=worker(context,fake,tmp_path)
    result=finish_safe_visits(context,w,q.run.id,stop_when=lambda:('selection_2','dispatch') in journal(s,ws,q.run.id))
    assert result.state=='running'
    before=journal(s,ws,q.run.id)
    assert ('selection_2','result') not in before and ('selection','selection_rejection') in before
    calls=list(fake.calls)
    # Unknown create has no acknowledged identity; a new worker must not resend.
    assert worker(context,fake,tmp_path).work(p,ws,q.run.id).state=='running'
    assert fake.calls==calls
    assert not s.get_conversation(p,ws,cv.id).artifact_ids
