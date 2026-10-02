"""Provision a NEW disposable PostgreSQL database, never reset/adopt existing state.
Requires local sudo -n -u postgres and PostgreSQL 16. Secrets go only to chmod-600 env.
"""
import argparse
import os
from pathlib import Path
import secrets
import subprocess
import sys
from psycopg import sql
import psycopg
from workagent.db import migrate


def admin(statement):
    result=subprocess.run(['sudo','-n','-u','postgres','psql','-X','-v','ON_ERROR_STOP=1','-q'],input=statement,text=True,capture_output=True)
    if result.returncode:
        raise RuntimeError('PostgreSQL provisioning failed; no existing database was reset.')


def provision(env_file):
    path=Path(env_file)
    if path.exists():
        raise RuntimeError('Refusing to overwrite existing environment file')
    suffix=secrets.token_hex(6)
    name='workagent_test_'+suffix
    owner=name+'_owner'; runtime=name+'_runtime'
    owner_secret=secrets.token_urlsafe(32); runtime_secret=secrets.token_urlsafe(32)
    # All identifiers generated here; sql composables still quote identifiers/literals.
    admin(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}; CREATE ROLE {} LOGIN PASSWORD {}; CREATE DATABASE {} OWNER {};').format(
        sql.Identifier(owner),sql.Literal(owner_secret),sql.Identifier(runtime),sql.Literal(runtime_secret),sql.Identifier(name),sql.Identifier(owner)).as_string())
    owner_dsn=f'postgresql://{owner}:{owner_secret}@127.0.0.1:5432/{name}'
    runtime_dsn=f'postgresql://{runtime}:{runtime_secret}@127.0.0.1:5432/{name}'
    migrate(owner_dsn)
    with psycopg.connect(owner_dsn) as c:
        c.execute('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
        c.execute(sql.SQL('GRANT CONNECT ON DATABASE {} TO {}').format(sql.Identifier(name),sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}').format(sql.Identifier(runtime)))
        mutable=['assignments','assignment_sources','artifacts','revisions','proposals','tasks','task_inspections','commands','audit','outbox','runs','run_configurations','run_contexts','run_dispatches','provider_attempts','run_publications']
        c.execute(sql.SQL('GRANT INSERT ON {} TO {}').format(sql.SQL(',').join(map(sql.Identifier,mutable)),sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT UPDATE ON assignments,artifacts,proposals,outbox,runs,run_dispatches,runtime_configuration,provider_attempts TO {}').format(sql.Identifier(runtime)))
        c.execute(sql.SQL('GRANT USAGE ON SEQUENCE run_dispatches_cursor_seq TO {}').format(sql.Identifier(runtime)))
        # PostgreSQL SELECT FOR SHARE/UPDATE requires UPDATE privilege on >=1 column.
        # No ability to change authority/content: grant UPDATE on invariant keys only;
        # immutable authority triggers below reject all attempted runtime writes.
        for table in ['workspaces','memberships','sources','source_access']:
            c.execute(sql.SQL('GRANT UPDATE ON {} TO {}').format(sql.Identifier(table),sql.Identifier(runtime)))
    path.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:
        f.write(f'export DATABASE_URL={runtime_dsn}\nexport MIGRATION_DATABASE_URL={owner_dsn}\nexport LOCAL_TEST_MODE=true\nexport LOCAL_BEARER_TOKEN={secrets.token_urlsafe(32)}\nexport LOCAL_PRINCIPAL_ID=local-human\n')
    print(f'Created isolated database {name}; environment: {path}. No credentials printed.')
    return name

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('--env-file',default='.local.env')
    provision(p.parse_args().env_file)
