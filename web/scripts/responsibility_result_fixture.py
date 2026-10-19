"""A responsibility that has prepared real work, for the result-first page.

Runs after space_demo_fixture.py, in its own workspace so nothing else there
changes. Real Service, PostgreSQL, dispatcher and GeneralWorker with the
backend tests' synthetic provider transport (no live model, no network): a
recorded responsibility is woken, prepares a brief and a checklist through the
receipt-bound follow-through path, and schedules a check-in. This proves
mechanics and presentation, never agency or usefulness.

Usage (repo root, env file sourced): backend/.venv/bin/python
web/scripts/responsibility_result_fixture.py <out.json> <state-dir>
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT / 'backend/tests')]

from workagent.db import Database  # noqa: E402
from workagent.models import Workspace  # noqa: E402
from workagent.service import Service, Principal, encoded  # noqa: E402
from test_general_alpha_runtime import AlphaProvider  # noqa: E402
from test_adaptive_execution import finish_safe_visits  # noqa: E402
from test_responsibility_execution import dispatch, admitted  # noqa: E402
from test_sustained_continuity import setup, draft, advance  # noqa: E402

out, state = Path(sys.argv[1]), Path(sys.argv[2])
admin = os.environ['MIGRATION_DATABASE_URL']
service = Service(Database(os.environ['DATABASE_URL']))
p = Principal('local-human')
ws = 'readiness-work'
with Database(admin).transaction() as c:
    w = Workspace(id=ws, name='Studio readiness', owner_id=p.id)
    c.execute('INSERT INTO workspaces(id,data) VALUES (%s,%s)', (w.id, encoded(w)))
    c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'owner')", (w.id, p.id))
ctx = (service, p, ws, [], admin)

cv, art, a, grant, _ = setup(ctx)
fake = AlphaProvider([draft('Readiness brief'), draft('Readiness checklist'), advance,
                      {'kind': 'reply', 'text': 'I prepared a readiness brief and a checklist. '
                       'I’ll check back in an hour; nothing was accepted for you.'}])
d, fake, w = dispatch(ctx, state, grant, fake)
d.once()
if fake.failures:
    raise fake.failures[0]
rows = admitted(service, ws)
assert len(rows) == 1, rows
assert finish_safe_visits(ctx, w, rows[0]['run_id']).state == 'ready'
life = service.get_responsibility(p, ws, a.id)
assert len(life.assignment.artifact_ids) == 2, life.assignment.artifact_ids
out.write_text(json.dumps({'workspace': ws, 'conversation_id': cv.id, 'assignment_id': a.id,
                           'outputs': life.assignment.artifact_ids, 'source_artifact': art.id,
                           'live_provider_calls': 0}, indent=2))
print('responsibility with prepared results:', a.id)
