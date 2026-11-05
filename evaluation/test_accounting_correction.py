"""Owner-authorized one-off test-accounting correction support (no provider I/O).

Retain original reservations and all existing admission limits. Release only the
unused portion of exact terminal token-usage receipts from the explicitly funded
post-original-$20 primary lineage. This is an allocation adjustment, not a bill,
refund, or modification of the product's per-dispatch ledger.
"""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.local/batch3/b35c/accounting-correction'
PRIMARY = 'workagent_test_47b87fe3b82e'
# Only explicitly documented later increments; exclude original $20 and all carry.
GRANTS = tuple(['workagent-input-budget-20261021-09', 'workagent-continuation-20261021-10'] +
               [f'workagent-continuation-20261022-{n}' for n in range(11, 16)])


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str)


def pg(database, sql):
    if not database.startswith('workagent_test_') or not database.replace('_', '').isalnum():
        raise ValueError('test_database_required')
    p = subprocess.run(['sudo','-n','-u','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-d',database],
                       input=sql, text=True, capture_output=True, timeout=120)
    if p.returncode:
        raise RuntimeError('postgres_operation_failed: ' + p.stderr[-1800:])
    return p.stdout


def readonly_primary():
    sql = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
    SET LOCAL statement_timeout='30s';
    SELECT jsonb_build_object(
      'database',current_database(),'at',clock_timestamp(),
      'migrations',(SELECT jsonb_agg(jsonb_build_object('name',name,'checksum',checksum) ORDER BY name) FROM schema_migrations),
      'grants',(SELECT jsonb_agg(jsonb_build_object('id',id,'active',active,'hash',md5(data::text),'responses',(data->'responses')-'secret_reference'-'project_id'-'conversation_ids') ORDER BY id) FROM provider_grants WHERE data->'responses'->>'transport_mode'='official_api'),
      'events',(SELECT jsonb_agg(jsonb_build_object('id',e.id,'attempt',e.attempt_id,'phase',e.phase,'grant',s.grant_id,'kind',e.kind,'data',e.data,'hash',md5(e.data::text),'created_at',e.created_at) ORDER BY e.id)
        FROM responses_events e JOIN responses_steps s USING(attempt_id,phase) JOIN provider_grants g ON g.id=s.grant_id
        WHERE g.data->'responses'->>'transport_mode'='official_api' AND e.kind IN ('dispatch','result','count_send','count_result')),
      'sessions',(SELECT jsonb_agg(jsonb_build_object('pid',pid,'user',usename,'state',state,'application',application_name,'xact_start',xact_start)) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid())
    ); ROLLBACK;"""
    # Result data can include response content. Keep full snapshot private; public
    # adjustment candidates contain only accounting numbers/identity digests.
    return json.loads(pg(PRIMARY, sql))


def candidates(snapshot):
    by_step = {}
    for e in snapshot['events']:
        by_step.setdefault((e['attempt'], e['phase']), {}).setdefault(e['kind'], []).append(e)
    rows = []
    for (attempt, phase), es in by_step.items():
        if len(es.get('dispatch', [])) != 1 or len(es.get('result', [])) != 1:
            continue
        dispatch, result = es['dispatch'][0], es['result'][0]
        if dispatch['grant'] not in GRANTS:
            continue
        data, usage = dispatch['data'], result['data'].get('usage')
        if not isinstance(usage, dict):
            continue
        i, o = usage.get('input_tokens'), usage.get('output_tokens')
        if type(i) is not int or type(o) is not int or i < 0 or o < 0:
            raise ValueError('invalid_usage')
        if i > int(data['reserved_input_tokens']) or o > int(data['reserved_output_tokens']):
            raise ValueError('usage_exceeds_reservation')
        reserved = Decimal(data['reserved_cost_usd'])
        # Full uncached standard rates, including reasoning output. No discounts.
        upper = (Decimal(i)*Decimal('2.5')+Decimal(o)*Decimal('10'))/1000000
        if not Decimal(0) <= upper <= reserved:
            raise ValueError('invalid_release')
        rows.append(dict(dispatch_id=dispatch['id'], result_id=result['id'],
                         grant_id=dispatch['grant'], dispatch_hash=dispatch['hash'], result_hash=result['hash'],
                         input_tokens=i, output_tokens=o, reserved_usd=str(reserved),
                         retained_usage_upper_usd=str(upper), release_usd=str(reserved-upper)))
    return sorted(rows, key=lambda x:x['dispatch_id'])


if __name__ == '__main__':
    import os
    OUT.mkdir(mode=0o700, parents=True, exist_ok=True)
    snapshot = readonly_primary()
    p = OUT/'primary-readonly-01.private.json'
    with p.open('x') as f:
        os.chmod(p, 0o600)
        f.write(canonical(snapshot)+'\n')
    rows = candidates(snapshot)
    summary = dict(source_database=PRIMARY, snapshot_sha256=sha256(p.read_bytes()).hexdigest(),
                   at=snapshot['at'], candidates=rows,
                   candidate_count=len(rows),
                   release_usd=str(sum((Decimal(r['release_usd']) for r in rows),Decimal(0))),
                   retained_usage_upper_usd=str(sum((Decimal(r['retained_usage_upper_usd']) for r in rows),Decimal(0))),
                   billed_usd=None, installed_mutations=0, provider_calls=0,
                   policy='Full uncached standard token pricing; original $20, carry, all unknowns, ancillary allowances and existing unspent authority retained. Candidate only, not released.')
    with (OUT/'candidate-01.json').open('x') as f:
        f.write(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k!='candidates'},indent=2))
