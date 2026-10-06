#!/usr/bin/env python3
"""Synthetic HTTP transport ONLY; real GeneralWorker, PostgreSQL, CSV and Wasmtime.

Run with backend/.venv/bin/python scripts/verify_general_model_journey.py
  --env .local/NEW.env --output .local/NEW-evidence [--fixture-check]
Default builds the opt-in web and runs the actual browser journey. --fixture-check
exercises the same fixture/dispatcher via real loopback HTTP without web. Both
require a NEW env/output and retain the DB/state. --status is read-only readback.
No live mode, key lookup, provider network, production mutation or grant renewal.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time
from decimal import Decimal, ROUND_HALF_EVEN

import importlib.util

_stack_spec = importlib.util.spec_from_file_location('journey_stack', Path(__file__).with_name('workagent.py'))
_stack = importlib.util.module_from_spec(_stack_spec)
_stack_spec.loader.exec_module(_stack)
ROOT, PYTHON, Stack, environment, run = _stack.ROOT, _stack.PYTHON, _stack.Stack, _stack.environment, _stack.run

WS = 'local-workspace'
PROMPTS = [
    'Reconcile this invoice CSV. Keep original values and notes; show discrepancies and give me a downloadable result.',
    'Recalculate my saved table using round-half-even. Preserve my edits and propose the change.',
    'Build a small local invoice-total calculator with quantity and unit price in cents. Test quantity3 and price1250.',
    'Add shipping as a separate cents input. Test3 items at1250 cents plus500 shipping. Preserve my note and propose the update.',
]
NOTES = {'csv': 'Human: keep my corrected price and note.', 'row': 'Human credit note retained',
         'tool': 'Human: keep cents, not dollars.'}


def dump(path, value):
    path = Path(path)
    path.write_text(json.dumps(value, indent=2, default=str) + '\n')
    path.chmod(0o600)


def source():
    files = ['scripts/verify_general_model_journey.py', 'scripts/verify_general_model_journey.mjs',
             'backend/tests/test_general_responses.py', 'backend/tests/test_general_responses_journey.py']
    return {'git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'worktree_status': subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True),
            'sha256': {f: hashlib.sha256((ROOT / f).read_bytes()).hexdigest() for f in files}}


def expected():
    # Independent expectations: never appended to a provider request or prompt.
    b = (Decimal('3') * Decimal('12.495')).quantize(Decimal('.01'), rounding=ROUND_HALF_EVEN)
    return {'initial_reported': '78.40', 'initial_calculated': '77.40', 'revised_b': str(b),
            'revised_total': str(Decimal('39.90') + b), 'revised_difference': str(Decimal('38.50') - b),
            'tool_initial': str(3 * 1250), 'tool_shipping': str(3 * 1250 + 500)}


def backend_imports():
    # Explicit TEST-ONLY fixture imports, never a production prompt router.
    sys.path.insert(0, str(ROOT / 'backend'))
    sys.path.insert(0, str(ROOT / 'backend/tests'))
    from workagent.db import Database
    from workagent.service import Service, Principal
    return Database, Service, Principal


def context(env, admin=None):
    Database, Service, Principal = backend_imports()
    db = Database(env['DATABASE_URL'])
    db.check_runtime_role()
    return Service(db), Principal(env['LOCAL_PRINCIPAL_ID']), WS, [], admin


def owner_dsn(path):
    # Read ONLY for the explicit bounded test-fixture installation.
    for line in path.read_text().splitlines():
        bits = shlex.split(line)
        if bits and bits[0] == 'export':
            bits = bits[1:]
        if bits and bits[0].startswith('MIGRATION_DATABASE_URL='):
            return bits[0].split('=', 1)[1]
    raise RuntimeError('Missing fixture owner DSN')


def install(env_path, out, env):
    from test_general_responses import activate
    s, p, ws, _, _ = ctx = context(env, owner_dsn(env_path))
    ids = json.loads((out / 'conversation-ids.json').read_text())
    assert set(ids) == {'csv', 'tool'} and len(set(ids.values())) == 2
    assert not (out / 'grant.json').exists(), 'Never reset or replace a grant'
    cvs = [s.get_conversation(p, ws, cid).conversation for cid in ids.values()]
    for cid in ids.values():
        d = s.get_conversation(p, ws, cid)
        assert not d.messages and not d.runs and not d.assignment_ids
    grant = activate(ctx, cvs, max_runs=4)
    assert grant.responses.transport_mode == 'synthetic'
    from workagent.responses_dispatcher import general_status
    actual = general_status(s.db, ws, grant.id)
    assert set(actual['conversation_ids']) == set(ids.values()) and actual['active']
    dump(out / 'grant.json', {'grant_id': grant.id, 'conversation_ids': ids, 'max_runs': 4,
        'admission_setup': 'Explicit operator fixture installed AFTER the two real conversation creates and BEFORE their message sends; not automatic standing permission.',
        'mode': 'synthetic', 'status': actual})
    print('Installed and read back exact two-conversation synthetic fixture grant.', flush=True)
    return grant.id


def fixture_provider(out):
    from test_general_responses import Provider

    class ExactFixture(Provider):
        """Inherited canned decisions restricted to these exact four test turns."""
        def __init__(self):
            super().__init__()
            self.events = []
            self.selections = []
            self.local_results = []

        def handle(self, request):
            assert request.url.host == 'synthetic.invalid'  # MockTransport, never socket I/O.
            payload = json.loads(request.content) if request.method == 'POST' else None
            if request.url.path == '/v1/responses/input_tokens' and not self.events:
                # Deliberate fixture latency: browser observes the reserved count
                # as unknown, then must recover through reads without a resend.
                time.sleep(4)
            if payload and request.url.path == '/v1/responses':
                ctx = json.loads(payload['input'][0]['content'])
                human = [m for m in ctx['messages'] if m['author_kind'] == 'human'][-1]
                assert human['text'] in PROMPTS, 'Unexpected fifth/other fixture intent'
                assert human.get('operation') is None
                if payload['metadata']['step_id'] == 'selection':
                    assert human['text'] not in self.selections, 'No replacement generations'
                    self.selections.append(human['text'])
                else:
                    item = next(i for i in payload['input'] if i.get('type') == 'function_call_output')
                    self.local_results.append(json.loads(item['output']))
            response = super().handle(request)
            self.events.append({'method': request.method, 'path': request.url.path,
                'phase': payload.get('metadata', {}).get('step_id') if payload else None,
                'transport': 'httpx.MockTransport', 'live_provider_call': False})
            dump(out / 'synthetic-transport.json', {'mode': 'synthetic_http_transport_not_model_intelligence',
                'events': self.events, 'selection_prompts': self.selections,
                'trusted_local_results_received_by_final_phase': self.local_results,
                'live_provider_calls': 0, 'spend': 'none; DB costs are synthetic conservative reservations'})
            return response
    return ExactFixture()


def dispatcher(env, out):
    from workagent.general_worker import GeneralWorker
    from workagent.responses_dispatcher import ResponsesDispatcher
    s, _, _, _, _ = context(env)
    fake = fixture_provider(out)
    worker = GeneralWorker(s, transport=fake.transport(), state=out / 'private-state', enable_responses=True)
    grant = json.loads((out / 'grant.json').read_text())['grant_id']
    return ResponsesDispatcher(worker, workspace=WS, grant_id=grant), fake


def status(env, out):
    from workagent.responses_dispatcher import general_status
    s, _, _, _, _ = context(env)
    grant = json.loads((out / 'grant.json').read_text())['grant_id']
    actual = general_status(s.db, WS, grant)
    dump(out / 'status.json', actual)
    return actual


def consume(env, out):
    from workagent.responses_dispatcher import serve
    disp, _ = dispatcher(env, out)
    dump(out / 'worker-source.json', source())
    def verify():
        current = status(env, out)
        assert current['active'] and current['mode'] == 'synthetic'
    # The EXISTING dispatcher serve loop, not a competing queue or model loop.
    serve(disp, verify, .15)


def fixture_check(env_path, env, out):
    """Four HTTP turns with actual local operations; no browser evidence claimed."""
    from test_general_responses_journey import api
    from workagent.models import Command, new_id
    ctx = context(env)
    def command(**kwargs):
        return {**Command(schema_version='workagent/v1', request_id=new_id(), command_id=new_id()).model_dump(), **kwargs}
    report = {'mode': 'fixture_check_real_loopback_http_postgresql_same_worker_no_browser', 'steps': []}
    with api(ctx) as client:
        base = f'/v1/workspaces/{WS}'
        def get(path):
            r = client.get(base + path); r.raise_for_status(); return r.json()
        def post(path, value, code=200):
            r = client.post(base + path, json=value); assert r.status_code == code, r.text; return r.json()
        ids = {k: post('/conversations', command(title=f'Synthetic {k} fixture'), 201)['id'] for k in ('csv', 'tool')}
        dump(out / 'conversation-ids.json', ids)
        install(env_path, out, env)
        disp, fake = dispatcher(env, out)
        def turn(kind, n, target=None):
            cid = ids[kind]
            payload = command(expected_work_version=get('/conversations/' + cid)['conversation']['work_version'],
                text=PROMPTS[n], attachments=[{'filename': 'invoices.csv', 'mime_type': 'text/csv',
                'content': (ROOT / 'fixtures/general-work/invoices.csv').read_text()}] if n == 0 else [], target=target)
            admitted = post('/conversations/' + cid + '/messages', payload, 202)
            assert admitted['run']['profile'] == 'general-responses-v1' and admitted['message']['operation'] is None
            replay = post('/conversations/' + cid + '/messages', payload, 202)
            assert replay['run']['id'] == admitted['run']['id']
            dispatched = disp.once()
            assert len(dispatched['results']) == 1 and dispatched['results'][0]['status'] == 'completed', dispatched
            detail = get('/conversations/' + cid)
            assert detail['messages'][-1]['evidence_origin'] == 'synthetic_provider_receipt'
            product = next(x for x in detail['messages'][-1]['result']['results'] if x['kind'] == ('table' if kind == 'csv' else 'tool'))
            obs = get('/observations/' + product['observation_id'])
            assert obs['observation']['evidence_origin'] == 'local_tool'
            report['steps'].append({'run': admitted['run'], 'product': product, 'observation': obs})
            return product, get('/artifacts/' + product['artifact_id']), obs
        def save(art, kind):
            body = art['current_revision']['body']
            body['notes'] = [NOTES[kind]]
            if kind == 'csv':
                body['rows'][1]['unit_price'] = '12.495'; body['rows'][1]['note'] = NOTES['row']
            saved = post('/artifacts/' + art['id'] + '/save', command(expected_current_revision_id=art['current_revision_id'], body=body))
            assert get('/artifacts/' + art['id'])['current_revision_id'] == saved['current_revision_id']
            return saved, {'artifact_id': saved['id'], 'revision_id': saved['current_revision_id'], 'body_hash': saved['current_revision']['body_hash']}
        _, table, obs = turn('csv', 0)
        exp = expected()
        assert obs['observation']['output']['expected_sum'] == exp['initial_calculated']
        assert obs['observation']['output']['reported_sum'] == exp['initial_reported']
        saved, target = save(table, 'csv')
        product, current, obs = turn('csv', 1, target)
        assert current['current_revision_id'] == saved['current_revision_id'] and obs['binding_state'] == 'pending_proposal'
        prop = next(p for p in get('/artifacts/' + table['id'] + '/proposals')['items'] if p['id'] == product['proposal_id'])
        assert prop['body']['rows'][1]['calculated_total'] == exp['revised_b']
        assert prop['body']['rows'][1]['difference'] == exp['revised_difference']
        assert prop['body']['notes'] == [NOTES['csv']] and prop['body']['rows'][1]['note'] == NOTES['row']
        assert obs['observation']['output']['expected_sum'] == exp['revised_total']
        _, tool, obs = turn('tool', 2)
        assert obs['observation']['output']['value'] == exp['tool_initial']
        saved, target = save(tool, 'tool')
        product, current, obs = turn('tool', 3, target)
        prop = next(p for p in get('/artifacts/' + tool['id'] + '/proposals')['items'] if p['id'] == product['proposal_id'])
        assert prop['status'] == 'pending' and prop['body']['notes'] == [NOTES['tool']]
        assert prop['body']['code'] != saved['current_revision']['body']['code'] and len(prop['body']['input_form']) == 3
        assert current['current_revision_id'] == saved['current_revision_id'] and obs['binding_state'] == 'pending_proposal'
        assert obs['observation']['output']['value'] == exp['tool_shipping']
        before = len(fake.calls)
        assert disp.once()['results'] == [] and len(fake.calls) == before
        st = status(env, out)
        assert st['budget']['request_counts'] == {'count_send': 8, 'dispatch': 8, 'read': 0, 'cancel': 0}
        report.update(passed=True, budget=st['budget'], observations_real=True, model_intelligence='NOT TESTED',
            exact_command_replay_no_duplicate=True, completed_dispatch_replay_no_calls=True,
            pending_proposals_preserved=True, browser='NOT TESTED', source=source())
        dump(out / 'fixture-check.json', report)
    print('PASS: four synthetic HTTP turns; real PostgreSQL, CSV and Wasmtime; no browser claim.')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--env', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    mode = p.add_mutually_exclusive_group()
    mode.add_argument('--fixture-check', action='store_true')
    mode.add_argument('--install', action='store_true', help='Internal operator fixture barrier')
    mode.add_argument('--consume', action='store_true', help='Internal existing dispatcher serve')
    mode.add_argument('--status', action='store_true', help='Read existing fixture; no admission or provider calls')
    args = p.parse_args()
    env_path, out = args.env.resolve(), args.output.resolve()
    # Restrict all persisted fixtures/evidence to this checkout's ignored .local.
    local = (ROOT / '.local').resolve()
    assert env_path.is_relative_to(local) and out.is_relative_to(local)
    internal = args.install or args.consume or args.status
    if internal:
        assert env_path.exists() and (out / 'manifest.json').exists()
    else:
        assert not env_path.exists(), 'Use a NEW isolated environment; old DBs are never adopted/reset'
        assert not out.exists(), 'Use a NEW evidence directory'
        out.mkdir(parents=True, mode=0o700)
        dump(out / 'manifest.json', {'source': source(), 'prompts': PROMPTS, 'notes': NOTES, 'expected': expected(),
            'mode': 'synthetic_http_transport_not_model_intelligence', 'live_provider_calls': 0,
            'milestones_M3_M4_M5': 'NOT IMPLEMENTED / NOT TESTED; not implied by this harness'})
        if not args.fixture_check:
            build_env = {k: v for k, v in os.environ.items() if not k.endswith('API_KEY') and k not in {'ANTHROPIC_AUTH_TOKEN', 'OPENAI_ACCESS_TOKEN', 'MIGRATION_DATABASE_URL'}}
            build_env.update(NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION='1', NEXT_PUBLIC_WORKAGENT_API_BASE='/api/domain')
            with (out / 'build.log').open('w') as log:
                result = subprocess.run(['pnpm', 'build'], cwd=ROOT / 'web', env=build_env, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                dump(out / 'verification.json', {'passed': False, 'blocked': 'frontend production build failed; see build.log', 'browser': 'NOT TESTED', 'source': source()})
                raise SystemExit('BLOCKED: web build failed; exact log retained. No browser claim, no grant, no provider calls.')
    env = environment(env_path)
    env['NEXT_PUBLIC_WORKAGENT_NATURAL_ADMISSION'] = '1'
    os.environ.clear(); os.environ.update(env)  # No inherited model keys/admin authority.
    backend_imports()
    if args.install:
        install(env_path, out, env)
    elif args.consume:
        consume(env, out)
    elif args.status:
        print(json.dumps(status(env, out), indent=2))
    elif args.fixture_check:
        fixture_check(env_path, env, out)
    else:
        stack = Stack(env)
        try:
            stack.start(worker=False)
            run(['node', ROOT / 'scripts/verify_general_model_journey.mjs', out, env_path], env=env)
            st = status(env, out)
            assert st['budget']['request_counts'] == {'count_send': 8, 'dispatch': 8, 'read': 0, 'cancel': 0}
            assert len(st['turns']) == 4
            # Reopening is read-only. Stack really restarts, DB/grant/state remain unchanged.
            stack.stop(); stack.start(worker=False)
            run(['node', ROOT / 'scripts/verify_general_model_journey.mjs', out, env_path, '--reopen'], env=env)
            assert status(env, out)['budget'] == st['budget']
            dump(out / 'verification.json', {'passed': True, 'source_at_start': json.loads((out / 'manifest.json').read_text())['source'],
                'source_at_finish': source(), 'mode': 'actual_browser_api_postgresql_same_worker_synthetic_http_transport',
                'live_provider_calls': 0, 'synthetic_generations': 8, 'ui_turns': 4, 'budget': st['budget'],
                'model_intelligence': 'NOT TESTED', 'human_usefulness_review': 'NOT TESTED',
                'M3_M4_M5': 'NOT IMPLEMENTED / NOT TESTED', 'database_retained': True})
        finally:
            stack.stop()


if __name__ == '__main__':
    main()
