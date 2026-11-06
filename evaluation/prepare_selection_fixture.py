"""Fresh disposable clone; never an installed study store. No provider I/O."""
import os,subprocess,uuid,json
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
from workagent.db import Database,migrate
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.local/batch3/b35c/selection-recovery'
os.umask(0o077)
old={k.removeprefix('export ').strip():v.strip().strip("'\"") for line in (ROOT/'.local/batch3/b35c/gateway-recovery/fixture.private.env').read_text().splitlines() if '=' in line for k,v in [line.split('=',1)]}
name='workagent_test_selection_'+uuid.uuid4().hex[:12]
parts=urlsplit(old['MIGRATION_DATABASE_URL'])
assert parts.path.startswith('/workagent_test_')
subprocess.run(['sudo','-u','postgres','createdb','-O',parts.username,name],check=True)
env={k:urlunsplit(urlsplit(v)._replace(path='/'+name)) if k.endswith('DATABASE_URL') else v for k,v in old.items()}
admin=env['MIGRATION_DATABASE_URL'];runtime=urlsplit(env['DATABASE_URL']).username
migrate(admin)
with Database(admin).transaction() as c:
 from psycopg import sql
 c.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(runtime)))
 c.execute(sql.SQL('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO {}').format(sql.Identifier(runtime)))
 c.execute(sql.SQL('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO {}').format(sql.Identifier(runtime)))
 c.execute(sql.SQL('REVOKE INSERT,UPDATE,DELETE ON selection_rejection_diagnostics FROM {}').format(sql.Identifier(runtime)))
(OUT/'fixture.private.env').write_text('\n'.join(k+'='+__import__('shlex').quote(v) for k,v in env.items())+'\n')
print(json.dumps({'database':name,'installed_mutations':0,'provider_calls':0}))
