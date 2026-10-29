"""Immutable evidence versions referencing the existing original stores only."""
from hashlib import sha256
from .errors import DomainError, deny
from .models import now, new_id
from .workspace_file_models import DocumentEvidence, SourceSnapshot


def evidence(service, c, p, ws, cid, ref):
    service._document_scope(c, p, ws, cid)
    from .research_models import PublicEvidence
    if isinstance(ref, PublicEvidence):
        from .research import public_evidence
        return public_evidence(service, c, p, ws, cid, ref)
    if isinstance(ref, DocumentEvidence):
        detail, original = service._document(c, p, ws, cid, ref.document_id, original=True)
        raw = detail.text.encode('utf-8')
        if (detail.sha256 != ref.sha256 or sha256(original).hexdigest() != ref.sha256
                or len(original) != detail.byte_length or sha256(raw).hexdigest() != detail.text_sha256
                or len(raw) != detail.text_bytes):
            raise DomainError('source_changed')
        omissions = list(detail.coverage.omissions)
        if detail.status not in ('extracted', 'truncated'):
            omissions.append('Extraction status: ' + detail.status + '; original content was not fully extracted.')
        return detail.filename, detail.mime_type, original, raw, None, detail.parser_version, omissions, detail.status, detail.coverage
    row = c.execute("SELECT data FROM conversation_messages WHERE workspace_id=%s AND conversation_id=%s AND id=%s AND author_kind='human'",
                    (ws, cid, ref.message_id)).fetchone()
    if not row or row['data'].get('evidence_origin') != 'human':
        deny()
    from .models import ConversationMessage
    message = ConversationMessage.model_validate(row['data'])
    item = next((a for a in message.attachments if a.ref == ref.ref and a.sha256 == ref.sha256), None)
    if item is None:
        deny()
    # A targeted attachment retains that artifact's current dependency ACL.
    if message.target:
        artifact, owner = service._artifact(c, p, ws, message.target.artifact_id)
        service._revision(c, p, ws, artifact, owner, message.target.revision_id)
    raw = item.content.encode('utf-8')
    if sha256(raw).hexdigest() != ref.sha256 or len(raw) != item.byte_length:
        raise DomainError('source_changed')
    return item.filename, item.mime_type, raw, raw, message.created_at, 'original-utf8-v1', [], 'original_text', None


def append(service, c, p, ws, cid, file_id, ref, previous=None):
    from .service import encoded
    name, mime, original, raw, version_at, parser, omissions, status, coverage = evidence(service, c, p, ws, cid, ref)
    snapshot = SourceSnapshot(snapshot_id=new_id(), workspace_file_id=file_id,
        workspace_id=ws, conversation_id=cid, version_number=previous.version_number + 1 if previous else 1,
        parent_snapshot_id=previous.snapshot_id if previous else None, locator=ref,
        observed_at=now(), version_at=version_at, original_sha256=sha256(original).hexdigest(),
        extraction_sha256=sha256(raw).hexdigest(), original_byte_length=len(original),
        extraction_byte_length=len(raw), parser_version=parser, omissions=omissions, extraction_status=status, coverage=coverage)
    c.execute('INSERT INTO source_snapshots(workspace_id,id,workspace_file_id,version_number,parent_snapshot_id,data) VALUES (%s,%s,%s,%s,%s,%s)',
              (ws, snapshot.snapshot_id, file_id, snapshot.version_number, snapshot.parent_snapshot_id, encoded(snapshot)))
    return snapshot


def retain_attachments(service, c, p, ws, cv, message):
    """Admission-transaction bridge; command replay cannot duplicate these rows.

    Original stores and their ACLs remain authoritative. Never parse, normalize,
    execute, or grant tools here. Only NEW human messages use this path; retained
    continuations continue to reference the first snapshot.
    """
    from .workspace_file_models import AttachmentEvidence
    for item in message.attachments:
        ref = AttachmentEvidence(kind='attachment', message_id=message.id,
                                 ref=item.ref, sha256=item.sha256)
        name, mime, *_ = evidence(service, c, p, ws, cv.id, ref)
        file_id = new_id()
        c.execute('INSERT INTO workspace_files(workspace_id,id,conversation_id,owner_id,filename,mime_type) VALUES (%s,%s,%s,%s,%s,%s)',
                  (ws, file_id, cv.id, p.id, name, mime))
        append(service, c, p, ws, cv.id, file_id, ref)
        service._event(c, p, ws, 'source_snapshot_created', cv.id)


def read(service, c, p, ws, snapshot_id):
    row = c.execute('SELECT data FROM source_snapshots WHERE workspace_id=%s AND id=%s', (ws, snapshot_id)).fetchone()
    if not row:
        deny()
    snapshot = SourceSnapshot.model_validate(row['data'])
    service._file_row(c, p, ws, snapshot.workspace_file_id)
    from .research import authorize_snapshot
    authorize_snapshot(c, ws, snapshot_id)
    _, _, original, raw, _, parser, omissions, status, coverage = evidence(service, c, p, ws, snapshot.conversation_id, snapshot.locator)
    if (sha256(original).hexdigest() != snapshot.original_sha256
            or sha256(raw).hexdigest() != snapshot.extraction_sha256
            or len(original) != snapshot.original_byte_length or len(raw) != snapshot.extraction_byte_length
            or parser != snapshot.parser_version or omissions != snapshot.omissions
            or status != snapshot.extraction_status or coverage != snapshot.coverage):
        raise DomainError('source_changed')
    return snapshot, raw
