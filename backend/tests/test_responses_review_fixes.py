"""Intended-state regressions for IR-S1/S2/L1/L3. No provider/account traffic."""
from dataclasses import FrozenInstanceError
import json
import httpx
import pytest

from test_domain import context, cmd, create, raises
from test_responses_worker import grant, setup, totals
from test_runtime import expire
from workagent.db import Database
from workagent.errors import DomainError
from workagent.models import (ProviderGrant, new_id, ControlAssignment, Block, HumanSave,
                              RequestRevision, AcceptProposal)
from workagent.provider_attempts import ReceiptCapability, configure_grant, revoke_grant
from workagent.responses_dispatcher import ResponsesDispatcher
from workagent.responses_ledger import Ledger
from workagent.responses_transport import ResponsesTransport, Provenance, OFFICIAL_ORIGIN, TransportError
from workagent.responses_worker import ResponsesWorker, POLICY
from workagent.responses_synthetic import SyntheticResponses
from workagent.service import WorkerCapability


@pytest.fixture(autouse=True)
def no_provider_http(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('Provider/account HTTP is forbidden')
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', forbidden)


def revoke_authority(context, q, g, change):
    s, p, ws, _, admin = context
    if change == 'pause':
        a = s.get_assignment(p, ws, q.assignment.id)
        s.control_assignment(p, ws, a.id, cmd(ControlAssignment,
            expected_work_version=a.work_version, operation='pause'))
    elif change == 'revoke':
        revoke_grant(Database(admin), g.id)
    else:
        expire(context, q.run.id)


@pytest.mark.parametrize('change', ['pause', 'revoke', 'lease_expire'])
@pytest.mark.parametrize('kind', ['count_send', 'dispatch', 'read', 'cancel', 'tool_result', 'unknown'])
def test_receipt_only_sink_rejects_non_evidence_before_transaction(context, tmp_path, monkeypatch, change, kind):
    s, p, ws, _, _ = context
    g, q, fake, worker = setup(context, tmp_path)
    def stop(name):
        if name == 'after_count':
            raise RuntimeError('stop after count')
    worker.hook = stop
    with pytest.raises(RuntimeError):
        worker.run(ws, q.run.id)
    saved = worker.state.load(ws, q.run.id)
    ledger = Ledger(s, ReceiptCapability(**saved['receipt']))
    cap = WorkerCapability(**saved['worker'])
    request, events = ledger.snapshot('selection', cap)
    revoke_authority(context, q, g, change)
    with pytest.raises(DomainError):
        ledger.snapshot('selection', cap)
    with pytest.raises(DomainError):
        ledger.reserve_operation(request, 'dispatch', cap)
    def forbidden():
        pytest.fail('retain must reject non-evidence before opening a transaction')
    with monkeypatch.context() as m:
        m.setattr(s.db, 'transaction', forbidden)
        raises('unsupported_operation', lambda: ledger.retain(request, kind, {}))
    # Evidence replay still ACKs without current worker authority.
    assert ledger.retain(request, 'count_result', events['count_result']) is True
    assert len(fake.calls) == 1
    assert totals(s, g)['request_counts'] == {'count_send': 1, 'dispatch': 0, 'read': 0, 'cancel': 0}


@pytest.mark.parametrize('change', ['pause', 'revoke', 'lease_expire'])
@pytest.mark.parametrize('phase', ['count', 'selection', 'final'])
def test_genuine_late_evidence_survives_authority_loss(context, tmp_path, change, phase):
    s, p, ws, _, _ = context
    g, q, fake, _ = setup(context, tmp_path)
    changed = []
    def late(request):
        response = fake.handle(request)
        payload = json.loads(request.content)
        target = (request.url.path.endswith('/input_tokens') if phase == 'count'
                  else request.url.path == '/v1/responses' and payload['metadata']['step_id'] == phase)
        if target and not changed:
            revoke_authority(context, q, g, change)
            changed.append(True)
        return response
    worker = ResponsesWorker(s, ResponsesTransport.synthetic(httpx.MockTransport(late)), tmp_path/'state')
    with pytest.raises(DomainError):
        worker.run(ws, q.run.id)
    assert changed
    saved = worker.state.load(ws, q.run.id)
    rc = ReceiptCapability(**saved['receipt'])
    with s.db.transaction() as c:
        events = c.execute('SELECT phase,kind,data FROM responses_events WHERE attempt_id=%s', (rc.attempt_id,)).fetchall()
        assert c.execute('SELECT count(*) AS n FROM run_publications WHERE workspace_id=%s AND run_id=%s', (ws, q.run.id)).fetchone()['n'] == 0
    expected_phase = 'selection' if phase == 'count' else phase
    expected = {'count_result'} if phase == 'count' else {'identity', 'result'}
    assert expected <= {e['kind'] for e in events if e['phase'] == expected_phase}
    assert s.reconcile_provider_attempt(rc) is False


@pytest.mark.parametrize('field,value', [
    ('provenance', Provenance('official_api', OFFICIAL_ORIGIN)),
    ('project_id', 'proj_SYNTHETIC'),
    ('credential_reference', 'file:/synthetic/not-a-key'),
])
def test_synthetic_public_construction_labels_are_read_only(field, value):
    fake = SyntheticResponses()
    transport = fake.transport()
    with pytest.raises(AttributeError):
        setattr(transport, field, value)
    with pytest.raises((FrozenInstanceError, AttributeError)):
        transport.provenance.mode = 'official_api'
    assert transport.provenance.mode == 'synthetic'
    assert transport.project_id is None and transport.credential_reference is None
    assert not transport.matches_binding('official_api', 'proj_SYNTHETIC', 'file:/synthetic/not-a-key')
    assert transport.matches_binding('synthetic', 'proj_SYNTHETIC', 'file:/synthetic/not-a-key')
    assert fake.calls == []
    transport.close()


def test_official_constructor_binding_exact_client_mode_without_network():
    transport = ResponsesTransport(credential='SYNTHETIC-NOT-A-KEY', project_id='proj_SYNTHETIC',
        credential_reference='file:/synthetic/not-a-key', enabled=True)
    try:
        assert transport.matches_binding('official_api', 'proj_SYNTHETIC', 'file:/synthetic/not-a-key')
        assert not transport.matches_binding('synthetic', 'proj_SYNTHETIC', 'file:/synthetic/not-a-key')
        assert not transport.matches_binding('official_api', 'proj_OTHER', 'file:/synthetic/not-a-key')
        assert not transport.matches_binding('official_api', 'proj_SYNTHETIC', 'file:/synthetic/other')
        for field in ('provenance', 'project_id', 'credential_reference'):
            with pytest.raises(AttributeError):
                setattr(transport, field, getattr(transport, field))
    finally:
        transport.close()


def test_constructor_test_double_is_not_official_attestation(monkeypatch):
    # Local constructor instrumentation is not live evidence, even with official labels.
    monkeypatch.setattr(httpx, 'HTTPTransport', lambda **kw: httpx.MockTransport(lambda _: pytest.fail('no calls')))
    transport = ResponsesTransport(credential='SYNTHETIC-NOT-A-KEY', project_id='proj_SYNTHETIC',
        credential_reference='file:/synthetic/not-a-key', enabled=True)
    assert not transport.matches_binding('official_api', 'proj_SYNTHETIC', 'file:/synthetic/not-a-key')
    transport.close()


def test_synthetic_rejected_by_worker_and_grant_attestation(context, tmp_path):
    from workagent.runtime_config import assemble_context
    s, p, ws, _, admin = context
    old = grant(context)
    revoke_grant(Database(admin), old.id)
    official = ProviderGrant.model_validate({**old.model_dump(mode='json'), 'id': new_id(),
        'responses': {**old.responses.model_dump(mode='json'), 'transport_mode': 'official_api'}})
    configure_grant(Database(admin), official)
    q = create(context)
    fake = SyntheticResponses()
    transport = fake.transport()
    worker = ResponsesWorker(s, transport, tmp_path/'state')
    with pytest.raises(TransportError, match='grant_transport_mismatch'):
        worker.run(ws, q.run.id)
    cap = s.claim_run(p, ws, q.run.id)
    with s.db.transaction() as c:
        assemble_context(s, c, cap)
    for origin in ('live_provider_receipt', 'synthetic_provider_receipt'):
        raises('unsupported_operation', lambda: s.prepare_provider_attempt(cap,
            request_hash='0'*64, consumer_sha256=official.consumer_sha256,
            evidence_origin=origin, transport=transport))
    assert s.get_provider_attempt(p, ws, q.run.id) is None
    assert fake.calls == []


@pytest.mark.parametrize('bad_id', [None, '', 'invalid id', 'resp_../../other', 42, [], 'missing'])
@pytest.mark.parametrize('phase', ['selection', 'final'])
def test_2xx_invalid_identity_immediately_unknown_no_sql_error_or_resend(context, tmp_path, bad_id, phase):
    s, p, ws, _, _ = context
    g, q, fake, _ = setup(context, tmp_path)
    def invalid(request):
        response = fake.handle(request)
        if request.url.path == '/v1/responses' and json.loads(request.content)['metadata']['step_id'] == phase:
            doc = response.json()
            if bad_id == 'missing':
                doc.pop('id')
            else:
                doc['id'] = bad_id
            return httpx.Response(200, json=doc)
        return response
    transport = ResponsesTransport.synthetic(httpx.MockTransport(invalid))
    worker = ResponsesWorker(s, transport, tmp_path/'state')
    dispatcher = ResponsesDispatcher(worker, workspace=ws, grant_id=g.id)
    assert dispatcher.once()['results'] == [{'run_id': q.run.id, 'status': 'outcome_unknown'}]
    attempt = s.get_provider_attempt(p, ws, q.run.id)
    assert attempt.state == 'outcome_unknown'
    before = len(fake.calls)
    expire(context, q.run.id)
    assert ResponsesWorker(s, transport, tmp_path/'state').run(ws, q.run.id) == 'outcome_unknown'
    assert len(fake.calls) == before
    t = totals(s, g)
    assert t['request_counts']['dispatch'] == (1 if phase == 'selection' else 2)
    assert t['reserved_cost_usd'] == ('0.13192' if phase == 'selection' else '0.26384')
    assert t['unknown_usage_steps'] == 1 and t['conservatively_calculated_cost_usd'] is None
    with s.db.transaction() as c:
        assert c.execute("SELECT count(*) AS n FROM responses_events WHERE attempt_id=%s AND phase=%s AND kind IN ('identity','result')", (attempt.id, phase)).fetchone()['n'] == 0


def test_requested_rename_replacement_current_first_and_exact_history_approval(context, tmp_path):
    s, p, ws, _, _ = context
    g, q, fake, _ = setup(context, tmp_path)
    new_title = 'Revised TANGO decision'
    new_action = 'Defer redesign until Friday; do not ask the intake owner for the previous proposed ownership action.'
    instruction = 'Rename this document to Revised TANGO decision and replace the old next action with deferring redesign until Friday.'
    captured = []
    def revised(request):
        response = fake.handle(request)
        if request.url.path == '/v1/responses':
            payload = json.loads(request.content)
            if payload['metadata']['step_id'] == 'final':
                tool = json.loads(payload['input'][-1]['output'])
                captured.append(tool)
                if tool['instruction'] == instruction:
                    doc = response.json()
                    value = json.loads(doc['output'][0]['content'][0]['text'])
                    value.update(title=new_title, next_action=new_action)
                    doc['output'][0]['content'][0]['text'] = json.dumps(value)
                    return httpx.Response(200, json=doc)
        return response
    worker = ResponsesWorker(s, ResponsesTransport.synthetic(httpx.MockTransport(revised)), tmp_path/'state')
    assert worker.run(ws, q.run.id) == 'completed'
    a = s.get_assignment(p, ws, q.assignment.id)
    art = s.get_artifact(p, ws, a.artifact_ids[0])
    initial = art.current_revision.body.model_copy(deep=True)
    first_attempt = s.get_provider_attempt(p, ws, q.run.id).id
    prefixes = ['current', 'next-action', 'missing-information', 'source-basis', 'specific-judgment', 'scope']
    assert [b.block_id for b in initial.blocks] == [f'managed.{part}.{first_attempt}' for part in prefixes]
    human_body = initial.model_copy(deep=True)
    human_body.blocks.extend([
        Block(block_id='human-protected', kind='protected_note', text='  Keep Wednesday.\nExact whitespace: α  '),
        Block(block_id='human-edit', kind='paragraph', text='Human decision: do not redesign yet.'),
    ])
    human = s.human_save(p, ws, art.id, cmd(HumanSave, expected_current_revision_id=art.current_revision_id, body=human_body))
    a = s.get_assignment(p, ws, a.id)
    revision = s.request_revision(p, ws, art.id, cmd(RequestRevision, expected_work_version=a.work_version,
        base_revision_id=human.current_revision_id, instruction=instruction))
    assert worker.run(ws, revision.run.id) == 'completed'
    attempt = s.get_provider_attempt(p, ws, revision.run.id).id
    proposal = s.proposals(p, ws, art.id).items[-1]
    assert proposal.body.title == new_title
    assert [b.block_id for b in proposal.body.blocks[:7]] == [f'managed.{part}.{attempt}' for part in prefixes + ['history']]
    assert 'current proposal supersedes prior agent advice' in proposal.body.blocks[0].text.lower()
    assert proposal.body.blocks[1].text == 'Next action (proposed): ' + new_action
    assert 'prior saved content retained for context' in proposal.body.blocks[6].text.lower()
    assert 'earlier agent recommendations superseded' in proposal.body.blocks[6].text.lower()
    assert [b.model_dump(mode='json') for b in proposal.body.blocks[7:]] == [b.model_dump(mode='json') for b in human_body.blocks]
    assert captured[-1]['current_body'] == human_body.model_dump(mode='json')
    assert captured[-1]['instruction'] == instruction
    assert 'Ask the intake owner' in '\n'.join(b.text for b in proposal.body.blocks[7:])
    assert s.get_artifact(p, ws, art.id).current_revision.body == human_body
    assert proposal.base_revision_id == human.current_revision_id
    history = s.history(p, ws, art.id).items
    assert any(r.id == art.current_revision_id and r.body == initial for r in history)
    assert any(r.id == human.current_revision_id and r.body == human_body for r in history)
    approved = s.accept_proposal(p, ws, proposal.id, cmd(AcceptProposal, expected_current_revision_id=human.current_revision_id))
    assert approved.current_revision.body == proposal.body
    assert s.get_assignment(p, ws, a.id).responsibility.runs[-1].state == 'readback_verified'
    assert 'requested title' in POLICY and 'replacement' in POLICY and 'history' in POLICY
