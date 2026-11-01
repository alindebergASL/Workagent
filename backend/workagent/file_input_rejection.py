"""Semantic NEW-text rejection and exact append-only native no-effect proof.

Never sends, reserves a tool call, invokes an adapter, or repairs a persisted DTO.
"""
from copy import deepcopy
from hashlib import sha256
import json
import re
from .errors import DomainError
from .service import canonical, digest, encoded

REASON = ('The selection bound was reached after rejecting a generated-text hash mismatch. '
          'No effect was applied by that choice. Retained work and costs remain; the goal is incomplete.')


def candidate(request, result):
    """Return exact original decision and a validation-only copy, never execution args."""
    from .responses_transport import _json, TransportError
    if result.get('state') == 'function_call':
        value = result.get('value')
    elif result.get('state') == 'malformed' and result.get('issue') == 'schema_validation_failed':
        raw = result.get('rejection_diagnostic')
        if raw is None:
            return None
        doc = _json(raw)
        calls = [x for x in doc['output'] if x.get('type') == 'function_call']
        if len(calls) != 1 or calls[0].get('name') != 'choose_general_action':
            return None
        value = _json(calls[0]['arguments'])
    else:
        return None
    if not isinstance(value, dict) or not isinstance(value.get('decision'), dict):
        return None
    decision = value['decision']
    if decision.get('kind') not in ('files_create_draft', 'files_propose_patch'):
        return None
    submitted = decision.get('source') if decision['kind'] == 'files_create_draft' else decision
    if not isinstance(submitted, dict) or not isinstance(submitted.get('content'), str):
        return None
    if not isinstance(submitted.get('sha256'), str) or not re.fullmatch('[0-9a-f]{64}', submitted['sha256']):
        return None  # Hash syntax remains the unchanged strict-schema concern.
    computed = sha256(submitted['content'].encode('utf-8')).hexdigest()
    if submitted.get('sha256') == computed:
        return None
    # Validate the complete envelope, including format/size/UTF-8 and every
    # unrelated field. Only NEW text's hash is substituted in this local view.
    # The original selection/call is retained unchanged; this view has no route
    # to reserve/dispatch/invoke and is used only for current resource authority.
    view = deepcopy(value)
    destination = view['decision']['source'] if decision['kind'] == 'files_create_draft' else view['decision']
    destination['sha256'] = computed
    try:
        request.schema.validate(canonical(view))
    except TransportError:
        return None  # Other invalid inputs keep the existing strict schema path.
    return decision, view['decision']


def retain(ledger, request, cap):
    from .general_responses import check_pins
    from .capabilities import registry, policy
    from .capabilities.models import ToolCallV1
    from .capabilities.file_adapters import input_refs, FilesProposePatch
    from .workspace_file_models import validate_text
    service = ledger.service
    with service.db.transaction() as c:
        run, _, _ = ledger._auth(c, cap)
        check_pins(c, run)
        if c.execute("SELECT 1 FROM responses_events WHERE attempt_id=%s AND phase=%s AND kind='selection_rejection'",
                (ledger.receipt.attempt_id, request.phase)).fetchone():
            # A prior 076 classification is immutable history. Its existing
            # recovery path revalidates it; do not reinterpret or replace it.
            return None
        row = c.execute("SELECT data FROM responses_events WHERE attempt_id=%s AND phase=%s AND kind='result'",
            (ledger.receipt.attempt_id, request.phase)).fetchone()
        if not row:
            return None
        choice = candidate(request, row['data'])
        if choice is None:
            return None
        decision, validation_view = choice
        p, run, scope = service._check_capability(c, cap)
        service._validate_general_context(c, cap)
        c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',
            (run.workspace_id, run.id))
        adapter = registry.adapters()[registry.COMPOSITION_IDS[decision['kind']]]
        operation = adapter.input_model.model_validate_json(canonical(validation_view))
        call = ToolCallV1(call_id=request.phase, capability_id=adapter.descriptor.id,
            capability_version=adapter.descriptor.version, arguments=validation_view,
            input_refs=input_refs(operation), expected_work_version=scope.work_version)
        policy.authorize(service, c, cap, call, adapter)
        if isinstance(operation, FilesProposePatch):
            file, _, _ = service._file_base(c, p, run.workspace_id, operation.ref.workspace_file_id,
                operation.ref.version_id, operation.ref.sha256)
            try:
                validate_text(operation.content, file['mime_type'])
                if file.get('office_source_snapshot_id'):
                    from .office_content import validate
                    validate(json.loads(operation.content.lstrip('\ufeff')))
            except ValueError as exc:
                raise DomainError('validation_error') from exc
        previous = ledger._events(c, request.phase).get('file_input_rejection')
        proof = c.execute('SELECT file_input_rejection_expected(%s,%s,%s) AS data',
            (ledger.receipt.attempt_id, request.phase, previous['worker_fence'] if previous else cap.fence)).fetchone()['data']
        if proof is None:
            # A dispatched/unknown call requires separate owner-installed proof.
            # No invocation, GET, resend or blanket exception conversion here.
            raise DomainError('action_unresolved')
        if previous is None:
            ledger.event(c, request.phase, 'file_input_rejection', proof)
        elif previous != proof:
            raise DomainError('command_conflict')
        return proof


def install_no_effect(db, tool_attempt_id, provider_attempt_id, phase):
    """Owner-only exact installation seam, no runtime resolution permission."""
    with db.transaction() as c:
        evidence = c.execute('SELECT file_input_no_effect_evidence(%s,%s,%s) AS data',
            (tool_attempt_id, provider_attempt_id, phase)).fetchone()['data']
        if evidence is None:
            raise DomainError('action_unresolved')
        existing = c.execute('SELECT data FROM file_input_no_effect_resolutions WHERE tool_attempt_id=%s',
            (tool_attempt_id,)).fetchone()
        if existing:
            # Do not re-run a new material-absence claim after later authorized
            # actions. The immutable original attestation retains its meaning.
            if existing['data'] != evidence:
                raise DomainError('command_conflict')
            return evidence
        c.execute('INSERT INTO file_input_no_effect_resolutions(tool_attempt_id,data) VALUES (%s,%s) ON CONFLICT DO NOTHING',
            (tool_attempt_id, encoded(evidence)))
        saved = c.execute('SELECT data FROM file_input_no_effect_resolutions WHERE tool_attempt_id=%s',
            (tool_attempt_id,)).fetchone()['data']
        if saved != evidence:
            raise DomainError('command_conflict')
        return saved


def valid(c, attempt_id, phase, data):
    return c.execute('SELECT file_input_rejection_valid(%s,%s,%s::jsonb) AS ok',
        (attempt_id, phase, encoded(data))).fetchone()['ok']


def tools_unresolved(c, ws, run_id):
    return c.execute('SELECT file_input_tools_unresolved(%s,%s) AS unresolved', (ws, run_id)).fetchone()['unresolved']


def stop(service, cap, receipt, request):
    from .responses_ledger import Ledger
    from .outcomes import acknowledge
    from .run_checkpoints import record
    ledger = Ledger(service, receipt)
    rejected = retain(ledger, request, cap)
    if not rejected or rejected['terminal_outcome'] != 'step_limit':
        raise DomainError('action_unresolved')
    with service.db.transaction() as c:
        ledger._auth(c, cap)
        p, run, cv = service._check_capability(c, cap)
        service._validate_general_context(c, cap)
        c.execute('SELECT require_general_publication_authority(r) FROM runs r WHERE workspace_id=%s AND id=%s',
            (run.workspace_id, run.id))
        if tools_unresolved(c, run.workspace_id, run.id):
            raise DomainError('action_unresolved')
        run.state = 'partial'; run.stop_reason = 'step_limit'; run.unresolved = [REASON]
        run.used_units += 1; run.lease_expires_at = None
        run.execution.provider_observation = 'received'
        service._store_run(c, run)
        record(service, c, run, cv, 'final', 'settlement')
        service._event(c, p, run.workspace_id, 'file_input_rejected', run.id)
        acknowledge(c, run.workspace_id, run.id)
        return run
