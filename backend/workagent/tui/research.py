"""Read-only canonical research inspection. No drafts, writes or source copies."""
from dataclasses import dataclass
from urllib.parse import urlencode
from pydantic import TypeAdapter
from ..model_base import Hash
from ..operator_client import identifier
from ..operator_journal import OperatorError
from .files import read_file_range


@dataclass(frozen=True)
class ArtifactBinding:
    artifact_id: str
    revision_id: str
    body_hash: str

    def __post_init__(self):
        identifier(self.artifact_id)
        identifier(self.revision_id)
        TypeAdapter(Hash).validate_python(self.body_hash)


def selected_binding(artifact, history, revision_id):
    """Only an already-read saved revision can seed the inspector."""
    if not artifact:
        raise OperatorError('Select a saved result and exact revision first')
    rid = revision_id or artifact['current_revision_id']
    revision = next((r for r in history + [artifact['current_revision']] if r['id'] == rid), None)
    if revision is None:
        raise OperatorError('Selected exact revision unavailable')
    return ArtifactBinding(artifact['id'], rid, revision['body_hash'])


class ResearchController:
    def __init__(self, client, workspace, principal, conversation):
        self.client, self.endpoint = client, client.base
        self.workspace, self.principal = identifier(workspace), identifier(principal)
        self.conversation = identifier(conversation)
        self.root = '/' + self.workspace

    def authorize(self):
        if self.client.base != self.endpoint or self.client.identity(self.workspace) != self.principal:
            raise OperatorError('Authenticated research scope changed; reconnect')

    def check_snapshot(self, item):
        if item.workspace_id != self.workspace or item.conversation_id != self.conversation:
            raise OperatorError('Research snapshot scope mismatch')

    def listing(self, after=None):
        # Lazy canonical imports keep the rest of the client usable during integration.
        from ..research_api import ResearchSnapshotPage
        self.authorize()
        query = dict(limit=25)
        if after:
            query['after'] = identifier(after)
        page = ResearchSnapshotPage.model_validate(self.client.request(self.root + '/work-areas/' +
            self.conversation + '/research/snapshots?' + urlencode(query)))
        for item in page.items:
            self.check_snapshot(item)
        return page

    def snapshot(self, snapshot_id, expected=None):
        from ..workspace_file_models import SourceSnapshot, FileVersionRef
        self.authorize()
        item = SourceSnapshot.model_validate(self.client.request(self.root + '/research/snapshots/' + identifier(snapshot_id)))
        self.check_snapshot(item)
        if item.snapshot_id != snapshot_id:
            raise OperatorError('Exact research snapshot mismatch')
        ref = FileVersionRef(workspace_file_id=item.workspace_file_id, version_id=item.snapshot_id,
                             sha256=item.extraction_sha256)
        if expected is not None and ref != FileVersionRef.model_validate(expected):
            raise OperatorError('Exact source file/hash mismatch')
        return item

    def source_range(self, snapshot, offset=0):
        # Reauthorize the exact source on every range, including after revocation.
        current = self.snapshot(snapshot.snapshot_id, dict(workspace_file_id=snapshot.workspace_file_id,
            version_id=snapshot.snapshot_id, sha256=snapshot.extraction_sha256))
        part = read_file_range(self.client, self.root, dict(workspace_file_id=current.workspace_file_id,
            version_id=current.snapshot_id, sha256=current.extraction_sha256), offset)
        if part.source_snapshot_id != current.snapshot_id or part.byte_length != current.extraction_byte_length:
            raise OperatorError('Exact source range identity/length mismatch')
        return current, part

    def claims(self, binding):
        from ..research_models import ArtifactClaims
        self.authorize()
        result = ArtifactClaims.model_validate(self.client.request(self.root + '/artifacts/' + binding.artifact_id +
            '/revisions/' + binding.revision_id + '/research/claims?' + urlencode(dict(body_hash=binding.body_hash))))
        if (result.artifact_id, result.revision_id, result.body_hash) != (binding.artifact_id, binding.revision_id, binding.body_hash):
            raise OperatorError('Exact artifact/revision/body hash mismatch')
        for item in result.items:
            claim = item.claim
            if (claim.workspace_id != self.workspace or claim.conversation_id != self.conversation or
                    (claim.artifact_id, claim.revision_id, claim.body_hash) !=
                    (binding.artifact_id, binding.revision_id, binding.body_hash)):
                raise OperatorError('Claim scope or exact revision mismatch')
        return result


def snapshot_text(item):
    lines = [f'Snapshot {item.snapshot_id}', f'Workspace file {item.workspace_file_id}',
        f'Version {item.version_number} · parent {item.parent_snapshot_id or "none"}',
        f'Raw SHA256 {item.original_sha256}', f'Text SHA256 {item.extraction_sha256}',
        f'Raw bytes {item.original_byte_length} · extracted bytes {item.extraction_byte_length}',
        f'Observed {item.observed_at.isoformat()} · version time {item.version_at or "unknown"}',
        f'Parser {item.parser_version} · extraction {item.extraction_status}',
        'Trust: untrusted evidence. Source relationships do not verify claim semantics.']
    loc = item.locator
    if loc.kind == 'public_source':
        partial = not loc.coverage.body_complete or not loc.coverage.text_complete or loc.extraction_status != 'extracted'
        lines += [f'Title {loc.title or "untitled"}', f'URL {loc.url}', f'Final URL {loc.final_url}',
            f'Fetched {loc.fetched_at.isoformat()} · HTTP {loc.status_code}',
            f'Extractor {loc.extractor_version} · browser used {loc.browser_used}',
            f'Coverage {"partial" if partial else "complete extraction (not semantic verification)"}',
            f'Body complete {loc.coverage.body_complete} · text complete {loc.coverage.text_complete}',
            f'ETag {loc.external_version.etag or "unknown"} · Last-Modified {loc.external_version.last_modified or "unknown"}',
            'Extraction omissions: ' + ('; '.join(loc.coverage.omissions) or 'none')]
        lines += [f'Redirect {r.status}: {r.url} → {r.location}' for r in loc.redirects]
    else:
        lines.append('Source kind: ' + loc.kind)
    if item.coverage is not None:
        lines.append('Snapshot coverage: ' + item.coverage.model_dump_json())
    lines.append('Snapshot omissions: ' + ('; '.join(item.omissions) or 'none'))
    return '\n'.join(lines)


def claims_text(result):
    lines = [result.semantic_notice, 'supports / contradicts / context are recorded relationships, not semantic verification.']
    if not result.items:
        lines.append('No retained claims for this exact revision. This does not establish support.')
    for item in result.items:
        claim = item.claim
        partial = any(c != 'extracted' for c in item.coverage)
        lines += [f'\nClaim {claim.claim_id}: {claim.claim}',
            f'Semantics: {claim.semantic_status} · freshness: {item.freshness}',
            'Coverage: ' + ('partial' if partial else 'no partial extraction reported; completeness not established') +
            ' · ' + (', '.join(item.coverage) or 'no source coverage'),
            'Newer snapshots: ' + (', '.join(item.newer_snapshot_ids) or 'none reported')]
        for ref in claim.evidence:
            lines += [f'{ref.relation} · file {ref.workspace_file_id} · snapshot {ref.snapshot_id}',
                f'Text SHA256 {ref.text_sha256}', f'Unicode character range [{ref.start}, {ref.end}) (end exclusive)', ref.quote]
    return '\n'.join(lines)
