"""No-provider checkpoint: real PostgreSQL, explicitly synthetic provider receipts."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import subprocess
import sys

import psycopg
import pytest
from test_domain import context, cmd, create, ready, raises
from test_runtime import expire
from workagent.db import Database
from workagent.models import *
from workagent.service import Service, digest


def grant(context, **changes):
    from workagent.provider_attempts import configure_grant
    s,p,ws,_,admin=context
    values=dict(id=new_id(), workspace_id=ws, principal_id=p.id,
                model='synthetic-no-provider', consumer_sha256='a'*64,
                expires_at=now()+timedelta(minutes=15), max_runs=1)
    values.update(changes)
    return configure_grant(Database(admin), ProviderGrant(**values))


def admitted(context):
    s,p,ws,_,_=context
    g=grant(context)
    q=create(context)
    cap=s.claim_run(p,ws,q.run.id)
    attempt=s.prepare_provider_attempt(cap, request_hash=digest({'synthetic':'request'}), consumer_sha256=g.consumer_sha256,evidence_origin='synthetic_provider_receipt')
    return q,cap,attempt


def receipt():
    return ProviderResult(provider_session_id='synthetic-session', provider_turn_id='synthetic-turn',
        bodies=[Body(title='Prepared next action, not executed', blocks=[Block(block_id='next',kind='paragraph',text='Review this document.')])],
        usage=ProviderUsage(input_tokens=10,output_tokens=5))


def test_predispatch_identity_and_single_dispatch_permission(context):
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    assert attempt.state=='prepared' and attempt.result is None
    with ThreadPoolExecutor(max_workers=4) as pool:
        repeated=list(pool.map(lambda _:s.prepare_provider_attempt(cap,request_hash=attempt.request_hash,consumer_sha256='a'*64,evidence_origin='synthetic_provider_receipt'),range(4)))
    assert {x.id for x in repeated}=={attempt.id}
    raises('command_conflict',lambda:s.prepare_provider_attempt(cap,request_hash='b'*64,consumer_sha256='a'*64,evidence_origin='synthetic_provider_receipt'))
    def dispatch(_):
        try:
            return s.dispatch_provider_attempt(cap,attempt.id).state
        except Exception as e:
            return e.code.value
    with ThreadPoolExecutor(max_workers=4) as pool:
        states=list(pool.map(dispatch,range(4)))
    assert states.count('dispatched')==1 and states.count('action_unresolved')==3
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['n']==1


def test_unknown_after_process_restart_lease_expiry_and_delivery(context):
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    s.mark_provider_unknown(rc)
    raises('action_unresolved',lambda:s.fail_provider_attempt(rc))
    expire(context,q.run.id)
    # A new Python process receives the same durable queue delivery.
    result=subprocess.run([sys.executable,'-m','workagent.dispatcher','--once','--workspace',ws],capture_output=True,text=True,check=True)
    assert '"completed": 0' in result.stdout
    restarted=Service(Database())
    for _ in range(3):
        raises('action_unresolved',lambda:restarted.claim_run(p,ws,q.run.id))
        raises('action_unresolved',lambda:restarted.recover_provider_run(p,ws,q.run.id))
    assert restarted.get_provider_attempt(p,ws,q.run.id).id==attempt.id
    assert restarted.get_assignment(p,ws,q.assignment.id).responsibility.runs[-1].state=='outcome_unknown'


def test_received_commit_and_reconcile_are_separate_boundaries(context):
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    raises('action_unresolved',lambda:s.complete_run(cap,receipt().bodies))
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_result(rc,receipt())
    assert s.get_assignment(p,ws,q.assignment.id).artifact_ids==[]
    assert not s.reconcile_provider_attempt(rc)
    expire(context,q.run.id)
    cap=s.recover_provider_run(p,ws,q.run.id)
    raises('command_conflict',lambda:s.complete_run(cap,[Body(title='Different',blocks=[Block(block_id='x',kind='paragraph',text='Done')])]))
    completed=s.complete_run(cap,receipt().bodies,command=cmd(Command))
    assert completed.execution.mode=='managed' and completed.execution.attempt_id==attempt.id
    assert s.get_provider_attempt(p,ws,q.run.id).state=='responded'
    assert s.reconcile_provider_attempt(rc)
    assert s.get_provider_attempt(p,ws,q.run.id).state=='reconciled'
    assert s.record_provider_result(rc,receipt()) is True
    assert s.get_provider_attempt(p,ws,q.run.id).state=='reconciled'
    outcome=s.get_assignment(p,ws,q.assignment.id).responsibility
    assert outcome.underlying_action_performed is False
    assert outcome.runs[-1].state=='prepared'
    assert s.list_assignments(p,ws).items[0].responsibility==outcome


def test_exact_approval_readback_and_concurrent_human_edit(context):
    s,p,ws,_,_=context
    a,art=ready(context)
    q=s.request_revision(p,ws,art.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=art.current_revision_id,instruction='Prepare the next action'))
    cap=s.claim_run(p,ws,q.run.id)
    r=s.complete_run(cap,receipt().bodies)
    outcome=s.get_assignment(p,ws,a.id).responsibility.runs[-1]
    assert outcome.state=='decision_required' and outcome.artifacts[0].body_hash==digest(receipt().bodies[0])
    accepted=s.accept_proposal(p,ws,r.proposal_id,cmd(AcceptProposal,expected_current_revision_id=art.current_revision_id))
    verified=s.get_assignment(p,ws,a.id).responsibility.runs[-1]
    assert verified.state=='readback_verified' and verified.artifacts[0].revision_id==accepted.current_revision_id
    assert all(x.status=='passed' for x in verified.checks)
    a=s.get_assignment(p,ws,a.id)
    q=s.request_revision(p,ws,art.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=accepted.current_revision_id,instruction='Another revision'))
    cap=s.claim_run(p,ws,q.run.id)
    human=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=accepted.current_revision_id,body=Body(title='Human survives',blocks=[Block(block_id='human',kind='paragraph',text='Keep exactly')])) )
    stale=s.complete_run(cap,receipt().bodies)
    raises('version_conflict',lambda:s.accept_proposal(p,ws,stale.proposal_id,cmd(AcceptProposal,expected_current_revision_id=human.current_revision_id)))
    assert s.get_assignment(p,ws,a.id).responsibility.runs[-1].state=='decision_stale'
    assert s.get_artifact(p,ws,art.id).current_revision.body==human.current_revision.body


def test_false_completion_not_authority(context):
    from workagent.dispatcher import Dispatcher
    s,p,ws,_,admin=context
    q=create(context)
    with Database(admin).transaction() as c:
        c.execute("UPDATE runs SET data=jsonb_set(data,'{state}','\"ready\"') WHERE workspace_id=%s AND id=%s",(ws,q.run.id))
    assert s.get_assignment(p,ws,q.assignment.id).responsibility.runs[-1].state=='unverified'
    assert not Dispatcher(s).reconcile(ws,q.run.id)


def test_grant_runtime_guard_and_revocation(context):
    from workagent.provider_attempts import configure_grant, revoke_grant
    from workagent.runtime_config import BundleDenied
    s,p,ws,_,admin=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    with pytest.raises(BundleDenied):
        configure_grant(s.db,ProviderGrant(id=new_id(),workspace_id=ws,principal_id=p.id,model='synthetic',consumer_sha256='a'*64,expires_at=now()+timedelta(minutes=10)))
    with pytest.raises(psycopg.Error):
        with s.db.transaction() as c:
            c.execute('UPDATE provider_grants SET active=false WHERE workspace_id=%s',(ws,))
    revoke_grant(Database(admin),attempt.grant_id)
    raises('action_unresolved',lambda:s.dispatch_provider_attempt(cap,attempt.id))
    raises('action_unresolved',lambda:s.record_provider_result(rc,receipt()))
    assert s.get_provider_attempt(p,ws,q.run.id).state=='prepared'


def test_unknown_keeps_correlation_ids_and_cannot_resume_as_new_run(context):
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_identity(rc,provider_session_id='synthetic-session')
    s.mark_provider_unknown(rc)
    s.record_provider_identity(rc,provider_session_id='synthetic-session',provider_turn_id='synthetic-turn')
    raises('command_conflict',lambda:s.record_provider_identity(rc,provider_session_id='wrong'))
    reopened=Service(Database()).get_provider_attempt(p,ws,q.run.id)
    assert reopened.provider_session_id=='synthetic-session' and reopened.provider_turn_id=='synthetic-turn'
    a=s.get_assignment(p,ws,q.assignment.id)
    paused=s.control_assignment(p,ws,a.id,cmd(ControlAssignment,expected_work_version=a.work_version,operation='pause'))
    raises('action_unresolved',lambda:s.control_assignment(p,ws,a.id,cmd(ControlAssignment,expected_work_version=paused.work_version,operation='resume')))
    assert s.get_assignment(p,ws,a.id).run_ids==[q.run.id]


def test_prepared_orphan_and_failed_attempt_cannot_be_reclaimed(context):
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    expire(context,q.run.id)
    raises('action_unresolved',lambda:s.claim_run(p,ws,q.run.id))
    s.fail_provider_attempt(rc)
    assert s.get_provider_attempt(p,ws,q.run.id).state=='failed'
    raises('action_unresolved',lambda:s.claim_run(p,ws,q.run.id))
    raises('action_unresolved',lambda:s.record_provider_result(rc,receipt()))


def test_source_revocation_denies_received_result_continuation(context):
    s,p,ws,refs,admin=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_result(rc,receipt())
    with Database(admin).transaction() as c:
        c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    raises('not_found_or_not_authorized',lambda:s.complete_run(cap,receipt().bodies))
    raises('not_found_or_not_authorized',lambda:s.recover_provider_run(p,ws,q.run.id))
    assert s.reconcile_provider_attempt(rc) is False  # No publication; no content returned.
    assert s.list_assignments(p,ws).items==[]


def test_receipt_budget_is_not_claimed_as_provider_hard_budget(context):
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    result=receipt()
    result.usage.output_tokens=5000
    assert s.record_provider_result(rc,result) is True
    stored=s.get_provider_attempt(p,ws,q.run.id)
    assert stored.result.usage.output_tokens==5000  # Never discard already incurred usage.
    raises('budget_exhausted',lambda:s.complete_run(cap,result.bodies))
    with s.db.transaction() as c:
        pin=c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
        assert pin['provider_hard_budget']=='not_enforced'
        assert pin['budget']['unit']=='local_publication'


def test_immutable_identity_result_and_transition_guards(context):
    from workagent.service import encoded
    s,p,ws,_,admin=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    for dsn in (s.db.dsn,admin):
        for field,value in [('request_hash','b'*64),('model','different'),('grant_id','different'),('state','responded')]:
            with pytest.raises(psycopg.Error):
                with Database(dsn).transaction() as c:
                    c.execute('UPDATE provider_attempts SET data=jsonb_set(data,%s,%s) WHERE workspace_id=%s AND run_id=%s',([field],encoded(value),ws,q.run.id))
        with pytest.raises(psycopg.Error):
            with Database(dsn).transaction() as c:
                c.execute('DELETE FROM provider_attempts WHERE workspace_id=%s',(ws,))
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_result(rc,receipt())
    conflicting=receipt(); conflicting.usage.input_tokens=99
    raises('command_conflict',lambda:s.record_provider_result(rc,conflicting))
    with pytest.raises(psycopg.Error):
        with Database(admin).transaction() as c:
            c.execute("UPDATE provider_attempts SET data=jsonb_set(jsonb_set(data,'{state}','\"reconciled\"'),'{result,usage,input_tokens}','99') WHERE workspace_id=%s",(ws,))


def test_legacy_fixture_registry_byte_binding_survives_schema_additions(context,monkeypatch):
    import workagent.tool_registry as tools
    from workagent.fixture import work_once
    legacy='3e2f8620ade8655d26866eaed34e383d3f0a4ee31a96ad1fcc65909a28018572'
    old=tools.registry_for_hash(legacy)
    with monkeypatch.context() as m:
        m.setattr(tools,'registry',lambda:old)
        q=create(context)
    s,p,ws,_,_=context
    assert q.run.tool_registry_hash==legacy
    work_once(s,p,ws,q.run.id)
    assert s.get_assignment(p,ws,q.assignment.id).responsibility.runs[-1].state=='prepared'


def test_atomic_publication_failure_retains_result_for_local_retry(context,monkeypatch):
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_result(rc,receipt())
    original=s._event
    def fail(c,p,ws,operation,object_id):
        if operation=='complete_run':
            raise RuntimeError('synthetic transaction failure')
        return original(c,p,ws,operation,object_id)
    with monkeypatch.context() as m:
        m.setattr(s,'_event',fail)
        with pytest.raises(RuntimeError):
            s.complete_run(cap,receipt().bodies)
    assert s.get_assignment(p,ws,q.assignment.id).artifact_ids==[]
    assert s.get_provider_attempt(p,ws,q.run.id).state=='responded'
    s.complete_run(cap,receipt().bodies)
    assert s.reconcile_provider_attempt(rc)


def test_assignment_http_projection_is_common_safe_and_readonly(context):
    import json
    from fastapi.testclient import TestClient
    from workagent.api import create_app, Settings
    s,p,ws,_,_=context
    a,art=ready(context)
    settings=Settings(s.db.dsn,True,'X'*40,p.id)
    headers={'Authorization':'Bearer '+settings.local_bearer,'X-Schema-Version':'workagent/v1','X-Request-Id':'projection'}
    with s.db.transaction() as c:
        before=c.execute('SELECT count(*) AS n FROM audit WHERE workspace_id=%s',(ws,)).fetchone()['n']
    with TestClient(create_app(settings)) as client:
        base=f'/v1/workspaces/{ws}/assignments'
        detail=client.get(base+'/'+a.id,headers=headers)
        listing=client.get(base,headers=headers)
        assert detail.status_code==listing.status_code==200
        projection=detail.json()['responsibility']
        assert listing.json()['items'][0]['responsibility']==projection
        assert projection['underlying_action_performed'] is False
        assert '"body":' not in json.dumps(projection)
        assert 'provider_session_id' not in json.dumps(projection)
        assert projection['runs'][0]['execution']['mode']=='fixture'
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM audit WHERE workspace_id=%s',(ws,)).fetchone()['n']==before
    paths=create_app(settings).openapi()['paths']
    assert not any('provider' in x or 'grant' in x or 'claim' in x for x in paths)


def test_grants_are_bounded_expiry_fails_closed_and_cannot_reenable(context,monkeypatch):
    import workagent.provider_attempts as provider
    from pydantic import ValidationError
    from workagent.runtime_config import BundleDenied
    s,p,ws,_,admin=context
    with pytest.raises(ValidationError):
        grant(context,max_runs=11)
    with pytest.raises(BundleDenied):
        grant(context,expires_at=now()+timedelta(hours=2))
    g=grant(context)
    q=create(context)
    raises('budget_exhausted',lambda:create(context))
    with monkeypatch.context() as m:
        m.setattr(provider,'now',lambda:g.expires_at+timedelta(seconds=1))
        raises('action_unresolved',lambda:s.claim_run(p,ws,q.run.id))
        raises('action_unresolved',lambda:create(context))
    assert provider.revoke_grant(Database(admin),g.id)
    with pytest.raises(psycopg.Error):
        with Database(admin).transaction() as c:
            c.execute('UPDATE provider_grants SET active=true WHERE id=%s',(g.id,))
    assert s.get_assignment(p,ws,q.assignment.id).artifact_ids==[]


def test_plausible_false_accepted_pointer_fails_actual_body_readback(context):
    from workagent.service import encoded
    from workagent.dispatcher import Dispatcher
    s,p,ws,_,admin=context
    a,art=ready(context)
    q=s.request_revision(p,ws,art.id,cmd(RequestRevision,expected_work_version=a.work_version,
        base_revision_id=art.current_revision_id,instruction='Prepare a change'))
    cap=s.claim_run(p,ws,q.run.id)
    run=s.complete_run(cap,receipt().bodies)
    human=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=art.current_revision_id,
        body=Body(title='Human unrelated body',blocks=[Block(block_id='h',kind='paragraph',text='Not the proposed change')])))
    # A plausible terminal label and real current revision ID are still insufficient.
    with Database(admin).transaction() as c:
        c.execute("UPDATE proposals SET data=jsonb_set(jsonb_set(data,'{status}','\"accepted\"'),'{accepted_revision_id}',%s) WHERE workspace_id=%s AND id=%s",
                  (encoded(human.current_revision_id),ws,run.proposal_id))
    outcome=s.get_assignment(p,ws,a.id).responsibility.runs[-1]
    assert outcome.state=='unverified' and outcome.outcome_gate=='failed'
    assert next(x for x in outcome.checks if x.name=='saved_body').status=='failed'
    assert not Dispatcher(s).reconcile(ws,q.run.id)
