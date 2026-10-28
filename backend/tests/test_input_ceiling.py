"""50k is a per-send bound, never a new grant or a rewrite of old receipts."""
from contextlib import closing
from dataclasses import asdict
from decimal import Decimal
from hashlib import sha256
import httpx
import psycopg
import pytest
from test_domain import context, raises
from test_alpha_budget import prepared, reserve, raw, count
from test_responses_transport import selection, permit, response
from workagent.responses_transport import ResponsesTransport, TransportError
from workagent.responses_ledger import summary

NEW_DISPATCH = dict(reserved_input_tokens=50000, reserved_output_tokens=8192,
                    reserved_cost_usd='0.206920', billed_cost_usd=None)


@pytest.mark.parametrize('tokens', [20001, 22428, 50000])
def test_transport_accepts_new_limit_with_exact_count_and_usage(tokens):
    request = selection()
    calls = []
    def handle(req):
        calls.append(req)
        if req.url.path.endswith('input_tokens'):
            return httpx.Response(200, json={'object': 'response.input_tokens', 'input_tokens': tokens})
        doc = response()
        doc['usage'].update(input_tokens=tokens, total_tokens=tokens + 30)
        return httpx.Response(200, json=doc)
    with closing(ResponsesTransport.synthetic(httpx.MockTransport(handle))) as transport:
        counted = transport.count(request)
        result = transport.create(request, count=counted, permit=permit(request, counted), on_accepted=lambda _: None)
    assert result.usage.input_tokens == tokens
    assert calls[1].content == request.body
    assert len(calls) == 2


def test_transport_rejects_50001_before_generation():
    calls = []
    def handle(req):
        calls.append(req)
        return httpx.Response(200, json={'object': 'response.input_tokens', 'input_tokens': 50001})
    with closing(ResponsesTransport.synthetic(httpx.MockTransport(handle))) as transport:
        with pytest.raises(TransportError) as error:
            transport.count(selection())
    assert error.value.code == 'input_count_exceeds_limit'
    assert error.value.input_tokens == 50001
    assert len(calls) == 1


def retain_count(x, fake, tokens):
    r = x['request']
    x['ledger'].retain(r, 'count_result', dict(request_sha256=r.sha256,
        count_sha256=sha256(r.count_body()).hexdigest(), metadata=r.metadata.model_dump(),
        input_tokens=tokens, provenance=asdict(fake.transport().provenance)))


def test_new_count_binding_and_exact_full_reservation(context, tmp_path):
    g, fake, x = prepared(context, tmp_path)
    reserve(x, 'count_send')
    with context[0].db.transaction() as c:
        assert x['ledger']._events(c, 'selection')['count_send'] == {'input_token_limit': 50000}
    retain_count(x, fake, 50000)
    permit = reserve(x, 'dispatch')
    assert permit.input_tokens == 50000
    with context[0].db.transaction() as c:
        totals = summary(c, g.id)
    assert totals['reserved_input_tokens'] == 50000
    assert totals['reserved_output_tokens'] == 8192
    assert Decimal(totals['reserved_cost_usd']) == Decimal('0.206920')
    assert totals['unknown_usage_steps'] == 1


@pytest.mark.parametrize('limits', [{'input_limit': 49999}, {'cost_limit_usd': '0.206919'}])
def test_new_reservation_does_not_enlarge_authority(context, tmp_path, limits):
    g, fake, x = prepared(context, tmp_path, **limits)
    count(x, fake, prior_count=True)
    raises('budget_exhausted', lambda: reserve(x, 'dispatch'))
    with pytest.raises(psycopg.Error, match='(reservation limit|project budget exhausted)'):
        raw(x, 'dispatch', NEW_DISPATCH)
    with context[0].db.transaction() as c:
        assert summary(c, g.id)['request_counts']['dispatch'] == 0


@pytest.mark.parametrize('tokens', [50001, True, 50000.5, '50000', None])
def test_sql_count_rejects_invalid_or_excessive_tokens(context, tmp_path, tokens):
    _, fake, x = prepared(context, tmp_path)
    reserve(x, 'count_send')
    with pytest.raises(psycopg.Error):
        retain_count(x, fake, tokens)


@pytest.mark.parametrize('data', [{}, {'input_token_limit': 20000}, {'input_token_limit': None},
                                  {'input_token_limit': '50000'}, {'input_token_limit': 50000, 'extra': 1}])
def test_new_sql_count_send_cannot_claim_legacy_policy(context, tmp_path, data):
    _, _, x = prepared(context, tmp_path)
    with pytest.raises(psycopg.Error, match='count send input policy'):
        raw(x, 'count_send', data)


@pytest.mark.parametrize('data', [
    NEW_DISPATCH | {'reserved_input_tokens': 20000, 'reserved_cost_usd': '0.131920'},
    NEW_DISPATCH | {'reserved_cost_usd': '0.131920'},
    NEW_DISPATCH | {'reserved_input_tokens': 20000},
    NEW_DISPATCH | {'reserved_input_tokens': None},
])
def test_sql_dispatch_cannot_underreserve(context, tmp_path, data):
    _, fake, x = prepared(context, tmp_path)
    count(x, fake)
    with pytest.raises(psycopg.Error, match='reservation required'):
        raw(x, 'dispatch', data)


def test_new_rejection_uses_send_bound_and_is_terminal(context, tmp_path):
    from workagent.general_responses import known_input_rejection_is_settled
    g, _, x = prepared(context, tmp_path)
    reserve(x, 'count_send')
    x['ledger'].count_problem(x['request'], TransportError('input_count_exceeds_limit', input_tokens=50001))
    with context[0].db.transaction() as c:
        events = x['ledger']._events(c, 'selection')
        assert events['problem']['limit'] == 50000
        assert known_input_rejection_is_settled(c, x['ledger'].receipt.attempt_id)
        assert summary(c, g.id)['request_counts']['dispatch'] == 0
    raises('action_unresolved', lambda: reserve(x, 'count_send'))
    with pytest.raises(psycopg.Error, match='terminal'):
        raw(x, 'dispatch', NEW_DISPATCH)


def test_carried_unknown_cost_still_reduces_new_send_capacity(context, tmp_path):
    from workagent.budget_carryforward import install_carry
    from workagent.db import Database
    from workagent.models import new_id
    g, fake, x = prepared(context, tmp_path, cost_limit_usd='1.00')
    install_carry(Database(context[4]), project_id=g.responses.project_id,
        transport_mode='synthetic', source_database='workagent_test_historical_unknown',
        source_grant_id=new_id(), source_manifest_sha256='a'*64, reserved_cost_usd='0.80')
    count(x, fake, prior_count=True)
    raises('budget_exhausted', lambda: reserve(x, 'dispatch'))
    with pytest.raises(psycopg.Error, match='shared cumulative project budget exhausted'):
        raw(x, 'dispatch', NEW_DISPATCH)
    with context[0].db.transaction() as c:
        totals = summary(c, g.id, shared=True)
        assert Decimal(totals['reserved_cost_usd']) == Decimal('0.80')
        assert totals['request_counts']['dispatch'] == 0


@pytest.mark.parametrize('limits', [{'input_limit': 49999}, {'cost_limit_usd': '0.206919'}])
def test_responsibility_admission_needs_new_full_reservation(context, monkeypatch, limits):
    from test_responsibility_execution import setup, edit, admitted
    from test_alpha_budget import grant_for
    from workagent.db import Database
    from workagent.provider_attempts import configure_grant
    s, p, ws, _, admin = context
    cv, art, assignment, _, _ = setup(context, grant=False)
    g = grant_for(context, [cv], **limits)
    configure_grant(Database(admin), g)
    edit(context, art)
    from workagent.service import Principal
    worker_principal = Principal(p.id, 'worker')
    detail = s.reconcile_responsibility(worker_principal, ws, assignment.id)
    cap = s.claim_responsibility_wake(worker_principal, ws, assignment.id, detail.assignment.work_version)
    raises('budget_exhausted', lambda: s.continue_responsibility(cap, g.id))
    # Bypass only the Python feasibility precheck: actual restricted INSERT must
    # independently enforce the same input/cost bound and roll back admission.
    monkeypatch.setattr('workagent.responsibility_execution.check_admission_budget', lambda *_: None)
    with pytest.raises(psycopg.Error, match='responsibility admission budget exhausted'):
        s.continue_responsibility(cap, g.id)
    assert admitted(s, ws) == []
