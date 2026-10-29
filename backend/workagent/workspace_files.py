"""Scoped working text backed by artifact revisions; evidence backed by original refs."""
import difflib
from hashlib import sha256
from pydantic import ValidationError
from .errors import DomainError, deny
from .models import Artifact, Proposal, new_id
from .product_models import FileBody
from .workspace_file_models import (WorkspaceFile, WorkspaceFilePage, FileVersionRef, FileRange,
    FileComparison, WorkingText, validate_text, OmittedByteRange)
from . import source_snapshots


def omissions(raw, start, end):
    return [OmittedByteRange(start=a, end=b, sha256=sha256(raw[a:b]).hexdigest())
            for a, b in ((0, start), (end, len(raw))) if a < b]


def newline_style(raw):
    text = raw.decode('utf-8')
    crlf = text.count('\r\n')
    styles = [label for label, count in [('crlf', crlf), ('lf', text.count('\n') - crlf),
                                        ('cr', text.count('\r') - crlf)] if count]
    return styles[0] if len(styles) == 1 else 'mixed' if styles else 'none'


def range_result(ref, raw, offset, limit, snapshot_id=None):
    from .retained_results import page_bytes
    page = page_bytes(raw, offset, limit)
    end = page['next_offset']
    return FileRange(ref=ref, text=page['text'], offset=offset, next_offset=end,
        byte_length=len(raw), chunk_sha256=sha256(raw[offset:end]).hexdigest(),
        omitted_ranges=omissions(raw, offset, end), source_snapshot_id=snapshot_id,
        has_utf8_bom=raw.startswith(b'\xef\xbb\xbf'), newline=newline_style(raw))


def text_body(content, expected_hash, mime_type):
    try:
        raw = validate_text(content, mime_type)
        if sha256(raw).hexdigest() != expected_hash:
            raise ValueError('hash mismatch')
        # FileBody's historical schema is frozen. Its neutral text envelope preserves
        # exact bytes; the file's public filename/MIME are immutable scoped metadata.
        return FileBody(title='Working file', filename='content.txt', mime_type='text/plain',
                        content=content, content_sha256=expected_hash)
    except (ValueError, ValidationError) as exc:
        raise DomainError('validation_error', fields=['content', 'sha256']) from exc


class WorkspaceFiles:
    def _own_file_drafts(self, c, p, run, cv):
        """Exclude only this run's settled, untouched exact output from frozen inputs.

        File creation commits inside the gateway before the provider tool-result
        checkpoint. Its immutable observation, not that later checkpoint, binds
        the addition. Unknown/unsettled effects remain unresolved; human edits
        must fence the run instead of being normalized or recreated.
        """
        from .service import digest
        from .capabilities.observations import observation
        rows = c.execute("SELECT a.id,a.call,e.data FROM tool_attempts a "
            "JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation' "
            "WHERE a.workspace_id=%s AND a.run_id=%s AND a.capability_id='files.create_draft' "
            "ORDER BY a.id", (run.workspace_id, run.id)).fetchall()
        materials = []
        for row in rows:
            obs = observation(row['data'])
            if obs.status != 'observed':
                continue
            source = row['call']['arguments']['source']
            output = obs.output
            if (obs.attempt_id != row['id'] or obs.run_id != run.id
                    or obs.call_id != row['call']['call_id']
                    or obs.capability_id != 'files.create_draft'
                    or output is None or digest(output) != obs.output_sha256
                    or output.get('capability') != 'files_create_draft'):
                raise DomainError('source_changed')
            saved = WorkspaceFile.model_validate(output['result'])
            current = self._file_info(c, p, run.workspace_id, row['id'])
            artifact, owner = self._artifact(c, p, run.workspace_id, row['id'])
            revision = self._revision(c, p, run.workspace_id, artifact, owner, current.current.version_id)
            if (saved != current or current.workspace_file_id != row['id']
                    or current.conversation_id != cv.id or current.workspace_id != run.workspace_id
                    or current.filename != source['filename'] or current.mime_type != source['mime_type']
                    or current.current.sha256 != source['sha256']
                    or revision.author_id != run.principal_id or revision.author_kind != 'worker'
                    or revision.revision_number != 1 or revision.body.content != source['content']):
                raise DomainError('source_changed')
            materials.append({'phase':obs.call_id, 'artifact_id':row['id'],
                'revision_id':revision.id, 'observation_id':row['id'],
                'body_hash':revision.body_hash, 'tool_attempt_id':row['id'],
                'validation':'shape_only', 'goal_status':'needs_validation'})
        return materials

    def _file_row(self, c, p, ws, file_id):
        row = c.execute('SELECT * FROM workspace_files WHERE workspace_id=%s AND id=%s AND owner_id=%s',
                        (ws, file_id, p.id)).fetchone()
        if not row:
            deny()
        self._document_scope(c, p, ws, row['conversation_id'])
        return row

    def _file_version(self, c, p, ws, file_id, version_id):
        from .service import digest
        row = self._file_row(c, p, ws, file_id)
        if row['artifact_id']:
            artifact, cv = self._artifact(c, p, ws, row['artifact_id'])
            revision = self._revision(c, p, ws, artifact, cv, version_id)
            body = revision.body
            if not isinstance(body, FileBody) or digest(body) != revision.body_hash:
                raise DomainError('source_changed')
            raw = body.content.encode('utf-8')
            if sha256(raw).hexdigest() != body.content_sha256:
                raise DomainError('source_changed')
            snapshot_id = None
        else:
            snapshot, raw = source_snapshots.read(self, c, p, ws, version_id)
            if snapshot.workspace_file_id != file_id:
                deny()
            snapshot_id = snapshot.snapshot_id
        ref = FileVersionRef(workspace_file_id=file_id, version_id=version_id, sha256=sha256(raw).hexdigest())
        return row, ref, raw, snapshot_id

    def _file_current_id(self, c, row):
        if row['artifact_id']:
            return c.execute('SELECT current_revision_id FROM artifacts WHERE workspace_id=%s AND id=%s',
                             (row['workspace_id'], row['artifact_id'])).fetchone()['current_revision_id']
        latest = c.execute('SELECT id FROM source_snapshots WHERE workspace_id=%s AND workspace_file_id=%s AND research_source_visible(workspace_id,id) ORDER BY version_number DESC LIMIT 1',
                           (row['workspace_id'], row['id'])).fetchone()
        if not latest:
            raise DomainError('source_changed')
        return latest['id']

    def _file_info(self, c, p, ws, file_id):
        row = self._file_row(c, p, ws, file_id)
        _, ref, raw, _ = self._file_version(c, p, ws, file_id, self._file_current_id(c, row))
        return WorkspaceFile(workspace_file_id=file_id, workspace_id=ws, conversation_id=row['conversation_id'],
            filename=row['filename'], mime_type=row['mime_type'],
            storage='artifact_revision' if row['artifact_id'] else 'source_snapshot',
            current=ref, byte_length=len(raw), editable=bool(row['artifact_id']))

    def _list_workspace_files(self, c, p, ws, cid, after=None, limit=25, selectors=None):
        self._document_scope(c, p, ws, cid)
        if not 1 <= limit <= 100:
            raise DomainError('validation_error')
        # The gateway supplies exact granted file selectors; filter BEFORE paging.
        predicate = ' AND (artifact_id IS NOT NULL OR EXISTS (SELECT 1 FROM source_snapshots s WHERE s.workspace_id=workspace_files.workspace_id AND s.workspace_file_id=workspace_files.id AND research_source_visible(s.workspace_id,s.id)))'
        if selectors is not None: predicate += ' AND id=ANY(%s)'
        args = [ws, cid, p.id, after or '']
        if selectors is not None:
            args.append([ref.id for ref in selectors if ref.kind == 'workspace_file'])
        # Resolve authorized current versions before counts/pagination. All rows
        # are same-owner and bounded; stale selectors do not disclose a new version.
        rows = c.execute('SELECT id FROM workspace_files WHERE workspace_id=%s AND conversation_id=%s AND owner_id=%s AND id>%s' + predicate + ' ORDER BY id LIMIT %s', [*args, 101 if selectors is not None else limit + 1]).fetchall()
        items = []
        for row in rows:
            info = self._file_info(c, p, ws, row['id'])
            if selectors is not None and not any(ref.kind == 'workspace_file' and ref.id == info.workspace_file_id
                    and ref.version == info.current.version_id and ref.sha256 == info.current.sha256 for ref in selectors):
                continue
            items.append(info)
            if len(items) > limit:
                break
        return WorkspaceFilePage(items=items[:limit], next_after=items[limit-1].workspace_file_id if len(items) > limit else None)

    def list_workspace_files(self, p, ws, cid, after=None, limit=25):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            return self._list_workspace_files(c, p, ws, cid, after, limit)

    def _create_text_file(self, c, p, ws, cv, source, author_kind, file_id=None):
        from .service import encoded
        body = text_body(source.content, source.sha256, source.mime_type)
        file_id = file_id or new_id()
        c.execute('INSERT INTO artifacts(workspace_id,id,conversation_id) VALUES (%s,%s,%s)', (ws, file_id, cv.id))
        c.execute('INSERT INTO workspace_files(workspace_id,id,conversation_id,owner_id,artifact_id,filename,mime_type) VALUES (%s,%s,%s,%s,%s,%s,%s)',
                  (ws, file_id, cv.id, p.id, file_id, source.filename, source.mime_type))
        artifact, _ = self._artifact(c, p, ws, file_id)
        self._append_revision(c, p, ws, artifact, cv, body, cv.selected_source_refs, author_kind)
        self._event(c, p, ws, 'workspace_file_created', file_id)
        return self._file_info(c, p, ws, file_id)

    def create_workspace_file(self, p, ws, cid, cmd):
        def mutate(c, cv):
            self._conversation_cas(cv, cmd.expected_work_version)
            if isinstance(cmd.source, WorkingText):
                return self._create_text_file(c, p, ws, cv, cmd.source, 'human')
            previous = None
            if cmd.refresh_workspace_file_id:
                row = self._file_row(c, p, ws, cmd.refresh_workspace_file_id)
                if row['conversation_id'] != cid or row['artifact_id']:
                    deny()
                if self._file_current_id(c, row) != cmd.expected_version_id:
                    raise DomainError('version_conflict')
                previous, _ = source_snapshots.read(self, c, p, ws, cmd.expected_version_id)
                file_id = row['id']
            else:
                name, mime, *_ = source_snapshots.evidence(self, c, p, ws, cid, cmd.source)
                file_id = new_id()
                c.execute('INSERT INTO workspace_files(workspace_id,id,conversation_id,owner_id,filename,mime_type) VALUES (%s,%s,%s,%s,%s,%s)',
                          (ws, file_id, cid, p.id, name, mime))
            source_snapshots.append(self, c, p, ws, cid, file_id, cmd.source, previous)
            self._event(c, p, ws, 'source_snapshot_created', cid)
            return self._file_info(c, p, ws, file_id)
        return self._command(p, ws, 'create_workspace_file', {'conversation_id': cid}, cmd,
            WorkspaceFile, lambda c: self._document_scope(c, p, ws, cid), mutate)

    def read_workspace_file(self, p, ws, file_id, version_id, expected_sha256, offset=0, limit=8192):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            _, ref, raw, snapshot = self._file_version(c, p, ws, file_id, version_id)
            if ref.sha256 != expected_sha256:
                raise DomainError('source_changed')
            return range_result(ref, raw, offset, limit, snapshot)

    def _file_base(self, c, p, ws, file_id, version_id, expected_hash):
        row, ref, raw, _ = self._file_version(c, p, ws, file_id, version_id)
        if not row['artifact_id']:
            raise DomainError('unsupported_operation')
        artifact, cv = self._artifact(c, p, ws, row['artifact_id'])
        self._cas(artifact, version_id)
        if ref.sha256 != expected_hash:
            raise DomainError('source_changed')
        return row, artifact, cv

    def _propose_file_patch(self, c, p, ws, file_id, cmd):
        from .service import digest, encoded
        row, artifact, cv = self._file_base(c, p, ws, file_id, cmd.base_version_id, cmd.base_sha256)
        self._conversation_cas(cv, cmd.expected_work_version)
        body = text_body(cmd.content, cmd.sha256, row['mime_type'])
        proposal = Proposal(id=new_id(), workspace_id=ws, conversation_id=cv.id, artifact_id=artifact['id'],
            base_revision_id=cmd.base_version_id, base_work_version=cv.work_version, body=body,
            body_hash=digest(body), source_dependencies=cv.selected_source_refs, reason=cmd.reason)
        c.execute('INSERT INTO proposals(workspace_id,id,artifact_id,base_revision_id,data) VALUES (%s,%s,%s,%s,%s)',
                  (ws, proposal.id, artifact['id'], cmd.base_version_id, encoded(proposal)))
        self._event(c, p, ws, 'workspace_file_proposed', proposal.id)
        return proposal

    def propose_file_patch(self, p, ws, file_id, cmd):
        return self._command(p, ws, 'propose_file_patch', {'workspace_file_id': file_id}, cmd, Proposal,
            lambda c: self._file_row(c, p, ws, file_id),
            lambda c, _: self._propose_file_patch(c, p, ws, file_id, cmd))

    def edit_workspace_file(self, p, ws, file_id, cmd):
        def mutate(c, _):
            row, artifact, cv = self._file_base(c, p, ws, file_id, cmd.base_version_id, cmd.base_sha256)
            self._conversation_cas(cv, cmd.expected_work_version)
            current = self._revision(c, p, ws, artifact, cv)
            body = text_body(cmd.content, cmd.sha256, row['mime_type'])
            self._append_revision(c, p, ws, artifact, cv, body, current.source_dependencies, 'human')
            self._event(c, p, ws, 'human_save', artifact['id'])
            return self._file_info(c, p, ws, file_id)
        return self._command(p, ws, 'edit_workspace_file', {'workspace_file_id': file_id}, cmd, WorkspaceFile,
            lambda c: self._file_row(c, p, ws, file_id), mutate)

    def accept_file_proposal(self, p, ws, file_id, proposal_id, cmd):
        def authorize(c):
            row = self._file_row(c, p, ws, file_id)
            state = self._proposal(c, p, ws, proposal_id)
            if state[0].artifact_id != row['artifact_id']:
                deny()
            return state
        def mutate(c, state):
            self._file_base(c, p, ws, file_id, cmd.expected_current_revision_id, cmd.expected_sha256)
            self._accept_proposal_mutation(c, p, ws, cmd, state)
            return self._file_info(c, p, ws, file_id)
        return self._command(p, ws, 'accept_file_proposal', {'workspace_file_id': file_id, 'proposal_id': proposal_id},
                             cmd, WorkspaceFile, authorize, mutate)

    def _compare_workspace_files(self, c, p, ws, file_id, left_version_id, left_sha256, right_version_id, right_sha256):
        _, left, a, _ = self._file_version(c, p, ws, file_id, left_version_id)
        _, right, b, _ = self._file_version(c, p, ws, file_id, right_version_id)
        if left.sha256 != left_sha256 or right.sha256 != right_sha256:
            raise DomainError('source_changed')
        # Character-wise lines remain exact (including BOM/CRLF). Presentation is
        # bounded separately; the original versions remain available by byte range.
        # Bound quadratic diff work to 8 KiB of each exact input. Source omissions
        # are separate from diff-output omissions; identical compares full hashes.
        left_text = a[:8192].decode('utf-8', 'ignore')
        right_text = b[:8192].decode('utf-8', 'ignore')
        raw = ''.join(difflib.unified_diff(left_text.splitlines(keepends=True), right_text.splitlines(keepends=True),
                                         fromfile=left.version_id, tofile=right.version_id)).encode()
        diff = raw[:8192].decode('utf-8', 'ignore')
        return FileComparison(left=left, right=right, identical=a == b, diff=diff,
            diff_sha256=sha256(raw).hexdigest(), diff_bytes=len(raw), omitted_diff_ranges=omissions(raw, 0, len(diff.encode())),
            left_omitted_ranges=omissions(a, 0, len(left_text.encode())),
            right_omitted_ranges=omissions(b, 0, len(right_text.encode())))

    def compare_workspace_files(self, p, ws, file_id, left_version_id, left_sha256, right_version_id, right_sha256):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            return self._compare_workspace_files(c, p, ws, file_id, left_version_id, left_sha256, right_version_id, right_sha256)

    def get_source_snapshot(self, p, ws, snapshot_id):
        with self.db.transaction() as c:
            self._scope(c, p, ws)
            return source_snapshots.read(self, c, p, ws, snapshot_id)[0]
