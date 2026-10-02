"""Real PostgreSQL + exact product worker; provider traffic is HTTPX synthetic only."""
from dataclasses import asdict
from datetime import timedelta
from hashlib import sha256
import json
import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest
import psycopg
from test_domain import context,cmd,create,raises
from test_runtime import expire
from workagent.db import Database
from workagent.models import *
from workagent.service import Service,digest
from workagent.provider_attempts import configure_grant,revoke_grant,ReceiptCapability
from workagent.responses_worker import ResponsesWorker,consumer_hash,instruction_hash
from workagent.responses_schema import FINAL_SCHEMA,scope_registry
from workagent.responses_synthetic import SyntheticResponses
from workagent.responses_ledger import Ledger,summary


def grant(context):
    s,p,ws,refs,admin=context
    with s.db.transaction() as c:
        from workagent.runtime_config import active_configuration
        _,config=active_configuration(c)
    return configure_grant(Database(admin),ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,
        profile='openai-responses-v1',model='gpt-6.1-sol',consumer_sha256=consumer_hash(),
        expires_at=now()+timedelta(minutes=45),max_runs=2,max_received_output_tokens=16384,
        responses=ResponsesBinding(project_id='proj_SYNTHETIC',secret_reference='file:/synthetic/not-a-key',
            transport_mode='synthetic',instructions_sha256=instruction_hash(config),
            schema_sha256=sha256(FINAL_SCHEMA.material).hexdigest(),scope_tool_sha256=digest(scope_registry()))))


def setup(context,tmp_path,**kwargs):
    g=grant(context); q=create(context); fake=SyntheticResponses(**kwargs)
    worker=ResponsesWorker(context[0],fake.transport(),tmp_path/'state')
    return g,q,fake,worker


def totals(s,g):
    with s.db.transaction() as c: return summary(c,g.id)


def test_initial_human_edit_revision_exact_approval(context,tmp_path):
    s,p,ws,refs,_=context
    g,q,fake,worker=setup(context,tmp_path)
    assert q.run.profile=='openai-responses-v1'
    assert worker.run(ws,q.run.id)=='completed'
    a=s.get_assignment(p,ws,q.assignment.id)
    art=s.get_artifact(p,ws,a.artifact_ids[0]); body=art.current_revision.body.model_copy(deep=True)
    body.blocks.append(Block(block_id='human-protected',kind='protected_note',text='Do not move my Wednesday slot.'))
    body.blocks.append(Block(block_id='human-edit',kind='paragraph',text='Human decision: address ownership before redesign.'))
    human=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,body=body))
    a=s.get_assignment(p,ws,a.id)
    revision=s.request_revision(p,ws,art.id,cmd(RequestRevision,expected_work_version=a.work_version,
        base_revision_id=human.current_revision_id,instruction='Make the decision explicit and preserve my edits.'))
    assert worker.run(ws,revision.run.id)=='completed'
    run=s.get_run(p,ws,revision.run.id)
    proposal=next(x for x in s.proposals(p,ws,art.id).items if x.id==run.proposal_id)
    attempt=s.get_provider_attempt(p,ws,revision.run.id).id
    assert [b.block_id for b in proposal.body.blocks[:7]]==[
        f'managed.{part}.{attempt}' for part in ('current','next-action','missing-information',
            'source-basis','specific-judgment','scope','history')]
    assert 'supersedes prior agent advice' in proposal.body.blocks[0].text
    assert 'earlier agent recommendations superseded' in proposal.body.blocks[6].text
    assert proposal.body.blocks[7:]==body.blocks
    assert s.get_artifact(p,ws,art.id).current_revision_id==human.current_revision_id
    accepted=s.accept_proposal(p,ws,proposal.id,cmd(AcceptProposal,expected_current_revision_id=human.current_revision_id))
    outcome=s.get_assignment(p,ws,a.id).responsibility.runs[-1]
    assert outcome.state=='readback_verified' and outcome.outcome_gate==outcome.safety_gate=='passed'
    assert accepted.current_revision.body==proposal.body and not outcome.underlying_action_performed
    assert totals(s,g)['request_counts']=={'count_send':4,'dispatch':4,'read':0,'cancel':0}
    assert totals(s,g)['billed_cost_usd'] is None
    count=len(fake.calls)
    restarted=ResponsesWorker(Service(Database()),fake.transport(),tmp_path/'state')
    assert restarted.run(ws,revision.run.id)=='reconciled' and len(fake.calls)==count


def test_safe_unsent_restart_reuses_count(context,tmp_path):
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path)
    def crash(name):
        if name=='after_count': raise RuntimeError('synthetic crash')
    worker.hook=crash
    with pytest.raises(RuntimeError):worker.run(ws,q.run.id)
    expire(context,q.run.id)
    restarted=ResponsesWorker(Service(Database()),fake.transport(),tmp_path/'state')
    assert restarted.run(ws,q.run.id)=='completed'
    assert totals(s,g)['request_counts']['count_send']==2
    assert totals(s,g)['request_counts']['dispatch']==2


def test_unknown_response_id_never_resends(context,tmp_path):
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path,lose_id=True)
    assert worker.run(ws,q.run.id)=='outcome_unknown'
    expire(context,q.run.id)
    restarted=ResponsesWorker(Service(Database()),fake.transport(),tmp_path/'state')
    assert restarted.run(ws,q.run.id)=='outcome_unknown'
    t=totals(s,g)
    assert t['request_counts']['dispatch']==1 and t['unknown_usage_steps']==1
    assert t['reserved_cost_usd']=='0.13192' and t['conservatively_calculated_cost_usd'] is None
    assert s.get_assignment(p,ws,q.assignment.id).responsibility.runs[-1].state=='outcome_unknown'


def test_accepted_identity_recovery_no_generation_replay(context,tmp_path):
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path)
    def crash(name):
        if name=='after_response':raise RuntimeError('synthetic crash')
    worker.hook=crash
    with pytest.raises(RuntimeError):worker.run(ws,q.run.id)
    expire(context,q.run.id)
    restarted=ResponsesWorker(Service(Database()),fake.transport(),tmp_path/'state')
    assert restarted.run(ws,q.run.id)=='completed'
    assert totals(s,g)['request_counts']=={'count_send':2,'dispatch':2,'read':1,'cancel':0}


def test_postcommit_loss_reconciles_without_network(context,tmp_path):
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path)
    def crash(name):
        if name=='after_publication':raise RuntimeError('synthetic crash')
    worker.hook=crash
    with pytest.raises(RuntimeError):worker.run(ws,q.run.id)
    n=len(fake.calls)
    assert ResponsesWorker(Service(Database()),fake.transport(),tmp_path/'state').run(ws,q.run.id)=='reconciled'
    assert len(fake.calls)==n


def test_revocation_retains_receipt_without_publication(context,tmp_path):
    s,p,ws,refs,admin=context
    g,q,fake,worker=setup(context,tmp_path)
    def revoke(name):
        if name=='before_publication':revoke_grant(Database(admin),g.id)
    worker.hook=revoke
    with pytest.raises(Exception): worker.run(ws,q.run.id)
    assert s.get_provider_attempt(p,ws,q.run.id).result is not None
    assert s.get_assignment(p,ws,q.assignment.id).artifact_ids==[]
    before=len(fake.calls)
    with pytest.raises(Exception):ResponsesWorker(Service(Database()),fake.transport(),tmp_path/'state').run(ws,q.run.id)
    assert len(fake.calls)==before


def test_false_completion_dto_is_not_published(context,tmp_path):
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path,false_completion=True)
    assert worker.run(ws,q.run.id)=='invalid_final'
    assert s.get_assignment(p,ws,q.assignment.id).artifact_ids==[]
    assert s.get_assignment(p,ws,q.assignment.id).responsibility.runs[-1].outcome_gate!='passed'


def test_cross_process_predispatch_single_winner(context,tmp_path):
    import subprocess,sys
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path)
    def crash(name):
        if name=='after_count':raise RuntimeError('synthetic crash')
    worker.hook=crash
    with pytest.raises(RuntimeError):worker.run(ws,q.run.id)
    script='''import sys
from workagent.responses_worker import PrivateState
from workagent.responses_ledger import Ledger
from workagent.provider_attempts import ReceiptCapability
from workagent.service import Service,WorkerCapability
from workagent.db import Database
from workagent.errors import DomainError
state=PrivateState(sys.argv[1]).load(sys.argv[2],sys.argv[3])
l=Ledger(Service(Database()),ReceiptCapability(**state['receipt']))
cap=WorkerCapability(**state['worker'])
try:
 request,_=l.snapshot('selection',cap)
 l.reserve_operation(request,'dispatch',cap)
 print('winner')
except DomainError:print('denied')
'''
    def contender(_):
        return subprocess.run([sys.executable,'-c',script,str(tmp_path/'state'),ws,q.run.id],capture_output=True,text=True,timeout=30)
    with ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(contender,range(4)))
    assert all(r.returncode==0 for r in results)
    assert [r.stdout.strip() for r in results].count('winner')==1
    assert totals(s,g)['request_counts']['dispatch']==1 and len(fake.calls)==1
    worker.hook=None
    assert worker.run(ws,q.run.id)=='outcome_unknown' and len(fake.calls)==1


def test_bounded_read_cancel_counters_survive_restart(context,tmp_path):
    import httpx
    from workagent.responses_transport import ResponsesTransport
    from workagent.service import WorkerCapability
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path,queued=True)
    def queued(request):
        response=fake.handle(request)
        if request.method=='GET':
            doc=response.json();doc.update(status='queued',output=[],usage=None)
            return httpx.Response(200,json=doc)
        return response
    worker=ResponsesWorker(s,ResponsesTransport.synthetic(httpx.MockTransport(queued)),tmp_path/'state',poll_limit=40)
    assert worker.run(ws,q.run.id)=='provider_pending'
    saved=worker.state.load(ws,q.run.id)
    ledger=Ledger(s,ReceiptCapability(**saved['receipt']));cap=WorkerCapability(**saved['worker'])
    request,_=ledger.snapshot('selection',cap)
    for _ in range(4):worker.cancel(ledger,request,cap)
    count=len(fake.calls)
    raises('budget_exhausted',lambda:worker.cancel(ledger,request,cap))
    raises('budget_exhausted',lambda:ResponsesWorker(Service(Database()),fake.transport(),tmp_path/'state').run(ws,q.run.id))
    assert len(fake.calls)==count
    assert totals(s,g)['request_counts']=={'count_send':1,'dispatch':1,'read':40,'cancel':4}


@pytest.mark.parametrize('fault',['metadata','missing_usage','wrong_source','false_words'])
def test_mismatched_or_unsafe_wire_stops_without_publication(context,tmp_path,fault):
    import httpx
    from workagent.responses_transport import ResponsesTransport
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path)
    def bad(request):
        response=fake.handle(request)
        if request.url.path.endswith('/input_tokens'):return response
        data=response.json()
        if fault=='metadata':data['metadata']['request_id']='wrong'
        elif fault=='missing_usage':data['usage']=None
        elif data['metadata']['step_id']=='selection':
            if fault=='wrong_source':data['output'][0]['arguments']=json.dumps({'source_ids':['not-selected'],'include_current_body':False})
        elif fault=='false_words':
            value=json.loads(data['output'][0]['content'][0]['text']);value['specific_judgment']='I have sent the customer message and completed this task.'
            data['output'][0]['content'][0]['text']=json.dumps(value)
        return httpx.Response(200,json=data)
    worker=ResponsesWorker(s,ResponsesTransport.synthetic(httpx.MockTransport(bad)),tmp_path/'state')
    if fault=='wrong_source':raises('not_found_or_not_authorized',lambda:worker.run(ws,q.run.id))
    else:assert worker.run(ws,q.run.id) in ('invalid_selection','invalid_final')
    assert s.get_assignment(p,ws,q.assignment.id).artifact_ids==[]


def test_permission_revoked_during_response_retains_without_source_read(context,tmp_path):
    import httpx
    from workagent.responses_transport import ResponsesTransport
    s,p,ws,refs,admin=context
    g,q,fake,worker=setup(context,tmp_path)
    def revoke(request):
        response=fake.handle(request)
        if request.url.path=='/v1/responses':
            with psycopg.connect(admin) as c:c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
        return response
    worker=ResponsesWorker(s,ResponsesTransport.synthetic(httpx.MockTransport(revoke)),tmp_path/'state')
    raises('not_found_or_not_authorized',lambda:worker.run(ws,q.run.id))
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) AS n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND e.kind='result'",(ws,)).fetchone()['n']==1
        assert c.execute("SELECT count(*) AS n FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.workspace_id=%s AND e.kind='tool_result'",(ws,)).fetchone()['n']==0
    assert len(fake.calls)==2


def test_count_response_loss_is_not_recounted(context,tmp_path):
    import httpx
    from workagent.responses_transport import ResponsesTransport,TransportError
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path)
    calls=[]
    def lose(request):
        calls.append(request.url.path)
        raise httpx.ReadTimeout('synthetic count loss')
    worker=ResponsesWorker(s,ResponsesTransport.synthetic(httpx.MockTransport(lose)),tmp_path/'state')
    with pytest.raises(TransportError):worker.run(ws,q.run.id)
    assert ResponsesWorker(Service(Database()),fake.transport(),tmp_path/'state').run(ws,q.run.id)=='count_outcome_unknown'
    assert calls==['/v1/responses/input_tokens'] and fake.calls==[]
    assert totals(s,g)['request_counts']['count_send']==1


def test_selection_has_metadata_only_and_final_uses_broker_result(context,tmp_path):
    import httpx
    from workagent.responses_transport import ResponsesTransport
    s,p,ws,refs,_=context
    g,q,fake,worker=setup(context,tmp_path)
    payloads=[]
    def capture(request):
        if request.url.path=='/v1/responses':payloads.append(json.loads(request.content))
        return fake.handle(request)
    worker=ResponsesWorker(s,ResponsesTransport.synthetic(httpx.MockTransport(capture)),tmp_path/'state')
    assert worker.run(ws,q.run.id)=='completed'
    selection,final=payloads
    context_meta=json.loads(selection['input'][0]['content'])
    assert set(context_meta)=={'sources','kind','include_current_body'}
    assert all(set(row)=={'id','title','external_version'} for row in context_meta['sources'])
    assert final['input'][-1]['type']=='function_call_output'
    tool=json.loads(final['input'][-1]['output'])
    assert all('content' in row for row in tool['sources'])
    assert len(tool['sources'])==len(refs) and tool['current_body'] is None


def test_revoked_after_reservation_does_not_dispatch(context,tmp_path):
    s,p,ws,refs,admin=context
    g,q,fake,worker=setup(context,tmp_path)
    def revoke(name):
        if name=='after_predispatch':revoke_grant(Database(admin),g.id)
    worker.hook=revoke
    with pytest.raises(Exception):worker.run(ws,q.run.id)
    assert len(fake.calls)==1 and fake.calls[0][1].endswith('/input_tokens')
    assert totals(s,g)['request_counts']['dispatch']==1
    assert totals(s,g)['unknown_usage_steps']==1


def test_grant_route_and_pins_fail_before_network(context,tmp_path):
    from pydantic import ValidationError
    from workagent.runtime_config import BundleDenied
    s,p,ws,refs,admin=context
    g=grant(context)
    with pytest.raises(ValidationError):ProviderGrant.model_validate({**g.model_dump(mode='json'),'model':'unapproved'})
    with pytest.raises(ValidationError):ProviderGrant.model_validate({**g.model_dump(mode='json'),'responses':None})
    with pytest.raises(ValidationError):ResponsesBinding.model_validate({**g.responses.model_dump(),'project_id':''})
    # Pin drift is rejected at claim even if no request was dispatched.
    q=create(context);fake=SyntheticResponses()
    from unittest.mock import patch
    with patch('workagent.responses_worker.consumer_hash',return_value='0'*64):
        raises('unsupported_operation',lambda:ResponsesWorker(s,fake.transport(),tmp_path/'state').run(ws,q.run.id))
    assert fake.calls==[]


def test_live_cli_missing_access_precedes_db_key_and_network(monkeypatch,capsys,tmp_path):
    import sys
    import workagent.responses_dispatcher as module
    def forbidden(*args,**kwargs):pytest.fail('must not inspect DB, key or provider')
    monkeypatch.setenv('LOCAL_TEST_MODE','true')
    monkeypatch.setattr(module,'Database',forbidden)
    monkeypatch.setattr(module,'load_credential',forbidden)
    monkeypatch.setattr(module,'ResponsesTransport',forbidden)
    record=tmp_path/'authority.json'
    record.write_text(json.dumps({'runtime':{'product_project_id':None,'secure_secret_reference':None}}))
    monkeypatch.setattr(sys,'argv',['responses_dispatcher','--authority-record',str(record),
        '--workspace','pending','--grant-id','intake-live-01','--state-dir',str(tmp_path/'unused'),'--once'])
    with pytest.raises(SystemExit) as caught:module.main()
    assert caught.value.code==2
    assert json.loads(capsys.readouterr().err)['code']=='product_project_and_secure_key_reference_missing'
    assert not (tmp_path/'unused').exists()


def test_deadline_after_count_stops_and_reuses_count(context,tmp_path,monkeypatch):
    from types import SimpleNamespace
    import workagent.responses_worker as module
    clock=[0.0]
    monkeypatch.setattr(module,'time',SimpleNamespace(monotonic=lambda:clock[0],sleep=lambda _:None))
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path)
    worker.hook=lambda name:clock.__setitem__(0,200.0) if name=='after_count' else None
    assert worker.run(ws,q.run.id)=='deferred'
    assert len(fake.calls)==1 and totals(s,g)['request_counts']['dispatch']==0
    worker.hook=None
    assert worker.run(ws,q.run.id)=='completed'
    assert totals(s,g)['request_counts']=={'count_send':2,'dispatch':2,'read':0,'cancel':0}


def test_pre_responses_registry_pin_still_executes_fixture(context):
    from unittest.mock import patch
    from workagent.tool_registry import registry_for_hash
    from workagent.fixture import work_once
    old_hash='5b4ec700d49b2b2debe28efc5230543b861763a37207b73c84f7e61de9019f10'
    old=registry_for_hash(old_hash)
    assert digest(old)==old_hash
    with patch('workagent.tool_registry.registry',return_value=old):q=create(context)
    assert q.run.tool_registry_hash==old_hash
    s,p,ws,_,_=context
    work_once(s,p,ws,q.run.id)
    assert s.get_run(p,ws,q.run.id).state=='ready'


def test_private_receipt_permissions_and_append_only_acl(context,tmp_path):
    s,p,ws,_,_=context
    g,q,fake,worker=setup(context,tmp_path)
    assert worker.run(ws,q.run.id)=='completed'
    for path in (tmp_path/'state').iterdir(): assert path.stat().st_mode & 0o777==0o600
    for table in ('responses_steps','responses_events'):
        with pytest.raises(psycopg.Error):
            with s.db.transaction() as c:c.execute(f'DELETE FROM {table}')
        with pytest.raises(psycopg.Error):
            with s.db.transaction() as c:c.execute(f'UPDATE {table} SET phase=phase')
