"""Freeze/convert/reauthorize office operations on the existing file/export stores."""
from hashlib import sha256
import json
from .errors import DomainError, deny
from .office_models import OfficeProvenance
from .workspace_file_models import WorkspaceFile, WorkingText
from . import source_snapshots, office_sandbox


def provenance(service,c,p,ws,snapshot_id):
    snapshot,_=source_snapshots.read(service,c,p,ws,snapshot_id)
    return OfficeProvenance(source_snapshot_id=snapshot_id,original_sha256=snapshot.original_sha256,
        extraction_sha256=snapshot.extraction_sha256,parser_version=snapshot.parser_version)


def original(service,c,p,ws,snapshot_id):
    snapshot,_=source_snapshots.read(service,c,p,ws,snapshot_id)
    _,mime,raw,*_=source_snapshots.evidence(service,c,p,ws,snapshot.conversation_id,snapshot.locator)
    return raw,mime


def prepared_command(service,p,ws,op,args,cmd,model,prepare,perform,retain):
    """No DB transaction spans IO. Concurrent retries may compute, never duplicate effects.

    Converter is pure local IO with no externally observable effects. Existing
    command receipt remains the sole atomic publication/idempotency authority.
    """
    from .service import digest
    if p.kind!='human': deny()
    payload=cmd.model_dump(mode='json',exclude={'request_id','command_id'})
    if payload.get('chart_spec') is None: payload.pop('chart_spec',None)
    key=digest({'operation':op,'arguments':args,'payload':payload})
    with service.db.transaction() as c:
        service._scope(c,p,ws,write=True)
        frozen=prepare(c)
        previous=c.execute('SELECT payload_hash,result FROM commands WHERE principal_id=%s AND workspace_id=%s AND command_id=%s',
                           (p.id,ws,cmd.command_id)).fetchone()
        if previous:
            if previous['payload_hash']!=key: raise DomainError('command_conflict')
            return model.model_validate(previous['result'])
    output=perform(frozen)
    def mutate(c,current):
        if current!=frozen: raise DomainError('version_conflict')
        return retain(c,current,output)
    return service._command(p,ws,op,args,cmd,model,prepare,mutate)


def freeze_export(service,c,p,ws,*,file_id=None,artifact_id=None,version_id,expected_hash):
    from .product_models import FileBody, TableBody
    from .flexible_models import Body, StructuredTableBody
    prov=None; snapshot_id=None
    if file_id:
        row,ref,raw,snapshot_id=service._file_version(c,p,ws,file_id,version_id)
        if ref.sha256!=expected_hash: raise DomainError('source_changed')
        cid=row['conversation_id']; artifact_id=row['artifact_id']; mime=row['mime_type']
        current=service._file_current_id(c,row)
        sid=snapshot_id or row.get('office_source_snapshot_id')
        if sid: prov=provenance(service,c,p,ws,sid)
        if snapshot_id:
            snapshot,_=source_snapshots.read(service,c,p,ws,snapshot_id)
            omitted=list(snapshot.omissions)
            if mime in (office_sandbox.FORMATS['docx'][1],office_sandbox.FORMATS['xlsx'][1]):
                raw,mime=original(service,c,p,ws,snapshot_id)
        else: omitted=[]
        cv=service._document_scope(c,p,ws,cid)
    else:
        artifact,revision=service._export_artifact_input(c,p,ws,artifact_id,version_id,expected_hash)
        cid=artifact.get('conversation_id')
        _,cv=service._artifact(c,p,ws,artifact_id)
        current=artifact['current_revision_id']; body=revision.body; omitted=[]
        row=c.execute('SELECT * FROM workspace_files WHERE workspace_id=%s AND artifact_id=%s',(ws,artifact_id)).fetchone()
        if row and row.get('office_source_snapshot_id'): prov=provenance(service,c,p,ws,row['office_source_snapshot_id'])
        if isinstance(body,FileBody): raw=body.content.encode(); mime=row['mime_type'] if row else body.mime_type
        else:
            if isinstance(body,Body):
                value=dict(office_version='office-v1',kind='document',paragraphs=[body.title,*[b.text for b in body.blocks]],annotations=[])
            elif isinstance(body,(TableBody,StructuredTableBody)):
                # Preserve notes/title and explicit types without formula inference.
                if isinstance(body,TableBody):
                    headers=body.columns; rows=[[r[k] for k in headers] for r in body.rows]
                else:
                    headers=[f.label for f in body.fields]
                    rows=[[next(cell.value for cell in r.cells if cell.field_key==f.key) for f in body.fields] for r in body.rows]
                def column(n):
                    out=''
                    while n: n,r=divmod(n-1,26); out=chr(65+r)+out
                    return out
                cells=[dict(address=f'{column(j)}{i}',kind='blank' if v is None else 'boolean' if type(v) is bool else 'number' if isinstance(v,(int,float)) else 'string',
                            value=v if v is None or type(v) is bool else str(v),cached_value=None)
                       for i,row_values in enumerate([headers,*rows],1) for j,v in enumerate(row_values,1)]
                value=dict(office_version='office-v1',kind='workbook',sheets=[dict(name='Data',cells=cells)],annotations=[body.title,*body.notes])
                omitted.append('Source table field types/units, row IDs and calculation metadata are not preserved; canonical artifact remains available.')
            else: raise DomainError('unsupported_operation')
            raw=json.dumps(value,ensure_ascii=False).encode(); mime='application/json'
    return dict(raw=raw,mime=mime,omissions=omitted,provenance=prov,
        fence=(current,cv.work_version),retain=dict(conversation_id=cid,artifact_id=artifact_id,
        revision_id=version_id,input_hash=expected_hash,file_id=file_id,snapshot_id=snapshot_id))


def render_export(frozen,format,chart_spec=None):
    raw,mime=frozen['raw'],frozen['mime']
    omitted=list(frozen['omissions'])
    if mime in (office_sandbox.FORMATS['docx'][1],office_sandbox.FORMATS['xlsx'][1]):
        raw,import_omissions,_=office_sandbox.convert(raw,mime,operation='import')
        mime='application/json'; omitted+=import_omissions
    return office_sandbox.convert(raw,mime,format=format,chart_spec=chart_spec,source_omissions=omitted)


def retain_export(service,c,p,ws,frozen,output,format,tool_attempt_id=None):
    raw,omitted,chart=output
    return service._retain_export(c,p,ws,**frozen['retain'],format=format,raw=raw,
        annotations='explicit_omissions',omissions=omitted,tool_attempt_id=tool_attempt_id,
        exporter_version='office-exports-v1',fidelity='Editable values and plain paragraphs; constrained layout; no office-suite fidelity.',
        provenance=frozen['provenance'],chart=chart)


def export(service,p,ws,cmd,*,file_id=None,artifact_id=None):
    from .workspace_file_models import ExportManifest
    args={'workspace_file_id':file_id} if file_id else {'artifact_id':artifact_id}
    op='export_workspace_file' if file_id else 'export_artifact'
    version_id=cmd.version_id if file_id else cmd.revision_id
    expected_hash=cmd.sha256 if file_id else cmd.body_hash
    return prepared_command(service,p,ws,op,args,cmd,ExportManifest,
        lambda c:freeze_export(service,c,p,ws,file_id=file_id,artifact_id=artifact_id,version_id=version_id,expected_hash=expected_hash),
        lambda frozen:render_export(frozen,cmd.format,cmd.chart_spec),
        lambda c,frozen,output:retain_export(service,c,p,ws,frozen,output,cmd.format))


def import_draft(service,p,ws,cid,cmd):
    def prepare(c):
        cv=service._document_scope(c,p,ws,cid)
        row,ref,_,snapshot_id=service._file_version(c,p,ws,cmd.source.workspace_file_id,cmd.source.version_id)
        if row['conversation_id']!=cid or ref!=cmd.source: deny()
        if not snapshot_id: raise DomainError('unsupported_operation')
        prov=provenance(service,c,p,ws,snapshot_id)
        raw,mime=original(service,c,p,ws,snapshot_id)
        return dict(raw=raw,mime=mime,provenance=prov,fence=(service._file_current_id(c,row),cv.work_version))
    def retain(c,frozen,output):
        cv=service._document_scope(c,p,ws,cid)
        service._conversation_cas(cv,cmd.expected_work_version)
        raw,_,_=output
        source=WorkingText(filename='office.json',mime_type='application/json',content=raw.decode(),sha256=sha256(raw).hexdigest())
        return service._create_text_file(c,p,ws,cv,source,'human',office_source_snapshot_id=frozen['provenance'].source_snapshot_id)
    return prepared_command(service,p,ws,'import_office_draft',{'conversation_id':cid},cmd,WorkspaceFile,prepare,
        lambda f:office_sandbox.convert(f['raw'],f['mime'],operation='import'),retain)


def authorize_tool_download(c,ws,manifest):
    """Unknown/unsettled/cost-only exports are not downloadable by guessing IDs."""
    row=c.execute("SELECT e.data FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' "
        "WHERE a.workspace_id=%s AND a.id=%s AND a.capability_id='artifacts.export.office'",
        (ws,manifest.tool_attempt_id)).fetchone()
    if (not row or row['data'].get('status')!='observed'
        or row['data'].get('output',{}).get('result')!=manifest.model_dump(mode='json')):
        deny()
