"""Actual loopback HTTP download of real gVisor output; no TestClient substitute."""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from hashlib import sha256
import httpx
import pytest
from test_domain import context
from test_compute_gateway_pg import execute
from workagent.db import Database
from compute_fixtures import retain_evidence


@pytest.fixture
def http_api():
    # Kernel-assigned private port, inherited listener; no port-guessing race.
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); listener.listen()
        port = listener.getsockname()[1]
        proc = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'workagent.api:app',
            '--fd', str(listener.fileno()), '--no-access-log', '--log-level', 'error'],
            pass_fds=(listener.fileno(),), cwd=Path(__file__).resolve().parents[1],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=5) as client:
                deadline = time.monotonic() + 15
                while True:
                    assert proc.poll() is None, 'owned HTTP proof process exited'
                    try:
                        if client.get('/openapi.json').status_code == 200: break
                    except httpx.TransportError: pass
                    assert time.monotonic() < deadline
                    time.sleep(.1)
                yield client
        finally:
            proc.terminate()
            try: proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill(); proc.wait(timeout=5)


def test_real_authenticated_download_denial_and_source_loss(context, http_api):
    s,p,ws,_,admin = context
    obs,(_,_,_,_,request) = execute(context, [('input.txt','synthetic input')],
        "open('/outputs/http.txt','w').write(open('/inputs/input.txt').read()+' -> computed')")
    manifest = obs.output['result']['outputs'][0]
    path = f"/v1/workspaces/{ws}/exports/{manifest['export_id']}/download"
    headers = {'Authorization':'Bearer '+os.environ['LOCAL_BEARER_TOKEN'], 'X-Schema-Version':'workagent/v1', 'X-Request-Id':'compute-download-proof'}
    response = http_api.get(path, headers=headers)
    assert response.status_code == 200, response.text
    assert response.content == b'synthetic input -> computed'
    digest = sha256(response.content).hexdigest()
    assert digest == manifest['blob']['sha256'] == response.headers['x-content-sha256']
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.headers['cache-control'] == 'no-store'  # Global API middleware overrides route headers.
    assert response.headers['content-disposition'] == 'attachment; filename="http.txt"'
    anonymous = http_api.get(path)
    assert anonymous.status_code == 401
    wrong_scope = http_api.get(path.replace(ws,'not-authorized'), headers=headers)
    assert wrong_scope.status_code == 404
    # Withdraw the source conversation's owner access, not a mocked download.
    with Database(admin).transaction() as c:
        c.execute('UPDATE memberships SET active=false WHERE workspace_id=%s AND principal_id=%s', (ws,p.id))
    denied = http_api.get(path, headers=headers)
    assert denied.status_code == 404 and b'synthetic input' not in denied.content
    retain_evidence('http-download', {'status':response.status_code,'sha256':digest,
        'manifest':manifest,'anonymous_status':anonymous.status_code,
        'wrong_workspace_status':wrong_scope.status_code,'revoked_access_status':denied.status_code,
        'headers':{k:response.headers[k] for k in ('content-disposition','x-content-type-options','cache-control','x-content-sha256')},
        'transport':'real loopback TCP uvicorn; authenticated principal; restricted PostgreSQL'})
