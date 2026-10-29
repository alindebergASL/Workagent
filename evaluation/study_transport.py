"""Explicit study transport attachment; never weakens the synthetic-only harness.

Official attachment is implemented but release-locked. Root execution owner must
review/replace LIVE_EXECUTION_RELEASE after compatible funded authority exists.
This file never installs grants, allocates funds or discovers credentials.
"""
from __future__ import annotations
import json
import re

# No CLI flag/environment variable can release paid execution in this residual.
LIVE_EXECUTION_RELEASE = None


def require_live_release():
    if LIVE_EXECUTION_RELEASE is None:
        raise RuntimeError('paid_execution_unreleased_t_e07c8870')


def funded_admission(service, cfg):
    """Read exact installed grant/run; authoritative per-I/O reserve remains SQL.

    No fabricated local funding boolean, cached remainder or separate budget pool.
    The existing worker rechecks transport/grant/access and durable reserves before
    count/create/read; insufficient authority remains an actual stopped outcome.
    """
    from workagent.provider_attempts import check_grant
    from workagent.general_responses import check_pins
    from workagent.service import Principal
    service.db.check_runtime_role()
    run = service.get_run(Principal(cfg['principal']), cfg['workspace'], cfg['run_id'])
    with service.db.transaction() as c:
        actual = check_pins(c, run)
        check_grant(c, run, actual)
        if actual != cfg['run_configuration']:
            raise RuntimeError('run_binding_drift')
        row = c.execute('SELECT data,active FROM provider_grants WHERE id=%s', (cfg['grant_id'],)).fetchone()
        if not row or not row['active'] or row['data'] != cfg['grant']:
            raise RuntimeError('grant_binding_drift')
        binding = row['data']['responses']
        if binding['transport_mode'] != 'official_api':
            raise RuntimeError('funded_official_grant_required')
    return binding


def attach_transport(service, cfg, *, credential=None):
    from workagent.responses_transport import ResponsesTransport
    if cfg['transport'] == 'official_api':
        require_live_release()  # BEFORE credential use, database access or networking
        binding = funded_admission(service, cfg)
        if credential is None:
            raise RuntimeError('explicit_credential_injection_required')
        return ResponsesTransport(credential=credential, project_id=binding['project_id'],
                                  credential_reference=binding['secret_reference'], enabled=True)
    if cfg['transport'] != 'controlled_http' or credential is not None:
        raise RuntimeError('unsupported_study_transport')
    origin = cfg['controlled_origin']
    if not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{1,5}', origin):
        raise RuntimeError('controlled_loopback_only')
    if cfg['grant']['responses']['transport_mode'] != 'synthetic':
        raise RuntimeError('controlled_requires_synthetic_grant')
    import httpx
    # Keep the product's strict MockTransport construction/provenance guard intact.
    # The mock callback is only a credential-free, redirect-free loopback wire bridge.
    client = httpx.Client(timeout=20, follow_redirects=False, trust_env=False)
    def forward(request):
        if request.url.host != '127.0.0.1' or str(request.url).split('/v1/')[0] != origin:
            raise RuntimeError('controlled_destination_drift')
        response = client.request(request.method, str(request.url), content=request.content,
                                  headers={'Content-Type': 'application/json'})
        if 300 <= response.status_code < 400:
            raise RuntimeError('controlled_redirect_denied')
        return httpx.Response(response.status_code, content=response.content,
                              headers={'Content-Type': 'application/json'})
    transport = ResponsesTransport.synthetic(httpx.MockTransport(forward), origin=origin)
    original_close = transport.close
    def close():
        try:
            original_close()
        finally:
            client.close()
    transport.close = close
    return transport
