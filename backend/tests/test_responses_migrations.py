"""Clean/prefix upgrade probes use NEW disposable databases, never destructive reset."""
import os
from pathlib import Path
import secrets
import shutil
from unittest.mock import patch
import psycopg
from psycopg import sql
from workagent.db import Database,migrate
from dev_db import admin,provision


def test_exact_005_upgrade_and_runtime_acl(tmp_path):
    assert '/workagent_test_' in os.environ['DATABASE_URL']
    name='workagent_test_'+secrets.token_hex(6)
    owner=name+'_owner';runtime=name+'_runtime'
    owner_key=secrets.token_urlsafe(32);runtime_key=secrets.token_urlsafe(32)
    admin(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}; CREATE ROLE {} LOGIN PASSWORD {}; CREATE DATABASE {} OWNER {};').format(
        sql.Identifier(owner),sql.Literal(owner_key),sql.Identifier(runtime),sql.Literal(runtime_key),sql.Identifier(name),sql.Identifier(owner)).as_string())
    owner_dsn=f'postgresql://{owner}:{owner_key}@127.0.0.1:5432/{name}'
    runtime_dsn=f'postgresql://{runtime}:{runtime_key}@127.0.0.1:5432/{name}'
    prefix=tmp_path/'prefix'; (prefix/'workagent').mkdir(parents=True); (prefix/'migrations').mkdir()
    root=Path(__file__).resolve().parents[1]
    for path in sorted((root/'migrations').glob('*.sql'))[:5]:shutil.copyfile(path,prefix/'migrations'/path.name)
    with patch('workagent.db.__file__',str(prefix/'workagent/db.py')):migrate(owner_dsn)
    with psycopg.connect(owner_dsn) as c:
        c.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}').format(sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT INSERT ON provider_attempts TO {}').format(sql.Identifier(runtime)))
        assert c.execute('SELECT count(*) FROM schema_migrations').fetchone()[0]==5
    migrate(owner_dsn);migrate(owner_dsn)
    Database(runtime_dsn).check_runtime_role()
    with psycopg.connect(owner_dsn) as c:
        assert c.execute('SELECT count(*) FROM schema_migrations').fetchone()[0]==len(list((root/'migrations').glob('*.sql')))
        for table in ('responses_steps','responses_events','responses_consumer_uses'):
            assert c.execute('SELECT has_table_privilege(%s,%s,\'SELECT\'),has_table_privilege(%s,%s,\'INSERT\'),has_table_privilege(%s,%s,\'UPDATE\'),has_table_privilege(%s,%s,\'DELETE\')',
                (runtime,table,runtime,table,runtime,table,runtime,table)).fetchone()==(True,True,False,False)
    # No DB/role deletion: preserve test evidence and honor the non-destructive scope.


def test_clean_chain_provision_has_minimal_step_acl(tmp_path):
    assert '/workagent_test_' in os.environ['DATABASE_URL']
    env=tmp_path/'clean.env';provision(env)
    values=dict(line.removeprefix('export ').split('=',1) for line in env.read_text().splitlines())
    db=Database(values['DATABASE_URL']);db.check_runtime_role()
    with db.transaction() as c:
        for table in ('responses_steps','responses_events','responses_consumer_uses'):
            row=c.execute("SELECT has_table_privilege(current_user,%s,'INSERT') AS i,has_table_privilege(current_user,%s,'UPDATE') AS u,has_table_privilege(current_user,%s,'DELETE') AS d",(table,table,table)).fetchone()
            assert row=={'i':True,'u':False,'d':False}
