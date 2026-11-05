#!/usr/bin/env python3
"""B3.5b accounting-only collector. No product imports or provider API calls.
Run with: PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/python .local/batch3/b35b/ledger/reconcile_readonly.py
Uses explicit repeatable-read, read-only PG transactions; rolls them back.
Only output files beside this script; no DSNs, credentials, raw messages or receipts.
Public documentation GETs are optional (--public-pricing), unauthenticated and not inference.
"""
from pathlib import Path
from decimal import Decimal as D
from datetime import datetime, timezone
from collections import Counter
import argparse, ast, hashlib, json, shlex, subprocess, sys, tarfile, urllib.request
import psycopg
from psycopg.rows import dict_row

ROOT = Path('/home/ubuntu/workagent-continuation-20261026')
EVIDENCE = Path('/home/ubuntu/workagent-acceptance-remaining-20261026')
OUT = ROOT / '.local/batch3/b35b/ledger'
INSTALLED = Path('/home/ubuntu/workagent-candidates/general-review-20261023/backend')
assert Path(__file__).resolve().parent == OUT

def sha(data):
    return hashlib.sha256(data).hexdigest()

def load(path):
    return json.loads(Path(path).read_text())

def write(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, default=str) + '\n')

def read_env(path):
    result = {}
    for line in path.read_text().splitlines():
        parts = shlex.split(line)
        if parts and parts[0] == 'export':
            parts = parts[1:]
        if parts and '=' in parts[0]:
            key, value = parts[0].split('=', 1)
            result[key] = value
    return result

def reference(path, expected=None):
    path = Path(path)
    if not path.is_file():
        return {'path': str(path), 'exists': False, 'matches_retained_hash': False}
    digest = sha(path.read_bytes())
    return {'path': str(path), 'exists': True, 'sha256': digest,
            'matches_retained_hash': digest == expected if expected else None}

# Whitelisted accounting projections; identifiers are hashed before leaving PG.
EVENT_SQL = """SELECT md5(e.id::text) identity_hash,s.grant_id,
 md5(e.attempt_id::text||':'||e.phase) step_hash, e.kind,
 md5(e.data::text) payload_hash,
 e.data->>'reserved_cost_usd' reserved_cost_usd,
 e.data->>'reserved_input_tokens' reserved_input_tokens,
 e.data->>'reserved_output_tokens' reserved_output_tokens,
 e.data->'usage'->>'input_tokens' input_tokens,
 e.data->'usage'->>'output_tokens' output_tokens,
 e.data->>'billed_cost_usd' billed_cost_usd,
 CASE WHEN e.kind='problem' THEN e.data->>'code' END problem_code,
 CASE WHEN e.kind='problem' THEN e.data->>'received' END problem_received
 FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
 JOIN provider_grants g ON g.id=s.grant_id
 WHERE g.data->'responses'->>'transport_mode'='official_api' ORDER BY e.id"""
GRANT_SQL = """SELECT g.id,g.active,md5(g.data::text) immutable_data_hash,
 md5(g.workspace_id) workspace_hash,md5(g.principal_id) principal_hash,
 md5(g.data->'responses'->>'project_id') project_hash,
 g.data->>'model' model,g.data->>'profile' profile,
 g.data->>'consumer_sha256' consumer_sha256,g.data->>'expires_at' expires_at,
 (g.data->>'max_runs')::int max_runs,
 (g.data->'responses') - 'secret_reference' - 'project_id' - 'conversation_ids' binding,

 (SELECT count(*) FROM provider_attempts a WHERE a.grant_id=g.id) attempts,
 (SELECT count(*) FROM run_configurations r WHERE r.data->>'grant_id'=g.id) configurations
 FROM provider_grants g WHERE g.data->'responses'->>'transport_mode'='official_api' ORDER BY g.id"""
CARRY_SQL = """SELECT md5(project_id) project_hash,transport_mode,source_database,
 source_grant_id,source_manifest_sha256,reserved_cost_usd::text
 FROM responses_budget_carry WHERE transport_mode='official_api'
 ORDER BY source_database,source_grant_id"""

def totals(events):
    counts = Counter(e['kind'] for e in events)
    steps = {}
    for e in events:
        steps.setdefault(e['step_hash'], []).append(e)
    unknowns = []
    for key, es in steps.items():
        kinds = {e['kind'] for e in es}
        missing_count = 'count_send' in kinds and 'count_result' not in kinds
        missing_usage = 'dispatch' in kinds and not any(e['kind'] == 'result' and e['input_tokens'] is not None for e in es)
        if missing_count or missing_usage:
            unknowns.append({'step_hash': key, 'kinds': sorted(kinds), 'unmatched_count': missing_count,
                             'unknown_generation_usage': missing_usage})
    result = {'counts': {k: counts[k] for k in ('count_send','count_result','dispatch','read','cancel','result','corrected_readback')},
              'unmatched_count_steps': sum(x['unmatched_count'] for x in unknowns),
              'unknown_usage_steps': sum(x['unknown_generation_usage'] for x in unknowns)}
    for field, kind in [('reserved_cost_usd','dispatch'),('reserved_input_tokens','dispatch'),
                        ('reserved_output_tokens','dispatch'),('input_tokens','result'),('output_tokens','result')]:
        result[field] = str(sum((D(e[field] or '0') for e in events if e['kind'] == kind), D(0)))
    result['known_usage_calculated_usd'] = str((D(result['input_tokens'])*D('2.5')+D(result['output_tokens'])*D('10'))/D(1000000))
    result['billed_cost_usd'] = None
    result['billed_cost_fields_present'] = sum(e['billed_cost_usd'] is not None for e in events)
    result['corrected_readback_usage_policy'] = 'Not substituted for original result usage; separately enumerated, no refund.'
    return result, unknowns

# sudo peer authentication is used only for the historical databases named by receipts.
# Installed and campaign stores use the existing runtime DATABASE_URL kept in memory.
def psql_snapshot(name):
    assert name.startswith('workagent_test_') and name.replace('_','').isalnum()
    probe = subprocess.run(['sudo','-n','-u','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-d',name],
        input="BEGIN READ ONLY; SELECT to_regclass('public.responses_budget_carry') IS NOT NULL; ROLLBACK;",text=True,capture_output=True,timeout=30)
    if probe.returncode:
        raise RuntimeError('read_only_catalog_probe_failed')
    has_carry = probe.stdout.strip() == 't'
    queries = [
        "SELECT json_build_object('database',current_database(),'database_oid',(SELECT oid FROM pg_database WHERE datname=current_database()),'server_start',pg_postmaster_start_time(),'port',current_setting('port'),'read_only',current_setting('transaction_read_only'))",
        f"SELECT coalesce(jsonb_agg(x),'[]') FROM ({EVENT_SQL}) x",
        f"SELECT coalesce(jsonb_agg(x),'[]') FROM ({GRANT_SQL}) x",
        f"SELECT coalesce(jsonb_agg(x),'[]') FROM ({CARRY_SQL}) x" if has_carry else "SELECT '[]'::jsonb",
        "SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT name,checksum FROM schema_migrations ORDER BY name) x",
    ]
    sql = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='3s';\n"+';\n'.join(queries)+'; ROLLBACK;'
    p = subprocess.run(['sudo','-n','-u','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-d',name],input=sql,text=True,capture_output=True,timeout=90)
    if p.returncode:
        raise RuntimeError('read_only_snapshot_failed')
    values = [json.loads(x) for x in p.stdout.splitlines() if x.strip()]
    assert len(values) == 5 and values[0]['read_only'] == 'on'
    identity, events, grants, carry, migrations = values
    return {'identity':identity,'events':events,'grants':grants,'carry':carry,'migrations':migrations}

def direct_snapshot(dsn):
    c = psycopg.connect(dsn, options='-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=3000', row_factory=dict_row, connect_timeout=5)
    try:
        c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        identity = c.execute("SELECT current_database() database,(SELECT oid FROM pg_database WHERE datname=current_database()) database_oid,pg_postmaster_start_time() server_start,current_setting('port') port,current_setting('transaction_read_only') read_only").fetchone()
        assert identity['read_only'] == 'on'
        result = {'identity':identity,'events':c.execute(EVENT_SQL).fetchall(),'grants':c.execute(GRANT_SQL).fetchall(),
                  'carry':c.execute(CARRY_SQL).fetchall(),
                  'migrations':c.execute('SELECT name,checksum FROM schema_migrations ORDER BY name').fetchall()}
        result['grant_continuations'] = c.execute('SELECT successor_id,predecessor_id,created_at FROM general_grant_continuations ORDER BY created_at').fetchall()
        result['active_grant_retained_request_profiles'] = c.execute("""SELECT s.grant_id,count(*) retained_steps,
            encode(sha256(convert_to(s.request_bytes::jsonb->>'instructions','UTF8')),'hex') instructions_sha256,
            s.request_bytes::jsonb->'model' model,s.request_bytes::jsonb->'reasoning' reasoning,
            s.request_bytes::jsonb->'service_tier' service_tier,s.request_bytes::jsonb->'max_output_tokens' max_output_tokens,
            s.request_bytes::jsonb->'background' background,s.request_bytes::jsonb->'store' store,
            s.request_bytes::jsonb->'parallel_tool_calls' parallel_tool_calls,
            s.request_bytes::jsonb->'truncation' truncation,s.request_bytes::jsonb->'prompt_cache_options' prompt_cache_options
            FROM responses_steps s JOIN provider_grants g ON s.grant_id=g.id
            WHERE g.active AND g.data->'responses'->>'transport_mode'='official_api'
            GROUP BY 1,3,4,5,6,7,8,9,10,11,12 ORDER BY 1,3""").fetchall()
        if c.execute("SELECT to_regclass('public.evaluation_campaign') t").fetchone()['t']:
            result['campaign'] = c.execute('SELECT id,activated_at,deadline,expires_at,prior_allocation::text,allocation::text,linkage_sha256,clock_timestamp()>=deadline OR clock_timestamp()>=expires_at expired FROM evaluation_campaign').fetchall()
            gate = c.execute("SELECT pg_get_functiondef('evaluation_gate()'::regprocedure) text").fetchone()['text']
            result['campaign_gate'] = {'sha256':sha(gate.encode()),'definition':gate,
                                      'count_read_reserve_usd':'.01' if "WHEN kind IN ('count_send','read') THEN .01" in gate else None,
                                      'cancel_forbidden':"NEW.kind='cancel' THEN RAISE" in gate}
            result['campaign_total_configurations'] = c.execute('SELECT count(*) n FROM run_configurations').fetchone()['n']
            result['campaign_total_successors'] = c.execute('SELECT count(*) n FROM run_successors').fetchone()['n']
            result['campaign_triggers'] = c.execute("SELECT tgname,tgenabled,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE NOT tgisinternal AND tgfoid='evaluation_gate()'::regprocedure ORDER BY tgname").fetchall()
        if c.execute("SELECT to_regclass('public.exact_receipt_observers') t").fetchone()['t']:
            result['observers'] = c.execute('SELECT active,expires_at,read_limit FROM exact_receipt_observers ORDER BY expires_at').fetchall()
        return result
    finally:
        c.rollback()
        c.close()

def static_string(path, symbol):
    """Resolve only top-level string constants/additions; never execute product code."""
    tree = ast.parse(path.read_text())
    values = {}
    imports = {}
    def value(node):
        if isinstance(node,ast.Constant) and isinstance(node.value,str): return node.value
        if isinstance(node,ast.BinOp) and isinstance(node.op,ast.Add): return value(node.left)+value(node.right)
        if isinstance(node,ast.Name):
            if node.id in values: return values[node.id]
            if node.id in imports:
                return static_string(*imports[node.id])
        raise ValueError('unsupported_static_policy_expression')
    for node in tree.body:
        if isinstance(node,ast.ImportFrom) and node.level:
            base = path.parent
            for _ in range(node.level-1): base = base.parent
            source = base / ((node.module or '').replace('.','/')+'.py')
            for alias in node.names: imports[alias.asname or alias.name] = (source,alias.name)
        elif isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
            try: values[node.targets[0].id] = value(node.value)
            except ValueError: pass
        elif isinstance(node,ast.AugAssign) and isinstance(node.target,ast.Name) and isinstance(node.op,ast.Add):
            if node.target.id in values: values[node.target.id] += value(node.value)
    return values[symbol]

def runtime_facts():
    facts = []
    for root in (INSTALLED, ROOT/'backend'):
        files = ['workagent/responses_transport.py','workagent/general_responses.py','workagent/general_schema.py',
                 'workagent/composition.py','workagent/retained_results.py','workagent/responses_ledger.py','workagent/general_worker.py']
        row = {'backend':str(root),'files':[reference(root/f) for f in files]}
        tree = ast.parse((root/files[0]).read_text())
        wanted = {'MODEL','OFFICIAL_ORIGIN','MAX_INPUT_TOKENS','MAX_OUTPUT_TOKENS','INPUT_RESERVATION_RATE','OUTPUT_RESERVATION_RATE'}
        row['transport_constants'] = {}
        for node in tree.body:
            if isinstance(node,ast.Assign) and isinstance(node.targets[0],ast.Name) and node.targets[0].id in wanted:
                row['transport_constants'][node.targets[0].id] = ast.literal_eval(node.value)
        row['static_prompt_hashes'] = {}
        for filename,symbol in [('composition.py','CONTINUITY_POLICY'),('retained_results.py','POLICY'),
                                ('capabilities/compute_composition.py','POLICY'),('memory/runtime.py','POLICY')]:
            p = root/'workagent'/filename
            if p.exists(): row['static_prompt_hashes'][filename+':'+symbol] = sha(static_string(p,symbol).encode())
        tree = ast.parse((root/'workagent/general_responses.py').read_text())
        fn = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='consumer_hash')
        names = next(ast.literal_eval(n.value) for n in fn.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='names')
        for n in fn.body:
            if isinstance(n,ast.AugAssign) and isinstance(n.target,ast.Name) and n.target.id=='names' and isinstance(n.op,ast.Add):
                names += ast.literal_eval(n.value)
        files = {n:sha((root/'workagent'/n).read_bytes()) for n in names}
        row['on_disk_consumer_hash'] = sha(json.dumps(files,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())
        row['consumer_file_count'] = len(files)
        row['consumer_hash_limitation'] = 'Source disk only; no introspection of Python objects already loaded by a running process.'
        facts.append(row)
    return facts

def allocation_sources():
    path = EVIDENCE/'step4-budget/allocation-lineage.json'
    lineage = load(path)
    running = D(0)
    for row in lineage['rows']:
        assert D(row['prior_usd']) == running
        running += D(row['addition_usd'])
        assert running == D(row['cumulative_usd'])
    refs = [reference(x['path'],x['sha256']) for x in lineage['source_receipts']]
    for ref, original in zip(refs,lineage['source_receipts']):
        if Path(ref['path']).suffix == '.json':
            raw = load(ref['path'])
            checked = []
            for key, expected in original['fields'].items():
                value = raw
                for part in key.split('.'): value = value[part]
                checked.append(value == expected)
            ref['primary_accounting_fields_checked'] = len(checked)
            ref['primary_accounting_fields_match'] = all(checked)
            assert all(checked)
    campaigns = []
    for name in ['step4-live','step4-live-continuation']:
        p = EVIDENCE/name/'activation.json'
        d = load(p)
        assert running == D(d['prior_allocation'])
        running += D(d['allocation'])
        campaigns.append({'source':reference(p),**d})
    archive_record = load(EVIDENCE/'step4-budget/recovered-archive-receipts.json')
    archive_checks = []
    with tarfile.open(archive_record['archive_path'],'r:gz') as archive:
        for member in archive_record['members']:
            f = archive.extractfile(member['archive_member'])
            assert f is not None
            digest = sha(f.read())
            archive_checks.append({'member':member['archive_member'],'sha256':digest,'matches_retained_hash':digest==member['sha256']})
    return {'source':reference(path),'historical_rows':lineage['rows'],'source_receipt_checks':refs,
            'archive_member_checks':archive_checks,'all_archive_members_match':all(x['matches_retained_hash'] for x in archive_checks),
            'source_receipt_count':len(refs),'all_source_receipts_match':all(r['matches_retained_hash'] for r in refs),
            'archive_receipts':reference(EVIDENCE/'step4-budget/recovered-archive-receipts.json'),
            'campaign_additions':campaigns,'retained_allocation_usd':str(running),
            'global_unallocated_usd':str(D(100)-running),
            'account_wide_completeness':False,
            'rule':'Retain entire original 20 USD, additive receipts and unknown liabilities. Never sum successor caps, cloned events, or carry with its source dispatches.'}

def costs():
    per = (D(50000)*D('2.5')+D(8192)*D(10))/D(1000000)
    designs = {}
    for name, trajectories in [('single_episode',None),('single_trajectory',1),('one_family',6),('A_B',12),('A_G',42)]:
        episodes = 1 if trajectories is None else trajectories*6
        calls = episodes*8
        model = calls*per
        count = D(calls)*D('.01')
        reads = calls*40
        ancillary = count+D(reads)*D('.01')
        designs[name] = {'families':2 if name=='A_B' else 7 if name=='A_G' else 1 if name=='one_family' else None,
                         'trajectories':trajectories,'episodes':episodes,'generations':calls,'count_sends':calls,
                         'response_reads':reads,'cancels':0,'input_tokens':calls*50000,'output_tokens':calls*8192,
                         'model_reserve_usd':str(model),'count_read_reserve_usd':str(ancillary),'total_reserve_usd':str(model+ancillary)}
    for design in designs.values():
        design['total_with_one_read_per_generation_usd'] = str(D(design['model_reserve_usd'])+D(design['generations'])*D('.02'))
    return {'reservation_rates_usd_per_million':{'input':'2.5','output':'10'},'per_generation_model_reserve_usd':str(per),
            'one_generation_with_40_reads_usd':str(per+D('.41')),
            'design':'Two held-out variations per family x B0/B1/M1 x six episodes x up to eight total generation calls per episode, including final/explanation/recovery; no retries outside this cap.',
            'ancillary_design':'One count per generation and at most 40 lifetime response GETs per generation, not 40 per worker visit; .01 USD each as enforced by actual Batch2 campaign SQL. Zero cancels (forbidden). Read exhaustion retains partial/unknown outcomes; no blind resend.',
            'auxiliary_paid_judge_search_calls':0,'tools':'Local/public tools unpriced; measured usage is not proved free or dollar billing. No paid auxiliary judge/search permitted.',
            'designs':designs,'executable':False,'new_allocation_usd':'0','provider_calls':0}

def public_pricing():
    receipts = []
    for name,url in [('public-model-current.txt','https://developers.openai.com/api/docs/models/gpt-6.1-sol.md'),
                     ('public-pricing-current.txt','https://developers.openai.com/api/docs/pricing.md'),
                     ('public-caching-current.txt','https://developers.openai.com/api/docs/guides/prompt-caching.md')]:
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Workagent-readonly-budget-preflight/1.0'}),timeout=30) as r:
                body = r.read(2000000)
                row = {'url':url,'final_url':r.url,'http_status':r.status,'sha256':sha(body),'bytes':len(body),'at':datetime.now(timezone.utc).isoformat(),'file':name}
            (OUT/name).write_bytes(body)
        except Exception as exc:
            row = {'url':url,'error_type':type(exc).__name__}
        receipts.append(row)
    write('public-pricing-receipts.json',receipts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--public-pricing',action='store_true')
    args = parser.parse_args()
    now = datetime.now(timezone.utc).isoformat()
    proc = Path('/proc/875172')
    assert (proc/'cwd').resolve() == INSTALLED
    cmd = (proc/'cmdline').read_bytes().split(b'\0')
    assert b'workagent.api:app' in cmd
    env = dict(x.split(b'=',1) for x in (proc/'environ').read_bytes().split(b'\0') if b'=' in x)
    snapshots = [direct_snapshot(env[b'DATABASE_URL'].decode())]
    discovery = [{'source':'/proc/875172/environ:DATABASE_URL (value withheld)','database':snapshots[0]['identity']['database']}]
    paths = [ROOT/'.local/step4-a01.private.env',EVIDENCE/'step4-live-continuation/private.env',
             EVIDENCE/'step4-live-continuation/successor/private.env',EVIDENCE/'step4-live-continuation/sustained/private.env',
             EVIDENCE/'step4-live-continuation/scheduled/private.env',ROOT/'.local/step4-closure/test.private.env']
    dsns = {env[b'DATABASE_URL'].decode()}
    for p in paths:
        dsn = read_env(p)['DATABASE_URL']
        if dsn in dsns:
            discovery.append({'source':str(p),'same_connection_as_previous_source':True})
            continue
        dsns.add(dsn)
        snap = direct_snapshot(dsn)
        discovery.append({'source':str(p),'database':snap['identity']['database']})
        if snap['identity']['database'] not in {x['identity']['database'] for x in snapshots}:
            snapshots.append(snap)
    baseline = load(EVIDENCE/'step4-budget/current-aggregate.json')
    existing = {s['identity']['database'] for s in snapshots}
    for store in baseline['stores']:
        name = store['identity']['database']
        if name not in existing:
            snapshots.append(psql_snapshot(name))
    union = {}; repeats = 0; conflicts = 0
    result = {'at':now,'ended_at':None,'read_only_transactions':True,'provider_calls':0,'authority_changes':0,'billing_queried':False,
              'installed_process':{'pid':875172,'cwd':str(INSTALLED),'start_ticks':(proc/'stat').read_text().split()[21]},
              'discovery':discovery,'stores':[],'scope_limit':'Explicit historical lineage, installed runtime, two paid Batch2 campaign databases, closure test store and prior API fixtures. No account-wide inventory. Separate repeatable-read transactions are not a cross-store atomic fence.'}
    old_grants = {s['identity']['database']:{g['id']:(g['active'],g['immutable_data_hash']) for g in s['grants']} for s in baseline['stores']}
    for snap in snapshots:
        events = snap.pop('events')
        snap['totals'],snap['unknowns'] = totals(events)
        snap['per_grant_accounting'] = {g['id']:totals([e for e in events if e['grant_id']==g['id']])[0] for g in snap['grants']}
        snap['carry_usd'] = str(sum((D(x['reserved_cost_usd']) for x in snap['carry']),D(0)))
        snap['local_reserved_plus_carry_usd'] = str(D(snap['totals']['reserved_cost_usd'])+D(snap['carry_usd']))
        db = snap['identity']['database']
        if db in old_grants:
            snap['official_grants_unchanged_since_Batch2_preflight'] = old_grants[db] == {g['id']:(g['active'],g['immutable_data_hash']) for g in snap['grants']}
        if snap.get('campaign'):
            assert len(snap['campaign']) == 1
            ancillary = D('.01')*(snap['totals']['counts']['count_send']+snap['totals']['counts']['read'])
            held = D(snap['totals']['reserved_cost_usd'])+ancillary
            snap['campaign_commitment_usd'] = str(held)
            snap['campaign_ancillary_usd'] = str(ancillary)
            snap['campaign_uncommitted_usd'] = str(D(snap['campaign'][0]['allocation'])-held)
        for e in events:
            key = e['identity_hash']
            if key in union:
                repeats += 1
                conflicts += union[key] != e
            else:
                union[key] = e
        result['stores'].append(snap)
    result['store_count'] = len(result['stores'])
    result['union_totals'],result['union_unknowns'] = totals(list(union.values()))
    result['deduplication'] = {'unique_events':len(union),'duplicate_event_copies':repeats,'conflicting_duplicate_events':conflicts,
                               'carry_rule':'Original leaf dispatch events included once; carry not added to union. Payload hashes compared as well as accounting fields.'}
    result['allocation'] = allocation_sources()
    carry_checks = []
    by_db = {s['identity']['database']:s for s in result['stores']}
    for s in result['stores']:
        for carry in s['carry']:
            source = by_db.get(carry['source_database'],{}).get('per_grant_accounting',{}).get(carry['source_grant_id'])
            carry_checks.append({'destination_database':s['identity']['database'],**carry,
                'source_dispatch_usd':source['reserved_cost_usd'] if source else None,
                'matches_source_dispatch':D(source['reserved_cost_usd'])==D(carry['reserved_cost_usd']) if source else None})
    result['carry_source_checks'] = carry_checks
    result['runtime_source'] = runtime_facts()
    result['costing'] = costs()
    result['ended_at'] = datetime.now(timezone.utc).isoformat()
    assert conflicts == 0
    write('current-reconciliation.json',result)
    write('proposed-tranche.json',result['costing'])
    if args.public_pricing:
        public_pricing()
    print(json.dumps({'report':str(OUT/'current-reconciliation.json'),'stores':result['store_count'],
                      'union':result['union_totals'],'deduplication':result['deduplication'],
                      'allocation':result['allocation']['retained_allocation_usd'],'costing':result['costing']['designs']},indent=2))

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Exception messages can contain credentials/DSNs; deliberately suppress them.
        print(json.dumps({'status':'failed_closed','error_type':type(exc).__name__}),file=sys.stderr)
        sys.exit(1)
