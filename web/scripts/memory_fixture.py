"""Memories for the Memory panel browser journey, before the stack starts.

Real Service and restricted PostgreSQL; no provider, no network. One
conversation linked to a project, with memories in use for the conversation
and the project (one a long unbroken path) and one waiting for review.
Usage (env sourced, PYTHONPATH=backend): memory_fixture.py <out.json>
"""
import json, os, sys
from pathlib import Path
from workagent.db import Database
from workagent.fixture import seed
from workagent.models import CreateConversation, CreateWorkArea, new_id
from workagent.service import Service, Principal
from workagent.memory.models import RememberMemory, ProposeMemory, BindMemoryScope

out = Path(sys.argv[1])
root = Path(__file__).resolve().parents[2]
p = Principal('local-human'); ws = 'mr-memory-' + new_id()
seed(os.environ['MIGRATION_DATABASE_URL'], json.loads((root / 'fixtures/actor/solo-v0.1/initial_records.json').read_text()), ws, p.id)
s = Service(Database()); s.db.check_runtime_role()
def cmd(cls, **kw): return cls(schema_version='workagent/v1', request_id=new_id(), command_id=new_id(), **kw)

cv = s.create_conversation(p, ws, cmd(CreateConversation, title='Quarterly report prep'))
area = s.create_work_area(p, ws, cmd(CreateWorkArea, title='Quarterly reports', goal='Prepare the quarterly report', kind='project'))
s.bind_memory_scope(p, ws, cmd(BindMemoryScope, conversation_id=cv.id, work_area_id=area.id, expected_work_version=cv.work_version))
mems = {}
mems['heading'] = s.remember_memory(p, ws, cmd(RememberMemory, kind='preference', scope_kind='task', scope_id=cv.id,
    subject_key='reports', predicate_key='heading_style', content='Use short sentence-case headings in reports.'))
mems['region'] = s.remember_memory(p, ws, cmd(RememberMemory, kind='fact', scope_kind='work_area', scope_id=area.id,
    subject_key='reports', predicate_key='region', content='The quarterly report covers the east depot only.'))
mems['long'] = s.remember_memory(p, ws, cmd(RememberMemory, kind='project_convention', scope_kind='work_area', scope_id=area.id,
    subject_key='reports', predicate_key='archive_path',
    content='Archive finished reports under shared/reports/quarterly/2026/q3/east-depot/final-versions/approved-by-finance-and-operations-team.pdf'))
mems['candidate'] = s.propose_memory(p, ws, cmd(ProposeMemory, kind='preference', scope_kind='task', scope_id=cv.id,
    subject_key='reports', predicate_key='chart_style', content='Prefer bar charts over pie charts.',
    confidence_basis='Inferred from two earlier requests'))
f = dict(workspace_id=ws, conversation_id=cv.id, work_area_id=area.id,
         memories={k: v.model_dump(mode='json') for k, v in mems.items()})
out.write_text(json.dumps(f, indent=2))
print('seeded', ws, cv.id)
