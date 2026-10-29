"""Zero-provider full-tool SQL recall; deterministic transport, not A/B quality."""
from hashlib import sha256
from types import SimpleNamespace
from unittest.mock import patch
import json
import pytest
from pydantic import ValidationError
import psycopg
from test_domain import context, cmd
from test_conversations import conversation, post
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.adaptive import contract
from workagent.capabilities.delegation_composition import SCHEMA, POLICY
from workagent.memory.runtime import enabled
from workagent.memory.models import RememberMemory, CorrectMemory, MemoryCAS
from workagent.errors import DomainError


def config(mode):
    return {'responses': {'continuity_version': 'sustained-v1',
        'scope_tool_sha256': sha256(SCHEMA.material).hexdigest(), 'memory_recall': mode}}


def activated(ctx, cv, mode):
    policy, schema = contract(SimpleNamespace(**config(mode)['responses']))
    with patch('test_general_alpha_runtime.POLICY', policy), patch('test_general_alpha_runtime.DECISION_SCHEMA', schema):
        return activate(ctx, cv, continuity_version='sustained-v1', max_steps=3, memory_recall=mode)


def test_full_tool_selector_and_equal_policy():
    assert enabled(config('reviewed-v1'))
    assert not enabled(config('off'))
    assert not enabled(config(None))
    assert not enabled({'responses': {**config('reviewed-v1')['responses'], 'continuity_version': None}})
    on = contract(SimpleNamespace(**config('reviewed-v1')['responses']))
    off = contract(SimpleNamespace(**config('off')['responses']))
    assert on == off
    assert on[1] == SCHEMA
    assert 'memory_context' in on[0]
    assert contract(SimpleNamespace(**config(None)['responses'])) == (POLICY, SCHEMA)


class Capture(AlphaProvider):
    def __init__(self):
        super().__init__([{'kind': 'reply', 'text': 'Deterministic integration reply.'}])
        self.requests = []

    def handle(self, request):
        if request.method == 'POST':
            self.requests.append(json.loads(request.content))
        return super().handle(request)


def execute(ctx, cv, path):
    s, p, ws, _, _ = ctx
    q = post(ctx, s.get_conversation(p, ws, cv.id).conversation, 'Prepare a project summary')
    provider = Capture()
    assert finish_safe_visits(ctx, worker(ctx, provider, path), q.run.id).state == 'ready'
    calls = list(provider.calls)
    assert worker(ctx, provider, path).work(p, ws, q.run.id).state == 'ready'
    assert provider.calls == calls
    return q, provider


def test_real_pg_matched_off_on_revision_forget_restart(context, tmp_path):
    s, p, ws, _, _ = context
    cv = conversation(context)
    m = s.remember_memory(p, ws, cmd(RememberMemory, kind='preference', scope_kind='user', scope_id=p.id,
        subject_key='writing', predicate_key='headings', content='Use concise headings'))
    # Both arms have the same SQL memory available; off must not project it.
    g0 = activated(context, cv, 'off')
    off_run, off = execute(context, cv, tmp_path/'off')
    assert all('memory_context' not in c and 'memory_manifest' not in c for c in off.contexts)
    assert not s.memory_usage(p, ws, off_run.run.id).items
    # Separate fresh conversation; retain the memory, revoke only synthetic authority.
    from workagent.provider_attempts import revoke_grant
    from workagent.db import Database
    revoke_grant(Database(context[4]), g0.id)
    on_cv = conversation(context)
    g1 = activated(context, on_cv, 'reviewed-v1')
    for revision, content in [(m.revision_id, 'Use concise headings')]:
        on_run, on = execute(context, on_cv, tmp_path/'on')
        assert on.contexts[0]['memory_context']['items'][0]['revision']['content'] == content
        assert [e['revision_id'] for e in on.contexts[0]['memory_manifest']] == [revision]
    assert g0.responses.scope_tool_sha256 == g1.responses.scope_tool_sha256
    assert g0.responses.instructions_sha256 == g1.responses.instructions_sha256
    for a, b in zip(off.requests, on.requests, strict=True):
        assert a['tools'] == b['tools'] and a['instructions'] == b['instructions']
    usages = s.memory_usage(p, ws, on_run.run.id).items
    assert len(usages) == 2
    with s.db.transaction() as c:
        for u in usages:
            row = c.execute('SELECT request_sha256,request_bytes FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                (u.attempt_id, u.phase)).fetchone()
            assert row['request_sha256'] == u.request_sha256
            assert sha256(row['request_bytes'].encode()).hexdigest() == u.request_sha256
            assert u.entries[0].revision_id == m.revision_id
    changed = s.correct_memory(p, ws, m.memory_id, cmd(CorrectMemory, expected_revision_id=m.revision_id,
        content='Use descriptive headings'))
    _, corrected = execute(context, on_cv, tmp_path/'corrected')
    assert corrected.contexts[0]['memory_manifest'][0]['revision_id'] == changed.revision_id
    assert corrected.contexts[0]['memory_context']['items'][0]['revision']['content'] == 'Use descriptive headings'
    s.forget_memory(p, ws, m.memory_id, cmd(MemoryCAS, expected_revision_id=changed.revision_id))
    _, forgotten = execute(context, on_cv, tmp_path/'forgotten')
    assert forgotten.contexts[0]['memory_manifest'] == []
    assert forgotten.contexts[0]['memory_context']['items'] == []


def test_full_tool_correction_during_request_fences_publication(context, tmp_path):
    s, p, ws, _, _ = context
    cv = conversation(context)
    m = s.remember_memory(p, ws, cmd(RememberMemory, kind='preference', scope_kind='task', scope_id=cv.id,
        subject_key='writing', predicate_key='headings', content='Use concise headings'))
    activated(context, cv, 'reviewed-v1')
    q = post(context, cv, 'Prepare a project summary')
    class CorrectDuringIO(Capture):
        changed = False
        def handle(self, request):
            response = super().handle(request)
            if request.method == 'POST' and not request.url.path.endswith('input_tokens') and not self.changed:
                self.changed = True
                s.correct_memory(p, ws, m.memory_id, cmd(CorrectMemory, expected_revision_id=m.revision_id,
                    content='Use descriptive headings'))
            return response
    provider = CorrectDuringIO()
    with pytest.raises(DomainError) as error:
        finish_safe_visits(context, worker(context, provider, tmp_path), q.run.id)
    assert error.value.code.value == 'source_changed'
    assert provider.changed
    assert s.get_run(p, ws, q.run.id).state != 'ready'
    assert not any('Deterministic integration reply.' in m.text for m in s.get_conversation(p, ws, cv.id).messages)


@pytest.mark.parametrize('change,boundary', [('revoke', 'count'), ('revoke', 'send'), ('forget', 'count')])
def test_full_tool_source_and_forget_races(context, tmp_path, change, boundary):
    # Reuse exactly the proven seam checks, changing only the full-tool treatment.
    from test_memory_safety_pg import test_mutation_inflight_no_stale_publication_or_restart_send as check
    with patch('test_memory_safety_pg.activated', lambda ctx, cv: activated(ctx, cv, 'reviewed-v1')):
        check(context, tmp_path, change, boundary)


def test_full_tool_project_isolation_and_stale_capability(context):
    from test_memory_pg import remember
    from workagent.models import CreateWorkArea
    from workagent.service import Principal
    from test_runtime import expire
    s, p, ws, _, _ = context
    area = s.create_work_area(p, ws, cmd(CreateWorkArea, title='Private project', goal='Private project',
        kind='project', selected_source_refs=[]))
    private, _ = remember(context, area, scope_kind='work_area', content='OTHER_PROJECT_MEMORY_CANARY')
    cv = conversation(context)
    activated(context, cv, 'reviewed-v1')
    q = post(context, cv, 'Prepare a project summary')
    cap = s.claim_run(p, ws, q.run.id)
    frozen = s.conversation_worker_context(cap)
    assert frozen['memory_manifest'] == []
    assert 'OTHER_PROJECT_MEMORY_CANARY' not in json.dumps(frozen)
    with pytest.raises(DomainError) as denied:
        s.inspect_memory(Principal('another-owner'), ws, private.memory_id)
    assert denied.value.code.value == 'not_found_or_not_authorized'
    expire(context, q.run.id)
    replacement = s.claim_run(p, ws, q.run.id)
    assert replacement is not None and replacement != cap
    with pytest.raises(DomainError) as stale:
        s.conversation_worker_context(cap)
    # Revoked lease token is deliberately concealed as an authorization failure.
    assert stale.value.code.value == 'not_found_or_not_authorized'
    assert s.conversation_worker_context(replacement)['memory_manifest'] == []


@pytest.mark.parametrize('field,value', [('memory_recall', 'automatic'), ('memory_recall', True),
    ('scope_tool_sha256', '0'*64), ('continuity_version', None)])
def test_full_tool_treatment_fails_closed_python_and_sql(context, field, value):
    from workagent.models import GeneralAlphaResponsesBinding
    s, _, _, _, _ = context
    grant = activated(context, conversation(context), 'off')
    assert grant.responses is not None
    binding = {**grant.responses.model_dump(mode='json'), field: value}
    with pytest.raises(ValidationError):
        GeneralAlphaResponsesBinding.model_validate(binding)
    with pytest.raises(psycopg.Error), s.db.transaction() as c:
        c.execute('SELECT require_alpha_budget_binding(%s::jsonb)', (json.dumps(binding),))


def test_full_tool_binding_snapshot_cannot_switch_treatment(context):
    from workagent.provider_attempts import check_grant
    s, p, ws, _, _ = context
    cv = conversation(context)
    activated(context, cv, 'off')
    q = post(context, cv, 'Prepare a project summary')
    with s.db.transaction() as c:
        saved = c.execute('SELECT data FROM run_configurations WHERE workspace_id=%s AND run_id=%s',
            (ws, q.run.id)).fetchone()['data']
        assert saved['responses']['memory_recall'] == 'off'
        saved['responses']['memory_recall'] = 'reviewed-v1'
        with pytest.raises(DomainError) as denied:
            check_grant(c, q.run, saved)
        assert denied.value.code.value == 'action_unresolved'


@pytest.mark.parametrize('mode', ['off', 'reviewed-v1'])
def test_full_tool_worker_executes_scoped_file_read(context, tmp_path, mode):
    from datetime import timedelta
    from test_workspace_files_pg import make
    from workagent.capabilities import registry, policy
    from workagent.capabilities.models import ToolGrantV1, CapabilityPin, InputRef
    from workagent.db import Database
    from workagent.models import new_id, now
    s, p, ws, _, admin = context
    cv, file, _ = make(context, 'Exact human quotation; preserve it.\n')
    m = s.remember_memory(p, ws, cmd(RememberMemory, kind='preference', scope_kind='task', scope_id=cv.id,
        subject_key='writing', predicate_key='headings', content='Use concise headings'))
    pg = activated(context, cv, mode)
    q = post(context, cv, 'Read my exact file before answering')
    desc = registry.adapters()['files.read_range'].descriptor
    grant = ToolGrantV1(id=new_id(), workspace_id=ws, principal_id=p.id, run_id=q.run.id, scope_id=cv.id,
        capabilities=[CapabilityPin(id=desc.id, version=desc.version, schema_sha256=desc.schema_sha256,
            implementation_sha256=desc.implementation_sha256)],
        resource_selectors=[InputRef(kind='workspace_file', id=file.workspace_file_id,
            version=file.current.version_id, sha256=file.current.sha256)], effects=desc.effects,
        privacy_classes=['workspace_private'], egress='none', expires_at=now()+timedelta(hours=1),
        access_generation=q.run.access_generation, budget_account_id=new_id())
    policy.install(Database(admin), grant, limits={'local_compute':2}, provider_grant_id=pg.id)
    fake = AlphaProvider([{'kind':'files_read_range', 'ref':file.current.model_dump(), 'offset':0, 'limit':8192},
        {'kind':'reply', 'text':'Read the exact scoped file.'}])
    assert finish_safe_visits(context, worker(context, fake, tmp_path), q.run.id).state == 'ready'
    if mode == 'reviewed-v1':
        assert fake.contexts[0]['memory_manifest'][0]['revision_id'] == m.revision_id
    else:
        assert 'memory_context' not in fake.contexts[0]
    observed = fake.contexts[1]['adaptive']['observations'][0]['capability_result']
    assert observed['result']['text'] == 'Exact human quotation; preserve it.\n'
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) AS n FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND capability_id='files.read_range'",
            (ws, q.run.id)).fetchone()['n'] == 1
