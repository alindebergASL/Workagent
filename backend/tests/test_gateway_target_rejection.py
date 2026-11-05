"""Restricted disposable PostgreSQL; scripted choices, no provider/network I/O."""
from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json

import httpx
import psycopg
import pytest

from test_domain import context, cmd
from test_conversations import post
from test_workspace_files_pg import make
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker, target
from test_memory_full_tools import config
from test_adaptive_execution import finish_safe_visits
from test_local_rejection_settlement import journal, readiness_document
from test_runtime import expire
from workagent.adaptive import contract
from workagent.capabilities import registry, policy
from workagent.capabilities.models import ToolGrantV1, CapabilityPin, InputRef
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import new_id, now
from workagent.provider_attempts import ReceiptCapability
from workagent.responses_ledger import Ledger
from workagent.service import WorkerCapability
from workagent.workspace_file_models import EditWorkspaceFile


HUMAN_TEXT = '\ufeffProtected human edit — keep verbatim.\r\n'
PHASE = 'selection_2'
MIGRATIONS = Path(__file__).resolve().parents[1] / 'migrations'


class TargetProvider(AlphaProvider):
    """Acknowledge selection 2, then return its known result through real GET handling."""
    def handle(self, request):
        response = super().handle(request)
        if request.method == 'POST' and not request.url.path.endswith('input_tokens'):
            if json.loads(request.content)['metadata']['step_id'] == PHASE:
                pending = response.json()
                pending.update(status='in_progress', output=[], usage=None)
                return httpx.Response(200, json=pending)
        return response


def prepare(ctx):
    s, p, ws, _, admin = ctx
    cv, file, _ = make(ctx, 'Initial synthetic file')
    s.edit_workspace_file(p, ws, file.workspace_file_id, cmd(EditWorkspaceFile,
        expected_work_version=cv.work_version, base_version_id=file.current.version_id,
        base_sha256=file.current.sha256, content=HUMAN_TEXT,
        sha256=sha256(HUMAN_TEXT.encode()).hexdigest()))
    saved = s.get_artifact(p, ws, file.workspace_file_id)
    assert saved.current_revision.author_kind == 'human'
    assert saved.current_revision.body.kind == 'file'
    cv = s.get_conversation(p, ws, cv.id).conversation
    instructions, schema = contract(SimpleNamespace(**config('off')['responses']))
    with patch('test_general_alpha_runtime.POLICY', instructions), patch('test_general_alpha_runtime.DECISION_SCHEMA', schema):
        pg = activate(ctx, cv, continuity_version='sustained-v1', max_steps=4, memory_recall='off')
    q = post(ctx, cv, 'Revise this exact file, preserving my protected human edit. Use authorized tools.',
        target=target(saved))
    descriptors = [registry.adapters()[n].descriptor for n in
        ['capabilities.discover_legacy', 'files.read_range']]
    ref = InputRef(kind='workspace_file', id=saved.id, version=saved.current_revision_id,
        sha256=saved.current_revision.body.content_sha256)
    grant = ToolGrantV1(id=new_id(), workspace_id=ws, principal_id=p.id, run_id=q.run.id,
        scope_id=cv.id, capabilities=[CapabilityPin(id=d.id, version=d.version,
            schema_sha256=d.schema_sha256, implementation_sha256=d.implementation_sha256) for d in descriptors],
        resource_selectors=[ref], effects=['read', 'local_compute'],
        privacy_classes=['workspace_private'], egress='none', expires_at=now()+timedelta(hours=1),
        access_generation=q.run.access_generation, budget_account_id=new_id(), allow_run_outputs=True)
    policy.install(Database(admin), grant, limits={'local_compute':20}, provider_grant_id=pg.id)
    legacy = dict(kind='publish_artifact', target=target(saved).model_dump(), body=readiness_document())
    fake = TargetProvider([{'kind':'discover_capabilities'}, legacy,
        {'kind':'files_read_range', 'ref':dict(workspace_file_id=ref.id, version_id=ref.version, sha256=ref.sha256),
         'offset':0, 'limit':8192},
        {'kind':'reply', 'text':'Legacy publication was rejected; the exact protected file was read through an authorized tool.'}],
        explanation='Synthetic rejection recovery; human edits remain unchanged.')
    return cv, q, grant, saved, legacy, fake


def material(ctx):
    """Whole synthetic workspace material, including historical file bytes."""
    s, _, ws, _, _ = ctx
    with s.db.transaction() as c:
        return {table: sorted((row['value'] for row in c.execute(
            f'SELECT row_to_json(t)::text AS value FROM {table} t WHERE workspace_id=%s', (ws,)).fetchall()))
            for table in ['artifacts', 'revisions', 'proposals', 'workspace_files',
                          'source_snapshots', 'generated_blobs', 'artifact_exports']}


def assert_human_unchanged(ctx, saved):
    s, p, ws, _, _ = ctx
    assert s.get_artifact(p, ws, saved.id).model_dump(exclude={'observed_at'}) == saved.model_dump(exclude={'observed_at'})
    assert not s.proposals(p, ws, saved.id).items
    body = saved.current_revision.body
    assert s.read_workspace_file(p, ws, saved.id, saved.current_revision_id,
        body.content_sha256).text == HUMAN_TEXT


def capture_before_rejection(ctx, tmp_path, monkeypatch):
    cv, q, grant, saved, legacy, fake = prepare(ctx)
    before = material(ctx)
    captured = {}
    original = Ledger.event
    def event(self, c, phase, kind, data):
        if phase == PHASE and kind == 'tool_result':
            captured.update(ledger=self, data=deepcopy(data))
            raise InterruptedError('before retaining exact target rejection')
        return original(self, c, phase, kind, data)
    w = worker(ctx, fake, tmp_path)
    with monkeypatch.context() as m:
        m.setattr(Ledger, 'event', event)
        with pytest.raises(InterruptedError, match='before retaining'):
            finish_safe_visits(ctx, w, q.run.id)
    state = w.phases.state.load(ctx[2], q.run.id)
    cap = WorkerCapability(**state['worker'])
    receipt = ReceiptCapability(**state['receipt'])
    assert captured['ledger'].receipt == receipt
    events = journal(ctx[0], ctx[2], q.run.id)
    assert events[PHASE, 'result']['state'] == 'function_call'
    assert all((PHASE, k) in events for k in ['count_result', 'dispatch', 'identity', 'read'])
    assert (PHASE, 'tool_result') not in events
    assert material(ctx) == before
    assert_human_unchanged(ctx, saved)
    return cv, q, grant, saved, legacy, fake, cap, captured['ledger'], captured['data']


def test_target_rejection_continues_new_choice_restart_without_effect(context, tmp_path, monkeypatch):
    s, p, ws, _, _ = context
    cv, q, grant, saved, legacy, fake = prepare(context)
    before = material(context)
    # If legacy publication reaches its calculator, this test fails immediately.
    monkeypatch.setattr(s, '_calculate_product', lambda *a, **k: pytest.fail('legacy DTO executed'))
    def hook(name):
        if name == 'after_tool_result' and (PHASE, 'tool_result') in journal(s, ws, q.run.id):
            raise InterruptedError('retained target rejection')
    try:
        with pytest.raises(InterruptedError, match='retained target rejection'):
            finish_safe_visits(context, worker(context, fake, tmp_path, hook=hook), q.run.id)
    finally:
        # Also checked in the pre-077 RED run when SQL rejects the observation.
        assert material(context) == before
        assert_human_unchanged(context, saved)
    events = journal(s, ws, q.run.id)
    assert all((PHASE, k) in events for k in ['count_result', 'dispatch', 'identity', 'read', 'result'])
    rejected = events[PHASE, 'tool_result']
    assert rejected['decision'] == legacy
    assert rejected['status'] == 'rejected' and rejected['terminal_outcome'] == 'continue'
    assert rejected['diagnostic']['code'] == 'gateway_operation_rejected'
    assert all(rejected[k] is None for k in ['body', 'file', 'output'])
    assert rejected['verification']['satisfied'] is False
    expire(context, q.run.id)
    assert finish_safe_visits(context, worker(context, fake, tmp_path), q.run.id).state == 'ready'
    assert_human_unchanged(context, saved)
    retained = journal(s, ws, q.run.id)
    assert all(retained[k] == v for k, v in events.items())
    read = retained['selection_3', 'tool_result']
    assert read['decision']['kind'] == 'files_read_range'
    assert read['capability_result']['result']['text'] == HUMAN_TEXT
    assert any(any(o.get('diagnostic', {}).get('code') == 'gateway_operation_rejected'
        for o in c.get('adaptive', {}).get('observations', [])) for c in fake.contexts)
    with s.db.transaction() as c:
        attempts = c.execute('SELECT capability_id FROM tool_attempts WHERE run_id=%s ORDER BY call_id', (q.run.id,)).fetchall()
        assert [r['capability_id'] for r in attempts] == ['capabilities.discover_legacy', 'files.read_range']
        assert c.execute("SELECT count(*) AS n FROM responses_events WHERE attempt_id=(SELECT id FROM provider_attempts WHERE run_id=%s) AND phase=%s AND kind='tool_result'", (q.run.id, PHASE)).fetchone()['n'] == 1
        counts = c.execute('SELECT e.phase,e.kind,count(*) AS n FROM responses_events e '
            'JOIN provider_attempts a ON a.id=e.attempt_id WHERE a.run_id=%s GROUP BY e.phase,e.kind',
            (q.run.id,)).fetchall()
        assert all(row['n'] == 1 for row in counts)
        assert {row['phase'] for row in counts} == {'selection', PHASE, 'selection_3', 'selection_4', 'final'}
    assert len(fake.responses) == 5  # Four distinct choices and exactly one final.
    assert len(s.get_conversation(p, ws, cv.id).artifact_ids) == 1
    assert material(context) == before
    calls = list(fake.calls)
    after = material(context)
    assert worker(context, fake, tmp_path).work(p, ws, q.run.id).state == 'ready'
    assert fake.calls == calls and material(context) == after


def test_exact_predicate_and_forged_rejections_denied(context, tmp_path, monkeypatch):
    s, p, ws, _, _ = context
    cv, q, grant, saved, legacy, fake, cap, ledger, proof = capture_before_rejection(context, tmp_path, monkeypatch)
    before = material(context)
    events = journal(s, ws, q.run.id)
    calls = list(fake.calls)
    from workagent.service import encoded
    with s.db.transaction() as c:
        assert c.execute('SELECT gateway_publication_rejection(%s,%s,%s::jsonb) AS allowed',
            (ledger.receipt.attempt_id, PHASE, encoded(proof))).fetchone()['allowed']
        # The exact human request does NOT make FileBody a legacy writable target.
        assert c.execute('SELECT saved_work_target_permitted(%s,%s,%s::jsonb,true) AS allowed',
            (ledger.receipt.attempt_id, PHASE, encoded(legacy['target']))).fetchone()['allowed'] is False
    mutations = [
        (('body',), legacy['body']), (('file',), {'forged':'file'}),
        (('output',), {'forged':'output'}), (('status',), 'observed'),
        (('capability_result',), {}), (('mutation_result',), {}), (('followthrough_result',), {}),
        (('decision','target','artifact_id'), 'other-file'),
        (('decision','target','revision_id'), 'other-revision'),
        (('decision','target','body_hash'), '0'*64),
        (('binding','attempt_id'), 'other-attempt'),
        (('binding','selection_request_sha256'), '0'*64),
        (('binding','selection_response_id'), 'resp_other'),
        (('binding','decision_sha256'), '0'*64),
        (('terminal_outcome',), 'completed'),
        (('verification','satisfied'), True),
        (('verification','model_tests_passed'), True),
        (('verification','requested_goal_status'), 'complete'),
    ]
    variants = []
    for path, value in mutations:
        d = deepcopy(proof)
        parent = d
        for key in path[:-1]:
            parent = parent[key]
        parent[path[-1]] = value
        variants.append(('.'.join(path), d))
    d = deepcopy(proof)
    del d['file']
    variants.append(('omitted file null', d))
    for name, forged in variants:
        with s.db.transaction() as c:
            assert not c.execute('SELECT gateway_publication_rejection(%s,%s,%s::jsonb) AS allowed',
                (ledger.receipt.attempt_id, PHASE, encoded(forged))).fetchone()['allowed'], name
        with pytest.raises(psycopg.Error), s.db.transaction() as c:
            ledger.event(c, PHASE, 'tool_result', forged)
    assert material(context) == before and journal(s, ws, q.run.id) == events
    assert fake.calls == calls
    assert_human_unchanged(context, saved)
    # A failed forgery cannot poison the retained, exact observation.
    assert s.stage_general_product(cap, ledger.receipt, PHASE) == proof
    assert s.stage_general_product(cap, ledger.receipt, PHASE) == proof
    assert material(context) == before and fake.calls == calls


@pytest.mark.parametrize('change', ['tool_revoke', 'provider_revoke', 'stale_fence', 'cross_context'])
def test_current_authority_denied_before_target_rejection(context, tmp_path, monkeypatch, change):
    s, p, ws, _, admin = context
    cv, q, grant, saved, legacy, fake, cap, ledger, proof = capture_before_rejection(context, tmp_path, monkeypatch)
    if change == 'cross_context':
        # Fresh workspace avoids the one-active-provider-grant constraint; no
        # existing grant is replaced or revoked to manufacture another context.
        from test_domain import context as disposable_context
        other_context = disposable_context.__wrapped__()
        _, other, _, _, _, _ = prepare(other_context)
        cap = other_context[0].claim_run(other_context[1], other_context[2], other.run.id)
    elif change == 'stale_fence':
        # All sends have known results; expire only this disposable claim and
        # acquire its actual successor, then attempt retention with the old cap.
        expire(context, q.run.id)
        with pytest.raises(DomainError) as denied:
            s.claim_run(p, ws, q.run.id)
        assert denied.value.code.value == 'action_unresolved'
        successor = s._claim_run(p, ws, q.run.id, responses_receipt=ledger.receipt)
        assert successor.fence > cap.fence
    else:
        with Database(admin).transaction() as c:
            if change == 'tool_revoke':
                c.execute('UPDATE tool_grants SET active=false WHERE id=%s', (grant.id,))
            else:
                c.execute('UPDATE provider_grants SET active=false WHERE id=(SELECT grant_id FROM provider_attempts WHERE id=%s)',
                    (ledger.receipt.attempt_id,))
    before = material(context)
    events = journal(s, ws, q.run.id)
    calls = list(fake.calls)
    with pytest.raises((DomainError, psycopg.Error)):
        s.stage_general_product(cap, ledger.receipt, PHASE)
    if change in ['tool_revoke', 'provider_revoke']:
        # SQL also denies the otherwise exact feedback under current revocation.
        with pytest.raises(psycopg.Error), s.db.transaction() as c:
            ledger.event(c, PHASE, 'tool_result', proof)
    assert material(context) == before and journal(s, ws, q.run.id) == events
    assert fake.calls == calls
    assert_human_unchanged(context, saved)
    # Revoked grants stay revoked. Each case has fresh synthetic authority.


def predecessor_definition():
    sql = (MIGRATIONS / '035_scoped_saved_discovery.sql').read_text()
    body = sql.split('CREATE FUNCTION guard_saved_discovery() RETURNS trigger LANGUAGE plpgsql AS $$', 1)[1].split('$$;', 1)[0]
    return 'CREATE OR REPLACE FUNCTION public.guard_saved_discovery()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$' + body + '$function$\n'


def definition(c, name='guard_saved_discovery()'):
    return c.execute('SELECT pg_get_functiondef(%s::regprocedure) AS d', (name,)).fetchone()['d']


def test_migration_exact_delta_rollback_drift_and_journal_idempotency(context):
    from workagent.db import migrate
    s, _, _, _, admin = context
    migration = (MIGRATIONS / '077_gateway_target_rejection.sql').read_text()
    predecessor = predecessor_definition()
    assert sha256(predecessor.encode()).hexdigest() == '9d3035aa8942a1e2bcc3960f1ceddd70e52b84f9c13256bf287321a3b8b05253'
    needle = "    AND NOT coalesce(saved_work_target_permitted(NEW.attempt_id,NEW.phase,decision->'target',true),false)"
    successor = predecessor.replace(needle,
        '    AND NOT gateway_publication_rejection(NEW.attempt_id,NEW.phase,NEW.data)\n' + needle)
    unchanged = ['gateway_publication_rejection(text,text,jsonb)',
        'saved_work_target_permitted(text,text,jsonb,boolean)', 'guard_tool_consumption()', 'guard_responses_event()']
    with Database(admin).transaction() as c:
        baseline = {n:definition(c, n) for n in unchanged}
        assert definition(c) == successor
        # Restore only this function to exact 076 inside a rolled-back transaction.
        with c.transaction(force_rollback=True):
            c.execute(predecessor)
            assert definition(c) == predecessor
            with c.transaction(force_rollback=True):
                c.execute(migration)
                assert definition(c) == successor
                assert {n:definition(c, n) for n in unchanged} == baseline
            assert definition(c) == predecessor  # Candidate DDL was rolled back.
            # Drift outside the replaced condition must also fail closed.
            c.execute(predecessor.replace('DECLARE selected', '-- unexpected predecessor drift\nDECLARE selected'))
            drifted = definition(c)
            with pytest.raises(psycopg.errors.RaiseException, match='predecessor drift'), c.transaction():
                c.execute(migration)
            assert definition(c) == drifted
        assert definition(c) == successor
        journal_before = c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall()
    # Standard runner is idempotent; raw migration intentionally requires 076.
    migrate(admin)
    migrate(admin)
    with Database(admin).transaction() as c:
        assert c.execute('SELECT * FROM schema_migrations ORDER BY name').fetchall() == journal_before
        assert definition(c) == successor
        assert {n:definition(c, n) for n in unchanged} == baseline
    with pytest.raises(psycopg.errors.InsufficientPrivilege), s.db.transaction() as c:
        c.execute(predecessor)  # Runtime cannot replace the function.

