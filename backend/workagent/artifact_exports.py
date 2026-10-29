"""Deterministic basic exports and authenticated immutable generated-byte downloads."""
import csv
import io
import json
import re
from hashlib import sha256
from .errors import DomainError, deny
from .models import now, new_id
from .product_models import FileBody, TableBody
from .flexible_models import Body, StructuredTableBody
from .workspace_file_models import ExportManifest, GeneratedBlobRef

FORMATS = {'txt': ('txt', 'text/plain'), 'markdown': ('md', 'text/markdown'),
           'csv': ('csv', 'text/csv'), 'json': ('json', 'application/json')}
from .office_sandbox import FORMATS as OFFICE_FORMATS
FORMATS.update(OFFICE_FORMATS)
# Whitespace, exponent tricks and formulas are not "safe negative numbers".
NUMBER = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\Z')


def safe_csv_cell(value):
    text = '' if value is None else str(value)
    probe = text.lstrip(' \t\r\n\ufeff')
    if (probe.startswith(('=', '+', '-', '@')) and not NUMBER.fullmatch(text)) or text.startswith(('\t', '\r', '\n')):
        return "'" + text
    return text


def csv_bytes(rows, *, newline='\r\n', bom=False):
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator=newline)
    writer.writerows([[safe_csv_cell(cell) for cell in row] for row in rows])
    return (('\ufeff' if bom else '') + out.getvalue()).encode('utf-8')


def render(body, format, *, raw=None, mime_type=None, source_omissions=()):
    """No executable conversion. Every annotation is included or visibly omitted."""
    if format not in ('txt','markdown','csv','json'):
        raise DomainError('unsupported_operation')
    omitted = list(source_omissions)
    annotation_state = 'not_present'
    if isinstance(body, FileBody):
        raw = body.content.encode('utf-8')
        mime_type = mime_type or body.mime_type
    if raw is not None:
        if format == 'json':
            if mime_type == 'application/json' and not omitted:
                json.loads(raw.decode('utf-8-sig'))
                result = raw
            else:
                result = json.dumps({'text': raw.decode('utf-8'), 'source_omissions': omitted},
                                    ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')
        elif format == 'csv':
            if mime_type != 'text/csv':
                result = csv_bytes([['text'], [raw.decode('utf-8')], *[['OMITTED: ' + x] for x in omitted]])
            else:
                rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'), newline=''), strict=True))
                unsafe = any(safe_csv_cell(cell) != cell for row in rows for cell in row)
                if not unsafe and not omitted:
                    result = raw  # Safe source CSV retains exact BOM, quoting and newlines.
                else:
                    result = csv_bytes([*rows, *[['OMITTED: ' + x] for x in omitted]],
                        newline='\r\n' if b'\r\n' in raw else '\r' if b'\r' in raw else '\n',
                        bom=raw.startswith(b'\xef\xbb\xbf'))
        else:
            result = raw + (('\n\nSource coverage omissions:\n' + '\n'.join(omitted)).encode('utf-8') if omitted else b'')
    elif format == 'json':
        result = json.dumps(body.model_dump(mode='json'), ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')
        annotation_state = 'included'
    elif format == 'csv':
        if isinstance(body, TableBody):
            rows = [body.columns, *[[row[key] for key in body.columns] for row in body.rows]]
            notes = body.notes
            omitted += ['Table title, source CSV and calculation metadata omitted from CSV; JSON includes them.']
        elif isinstance(body, StructuredTableBody):
            rows = [[f.label for f in body.fields],
                    *[[next(cell.value for cell in row.cells if cell.field_key == f.key) for f in body.fields] for row in body.rows]]
            notes = body.notes
            omitted += ['Table title, row IDs and field type/unit/scale metadata omitted from CSV; JSON includes them.']
        elif isinstance(body, Body):
            rows = [['block_id', 'kind', 'text', 'checked'],
                    *[[b.block_id, b.kind, b.text, b.checked] for b in body.blocks]]
            notes = []
            rows.append(['title', body.title])
        else:
            raise DomainError('unsupported_operation')
        rows.extend([['Human annotation', note] for note in notes])
        rows.extend([['OMITTED', note] for note in omitted])
        result = csv_bytes(rows)
        annotation_state = 'included'
    else:
        # Structured formats remain a complete readable representation, including
        # human notes and protected blocks; never execute custom HTML or code.
        result = json.dumps(body.model_dump(mode='json'), ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')
        annotation_state = 'included'
    if not 0 < len(result) <= 1048576:
        raise DomainError('validation_error')
    if omitted:
        annotation_state = 'explicit_omissions'
    return result, annotation_state, omitted


class ArtifactExports:
    def _export_artifact_input(self, c, p, ws, artifact_id, revision_id, body_hash):
        from .service import digest
        artifact, owner = self._artifact(c, p, ws, artifact_id)
        if artifact.get('conversation_id'):
            self._document_scope(c, p, ws, artifact['conversation_id'])
        revision = self._revision(c, p, ws, artifact, owner, revision_id)
        if revision.body_hash != body_hash or digest(revision.body) != body_hash:
            raise DomainError('source_changed')
        return artifact, revision

    def _retain_export(self, c, p, ws, *, conversation_id, artifact_id, revision_id, input_hash,
                       file_id, snapshot_id, format, raw, annotations, omissions, tool_attempt_id=None, **metadata):
        from .service import encoded
        ext, mime = FORMATS[format]
        blob = GeneratedBlobRef(blob_id=new_id(), sha256=sha256(raw).hexdigest(), byte_length=len(raw), mime_type=mime)
        manifest = ExportManifest(export_id=new_id(), workspace_id=ws, conversation_id=conversation_id,
            artifact_id=artifact_id, revision_id=revision_id, input_sha256=input_hash, workspace_file_id=file_id,
            source_snapshot_id=snapshot_id, format=format, filename='export.' + ext, blob=blob,
            created_at=now(), annotations=annotations, omissions=omissions, tool_attempt_id=tool_attempt_id, **metadata)
        c.execute('INSERT INTO generated_blobs(workspace_id,id,owner_id,sha256,mime_type,bytes) VALUES (%s,%s,%s,%s,%s,%s)',
                  (ws, blob.blob_id, p.id, blob.sha256, blob.mime_type, raw))
        c.execute('INSERT INTO artifact_exports(workspace_id,id,owner_id,blob_id,data) VALUES (%s,%s,%s,%s,%s)',
                  (ws, manifest.export_id, p.id, blob.blob_id, encoded(manifest)))
        self._event(c, p, ws, 'artifact_exported', artifact_id or conversation_id)
        return manifest

    def _export_artifact(self, c, p, ws, artifact_id, revision_id, body_hash, format, tool_attempt_id=None):
        artifact, revision = self._export_artifact_input(c, p, ws, artifact_id, revision_id, body_hash)
        raw, annotations, omitted = render(revision.body, format)
        return self._retain_export(c, p, ws, conversation_id=artifact.get('conversation_id'), artifact_id=artifact_id,
            revision_id=revision_id, input_hash=body_hash, file_id=None, snapshot_id=None, format=format,
            raw=raw, annotations=annotations, omissions=omitted, tool_attempt_id=tool_attempt_id)

    def export_artifact(self, p, ws, artifact_id, cmd):
        if cmd.format in OFFICE_FORMATS:
            from .office_service import export
            return export(self,p,ws,cmd,artifact_id=artifact_id)
        return self._command(p, ws, 'export_artifact', {'artifact_id': artifact_id}, cmd, ExportManifest,
            lambda c: self._export_artifact_input(c, p, ws, artifact_id, cmd.revision_id, cmd.body_hash),
            lambda c, _: self._export_artifact(c, p, ws, artifact_id, cmd.revision_id, cmd.body_hash, cmd.format))

    def _export_workspace_file(self, c, p, ws, file_id, version_id, expected_hash, format, tool_attempt_id=None):
        from . import source_snapshots
        row, ref, source, snapshot_id = self._file_version(c, p, ws, file_id, version_id)
        if ref.sha256 != expected_hash:
            raise DomainError('source_changed')
        omitted = source_snapshots.read(self, c, p, ws, snapshot_id)[0].omissions if snapshot_id else []
        # Imported PDF/office versions export extracted text with explicit coverage.
        raw, annotations, omitted = render(None, format, raw=source, mime_type=row['mime_type'], source_omissions=omitted)
        return self._retain_export(c, p, ws, conversation_id=row['conversation_id'], artifact_id=row['artifact_id'],
            revision_id=version_id, input_hash=expected_hash, file_id=file_id, snapshot_id=snapshot_id,
            format=format, raw=raw, annotations=annotations, omissions=omitted, tool_attempt_id=tool_attempt_id)

    def export_workspace_file(self, p, ws, file_id, cmd):
        if cmd.format in OFFICE_FORMATS:
            from .office_service import export
            return export(self,p,ws,cmd,file_id=file_id)
        return self._command(p, ws, 'export_workspace_file', {'workspace_file_id': file_id}, cmd, ExportManifest,
            lambda c: self._file_version(c, p, ws, file_id, cmd.version_id),
            lambda c, _: self._export_workspace_file(c, p, ws, file_id, cmd.version_id, cmd.sha256, cmd.format))

    def import_office_draft(self,p,ws,cid,cmd):
        from .office_service import import_draft
        return import_draft(self,p,ws,cid,cmd)

    def download_export(self, p, ws, export_id):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            row = c.execute('SELECT data FROM artifact_exports WHERE workspace_id=%s AND id=%s AND owner_id=%s',
                            (ws, export_id, p.id)).fetchone()
            if not row:
                deny()
            from .capabilities.compute_adapters import ComputeExportManifest, authorize_download
            computed = row['data'].get('exporter_version') == 'compute-python-v1'
            manifest = (ComputeExportManifest if computed else ExportManifest).model_validate(row['data'])
            if not computed and manifest.exporter_version=='office-exports-v1' and manifest.tool_attempt_id:
                from .office_service import authorize_tool_download
                authorize_tool_download(c,ws,manifest)
            # Reauthorize original dependencies before reading generated bytes.
            if computed:
                authorize_download(self, c, p, ws, manifest)
            elif manifest.workspace_file_id:
                _, ref, _, _ = self._file_version(c, p, ws, manifest.workspace_file_id, manifest.revision_id)
                if ref.sha256 != manifest.input_sha256:
                    raise DomainError('source_changed')
            else:
                self._export_artifact_input(c, p, ws, manifest.artifact_id, manifest.revision_id, manifest.input_sha256)
            if not computed and manifest.provenance is not None:
                from .office_service import provenance
                if provenance(self,c,p,ws,manifest.provenance.source_snapshot_id)!=manifest.provenance:
                    raise DomainError('source_changed')
            blob = c.execute('SELECT bytes,sha256,mime_type FROM generated_blobs WHERE workspace_id=%s AND id=%s AND owner_id=%s',
                             (ws, manifest.blob.blob_id, p.id)).fetchone()
            if not blob:
                deny()
            raw = bytes(blob['bytes'])
            if (sha256(raw).hexdigest() != manifest.blob.sha256 or blob['sha256'] != manifest.blob.sha256
                    or len(raw) != manifest.blob.byte_length or blob['mime_type'] != manifest.blob.mime_type):
                raise DomainError('source_changed')
            return manifest, raw
