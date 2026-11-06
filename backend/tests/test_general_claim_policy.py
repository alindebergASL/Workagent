"""Fixed new-claim policy; restricted disposable PG, no provider I/O."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
from pathlib import Path
import pytest
from pydantic import ValidationError
from test_timing_recovery import context
from test_general_alpha_runtime import activate,AlphaProvider
from test_conversations import conversation,post
from test_general_responses import worker
from test_domain import create
from test_runtime import expire
from test_final_resume import wait_natural_expiry
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import now, new_id
from workagent.general_worker import GENERAL_CLAIM_SECONDS
from workagent.service import Principal, digest


def setup(ctx, path):
    # Alpha admission requires empty selected sources. Drift controls below
    # change current scope only after this valid admission and retained claim.
    cv=conversation(ctx);g=activate(ctx,cv)
    q=post(ctx,cv,'Claim protocol only; never sent.')
    fake=AlphaProvider([{'kind':'reply','text':'Claim protocol only; never sent.'}])
    return cv,g,q,fake,worker(ctx,fake,path)


def retained(ctx,rid):
    s,_,ws,_,_=ctx
    with s.db.transaction() as c:
        rows={table:c.execute(f'SELECT to_jsonb(t) AS v FROM {table} t WHERE workspace_id=%s '+
            ('AND id=%s' if table=='runs' else 'AND object_id=%s' if table in ('audit','outbox') else 'AND run_id=%s')+
            ' ORDER BY to_jsonb(t)::text',(ws,rid)).fetchall()
            for table in ('runs','audit','outbox','run_contexts','provider_attempts')}
    return sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest()


def receipt(ctx,w,cap):
    s,_,ws,_,_=ctx
    with s.db.transaction() as c:
        cfg=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,cap.run_id)).fetchone()['data']
    a=s.prepare_provider_attempt(cap,request_hash='a'*64,consumer_sha256=cfg['consumer_sha256'],
        evidence_origin='synthetic_provider_receipt',transport=w.transport)
    return s.bind_provider_receipt(cap,a.id)


def assert_new(ctx,w,rid,previous=0,**kw):
    s,p,ws,_,_=ctx
    start=now();cap=w._claim_responses_run(p,ws,rid,**kw);end=now()
    run=s.get_run(p,ws,rid)
    assert cap.fence==run.fence==previous+1
    assert start+timedelta(seconds=GENERAL_CLAIM_SECONDS)<=run.lease_expires_at<=end+timedelta(seconds=GENERAL_CLAIM_SECONDS)
    return cap


def test_initial_and_natural_receipt_reclaim(context,tmp_path):
    s,p,ws,_,_=context
    _,_,q,fake,w=setup(context,tmp_path)
    first=assert_new(context,w,q.run.id)
    bound=receipt(context,w,first)
    before=retained(context,q.run.id)
    with pytest.raises(DomainError):w._claim_responses_run(p,ws,q.run.id,responses_receipt=bound)
    assert retained(context,q.run.id)==before
    wait_natural_expiry(context,q)
    second=assert_new(context,w,q.run.id,first.fence,responses_receipt=bound)
    assert second.secret!=first.secret
    with pytest.raises(DomainError),s.db.transaction() as c:s._check_capability(c,first)
    with s.db.transaction() as c:s._check_capability(c,second)
    assert not fake.calls


def test_existing_service_120_claim_not_renewed(context,tmp_path):
    s,p,ws,_,_=context
    _,_,q,fake,w=setup(context,tmp_path)
    start=now();old=s.claim_run(p,ws,q.run.id);end=now()
    run=s.get_run(p,ws,q.run.id)
    assert start+timedelta(seconds=120)<=run.lease_expires_at<=end+timedelta(seconds=120)
    bound=receipt(context,w,old);before=retained(context,q.run.id)
    with pytest.raises(DomainError):w._claim_responses_run(p,ws,q.run.id,responses_receipt=bound)
    assert retained(context,q.run.id)==before and not fake.calls


def test_other_profile_stays_120_and_private_seam_denies(context,tmp_path):
    s,p,ws,_,_=context
    q=create(context)
    from workagent.general_worker import GeneralWorker,ControlledTransport
    w=GeneralWorker(s,transport=ControlledTransport())
    before=retained(context,q.run.id)
    with pytest.raises(DomainError):w._claim_responses_run(p,ws,q.run.id)
    assert retained(context,q.run.id)==before
    start=now();cap=s.claim_run(p,ws,q.run.id);end=now()
    assert start+timedelta(seconds=120)<=s.get_run(p,ws,q.run.id).lease_expires_at<=end+timedelta(seconds=120)
    assert cap.fence==1


@pytest.mark.parametrize('damage',[
    'missing_receipt','secret','receipt_fence','receipt_run','receipt_scope','receipt_principal',
    'principal','scope','missing_run','revoked','access','source','cancelled','terminal',
    'paused_invalid_conversation','budget','context','competing'])
def test_claim_denials_rollback(context,tmp_path,damage):
    s,p,ws,_,admin=context
    cv,g,q,fake,w=setup(context,tmp_path)
    cap=assert_new(context,w,q.run.id);bound=receipt(context,w,cap)
    # No dispatch/count exists; only this disposable claim is expired for the
    # denial matrix. The positive reclaim test above waits for natural expiry.
    expire(context,q.run.id)
    if damage in ('source','context'):
        ref=context[3][0]
        with s.db.transaction() as c:
            assert s._conversation(c,p,ws,cv.id,True).selected_source_refs==[]
            assert s._source(c,p,ws,ref,True)['id']==ref.source_id
            frozen=c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                (ws,q.run.id)).fetchone()['data']
            assert frozen['source_manifest']==[]
    actor=p;space=ws;rid=q.run.id;candidate=bound
    if damage=='missing_receipt':candidate=None
    elif damage in ('secret','receipt_fence','receipt_run','receipt_scope','receipt_principal'):
        field,value={'secret':('secret','invalid'), 'receipt_fence':('fence',bound.fence+1),
            'receipt_run':('run_id','different'), 'receipt_scope':('workspace_id','different'),
            'receipt_principal':('principal_id','different')}[damage]
        candidate=replace(bound,**{field:value})
    elif damage=='principal':actor=Principal('not-the-owner')
    elif damage=='scope':space='absent-workspace'
    elif damage=='missing_run':rid='absent-run'
    else:
        with Database(admin).transaction() as c:
            if damage=='revoked':c.execute('UPDATE provider_grants SET active=false WHERE id=%s',(g.id,))
            elif damage=='access':c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
            elif damage in ('source','context'):
                # Owner-side disposable drift injection, not admission of a
                # nonempty Alpha scope or an edit to the immutable run snapshot.
                changed=c.execute("UPDATE conversations SET data=jsonb_set(data,'{selected_source_refs}',%s::jsonb) "
                    'WHERE workspace_id=%s AND id=%s RETURNING data',
                    (json.dumps([ref.model_dump(mode='json')]),ws,cv.id)).fetchone()['data']
                assert changed['selected_source_refs']==[ref.model_dump(mode='json')]
                if damage=='source':
                    revoked=c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s AND source_id=%s RETURNING active',
                        (ws,p.id,ref.source_id)).fetchone()
                    assert revoked and revoked['active'] is False
            elif damage in ('cancelled','paused_invalid_conversation'):
                state='cancelled' if damage=='cancelled' else 'paused'
                c.execute("UPDATE conversations SET data=jsonb_set(data,'{state}',%s::jsonb) WHERE workspace_id=%s AND id=%s",(json.dumps(state),ws,cv.id))
            elif damage=='terminal':c.execute("UPDATE runs SET data=jsonb_set(data,'{state}','\"ready\"'::jsonb) WHERE workspace_id=%s AND id=%s",(ws,q.run.id))
            elif damage=='budget':c.execute("UPDATE runs SET data=jsonb_set(data,'{used_units}',data->'budget_units') WHERE workspace_id=%s AND id=%s",(ws,q.run.id))
            elif damage=='competing':
                other=new_id()
                update=dict(id=other,state='running',lease_expires_at=(now()+timedelta(seconds=GENERAL_CLAIM_SECONDS)).isoformat())
                c.execute('INSERT INTO runs(workspace_id,id,assignment_id,conversation_id,data) '
                    'SELECT workspace_id,%s,assignment_id,conversation_id,data||%s::jsonb FROM runs WHERE workspace_id=%s AND id=%s',
                    (other,json.dumps(update),ws,q.run.id))
    if damage=='context':
        # Access/version, receipt and pins still pass; only materialized context
        # has changed. Claim must roll back its staged new fence/secret/event.
        with s.db.transaction() as c:
            current=s._conversation(c,p,ws,cv.id,True)
            assert current.selected_source_refs==[ref]
            run,_,_=s._receipt_binding(c,bound)
            s._runtime_pins(c,run)
            projected,sources=s._materialize_general_context(c,p,run,current)
            assert [row['id'] for row in sources]==[ref.source_id]
            assert digest(projected)!=frozen['context_sha256']
    before=retained(context,q.run.id)
    with pytest.raises((DomainError,ValidationError)) as denied:
        w._claim_responses_run(actor,space,rid,responses_receipt=candidate)
    if damage in ('source','context'):
        assert isinstance(denied.value,DomainError)
        assert denied.value.code.value==('not_found_or_not_authorized' if damage=='source' else 'source_changed')
    assert retained(context,q.run.id)==before
    assert not fake.calls


def test_no_arbitrary_claim_duration():
    from workagent.general_worker import GeneralWorker,ControlledTransport
    w=GeneralWorker(None,transport=ControlledTransport())
    for override in ({'lease_seconds':999},{'received_result':True}):
        with pytest.raises(TypeError):w._claim_responses_run(None,'workspace','run',**override)
