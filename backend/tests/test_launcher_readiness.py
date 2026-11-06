"""A14 readiness proves a fresh session and scoped domain response, not HTML."""
import importlib.util
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.error import HTTPError

import pytest

spec = importlib.util.spec_from_file_location('launcher_readiness', Path(__file__).resolve().parents[2] / 'scripts/workagent.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


@pytest.fixture
def proxy():
    state = {'scope': 'a' * 64, 'session_status': 200, 'domain_status': 200,
             'items': [{'id': 'synthetic-workspace'}], 'requests': []}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            state['requests'].append((self.path, dict(self.headers)))
            if self.path.endswith('/session'):
                status = state['session_status']
                body = state.get('session_body', {'scope_id': state['scope']})
            else:
                status = state['domain_status'] if self.headers.get('X-Workagent-Scope') == state['scope'] else 401
                body = state.get('domain_body', {'items': state['items']})
            self.send_response(status)
            self.end_headers()
            self.wfile.write(body.encode() if isinstance(body, str) else json.dumps(body).encode())

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_probes_session_then_scoped_domain_and_rediscovers_rotation(proxy):
    origin, state = proxy
    for scope in ('a' * 64, 'b' * 64):
        state['scope'] = scope
        assert launcher.scoped_ready(origin)
        first, second = state['requests'][-2:]
        assert first[0] == '/api/domain/v1/session'
        assert 'X-Workagent-Scope' not in first[1]
        assert second[0] == '/api/domain/v1/workspaces'
        assert second[1]['X-Workagent-Scope'] == scope
        assert second[1]['X-Workagent-Client'] == 'local-ui'
        assert 'Authorization' not in second[1]


@pytest.mark.parametrize('body', [{}, [], {'scope_id': None}, {'scope_id': 'hardcoded'}, {'scope_id': 'A' * 64}])
def test_missing_invalid_scope_never_reads_domain(proxy, body):
    origin, state = proxy
    state['session_body'] = body
    assert not launcher.scoped_ready(origin)
    assert len(state['requests']) == 1


@pytest.mark.parametrize('target', ['session_status', 'domain_status'])
@pytest.mark.parametrize('status', [401, 403, 500])
def test_denial_and_backend_failure_never_report_ready(proxy, target, status):
    origin, state = proxy
    state[target] = status
    with pytest.raises(HTTPError):
        launcher.scoped_ready(origin)


@pytest.mark.parametrize('target', ['session_body', 'domain_body'])
def test_public_html_is_not_readiness(proxy, target):
    origin, state = proxy
    state[target] = '<html>Ready</html>'
    with pytest.raises(ValueError):
        launcher.scoped_ready(origin)


@pytest.mark.parametrize('body', [{'items': []}, {'items': 'not a list'}, [], {}])
def test_no_authorized_workspaces_is_not_ready(proxy, body):
    origin, state = proxy
    state['domain_body'] = body
    assert not launcher.scoped_ready(origin)


def test_isolated_ports_and_collision_do_not_kill_owners(proxy):
    origin, _ = proxy
    port = int(origin.rsplit(':', 1)[1])
    with pytest.raises(RuntimeError, match='No process was killed'):
        launcher.free_ports((port,))
    assert launcher.scoped_ready(origin)
    env = {}
    stack = launcher.Stack(env, web_port=13210, api_port=18210)
    assert stack.origin == env['FRONTEND_ORIGIN'] == env['WORKAGENT_WEB_ORIGIN'] == 'http://127.0.0.1:13210'
    assert env['WORKAGENT_BACKEND_URL'] == 'http://127.0.0.1:18210'
    with pytest.raises(ValueError):
        launcher.Stack({}, web_port=1234, api_port=1234)
