"""Run-bound fixed Python computation. Inputs are exact shared-file versions."""
from dataclasses import replace
import csv
from types import SimpleNamespace
from typing import Literal
from pydantic import AwareDatetime, Field, model_validator
from ..composition import ReadDecision
from ..model_base import Model, Id, Hash
from ..models import now, new_id
from ..errors import DomainError, deny
from ..workspace_file_models import FileVersionRef, GeneratedBlobRef, ExportFormat, Filename
from ..sandbox import client, profiles as P
from ..sandbox.runner_protocol import blob, unblob, digest, NAME
from .models import InputRef


class ComputeInput(Model):
    name: str = Field(min_length=1, max_length=80)
    ref: FileVersionRef


class ComputePython(ReadDecision):
    kind: Literal['compute_python']
    code: str = Field(min_length=1, max_length=P.CODE_BYTES)
    inputs: list[ComputeInput] = Field(max_length=8)

    @model_validator(mode='after')
    def bounded(self):
        names = [item.name for item in self.inputs]
        if (len(self.code.encode()) > P.CODE_BYTES or len(set(names)) != len(names)
                or 'main.py' in names or any(not NAME.fullmatch(n) for n in names)):
            raise ValueError('bounded unique input names required')
        return self


class ComputeExportManifest(Model):
    exporter_version: Literal['compute-python-v1'] = 'compute-python-v1'
    export_id: Id
    workspace_id: Id
    conversation_id: Id
    run_id: Id
    tool_attempt_id: Id
    code_sha256: Hash
    profile_sha256: Hash
    input_refs: list[InputRef]
    format: ExportFormat
    filename: Filename
    blob: GeneratedBlobRef
    created_at: AwareDatetime
    annotations: Literal['explicit_omissions'] = 'explicit_omissions'
    omissions: list[str]
    sandbox_sha256: Hash


class ComputeResources(Model):
    cpu_usec: int = Field(ge=0)
    memory_peak_bytes: int = Field(ge=0)
    oom_kill: int = Field(ge=0)
    pids_peak: int = Field(ge=0)


class StagedInput(Model):
    name: str
    sha256: Hash
    bytes: int = Field(ge=0, le=P.INPUT_BYTES)


class ComputeResult(Model):
    version: Literal[1]
    profile: Literal['python-analysis-v1']
    profile_sha256: Hash
    runtime_version: str
    image: str
    status: Literal['succeeded','failed','wall_limit','cpu_limit','output_limit','cancelled','unavailable']
    exit_code: int | None
    code_sha256: Hash
    inputs: list[StagedInput] = Field(max_length=8)
    stdout: str
    stderr: str
    elapsed_ms: int = Field(ge=0, le=60000)
    resources: ComputeResources
    omissions: list[str] = Field(max_length=20)
    outputs: list[ComputeExportManifest] = Field(max_length=8)
    cleanup_verified: Literal[True]


class ComputeUnavailable(Model):
    status: Literal['unavailable']
    omissions: list[str] = Field(max_length=20)
    outputs: list[ComputeExportManifest] = Field(max_length=0)


class ComputeOutput(Model):
    capability: Literal['compute_python']
    version: Literal['1']
    result: ComputeResult | ComputeUnavailable


def input_refs(request):
    return [InputRef(kind='workspace_file', id=i.ref.workspace_file_id,
                     version=i.ref.version_id, sha256=i.ref.sha256) for i in request.inputs]


def authorize_resources(service, c, p, run, scope, call, adapter):
    from .file_adapters import scope_targets
    expected = input_refs(adapter.input_model.model_validate(call.arguments, strict=True))
    if call.input_refs != expected: deny()
    allowed = scope_targets(service, c, p, run, scope)
    for ref in expected:
        row, actual, _, _ = service._file_version(c, p, run.workspace_id, ref.id, ref.version)
        if (row['conversation_id'] != scope.id or actual.sha256 != ref.sha256
                or (allowed is not None and row['artifact_id'] not in allowed)):
            deny()


def invoke(service, cap, request, call):
    from . import policy, registry
    from ..service import encoded
    from ..artifact_exports import FORMATS, render
    adapter = registry.adapters()['compute.python']
    with service.db.transaction() as c:
        p, run, scope, _ = policy.authorize(service, c, cap, call, adapter)
        attempt = c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND call_id=%s',
                            (run.workspace_id, run.id, call.call_id)).fetchone()['id']
        inputs = []
        for item in request.inputs:
            _, _, raw, _ = service._file_version(c, p, run.workspace_id, item.ref.workspace_file_id, item.ref.version_id)
            inputs.append(blob(item.name, raw))
    def authorized():
        # No transaction spans code execution. Every poll uses the current lease,
        # generation, immutable inputs, installed pin, consent and work version.
        try:
            with service.db.transaction() as c:
                policy.authorize(service, c, cap, call, adapter)
            return True
        except DomainError:
            return False
    try:
        result = client.run(request.code, inputs, authorized=authorized)
    except client.SandboxUnavailable:
        return {'capability':'compute_python','version':'1','result':{
            'status':'unavailable','omissions':['isolation service unavailable; no host fallback'], 'outputs':[]}}
    except client.SandboxCancelled:
        raise DomainError('not_found_or_not_authorized') from None
    # Service bytes are untrusted. The app never executes/imports their content.
    outputs = result.pop('outputs')
    result['outputs'] = []
    with service.db.transaction() as c:
        service._scope(c, SimpleNamespace(id=cap.principal_id), cap.workspace_id, write=True)
        p, run, scope, _ = policy.authorize(service, c, cap, call, adapter)
        if result['status'] == 'succeeded':
            for item in outputs:
                raw = unblob(item)
                suffix = item['name'].rsplit('.', 1)[-1]
                format = 'markdown' if suffix == 'md' else suffix
                if not raw or format not in FORMATS:
                    result['omissions'].append('empty or unsupported generated file omitted'); continue
                try:
                    raw.decode('utf-8')
                    rendered, _, omitted = render(None, format, raw=raw, mime_type=FORMATS[format][1])
                except (UnicodeError, ValueError, csv.Error, DomainError):
                    result['omissions'].append('invalid UTF-8 or structured output omitted'); continue
                if rendered != raw:
                    omitted.append('CSV formulas escaped for safe download; sandbox_sha256 identifies original output')
                omitted.append('Generated output: no independent correctness or annotation-preservation guarantee; inspect the computation receipt.')
                ref = GeneratedBlobRef(blob_id=new_id(), sha256=digest(rendered), byte_length=len(rendered), mime_type=FORMATS[format][1])
                manifest = ComputeExportManifest(export_id=new_id(), workspace_id=run.workspace_id,
                    conversation_id=scope.id, run_id=run.id, tool_attempt_id=attempt,
                    code_sha256=result['code_sha256'], profile_sha256=result['profile_sha256'],
                    input_refs=call.input_refs, format=format, filename=item['name'], blob=ref,
                    created_at=now(), omissions=omitted, sandbox_sha256=item['sha256'])
                c.execute('INSERT INTO generated_blobs(workspace_id,id,owner_id,sha256,mime_type,bytes) VALUES (%s,%s,%s,%s,%s,%s)',
                          (run.workspace_id, ref.blob_id, p.id, ref.sha256, ref.mime_type, rendered))
                c.execute('INSERT INTO artifact_exports(workspace_id,id,owner_id,blob_id,data) VALUES (%s,%s,%s,%s,%s)',
                          (run.workspace_id, manifest.export_id, p.id, ref.blob_id, encoded(manifest)))
                result['outputs'].append(manifest.model_dump(mode='json'))
        policy.authorize(service, c, cap, call, adapter)
    return {'capability':'compute_python','version':'1','result':result}


def authorize_download(service, c, p, ws, manifest):
    service._document_scope(c, p, ws, manifest.conversation_id)
    # Unsettled/cost-only/unknown effects are NEVER downloadable, even by guessed ID.
    row = c.execute("SELECT e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' "
                    "WHERE a.workspace_id=%s AND a.id=%s AND a.run_id=%s AND a.capability_id='compute.python'",
                    (ws, manifest.tool_attempt_id, manifest.run_id)).fetchone()
    if (not row or row['data']['status'] != 'observed'
            or manifest.model_dump(mode='json') not in row['data'].get('output', {}).get('result', {}).get('outputs', [])):
        deny()
    for ref in manifest.input_refs:
        _, actual, _, _ = service._file_version(c, p, ws, ref.id, ref.version)
        if actual.sha256 != ref.sha256: deny()


def adapters():
    from .registry import _adapter
    paths = ('capabilities/compute_adapters.py', 'capabilities/compute_composition.py',
             'sandbox/client.py', 'sandbox/profiles.py', 'sandbox/runner_protocol.py',
             'sandbox/service.py', 'sandbox/installation.py', 'artifact_exports.py',
             'sandbox/results.py', 'sandbox/runtime-lock.json',
             '../migrations/057_compute_python.sql')
    adapter = _adapter('compute.python', ComputePython, ComputeOutput, None, paths, version='1',
                       effects=['read','local_compute','draft'], resource_kinds=['workspace_file'],
                       profile=P.PROFILE, category='local_compute')
    descriptor = adapter.descriptor.model_copy(update={'transport':'sandbox', 'timeout_ms':60000,
                                                       'result_byte_limit':1048576})
    return {'compute.python':replace(adapter, descriptor=descriptor, invoke_fenced=invoke)}
