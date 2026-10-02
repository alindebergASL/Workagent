"""Observed final reasoning contract regression: real worker, synthetic HTTP only."""
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
import json
from pathlib import Path
from unittest.mock import patch
import httpx
import psycopg
import pytest
from test_domain import context, create, cmd, raises
from test_runtime import expire
from test_responses_worker import grant, totals
from workagent.db import Database
from workagent.models import now, HumanSave, RequestRevision, Block
from workagent.responses_worker import ResponsesWorker, consumer_hash
from workagent.responses_synthetic import SyntheticResponses
from workagent.responses_transport import ResponsesTransport
from workagent.service import digest

FIXTURE=Path(__file__).parent/'fixtures/final_reasoning_no_cipher.json'
OLD=sha256(b'previous reviewed synthetic consumer').hexdigest()

class FaithfulWire(SyntheticResponses):
    """Only correlation/source IDs change; no captured credentials/ciphertext."""
    def handle(self,request):
        response=super().handle(request)
        if request.method=='POST' and request.url.path=='/v1/responses':
            doc=response.json()
            if doc['metadata']['step_id']=='final':
                fixture=json.loads(FIXTURE.read_text())
                value=json.loads(fixture['output'][1]['content'][0]['text'])
                generated=json.loads(doc['output'][0]['content'][0]['text'])
                value['source_basis']=generated['source_basis']
                fixture['output'][1]['content'][0]['text']=json.dumps(value)
                fixture.update(id=doc['id'],metadata=doc['metadata'])
                self.responses[doc['id']]=fixture
                return httpx.Response(200,json=fixture)
        return response


def approval(g):
    from workagent.responses_recovery import SuccessorApproval
    return SuccessorApproval(grant_id=g.id,original_consumer_sha256=g.consumer_sha256,
        successor_consumer_sha256=consumer_hash(),original_grant_sha256=digest(g),
        expires_at=now()+timedelta(minutes=45),reason='Reviewed final reasoning optional-content contract repair')


def install(context,g):
    from workagent.responses_recovery import install_successor
    a=approval(g)
    assert install_successor(Database(context[4]),a)==a
    return a


def legacy_run(context,tmp_path,*,lose_id=False):
    import workagent.responses_transport as module
    parser=module.parse_response
    def old_parser(document,request,provenance,**kwargs):
        result=parser(document,request,provenance,**kwargs)
        if request.phase=='final' and any(x.get('type')=='reasoning' and not x.get('encrypted_content') for x in document.get('output',[])):
            return replace(result,state='malformed',value=None,output_items=b'[]',issue='invalid_reasoning_item')
        return result
    with patch('workagent.responses_worker.consumer_hash',return_value=OLD), patch('test_responses_worker.consumer_hash',return_value=OLD):
        g=grant(context); q=create(context); fake=FaithfulWire(lose_id=lose_id)
        worker=ResponsesWorker(context[0],fake.transport(),tmp_path/'state')
        with patch.object(module,'parse_response',side_effect=old_parser):
            assert worker.run(context[2],q.run.id)==('outcome_unknown' if lose_id else 'invalid_final')
    return g,q,fake,worker


def events(context,run_id):
    with context[0].db.transaction() as c:
        return c.execute('SELECT e.* FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s ORDER BY e.created_at,e.id',(run_id,)).fetchall()


def test_current_parser_final_optional_cipher_actual_worker(context,tmp_path):
    g=grant(context);q=create(context);wire=FaithfulWire()
    worker=ResponsesWorker(context[0],wire.transport(),tmp_path/'state')
    assert worker.run(context[2],q.run.id)=='completed'
    assert totals(context[0],g)['request_counts']=={'count_send':2,'dispatch':2,'read':0,'cancel':0}


def test_same_id_recovery_and_remaining_revision_share_root_budget(context,tmp_path):
    s,p,ws,_,_=context
    g,q,wire,worker=legacy_run(context,tmp_path)
    original=events(context,q.run.id); before=totals(s,g)
    old_result=next(e for e in original if e['phase']=='final' and e['kind']=='result')
    assert old_result['data']['state']=='malformed'
    assert old_result['data']['output_items']=='[]'
    a=install(context,g)
    expire(context,q.run.id)
    assert worker.run(ws,q.run.id,reconcile_only=True)=='completed'
    after=totals(s,g)
    assert after=={**before,'request_counts':{**before['request_counts'],'read':1}}
    current=events(context,q.run.id)
    assert all(e in current for e in original)
    corrected=[e for e in current if e['kind']=='corrected_readback']
    assert len(corrected)==1
    correction=corrected[0]['data']
    assert correction['response_id']==old_result['data']['response_id']
    assert correction['original_result_sha256']==digest(old_result['data'])
    assert correction['original_consumer_sha256']==OLD
    assert correction['actual_consumer_sha256']==a.successor_consumer_sha256
    assert wire.calls[-1]==('GET','/v1/responses/'+correction['response_id'])
    n=len(wire.calls)
    assert worker.run(ws,q.run.id,reconcile_only=True)=='reconciled'
    assert len(wire.calls)==n
    assignment=s.get_assignment(p,ws,q.assignment.id)
    assert assignment.responsibility.runs[-1].outcome_gate=='passed'
    art=s.get_artifact(p,ws,assignment.artifact_ids[0])
    revision=s.request_revision(p,ws,art.id,cmd(RequestRevision,expected_work_version=assignment.work_version,
        base_revision_id=art.current_revision_id,instruction='Clarify ownership, preserve prior human notes.'))
    assert worker.run(ws,revision.run.id)=='completed'
    assert totals(s,g)['request_counts']=={'count_send':4,'dispatch':4,'read':1,'cancel':0}
    raises('budget_exhausted',lambda:create(context))
    with s.db.transaction() as c:
        assert c.execute('SELECT data FROM provider_grants WHERE id=%s',(g.id,)).fetchone()['data']==g.model_dump(mode='json')
        configs=c.execute("SELECT data FROM run_configurations WHERE data->>'grant_id'=%s",(g.id,)).fetchall()
        assert len(configs)==2 and all(x['data']['consumer_sha256']==OLD for x in configs)
        uses=c.execute('SELECT * FROM responses_consumer_uses WHERE grant_id=%s',(g.id,)).fetchall()
        assert len(uses)==2 and all(x['original_consumer_sha256']==OLD and x['actual_consumer_sha256']==consumer_hash() for x in uses)


def test_no_successor_approval_fails_closed(context,tmp_path):
    g,q,wire,worker=legacy_run(context,tmp_path)
    expire(context,q.run.id); n=len(wire.calls)
    with pytest.raises(Exception):worker.run(context[2],q.run.id,reconcile_only=True)
    assert len(wire.calls)==n and totals(context[0],g)['request_counts']['dispatch']==2


def test_successor_cannot_approve_runtime_or_reset_or_reopen_unknown(context,tmp_path):
    from workagent.responses_recovery import install_successor
    g,q,wire,worker=legacy_run(context,tmp_path,lose_id=True)
    with pytest.raises(Exception): install_successor(context[0].db,approval(g))
    with pytest.raises(psycopg.Error):
        with context[0].db.transaction() as c:
            c.execute('INSERT INTO provider_consumer_successors(grant_id,data) VALUES (%s,%s)',(g.id,json.dumps(approval(g).model_dump(mode='json'))))
    install(context,g); expire(context,q.run.id); n=len(wire.calls)
    assert worker.run(context[2],q.run.id,reconcile_only=True)=='outcome_unknown'
    assert worker.run(context[2],q.run.id)=='outcome_unknown'
    assert len(wire.calls)==n
    assert totals(context[0],g)['request_counts']['dispatch']==1
    with pytest.raises(Exception):install_successor(Database(context[4]),approval(g))


@pytest.mark.parametrize('fault',['id','metadata','model','usage','schema'])
def test_readback_mismatch_never_corrects_or_publishes(context,tmp_path,fault):
    s,p,ws,_,_=context
    g,q,wire,_=legacy_run(context,tmp_path); install(context,g); expire(context,q.run.id)
    original=events(context,q.run.id)
    def bad(request):
        response=wire.handle(request)
        if request.method=='GET':
            d=response.json()
            if fault=='id':d['id']='resp_wrong'
            if fault=='metadata':d['metadata']['request_id']='wrong'
            if fault=='model':d['model']='wrong'
            if fault=='usage':d['usage']['output_tokens']+=1; d['usage']['total_tokens']+=1
            if fault=='schema':d['output'][1]['content'][0]['text']='{}'
            return httpx.Response(200,json=d)
        return response
    worker=ResponsesWorker(s,ResponsesTransport.synthetic(httpx.MockTransport(bad)),tmp_path/'state')
    with pytest.raises(Exception):worker.run(ws,q.run.id,reconcile_only=True)
    current=events(context,q.run.id)
    assert all(e in current for e in original)
    assert not any(e['kind']=='corrected_readback' for e in current)
    assert s.get_assignment(p,ws,q.assignment.id).artifact_ids==[]
    assert totals(s,g)['request_counts']=={'count_send':2,'dispatch':2,'read':1,'cancel':0}


@pytest.mark.parametrize('when',['before_get','during_get','before_publication'])
def test_recovery_publication_requires_current_source_rights(context,tmp_path,when):
    s,p,ws,_,admin=context
    g,q,wire,_=legacy_run(context,tmp_path);install(context,g);expire(context,q.run.id)
    def revoke():
        with psycopg.connect(admin) as c:c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    def handler(request):
        response=wire.handle(request)
        if request.method=='GET' and when=='during_get':revoke()
        return response
    worker=ResponsesWorker(s,ResponsesTransport.synthetic(httpx.MockTransport(handler)),tmp_path/'state',
        hook=lambda name:revoke() if when=='before_publication' and name=='before_publication' else None)
    if when=='before_get':revoke()
    n=len(wire.calls)
    with pytest.raises(Exception):worker.run(ws,q.run.id,reconcile_only=True)
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM run_publications WHERE run_id=%s',(q.run.id,)).fetchone()['n']==0
    if when=='before_get':assert len(wire.calls)==n


def test_expired_original_grant_and_lease_recover_with_explicit_successor(context,tmp_path):
    import time
    # Give the ORIGINAL immutable grant a short real lease. Never rewrite it.
    instant=now()
    with patch('test_responses_worker.now',return_value=instant-timedelta(minutes=45)+timedelta(seconds=12)):
        g,q,wire,worker=legacy_run(context,tmp_path)
    time.sleep(max(0,(g.expires_at-now()).total_seconds())+0.05)
    expire(context,q.run.id)
    n=len(wire.calls)
    with pytest.raises(Exception):worker.run(context[2],q.run.id,reconcile_only=True)
    assert len(wire.calls)==n
    install(context,g)
    assert worker.run(context[2],q.run.id,reconcile_only=True)=='completed'
    assert totals(context[0],g)['request_counts']=={'count_send':2,'dispatch':2,'read':1,'cancel':0}


def test_revoked_grant_cannot_be_restored_by_successor(context,tmp_path):
    from workagent.provider_attempts import revoke_grant
    from workagent.responses_recovery import install_successor
    g,q,wire,worker=legacy_run(context,tmp_path)
    a=install(context,g)
    revoke_grant(Database(context[4]),g.id);expire(context,q.run.id)
    n=len(wire.calls)
    with pytest.raises(Exception):worker.run(context[2],q.run.id,reconcile_only=True)
    with pytest.raises(Exception):install_successor(Database(context[4]),a)
    assert len(wire.calls)==n


@pytest.mark.parametrize('field',['original_consumer_sha256','successor_consumer_sha256','original_grant_sha256'])
def test_operator_exact_hash_binding_not_an_allowlist(context,tmp_path,field):
    from workagent.responses_recovery import install_successor
    g,q,wire,worker=legacy_run(context,tmp_path)
    a=approval(g).model_copy(update={field:'f'*64})
    with pytest.raises(Exception):install_successor(Database(context[4]),a)
    with context[0].db.transaction() as c:
        assert not c.execute('SELECT 1 FROM provider_consumer_successors WHERE grant_id=%s',(g.id,)).fetchone()


@pytest.mark.parametrize('fault',['request_hash','request_metadata','usage','response_id'])
def test_correction_ledger_rejects_changed_parsed_binding(context,tmp_path,monkeypatch,fault):
    from workagent.responses_ledger import Ledger
    g,q,wire,worker=legacy_run(context,tmp_path);install(context,g);expire(context,q.run.id)
    original=Ledger.corrected_readback
    def altered(self,request,response,read_id,cap):
        if fault=='request_hash':response=replace(response,request_sha256='f'*64)
        if fault=='request_metadata':response=replace(response,metadata=response.metadata.model_copy(update={'request_id':'wrong'}))
        if fault=='usage':response=replace(response,usage=replace(response.usage,reasoning_tokens=response.usage.reasoning_tokens+1))
        if fault=='response_id':response=replace(response,response_id='resp_wrong')
        return original(self,request,response,read_id,cap)
    monkeypatch.setattr(Ledger,'corrected_readback',altered)
    raises('command_conflict',lambda:worker.run(context[2],q.run.id,reconcile_only=True))
    assert not any(e['kind']=='corrected_readback' for e in events(context,q.run.id))


def test_corrected_observation_restart_no_receipt_overwrite_or_network(context,tmp_path):
    g,q,wire,worker=legacy_run(context,tmp_path);install(context,g);expire(context,q.run.id)
    def crash(name):
        if name=='before_publication':raise RuntimeError('synthetic post-correction crash')
    worker.hook=crash
    with pytest.raises(RuntimeError):worker.run(context[2],q.run.id,reconcile_only=True)
    saved=context[0].get_provider_attempt(context[1],context[2],q.run.id)
    expire(context,q.run.id);n=len(wire.calls);worker.hook=None
    assert worker.run(context[2],q.run.id,reconcile_only=True)=='completed'
    assert len(wire.calls)==n
    final=context[0].get_provider_attempt(context[1],context[2],q.run.id)
    assert final.result_hash==saved.result_hash and final.result==saved.result
    assert sum(e['kind']=='corrected_readback' for e in events(context,q.run.id))==1


def test_reconcile_only_never_dispatches_unsent_or_imports_receipt(context,tmp_path):
    g=grant(context);q=create(context);wire=FaithfulWire()
    worker=ResponsesWorker(context[0],wire.transport(),tmp_path/'state')
    raises('action_unresolved',lambda:worker.run(context[2],q.run.id,reconcile_only=True))
    assert wire.calls==[]
    def crash(name):
        if name=='after_count':raise RuntimeError('synthetic definitely-unsent crash')
    worker.hook=crash
    with pytest.raises(RuntimeError):worker.run(context[2],q.run.id)
    worker.hook=None;n=len(wire.calls)
    assert worker.run(context[2],q.run.id,reconcile_only=True)=='deferred'
    assert len(wire.calls)==n and totals(context[0],g)['request_counts']['dispatch']==0


def test_operator_cli_install_readback_no_credential_or_provider_access(context,tmp_path,monkeypatch,capsys):
    import sys
    from workagent import responses_dispatcher as cli
    from workagent.models import new_id
    from workagent.provider_attempts import configure_grant,revoke_grant
    with patch('test_responses_worker.consumer_hash',return_value=OLD):g=grant(context)
    revoke_grant(Database(context[4]),g.id)
    g=configure_grant(Database(context[4]),g.model_copy(update={'id':new_id(),
        'responses':g.responses.model_copy(update={'transport_mode':'official_api',
            'project_id':'proj_SYNTHETIC','secret_reference':'file:/synthetic/never-open'})}))
    a=approval(g);path=tmp_path/'explicit-operator-approval.json';path.write_text(a.model_dump_json())
    monkeypatch.setattr(cli,'authority',lambda _: {'grant_id':g.id,'runtime':{
        'product_project_id':'proj_SYNTHETIC','secure_secret_reference':'file:/synthetic/never-open'}})
    monkeypatch.setattr(cli,'load_credential',lambda _:pytest.fail('install must never open key'))
    monkeypatch.setattr(cli,'ResponsesTransport',lambda **_:pytest.fail('install must never construct transport'))
    monkeypatch.setattr(sys,'argv',['responses_dispatcher','--authority-record','synthetic-record',
        '--workspace',context[2],'--grant-id',g.id,'--state-dir',str(tmp_path/'state'),
        '--install-successor',str(path)])
    cli.main()
    result=json.loads(capsys.readouterr().out)
    assert result=={'status':'operator_successor_installed','approval':a.model_dump(mode='json')}
    with context[0].db.transaction() as c:
        assert c.execute('SELECT data FROM provider_consumer_successors WHERE grant_id=%s',(g.id,)).fetchone()['data']==result['approval']
        assert c.execute('SELECT data FROM provider_grants WHERE id=%s',(g.id,)).fetchone()['data']==g.model_dump(mode='json')
    for owner in (context[0].db,Database(context[4])):
        with pytest.raises(psycopg.Error):
            with owner.transaction() as c:c.execute('UPDATE provider_consumer_successors SET data=data WHERE grant_id=%s',(g.id,))
        with pytest.raises(psycopg.Error):
            with owner.transaction() as c:c.execute('DELETE FROM provider_consumer_successors WHERE grant_id=%s',(g.id,))
    # Runtime credentials cannot install even a separately prepared exact JSON.
    monkeypatch.setenv('MIGRATION_DATABASE_URL',context[0].db.dsn)
    with pytest.raises(SystemExit) as failure:cli.main()
    assert failure.value.code==2
