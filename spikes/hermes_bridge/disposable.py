"""Fresh-cluster setup and fixture scope. No live DSNs or key loading."""
import json
import os
from pathlib import Path
import sys
from urllib.parse import quote


def prepare(run, repo):
    sys.path.insert(0, str(repo / 'backend'))
    sys.path.insert(0, str(repo))
    import psycopg
    from workagent.db import migrate
    socket = quote(str(run / 'pgsock'), safe='')
    def dsn(role, db='workagent_test_bridge'):
        return f'postgresql://{role}@/{db}?host={socket}'
    with psycopg.connect(dsn('bridge_admin', 'postgres'), autocommit=True) as c:
        c.execute('CREATE ROLE bridge_owner LOGIN')
        c.execute('CREATE ROLE bridge_runtime LOGIN')
        c.execute('CREATE DATABASE workagent_test_bridge OWNER bridge_owner')
    owner, runtime = dsn('bridge_owner'), dsn('bridge_runtime')
    migrate(owner)
    with psycopg.connect(owner) as c:
        c.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
        c.execute('GRANT CONNECT ON DATABASE workagent_test_bridge TO bridge_runtime')
        c.execute('GRANT USAGE ON SCHEMA public TO bridge_runtime')
        c.execute('GRANT SELECT ON ALL TABLES IN SCHEMA public TO bridge_runtime')
        mutable = ['assignments','assignment_sources','artifacts','revisions','proposals','tasks',
            'task_inspections','commands','audit','outbox','runs','run_configurations','run_contexts',
            'run_dispatches','provider_attempts','run_publications','responses_steps','responses_events','responses_consumer_uses']
        c.execute('GRANT INSERT ON ' + ','.join(mutable) + ' TO bridge_runtime')
        c.execute('GRANT UPDATE ON assignments,artifacts,proposals,outbox,runs,run_dispatches,runtime_configuration,provider_attempts TO bridge_runtime')
        c.execute('GRANT USAGE ON SEQUENCE run_dispatches_cursor_seq TO bridge_runtime')
        c.execute('GRANT UPDATE ON workspaces,memberships,sources,source_access TO bridge_runtime')
    os.environ.update(DATABASE_URL=runtime, MIGRATION_DATABASE_URL=owner, LOCAL_TEST_MODE='true')
    return runtime, owner


def scope(repo, runtime, owner):
    from workagent.db import Database
    from workagent.fixture import seed
    from workagent.service import Service, Principal
    from workagent.models import SourceRef, CreateAssignment, new_id
    s, p, ws = Service(Database(runtime)), Principal('bridge-human'), 'bridge-' + new_id()
    # Explicit actor fixture data, never personal/live source content.
    records = json.loads((repo / 'fixtures/actor/solo-v0.1/initial_records.json').read_text())
    seed(owner, records, ws, p.id)
    refs = [SourceRef(source_id=x.id, external_version=x.external_version, observed_at=x.observed_at)
            for x in s.list_sources(p, ws).items]
    q = s.create_assignment(p, ws, CreateAssignment(schema_version='workagent/v1', request_id=new_id(),
        command_id=new_id(), goal='Controlled bridge scope lookup', completion_criteria=['Read scoped assignment'],
        selected_source_refs=refs))
    cap = s.claim_run(p, ws, q.run.id)
    s.db.check_runtime_role()
    return s, p, ws, refs, q, cap
