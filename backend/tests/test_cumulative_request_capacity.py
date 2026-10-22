"""Standing cumulative envelopes must outlive historical probe counters."""
import pytest
from test_alpha_budget import binding
from workagent.models import StandingResponsesBinding

@pytest.mark.parametrize('field,value', [
    ('generation_limit', 268),
    ('count_limit', 283),
    ('output_limit', 2195456),
])
def test_standing_successor_accepts_explicit_cumulative_headroom(field, value):
    data = binding([], 'proj_counter_capacity', cost_limit_usd='44.85948')
    data['admission_policy'] = 'principal-workspace-v1'
    data[field] = value
    parsed = StandingResponsesBinding.model_validate(data)
    assert getattr(parsed, field) == value
    assert parsed.cost_limit_usd == '44.85948'
