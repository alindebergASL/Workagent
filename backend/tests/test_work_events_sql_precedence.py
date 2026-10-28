"""Static regression only; deferred-trigger execution requires real PostgreSQL."""
from pathlib import Path
import re

import pytest


@pytest.mark.parametrize('row', ['n', 'old_row'])
@pytest.mark.parametrize('removed', [
    "ARRAY['observed_at','lease_expires_at','fence']",
    "ARRAY['updated_at','last_message_preview']",
    "'observed_at'",
])
def test_material_subtraction_parenthesizes_json_extraction(row, removed):
    sql = (Path(__file__).resolve().parents[1] / 'migrations' /
           '047_work_events.sql').read_text()
    compact = re.sub(r'\s+', '', sql)
    # PostgreSQL binds subtraction before ->; without parentheses it tries
    # to subtract from the literal 'data', failing when deferred triggers fire.
    assert f"({row}->'data')-{removed}" in compact
    assert f"{row}->'data'-{removed}" not in compact
