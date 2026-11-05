"""One diagnostic read keeps the actual restricted-PG malformed receipt intact."""
import json
import pytest
import diagnose_schema_rejection as D
from test_domain import context
from test_discovery_continuation import prepare
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_local_rejection_settlement import journal
from workagent.responses_ledger import Ledger,parsed_data
from workagent.provider_attempts import ReceiptCapability
from workagent.service import WorkerCapability
from workagent.responses_io import interval


def test_exact_read_after_malformed_uses_ledger_and_preserves_result(context,tmp_path,monkeypatch):
    s,p,ws,_,_=context;cv,q,g=prepare(context)
    bad={'kind':'files_create_draft','source':{'kind':'text','content':'Known fixture text',
         'sha256':'0'*64,'filename':'fixture.txt','mime_type':'text/plain'}}
    fake=AlphaProvider([bad]);w=worker(context,fake,tmp_path)
    finish_safe_visits(context,w,q.run.id,stop_when=lambda:('selection','result') in journal(s,ws,q.run.id))
    saved=w.phases.state.load(ws,q.run.id);receipt=ReceiptCapability(**saved['receipt']);cap=WorkerCapability(**saved['worker'])
    ledger=Ledger(s,receipt);request,events=ledger.snapshot('selection',cap)
    assert events['result']['state']=='malformed'
    before_resume=list(fake.calls)
    assert w.work(p,ws,q.run.id).state=='running'
    assert fake.calls==before_resume and ledger.snapshot('selection',cap)[1]==events
    rid=events['identity']['response_id']
    for name,value in [('RID',q.run.id),('ATTEMPT',receipt.attempt_id),('PHASE','selection'),('RESPONSE',rid)]:monkeypatch.setattr(D,name,value)
    old=D.validate_rejection(request,events);before=list(fake.calls)
    with interval(ledger,request,'read',cap):
        read=ledger.reserve_operation(request,'read',cap)
        result=w.transport.retrieve(rid,request=request)
    assert read and parsed_data(result)==old and ledger.snapshot('selection',cap)[1]==events
    assert fake.calls[len(before):]==[('GET','/v1/responses/'+rid)]
    got=D.diagnostic(fake.responses[rid],request)
    assert got['decision_kind']=='files_create_draft'
    assert {'location':['decision','FilesCreateDraft','source'],'type':'value_error'} in got['errors']
    for field,value in [('state','function_call'),('issue','other'),('response_id','resp_wrong'),('usage',None)]:
        changed=json.loads(json.dumps(events));changed['result'][field]=value
        with pytest.raises(AssertionError):D.validate_rejection(request,changed)
    changed=json.loads(json.dumps(fake.responses[rid]));changed['id']='resp_other'
    with pytest.raises(AssertionError):D.diagnostic(changed,request)
