"""No paid calls: context equivalence and commit-to-HTTP handoff margin."""
from datetime import timedelta
from types import SimpleNamespace

import pytest

from test_domain import context
from test_runtime import expire
from test_responses_leases import setup_family, visit
from test_general_responses import totals
from workagent.models import now


@pytest.mark.parametrize('family', ['intake', 'general', 'adaptive'])
def test_reservation_leaves_room_for_postcommit_authority_check(context, tmp_path, monkeypatch, family):
    import workagent.responses_worker as module
    import workagent.service as service_module
    from workagent.responses_ledger import Ledger
    grant, queued, fake, worker, phases = setup_family(context, tmp_path, family)
    # General test helpers intentionally use subsecond MockTransport timeouts;
    # this test specifically exercises the real 100s HTTP allowance instead.
    import httpx
    phases.transport._client.timeout=httpx.Timeout(30.0,connect=5.0)
    origin = now()
    clock = [0.0]
    inserted = [False]
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda _: None))
    monkeypatch.setattr(module, 'now', lambda: origin + timedelta(seconds=clock[0]))
    monkeypatch.setattr(service_module, 'now', lambda: origin + timedelta(seconds=clock[0]))
    event, fresh = Ledger.event, phases._fresh
    def delayed_event(self, c, phase, kind, data):
        value = event(self, c, phase, kind, data)
        if kind == 'count_send':
            clock[0] = 17  # 103s left: HTTP allowance fits, handoff + HTTP does not.
            inserted[0] = True
        return value
    def slow_recheck(cap):
        if inserted[0]:clock[0] += 4
        return fresh(cap)
    monkeypatch.setattr(Ledger, 'event', delayed_event)
    monkeypatch.setattr(phases, '_fresh', slow_recheck)
    visit(context, worker, queued.run.id)
    assert totals(context[0], grant)['request_counts'] == {'count_send': 0, 'dispatch': 0, 'read': 0, 'cancel': 0}
    assert fake.calls == []
    monkeypatch.setattr(Ledger, 'event', event)
    monkeypatch.setattr(phases, '_fresh', fresh)
    expire(context, queued.run.id)
    visit(context, worker, queued.run.id)
    assert context[0].get_run(context[1], context[2], queued.run.id).state in ('ready', 'partial')
    assert totals(context[0], grant)['request_counts']['count_send'] == 2


@pytest.mark.parametrize('family', ['general', 'adaptive', 'alpha'])
def test_live_context_does_not_build_discarded_tool_schemas(context, tmp_path, monkeypatch, family):
    from test_general_alpha_runtime import launch
    service, principal, workspace, _, _ = context
    if family == 'alpha':
        _, _, queued, _, _ = launch(context, tmp_path, [{'kind': 'reply', 'text': 'A useful answer.'}])
    else:
        _, queued, _, _, _ = setup_family(context, tmp_path, family)
    cap = service.claim_run(principal, workspace, queued.run.id)
    original = service.conversation_worker_context(cap)
    monkeypatch.setattr(service, 'local_tool_registry', lambda: pytest.fail('Discarded local registry was rebuilt'))
    if family == 'alpha':
        from workagent.composition import AlphaDecision
        monkeypatch.setattr(AlphaDecision, 'model_json_schema', lambda *a, **kw: pytest.fail('Discarded alpha schema was rebuilt'))
    assert service.conversation_worker_context(cap) == original
