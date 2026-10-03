"""Execute real Hermes plus real Workagent broker under pre-import isolation."""
import json
from pathlib import Path
import sys
import threading
from collections import Counter
sys.path.insert(0, str(Path(__file__).resolve().parent))
from isolation import isolate, bootstrap
run, upstream, repo = map(Path, sys.argv[1:4])
quick = '--quick' in sys.argv[4:]
denied = isolate(run, upstream, repo)
from disposable import prepare, scope
runtime, owner = prepare(run, repo)
AIAgent = bootstrap(upstream)
from adapter import BrokerBinding, ControlledProvider, make_agent, text, tool
from workagent.broker import Broker
from workagent.db import Database
from workagent.models import CreateAssignment
from pydantic import ValidationError

calls = Counter()
watched = {'agent/conversation_loop.py': {'run_conversation','_run_conversation_turn'},
    'agent/tool_executor.py': {'_execute_tool_calls_sequential','_execute_single_tool_call'},
    'model_tools.py': {'handle_function_call'}, 'tools/registry.py': {'dispatch'}}
def profile(frame, event, arg):
    if event != 'call': return
    name = frame.f_code.co_name
    file = frame.f_code.co_filename
    if file.startswith(str(upstream) + '/'):
        rel = file[len(str(upstream)) + 1:]
        if name in watched.get(rel, set()): calls[rel + ':' + name] += 1
sys.setprofile(profile)
threading.setprofile(profile)

s, principal, ws, refs, q, cap = scope(repo, runtime, owner)
binding = BrokerBinding(Broker(s, cap)); binding.register()
args = {'schema_version':'workagent/v1','request_id':'bridge-request',
    'workspace_id':ws, 'assignment_id':q.assignment.id}
evidence = {'provenance':'controlled in-memory provider responses; no inference', 'cases':{}}

def case(name, messages, *, tools=True, history=None, before=None, max_iterations=3):
    provider = ControlledProvider(messages, before)
    agent = make_agent(AIAgent, provider, tools=tools, max_iterations=max_iterations)
    before_count = len(binding.trace)
    before_calls = calls.copy()
    result = agent.run_conversation('Controlled probe: ' + name,
        conversation_history=history, system_message='Controlled wiring test. Only scoped broker lookup is permitted.')
    agent.close()
    row = {'result':result, 'provider_requests':provider.requests,
        'broker_callbacks':binding.trace[before_count:], 'upstream_calls':dict(calls - before_calls)}
    evidence['cases'][name] = row
    (run / 'hermes_results.json').write_text(json.dumps(evidence, indent=2, default=str) + '\n')
    print(name, result.get('turn_exit_reason'), 'provider_calls=', len(provider.requests),
          'callbacks=', len(row['broker_callbacks']), flush=True)
    return row

row = case('source_free_dialogue', [text('Controlled source-free dialogue.')], tools=False)
assert row['result']['completed'] and len(row['provider_requests']) == 1
assert row['provider_requests'][0]['body'].get('tools', []) == []
assert not row['broker_callbacks']
row = case('source_free_tool_denied', [tool(args), text('No tools permitted in source-free dialogue.')], tools=False)
assert not row['broker_callbacks']
row = case('typed_broker_round_trip', [tool(args), text('Scoped assignment read completed.')])
assert len(row['provider_requests']) == 2
assert row['broker_callbacks'][0]['outcome'] == 'allowed'
assert row['broker_callbacks'][0]['assignment_id'] == q.assignment.id
assert any(m['role'] == 'tool' and q.assignment.id in m['content'] for m in row['provider_requests'][1]['body']['messages'])
assert row['upstream_calls'].get('tools/registry.py:dispatch') == 1
history = row['result']['messages']
row = case('history_resume_no_duplicate_tool', [text('Resumed from recorded tool result.')], history=history)
assert not row['broker_callbacks'] and len(row['provider_requests']) == 1
assert any(m['role'] == 'tool' for m in row['provider_requests'][0]['body']['messages'])
row = case('unknown_tool_denied', [tool({}, 'terminal'), text('Unapproved tool was denied.')])
assert not row['broker_callbacks']
assert any(m['role'] == 'tool' and ('not' in m['content'].lower() or 'error' in m['content'].lower()) for m in row['result']['messages'])
row = case('typed_arguments_denied', [tool({**args, 'workspace_id':42}), text('Malformed lookup was denied.')])
assert row['broker_callbacks'][0]['code'] == 'invalid_arguments'
row = case('foreign_scope_denied', [tool({**args, 'workspace_id':'foreign-workspace'}), text('Foreign scope was denied.')])
assert row['broker_callbacks'][0]['outcome'] == 'denied'
row = case('bounded_iterations', [tool(args, call_id=f'bounded-{i}') for i in range(6)], max_iterations=2)
assert len(row['provider_requests']) == 4, row['result']  # observed extra summary requests beyond counted iterations
assert row['result']['api_calls'] == 2
assert len(row['broker_callbacks']) == 2
# Revoke REAL DB source access after model selection begins, before callback execution.
def revoke(index):
    if index == 0:
        with Database(owner).transaction() as c:
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s', (ws, principal.id))
row = case('revoked_callback', [tool(args), text('Revoked callback was denied.')], before=revoke)
assert row['broker_callbacks'][0]['outcome'] == 'denied'
# Actual upstream hard interrupt while the controlled provider is being read.
provider = ControlledProvider([text('This content is interrupted.')])
agent = make_agent(AIAgent, provider, tools=False)
provider.before_response = lambda index: agent.interrupt(hard_cancel=True)
result = agent.run_conversation('Stop this controlled turn.', system_message='Controlled test.')
agent.close()
assert result['interrupted'] and len(provider.requests) == 1
evidence['cases']['hard_stop'] = {'result':result, 'provider_requests':provider.requests, 'broker_callbacks':[]}

# Current domain does not admit source-free assignment. This is not a Hermes failure.
try:
    CreateAssignment(schema_version='workagent/v1',request_id='empty',command_id='empty',
                     goal='Source free',completion_criteria=['Dialogue'],selected_source_refs=[])
except ValidationError as exc:
    evidence['responses_source_free_domain'] = {'denied':True, 'errors':exc.errors()}
else:
    raise AssertionError('expected current source-required domain limit')
evidence['upstream_executed'] = dict(calls)
evidence['isolation'] = {'inet_and_inet6':'seccomp EPERM verified before imports',
    'env':'allowlist created by supervisor', 'home':'fresh per process',
    'discovery_disabled':['dotenv','builtin tools','plugins'], 'memory':'skip_memory=True',
    'denied_audit_events':denied}
sys.setprofile(None); threading.setprofile(None)
(run / 'hermes_results.json').write_text(json.dumps(evidence, indent=2, default=str) + '\n')
print('HERMES_CASES_PASSED', len(evidence['cases']))

# Existing Responses tests exercise actual broker/worker/ledger on same isolated cluster.
from compare import compare
compare(repo, run)
import importlib.metadata
from hashlib import sha256
metadata = {'python':sys.version, 'upstream_pin':'f97608f178d1ffeca59860195ab7da295f7c8e5f',
    'workagent_base':'b76eef865b13486e045d20e2c4586b3975e6ba2c',
    'dependencies':sorted(f'{d.metadata["Name"]}=={d.version}' for d in importlib.metadata.distributions()),
    'upstream_source_sha256':{name:sha256((upstream/name).read_bytes()).hexdigest()
        for name in ['LICENSE','pyproject.toml','uv.lock','run_agent.py','agent/conversation_loop.py',
                     'agent/tool_executor.py','model_tools.py','tools/registry.py']},
    'regressions_requested':not quick}
(run / 'environment.json').write_text(json.dumps(metadata, indent=2) + '\n')
if quick:
    print('QUICK_MODE: existing Responses regression suite intentionally not run')
    raise SystemExit(0)
import pytest
sys.path.insert(0, str(repo / 'backend/tests'))
rc = pytest.main([str(repo / 'backend/tests/test_responses_transport.py'),
    str(repo / 'backend/tests/test_responses_worker.py'),
    str(repo / 'backend/tests/test_responses_recovery.py'),
    str(repo / 'backend/tests/test_responses_review_fixes.py'),
    '-q', '-x', '-k', 'not test_cross_process_predispatch_single_winner', '--tb=short', '-o', 'cache_dir=' + str(run / 'pytest_cache'),
    '--junitxml=' + str(run / 'responses_tests.xml')])
assert rc == 0, f'Responses tests failed: {rc}'
