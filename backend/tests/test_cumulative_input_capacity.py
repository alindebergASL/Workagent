"""50k reservation units across aggregate Python and PostgreSQL ceilings."""
from pathlib import Path

import psycopg
import pytest
from pydantic import ValidationError

from test_domain import context
from test_conversations import conversation
from test_alpha_budget import binding, grant_for
from workagent.db import Database
from workagent.models import GeneralAlphaResponsesBinding, StandingResponsesBinding
from workagent.provider_attempts import configure_grant
from workagent.responses_ledger import RESERVED_INPUT
from workagent.service import encoded


@pytest.mark.parametrize('drift', ['51200000', '51200001'])
def test_migration_rejects_numeric_prefix_drift(context, drift):
    sql = (Path(__file__).parents[1] / 'migrations' / '043_cumulative_input_capacity.sql').read_text()
    with Database(context[4]).transaction() as c:
        definition = c.execute("SELECT pg_get_functiondef('require_scoped_alpha_budget_binding(jsonb)'::regprocedure) AS d").fetchone()['d']
        drifted = definition.replace("WHEN 'input_limit' THEN 12800000", "WHEN 'input_limit' THEN " + drift)
        assert drifted != definition
        c.execute(drifted)
        with pytest.raises(psycopg.Error, match='cumulative input migration drift'):
            with c.transaction():
                c.execute(sql)
        assert c.execute("SELECT pg_get_functiondef('require_scoped_alpha_budget_binding(jsonb)'::regprocedure) AS d").fetchone()['d'] == drifted
        c.execute(definition)


@pytest.mark.parametrize('standing', [False, True])
@pytest.mark.parametrize('value', [5120000, 5120001, 6440000, 256 * RESERVED_INPUT])
def test_cumulative_input_capacity_python_and_sql(context, standing, value):
    cv = conversation(context)
    data = GeneralAlphaResponsesBinding(**binding([cv], 'proj_capacity')).model_dump(mode='json')
    cls = GeneralAlphaResponsesBinding
    if standing:
        cls = StandingResponsesBinding
        data.update(admission_policy='principal-workspace-v1', conversation_ids=[])
    data['input_limit'] = value
    # SQL acceptance is independent of Pydantic validation.
    with context[0].db.transaction() as c:
        c.execute('SELECT require_alpha_budget_binding(%s::jsonb)', (encoded(data),))
    assert cls.model_validate(data).input_limit == value


@pytest.mark.parametrize('standing', [False, True])
@pytest.mark.parametrize('field,value', [
    ('input_limit', 256 * RESERVED_INPUT + 1), ('input_limit', '6440000'),
    ('input_limit', True), ('input_limit', -1), ('generation_limit', 257),
    ('count_limit', 257), ('output_limit', 2097153), ('read_limit', 4097),
])
def test_other_limits_and_exact_types_still_rejected(context, standing, field, value):
    cv = conversation(context)
    data = GeneralAlphaResponsesBinding(**binding([cv], 'proj_denials')).model_dump(mode='json')
    cls = GeneralAlphaResponsesBinding
    if standing:
        cls = StandingResponsesBinding
        data.update(admission_policy='principal-workspace-v1', conversation_ids=[])
        value = {('input_limit', 256 * RESERVED_INPUT + 1): 1024 * RESERVED_INPUT + 1,
                 ('generation_limit', 257): 1025, ('count_limit', 257): 1025,
                 ('output_limit', 2097153): 1024 * 8192 + 1}.get((field, value), value)
    data[field] = value
    with pytest.raises(ValidationError):
        cls.model_validate(data)
    with pytest.raises(psycopg.Error):
        with context[0].db.transaction() as c:
            c.execute('SELECT require_alpha_budget_binding(%s::jsonb)', (encoded(data),))


def test_input_ceiling_migration_changes_no_grants_and_detects_drift(context):
    cv = conversation(context)
    grant = grant_for(context, [cv], input_limit=5120000)
    configure_grant(Database(context[4]), grant)
    sql = (Path(__file__).parents[1] / 'migrations' / '043_cumulative_input_capacity.sql').read_text()
    with Database(context[4]).transaction() as c:
        definition = c.execute("SELECT pg_get_functiondef('require_scoped_alpha_budget_binding(jsonb)'::regprocedure) AS d").fetchone()['d']
        assert definition.count("WHEN 'input_limit' THEN 12800000") == 1
        before = c.execute('SELECT row_to_json(g) AS row FROM provider_grants g ORDER BY id').fetchall()
        # Reconstruct the exact predecessor function inside this disposable DB.
        c.execute(definition.replace("WHEN 'input_limit' THEN 12800000", "WHEN 'input_limit' THEN 5120000"))
        c.execute(sql)
        assert c.execute("SELECT pg_get_functiondef('require_scoped_alpha_budget_binding(jsonb)'::regprocedure) AS d").fetchone()['d'] == definition
        assert c.execute('SELECT row_to_json(g) AS row FROM provider_grants g ORDER BY id').fetchall() == before
        with pytest.raises(psycopg.Error, match='cumulative input migration drift'):
            with c.transaction():
                c.execute(sql)
        assert c.execute('SELECT row_to_json(g) AS row FROM provider_grants g ORDER BY id').fetchall() == before
