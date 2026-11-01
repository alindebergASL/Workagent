"""Parent-run real PG: NEW ordinary provision only; retain DB/roles/private env.

No original env or DATABASE_URL is consumed. Requires local sudo -n -u postgres.
Use persistent --basetemp; the normally provisioned fixture remains usable afterward.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
from urllib.parse import urlsplit

import psycopg
from psycopg import sql
import pytest
import dev_db
import workagent.db as module
from workagent.db import Database, migrate

MIGRATIONS=Path(__file__).resolve().parents[1]/'migrations'

class PrivateDsn(str):
    def __repr__(self):return '<generated disposable DSN redacted>'


def hash_bytes(raw):return hashlib.sha256(raw).hexdigest()

def save(path,value):
    path.write_text(json.dumps(value,indent=2,sort_keys=True,default=str)+'\n')


def snapshot(owner):
    """All user rows/functions/schema names; no credential/material in artifacts."""
    with Database(owner).transaction() as c:
        journal=c.execute('SELECT name,checksum,applied_at FROM public.schema_migrations ORDER BY name').fetchall()
        tables={}
        for r in c.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname !~ '^pg_' AND schemaname<>'information_schema' ORDER BY 1,2").fetchall():
            data=c.execute(sql.SQL('SELECT to_jsonb(t) data FROM {}.{} t').format(sql.Identifier(r['schemaname']),sql.Identifier(r['tablename']))).fetchall()
            hashes=sorted(hash_bytes(json.dumps(x['data'],sort_keys=True,separators=(',',':'),default=str).encode()) for x in data)
            tables[r['schemaname']+'.'+r['tablename']]=dict(rows=len(hashes),sha256=hash_bytes(json.dumps(hashes).encode()))
        functions=c.execute("SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND p.prokind IN ('f','p') ORDER BY 1,2,3").fetchall()
        schemas=c.execute("SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema' ORDER BY 1").fetchall()
        return dict(journal=journal,tables=tables,schemas=schemas,
            functions=[dict(schema=r['nspname'],name=r['proname'],args=r['args'],sha256=hash_bytes(r['definition'].encode())) for r in functions])


@pytest.fixture(scope='module')
def normal_fixture(tmp_path_factory):
    folder=tmp_path_factory.getbasetemp()/'normal-provision';folder.mkdir(mode=0o700)
    path=folder/'fixture.private.env'
    # Exact normal public entry point, complete chain in one transaction. No
    # migration monkeypatch/prefix/bootstrap or inherited connection is used.
    name=dev_db.provision(path)
    values=dict(line.removeprefix('export ').split('=',1) for line in path.read_text().splitlines())
    assert name.startswith('workagent_test_') and values['WORKAGENT_TEST_DATABASE']==name
    assert os.stat(path).st_mode & 0o777==0o600
    owner=PrivateDsn(values['MIGRATION_DATABASE_URL']);runtime=PrivateDsn(values['DATABASE_URL'])
    assert urlsplit(owner).path==urlsplit(runtime).path=='/'+name
    Database(runtime).check_runtime_role()
    save(folder/'PROVISIONED.json',dict(database=name,env_file=str(path),normal_full_chain=True,retained=True))
    return folder,owner,runtime


def test_normal_provision_complete_journal_repeat_noop_and_runtime_acl(normal_fixture):
    folder,owner,runtime=normal_fixture
    before=snapshot(owner)
    expected={p.name:hash_bytes(p.read_bytes()) for p in sorted(MIGRATIONS.glob('*.sql'))}
    assert {r['name']:r['checksum'] for r in before['journal']}==expected
    # now() is transaction-start time: every ordinary fresh receipt is atomic.
    assert len({r['applied_at'] for r in before['journal']})==1
    with Database(owner).transaction() as c:
        row=c.execute("SELECT to_regprocedure('public.bounded_phase_stop_settled(text)') IS NOT NULL AS in_public, to_regprocedure('pg_catalog.bounded_phase_stop_settled(text)') IS NULL AS not_catalog").fetchone()
        assert row==dict(in_public=True,not_catalog=True)
    migrate(owner);migrate(owner)
    after=snapshot(owner)
    assert after==before  # Includes exact receipt timestamps, all rows/functions.
    with Database(runtime).transaction() as c:
        row=c.execute("SELECT has_table_privilege(current_user,'public.model_discovery_receipts_v2','INSERT') i, has_table_privilege(current_user,'public.model_discovery_receipts_v2','UPDATE') u, has_table_privilege(current_user,'public.model_discovery_receipts_v2','DELETE') d, has_function_privilege(current_user,'public.reserve_tool_call_v2(text,text,integer,text,jsonb,text,text,text)','EXECUTE') x").fetchone()
        assert row==dict(i=True,u=False,d=False,x=True)
    save(folder/'FULL_CHAIN_REPEAT.json',dict(before=before,after=after,equal=True))


def copied_chain(tmp_path,monkeypatch):
    directory=tmp_path/'migrations';shutil.copytree(MIGRATIONS,directory)
    monkeypatch.setattr(module,'__file__',str(tmp_path/'workagent/db.py'))
    return directory


def test_pending_namespace_and_receipts_roll_back_together(normal_fixture,tmp_path,monkeypatch):
    folder,owner,_=normal_fixture;before=snapshot(owner)
    directory=copied_chain(tmp_path,monkeypatch)
    # Hide public entirely and create a same-named shadow journal. Receipt INSERT
    # and the next lookup must still target public, not the file-local namespace.
    first='''CREATE SCHEMA r1_file_local;
SET LOCAL search_path=r1_file_local,pg_catalog;
CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text);
CREATE TABLE pending_effect(id integer);
INSERT INTO pending_effect VALUES (1);
'''
    (directory/'900_r1_local.sql').write_text(first)
    (directory/'901_r1_fail.sql').write_text('''
CREATE FUNCTION r1_pending_function() RETURNS integer LANGUAGE sql AS 'SELECT 1';
DO $$ BEGIN
 IF current_schema() <> 'public' THEN RAISE EXCEPTION 'namespace was not reset'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE name='900_r1_local.sql')
    OR EXISTS (SELECT 1 FROM r1_file_local.schema_migrations) THEN
   RAISE EXCEPTION 'journal was redirected';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM r1_file_local.pending_effect WHERE id=1) THEN
   RAISE EXCEPTION 'earlier pending SQL missing';
 END IF;
 RAISE EXCEPTION 'r1_expected_pending_failure';
END $$;
''')
    with pytest.raises(psycopg.errors.RaiseException,match='r1_expected_pending_failure'):
        migrate(owner)
    after=snapshot(owner);assert after==before
    with Database(owner).transaction() as c:
        assert c.execute("SELECT to_regnamespace('r1_file_local') IS NULL AND to_regprocedure('public.r1_pending_function()') IS NULL AS clean").fetchone()['clean']
    save(folder/'PENDING_ROLLBACK.json',dict(equal=True,before=before,after=after))


@pytest.mark.parametrize('damage',['checksum','prefix'])
def test_journal_drift_fails_closed_without_persistent_effects(normal_fixture,tmp_path,monkeypatch,damage):
    folder,owner,_=normal_fixture;before=snapshot(owner)
    directory=copied_chain(tmp_path,monkeypatch)
    paths=sorted(directory.glob('*.sql'))
    if damage=='checksum':
        paths[-1].write_bytes(paths[-1].read_bytes()+b'\n-- test-only changed checksum\n')
        message='Migration checksum drift'
    else:
        paths[3].unlink()  # Only a copied test input, never a canonical migration.
        message='not a known exact prefix'
    (directory/'902_r1_never.sql').write_text('CREATE TABLE public.r1_never_applied(id integer);')
    with pytest.raises(RuntimeError,match=message):migrate(owner)
    after=snapshot(owner);assert after==before
    save(folder/('DENIED_'+damage+'.json'),dict(equal=True,before=before,after=after))
