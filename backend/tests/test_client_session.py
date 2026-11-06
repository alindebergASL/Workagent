"""Authenticated durable-client identity and stale-request fencing (no DB writes)."""
from dataclasses import replace
from fastapi.testclient import TestClient
from workagent.api import Settings, create_app

BASE = Settings('postgresql://fixture:private@localhost/synthetic_one', True,
                'synthetic-session-test-key-not-a-real-secret', 'synthetic-a')
HEADERS = {'Authorization': 'Bearer ' + BASE.local_bearer,
           'X-Schema-Version': 'workagent/v1', 'X-Request-Id': 'session-test'}

def client(settings=BASE):
    # No lifespan/database: identity is purely authenticated server configuration.
    return TestClient(create_app(settings))

def identity(settings=BASE):
    response = client(settings).get('/v1/session', headers=HEADERS)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
    assert set(response.json()) == {'principal_id', 'scope_id'}
    return response.json()

def test_authenticated_identity_is_stable_and_opaque():
    a = identity()
    assert a == identity()
    assert a['principal_id'] == BASE.principal_id
    assert len(a['scope_id']) == 64
    assert all(c in '0123456789abcdef' for c in a['scope_id'])
    assert BASE.local_bearer not in str(a) and BASE.database_url not in str(a)

def test_identity_requires_real_auth_not_caller_selected_principal():
    c = client()
    for headers in ({}, {'X-Workagent-Principal': 'synthetic-a'},
                    {**HEADERS, 'Authorization': 'Bearer wrong'}):
        assert c.get('/v1/session', headers=headers).status_code == 401
    assert c.get('/v1/session', headers={**HEADERS, 'X-Workagent-Principal': 'synthetic-b'}).json()['principal_id'] == 'synthetic-a'

def test_principal_and_backend_changes_are_independent():
    a = identity()
    assert identity(replace(BASE, principal_id='synthetic-b'))['scope_id'] != a['scope_id']
    assert identity(replace(BASE, database_url='postgresql://fixture:private@localhost/synthetic_two'))['scope_id'] != a['scope_id']

def test_stale_scope_refuses_before_service_read_or_mutation():
    c = client()
    # If the dependency fails to fence, service methods below would fail the test.
    def unexpected(*args, **kwargs):
        raise AssertionError('stale scope reached service')
    c.app.state.service.list_workspaces = unexpected
    c.app.state.service.create_conversation = unexpected
    h = {**HEADERS, 'X-Workagent-Scope': '0' * 64}
    for method, path, body in [
        ('GET', '/v1/workspaces', None),
        ('POST', '/v1/workspaces/synthetic/conversations', {
            'schema_version': 'workagent/v1', 'request_id': 'scope-test',
            'command_id': 'scope-test', 'title': 'Never dispatch', 'selected_source_refs': []}),
    ]:
        r = c.request(method, path, headers=h, json=body)
        assert r.status_code == 401
        assert r.json()['code'] == 'unauthenticated'

def test_matching_scope_is_not_authority_and_legacy_clients_remain_supported():
    c = client()
    scope = identity()['scope_id']
    assert c.get('/v1/session', headers={'X-Workagent-Scope': scope}).status_code == 401
    assert c.get('/v1/session', headers={**HEADERS, 'X-Workagent-Scope': scope}).status_code == 200
    assert c.get('/v1/session', headers=HEADERS).status_code == 200
