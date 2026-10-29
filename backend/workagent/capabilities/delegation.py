"""Optional bounded analysis workers, never a second credential-bearing runtime.

The parent supplies a task/program, not authority. Each child runs in the existing
pinned no-network service with only its exact inputs. Child stdout is a proposal;
a separate parent verification execution binds that proposal before assimilation.
"""
from dataclasses import replace
import json
import math
from typing import Literal
from pydantic import Field
from ..composition import ReadDecision
from ..model_base import Model, Id, Hash
from ..errors import DomainError, deny
from ..service import canonical, digest
from ..sandbox import client, profiles
from ..sandbox.runner_protocol import blob, unique
from .compute_adapters import ComputePython, ComputeInput, ComputeResources, StagedInput
from .models import InputRef

PROCESSOR = 'local-confined-analysis-v1'


def processor_ref():
    return InputRef(kind='processor', id=PROCESSOR, version='1', sha256=digest(PROCESSOR))


class DelegateAnalysis(ComputePython):
    kind: Literal['delegate_analysis']
    task: str = Field(min_length=1, max_length=2000)
    independent_benefit: str = Field(min_length=1, max_length=1000)
    output_contract: str = Field(min_length=1, max_length=2000)
    inputs: list[ComputeInput] = Field(max_length=6)


class VerifyDelegate(ReadDecision):
    kind: Literal['verify_delegate']
    child_attempt_id: Id
    proposal_sha256: Hash
    inspection: str = Field(min_length=1, max_length=2000)
    code: str = Field(min_length=1, max_length=profiles.CODE_BYTES)


class ExecutionEvidence(Model):
    status: str
    code_sha256: Hash
    profile_sha256: Hash
    inputs: list[StagedInput]
    elapsed_ms: int
    resources: ComputeResources
    exit_code: int | None
    cleanup_verified: Literal[True]
    stdout_sha256: Hash


class ChildProposal(Model):
    state: Literal['proposal', 'failed', 'unavailable']
    child_attempt_id: Id
    task: str
    output_contract: str
    authority: dict
    proposal: dict | None
    proposal_sha256: Hash | None
    execution: ExecutionEvidence | None
    verification: Literal['unreviewed'] = 'unreviewed'
    provider_calls: Literal[0] = 0
    limitation: str = 'Deterministic analysis worker; not paid-model delegation or independently verified task completion.'


class ChildOutput(Model):
    capability: Literal['delegate_analysis']
    version: Literal['1'] = '1'
    result: ChildProposal


class VerificationResult(Model):
    state: Literal['checks_passed', 'discarded', 'checks_failed', 'unavailable']
    child_attempt_id: Id
    proposal_sha256: Hash
    inspection: str
    checks: list[str]
    proposal: dict | None
    execution: ExecutionEvidence | None
    limitation: str = 'Parent-supplied checks executed; not human acceptance, memory admission or independent goal truth.'


class VerificationOutput(Model):
    capability: Literal['verify_delegate']
    version: Literal['1'] = '1'
    result: VerificationResult


def launch_refs(request):
    from .compute_adapters import input_refs
    return [*input_refs(request), processor_ref()]


def child(c, ws, rid, request):
    row = c.execute("SELECT a.*, e.data AS observation FROM tool_attempts a JOIN tool_attempt_events e "
                    "ON e.attempt_id=a.id AND e.kind='observation' WHERE a.workspace_id=%s AND a.run_id=%s "
                    "AND a.id=%s AND a.capability_id='delegation.analysis'",
                    (ws, rid, request.child_attempt_id)).fetchone()
    if (not row or row['observation']['status'] != 'observed'
            or row['observation']['output']['result']['proposal_sha256'] != request.proposal_sha256
            or row['observation']['output']['result']['state'] != 'proposal'):
        deny()
    return row


def input_refs(service, cap, request):
    if isinstance(request, DelegateAnalysis):
        return launch_refs(request)
    with service.db.transaction() as c:
        service._check_capability(c, cap)
        row = child(c, cap.workspace_id, cap.run_id, request)
        return [InputRef.model_validate(r) for r in row['call']['input_refs']]


def authorize_resources(service, c, p, run, scope, call, adapter):
    from .compute_adapters import authorize_resources as compute_authorize
    from . import registry
    request = adapter.input_model.model_validate(call.arguments, strict=True)
    if isinstance(request, VerifyDelegate):
        row = child(c, run.workspace_id, run.id, request)
        launch = DelegateAnalysis.model_validate(row['call']['arguments'])
        if not c.execute('SELECT tool_file_resources_authorized(%s,%s,%s) AS ok',
                         (run.workspace_id, run.id, json.dumps(row['call']))).fetchone()['ok']:
            deny()
    else:
        launch = request
    expected = launch_refs(launch)
    if call.input_refs != expected or any(i.name in ('task.json', 'child.json') for i in launch.inputs):
        deny()
    mapped = call.model_copy(update={'arguments': {'kind':'compute_python', 'code':launch.code,
                                      'inputs':[i.model_dump() for i in launch.inputs]},
                                    'input_refs':expected[:-1]})
    compute_authorize(service, c, p, run, scope, mapped, registry.adapters()['compute.python'])


def _evidence(result):
    from hashlib import sha256
    return ExecutionEvidence(**{k:result[k] for k in ExecutionEvidence.model_fields if k!='stdout_sha256'},
                             stdout_sha256=sha256(result['stdout'].encode()).hexdigest())


def parse_proposal(text):
    def number(value):
        parsed = float(value)
        if not math.isfinite(parsed): raise ValueError('non-finite number')
        return parsed
    def invalid(_): raise ValueError('non-JSON number')
    return json.loads(text, object_pairs_hook=unique, parse_float=number, parse_constant=invalid)


def _execute(service, cap, call, request, inputs):
    from . import registry, policy
    adapter = registry.adapters()[call.capability_id]
    def authorized():
        try:
            with service.db.transaction() as c:
                policy.authorize(service, c, cap, call, adapter)
                if not c.execute('SELECT tool_file_resources_authorized(%s,%s,%s) AS ok',
                                 (cap.workspace_id,cap.run_id,canonical(call.model_dump(mode='json')))).fetchone()['ok']:
                    return False
            return True
        except DomainError:
            return False
    return client.run(request.code, inputs, authorized=authorized)


def invoke(service, cap, request, call):
    from . import registry, policy
    with service.db.transaction() as c:
        p, run, scope, grant = policy.authorize(service, c, cap, call, registry.adapters()[call.capability_id])
        aid = c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND call_id=%s',
                        (run.workspace_id, run.id, call.call_id)).fetchone()['id']
        launch = request
        prior = None
        if isinstance(request, VerifyDelegate):
            prior = child(c, run.workspace_id, run.id, request)
            launch = DelegateAnalysis.model_validate(prior['call']['arguments'])
        inputs = []
        for item in launch.inputs:
            _, _, raw, _ = service._file_version(c, p, run.workspace_id, item.ref.workspace_file_id, item.ref.version_id)
            inputs.append(blob(item.name, raw))
        # Server-derived intersection. No bearer, lease secret, vault ref, parent
        # messages, recalled memory, environment, or operator profile enters child.
        authority = {'parent_run_id':run.id, 'grant_id':grant.id,
                     'access_generation':grant.access_generation, 'budget_account_id':grant.budget_account_id,
                     'sources':[r.model_dump() for r in call.input_refs if r.kind=='workspace_file'],
                     'actions':['read_staged_inputs','local_compute','propose_json'],
                     'effects':['read','local_compute','draft'], 'processor':PROCESSOR,
                     'nested_delegation':False, 'accept':False, 'memory_admission':False}
        inputs.append(blob('task.json', canonical({'task':launch.task, 'output_contract':launch.output_contract,
                                                  'authority':authority}).encode()))
        if prior:
            inputs.append(blob('child.json', canonical(prior['observation']['output']['result']).encode()))
    try:
        result = _execute(service, cap, call, request, inputs)
    except client.SandboxUnavailable:
        result = None
    evidence = _evidence(result) if result else None
    data = None
    if result and result['status']=='succeeded' and result['exit_code']==0:
        # JSON stdout only; no generated exports, unbounded transcripts or paths.
        if len(result['stdout'].encode()) <= 16384:
            try:
                data = parse_proposal(result['stdout'])
            except (ValueError, TypeError):
                pass
        if not isinstance(data, dict): data = None
    if prior:
        checked = (data is not None and set(data)=={'passed','checks'} and type(data['passed']) is bool
                  and isinstance(data['checks'], list) and 1<=len(data['checks'])<=20
                  and all(isinstance(x,str) and 1<=len(x)<=500 for x in data['checks']))
        passed = checked and data is not None and data['passed'] is True
        return VerificationOutput(capability='verify_delegate', result=VerificationResult(
            state='unavailable' if result is None else 'checks_passed' if passed else 'discarded' if checked else 'checks_failed',
            child_attempt_id=request.child_attempt_id, proposal_sha256=request.proposal_sha256,
            inspection=request.inspection, checks=data['checks'] if checked and data is not None else [],
            proposal=prior['observation']['output']['result']['proposal'] if passed else None, execution=evidence))
    return ChildOutput(capability='delegate_analysis', result=ChildProposal(
        state='unavailable' if result is None else 'proposal' if data is not None else 'failed',
        child_attempt_id=aid, task=launch.task, output_contract=launch.output_contract,
        authority=authority, proposal=data, proposal_sha256=digest(data) if data is not None else None, execution=evidence))


def adapters():
    from .registry import _adapter
    result = {}
    paths = ('capabilities/delegation.py', 'capabilities/delegation_composition.py',
             'capabilities/compute_adapters.py','capabilities/file_adapters.py',
             'workspace_files.py','workspace_file_models.py',
             'sandbox/client.py','sandbox/results.py','sandbox/profiles.py','sandbox/runner_protocol.py',
             'sandbox/service.py','sandbox/installation.py','sandbox/runtime-lock.json',
             '../migrations/068_bounded_delegation.sql')
    for name, inp, out, category in [('delegation.analysis',DelegateAnalysis,ChildOutput,'child'),
                                     ('delegation.verify',VerifyDelegate,VerificationOutput,'local_compute')]:
        a = _adapter(name, inp, out, None, paths, version='1', effects=['read','local_compute','draft'],
                     resource_kinds=['workspace_file','processor'], profile='bounded-delegation-v1', category=category)
        result[name] = replace(a, descriptor=a.descriptor.model_copy(update={'transport':'sandbox','timeout_ms':60000}),
                               invoke_fenced=invoke)
    return result
