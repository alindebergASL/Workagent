"""Targeted create feedback: restricted disposable PG, scripted provider only."""
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch
import pytest
import psycopg

from test_domain import context
from test_gateway_target_rejection import prepare as target_fixture, material, assert_human_unchanged
from test_file_input_rejection import GoalProvider, BOUND_118
from test_workspace_files_pg import text
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from test_local_rejection_settlement import journal
from test_runtime import expire
from workagent.capabilities import registry, policy
from workagent.capabilities.models import CapabilityPin
from workagent.db import Database
from workagent.adaptive import stage_product
from workagent.errors import DomainError
from workagent.responses_ledger import Ledger
from workagent.provider_attempts import ReceiptCapability
from workagent.service import WorkerCapability, encoded


def prepare(ctx):
    original = policy.install
    def install(db, grant, **kwargs):
        d = registry.adapters()['files.create_draft'].descriptor
        grant = grant.model_copy(update={'capabilities':grant.capabilities + [CapabilityPin(
            id=d.id, version=d.version, schema_sha256=d.schema_sha256,
            implementation_sha256=d.implementation_sha256)], 'effects':grant.effects + ['draft']})
        return original(db, grant, **kwargs)
    with patch.object(policy, 'install', install):
        cv, q, grant, saved, _, _ = target_fixture(ctx)
    choice = dict(kind='files_create_draft', source=text('Distinct NEW draft é\r\n').model_dump())
    ref = dict(workspace_file_id=saved.id, version_id=saved.current_revision_id,
        sha256=saved.current_revision.body.content_sha256)
    def envelope(phase, context):
        if phase != 'selection':
            first = context['adaptive']['observations'][0]
            assert {k:first[k] for k in BOUND_118} == BOUND_118
        return deepcopy(BOUND_118)
    fake = GoalProvider([choice, dict(kind='files_read_range', ref=ref, offset=0, limit=8192),
        dict(kind='reply', text='The protected file remains unchanged.')], envelope)
    return cv, q, grant, saved, choice, fake


def test_target_create_restart_new_choice_no_effect(context, tmp_path):
    s, p, ws, _, _ = context
    cv, q, grant, saved, choice, fake = prepare(context)
    before = material(context)
    def hook(name):
        if name == 'after_tool_result':
            raise InterruptedError('retained target create rejection')
    try:
        with pytest.raises(InterruptedError, match='retained target create rejection'):
            finish_safe_visits(context, worker(context, fake, tmp_path, hook=hook), q.run.id)
    finally:
        assert material(context) == before
        assert_human_unchanged(context, saved)
        with s.db.transaction() as c:
            assert not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s', (q.run.id,)).fetchone()
    events = journal(s, ws, q.run.id)
    rejected = events['selection', 'tool_result']
    assert rejected['decision'] == choice
    assert rejected['status'] == 'rejected' and rejected['terminal_outcome'] == 'continue'
    assert rejected['diagnostic']['code'] == 'target_create_rejected'
    assert all(rejected[k] is None for k in ['body', 'file', 'output'])
    assert {k:rejected[k] for k in BOUND_118} == BOUND_118
    expire(context, q.run.id)
    assert finish_safe_visits(context, worker(context, fake, tmp_path), q.run.id).state == 'ready'
    assert material(context) == before
    assert_human_unchanged(context, saved)
    after = journal(s, ws, q.run.id)
    assert all(after[k] == v for k, v in events.items())
    assert after['selection_2', 'tool_result']['decision']['kind'] == 'files_read_range'
    with s.db.transaction() as c:
        assert c.execute('SELECT call_id FROM tool_attempts WHERE run_id=%s', (q.run.id,)).fetchall() == [{'call_id':'selection_2'}]
    assert len(fake.responses) == 4
    sent = list(fake.calls)
    assert worker(context, fake, tmp_path).work(p, ws, q.run.id).state == 'ready'
    assert fake.calls == sent and material(context) == before


def capture(ctx, tmp_path, monkeypatch):
    cv, q, grant, saved, choice, fake = prepare(ctx)
    w = worker(ctx, fake, tmp_path)
    captured = {}
    original = Ledger.event
    def event(self, c, phase, kind, data):
        if phase == 'selection' and kind == 'tool_result':
            captured['proof'] = deepcopy(data)
            raise InterruptedError('before rejection retention')
        return original(self, c, phase, kind, data)
    with monkeypatch.context() as m:
        m.setattr(Ledger, 'event', event)
        with pytest.raises(InterruptedError, match='before rejection retention'):
            finish_safe_visits(ctx, w, q.run.id)
    state = w.phases.state.load(ctx[2], q.run.id)
    cap = WorkerCapability(**state['worker'])
    ledger = Ledger(ctx[0], ReceiptCapability(**state['receipt']))
    return cv, q, grant, saved, choice, fake, cap, ledger, captured['proof']


def test_exact_feedback_forgery_denied(context, tmp_path, monkeypatch):
    s, p, ws, _, _ = context
    cv, q, grant, saved, choice, fake, cap, ledger, proof = capture(context, tmp_path, monkeypatch)
    before = material(context)
    events = journal(s, ws, q.run.id)
    mutations = [
        (('body',), {'content':'forged'}), (('file',), {}), (('output',), {}),
        (('capability_result',), {}), (('mutation_result',), {}), (('followthrough_result',), {}),
        (('status',), 'observed'), (('diagnostic','code'), 'gateway_operation_rejected'),
        (('diagnostic','worker_fence'), 0), (('diagnostic','detail'), 'forged feedback'),
        (('decision','source','content'), 'changed choice'),
        (('decision','source','sha256'), '0'*64),
        (('binding','attempt_id'), 'other'), (('binding','selection_request_sha256'), '0'*64),
        (('binding','selection_response_id'), 'other'), (('binding','decision_sha256'), '0'*64),
        (('binding','operation_hash'), '0'*64), (('binding','base_hash'), '0'*64),
        (('goal',), 'another goal'), (('success_criteria',), []),
        (('terminal_outcome',), 'completed'), (('terminal_outcome',), 'step_limit'),
        (('verification','satisfied'), True), (('verification','model_tests_passed'), True),
        (('verification','requested_goal_status'), 'complete'),
    ]
    variants = []
    for keys, value in mutations:
        forged = deepcopy(proof)
        parent = forged
        for key in keys[:-1]:
            parent = parent[key]
        parent[keys[-1]] = value
        variants.append(forged)
    forged = deepcopy(proof)
    del forged['file']
    variants.append(forged)
    forged = deepcopy(proof)
    forged['decision']['source'] = text('Different bytes with a VALID new hash').model_dump()
    variants.append(forged)
    for forged in variants:
        with pytest.raises(psycopg.Error), s.db.transaction() as c:
            ledger.event(c, 'selection', 'tool_result', forged)
    assert journal(s, ws, q.run.id) == events and material(context) == before
    assert stage_product(s, cap, ledger.receipt, 'selection') == proof
    assert stage_product(s, cap, ledger.receipt, 'selection') == proof
    assert material(context) == before
    assert_human_unchanged(context, saved)


@pytest.mark.parametrize('change', ['tool_revoke', 'provider_revoke', 'stale', 'cross_context', 'access', 'generation', 'human_revision'])
def test_current_authority_denied(context, tmp_path, monkeypatch, change):
    s, p, ws, _, admin = context
    cv, q, grant, saved, choice, fake, cap, ledger, proof = capture(context, tmp_path, monkeypatch)
    if change == 'stale':
        expire(context, q.run.id)
        fresh = s._claim_run(p, ws, q.run.id, responses_receipt=ledger.receipt)
        assert fresh.fence > cap.fence
    elif change == 'cross_context':
        other = globals()['context'].__wrapped__()
        _, other_q, *_ = prepare(other)
        cap = other[0].claim_run(other[1], other[2], other_q.run.id)
    elif change == 'human_revision':
        from test_domain import cmd
        from workagent.workspace_file_models import EditWorkspaceFile
        current = s.get_conversation(p,ws,cv.id).conversation
        content = saved.current_revision.body.content+'\nA newer human revision.\n'
        s.edit_workspace_file(p,ws,saved.id,cmd(EditWorkspaceFile,
            expected_work_version=current.work_version,base_version_id=saved.current_revision_id,
            base_sha256=saved.current_revision.body.content_sha256,
            content=content,sha256=sha256(content.encode()).hexdigest()))
    else:
        with Database(admin).transaction() as c:
            if change == 'tool_revoke':
                c.execute('UPDATE tool_grants SET active=false WHERE id=%s', (grant.id,))
            elif change == 'provider_revoke':
                c.execute('UPDATE provider_grants SET active=false WHERE id=(SELECT grant_id FROM provider_attempts WHERE id=%s)',
                    (ledger.receipt.attempt_id,))
            elif change == 'generation':
                c.execute('UPDATE workspaces SET access_generation=access_generation+1 WHERE id=%s', (ws,))
            else:
                c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s', (ws, p.id))
    before = material(context)
    events = journal(s, ws, q.run.id)
    calls = list(fake.calls)
    with pytest.raises((DomainError, psycopg.Error)):
        stage_product(s, cap, ledger.receipt, 'selection')
    if change != 'cross_context':
        with pytest.raises(psycopg.Error), s.db.transaction() as c:
            ledger.event(c, 'selection', 'tool_result', proof)
    assert material(context) == before and journal(s, ws, q.run.id) == events
    assert fake.calls == calls


def test_changed_criteria_denied(context, tmp_path):
    s, p, ws, _, _ = context
    cv, q, grant, saved, choice, fake = prepare(context)
    fake.envelope = lambda phase, ctx: deepcopy(BOUND_118) if phase == 'selection' else {
        **deepcopy(BOUND_118), 'success_criteria':[]}
    before = material(context)
    with pytest.raises(DomainError):
        finish_safe_visits(context, worker(context, fake, tmp_path), q.run.id)
    events = journal(s, ws, q.run.id)
    assert events['selection', 'tool_result']['status'] == 'rejected'
    assert ('selection_2', 'tool_result') not in events
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s', (q.run.id,)).fetchone()
    assert material(context) == before


def test_retained_rejection_rechecks_current_grant(context, tmp_path, monkeypatch):
    s, p, ws, _, admin = context
    cv, q, grant, saved, choice, fake, cap, ledger, proof = capture(context, tmp_path, monkeypatch)
    assert stage_product(s, cap, ledger.receipt, 'selection') == proof
    events = journal(s, ws, q.run.id); before = material(context); calls = list(fake.calls)
    with Database(admin).transaction() as c:
        c.execute('UPDATE tool_grants SET active=false WHERE id=%s', (grant.id,))
    with pytest.raises((DomainError, psycopg.Error)):
        stage_product(s, cap, ledger.receipt, 'selection')
    assert journal(s, ws, q.run.id) == events and material(context) == before
    assert fake.calls == calls


def test_step_limit_is_partial(context, tmp_path):
    s, p, ws, _, _ = context
    cv, q, grant, saved, choice, fake = prepare(context)
    fake = GoalProvider([choice]*4, lambda *args:deepcopy(BOUND_118))
    before = material(context)
    result = finish_safe_visits(context, worker(context, fake, tmp_path), q.run.id)
    assert result.state == 'partial' and result.stop_reason == 'step_limit'
    events = journal(s, ws, q.run.id)
    assert events['selection_4', 'tool_result']['terminal_outcome'] == 'step_limit'
    assert events['selection_4', 'tool_result']['verification']['satisfied'] is False
    with s.db.transaction() as c:
        assert not c.execute('SELECT 1 FROM tool_attempts WHERE run_id=%s', (q.run.id,)).fetchone()
    assert material(context) == before
    assert_human_unchanged(context, saved)


def test_untargeted_create_still_observed(context):
    # Reuse the exact scoped native positive without replaying its whole suite.
    from test_run_output_workflow import test_created_draft_can_be_exported_in_same_run
    test_created_draft_can_be_exported_in_same_run(context)


def test_disabled_descriptor_and_changed_runtime_pin_denied(context, tmp_path, monkeypatch):
    s, p, ws, _, admin = context
    cv, q, grant, saved, choice, fake, cap, ledger, proof = capture(context, tmp_path, monkeypatch)
    with Database(admin).transaction() as c:
        with c.transaction(force_rollback=True):
            c.execute("UPDATE capability_installations SET enabled=false WHERE id='files.create_draft' AND version='1'")
            assert not c.execute('SELECT target_create_rejection(%s,%s,%s::jsonb) AS ok',
                (ledger.receipt.attempt_id, 'selection', encoded(proof))).fetchone()['ok']
        # This temporary installation change rolls back; no grant is reactivated.
    adapters = registry.adapters()
    adapter = adapters['files.create_draft']
    adapters['files.create_draft'] = replace(adapter, descriptor=adapter.descriptor.model_copy(
        update={'implementation_sha256':'0'*64}))
    with monkeypatch.context() as m:
        m.setattr(registry, 'adapters', lambda:adapters)
        with pytest.raises(DomainError):
            stage_product(s, cap, ledger.receipt, 'selection')
    assert ('selection','tool_result') not in journal(s, ws, q.run.id)
    assert_human_unchanged(context, saved)


@pytest.mark.parametrize('state', ['reserved', 'dispatched', 'unknown', 'observed'])
def test_existing_native_attempt_never_becomes_rejection(context, tmp_path, monkeypatch, state):
    """Real authorized local read under the colliding call ID, never create bypass.

    Even a different legal call already occupying this phase forbids inventing
    no-dispatch feedback. Unknown uses the unchanged broker's lost-ack path.
    """
    import secrets
    from workagent.capabilities.broker import CapabilityBroker
    from workagent.capabilities.models import ToolCallV1
    from workagent.capabilities.file_adapters import FilesReadRange, input_refs
    from workagent.service import digest
    from test_file_input_rejection import immutable_tool_rows
    s, p, ws, _, _ = context
    cv, q, grant, saved, choice, fake, cap, ledger, proof = capture(context, tmp_path, monkeypatch)
    op = FilesReadRange(kind='files_read_range', ref=dict(workspace_file_id=saved.id,
        version_id=saved.current_revision_id, sha256=saved.current_revision.body.content_sha256), offset=0, limit=8192)
    with s.db.transaction() as c:
        _, _, scope = s._check_capability(c, cap)
    call = ToolCallV1(call_id='selection', capability_id='files.read_range', capability_version='1',
        arguments=op.model_dump(mode='json'), input_refs=input_refs(op), expected_work_version=scope.work_version)
    if state in ('reserved', 'dispatched'):
        secret = secrets.token_urlsafe(32)
        with s.db.transaction() as c:
            policy.authorize(s,c,cap,call,registry.adapters()['files.read_range'])
            tid = c.execute('SELECT reserve_tool_call(%s,%s,%s,%s,%s,%s) AS id',
                (ws,q.run.id,cap.fence,digest(cap.secret),encoded(call),digest(secret))).fetchone()['id']
        if state == 'dispatched':
            with s.db.transaction() as c:
                assert c.execute('SELECT dispatch_tool_call(%s,%s,%s,%s) AS sent',
                    (tid,cap.fence,digest(cap.secret),secret)).fetchone()['sent']
    else:
        with monkeypatch.context() as m:
            if state == 'unknown':
                adapters = registry.adapters(); adapter = adapters['files.read_range']
                def lost_ack(*args):
                    adapter.invoke_fenced(*args)
                    raise RuntimeError('synthetic local read acknowledgement lost')
                adapters['files.read_range'] = replace(adapter,invoke_fenced=lost_ack)
                m.setattr(registry,'adapters',lambda:adapters)
            observation = CapabilityBroker(s,cap).call(call)
        assert observation.status == ('outcome_unknown' if state == 'unknown' else 'observed')
        tid = observation.attempt_id
    before = immutable_tool_rows(context,tid)
    materials = material(context); calls = list(fake.calls)
    with pytest.raises((DomainError,psycopg.Error)):
        stage_product(s,cap,ledger.receipt,'selection')
    with pytest.raises(psycopg.Error), s.db.transaction() as c:
        ledger.event(c,'selection','tool_result',proof)
    assert ('selection','tool_result') not in journal(s,ws,q.run.id)
    assert immutable_tool_rows(context,tid) == before
    assert material(context) == materials and fake.calls == calls
    assert_human_unchanged(context,saved)


def test_migration_exact_delta_rollback_drift_idempotency(context):
    from workagent.db import migrate
    s, _, _, _, admin = context
    migration = (Path(__file__).resolve().parents[1]/'migrations/079_target_create_rejection.sql').read_text()
    hashes = {'guard_alpha_stage()':'7038cc3e418b065e3cd0b021beb725ec8347db8ded421f34963921484e69b7d3',
        'guard_file_tool_stage()':'6dea55aec456abc10e3e5939e0460d256a7906c62997e90b11885094f7406a57'}
    addition = '\n IF target_create_rejection(NEW.attempt_id,NEW.phase,NEW.data) THEN RETURN NEW; END IF;'
    def definition(c,name):
        return c.execute('SELECT pg_get_functiondef(%s::regprocedure) AS d',(name,)).fetchone()['d']
    def definitions(c):
        return c.execute("SELECT p.oid::regprocedure::text AS name,pg_get_functiondef(p.oid) AS d "
            "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' "
            "AND p.prokind='f' ORDER BY 1").fetchall()
    with Database(admin).transaction() as c:
        before = definitions(c)
        successors = {name:definition(c,name) for name in hashes}
        predecessors = {}
        for name, successor in successors.items():
            assert successor.count(addition) == 1
            predecessors[name] = successor.replace(addition,'')
            assert sha256(predecessors[name].encode()).hexdigest() == hashes[name]
        with c.transaction(force_rollback=True):
            for name in hashes:c.execute(predecessors[name])
            c.execute('DROP FUNCTION target_create_rejection(text,text,jsonb)')
            c.execute('DROP FUNCTION target_create_rejection_authorized(text,text,integer)')
            original = definitions(c)
            with c.transaction(force_rollback=True):
                c.execute(migration)
                assert definitions(c) == before
            assert definitions(c) == original
            # Drift outside the replacement must abort the complete migration.
            name = 'guard_file_tool_stage()'
            c.execute(predecessors[name].replace('DECLARE r runs;', '-- drift\nDECLARE r runs;',1))
            drifted = definitions(c)
            with pytest.raises(psycopg.errors.RaiseException,match='predecessor drift'), c.transaction():
                c.execute(migration)
            assert definitions(c) == drifted
        assert definitions(c) == before
        journal_before = c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall()
    migrate(admin)
    migrate(admin)
    with Database(admin).transaction() as c:
        assert c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall() == journal_before
        assert definitions(c) == before
    with pytest.raises(psycopg.errors.InsufficientPrivilege),s.db.transaction() as c:
        c.execute(predecessors['guard_file_tool_stage()'])


def _mixed_history_rows(ctx, run_id):
    """Exact prior rows, including IDs/timestamps and native costs/uncertainty."""
    s, _, ws, _, _ = ctx
    with s.db.transaction() as c:
        rows = {}
        for table in ('responses_steps','responses_events'):
            rows[table] = c.execute(f'SELECT to_jsonb(t) AS row FROM {table} t '
                'JOIN provider_attempts a ON a.id=t.attempt_id WHERE a.workspace_id=%s AND a.run_id=%s '
                "AND t.phase IN ('selection','selection_2','selection_3') ORDER BY to_jsonb(t)::text",
                (ws,run_id)).fetchall()
        rows['tool_attempts'] = c.execute('SELECT to_jsonb(t) AS row FROM tool_attempts t '
            'WHERE workspace_id=%s AND run_id=%s ORDER BY id',(ws,run_id)).fetchall()
        for table, key in [('tool_attempt_events','attempt_id'),('tool_cost_entries','attempt_id'),
                           ('file_input_no_effect_resolutions','tool_attempt_id')]:
            rows[table] = c.execute(f'SELECT to_jsonb(t) AS row FROM {table} t '
                f'JOIN tool_attempts a ON a.id=t.{key} WHERE a.workspace_id=%s AND a.run_id=%s '
                'ORDER BY to_jsonb(t)::text',(ws,run_id)).fetchall()
        return rows


def _finish_mixed_history_at_bound(ctx, q, saved, fake, tmp_path, rejection_kind):
    s, p, ws, _, _ = ctx
    before_material = material(ctx)
    def prior_settled(name):
        if name=='after_tool_result' and ('selection_3','tool_result') in journal(s,ws,q.run.id):
            raise InterruptedError('mixed history settled before bound')
    with pytest.raises(InterruptedError,match='mixed history settled before bound'):
        finish_safe_visits(ctx,worker(ctx,fake,tmp_path,hook=prior_settled),q.run.id)
    prior = _mixed_history_rows(ctx,q.run.id)
    events = journal(s,ws,q.run.id)
    assert events['selection',rejection_kind]['terminal_outcome']=='continue'
    assert ('selection','tool_result') not in events
    assert all(events[phase,'tool_result']['terminal_outcome']=='continue'
        for phase in ('selection_2','selection_3'))
    assert ('selection_4','tool_result') not in events
    # Fresh worker instance consumes the retained mixed history, then pauses
    # after the sole target rejection so its ordinary final path is independent.
    def bound_retained(name):
        if name=='after_tool_result' and ('selection_4','tool_result') in journal(s,ws,q.run.id):
            raise InterruptedError('target rejection retained at bound')
    with pytest.raises(InterruptedError,match='target rejection retained at bound'):
        finish_safe_visits(ctx,worker(ctx,fake,tmp_path,hook=bound_retained),q.run.id)
    events = journal(s,ws,q.run.id)
    rejected = events['selection_4','tool_result']
    assert rejected['status']=='rejected' and rejected['terminal_outcome']=='step_limit'
    assert rejected['diagnostic']['code']=='target_create_rejected'
    assert rejected['decision']==fake.decisions[3]
    assert {k:rejected[k] for k in BOUND_118}==BOUND_118
    assert all(rejected[k] is None for k in ('body','file','output'))
    assert not {'capability_result','mutation_result','followthrough_result'} & rejected.keys()
    assert rejected['verification']['satisfied'] is False
    assert rejected['verification']['model_tests_passed'] is False
    assert rejected['verification']['requested_goal_status']=='needs_validation'
    assert ('final','dispatch') not in events
    assert _mixed_history_rows(ctx,q.run.id)==prior
    result = finish_safe_visits(ctx,worker(ctx,fake,tmp_path),q.run.id)
    assert result.state=='partial' and result.stop_reason=='step_limit'
    final = journal(s,ws,q.run.id)
    assert final['final','result']['state']=='completed'
    assert all(final[k]==v for k,v in events.items())
    assert _mixed_history_rows(ctx,q.run.id)==prior
    with s.db.transaction() as c:
        assert not c.execute("SELECT 1 FROM tool_attempts WHERE workspace_id=%s AND run_id=%s "
            "AND (call_id='selection_4' OR capability_id='files.create_draft')",(ws,q.run.id)).fetchone()
        assert c.execute("SELECT count(*) AS n FROM responses_events e JOIN provider_attempts a "
            "ON a.id=e.attempt_id WHERE a.run_id=%s AND e.kind='tool_result' "
            "AND e.data->'diagnostic'->>'code'='target_create_rejected'",(q.run.id,)).fetchone()['n']==1
        counts = c.execute("SELECT e.phase,e.kind,count(*) AS n FROM responses_events e "
            "JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s "
            "AND e.kind IN ('count_send','dispatch','identity','result') GROUP BY e.phase,e.kind",
            (q.run.id,)).fetchall()
        assert len(counts)==20 and all(row['n']==1 for row in counts)
    assert len(fake.responses)==5  # Four distinct choices and one ordinary final.
    assert material(ctx)==before_material
    assert_human_unchanged(ctx,saved)
    calls = list(fake.calls)
    assert worker(ctx,fake,tmp_path).work(p,ws,q.run.id).state=='partial'
    assert fake.calls==calls and _mixed_history_rows(ctx,q.run.id)==prior


def test_prior_076_rejection_then_target_create_at_bound(context, tmp_path):
    cv, q, grant, saved, create, _ = prepare(context)
    read = dict(kind='files_read_range', ref=dict(workspace_file_id=saved.id,
        version_id=saved.current_revision_id,sha256=saved.current_revision.body.content_sha256),offset=0,limit=8192)
    malformed = deepcopy(read)
    del malformed['limit']  # Real strict schema failure, unrelated to 078 hashes.
    fake = GoalProvider([malformed,read,read,create],lambda *args:deepcopy(BOUND_118))
    fake.explanation='The targeted create was rejected at the step limit; the task remains incomplete.'
    _finish_mixed_history_at_bound(context,q,saved,fake,tmp_path,'selection_rejection')
    events = journal(context[0],context[2],q.run.id)
    assert events['selection','result']['state']=='malformed'
    assert events['selection','result']['issue']=='schema_validation_failed'
    assert ('selection','file_input_rejection') not in events


def test_prior_078_unknown_rejection_then_target_create_at_bound(context, tmp_path, monkeypatch):
    import workagent.file_input_rejection as rejection
    from workagent.capabilities.broker import CapabilityBroker
    from test_file_input_rejection import immutable_tool_rows
    s, p, ws, _, admin = context
    original_install = policy.install
    def install(db, grant, **kwargs):
        d = registry.adapters()['files.propose_patch'].descriptor
        grant = grant.model_copy(update={'capabilities':grant.capabilities+[CapabilityPin(
            id=d.id,version=d.version,schema_sha256=d.schema_sha256,implementation_sha256=d.implementation_sha256)]})
        return original_install(db,grant,**kwargs)
    with patch.object(policy,'install',install):
        cv, q, grant, saved, create, _ = prepare(context)
    ref = dict(workspace_file_id=saved.id,version_id=saved.current_revision_id,
        sha256=saved.current_revision.body.content_sha256)
    bad = dict(kind='files_propose_patch',ref=ref,content=saved.current_revision.body.content+'\nNew text.\n',
        sha256=ref['sha256'],reason='Synthetic historical wrong generated-content hash')
    read = dict(kind='files_read_range',ref=ref,offset=0,limit=8192)
    fake = GoalProvider([bad,read,read,create],lambda *args:deepcopy(BOUND_118))
    fake.explanation='The historical failed patch was not replayed; the targeted create reached the step limit.'
    before_material = material(context)
    w = worker(context,fake,tmp_path)
    # Reuse the existing historical fixture technique: the unchanged broker
    # retains its actual native validation failure as unknown, before any INSERT.
    with monkeypatch.context() as m:
        m.setattr(rejection,'retain',lambda *args:None)
        with pytest.raises(DomainError) as denied:
            finish_safe_visits(context,w,q.run.id)
        assert denied.value.code.value=='action_unresolved'
    state = w.phases.state.load(ws,q.run.id)
    receipt = ReceiptCapability(**state['receipt'])
    with s.db.transaction() as c:
        attempt = c.execute('SELECT * FROM tool_attempts WHERE workspace_id=%s AND run_id=%s',
            (ws,q.run.id)).fetchone()
        assert attempt['call_id']=='selection' and attempt['capability_id']=='files.propose_patch'
        observation = c.execute("SELECT data FROM tool_attempt_events WHERE attempt_id=%s AND kind='observation'",
            (attempt['id'],)).fetchone()['data']
        assert observation['status']=='outcome_unknown' and observation['output'] is None
    unknown_before = immutable_tool_rows(context,attempt['id'])
    assert len(unknown_before['tool_cost_entries'])==2
    result_before = journal(s,ws,q.run.id)['selection','result']
    assert result_before['state']=='function_call'
    resolution = rejection.install_no_effect(Database(admin),attempt['id'],receipt.attempt_id,'selection')
    broker_call = CapabilityBroker.call
    def no_replay(self, call):
        assert call.call_id!='selection', 'historical native call replayed'
        return broker_call(self,call)
    monkeypatch.setattr(CapabilityBroker,'call',no_replay)
    _finish_mixed_history_at_bound(context,q,saved,fake,tmp_path,'file_input_rejection')
    events = journal(s,ws,q.run.id)
    assert events['selection','result']==result_before
    assert events['selection','file_input_rejection']['feedback']['effect']=='historical_unknown_resolved_no_effect'
    assert immutable_tool_rows(context,attempt['id'])==unknown_before
    with s.db.transaction() as c:
        assert c.execute('SELECT data FROM file_input_no_effect_resolutions WHERE tool_attempt_id=%s',
            (attempt['id'],)).fetchone()['data']==resolution
    assert material(context)==before_material
