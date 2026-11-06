"""Restricted SQL/control-path denials, no provider network."""
from copy import deepcopy
from hashlib import sha256
import pytest,psycopg
from test_domain import context
from test_gateway_rejection_feedback import prepare
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_selection_rejection import BAD,TEXT
from workagent.responses_ledger import Ledger
from workagent.service import WorkerCapability,encoded
from workagent.provider_attempts import ReceiptCapability
from workagent.errors import DomainError
from workagent.db import Database
from workagent.selection_rejection import observation,canonical,digest,retain
import workagent.selection_rejection as rejection


def rejected_fixture(context,tmp_path,monkeypatch,*,historical=False):
    s,p,ws,_,_=context;cv,q,g=prepare(context)
    original=Ledger.event
    def event(self,c,phase,kind,data):
        if kind=='result' and historical:data={k:v for k,v in data.items() if k!='rejection_diagnostic'}
        return original(self,c,phase,kind,data)
    with monkeypatch.context() as m:
        m.setattr(Ledger,'event',event)
        m.setattr(rejection,'retain',lambda *a:(_ for _ in ()).throw(InterruptedError('before observation')))
        fake=AlphaProvider([BAD]);w=worker(context,fake,tmp_path)
        with pytest.raises(InterruptedError):finish_safe_visits(context,w,q.run.id)
    saved=w.phases.state.load(ws,q.run.id)
    receipt=ReceiptCapability(**saved['receipt']);cap=WorkerCapability(**saved['worker'])
    ledger=Ledger(s,receipt);request,events=ledger.snapshot('selection',cap)
    with s.db.transaction() as c:
        row=c.execute("SELECT id,data FROM responses_events WHERE attempt_id=%s AND phase='selection' AND kind='result'",(receipt.attempt_id,)).fetchone()
    return cv,q,g,fake,w,ledger,cap,request,events,row


def test_raw_forgery_concurrency_and_immutability(context,tmp_path,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    cv,q,g,fake,w,ledger,cap,request,events,row=rejected_fixture(context,tmp_path,monkeypatch)
    s,p,ws,_,_=context
    proof=observation(request,row,row['data']['rejection_diagnostic'],3,cap.fence)
    mutations=[('result_event_id','wrong'),('result_sha256','0'*64),('response_id','resp_wrong'),
        ('request_sha256','0'*64),('attempt_id','wrong'),('phase','selection_2'),('worker_fence',cap.fence+1),
        ('diagnostic_sha256','0'*64),('terminal_outcome','completed')]
    variants=[]
    for key,value in mutations:
        d=deepcopy(proof);d[key]=value;variants.append(d)
    for field,value in [('content',TEXT+'\n'),('sha256','0'*64),('utf8_bytes',1)]:
        d=deepcopy(proof);d['feedback']['generated_text'][field]=value;variants.append(d)
    d=deepcopy(proof);d['body']={'invented':'material'};variants.append(d)
    d=deepcopy(proof);d.pop('diagnostic_sha256');variants.append(d)
    for d in variants:
        with pytest.raises(psycopg.Error),s.db.transaction() as c:ledger.event(c,'selection','selection_rejection',d)
    with ThreadPoolExecutor(max_workers=3) as pool:
        assert list(pool.map(lambda _:retain(ledger,request,cap),range(3)))==[proof]*3
    with pytest.raises(psycopg.Error),s.db.transaction() as c:ledger.event(c,'selection','selection_rejection',proof)
    with pytest.raises(psycopg.Error),s.db.transaction() as c:
        c.execute("UPDATE responses_events SET data=%s WHERE attempt_id=%s AND kind='selection_rejection'",(encoded(proof),ledger.receipt.attempt_id))
    assert ledger.snapshot('selection',cap)[1]['result']==row['data']


@pytest.mark.parametrize('change',['revoke','stale','closed','expired','membership'])
def test_authority_denied_before_rejection(context,tmp_path,monkeypatch,change):
    cv,q,g,fake,w,ledger,cap,request,events,row=rejected_fixture(context,tmp_path,monkeypatch)
    s,p,ws,_,admin=context
    with Database(admin).transaction() as c:
        if change=='revoke':c.execute('UPDATE provider_grants SET active=false WHERE id=(SELECT grant_id FROM provider_attempts WHERE id=%s)',(ledger.receipt.attempt_id,))
        if change=='expired':c.execute("UPDATE runs SET data=jsonb_set(data,'{lease_expires_at}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE workspace_id=%s AND id=%s",(ws,q.run.id))
        if change=='closed':c.execute("UPDATE conversations SET data=jsonb_set(data,'{state}','\"cancelled\"') WHERE workspace_id=%s AND id=%s",(ws,cv.id))
        if change=='membership':c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    if change=='stale':
        from dataclasses import replace
        cap=replace(cap,fence=cap.fence+1)
    before=list(fake.calls)
    with pytest.raises((DomainError,psycopg.Error)):retain(ledger,request,cap)
    assert fake.calls==before
    with s.db.transaction() as c:assert not c.execute("SELECT 1 FROM responses_events WHERE attempt_id=%s AND kind='selection_rejection'",(ledger.receipt.attempt_id,)).fetchone()


def test_exact_historical_diagnostic_binding_and_no_get(context,tmp_path,monkeypatch):
    cv,q,g,fake,w,ledger,cap,request,events,row=rejected_fixture(context,tmp_path,monkeypatch,historical=True)
    s,p,ws,_,admin=context
    with pytest.raises(DomainError):retain(ledger,request,cap)
    # Historical fixture emulates the already-performed exact diagnostic read.
    # This is synthetic HTTP, never a repeat of the live diagnostic.
    read=ledger.reserve_operation(request,'read',cap)
    w.phases.transport.retrieve(events['identity']['response_id'],request=request)
    before=list(fake.calls)
    raw=canonical(fake.responses[events['identity']['response_id']])
    for db,bad in [(s.db,raw),(Database(admin),raw.replace('resp_alpha_0','resp_other'))]:
        with pytest.raises(psycopg.Error),db.transaction() as c:
            c.execute('INSERT INTO selection_rejection_diagnostics VALUES (%s,%s,%s,%s)',(row['id'],read,bad,digest(bad)))
    with Database(admin).transaction() as c:
        c.execute('INSERT INTO selection_rejection_diagnostics VALUES (%s,%s,%s,%s)',(row['id'],read,raw,digest(raw)))
    assert retain(ledger,request,cap)['diagnostic_sha256']==digest(raw)
    assert ledger.snapshot('selection',cap)[1]['result']==row['data'] and fake.calls==before
    with pytest.raises(psycopg.Error),Database(admin).transaction() as c:
        c.execute('UPDATE selection_rejection_diagnostics SET diagnostic_bytes=%s WHERE result_event_id=%s',(raw,row['id']))


def test_changed_unicode_newline_and_hash_stay_strict():
    from pydantic import ValidationError
    from workagent.workspace_file_models import WorkingText
    value=deepcopy(BAD['source']);value['sha256']=sha256(TEXT.encode()).hexdigest()
    assert WorkingText.model_validate(value).content==TEXT
    for changed in (TEXT+'\n',TEXT.replace('é','e\u0301')):
        with pytest.raises(ValidationError):WorkingText.model_validate({**value,'content':changed})
    with pytest.raises(ValidationError):WorkingText.model_validate(BAD['source'])
