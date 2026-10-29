"""Bounded two-store historical shape observation; no providers or mutations."""
from pathlib import Path
import os,json,shlex
from datetime import datetime,timezone
import psycopg
from psycopg.rows import dict_row
root=Path.cwd(); dest=root/'.local/batch3/b35c/engineering'
proc=Path('/proc/875172')
assert str((proc/'cwd').resolve())=='/home/ubuntu/workagent-candidates/general-review-20261023/backend'
assert (proc/'stat').read_text().rsplit(')',1)[1].split()[19]=='70011888'
env=dict(x.split('=',1) for x in (proc/'environ').read_bytes().decode().split('\0') if '=' in x)
other={}
for line in Path('/home/ubuntu/workagent-acceptance-remaining-20261026/step4-live-continuation/private.env').read_text().splitlines():
    parts=shlex.split(line)
    if parts and parts[0]=='export':parts=parts[1:]
    if len(parts)==1 and '=' in parts[0]:
        k,v=parts[0].split('=',1);other[k]=v
sql="""WITH steps AS (
 SELECT s.attempt_id,s.phase,s.grant_id,
 count(*) FILTER (WHERE e.kind='dispatch') dispatches,
 count(*) FILTER (WHERE e.kind='read') reads,
 max((e.data->'usage'->>'input_tokens')::bigint) FILTER (WHERE e.kind='result') input,
 max((e.data->'usage'->>'output_tokens')::bigint) FILTER (WHERE e.kind='result') output
 FROM responses_steps s JOIN responses_events e USING(attempt_id,phase)
 JOIN provider_grants g ON g.id=s.grant_id
 WHERE g.data->'responses'->>'transport_mode'='official_api'
 GROUP BY s.attempt_id,s.phase,s.grant_id
), runs AS (SELECT attempt_id,sum(dispatches) generations FROM steps GROUP BY attempt_id)
SELECT count(*) FILTER (WHERE dispatches>0) dispatched_steps,
 count(input) known_usage_steps,
 max(input) max_input,percentile_disc(.95) WITHIN GROUP (ORDER BY input) p95_input,
 max(output) max_output,percentile_disc(.95) WITHIN GROUP (ORDER BY output) p95_output,
 max(reads) FILTER(WHERE dispatches>0) max_reads,
 percentile_disc(.95) WITHIN GROUP (ORDER BY reads) FILTER(WHERE dispatches>0) p95_reads,
 count(*) FILTER(WHERE dispatches>0 AND reads>8) steps_over_8_reads,
 (SELECT max(generations) FROM runs) max_generations_per_attempt,
 (SELECT percentile_disc(.95) WITHIN GROUP (ORDER BY generations) FROM runs) p95_generations_per_attempt
 FROM steps"""
result={'at':datetime.now(timezone.utc).isoformat(),'read_only':True,'provider_requests':0,'scope':'Two historical stores; shape only, not allocation reconciliation or billing. Installed older schemas and Batch2 are not full-tool held-out A/B.','stores':[]}
for label,dsn in [('installed',env['DATABASE_URL']),('batch2_continuation',other['DATABASE_URL'])]:
    with psycopg.connect(dsn,row_factory=dict_row) as c:
        c.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        c.execute("SET LOCAL statement_timeout='10s'");c.execute("SET LOCAL lock_timeout='2s'")
        ident=c.execute("SELECT current_database() database,current_setting('transaction_read_only') read_only").fetchone()
        row=c.execute(sql).fetchone()
        result['stores'].append({'label':label,**ident,**row})
        c.rollback()
(dest/'historical-shapes.json').write_text(json.dumps(result,indent=2,default=str)+'\n')
print(json.dumps(result,indent=2,default=str))
