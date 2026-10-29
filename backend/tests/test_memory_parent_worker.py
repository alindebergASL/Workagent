"""Parent controlled-transport journeys through production worker + real PG.

Synthetic model outputs are mechanism evidence only. No paid model or live-quality
claim. Context and usage identities are checked at actual HTTP request boundaries.
"""
from unittest.mock import patch
import pytest
from workagent.errors import DomainError
from test_domain import context, cmd
from test_conversations import conversation, post
from test_general_alpha_runtime import activate, AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.memory.models import RememberMemory, CorrectMemory, MemoryCAS
from workagent.memory.runtime import POLICY, SCHEMA


def activated(ctx, cv):
    with patch('test_general_alpha_runtime.POLICY', POLICY), patch('test_general_alpha_runtime.DECISION_SCHEMA', SCHEMA):
        return activate(ctx, cv, continuity_version='sustained-v1', max_steps=3)


def test_parent_later_worker_request_manifest_correct_forget(context, tmp_path):
    s, p, ws, _, _ = context
    first, later = conversation(context), conversation(context)
    m = s.remember_memory(p, ws, cmd(RememberMemory, kind='preference', scope_kind='user', scope_id=p.id,
        subject_key='writing', predicate_key='heading_style', content='Use concise headings'))
    activated(context, later)
    def execute(expected_revision):
        cv = s.get_conversation(p, ws, later.id).conversation
        q = post(context, cv, 'Prepare this next ordinary project summary')
        provider = AlphaProvider([{'kind': 'reply', 'text': 'Controlled transport completed the request.'}])
        w = worker(context, provider, tmp_path)
        result = finish_safe_visits(context, w, q.run.id)
        assert result.state == 'ready'
        assert provider.contexts, 'Must capture an actual provider-bound request'
        entries = provider.contexts[0]['memory_manifest']
        assert [x['revision_id'] for x in entries] == ([expected_revision] if expected_revision else [])
        usages = s.memory_usage(p, ws, q.run.id).items
        assert len(usages) == 2
        assert len({(u.attempt_id, u.phase, u.request_sha256) for u in usages}) == 2
        with s.db.transaction() as c:
            for usage in usages:
                actual = c.execute('SELECT request_sha256 FROM responses_steps WHERE attempt_id=%s AND phase=%s',
                                   (usage.attempt_id, usage.phase)).fetchone()
                assert actual['request_sha256'] == usage.request_sha256
        assert all([x.revision_id for x in item.entries] == ([expected_revision] if expected_revision else []) for item in usages)
        calls = list(provider.calls)
        assert worker(context, provider, tmp_path).work(p, ws, q.run.id).state == 'ready'
        assert provider.calls == calls, 'A completed run must not send again on restart'
        return q, provider
    first_run, initial = execute(m.revision_id)
    corrected = s.correct_memory(p, ws, m.memory_id, cmd(CorrectMemory, expected_revision_id=m.revision_id,
        content='Use descriptive headings'))
    _, revised = execute(corrected.revision_id)
    assert revised.contexts[0]['memory_context']['items'][0]['revision']['content'] == 'Use descriptive headings'
    s.forget_memory(p, ws, m.memory_id, cmd(MemoryCAS, expected_revision_id=corrected.revision_id))
    _, forgotten = execute(None)
    assert forgotten.contexts[0]['memory_context']['items'] == []
    assert s.memory_usage(p, ws, first_run.run.id).items[0].entries[0].revision_id == m.revision_id
    assert initial.contexts[0]['memory_manifest'][0]['revision_id'] == m.revision_id


def test_parent_correction_during_model_io_fences_publication(context, tmp_path):
    s, p, ws, _, _ = context
    cv = conversation(context)
    m = s.remember_memory(p, ws, cmd(RememberMemory, kind='preference', scope_kind='task', scope_id=cv.id,
        subject_key='writing', predicate_key='heading_style', content='Use concise headings'))
    activated(context, cv)
    q = post(context, cv, 'Prepare a summary')
    class MidIOCorrection(AlphaProvider):
        changed = False
        def handle(self, request):
            result = super().handle(request)
            if request.method == 'POST' and not request.url.path.endswith('input_tokens') and not self.changed:
                self.changed = True
                s.correct_memory(p, ws, m.memory_id, cmd(CorrectMemory, expected_revision_id=m.revision_id,
                    content='Use descriptive headings'))
            return result
    provider = MidIOCorrection([{'kind': 'reply', 'text': 'STALE RESULT MUST NEVER PUBLISH'}])
    w = worker(context, provider, tmp_path)
    with pytest.raises(DomainError) as refusal:
        finish_safe_visits(context, w, q.run.id)
    assert refusal.value.code.value == 'source_changed'
    result = s.get_run(p, ws, q.run.id)
    assert provider.changed
    detail = s.get_conversation(p, ws, cv.id)
    assert all('STALE RESULT' not in message.text for message in detail.messages)
    assert result.state != 'ready'
