"""Disposable restored-copy 074→075 rollback/retry probe; never a study store."""
from pathlib import Path
import json
import os
import subprocess
import uuid
from urllib.parse import urlsplit,urlunsplit
from workagent.db import Database
from amend_gateway_recovery import ROOT, MIGRATION, apply075, schema_state, canonical, digest

out=ROOT/'.local/batch3/b35c/gateway-recovery'
env={k.removeprefix('export ').strip():v.strip().strip("'\"") for line in (out/'fixture.private.env').read_text().splitlines() if '=' in line for k,v in [line.split('=',1)]}
dsn=env['MIGRATION_DATABASE_URL'];parts=urlsplit(dsn)
clone='workagent_test_gateway_recovery_'+uuid.uuid4().hex[:12]
subprocess.run(['sudo','-u','postgres','createdb','-O',parts.username,clone],check=True)
dump=ROOT/'.local/batch3/b35c/live-study/d477c622c837a9cc1fb1f0be/before-recipient.dump'
with dump.open('rb') as source:
    subprocess.run(['sudo','-u','postgres','pg_restore','--exit-on-error','--no-owner','--no-acl','--role',parts.username,'--dbname',clone],stdin=source,check=True)
db=Database(urlunsplit(parts._replace(path='/'+clone)))
m=json.loads((out/'SOURCE_AMENDMENT.json').read_text())

def snapshot():
    with db.transaction() as c:
        names=[r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()]
        return {n:digest(canonical(c.execute('SELECT to_jsonb(t) AS row FROM '+n+' t ORDER BY to_jsonb(t)::text').fetchall())) for n in names}

before=snapshot()
with db.transaction() as c:assert not schema_state(c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall(),m)
try:
    with db.transaction() as c:
        c.execute((ROOT/'backend/migrations'/MIGRATION).read_text())
        raise RuntimeError('injected rollback after075 before journal')
except RuntimeError as e:assert str(e)=='injected rollback after075 before journal'
assert snapshot()==before
with db.transaction() as c:assert c.execute("SELECT to_regprocedure('gateway_publication_rejection(text,text,jsonb)') AS fn").fetchone()['fn'] is None
apply075(db,m);after=snapshot()
assert all(after[n]==h for n,h in before.items() if n!='schema_migrations')
apply075(db,m);assert snapshot()==after
with db.transaction() as c:
    assert schema_state(c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall(),m)
    assert 'gateway_publication_rejection' in c.execute("SELECT pg_get_functiondef('guard_tool_consumption()'::regprocedure) AS body").fetchone()['body']
result=dict(scope='disposable_restored_SQL_not_live',database=clone,source_dump_sha256=digest(dump.read_bytes()),
    rollback=True,idempotent_retry=True,preserved_original_tables=len(before)-1,original_row_hashes={n:h for n,h in before.items() if n!='schema_migrations'},
    provider_calls=0,installed_study_mutations=0,migration_sha256=m['migration_inventory'][MIGRATION])
with (out/'restored075-verification.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(canonical({k:v for k,v in result.items() if k!='original_row_hashes'}))
