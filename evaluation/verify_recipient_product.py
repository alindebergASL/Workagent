"""Disposable full-product recipient gate tests. NEVER contacts a provider.

Only this verifier and its task-local evidence are authored by this subtask.
The real GeneralWorker, ResponsesTransport, Service, ledger, all migrations, and
restricted runtime role are exercised. HTTPTransport.handle_request is replaced
ONLY in this process by a deterministic fixture. Official grant metadata and
transport construction checks are NOT replaced. Dummy route/issuer evidence is
synthetic, installed only by the owner of freshly provisioned disposable DBs;
it is neither real issuer issuance nor verified provider availability/billing.

Run: backend/.venv/bin/python evaluation/verify_recipient_product.py
Every invocation creates exclusive evidence and fresh DBs; failures are retained.
No study/issuer DB, release lock, credential file, or existing binding is read.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json
import os
from pathlib import Path
import socket
import sys
import threading
import traceback
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.local/batch3/b35c/recipient-product'
SQL = ROOT / 'evaluation/recipient_funding.sql'
sys.path[:0] = [str(ROOT / 'backend')]

import httpx
import psycopg
from psycopg.types.json import Jsonb
from dev_db import provision
from workagent.db import Database
from workagent.fixture import seed
from workagent.general_responses import AUTHORIZATION_HASH, consumer_hash
from workagent.general_schema import EXPLANATION_SCHEMA
from workagent.composition import POLICY, DECISION_SCHEMA
from workagent.general_worker import GeneralWorker
from workagent.models import (CreateConversation, GeneralAlphaResponsesBinding,
                              PostMessage, ProviderGrant, new_id)
from workagent.provider_attempts import configure_grant
from workagent.responses_transport import ResponsesTransport
from workagent.service import Principal, Service

PROJECT = 'proj_recipient_product_fixture'
REFERENCE = 'file:/synthetic/recipient-product-never-read'
RESERVATION = Decimal('0.206920')
ANSWER = 'Synthetic fixture: preserve uncertainty and make no external changes.'


def save(path, value):
    with path.open('x') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, indent=2, sort_keys=True, default=str)
        stream.write('\n')


def cmd(cls, **kwargs):
    return cls(schema_version='workagent/v1', request_id=new_id(), command_id=new_id(), **kwargs)


class Wire:
    """No-network HTTP boundary; never supplied as real model output evidence."""
    def __init__(self, lose=False):
        self.lose = lose
        self.calls = []
        self.lock = threading.Lock()

    def handle(self, request):
        assert request.url.host == 'api.openai.com'
        assert request.headers['OpenAI-Project'] == PROJECT
        assert request.headers['Authorization'] == 'Bearer not-a-provider-credential'
        assert request.method == 'POST'
        payload = json.loads(request.content)
        count = request.url.path == '/v1/responses/input_tokens'
        assert count or request.url.path == '/v1/responses'
        record = dict(method=request.method, path=request.url.path,
                      request_sha256=sha256(request.content).hexdigest(),
                      metadata=payload.get('metadata'), synthetic_fixture=True)
        with self.lock:
            self.calls.append(record)
            number = len(self.calls)
        if count:
            return httpx.Response(200, json={'object': 'response.input_tokens', 'input_tokens': 700})
        assert payload['max_output_tokens'] == 8192
        assert payload['model'] == 'gpt-6.1-sol' and payload['service_tier'] == 'default'
        if self.lose:
            raise httpx.ReadError('controlled unknown create outcome')
        if payload['metadata']['step_id'] == 'final':
            output = [{'type': 'message', 'role': 'assistant', 'content': [
                {'type': 'output_text', 'text': json.dumps({'text': ANSWER})}]}]
        else:
            output = [{'type': 'function_call', 'name': 'choose_general_action',
                       'call_id': 'call_fixture_' + str(number), 'arguments': json.dumps({
                           'goal': 'Exercise a disposable integration fixture',
                           'success_criteria': [], 'decision': {'kind': 'reply', 'text': ANSWER}})}]
        return httpx.Response(200, json={
            'id': 'resp_fixture_' + str(number), 'object': 'response',
            'model': 'gpt-6.1-sol', 'service_tier': 'default', 'metadata': payload['metadata'],
            'status': 'completed', 'error': None, 'output': output,
            'usage': {'input_tokens': 700, 'output_tokens': 200, 'total_tokens': 900,
                      'input_tokens_details': {'cached_tokens': 0},
                      'output_tokens_details': {'reasoning_tokens': 50}}})


class Fixture:
    def __init__(self, directory, funding=True):
        self.directory = directory
        directory.mkdir(mode=0o700)
        envfile = directory / 'fresh.private.env'
        self.name = provision(envfile)
        env = dict(line.removeprefix('export ').split('=', 1)
                   for line in envfile.read_text().splitlines())
        self.owner = Database(env['MIGRATION_DATABASE_URL'])
        self.runtime = Database(env['DATABASE_URL'])
        self.service = Service(self.runtime)
        self.runtime.check_runtime_role()
        self.principal = Principal('local-human')
        self.workspaces = ['recipient-fixture-' + new_id() for _ in range(2)]
        self.cvs = []
        self.transports = []
        records = json.loads((ROOT / 'fixtures/actor/solo-v0.1/initial_records.json').read_text())
        for ws in self.workspaces:
            seed(self.owner.dsn, records, ws, self.principal.id)
            self.cvs.append(self.service.create_conversation(self.principal, ws, cmd(CreateConversation)))
        for ws, cv in zip(self.workspaces, self.cvs):
            binding = GeneralAlphaResponsesBinding(
                project_id=PROJECT, secret_reference=REFERENCE, transport_mode='official_api',
                instructions_sha256=sha256(POLICY.encode()).hexdigest(),
                schema_sha256=sha256(EXPLANATION_SCHEMA.material).hexdigest(),
                scope_tool_sha256=sha256(DECISION_SCHEMA.material).hexdigest(),
                authorization_sha256=AUTHORIZATION_HASH, runtime_extension='general-alpha-v1',
                continuity_version='sustained-v1', max_steps=8,
                generation_limit=256, count_limit=256, read_limit=4096,
                input_limit=12800000, output_limit=2097152, cost_limit_usd='12.00',
                conversation_ids=[cv.id])
            grant = ProviderGrant(id=new_id(), workspace_id=ws, principal_id=self.principal.id,
                                  profile='general-responses-v1', model='gpt-6.1-sol',
                                  consumer_sha256=consumer_hash(), expires_at=None,
                                  max_runs=10, max_received_output_tokens=16384, responses=binding)
            # Explicit synthetic setup; no actual route record is read/rebound.
            route = {'grant_id': grant.id, 'runtime': {
                'profile': grant.profile, 'model': grant.model,
                'product_project_id': PROJECT, 'secure_secret_reference': REFERENCE},
                'verification': {'checked_at': datetime.now(timezone.utc).isoformat(),
                    'model': grant.model, 'official_origin': 'https://api.openai.com',
                    'account_available': True, 'model_available': True,
                    'synthetic_context_confirmed': True, 'service_tier': 'default',
                    'store_acknowledged': True, 'input_usd_per_million': '2.5',
                    'output_usd_per_million': '10', 'authorization_sha256': AUTHORIZATION_HASH}}
            configure_grant(self.owner, grant, route_record=route)
        with self.owner.transaction() as c:
            self.grants = c.execute('SELECT id,workspace_id,data,md5(data::text) hash FROM provider_grants ORDER BY id').fetchall()
        assert len(self.grants) == 2
        if funding:
            with psycopg.connect(self.owner.dsn, autocommit=True) as c:
                c.execute(SQL.read_text())
            with self.owner.transaction() as c:
                self.binding = c.execute('SELECT study_funding.bind_exact(%s,%s,%s) hash',
                    (sha256(b'disposable-recipient-product-test-plan').hexdigest(), PROJECT,
                     Jsonb({g['id']: g['hash'] for g in self.grants}))).fetchone()['hash']
            self.schema_evidence()

    def schema_evidence(self):
        expected = {p.name: sha256(p.read_bytes()).hexdigest()
                    for p in (ROOT / 'backend/migrations').glob('*.sql')}
        with self.owner.transaction() as c:
            applied = {r['name']: r['checksum'] for r in c.execute('SELECT name,checksum FROM schema_migrations').fetchall()}
            assert applied == expected
            tables = [r['tablename'] for r in c.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()]
            triggers = c.execute("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='responses_events'::regclass AND NOT tgisinternal ORDER BY tgname").fetchall()
            assert any(t['tgname'] == 'zz_study_funding' and t['tgenabled'] == 'A' for t in triggers)
        with self.runtime.transaction() as c:
            role = c.execute('SELECT current_user name,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user').fetchone()
            assert not any(role[k] for k in ('rolsuper','rolbypassrls','rolcreatedb','rolcreaterole'))
        try:
            with self.runtime.transaction() as c:
                c.execute('SELECT study_funding.install_certificate(%s,%s,%s,%s,%s,%s)',
                          ('forbidden', 'workagent_test_47b87fe3b82e', 7704275, self.name, self.binding, Decimal('1')))
        except psycopg.errors.InsufficientPrivilege:
            denied = True
        else:
            raise AssertionError('runtime unexpectedly has certificate installation authority')
        save(self.directory / 'schema-and-role.json', dict(
            database=self.name, migrations=applied, migration_count=len(applied), tables=tables,
            table_count=len(tables), runtime_role=role, triggers=triggers,
            runtime_certificate_install_denied=denied, grant_hashes={g['id']: g['hash'] for g in self.grants}))

    def activate(self, amount):
        # Synthetic owner trust only. Never connects to the named issuer database.
        with self.owner.transaction() as c:
            c.execute('SELECT study_funding.install_certificate(%s,%s,%s,%s,%s,%s)',
                      ('fixture-only-never-issued', 'workagent_test_47b87fe3b82e', 7704275,
                       self.name, self.binding, Decimal(amount)))
        with self.owner.transaction() as c:
            row = c.execute('SELECT amount_usd,target_database,target_binding_sha256 FROM study_funding.certificates').fetchone()
            assert row == dict(amount_usd=Decimal(amount), target_database=self.name,
                               target_binding_sha256=self.binding)

    def post(self, i):
        return self.service.post_message(self.principal, self.workspaces[i], self.cvs[i].id,
            cmd(PostMessage, expected_work_version=self.cvs[i].work_version,
                text='Exercise only this synthetic funding test. Do not use network tools.'))

    def worker(self, hook=None):
        transport = ResponsesTransport(credential='not-a-provider-credential', project_id=PROJECT,
                                       credential_reference=REFERENCE, enabled=True)
        assert transport.matches_binding('official_api', PROJECT, REFERENCE)
        transport._client.timeout = httpx.Timeout(0.1)  # in-process no-network fixture only
        self.transports.append(transport)
        return GeneralWorker(Service(Database(self.runtime.dsn)), transport=transport,
                             enable_responses=True, state=self.directory / 'private-worker-state',
                             poll_limit=0, hook=hook)

    def run(self, i, run, hook=None):
        return self.worker(hook).work(self.principal, self.workspaces[i], run.id)

    def expire(self, i, run):
        with self.owner.transaction() as c:
            c.execute("UPDATE runs SET data=jsonb_set(data,'{lease_expires_at}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE workspace_id=%s AND id=%s",
                      (self.workspaces[i], run.id))

    def snapshot(self):
        with self.owner.transaction() as c:
            grants = c.execute('SELECT id,workspace_id,data,md5(data::text) hash FROM provider_grants ORDER BY id').fetchall()
            assert grants == self.grants, 'official grant metadata changed'
            events = c.execute('SELECT id,attempt_id,phase,kind,data FROM responses_events ORDER BY id').fetchall()
            retained = c.execute("SELECT coalesce(sum(study_funding.retained_cost(e)),0) total FROM responses_events e WHERE kind='dispatch'").fetchone()['total']
            certificates = c.execute('SELECT count(*) n,coalesce(sum(amount_usd),0) amount FROM study_funding.certificates').fetchone()
            attempts = c.execute('SELECT id,workspace_id,data FROM provider_attempts ORDER BY id').fetchall()
            steps = c.execute('SELECT attempt_id,phase,grant_id,request_sha256,metadata,request_bytes FROM responses_steps ORDER BY attempt_id,phase').fetchall()
        for e in events:
            if e['kind'] == 'dispatch':
                assert e['data']['reserved_input_tokens'] == 50000
                assert e['data']['reserved_output_tokens'] == 8192
                assert Decimal(str(e['data']['reserved_cost_usd'])) == RESERVATION
        return dict(events=events, steps=steps, attempts=attempts, retained=retained,
                    certificates=certificates, official_grants_unchanged=True)

    def close(self):
        for transport in self.transports:
            transport.close()


def kinds(snapshot, kind):
    return [e for e in snapshot['events'] if e['kind'] == kind]


def inactive_then_activated(f, wire):
    q = f.post(0)
    try:
        f.run(0, q.run)
    except psycopg.errors.RaiseException as error:
        assert 'funding_inactive' in str(error), str(error)
    else:
        raise AssertionError('inactive recipient did not deny the product worker')
    denied = f.snapshot()
    assert not wire.calls and not denied['events']
    assert denied['certificates']['n'] == 0
    save(f.directory / 'inactive-denial.json', dict(snapshot=denied, wire_calls=wire.calls, denial='funding_inactive'))
    f.activate('0.220000')
    f.expire(0, q.run)
    result = f.run(0, q.run)
    assert result.state == 'ready', result.state
    after = f.snapshot()
    assert len(kinds(after, 'dispatch')) == 2
    assert len(kinds(after, 'count_send')) == len(kinds(after, 'count_result')) == 2
    assert len(kinds(after, 'identity')) == len(kinds(after, 'result')) == 2
    assert after['retained'] == Decimal('0.007500')
    # The second normal reservation fits ONLY because the first exact receipt is
    # recognized: 2*0.206920 exceeds 0.220000; 0.003750+0.206920 does not.
    assert RESERVATION * 2 > after['certificates']['amount']
    for event in kinds(after, 'result'):
        assert event['data']['provenance'] == {'mode': 'official_api', 'origin': 'https://api.openai.com'}
        step = next(s for s in after['steps'] if (s['attempt_id'], s['phase']) == (event['attempt_id'], event['phase']))
        assert event['data']['request_sha256'] == step['request_sha256']
        assert event['data']['metadata'] == step['metadata']
    detail = f.service.get_conversation(f.principal, f.workspaces[0], f.cvs[0].id)
    assert detail.messages[-1].text == ANSWER and detail.turns[0].state == 'replied'
    before_calls = list(wire.calls)
    assert f.run(0, q.run).state == 'ready'
    assert wire.calls == before_calls
    assert f.snapshot() == after
    return dict(ready=True, count_calls=2, create_calls=2, retained_usd=after['retained'],
                restart_no_duplicate=True, snapshot=after)


def unknown_and_restart(f, wire):
    f.activate('0.206920')
    q = f.post(0)
    assert f.run(0, q.run).state == 'running'
    after = f.snapshot()
    assert len(kinds(after, 'dispatch')) == len(kinds(after, 'count_send')) == 1
    assert not kinds(after, 'identity') and not kinds(after, 'result')
    assert after['retained'] == RESERVATION
    assert after['attempts'][0]['data']['state'] == 'outcome_unknown'
    before_calls = list(wire.calls)
    f.expire(0, q.run)
    assert f.run(0, q.run).state == 'running'
    restarted = f.snapshot()
    assert wire.calls == before_calls and restarted['events'] == after['events']
    assert restarted['retained'] == RESERVATION
    return dict(unknown_retained=True, restart_no_duplicate=True,
                count_calls=1, create_calls=1, snapshot=restarted)


def concurrent_near_cap(f, wire):
    f.activate('0.206920')
    queued = [f.post(i) for i in range(2)]
    barrier = threading.Barrier(2, timeout=30)
    def hook(name):
        if name == 'after_count':
            barrier.wait()
    def run(i):
        try:
            return dict(workspace=f.workspaces[i], state=f.run(i, queued[i].run, hook).state)
        except psycopg.errors.RaiseException as error:
            if 'recipient_funding_exhausted' not in str(error):
                raise
            return dict(workspace=f.workspaces[i], denied='recipient_funding_exhausted')
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(run, range(2)))
    assert sum(o.get('state') == 'running' for o in outcomes) == 1, outcomes
    assert sum(o.get('denied') == 'recipient_funding_exhausted' for o in outcomes) == 1, outcomes
    after = f.snapshot()
    assert len(kinds(after, 'dispatch')) == 1
    assert len(kinds(after, 'count_send')) == len(kinds(after, 'count_result')) == 2
    assert after['retained'] == after['certificates']['amount'] == RESERVATION
    assert sum(call['path'] == '/v1/responses' for call in wire.calls) == 1
    assert len({a['workspace_id'] for a in after['attempts']}) == 2
    assert not kinds(after, 'identity') and not kinds(after, 'result')
    before_calls = list(wire.calls)
    for i, outcome in enumerate(outcomes):
        f.expire(i, queued[i].run)
        if outcome.get('state') == 'running':
            assert f.run(i, queued[i].run).state == 'running'
        else:
            try:
                f.run(i, queued[i].run)
            except psycopg.errors.RaiseException as error:
                assert 'recipient_funding_exhausted' in str(error)
            else:
                raise AssertionError('exhausted recipient admitted after restart')
    assert wire.calls == before_calls
    restarted = f.snapshot()
    assert restarted['events'] == after['events'] and restarted['retained'] == RESERVATION
    return dict(outcomes=outcomes, count_calls=2, create_calls=1, restart_no_duplicate=True,
                near_cap_enforced_across_workspaces=True, snapshot=restarted)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', default='run')
    args = parser.parse_args()
    if not args.label.replace('-', '').replace('_', '').isalnum():
        parser.error('label must contain only letters/digits/hyphens/underscores')
    directory = OUT / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + args.label + '-' + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True, mode=0o700)
    summary = dict(scope='disposable full current product schema; no live provider or issuer execution',
                   evidence=str(directory.relative_to(ROOT)), scenarios=[],
                   synthetic_route_and_certificate=True, official_metadata_simulated_on_wire=True,
                   network_provider_calls=0, grants_per_database=2, raw_ceiling_usd='12.00',
                   reservation=dict(input_tokens=50000, output_tokens=8192, usd=str(RESERVATION)))
    if not SQL.is_file():
        summary.update(status='FAIL', blocker='evaluation/recipient_funding.sql missing')
        save(directory / 'summary.json', summary)
        print(json.dumps(summary, indent=2))
        return 1
    summary['sql_sha256'] = sha256(SQL.read_bytes()).hexdigest()
    summary['verifier_sha256'] = sha256(Path(__file__).read_bytes()).hexdigest()
    original_connect = socket.socket.connect
    attempts = []
    def local_only(sock, address):
        # Python HTTP/other outbound calls are blocked independently of the wire
        # fixture. psycopg uses local libpq; provisioning is local sudo/psql.
        if not isinstance(address, tuple) or address[0] not in ('127.0.0.1', '::1'):
            attempts.append(repr(address))
            raise AssertionError('nonlocal socket blocked by recipient verifier')
        return original_connect(sock, address)
    for name, fn, lose in [('inactive-activated', inactive_then_activated, False),
                           ('unknown-restart', unknown_and_restart, True),
                           ('cross-workspace-concurrency', concurrent_near_cap, True)]:
        fixture = None
        wire = Wire(lose=lose)
        result = dict(name=name)
        try:
            fixture = Fixture(directory / name)
            result['database'] = fixture.name
            with ExitStack() as stack:
                stack.enter_context(patch.object(socket.socket, 'connect', local_only))
                stack.enter_context(patch.object(httpx.HTTPTransport, 'handle_request', lambda _, request: wire.handle(request)))
                result['checks'] = fn(fixture, wire)
            assert not attempts, 'unexpected network attempt blocked'
            result['status'] = 'PASS'
        except Exception as error:
            result.update(status='FAIL', exception_type=type(error).__name__, error=str(error))
            # No DSNs in normal exception messages; redact explicitly anyway.
            tb = traceback.format_exc()
            if fixture:
                for dsn in (fixture.owner.dsn, fixture.runtime.dsn):
                    tb = tb.replace(dsn, '<redacted disposable DSN>')
                try:
                    result['failure_snapshot'] = fixture.snapshot()
                except Exception as snapshot_error:
                    result['snapshot_error'] = type(snapshot_error).__name__
            save(directory / (name + '-failure.json'), dict(traceback=tb))
        finally:
            if fixture:
                fixture.close()
        result['controlled_wire_calls'] = wire.calls
        save(directory / (name + '-result.json'), result)
        summary['scenarios'].append({k: v for k, v in result.items()
                                     if k not in ('checks', 'failure_snapshot', 'controlled_wire_calls')})
        print(json.dumps(summary['scenarios'][-1]), flush=True)
    summary['blocked_socket_attempts'] = attempts
    summary['status'] = 'PASS' if all(r['status'] == 'PASS' for r in summary['scenarios']) else 'FAIL'
    summary['disposable_databases_retained_for_inspection'] = True
    save(directory / 'summary.json', summary)
    print(json.dumps(summary, indent=2))
    return 0 if summary['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
