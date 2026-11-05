"""Pre-install target composition proof: ordinary 083 -> 084 runner rollback.

Requires a new explicitly owned 083 fixture. Do not run on an installed 084 DB.
The retained accepted proposal test is superseded by normal journaled migration.
"""
import os
import json
import re
from pathlib import Path
from hashlib import sha256
from contextlib import contextmanager
from unittest.mock import patch
from psycopg import sql
from workagent import db
from test_domain import fixture_database_urls, context as base_context

ROOT=Path(__file__).parents[1]

def catalog(c):
    source=(ROOT/'migrations/083_source_cohorts_file_envelope.sql').read_text()
    names=set(re.findall(r'CREATE OR REPLACE FUNCTION\s+(?:public\.)?(\w+)',source,re.I))
    names.update(re.findall(r"public\.(\w+)\([^']*\)'::regprocedure",source))
    rows=c.execute('SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=\'public\' AND p.proname=ANY(%s) ORDER BY 1',(sorted(names),)).fetchall()
    return {r['signature']:sha256(r['definition'].encode()).hexdigest() for r in rows}

def rows(c):
    tables=[r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1").fetchall()]
    answer={}
    for table in tables:
        answer[table]=c.execute(sql.SQL("SELECT count(*) n,md5(coalesce(string_agg(t.body,',' ORDER BY t.body),'')) hash FROM (SELECT row_to_json(x)::text body FROM public.{} x) t").format(sql.Identifier(table))).fetchone()
    return answer

def test_normal_083_to_084_migration_rollback(monkeypatch):
    runtime,owner=fixture_database_urls(os.environ)
    db.Database(runtime).check_runtime_role()
    base_context.__wrapped__()  # real populated preexisting authority/data
    expected={p.name:sha256(p.read_bytes()).hexdigest() for p in (ROOT/'migrations').glob('*.sql')}
    assert len(expected)==84
    with db.Database(owner).transaction() as c:
        before={r['name']:r['checksum'] for r in c.execute('SELECT name,checksum FROM schema_migrations').fetchall()}
        assert before=={n:h for n,h in expected.items() if not n.startswith('084_')}
        assert c.execute("SELECT to_regclass('public.model_discovery_receipts_v2') t").fetchone()['t'] is None
        guards=catalog(c);data=rows(c)
        @contextmanager
        def transaction(self):
            with c.transaction(force_rollback=True):yield c
        with patch.object(db.Database,'transaction',transaction):
            db.migrate(owner)
        # Whole ordinary migration, including journal insertion, rolled back.
        assert rows(c)==data and catalog(c)==guards
        assert c.execute("SELECT to_regclass('public.model_discovery_receipts_v2') t").fetchone()['t'] is None
        # Repeat and inspect the fully applied transaction before rollback.
        @contextmanager
        def inspect_transaction(self):
            with c.transaction(force_rollback=True):
                yield c
                journal={r['name']:r['checksum'] for r in c.execute('SELECT name,checksum FROM schema_migrations').fetchall()}
                assert journal==expected and catalog(c)==guards
                after=rows(c)
                assert {n:after[n] for n in data if n!='schema_migrations'}=={n:v for n,v in data.items() if n!='schema_migrations'}
        with patch.object(db.Database,'transaction',inspect_transaction):db.migrate(owner)
        assert rows(c)==data and catalog(c)==guards
        output=Path(os.environ['TARGET_INTEGRATION_ARTIFACTS'])
        (output/'prefix83-catalog-and-data.json').write_text(json.dumps({'guards':guards,'data':data,'migration_checksums':before},indent=2,sort_keys=True)+'\n')
