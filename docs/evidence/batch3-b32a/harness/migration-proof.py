import json,os
from pathlib import Path
from hashlib import sha256
from urllib.parse import urlsplit
from workagent.db import Database
root=Path.cwd();db=Database();db.check_runtime_role()
with db.transaction() as c:
 rows=c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()
 state=c.execute('SELECT current_database() name,current_user role').fetchone()
 assert state['name'].startswith('workagent_test_')
 assert len(rows)==len(list((root/'backend/migrations').glob('*.sql')))
 for row in rows:assert sha256((root/'backend/migrations'/row['name']).read_bytes()).hexdigest()==row['checksum']
 state['migrations']=rows;state['restricted_runtime_verified']=True
 dest=root/'.local/batch3/b32a/evidence'/('migration-'+state['name']+'.json');dest.write_text(json.dumps(state,indent=2));print(state['name'],len(rows),'exact migration hashes; restricted role PASS')
