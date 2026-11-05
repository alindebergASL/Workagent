#!/usr/bin/env python3
"""Real disposable PostgreSQL tests; stdlib + PG binaries, no provider/network I/O.
Default starts a private cluster inside this lane; --sudo uses the local postgres
administrator via stdin, creating ONLY randomly named disposable DBs and a role.
Never accepts an existing study/installed database name. No alternate money gate.
"""
import argparse
import concurrent.futures
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import uuid

HERE = Path(__file__).resolve().parent
ISSUER = 'workagent_test_47b87fe3b82e'
PLAN = 'a' * 64
RESERVATION = {'reserved_input_tokens': 50000, 'reserved_output_tokens': 8192,
               'reserved_cost_usd': '0.206920', 'billed_cost_usd': None}


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def j(value):
    return q(json.dumps(value, separators=(',', ':'))) + '::jsonb'


class PG:
    def __init__(self, args):
        self.args = args
        self.prefix = ['sudo', '-n', '-u', 'postgres'] if args.sudo else []
        self.connect = ['-h', '/var/run/postgresql', '-p', '5432'] if args.sudo else []
        self.cluster = None
        self.started = False
        self.root = None
        self.created = []
        self.role = 'funding_runtime_' + uuid.uuid4().hex[:12]
        self.db = 'workagent_test_funding_' + uuid.uuid4().hex[:12]
        self.clone = self.db + '_clone'
        self.backup = self.db + '_original'
        self.role_created = False
        self.checks = []

    def binary(self, name):
        return str(Path(self.args.pg_bin) / name)

    def command(self, name, extra):
        return self.prefix + [self.binary(name)] + self.connect + extra

    def run(self, sql, db=None, runtime=False, expected=None):
        if runtime:
            sql = 'SET ROLE ' + self.role + ';\n' + sql
        result = subprocess.run(self.command('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                                '-d', db or self.db, '-f', '-']), input=sql, text=True,
                                capture_output=True, timeout=30)
        if expected:
            assert result.returncode != 0 and expected in result.stderr, (expected, result.stdout, result.stderr)
        else:
            assert result.returncode == 0, result.stderr
        return result.stdout.strip()

    def check(self, label):
        self.checks.append(label)
        print('PASS ' + label, flush=True)

    def start(self):
        if not self.args.sudo:
            self.root = Path(tempfile.mkdtemp(prefix='funding-pg-', dir=HERE))
            self.cluster = self.root / 'data'
            # Socket lives directly in lane to stay below Unix's 108-byte limit.
            self.connect = ['-h', str(HERE), '-p', str(self.args.port)]
            init = subprocess.run([self.binary('initdb'), '-D', str(self.cluster), '-A', 'trust', '--no-locale'],
                                  capture_output=True, text=True, timeout=30)
            if init.returncode:
                raise RuntimeError('initdb failed: ' + init.stderr)
            log = self.root / 'server.log'
            start = subprocess.run([self.binary('pg_ctl'), '-D', str(self.cluster), '-l', str(log),
                                    '-o', f"-c listen_addresses='' -k {HERE} -p {self.args.port}", '-w', 'start'],
                                   capture_output=True, text=True, timeout=30)
            if start.returncode:
                raise RuntimeError('PG startup blocked/failed: ' + log.read_text())
            self.started = True
        self.run('SELECT 1;', db='postgres')
        self.run('CREATE DATABASE ' + self.db + ';', db='postgres')
        self.created.append(self.db)
        self.run('CREATE ROLE ' + self.role + ' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;', db='postgres')
        self.role_created = True

    def close(self):
        if self.args.sudo or self.started:
            for db in self.created:
                self.run('DROP DATABASE IF EXISTS ' + db + ' WITH (FORCE);', db='postgres')
            if self.role_created:
                self.run('DROP ROLE ' + self.role + ';', db='postgres')
        if self.started:
            subprocess.run([self.binary('pg_ctl'), '-D', str(self.cluster), '-m', 'immediate', '-w', 'stop'],
                           capture_output=True, timeout=30, check=True)
        if self.root:
            shutil.rmtree(self.root)

    def step(self, aid, grant='g1', request_patch=None):
        metadata = {'request_id': 'request_' + aid, 'attempt_id': aid, 'step_id': 'selection'}
        req = {'model': 'gpt-6.1-sol', 'service_tier': 'default', 'metadata': metadata}
        if request_patch:
            req.update(request_patch)
        body = json.dumps(req, separators=(',', ':'))
        digest = hashlib.sha256(body.encode()).hexdigest()
        self.run(f"INSERT INTO public.responses_steps VALUES ({q(aid)},'selection',{q(grant)},"
                 f"{q(body)},{q(digest)},'{{}}',{q(hashlib.sha256(b'{}').hexdigest())},{j(metadata)});", runtime=True)
        return {'metadata': metadata, 'request_sha256': digest,
                'response_id': 'resp_' + aid,
                'provenance': {'mode': 'official_api', 'origin': 'https://api.openai.com'}}

    def event(self, aid, kind, data=None, expected=None, db=None):
        sql = self.event_sql(aid, kind, data)
        return self.run(sql, runtime=True, expected=expected, db=db)

    @staticmethod
    def event_sql(aid, kind, data=None):
        return ("INSERT INTO public.responses_events(id,attempt_id,phase,kind,data) VALUES ("
                f"{q(uuid.uuid4().hex)},{q(aid)},'selection',{q(kind)},{j(data or {})});")

    def cert(self, ident, amount, expected=None, **kw):
        target = kw.get('target', self.db)
        issuer = kw.get('issuer', ISSUER)
        binding = kw.get('binding', '(SELECT binding_sha256 FROM study_funding.binding)')
        self.run(f"SELECT study_funding.install_certificate({q(ident)},{q(issuer)},"
                 f"{kw.get('oid', 7704275)},{q(target)},{binding},{q(amount)}::numeric);", expected=expected)

    def cost(self, aid):
        return self.run("SELECT study_funding.retained_cost(e)::text FROM public.responses_events e "
                        f"WHERE e.attempt_id={q(aid)} AND e.kind='dispatch';")

    def terminal(self, aid, base, patch=None):
        self.event(aid, 'identity', base)
        result = {**copy.deepcopy(base), 'state': 'completed',
                  'usage': {'input_tokens': 100, 'output_tokens': 20, 'total_tokens': 120,
                            'cached_input_tokens': 80, 'reasoning_tokens': 10}}
        if patch:
            patch(result)
        self.event(aid, 'result', result)
        return result


def verify(pg):
    # Columns/types exactly from migrations 004/006; external FKs and existing
    # product guards intentionally omitted: this isolates the additive gate.
    pg.run('''CREATE TABLE public.provider_grants (
 id text PRIMARY KEY, workspace_id text NOT NULL, principal_id text NOT NULL,
 active boolean NOT NULL DEFAULT true, data jsonb NOT NULL);
CREATE TABLE public.responses_steps (
 attempt_id text NOT NULL, phase text NOT NULL, grant_id text NOT NULL REFERENCES public.provider_grants(id),
 request_bytes text NOT NULL, request_sha256 text NOT NULL, count_bytes text NOT NULL,
 count_sha256 text NOT NULL, metadata jsonb NOT NULL, PRIMARY KEY(attempt_id,phase));
CREATE TABLE public.responses_events (
 id text PRIMARY KEY, attempt_id text NOT NULL, phase text NOT NULL, kind text NOT NULL,
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(attempt_id,phase) REFERENCES public.responses_steps(attempt_id,phase));
CREATE UNIQUE INDEX responses_one_event ON public.responses_events(attempt_id,phase,kind)
 WHERE kind NOT IN ('read','cancel');''')
    pg.run(f'GRANT USAGE ON SCHEMA public TO {pg.role}; GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA public TO {pg.role};')
    for n in range(1, 3):
        data = {'id': f'g{n}', 'workspace_id': f'w{n}', 'model': 'gpt-6.1-sol',
                'responses': {'project_id': 'proj_study', 'transport_mode': 'official_api', 'cost_limit_usd': '12'}}
        pg.run(f"INSERT INTO public.provider_grants VALUES ('g{n}','w{n}','p',true,{j(data)});")
    pg.step('original')
    pg.event('original', 'count_result', {'synthetic_fixture_original': True})
    inventory = "SELECT md5(string_agg(to_jsonb(e)::text,'' ORDER BY id)) FROM public.responses_events e WHERE attempt_id='original';"
    before = pg.run(inventory)
    for objects in ['TABLES', 'FUNCTIONS', 'SCHEMAS']:
        pg.run(f'ALTER DEFAULT PRIVILEGES GRANT ALL ON {objects} TO {pg.role};')
    pg.run((HERE / 'recipient_funding.sql').read_text())
    for objects in ['TABLES', 'FUNCTIONS', 'SCHEMAS']:
        pg.run(f'ALTER DEFAULT PRIVILEGES REVOKE ALL ON {objects} FROM {pg.role};')
    assert pg.run(inventory) == before
    pg.check('install preserves original rows')
    bind = (f"SELECT study_funding.bind_exact('{PLAN}','proj_study',"
            "(SELECT jsonb_object_agg(id,md5(data::text)) FROM public.provider_grants));")
    h = pg.run(bind)
    assert pg.run(bind) == h
    pg.run(bind.replace(PLAN, 'b' * 64), expected='binding_replay_mismatch')
    pg.step('inactive')
    for kind in ['count_send', 'dispatch', 'read', 'cancel']:
        pg.event('inactive', kind, RESERVATION if kind == 'dispatch' else {}, expected='funding_inactive')
    pg.check('no certificates denies all four operations; binding retry exact')
    for amount in ['0', '-1', 'NaN', 'Infinity', '-Infinity']:
        pg.cert('invalid_' + amount, amount, expected='violates check constraint')
    pg.cert('bad_source', '1', issuer='other', expected='violates check constraint')
    pg.cert('bad_oid', '1', oid=123, expected='violates check constraint')
    pg.cert('bad_target', '1', target=pg.db + '_other', expected='certificate_target_mismatch')
    pg.cert('bad_hash', '1', binding=q('b' * 64), expected='certificate_target_mismatch')
    pg.check('nonfinite/negative/zero credit and wrong issuer/target denied')
    # Small synthetic certificates exercise exact boundaries; study issuance is
    # parent-owned incremental phases. This fixture does not issue real authority.
    pg.cert('initial', '0.206920')
    pg.cert('initial', '0.206920')
    pg.cert('initial', '1', expected='certificate_replay_mismatch')
    assert pg.run('SELECT count(*) FROM study_funding.certificates;') == '1'
    pg.check('exact activation retry adds nothing; changed arguments rejected')
    base = pg.step('known')
    for kind in ['count_send', 'dispatch', 'read', 'cancel']:
        pg.event('known', kind, RESERVATION if kind == 'dispatch' else {})
    pg.step('next', 'g2')
    pg.event('next', 'dispatch', RESERVATION, expected='recipient_funding_exhausted')
    assert pg.cost('known') == '0.206920'
    result = pg.terminal('known', base)
    assert pg.run("SELECT study_funding.retained_cost(e)=0.000450 FROM public.responses_events e WHERE attempt_id='known' AND kind='dispatch';") == 't'
    pg.cert('exact_usage', '0.000450')
    pg.event('next', 'dispatch', RESERVATION)
    pg.check('bound activation; missing outcome fully retained; exact terminal conservative release across grants')
    pg.event('known', 'result', result, expected='duplicate_funding_receipt')
    pg.event('next', 'identity', {**base, 'metadata': {'request_id': 'request_next', 'attempt_id': 'next', 'step_id': 'selection'}}, expected='duplicate_funding_receipt')
    pg.event('known', 'dispatch', RESERVATION, expected='duplicate_dispatch')
    pg.check('duplicate result/response identity/dispatch rejected')
    # Runtime ACLs plus owner immutability. No runtime access to helper APIs.
    for sql in ["INSERT INTO study_funding.binding DEFAULT VALUES;",
                "INSERT INTO study_funding.certificates DEFAULT VALUES;",
                "UPDATE study_funding.certificates SET amount_usd=100;",
                "DELETE FROM study_funding.certificates;", "TRUNCATE study_funding.certificates;",
                "SELECT study_funding.bind_exact(NULL,NULL,NULL);",
                "SELECT study_funding.install_certificate('x','x',1,'x','x',1);"]:
        pg.run(sql, runtime=True, expected='permission denied')
    for table in ['study_funding.binding', 'study_funding.certificates', 'public.responses_events', 'public.responses_steps']:
        pg.run('TRUNCATE ' + table + ' CASCADE;', expected='immutable_funding_evidence')
        pg.run('DELETE FROM ' + table + ';', expected='immutable_funding_evidence')
    pg.run('ALTER TABLE public.responses_events DISABLE TRIGGER zz_study_funding;', runtime=True, expected='must be owner')
    assert pg.run("SELECT tgenabled FROM pg_trigger WHERE tgname='zz_study_funding';") == 'A'
    pg.check('default ACLs scrubbed; runtime mutation/trigger disable denied; immutable history; ALWAYS trigger')
    # Scope adversaries via temporary owner changes, rolled back, never ledger rewrites.
    for field, value in [('project_id', 'proj_other'), ('transport_mode', 'synthetic')]:
        pg.run(f"BEGIN; UPDATE public.provider_grants SET data=jsonb_set(data,'{{responses,{field}}}',{j(value)}) WHERE id='g1';"
               f"SET ROLE {pg.role};" + pg.event_sql('known', 'read') + 'ROLLBACK;', expected='funding_scope_mismatch')
    pg.run("INSERT INTO public.provider_grants SELECT 'unauthorized','w9','p',true,data FROM public.provider_grants WHERE id='g1';")
    pg.step('unbound', 'unauthorized')
    pg.event('unbound', 'count_send', expected='funding_scope_mismatch')
    pg.run('BEGIN ISOLATION LEVEL REPEATABLE READ;' + pg.event_sql('known', 'read') + 'COMMIT;', runtime=True, expected='read_committed_required')
    pg.check('grant/project/source mismatch and stale isolation denied')
    # Enough synthetic capacity for negative receipt fixtures; all unknown usage
    # is asserted by the actual SQL projection, with no Python money accounting.
    pg.cert('negative_cases', '10')
    cases = [
        ('malformed_state', lambda r: r.update(state='malformed')),
        ('missing_usage', lambda r: r.pop('usage')),
        ('missing_total', lambda r: r['usage'].pop('total_tokens')),
        ('negative', lambda r: r['usage'].update(input_tokens=-1)),
        ('fractional', lambda r: r['usage'].update(input_tokens=0.5)),
        ('string_nan', lambda r: r['usage'].update(input_tokens='NaN')),
        ('over_input', lambda r: r['usage'].update(input_tokens=50001, total_tokens=50021)),
        ('over_output', lambda r: r['usage'].update(output_tokens=8193, total_tokens=8293)),
        ('total', lambda r: r['usage'].update(total_tokens=121)),
        ('cached', lambda r: r['usage'].update(cached_input_tokens=101)),
        ('reasoning', lambda r: r['usage'].update(reasoning_tokens=21)),
        ('origin', lambda r: r['provenance'].update(origin='https://example.invalid')),
        ('source', lambda r: r['provenance'].update(mode='synthetic')),
        ('hash', lambda r: r.update(request_sha256='f' * 64)),
        ('metadata', lambda r: r['metadata'].update(request_id='other')),
        ('identity', lambda r: r.update(response_id='resp_other')),
    ]
    for aid, patch in cases:
        base = pg.step(aid)
        pg.event(aid, 'dispatch', RESERVATION)
        pg.terminal(aid, base, patch)
        assert pg.cost(aid) == '0.206920', aid
    for aid, patch in [('bad_model', {'model': 'other'}), ('bad_tier', {'service_tier': 'priority'})]:
        base = pg.step(aid, request_patch=patch)
        pg.event(aid, 'dispatch', RESERVATION)
        pg.terminal(aid, base)
        assert pg.cost(aid) == '0.206920', aid
    for aid, change in [('bad_identity_provenance', lambda b: b['provenance'].update(mode='synthetic')),
                        ('bad_identity_metadata', lambda b: b['metadata'].update(request_id='other'))]:
        base = pg.step(aid)
        pg.event(aid, 'dispatch', RESERVATION)
        result = {**copy.deepcopy(base), 'state': 'completed',
                  'usage': {'input_tokens': 100, 'output_tokens': 20, 'total_tokens': 120,
                            'cached_input_tokens': 0, 'reasoning_tokens': 0}}
        change(base)
        pg.event(aid, 'identity', base)
        pg.event(aid, 'result', result)
        assert pg.cost(aid) == '0.206920', aid
    base = pg.step('no_identity')
    pg.event('no_identity', 'dispatch', RESERVATION)
    pg.event('no_identity', 'result', {**base, 'state': 'completed',
        'usage': {'input_tokens': 0, 'output_tokens': 0, 'total_tokens': 0,
                  'cached_input_tokens': 0, 'reasoning_tokens': 0}})
    assert pg.cost('no_identity') == '0.206920'
    pg.check('21 unsupported terminal receipt cases retain full reservation')
    base = pg.step('valid_function')
    pg.event('valid_function', 'dispatch', RESERVATION)
    pg.terminal('valid_function', base, lambda r: r.update(state='function_call'))
    assert pg.run("SELECT study_funding.retained_cost(e)=0.000450 FROM public.responses_events e WHERE attempt_id='valid_function' AND kind='dispatch';") == 't'
    pg.check('function_call terminal supports same conservative price as completed')
    for amount in ['NaN', 'Infinity', '-Infinity', '-1', '0']:
        pg.event('inactive', 'dispatch', {**RESERVATION, 'reserved_cost_usd': amount}, expected='exact_reservation_required')
    # Use SQL to fill remaining capacity with normal-sized unknown dispatches.
    # Then issue just enough synthetic certificate for one, not two, dispatches.
    pg.run("""DO $$ DECLARE n integer:=0; BEGIN LOOP
      EXIT WHEN (SELECT sum(amount_usd) FROM study_funding.certificates)-
        (SELECT sum(study_funding.retained_cost(e)) FROM public.responses_events e WHERE kind='dispatch')<0.206920;
      n=n+1;
      INSERT INTO public.responses_steps SELECT 'fill_'||n,phase,grant_id,request_bytes,request_sha256,count_bytes,count_sha256,metadata
        FROM public.responses_steps WHERE attempt_id='next';
      INSERT INTO public.responses_events(id,attempt_id,phase,kind,data)
        SELECT 'fill_event_'||n,'fill_'||n,'selection','dispatch',data FROM public.responses_events WHERE attempt_id='next' AND kind='dispatch';
    END LOOP; END $$;""")
    pg.run(f"""SELECT study_funding.install_certificate('race_topup','{ISSUER}',7704275,current_database(),
      (SELECT binding_sha256 FROM study_funding.binding),0.206920-
      ((SELECT sum(amount_usd) FROM study_funding.certificates)-
       (SELECT sum(study_funding.retained_cost(e)) FROM public.responses_events e WHERE kind='dispatch')));""")
    pg.step('race_a', 'g1'); pg.step('race_b', 'g2')
    barrier = threading.Barrier(2)
    def racer(aid):
        barrier.wait(timeout=5)
        sql = f'SET ROLE {pg.role}; BEGIN;' + pg.event_sql(aid, 'dispatch', RESERVATION) + 'SELECT pg_sleep(0.3); COMMIT;'
        return subprocess.run(pg.command('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', pg.db, '-f', '-']),
                              input=sql, text=True, capture_output=True, timeout=15)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(racer, ['race_a', 'race_b']))
    assert sum(x.returncode == 0 for x in outcomes) == 1, [(x.returncode, x.stderr) for x in outcomes]
    assert any('recipient_funding_exhausted' in x.stderr for x in outcomes)
    assert pg.run("SELECT count(*) FROM public.responses_events WHERE attempt_id IN ('race_a','race_b');") == '1'
    pg.check('two real concurrent dispatch transactions near cap: exactly one commits')
    assert pg.run(inventory) == before
    pg.check('original rows still byte-equivalent after all adversarial tests')
    # Genuine logical dump/restore, not a mocked identity function.
    dump = subprocess.run(pg.command('pg_dump', ['--no-owner', '--no-privileges', '-d', pg.db]),
                          capture_output=True, timeout=30, check=True).stdout
    pg.run('CREATE DATABASE ' + pg.clone + ';', db='postgres'); pg.created.append(pg.clone)
    pg.run(dump.decode(), db=pg.clone)
    pg.run(f'GRANT USAGE ON SCHEMA public TO {pg.role}; GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA public TO {pg.role};', db=pg.clone)
    pg.event('known', 'read', db=pg.clone, expected='funding_scope_mismatch')
    pg.run(f'ALTER DATABASE {pg.db} RENAME TO {pg.backup};', db='postgres')
    pg.created.remove(pg.db); pg.created.append(pg.backup)
    pg.run(f'ALTER DATABASE {pg.clone} RENAME TO {pg.db};', db='postgres')
    pg.created.remove(pg.clone); pg.created.append(pg.db)
    pg.event('known', 'read', expected='funding_scope_mismatch')
    pg.check('logical restored clone denied both different name and canonical name with different OID')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sudo', action='store_true', help='local postgres via sudo -n; SQL always stdin')
    parser.add_argument('--pg-bin', default='/usr/lib/postgresql/16/bin')
    parser.add_argument('--port', type=int, default=55439, help='private cluster Unix socket suffix')
    args = parser.parse_args()
    pg = PG(args)
    try:
        pg.start()
        verify(pg)
        print(json.dumps({'status': 'PASS', 'checks': pg.checks, 'provider_calls': 0,
                          'fixture': 'minimal real PG tables; not full application integration',
                          'sql_sha256': hashlib.sha256((HERE / 'recipient_funding.sql').read_bytes()).hexdigest()}, indent=2))
    except Exception as exc:
        print(json.dumps({'status': 'FAILED_OR_NOT_RUN', 'passed_checks': pg.checks, 'error': str(exc)}, indent=2))
        raise
    finally:
        pg.close()


if __name__ == '__main__':
    main()
