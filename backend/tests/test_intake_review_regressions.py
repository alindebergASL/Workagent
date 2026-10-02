"""R1/R2/R3 intended-state regressions adapted from independent review probes.

All provider receipts are synthetic. Raw reviewer probes are preserved in scratch.
"""
from datetime import timedelta
import pytest
from test_domain import context, cmd, create, ready, raises
from test_intake_checkpoint import admitted, receipt, grant
from test_runtime import expire
from workagent.db import Database
from workagent.models import *
from workagent.provider_attempts import revoke_grant
from workagent.dispatcher import Dispatcher


def latest(s,p,ws,q):
    return s.get_assignment(p,ws,q.assignment.id).responsibility.runs[-1]


@pytest.mark.parametrize('change',['pause','cancel','grant_revocation','grant_expiry','generation','source_revocation'])
def test_late_receipt_retained_after_authority_change(context,monkeypatch,change):
    import workagent.provider_attempts as provider
    s,p,ws,refs,admin=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    if change in ('pause','cancel'):
        a=s.get_assignment(p,ws,q.assignment.id)
        s.control_assignment(p,ws,a.id,cmd(ControlAssignment,expected_work_version=a.work_version,operation=change))
    elif change=='grant_revocation':
        revoke_grant(Database(admin),attempt.grant_id)
    elif change=='grant_expiry':
        monkeypatch.setattr(provider,'now',lambda:now()+timedelta(hours=2))
    else:
        with Database(admin).transaction() as c:
            c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
            if change=='source_revocation':
                c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
    s.record_provider_result(rc,receipt())
    with s.db.transaction() as c:
        stored=c.execute('SELECT data FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
        assert stored['state']=='responded' and stored['result']['usage']=={'input_tokens':10,'output_tokens':5}
    if change=='source_revocation':
        raises('not_found_or_not_authorized',lambda:s.get_provider_attempt(p,ws,q.run.id))
        assert s.list_assignments(p,ws).items==[]


def test_pause_prepared_has_safe_terminal_escape(context):
    s,p,ws,_,admin=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    a=s.get_assignment(p,ws,q.assignment.id)
    paused=s.control_assignment(p,ws,a.id,cmd(ControlAssignment,expected_work_version=a.work_version,operation='pause'))
    s.fail_provider_attempt(rc)
    assert s.get_provider_attempt(p,ws,q.run.id).state=='failed'
    assert s.get_assignment(p,ws,a.id).state=='paused'
    revoke_grant(Database(admin),attempt.grant_id)
    grant(context)
    resumed=s.control_assignment(p,ws,a.id,cmd(ControlAssignment,expected_work_version=s.get_assignment(p,ws,a.id).work_version,operation='resume'))
    assert len(resumed.run_ids)==2


@pytest.mark.parametrize('expiry',['lease','grant'])
def test_unsent_abandonment_settles_run_progress_queue(context,monkeypatch,expiry):
    import workagent.provider_attempts as provider
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    if expiry=='lease':
        expire(context,q.run.id)
    else:
        monkeypatch.setattr(provider,'now',lambda:now()+timedelta(hours=2))
    s.fail_provider_attempt(rc)
    run=s.get_run(p,ws,q.run.id)
    assert run.state=='partial' and run.unresolved and run.fence>cap.fence
    assert s.get_assignment(p,ws,q.assignment.id).state=='partial'
    assert latest(s,p,ws,q).blocker=='unsent_abandoned'
    sweep=Dispatcher(s,workspace=ws).once()
    assert sweep['deferred']==sweep['completed']==0
    with s.db.transaction() as c:
        assert c.execute('SELECT acknowledged_at FROM run_dispatches WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['acknowledged_at'] is not None


@pytest.mark.parametrize('change',['grant_revocation','grant_expiry'])
def test_revoked_or_expired_unstarted_run_not_preparing(context,monkeypatch,change):
    import workagent.provider_attempts as provider
    s,p,ws,_,admin=context
    g=grant(context); q=create(context)
    if change=='grant_revocation':
        revoke_grant(Database(admin),g.id)
    else:
        monkeypatch.setattr(provider,'now',lambda:now()+timedelta(hours=2))
    result=latest(s,p,ws,q)
    assert result.state=='waiting'
    assert result.blocker==('grant_revoked' if change=='grant_revocation' else 'grant_expired')
    assert result.next_action and not result.continuation_available
    raises('action_unresolved',lambda:s.claim_run(p,ws,q.run.id))


def test_partial_document_exposes_run_unresolved_without_claiming_task_done(context):
    s,p,ws,_,_=context
    q=create(context); cap=s.claim_run(p,ws,q.run.id)
    question='Need the owner to choose Tuesday or Thursday.'
    s.complete_run(cap,receipt().bodies,unresolved=[question])
    result=latest(s,p,ws,q)
    assert result.state=='prepared' and result.outcome_gate=='passed'
    assert result.unresolved==[question] and result.next_action
    assert result.underlying_action_performed is False


def test_postcommit_revoke_ack_then_new_grant_allows_revision(context):
    s,p,ws,_,admin=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_result(rc,receipt())
    s.complete_run(cap,receipt().bodies)
    revoke_grant(Database(admin),attempt.grant_id)
    result=latest(s,p,ws,q)
    assert result.outcome_gate=='passed' and result.state=='prepared'
    assert s.reconcile_provider_attempt(rc)
    grant(context)
    a=s.get_assignment(p,ws,q.assignment.id); art=s.get_artifact(p,ws,a.artifact_ids[0])
    queued=s.request_revision(p,ws,art.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=art.current_revision_id,instruction='Next run with new authorization'))
    assert queued.run.id!=q.run.id


def test_decision_question_exact_proposal_base_and_synthetic_origin(context):
    s,p,ws,_,_=context
    a,art=ready(context)
    grant(context)
    q=s.request_revision(p,ws,art.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=art.current_revision_id,instruction='Review next action'))
    cap=s.claim_run(p,ws,q.run.id)
    from workagent.service import digest
    attempt=s.prepare_provider_attempt(cap,request_hash=digest({'synthetic':'request'}),consumer_sha256='a'*64,evidence_origin='synthetic_provider_receipt')
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_result(rc,receipt())
    run=s.complete_run(cap,receipt().bodies)
    outcome=s.get_assignment(p,ws,a.id).responsibility.runs[-1]
    assert outcome.question.proposal_id==run.proposal_id
    assert outcome.question.base_revision_id==art.current_revision_id
    assert outcome.question.artifact_id==art.id
    assert outcome.execution.evidence_origin=='synthetic_provider_receipt'
    assert outcome.question.prompt and outcome.blocker=='decision_required'


@pytest.mark.parametrize('change',['source_revocation','membership_revocation','pause','cancel','grant_expiry'])
def test_historical_ack_is_write_only_after_authority_loss(context,monkeypatch,change):
    import workagent.provider_attempts as provider
    from workagent.errors import DomainError
    from workagent.service import Principal
    s,p,ws,refs,admin=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_result(rc,receipt())
    s.complete_run(cap,receipt().bodies)
    if change in ('pause','cancel'):
        a=s.get_assignment(p,ws,q.assignment.id)
        s.control_assignment(p,ws,a.id,cmd(ControlAssignment,expected_work_version=a.work_version,operation=change))
    elif change=='grant_expiry':
        monkeypatch.setattr(provider,'now',lambda:now()+timedelta(hours=2))
    else:
        with Database(admin).transaction() as c:
            c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s',(ws,))
            if change=='source_revocation':
                c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND source_id=%s',(ws,refs[0].source_id))
            else:
                c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    raises('not_found_or_not_authorized',lambda:s.record_provider_result(p,receipt()))
    raises('not_found_or_not_authorized',lambda:s.reconcile_provider_attempt(Principal('unrelated')))
    # The sink and historical verifier return no body, correlation IDs or usage.
    assert s.record_provider_result(rc,receipt()) is True
    assert s.reconcile_provider_attempt(rc) is True
    assert s.reconcile_provider_attempt(rc) is True
    with s.db.transaction() as c:
        row=c.execute('SELECT data FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['data']
        assert row['state']=='reconciled'
        assert c.execute('SELECT acknowledged_at FROM run_dispatches WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['acknowledged_at']
        assert c.execute('SELECT count(*) AS n FROM run_publications WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['n']==1
    if change.endswith('revocation'):
        for read in (lambda:s.get_provider_attempt(p,ws,q.run.id),lambda:s.get_assignment(p,ws,q.assignment.id)):
            raises('not_found_or_not_authorized',read)
    else:
        outcome=latest(s,p,ws,q)
        assert outcome.state=='prepared' and outcome.outcome_gate=='passed'
        assert outcome.safety_gate=='failed' and not outcome.continuation_available
    with pytest.raises(DomainError):
        s.complete_run(cap,receipt().bodies)
    with pytest.raises(DomainError):
        s.dispatch_provider_attempt(cap,attempt.id)


@pytest.mark.parametrize('field,value',[
    ('workspace_id','wrong'),('run_id','wrong'),('principal_id','wrong'),
    ('attempt_id','wrong'),('request_hash','b'*64),('consumer_sha256','b'*64),
    ('fence',99),('secret','forged')])
def test_receipt_capability_cannot_retarget_or_forge_identity(context,field,value):
    from dataclasses import replace
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    forged=replace(rc,**{field:value})
    raises('not_found_or_not_authorized',lambda:s.record_provider_result(forged,receipt()))
    raises('not_found_or_not_authorized',lambda:s.reconcile_provider_attempt(forged))
    raises('not_found_or_not_authorized',lambda:s.fail_provider_attempt(forged))
    raises('not_found_or_not_authorized',lambda:s.complete_run(rc,receipt().bodies))
    assert s.get_provider_attempt(p,ws,q.run.id).result is None


@pytest.mark.parametrize('state',['dispatched','outcome_unknown'])
def test_dispatched_never_abandoned_even_after_pause_and_expiry(context,monkeypatch,state):
    import psycopg
    import workagent.provider_attempts as provider
    s,p,ws,_,admin=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    if state=='outcome_unknown':
        s.mark_provider_unknown(rc)
    a=s.get_assignment(p,ws,q.assignment.id)
    s.control_assignment(p,ws,a.id,cmd(ControlAssignment,expected_work_version=a.work_version,operation='pause'))
    monkeypatch.setattr(provider,'now',lambda:now()+timedelta(hours=2))
    raises('action_unresolved',lambda:s.fail_provider_attempt(rc))
    # The additive DB guard closes 004's broader failed transition too.
    for db in (s.db,Database(admin)):
        with pytest.raises(psycopg.Error):
            with db.transaction() as c:
                c.execute("UPDATE provider_attempts SET data=jsonb_set(data,'{state}','\"failed\"'),abandonment_reason='unsent_abandoned' WHERE workspace_id=%s AND run_id=%s",(ws,q.run.id))
    assert s.get_provider_attempt(p,ws,q.run.id).state==state
    with s.db.transaction() as c:
        assert c.execute('SELECT acknowledged_at FROM run_dispatches WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['acknowledged_at'] is None


def test_abandonment_atomic_rollback_and_idempotent_replay(context,monkeypatch):
    import workagent.outcomes as outcomes
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    def fail(*args):
        raise RuntimeError('synthetic ACK transaction failure')
    with monkeypatch.context() as m:
        m.setattr(outcomes,'acknowledge',fail)
        with pytest.raises(RuntimeError):
            s.fail_provider_attempt(rc)
    assert s.get_provider_attempt(p,ws,q.run.id).state=='prepared'
    assert s.get_run(p,ws,q.run.id).state=='running'
    assert s.fail_provider_attempt(rc) is True
    a=s.get_assignment(p,ws,q.assignment.id)
    r=s.get_run(p,ws,q.run.id)
    assert s.fail_provider_attempt(rc) is True
    assert s.get_assignment(p,ws,q.assignment.id)==a and s.get_run(p,ws,q.run.id)==r
    raises('not_found_or_not_authorized',lambda:s.complete_run(cap,receipt().bodies))
    raises('not_found_or_not_authorized',lambda:s.dispatch_provider_attempt(cap,attempt.id))
    raises('action_unresolved',lambda:s.claim_run(p,ws,q.run.id))


def test_evidence_origin_conservative_default_no_live_attestation(context):
    import psycopg
    from workagent.service import digest
    s,p,ws,_,admin=context
    # Even a production-looking model identifier must not imply live evidence.
    grant(context,model='gpt-6.1-sol')
    q=create(context); cap=s.claim_run(p,ws,q.run.id)
    kwargs=dict(request_hash=digest({'synthetic':'request'}),consumer_sha256='a'*64)
    raises('unsupported_operation',lambda:s.prepare_provider_attempt(cap,**kwargs,evidence_origin='live_provider_receipt'))
    attempt=s.prepare_provider_attempt(cap,**kwargs)
    rc=s.bind_provider_receipt(cap,attempt.id)
    for field,value in [('evidence_origin','synthetic_provider_receipt'),('receipt_key_hash','b'*64)]:
        from psycopg import sql
        with pytest.raises(psycopg.Error):
            with Database(admin).transaction() as c:
                c.execute(sql.SQL('UPDATE provider_attempts SET {}=%s WHERE workspace_id=%s AND run_id=%s').format(sql.Identifier(field)),(value,ws,q.run.id))
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_result(rc,receipt())
    outcome=latest(s,p,ws,q)
    assert outcome.execution.provider_observation=='received'
    assert outcome.execution.evidence_origin=='unverified'
    assert outcome.blocker=='publication_pending'
    assert ExecutionProvenance(mode='managed',profile='openai-agents-v1',model='gpt-6.1-sol',provider_observation='received').evidence_origin=='unverified'


def test_receipt_secret_cannot_be_reconstructed_as_publication_capability(context):
    from workagent.service import WorkerCapability
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    s.dispatch_provider_attempt(cap,attempt.id)
    s.record_provider_result(rc,receipt())
    # Type tags alone do not attenuate a capability; its key must differ too.
    forged=WorkerCapability(rc.workspace_id,rc.run_id,rc.principal_id,rc.fence,rc.secret)
    raises('not_found_or_not_authorized',lambda:s.complete_run(forged,receipt().bodies))
    assert rc.secret!=cap.secret


def test_unavailable_consumer_and_runtime_are_not_preparing(context,monkeypatch):
    from workagent.errors import DomainError
    s,p,ws,_,_=context
    grant(context); q=create(context)
    outcome=latest(s,p,ws,q)
    assert outcome.state=='waiting' and outcome.blocker=='consumer_unavailable'
    assert not outcome.continuation_available
    def deny_runtime(*args):
        raise DomainError('unsupported_operation')
    monkeypatch.setattr(s,'_runtime_pins',deny_runtime)
    outcome=latest(s,p,ws,q)
    assert outcome.state=='waiting' and outcome.blocker=='runtime_unavailable'


def test_latest_and_historical_approval_stay_separate(context):
    s,p,ws,_,_=context
    a,art=ready(context)
    q=s.request_revision(p,ws,art.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=art.current_revision_id,instruction='Review next action'))
    cap=s.claim_run(p,ws,q.run.id); run=s.complete_run(cap,receipt().bodies)
    accepted=s.accept_proposal(p,ws,run.proposal_id,cmd(AcceptProposal,expected_current_revision_id=art.current_revision_id))
    edited=s.human_save(p,ws,art.id,cmd(HumanSave,expected_current_revision_id=accepted.current_revision_id,body=Body(title='Later human text',blocks=[Block(block_id='h',kind='paragraph',text='Preserve me')])))
    a=s.get_assignment(p,ws,a.id)
    new=s.request_revision(p,ws,art.id,cmd(RequestRevision,expected_work_version=a.work_version,base_revision_id=edited.current_revision_id,instruction='A later run'))
    projection=s.get_assignment(p,ws,a.id).responsibility
    historic=next(x for x in projection.runs if x.run_id==q.run.id)
    assert projection.latest_run_id==new.run.id and projection.runs[-1].state=='preparing'
    assert historic.state=='approved' and historic.outcome_gate=='passed'
    assert next(x for x in historic.checks if x.name=='current_revision').status=='failed'


def test_checkpoint_registry_pins_and_upgrade_privileges(context):
    from workagent.service import digest
    from workagent.tool_registry import registry_for_hash
    s,p,ws,_,_=context
    expected='b33dadca5b8c9c4b3e2f01041cd1c31d4b56723194edc0057d468f6de2f5d480'
    assert digest(registry_for_hash(expected))==expected
    with s.db.transaction() as c:
        for privilege in ('SELECT','INSERT','UPDATE'):
            assert c.execute("SELECT has_table_privilege(current_user,'provider_attempts',%s) AS allowed",(privilege,)).fetchone()['allowed']
        for table,privileges in [('provider_grants','INSERT,UPDATE,DELETE'),('run_publications','UPDATE,DELETE'),('provider_attempts','DELETE')]:
            assert not c.execute('SELECT has_table_privilege(current_user,%s,%s) AS allowed',(table,privileges)).fetchone()['allowed']
        columns=c.execute("SELECT column_name FROM information_schema.columns WHERE table_name='provider_attempts' AND column_name IN ('receipt_key_hash','evidence_origin','abandonment_reason')").fetchall()
        assert len(columns)==3
    a,art=ready(context)
    assert s.get_assignment(p,ws,a.id).responsibility.runs[-1].execution.evidence_origin=='fixture'


def test_concurrent_dispatch_and_abandonment_have_one_terminal_winner(context):
    from concurrent.futures import ThreadPoolExecutor
    from workagent.errors import DomainError
    s,p,ws,_,_=context
    q,cap,attempt=admitted(context)
    rc=s.bind_provider_receipt(cap,attempt.id)
    def attempt_call(fn):
        try:
            fn(); return True
        except DomainError:
            return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        dispatch=pool.submit(attempt_call,lambda:s.dispatch_provider_attempt(cap,attempt.id))
        abandon=pool.submit(attempt_call,lambda:s.fail_provider_attempt(rc))
        assert sorted([dispatch.result(),abandon.result()])==[False,True]
    stored=s.get_provider_attempt(p,ws,q.run.id)
    assert stored.state in ('dispatched','failed')
    with s.db.transaction() as c:
        ack=c.execute('SELECT acknowledged_at FROM run_dispatches WHERE workspace_id=%s AND run_id=%s',(ws,q.run.id)).fetchone()['acknowledged_at']
        assert (ack is not None)==(stored.state=='failed')
