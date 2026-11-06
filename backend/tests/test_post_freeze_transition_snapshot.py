"""Offline SQL-scope regression, NOT PostgreSQL authorization evidence.

SQLite executes the real snapshot joins/predicates. Only PostgreSQL row-to-JSON
projection/cast and placeholder spelling are adapted; no scope is rewritten.
"""
from contextlib import contextmanager
from types import SimpleNamespace as N
import sqlite3
from test_post_freeze_transition_pg import snapshot


TABLES=('runs','run_configurations','run_dispatches','commands','audit','outbox',
        'conversation_messages','artifacts','revisions','proposals','provider_attempts',
        'responses_steps','tool_attempts')


def test_snapshot_preserves_every_table_and_scopes_attempt_owned_steps():
    with sqlite3.connect(':memory:') as conn:
        conn.row_factory=sqlite3.Row
        for table in TABLES:
            if table=='responses_steps':columns='attempt_id TEXT, payload TEXT'
            elif table=='provider_attempts':columns='workspace_id TEXT, run_id TEXT, id TEXT, payload TEXT'
            elif table in ('runs','tool_attempts'):columns='workspace_id TEXT, id TEXT, run_id TEXT, payload TEXT'
            else:columns='workspace_id TEXT, payload TEXT'
            conn.execute(f'CREATE TABLE {table} ({columns})')
        for ws in ('wanted','unrelated'):
            for table in TABLES:
                payload=f'{ws}:{table}'
                if table=='responses_steps':
                    conn.execute(f'INSERT INTO {table} VALUES (?,?)',(ws+'-attempt',payload))
                elif table=='provider_attempts':
                    conn.execute(f'INSERT INTO {table} VALUES (?,?,?,?)',(ws,ws+'-run',ws+'-attempt',payload))
                elif table in ('runs','tool_attempts'):
                    conn.execute(f'INSERT INTO {table} VALUES (?,?,?,?)',(ws,ws+'-run',ws+'-run',payload))
                else:conn.execute(f'INSERT INTO {table} VALUES (?,?)',(ws,payload))
        queries=[]
        class Connection:
            def execute(self,sql,params):
                queries.append((sql,params))
                sql=sql.replace('to_jsonb(t)::text','t.payload').replace('to_jsonb(t)','t.payload').replace('%s','?')
                cursor=conn.execute(sql,params)
                return N(fetchall=lambda:[dict(row) for row in cursor.fetchall()])
        class Database:
            @contextmanager
            def transaction(self):yield Connection()
        actual=snapshot(N(db=Database()),'wanted')
        assert tuple(actual)==TABLES
        assert actual=={table:[{'row':f'wanted:{table}'}] for table in TABLES}
        step_sql=queries[TABLES.index('responses_steps')][0]
        assert 'a.id=t.attempt_id' in step_sql
        assert 'r.workspace_id=a.workspace_id AND r.id=a.run_id' in step_sql
        assert 'WHERE r.workspace_id=%s' in step_sql and 't.workspace_id' not in step_sql
        tool_sql=queries[TABLES.index('tool_attempts')][0]
        assert 'WHERE t.workspace_id=%s' in tool_sql and 'provider_attempts' not in tool_sql
        assert all(params==('wanted',) for _,params in queries)
        # Existing schema prevents orphan attempts; an empty scope stays empty.
        assert snapshot(N(db=Database()),'absent')=={table:[] for table in TABLES}
