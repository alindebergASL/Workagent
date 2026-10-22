"""Standing envelope parity and upgrade tests; synthetic reservations, no live I/O."""
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest
from pydantic import ValidationError

from test_domain import context, raises
from test_alpha_budget import binding, prepared, count, reserve
from test_conversations import conversation, post
from test_general_alpha_runtime import AlphaProvider
from test_general_responses import worker
from test_adaptive_execution import finish_safe_visits
from workagent.db import Database, migrate
from workagent.models import StandingResponsesBinding, GeneralAlphaResponsesBinding, ProviderGrant, new_id
from workagent.provider_attempts import configure_grant, revoke_grant
from workagent.responses_ledger import RESERVED_INPUT, RESERVED_OUTPUT, RESERVED_COST, summary
from workagent.service import encoded
from workagent.standing_admission import draft_standing_successor

CAPACITY = dict(generation_limit=1024, count_limit=1024,
                input_limit=1024 * RESERVED_INPUT, output_limit=1024 * RESERVED_OUTPUT)
ROOT = Path(__file__).parents[1]
MIGRATION = ROOT / 'migrations/045_cumulative_request_capacity.sql'
FUNCTION = 'require_alpha_budget_binding_pre_continuity(jsonb)'


def payload():
    # Fill unchanged defaults once; mutations below go independently to SQL.
    return StandingResponsesBinding(**binding([], 'proj_capacity', **CAPACITY,
        cost_limit_usd='100'), admission_policy='principal-workspace-v1').model_dump(mode='json')


VALID = [(field, value) for field, cap in CAPACITY.items() for value in (0, cap - 1, cap)]
INVALID = [(field, value) for field, cap in CAPACITY.items()
           for value in (cap + 1, -1, True, False, 1.0, 1.5, '1', None, [], {}, 'missing')]
INVALID += [('read_limit', 4097), ('cancel_limit', 1), ('max_steps', 9),
            ('cost_limit_usd', '100.000001'), ('cost_limit_usd', 100),
            ('continuity_version', 'unknown'), ('admission_policy', 'unknown'),
            ('conversation_ids', ['cv']), ('instructions_sha256', 'bad'),
            ('scope_tool_sha256', True), ('authorization_sha256', None),
            ('project_id', 'bad'), ('transport_mode', 'other'), ('extra', 1)]


def changed(field, value):
    data = payload()
    if value == 'missing':
        data.pop(field)
    else:
        data[field] = value
    return data


@pytest.mark.parametrize('field,value', VALID)
def test_python_boundaries(field, value):
    assert getattr(StandingResponsesBinding.model_validate(changed(field, value)), field) == value


@pytest.mark.parametrize('field,value', INVALID)
def test_python_rejects_malformed_and_unchanged_guards(field, value):
    with pytest.raises(ValidationError):
        StandingResponsesBinding.model_validate(changed(field, value))


@pytest.mark.parametrize('field,value', VALID)
def test_sql_boundaries_independent_of_python(context, field, value):
    with context[0].db.transaction() as c:
        c.execute('SELECT require_alpha_budget_binding(%s::jsonb)', (encoded(changed(field, value)),))


@pytest.mark.parametrize('field,value', INVALID)
def test_sql_rejects_malformed_and_unchanged_guards(context, field, value):
    with pytest.raises(psycopg.Error):
        with context[0].db.transaction() as c:
            c.execute('SELECT require_alpha_budget_binding(%s::jsonb)', (encoded(changed(field, value)),))


@pytest.mark.parametrize('field,cap', list(CAPACITY.items()))
def test_scoped_caps_not_widened(field, cap):
    data = payload()
    data.pop('admission_policy')
    data.update(conversation_ids=['cv'], cost_limit_usd='20')
    # Isolate each changed ceiling from the other valid historical fields.
    data.update(generation_limit=256, count_limit=256, input_limit=12800000, output_limit=2097152)
    GeneralAlphaResponsesBinding.model_validate(data)
    data[field] = cap
    with pytest.raises(ValidationError):
        GeneralAlphaResponsesBinding.model_validate(data)


def definition(c, function=FUNCTION):
    return c.execute('SELECT pg_get_functiondef(%s::regprocedure) AS d', (function,)).fetchone()['d']


def predecessor():
    text = (ROOT / 'migrations/037_prototype_runtime.sql').read_text()
    return text[text.index('CREATE OR REPLACE FUNCTION'):text.index('END $$;') + len('END $$;')]


def history(c):
    return {table: c.execute('SELECT to_jsonb(t) AS row FROM ' + table + ' t ORDER BY to_jsonb(t)::text').fetchall()
            for table in ('provider_grants', 'general_grant_continuations', 'responses_budget_carry',
                          'runs', 'run_configurations', 'run_contexts', 'provider_attempts',
                          'responses_steps', 'responses_events')}


def test_actual_044_to_045_repeat_and_atomic_rollback(context, tmp_path, monkeypatch):
    g, f, x = prepared(context, tmp_path)
    count(x, f)
    reserve(x, 'dispatch')  # Genuine unresolved synthetic reservation, no invented result.
    with Database(context[4]).transaction() as c:
        current = definition(c)
        continuity = definition(c, 'require_alpha_budget_binding(jsonb)')
        scoped = definition(c, 'require_scoped_alpha_budget_binding(jsonb)')
        before = history(c)
        # Reconstruct the exact 044 predecessor in this exclusive disposable DB.
        # The only 045 change is this function. Roll back all test DDL/journal edits.
        class RollbackProbe(Exception):
            pass
        with pytest.raises(RollbackProbe):
            with c.transaction():
                c.execute(predecessor())
                c.execute('DELETE FROM schema_migrations WHERE name=%s', (MIGRATION.name,))
                assert c.execute('SELECT max(name) AS n FROM schema_migrations').fetchone()['n'].startswith('044_')
                with pytest.raises(psycopg.Error):
                    with c.transaction():
                        c.execute('SELECT require_alpha_budget_binding(%s::jsonb)', (encoded(payload()),))

                @contextmanager
                def same_connection(self):
                    # Use the normal migrator and journal, on this rollback-only connection.
                    with c.transaction():
                        yield c

                with monkeypatch.context() as patch:
                    patch.setattr(Database, 'transaction', same_connection)
                    migrate(context[4])
                    migrate(context[4])
                assert definition(c) == current
                assert definition(c, 'require_alpha_budget_binding(jsonb)') == continuity
                assert definition(c, 'require_scoped_alpha_budget_binding(jsonb)') == scoped
                assert history(c) == before
                c.execute('SELECT require_alpha_budget_binding(%s::jsonb)', (encoded(payload()),))
                assert summary(c, g.id)['unknown_usage_steps'] == 1
                raise RollbackProbe()
        assert definition(c) == current
        assert history(c) == before


@pytest.mark.parametrize('drift', ['20.00', '1000.00'])
def test_migration_fails_closed_on_predecessor_drift(context, drift):
    with Database(context[4]).transaction() as c:
        current = definition(c)
        before = history(c)
        old = predecessor().replace('>100.00', '>' + drift)
        c.execute(old)
        changed_definition = definition(c)
        with pytest.raises(psycopg.Error, match='cumulative request migration drift'):
            with c.transaction():
                c.execute(MIGRATION.read_text())
        assert definition(c) == changed_definition
        assert history(c) == before
        c.execute(current)


def test_successor_preserves_unknown_liability_and_native_execution(context, tmp_path):
    s, p, ws, _, admin = context
    old, f, x = prepared(context, tmp_path / 'old', project='proj_' + ws)
    count(x, f)
    reserve(x, 'dispatch')
    raises('action_unresolved', lambda: reserve(x, 'dispatch'))
    with s.db.transaction() as c:
        before = summary(c, old.id, shared=True)
        old_attempt = c.execute('SELECT to_jsonb(a) AS row FROM provider_attempts a WHERE id=%s',
                                (x['ledger'].receipt.attempt_id,)).fetchone()
        old_events = c.execute('SELECT to_jsonb(e) AS row FROM responses_events e WHERE attempt_id=%s ORDER BY id',
                               (x['ledger'].receipt.attempt_id,)).fetchall()
    draft = draft_standing_successor(Database(admin), old.id, grant_id=new_id(), max_runs=32,
                                     cost_limit_usd='44.85948', continuity_version='sustained-v1')
    raw = draft.model_dump(mode='json')
    raw['responses'].update(CAPACITY)
    successor = ProviderGrant.model_validate(raw)
    # Drafting alone neither activates authority nor changes the predecessor.
    with s.db.transaction() as c:
        assert c.execute('SELECT active FROM provider_grants WHERE id=%s', (old.id,)).fetchone()['active']
        assert not c.execute('SELECT 1 FROM provider_grants WHERE id=%s', (successor.id,)).fetchone()
    revoke_grant(Database(admin), old.id)
    configure_grant(Database(admin), successor, predecessor_id=old.id)
    with s.db.transaction() as c:
        assert summary(c, successor.id, shared=True) == before
    q = post(context, conversation(context), 'Continue under explicit cumulative authority.')
    fake = AlphaProvider([{'kind': 'reply', 'text': 'Retained synthetic answer.'}])
    w = worker(context, fake, tmp_path / 'successor')
    assert finish_safe_visits(context, w, q.run.id).state == 'ready'
    calls = list(fake.calls)
    w.work(p, ws, q.run.id)
    assert fake.calls == calls
    with s.db.transaction() as c:
        after = summary(c, successor.id, shared=True)
        assert summary(c, old.id, shared=True) == after
        assert summary(c, old.id) == before
        assert after['unknown_usage_steps'] == 1
        assert after['request_counts']['dispatch'] == before['request_counts']['dispatch'] + 2
        assert Decimal(after['reserved_cost_usd']) == Decimal(before['reserved_cost_usd']) + 2 * RESERVED_COST
        assert c.execute('SELECT to_jsonb(a) AS row FROM provider_attempts a WHERE id=%s',
                         (x['ledger'].receipt.attempt_id,)).fetchone() == old_attempt
        assert c.execute('SELECT to_jsonb(e) AS row FROM responses_events e WHERE attempt_id=%s ORDER BY id',
                         (x['ledger'].receipt.attempt_id,)).fetchall() == old_events
        assert c.execute('SELECT data FROM run_configurations WHERE run_id=%s', (q.run.id,)).fetchone()['data']['grant_id'] == successor.id
