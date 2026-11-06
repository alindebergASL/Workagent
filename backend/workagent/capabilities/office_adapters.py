"""Opt-in office export capability; shared human/run conversion and fencing."""
from dataclasses import replace
from typing import Literal
from types import SimpleNamespace
from pydantic import model_validator
from .file_adapters import ArtifactsExport, input_refs, authorize_resources
from .registry import ReadOutput
from ..office_models import ChartSpec
from ..workspace_file_models import ExportManifest
from ..errors import DomainError, deny

class ToolChartSpec(ChartSpec):
    value_column: str | None

class ArtifactsOfficeExport(ArtifactsExport):
    kind: Literal['artifacts_export_office']
    format: Literal['docx','xlsx','pdf','png']
    chart_spec: ToolChartSpec | None

    @model_validator(mode='after')
    def chart_format(self):
        if (self.format=='png') != (self.chart_spec is not None):
            raise ValueError('PNG requires chart_spec; other formats reject it')
        return self

class OfficeExportOutput(ReadOutput):
    capability: Literal['artifacts_export_office']
    result: ExportManifest


def invoke(service,cap,request,call):
    from . import registry,policy
    from ..office_service import freeze_export,render_export,retain_export
    adapter=registry.adapters()[call.capability_id]
    ref=request.input_ref
    def freeze(c):
        p,run,scope,_=policy.authorize(service,c,cap,call,adapter)
        frozen=freeze_export(service,c,p,run.workspace_id,
            file_id=ref.id if ref.kind=='workspace_file' else None,
            artifact_id=ref.id if ref.kind=='artifact_revision' else None,
            version_id=ref.version,expected_hash=ref.sha256)
        return p,run,frozen
    with service.db.transaction() as c:
        _,_,frozen=freeze(c)
    output=render_export(frozen,request.format,request.chart_spec)
    with service.db.transaction() as c:
        service._scope(c,SimpleNamespace(id=cap.principal_id),cap.workspace_id,write=True)
        p,run,current=freeze(c)
        if current!=frozen: raise DomainError('version_conflict')
        attempt=c.execute('SELECT id FROM tool_attempts WHERE workspace_id=%s AND run_id=%s AND call_id=%s',
                          (run.workspace_id,run.id,call.call_id)).fetchone()
        if not attempt: deny()
        manifest=retain_export(service,c,p,run.workspace_id,frozen,output,request.format,attempt['id'])
        policy.authorize(service,c,cap,call,adapter)
        return dict(capability=request.kind,version='1',result=manifest.model_dump(mode='json'))


def adapters():
    from .registry import _adapter
    adapter=_adapter('artifacts.export.office',ArtifactsOfficeExport,OfficeExportOutput,None,
        ('capabilities/office_adapters.py','capabilities/office_composition.py','office_service.py',
         'office_sandbox.py','office_converter.py','office_content.py','office_models.py',
         'document_sandbox.py','document_parser.py','artifact_exports.py','workspace_file_models.py',
         'workspace_files.py','source_snapshots.py','../requirements-office.lock','../migrations/061_office_outputs.sql'),
        version='1',effects=['read','local_compute','draft'],resource_kinds=['workspace_file','artifact_revision'],
        profile='confined-office-v1',category='rendering')
    # An office original may require import plus rendering (each 25s wall bound).
    descriptor=adapter.descriptor.model_copy(update={'timeout_ms':60000})
    return {'artifacts.export.office':replace(adapter,descriptor=descriptor,invoke_fenced=invoke)}
