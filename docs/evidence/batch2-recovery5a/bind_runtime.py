"""Read-only proof binding current process, source and disposable database."""
import hashlib,json,os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];sys.path.insert(0,str(ROOT/'backend'))
from workagent.db import Database
from workagent.operator_client import OperatorClient
OUT=ROOT/'docs/evidence/batch2-recovery5a'
source=json.loads((OUT/'source-manifest.json').read_text());assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in source.items())
db=Database();db.check_runtime_role()
with db.transaction() as c:
 role=c.execute('SELECT current_database() db,current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
 migrations=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
 assert all(hashlib.sha256((ROOT/'backend/migrations'/m['name']).read_bytes()).hexdigest()==m['checksum'] for m in migrations)
 assert not role['rolsuper'] and not role['rolbypassrls']
proof={'runtime':role,'migrations':migrations,'fixture_sha256':hashlib.sha256((OUT/'fixture.json').read_bytes()).hexdigest(),'source_manifest_sha256':hashlib.sha256((OUT/'source-manifest.json').read_bytes()).hexdigest()}
client=OperatorClient();assert client.identity('recovery5a-workspace')=='local-human'
pid=int(sys.argv[1]);proc=Path('/proc')/str(pid)
args=(proc/'cmdline').read_bytes().split(b'\0');assert b'workagent.api:app' in args and b'18965' in args
assert (proc/'cwd').resolve()==ROOT/'backend'
env=dict(x.split(b'=',1) for x in (proc/'environ').read_bytes().split(b'\0') if b'=' in x)
assert env[b'DATABASE_URL'].decode()==os.environ['DATABASE_URL']
assert not any(k for k in env if k.endswith(b'API_KEY'))
name=sys.argv[2]
import re
assert re.fullmatch(r'[A-Za-z0-9_-]+',name),'Invalid evidence name'
runtime_path=OUT/(name+'.json');database_path=OUT/(name+'-database.json')
assert not runtime_path.exists() and not database_path.exists(),'Refusing historical evidence overwrite'
with database_path.open('x') as output:output.write(json.dumps(proof,indent=2)+'\n')
with runtime_path.open('x') as output:output.write(json.dumps({'pid':pid,'proc_start_ticks':(proc/'stat').read_text().split()[21],'cwd':str((proc/'cwd').resolve()),'argv':[a.decode() for a in args if a],'identity_verified':True,'db_matches_private_env':True,'db_fingerprint':hashlib.sha256(os.environ['DATABASE_URL'].encode()).hexdigest(),'source_manifest_sha256':proof['source_manifest_sha256'],'provider_keys_present':False},indent=2)+'\n')
print('Verified actual loopback HTTP identity, task-owned API PID/source, restricted synthetic DB and',len(migrations),'migration checksums.')
