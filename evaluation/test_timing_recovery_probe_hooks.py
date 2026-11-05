"""Offline checks of the installed, process-global diagnostic hook wrapper."""
import ast
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.mark.parametrize('fault', ['none', 'before_reservation', 'after_dispatch', 'after_identity'])
def test_installed_controlled_recovery_hook(tmp_path, fault):
    # Isolate install()'s global instrumentation from pytest and other fixtures.
    code = '''
import json, socket, sys
from pathlib import Path
import httpx, psycopg
from timing_recovery_probe import Timings, install
from workagent.general_worker import GeneralWorker
from workagent.responses_transport import ResponsesTransport

def forbidden(*a, **kw):
    raise AssertionError('offline hook test must not perform I/O')
socket.create_connection = forbidden
psycopg.connect = forbidden
fault = sys.argv[1]
t = Timings()
install(t, dict(probe_execution='controlled_recovery', probe_mode='synthetic',
    grant={'responses': {'transport_mode': 'synthetic'}}, transport='controlled_http',
    controlled_origin='http://127.0.0.1:1', probe_fault=fault))
transport = ResponsesTransport.synthetic(httpx.MockTransport(forbidden))
delegated = []
w = GeneralWorker(None, transport=transport, enable_responses=True,
    state=Path(sys.argv[2]), hook=delegated.append)
hooks = ['after_count', 'after_predispatch', 'after_response',
         'before_publication', 'after_publication']
stop = {'after_dispatch': 'after_predispatch', 'after_identity': 'after_response'}.get(fault)
called = []
for name in hooks:
    called.append(name)
    try:
        w.phases._hook(name)
    except InterruptedError as exc:
        assert name == stop
        assert str(exc) == 'controlled committed boundary'
        break
    else:
        assert name != stop, 'configured fault did not interrupt'
assert delegated == (called[:-1] if stop else called)
events = [e for e in t.events if e['event'] == 'worker_hook']
assert [e['hook_name'] for e in events] == called
assert all('name' not in e and e['since_start'] >= 0 for e in events)
assert not any(e['event'] == 'controlled_http_enter' for e in t.events)
print(json.dumps({'fault': fault, 'called': called, 'delegated': delegated, 'io': 0}))
'''
    result = subprocess.run([sys.executable, '-c', code, fault, str(tmp_path/'state')],
        text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr


def test_probe_event_calls_do_not_collide_with_event_fields():
    import timing_recovery_probe
    tree = ast.parse(Path(timing_recovery_probe.__file__).read_text())
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Attribute) and node.func.attr == 'event'
             and isinstance(node.func.value, ast.Name) and node.func.value.id == 't']
    assert calls
    for call in calls:
        assert not {'name', 'event', 'since_start', 'since_claim'}.intersection(
            keyword.arg for keyword in call.keywords), f'event field collision at line {call.lineno}'
