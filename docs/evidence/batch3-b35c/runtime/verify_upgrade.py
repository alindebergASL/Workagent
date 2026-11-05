"""Upgrade only an explicitly disposable pre-074 fixture; never installed data."""
import hashlib
import json
import os
from pathlib import Path
import psycopg
from psycopg import sql
from workagent.db import migrate

assert '/workagent_test_' in os.environ['MIGRATION_DATABASE_URL']

def snapshot():
    result={}
    with psycopg.connect(os.environ['MIGRATION_DATABASE_URL']) as c:
        tables=[r[0] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename")]
        for table in tables:
            rows=[json.dumps(r[0],sort_keys=True,default=str,separators=(',',':')) for r in c.execute(sql.SQL('SELECT to_jsonb(t) FROM {} t').format(sql.Identifier(table)))]
            result[table]={'rows':len(rows),'sha256':hashlib.sha256('\n'.join(sorted(rows)).encode()).hexdigest()}
        migrations=[r[0] for r in c.execute('SELECT name FROM schema_migrations ORDER BY name')]
    return result,migrations

before,old=snapshot()
assert old[-1]=='073_full_tool_memory_treatment.sql',old[-1]
migrate(os.environ['MIGRATION_DATABASE_URL'])
after,new=snapshot()
assert before==after,'historical row drift'
assert new==old+['074_run_output_resources.sql']
with psycopg.connect(os.environ['DATABASE_URL']) as c:
    legacy=c.execute("SELECT id,tool_run_output_resources(workspace_id,run_id) FROM tool_grants WHERE NOT data ? 'allow_run_outputs'").fetchall()
    assert legacy and all(r[1]==[] for r in legacy)
result=dict(evidence='disposable_prefix_upgrade_not_installed_maintenance',unchanged_tables=before,
    unchanged_table_count=len(before),unchanged_rows=sum(v['rows'] for v in before.values()),
    old_migrations=len(old),new_migrations=len(new),legacy_grants_still_exact_only=len(legacy))
Path('.local/batch3/b35c/runtime/upgrade-proof.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='unchanged_tables'},indent=2))
