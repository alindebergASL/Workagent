"""Evaluator-only controlled source drift; never imported by product runtime."""
from pathlib import Path
import json, os, shlex, sys
from datetime import datetime, timezone
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2]
values={}
for line in Path(os.environ['WORKAGENT_TEST_ENV_FILE']).read_text().splitlines():
    parts=shlex.split(line)
    if parts and parts[0]=='export':parts=parts[1:]
    if parts:
        key,value=parts[0].split('=',1);values[key]=value
backup=ROOT/'.local/evidence/source-drift-original.json'
with psycopg.connect(values['MIGRATION_DATABASE_URL'],row_factory=dict_row) as c:
    if not c.info.dbname.startswith('workagent_test_'):
        raise RuntimeError('Evaluator refuses a non-disposable database')
    row=c.execute("SELECT data,content FROM sources WHERE workspace_id='local-workspace' AND id='SG-F1' FOR UPDATE").fetchone()
    if sys.argv[1]=='apply':
        actor=json.loads((ROOT/'fixtures/actor/solo-v0.1/initial_records.json').read_text())
        canonical=next(r for r in actor if r['id']=='SG-F1')
        if row['content']!=canonical['content'] or row['data']['external_version']!='1':
            raise RuntimeError('Evaluator only mutates unchanged synthetic SG-F1')
        backup.write_text(json.dumps(row))
        data={**row['data'],'external_version':'review-v2','observed_at':datetime.now(timezone.utc).isoformat()}
        content={**row['content'],'review_latest_only':'Not part of the original analysis'}
    elif sys.argv[1]=='restore':
        if row['data']['external_version']!='review-v2' or row['content'].get('review_latest_only')!='Not part of the original analysis':
            raise RuntimeError('Refuse to overwrite an unexpected intervening source change')
        original=json.loads(backup.read_text());data=original['data'];content=original['content']
    else:raise RuntimeError('Unknown evaluator operation')
    c.execute("UPDATE sources SET data=%s,content=%s WHERE workspace_id='local-workspace' AND id='SG-F1'",(Jsonb(data),Jsonb(content)))
print(json.dumps({'operation':sys.argv[1],'source':'SG-F1','mode':'evaluator_controlled_synthetic_event'}))
