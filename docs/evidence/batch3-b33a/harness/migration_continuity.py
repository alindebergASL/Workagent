import os,json,hashlib
from pathlib import Path
from workagent.db import Database
B=Path.cwd()/'.local/batch3/b33a';name=os.environ['FIXTURE_LABEL'];rows=[]
with Database(os.environ['MIGRATION_DATABASE_URL']).transaction() as c:
 for r in c.execute("SELECT name,checksum,applied_at FROM schema_migrations WHERE name IN ('063_github_public.sql','064_tool_scope_reductions.sql') ORDER BY name").fetchall():
  current=hashlib.sha256((Path('backend/migrations')/r['name']).read_bytes()).hexdigest();assert current==r['checksum'];rows.append({**r,'applied_at':r['applied_at'].isoformat(),'current_sha256':current})
assert any(x['name'].startswith('063') for x in rows)
(B/'evidence'/('migration-continuity-'+name+'.json')).write_text(json.dumps({'fixture':name,'read_only':True,'history_modified':False,'rows':rows},indent=2)+'\n');print(name,'migration continuity PASS')
