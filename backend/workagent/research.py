"""Immutable public evidence and revision dependencies; no artifact mutation."""
import base64
from hashlib import sha256
from .errors import DomainError, deny
from .models import new_id, now
from .research_models import PublicEvidence, ResearchClaim, ClaimFreshness, ArtifactClaims
from .workspace_file_models import SourceSnapshot


def public_evidence(service, c, p, ws, cid, ref):
    service._document_scope(c, p, ws, cid)
    row = c.execute('SELECT bytes,mime_type,sha256 FROM generated_blobs WHERE workspace_id=%s AND id=%s AND owner_id=%s',
                    (ws, ref.blob_id, p.id)).fetchone()
    if not row: deny()
    raw = bytes(row['bytes']); text = ref.text.encode('utf-8')
    if (sha256(raw).hexdigest() != ref.sha256 or row['sha256'] != ref.sha256
            or row['mime_type'] != ref.mime_type or sha256(text).hexdigest() != ref.text_sha256):
        raise DomainError('source_changed')
    return ref.title or 'Public source', ref.mime_type, raw, text, ref.fetched_at, ref.extractor_version, ref.coverage.omissions, ref.extraction_status, ref.coverage


def authorize_snapshot(c, ws, snapshot_id):
    if not c.execute('SELECT research_source_visible(%s,%s) AS ok', (ws, snapshot_id)).fetchone()['ok']:
        deny()


def authorize_run_dependencies(c, ws, run_id):
    """Read visibility, NOT current-revision CAS; receipts remain immutable.

    Apply before retained context, provider count/send and tool-result projection.
    A read grant on a derived citation is not a grant to a revoked source.
    """
    if not c.execute('SELECT research_run_dependencies_visible(%s,%s) AS ok',
                     (ws, run_id)).fetchone()['ok']:
        deny()


def append_capture(service, c, p, run, scope, aid, request, material):
    from .service import encoded
    raw = base64.b64decode(material['raw_base64'], validate=True)
    text = material['text']
    if (len(raw) > 262144 or len(text.encode('utf-8')) > 200000
            or sha256(raw).hexdigest() != material['content_sha256']
            or sha256(text.encode('utf-8')).hexdigest() != material['text_sha256']
            or material['requested_url'] != request.url or material['status'] != 'ok'):
        raise ValueError('exact retained raw bytes and extracted text required')
    ref = PublicEvidence(blob_id=new_id(), sha256=material['content_sha256'],
        mime_type=material['content_type'], title=material['title'], url=request.url,
        final_url=material['final_url'], status_code=material['http_status'], redirects=material['redirects'],
        fetched_at=material['fetched_at'], extractor_version=material['extractor_version'],
        coverage=material['coverage'], external_version=material['external_version'],
        extraction_status=material['extraction_status'], browser_used=material['browser_used'],
        text=text, text_sha256=material['text_sha256'], run_id=run.id, tool_attempt_id=aid)
    # Workspace lock is held only in the post-I/O publication transaction. Append
    # against the latest version, retaining earlier claims and human conclusions.
    prior = c.execute("SELECT s.data FROM source_snapshots s JOIN workspace_files f ON f.workspace_id=s.workspace_id AND f.id=s.workspace_file_id "
        "WHERE s.workspace_id=%s AND f.conversation_id=%s AND f.owner_id=%s AND s.data->'locator'->>'kind'='public_source' "
        "AND s.data->'locator'->>'url'=%s ORDER BY s.version_number DESC LIMIT 1",
        (run.workspace_id, scope.id, p.id, request.url)).fetchone()
    previous = SourceSnapshot.model_validate(prior['data']) if prior else None
    fid = previous.workspace_file_id if previous else new_id()
    if not previous:
        c.execute('INSERT INTO workspace_files(workspace_id,id,conversation_id,owner_id,filename,mime_type) VALUES (%s,%s,%s,%s,%s,%s)',
            (run.workspace_id, fid, scope.id, p.id, 'public-source.txt', 'text/plain'))
    c.execute('INSERT INTO generated_blobs(workspace_id,id,owner_id,sha256,mime_type,bytes) VALUES (%s,%s,%s,%s,%s,%s)',
        (run.workspace_id, ref.blob_id, p.id, ref.sha256, ref.mime_type, raw))
    # Retrieval time is not a source-authored version timestamp. Retain the
    # opaque ETag and raw Last-Modified separately; parse only an aware valid date.
    from email.utils import parsedate_to_datetime
    version_at = None
    if ref.external_version.last_modified:
        try:
            candidate = parsedate_to_datetime(ref.external_version.last_modified)
            if candidate.tzinfo is not None: version_at = candidate
        except (ValueError, TypeError, OverflowError):
            pass
    snapshot = SourceSnapshot(snapshot_id=aid, workspace_file_id=fid, workspace_id=run.workspace_id,
        conversation_id=scope.id, version_number=previous.version_number+1 if previous else 1,
        parent_snapshot_id=previous.snapshot_id if previous else None, locator=ref, observed_at=now(),
        version_at=version_at, original_sha256=ref.sha256, extraction_sha256=ref.text_sha256,
        original_byte_length=len(raw), extraction_byte_length=len(text.encode()), parser_version=ref.extractor_version,
        extraction_status=ref.extraction_status, coverage=ref.coverage, omissions=ref.coverage.omissions)
    c.execute('INSERT INTO source_snapshots(workspace_id,id,workspace_file_id,version_number,parent_snapshot_id,data) VALUES (%s,%s,%s,%s,%s,%s)',
        (run.workspace_id, aid, fid, snapshot.version_number, snapshot.parent_snapshot_id, encoded(snapshot)))
    return snapshot


def validate_quote(text, ref):
    if (sha256(text.encode('utf-8')).hexdigest() != ref.text_sha256
            or ref.end > len(text) or text[ref.start:ref.end] != ref.quote):
        raise DomainError('source_changed')


def validate_claim(service, c, p, ws, cid, request):
    artifact, owner = service._artifact(c, p, ws, request.artifact_id)
    revision = service._revision(c, p, ws, artifact, owner, request.revision_id)
    if owner.id != cid or revision.body_hash != request.body_hash: deny()
    # Linking a new claim is exact-current CAS, never an acceptance or edit.
    service._cas(artifact, request.revision_id)
    from .source_snapshots import read
    for ref in request.evidence:
        snapshot, raw = read(service, c, p, ws, ref.snapshot_id)
        if snapshot.conversation_id != cid or snapshot.workspace_file_id != ref.workspace_file_id: deny()
        validate_quote(raw.decode('utf-8'), ref)


def append_claim(service, c, p, run, scope, aid, request):
    from .service import encoded
    validate_claim(service, c, p, run.workspace_id, scope.id, request)
    relations = {ref.relation for ref in request.evidence}
    status = 'unsupported' if not request.evidence else 'conflict' if {'supports','contradicts'} <= relations else 'not_assessed'
    claim = ResearchClaim(**request.model_dump(exclude={'kind'}), claim_id=aid, workspace_id=run.workspace_id,
        conversation_id=scope.id, run_id=run.id, tool_attempt_id=aid, created_at=now(), semantic_status=status)
    c.execute('INSERT INTO research_claims(workspace_id,id,artifact_id,revision_id,owner_id,tool_attempt_id,data) VALUES (%s,%s,%s,%s,%s,%s,%s)',
        (run.workspace_id, aid, request.artifact_id, request.revision_id, p.id, aid, encoded(claim)))
    return claim


def claims(service, p, ws, artifact_id, revision_id, body_hash):
    from .source_snapshots import read
    with service.db.transaction() as c:
        service._scope(c, p, ws)
        art, owner = service._artifact(c, p, ws, artifact_id)
        rev = service._revision(c, p, ws, art, owner, revision_id)
        if rev.body_hash != body_hash: raise DomainError('source_changed')
        rows = c.execute('SELECT data FROM research_claims WHERE workspace_id=%s AND artifact_id=%s AND revision_id=%s AND owner_id=%s ORDER BY id',
            (ws, artifact_id, revision_id, p.id)).fetchall()
        items = []
        for row in rows:
            claim = ResearchClaim.model_validate(row['data'])
            if not c.execute('SELECT research_claim_visible(%s,%s) AS ok', (ws, claim.claim_id)).fetchone()['ok']: continue
            newer = []; coverage = []
            try:
                for ref in claim.evidence:
                    snapshot, raw = read(service, c, p, ws, ref.snapshot_id)
                    validate_quote(raw.decode(), ref)
                    coverage.append(snapshot.extraction_status)
                    versions = c.execute('SELECT id FROM source_snapshots WHERE workspace_id=%s AND workspace_file_id=%s AND version_number>%s AND research_source_visible(workspace_id,id) ORDER BY version_number',
                        (ws, ref.workspace_file_id, snapshot.version_number)).fetchall()
                    newer.extend(r['id'] for r in versions)
            except DomainError:
                continue  # ACL BEFORE any claim text, quote, count or title exposure.
            items.append(ClaimFreshness(claim=claim, freshness='potentially_stale' if newer else 'current',
                newer_snapshot_ids=list(dict.fromkeys(newer)), coverage=coverage))
        return ArtifactClaims(artifact_id=artifact_id, revision_id=revision_id, body_hash=body_hash, items=items)


def project(service, c, p, run, cv, context, *, include_own=False):
    """Only visible exact settled outputs; sources never enter human-edit fingerprints."""
    rows = c.execute("SELECT s.id FROM source_snapshots s JOIN workspace_files f ON f.workspace_id=s.workspace_id AND f.id=s.workspace_file_id "
        "WHERE f.workspace_id=%s AND f.conversation_id=%s AND f.owner_id=%s AND s.data->'locator'->>'kind'='public_source' "
        "AND (%s OR s.data->'locator'->>'run_id'<>%s) AND research_source_visible(s.workspace_id,s.id) ORDER BY s.data->>'observed_at' DESC LIMIT 20", (run.workspace_id, cv.id, p.id, include_own, run.id)).fetchall()
    from .source_snapshots import read
    context['research_sources'] = [read(service,c,p,run.workspace_id,r['id'])[0].model_dump(mode='json', exclude={'locator':{'text'}}) for r in rows]
