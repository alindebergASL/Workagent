"""No-extra-I/O budget regressions on restricted synthetic PostgreSQL.

A feasibility check is not authority to resend, refund, or block known-ID reads.
"""
import hashlib
import json
import os
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from test_domain import context
from test_conversations import conversation, post
from test_b24_runtime_pg import activate
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker, totals
from test_adaptive_execution import finish_safe_visits
from test_sustained_continuity import draft
from test_runtime import expire
from workagent.errors import DomainError

from workagent.provider_attempts import configure_grant
from workagent.responses_ledger import Ledger
from workagent.service import Principal


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('Real provider HTTP forbidden')
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', forbidden)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', forbidden)


CAPS = [
    {'generation_limit': 2}, {'count_limit': 2}, {'input_limit': 100000},
    {'output_limit': 16384}, {'cost_limit_usd': '0.41384'},
]
NAMES = ['generation', 'count', 'input', 'output', 'cost']
TABLES = ('provider_grants', 'responses_budget_carry', 'runs', 'run_configurations',
          'conversations', 'conversation_messages', 'commands', 'outbox',
          'run_checkpoints', 'run_successors', 'conversation_intents',
          'artifacts', 'revisions', 'responses_steps', 'responses_events')


def hashes(s, tables=TABLES):
    with s.db.transaction() as c:
        return {table: hashlib.sha256(json.dumps(c.execute(
            'SELECT to_jsonb(t)::text AS payload FROM ' + table +
            ' t ORDER BY to_jsonb(t)::text').fetchall(), sort_keys=True).encode()).hexdigest()
            for table in tables}


def receipt(name, data):
    if os.environ.get('GATE_RECEIPTS'):
        (Path(os.environ['GATE_RECEIPTS']) / (name + '.json')).write_text(
            json.dumps(data, indent=2, default=str))


def saved_read(ctx, cv):
    s, p, ws, _, _ = ctx
    aid = s.get_conversation(p, ws, cv.id).artifact_ids[0]
    saved = s.get_artifact(p, ws, aid).model_dump(mode='json', exclude={'observed_at'})
    with pytest.raises(DomainError) as error:
        s.get_artifact(Principal('synthetic-outsider'), ws, aid)
    assert error.value.code.value == 'not_found_or_not_authorized'
    return saved


def setup(ctx, tmp_path, caps, *, pair=False):
    s, p, ws, _, _ = ctx
    cv = conversation(ctx)
    other = conversation(ctx) if pair else None
    def configure(db, grant):
        if other:
            grant = grant.model_copy(update={'responses': grant.responses.model_copy(
                update={'conversation_ids': [cv.id, other.id]})})
        return configure_grant(db, grant)
    with patch('test_general_alpha_runtime.configure_grant', configure):
        grant = activate(ctx, cv, max_steps=1, **caps)
    q = post(ctx, cv, 'Save a synthetic brief without external effects.')
    fake = AlphaProvider([draft('Preserved synthetic brief')])
    return cv, other, grant, q, fake, worker(ctx, fake, tmp_path)


@pytest.mark.parametrize('caps', CAPS, ids=NAMES)
def test_exhausted_admission_is_atomic_and_saved_reads_remain_scoped(context, tmp_path, caps):
    s, p, ws, _, _ = context
    cv, _, g, q, fake, w = setup(context, tmp_path, caps)
    assert finish_safe_visits(context, w, q.run.id).state == 'partial'
    cv = s.get_conversation(p, ws, cv.id).conversation
    saved = saved_read(context, cv)
    before = hashes(s); accounting = totals(s, g); calls = list(fake.calls)
    with pytest.raises(DomainError) as error:
        post(context, cv, 'This infeasible new turn must leave no partial state.')
    assert error.value.code.value == 'budget_exhausted'
    assert hashes(s) == before and totals(s, g) == accounting and fake.calls == calls
    assert saved_read(context, cv) == saved
    receipt('admission-' + next(iter(caps)), {'tables_before': before, 'tables_after': hashes(s),
        'accounting': accounting, 'calls': calls, 'refusal': error.value.code.value})


@pytest.mark.parametrize('stage', ['queued', 'prepared_restart', 'counted_restart'])
@pytest.mark.parametrize('caps', CAPS, ids=NAMES)
def test_previously_admitted_work_refuses_futile_io(context, tmp_path, monkeypatch, stage, caps):
    s, p, ws, _, _ = context
    cv, other, g, q, fake, w = setup(context, tmp_path, caps, pair=True)
    queued = post(context, other, 'Already admitted while generation was still feasible.')
    if stage != 'queued':
        class Interrupted(Exception):
            pass
        with monkeypatch.context() as m:
            if stage == 'prepared_restart':
                original = Ledger.prepare
                def prepare(ledger, request, cap):
                    original(ledger, request, cap)
                    raise Interrupted()
                m.setattr(Ledger, 'prepare', prepare)
            else:
                def hook(name):
                    if name == 'after_count':
                        raise Interrupted()
                w.phases.hook = hook
            with pytest.raises(Interrupted):
                w.work(p, ws, queued.run.id)
        w.phases.hook = None
        expire(context, queued.run.id)
    # The peer consumes the remaining capacity through real journal reservations.
    finish_safe_visits(context, w, q.run.id)
    saved = saved_read(context, cv)
    accounting = totals(s, g); calls = list(fake.calls)
    pinned = ('provider_grants', 'responses_budget_carry', 'artifacts', 'revisions', 'responses_events')
    before = hashes(s, pinned)
    restarted = worker(context, fake, tmp_path)
    result = finish_safe_visits(context, restarted, queued.run.id)
    assert result.state == 'partial' and result.stop_reason == 'budget_limit'
    if stage == 'counted_restart' and 'count_limit' in caps:
        # Exhausted count capacity must not invalidate a retained successful
        # count while generation capacity remains: send once, never recount.
        assert fake.calls[len(calls):] == [('POST', '/v1/responses')]
        after = totals(s, g)
        assert after['request_counts'] == {'count_send': 2, 'dispatch': 2, 'read': 0, 'cancel': 0}
        from decimal import Decimal
        from workagent.responses_ledger import RESERVED_COST, RESERVED_INPUT, RESERVED_OUTPUT
        assert Decimal(after['reserved_cost_usd']) == Decimal(accounting['reserved_cost_usd']) + RESERVED_COST
        assert after['reserved_input_tokens'] == accounting['reserved_input_tokens'] + RESERVED_INPUT
        assert after['reserved_output_tokens'] == accounting['reserved_output_tokens'] + RESERVED_OUTPUT
    else:
        assert fake.calls == calls and totals(s, g) == accounting and hashes(s, pinned) == before
    assert saved_read(context, cv) == saved
    receipt('queued-' + stage + '-' + next(iter(caps)), {'accounting_before': accounting,
        'accounting_after': totals(s, g), 'calls_before': calls, 'calls_after': fake.calls,
        'pinned_before': before, 'pinned_after': hashes(s, pinned), 'stop_reason': result.stop_reason})


@pytest.mark.parametrize('boundary', ['committed_final', 'known_id_restart', 'unknown_send_restart'])
def test_final_generation_commit_and_recovery_remain_authorized(context, tmp_path, boundary):
    s, p, ws, _, _ = context
    cv, _, g, q, fake, w = setup(context, tmp_path, {'generation_limit': 2})
    class Interrupted(Exception):
        pass
    final_seen = []
    def hook(name):
        used = totals(s, g)
        if used['request_counts']['dispatch'] != 2:
            return
        if name == 'after_predispatch':
            final_seen.append(used)
            if boundary == 'unknown_send_restart':
                raise Interrupted()
        if name == 'after_response' and boundary == 'known_id_restart':
            raise Interrupted()
    w.phases.hook = hook
    if boundary == 'committed_final':
        result = finish_safe_visits(context, w, q.run.id)
        assert result.state == 'partial' and result.stop_reason == 'step_limit'
        assert final_seen and len(fake.responses) == 2
        assert totals(s, g)['request_counts'] == {'count_send': 2, 'dispatch': 2, 'read': 0, 'cancel': 0}
    else:
        with pytest.raises(Interrupted):
            w.work(p, ws, q.run.id)
        before = totals(s, g); calls = list(fake.calls)
        assert before['unknown_usage_steps'] == 1
        expire(context, q.run.id)
        result = worker(context, fake, tmp_path).work(p, ws, q.run.id)
        after = totals(s, g)
        for key in ('reserved_input_tokens', 'reserved_output_tokens', 'reserved_cost_usd'):
            assert after[key] == before[key]
        assert after['request_counts']['dispatch'] == after['request_counts']['count_send'] == 2
        if boundary == 'known_id_restart':
            assert result.state == 'partial' and result.stop_reason == 'step_limit'
            assert fake.calls[len(calls):] == [('GET', '/v1/responses/resp_alpha_1')]
            assert after['unknown_usage_steps'] == 0 and after['request_counts']['read'] == 1
        else:
            assert result.state == 'running' and fake.calls == calls
            assert after == before  # No identity: retain full liability, never resend.
    assert saved_read(context, cv)
    receipt(boundary, {'accounting': totals(s, g), 'calls': fake.calls,
        'final_committed_reservation': final_seen, 'state': result.state, 'stop_reason': result.stop_reason})


def add_synthetic_carry(ctx, grant, amount):
    from workagent.db import Database
    from workagent.models import new_id
    with Database(ctx[4]).transaction() as c:
        c.execute('''INSERT INTO responses_budget_carry(project_id,transport_mode,
            source_database,source_grant_id,source_manifest_sha256,reserved_cost_usd)
            VALUES (%s,'synthetic','isolated_prior_database',%s,%s,%s)''',
            (grant.responses.project_id, new_id(), 'a' * 64, amount))


def test_nonalpha_same_project_preserves_fresh_per_grant_capacity(context, tmp_path):
    from decimal import Decimal
    from test_general_responses import activate as activate_nonalpha, Provider
    from workagent.db import Database
    from workagent.provider_attempts import revoke_grant
    from workagent.responses_ledger import summary, RESERVED_COST, RESERVED_INPUT, RESERVED_OUTPUT
    s, p, ws, _, admin = context
    first = conversation(context)
    old = activate_nonalpha(context, [first])
    add_synthetic_carry(context, old, Decimal('1'))
    fake = Provider(); w = worker(context, fake, tmp_path)
    for _ in range(4):
        cv = s.get_conversation(p, ws, first.id).conversation
        q = post(context, cv, 'Build an invoice-total calculator in cents.')
        assert finish_safe_visits(context, w, q.run.id).state == 'ready'
    old_totals = totals(s, old)
    assert old_totals['request_counts']['dispatch'] == old.responses.generation_limit
    assert old_totals['request_counts']['count_send'] == old.responses.count_limit
    assert old_totals['reserved_input_tokens'] == old.responses.input_limit
    assert old_totals['reserved_output_tokens'] == old.responses.output_limit
    saved = saved_read(context, first)
    revoke_grant(Database(admin), old.id)
    second = conversation(context)
    fresh = activate_nonalpha(context, [second])
    assert fresh.responses.project_id == old.responses.project_id
    assert totals(s, fresh)['request_counts']['dispatch'] == 0
    before = hashes(s); calls = list(fake.calls)
    q = post(context, second, 'Build a new invoice-total calculator.')
    assert fake.calls == calls  # Admission itself never reserves or sends.
    assert finish_safe_visits(context, w, q.run.id).state == 'ready'
    own = totals(s, fresh)
    assert own['request_counts'] == {'count_send': 2, 'dispatch': 2, 'read': 0, 'cancel': 0}
    assert own['reserved_input_tokens'] == 2 * RESERVED_INPUT
    assert own['reserved_output_tokens'] == 2 * RESERVED_OUTPUT
    assert totals(s, old) == old_totals and saved_read(context, first) == saved
    with s.db.transaction() as c:
        shared = summary(c, fresh.id, shared=True)
    assert shared['request_counts']['dispatch'] == 10
    assert Decimal(shared['reserved_cost_usd']) == Decimal('1') + 10 * RESERVED_COST
    assert Decimal(shared['carried_reserved_cost_usd']) == Decimal('1')
    receipt('nonalpha-fresh-capacity', {'before': before, 'old_accounting': old_totals,
        'new_accounting': own, 'shared_accounting': shared, 'calls_before': calls,
        'calls_after': fake.calls})


@pytest.mark.parametrize('peer_usage', [False, True], ids=['carry_only', 'peer_plus_carry'])
def test_nonalpha_shared_cost_refusal_is_atomic(context, tmp_path, peer_usage):
    from decimal import Decimal
    from test_general_responses import activate as activate_nonalpha, Provider
    from workagent.db import Database
    from workagent.provider_attempts import revoke_grant
    from workagent.responses_ledger import summary, RESERVED_COST
    s, p, ws, _, admin = context
    first = conversation(context)
    old = activate_nonalpha(context, [first])
    fake = Provider(); w = worker(context, fake, tmp_path)
    # Import historical synthetic carry before any local provider I/O, as the
    # append-only carry guard requires. The peer will reserve two generations.
    peer_cost = 2 * RESERVED_COST if peer_usage else Decimal('0')
    carry = Decimal(old.responses.cost_limit_usd) - peer_cost - RESERVED_COST / 2
    add_synthetic_carry(context, old, carry)
    saved = None
    if peer_usage:
        q = post(context, first, 'Build an invoice-total calculator in cents.')
        assert finish_safe_visits(context, w, q.run.id).state == 'ready'
        saved = saved_read(context, first)
    old_totals = totals(s, old)
    revoke_grant(Database(admin), old.id)
    second = conversation(context)
    fresh = activate_nonalpha(context, [second])
    # With peer usage, neither carry nor peer liability alone denies a fresh
    # generation: admission must combine both, without sharing token counters.
    assert Decimal(old_totals['reserved_cost_usd']) == peer_cost
    with s.db.transaction() as c:
        shared = summary(c, fresh.id, shared=True)
    assert shared['request_counts']['dispatch'] < fresh.responses.generation_limit
    assert shared['request_counts']['count_send'] < fresh.responses.count_limit
    assert shared['reserved_input_tokens'] + 50000 <= fresh.responses.input_limit
    assert shared['reserved_output_tokens'] + 8192 <= fresh.responses.output_limit
    assert Decimal(shared['reserved_cost_usd']) < Decimal(fresh.responses.cost_limit_usd)
    assert Decimal(shared['reserved_cost_usd']) + RESERVED_COST > Decimal(fresh.responses.cost_limit_usd)
    before = hashes(s); own = totals(s, fresh); calls = list(fake.calls)
    with pytest.raises(DomainError) as error:
        post(context, second, 'This unaffordable turn must not be admitted.')
    assert error.value.code.value == 'budget_exhausted'
    assert hashes(s) == before and totals(s, fresh) == own and fake.calls == calls
    assert totals(s, old) == old_totals
    with s.db.transaction() as c:
        assert summary(c, fresh.id, shared=True) == shared
    if saved is not None:
        assert saved_read(context, first) == saved
    receipt('nonalpha-shared-cost-' + str(peer_usage), {'tables_before': before,
        'tables_after': hashes(s), 'own_accounting': own, 'shared_accounting': shared,
        'calls_before': calls, 'calls_after': fake.calls, 'refusal': error.value.code.value})
