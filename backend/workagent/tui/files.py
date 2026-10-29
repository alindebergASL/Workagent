"""Exact-version working-file operations; independent of composer commands."""
import copy
from hashlib import sha256
from uuid import uuid4
from urllib.parse import urlencode
from ..operator_client import identifier
from ..operator_journal import OperatorError, DomainRejection, valid_rejection
from ..workspace_file_models import (MAX_FILE_BYTES, TEXT_MIMES, CreateWorkspaceFile,
    EditWorkspaceFile, ExportFile, ExportManifest, WorkspaceFile, WorkspaceFilePage,
    FileVersionRef, FileRange, SourceSnapshot)
from .file_drafts import new_file_draft


def normalized(text):
    return text.replace('\r\n', '\n').replace('\r', '\n')


def editor_content(original, edited, newline):
    # Textual normalizes at load. Unchanged text must retain its actual bytes.
    if normalized(original) == normalized(edited):
        return original
    edited = normalized(edited)
    return edited.replace('\n', {'crlf': '\r\n', 'cr': '\r'}.get(newline, '\n'))


def read_file_range(client, root, ref, offset=0):
    """Shared bounded exact read; research inspection never opens a draft."""
    ref = FileVersionRef.model_validate(ref)
    result = FileRange.model_validate(client.request(root + '/files/' +
        identifier(ref.workspace_file_id) + '/versions/' + identifier(ref.version_id) + '?' +
        urlencode(dict(sha256=ref.sha256, offset=offset, limit=8192))))
    raw = result.text.encode('utf-8')
    if (result.ref != ref or result.offset != offset or result.next_offset != offset + len(raw)
            or len(raw) > 8192 or result.next_offset > result.byte_length
            or sha256(raw).hexdigest() != result.chunk_sha256):
        raise OperatorError('Exact file range/hash mismatch; draft retained')
    return result


class FilesController:
    def __init__(self, client, session):
        self.client, self.session = client, session
        self.scope = session.store.scope
        self.root = '/' + identifier(self.scope['workspace'])
        self.area = self.root + '/work-areas/' + identifier(self.scope['conversation'])
        self.version = None
        self.page = None

    def authorize(self):
        if self.client.base != self.scope['endpoint'] or self.client.identity(self.scope['workspace']) != self.scope['principal']:
            raise OperatorError('Authenticated file draft scope changed; reconnect')

    def refresh(self, after=None):
        self.authorize()
        detail = self.client.request(self.root + '/conversations/' + identifier(self.scope['conversation']))
        version = detail['conversation']['work_version']
        if type(version) is not int or version < 1:
            raise OperatorError('Invalid current conversation version')
        page = WorkspaceFilePage.model_validate(self.client.request(
            self.area + '/files?' + urlencode(dict(limit=25, **({'after': identifier(after)} if after else {})))))
        for item in page.items:
            self.check_file(item)
        self.version, self.page = version, page
        return page

    def check_file(self, item):
        if item.workspace_id != self.scope['workspace'] or item.conversation_id != self.scope['conversation'] or item.current.workspace_file_id != item.workspace_file_id:
            raise OperatorError('File readback scope mismatch')

    def read_range(self, ref, offset=0):
        return read_file_range(self.client, self.root, ref, offset)

    def read_exact(self, ref):
        chunks = []
        offset = 0
        first = None
        for _ in range(26):
            part = self.read_range(ref, offset)
            first = first or part
            if part.byte_length != first.byte_length:
                raise OperatorError('File length changed during exact read')
            if part.byte_length > MAX_FILE_BYTES:
                raise OperatorError('File exceeds editor limit; use bounded range view')
            chunks.append(part.text)
            if part.next_offset == part.byte_length:
                content = ''.join(chunks)
                if sha256(content.encode()).hexdigest() != part.ref.sha256:
                    raise OperatorError('Full file hash mismatch; draft retained')
                return content, first
            if part.next_offset <= offset:
                raise OperatorError('File range did not advance')
            offset = part.next_offset
        raise OperatorError('File read bound exceeded')

    def open_file(self, item):
        self.authorize()
        item = WorkspaceFile.model_validate(item)
        self.check_file(item)
        key = item.workspace_file_id + ':' + item.current.version_id
        if key not in self.session.state['drafts']:
            if item.byte_length > MAX_FILE_BYTES and not item.editable:
                part = self.read_range(item.current)
                content = part.text
            else:
                content, part = self.read_exact(item.current)
            source_omissions = None
            if part.source_snapshot_id:
                snapshot = SourceSnapshot.model_validate(self.client.request(self.root + '/source-snapshots/' + identifier(part.source_snapshot_id)))
                if (snapshot.workspace_id != self.scope['workspace'] or snapshot.conversation_id != self.scope['conversation']
                        or snapshot.workspace_file_id != item.workspace_file_id or snapshot.extraction_sha256 != item.current.sha256):
                    raise OperatorError('Source snapshot scope/hash mismatch')
                source_omissions = snapshot.omissions
            draft = new_file_draft()
            draft.update(filename=item.filename, mime_type=item.mime_type if item.mime_type in TEXT_MIMES.values() else 'text/plain', content=content,
                base=dict(file=item.model_dump(mode='json'), newline=part.newline,
                          normalize=False, original_sha256=item.current.sha256,
                          visible_bytes=len(content.encode()), total_bytes=part.byte_length, source_omissions=source_omissions))
            self.session.select(key, initial=draft)
        else:
            self.session.select(key)
        return key

    def prepare(self, action, format='txt'):
        draft = self.session.draft
        if draft['pending']:
            raise OperatorError('Resolve pending command using Read back, Replay exact or Resolve rejection')
        cid = str(uuid4())
        common = dict(schema_version='workagent/v1', request_id=cid, command_id=cid)
        base = draft['base']
        if action == 'export':
            if not base:
                raise OperatorError('Save a file before exporting an exact version')
            ref = base['file']['current']
            body = ExportFile(**common, version_id=ref['version_id'], sha256=ref['sha256'], format=format)
            path = self.root + '/files/' + identifier(ref['workspace_file_id']) + '/exports'
        else:
            if self.version is None:
                raise OperatorError('Refresh to read the current conversation version first')
            content = draft['content']
            hash_ = sha256(content.encode()).hexdigest()
            if base:
                if not base['file']['editable']:
                    raise OperatorError('Original evidence is immutable')
                if base['newline'] == 'mixed' and hash_ != base['original_sha256'] and not base['normalize']:
                    raise OperatorError('Mixed line endings: explicitly allow LF normalization before saving edits')
                ref = base['file']['current']
                body = EditWorkspaceFile(**common, expected_work_version=self.version,
                    base_version_id=ref['version_id'], base_sha256=ref['sha256'], content=content, sha256=hash_)
                path = self.root + '/files/' + identifier(ref['workspace_file_id']) + '/versions'
                action = 'edit'
            else:
                mime = TEXT_MIMES.get(draft['filename'].rsplit('.', 1)[-1])
                body = CreateWorkspaceFile(**common, expected_work_version=self.version,
                    source=dict(kind='text', filename=draft['filename'], mime_type=mime, content=content, sha256=hash_))
                path = self.area + '/files'
                action = 'create'
        from ..operator_client import OperatorClient
        OperatorClient.wire_body(body.model_dump(mode='json'))
        record = dict(action=action, path=path, body=body.model_dump(mode='json'),
                      scope=copy.deepcopy(self.scope), receipt=None, state='prepared')
        # Persist complete envelope BEFORE any POST. Never rebuild it on retry.
        self.session.edit(pending=record)
        return record

    def pending(self):
        record = self.session.draft['pending']
        if not record or record.get('scope') != self.scope:
            raise OperatorError('No pending command in this authenticated scope')
        models = {'create': CreateWorkspaceFile, 'edit': EditWorkspaceFile, 'export': ExportFile}
        action = record['action']
        body = models[action].model_validate(record['body'])
        if body.command_id != body.request_id:
            raise OperatorError('Retained command identity mismatch')
        if action == 'create':
            expected = self.area + '/files'
        else:
            base = self.session.draft['base']['file']['current']
            expected = self.root + '/files/' + identifier(base['workspace_file_id']) + ('/versions' if action == 'edit' else '/exports')
            if action == 'edit' and (body.base_version_id != base['version_id'] or body.base_sha256 != base['sha256']):
                raise OperatorError('Retained edit base mismatch')
            if action == 'export' and (body.version_id != base['version_id'] or body.sha256 != base['sha256']):
                raise OperatorError('Retained export base mismatch')
        if record['path'] != expected:
            raise OperatorError('Retained command path mismatch')
        return record

    def send(self):
        self.authorize()
        record = self.pending()
        if record.get('state') == 'rejected':
            raise OperatorError('Definitively rejected; use Resolve rejection before preparing a new command')
        first = record.get('state') == 'prepared' and record['receipt'] is None
        retained = copy.deepcopy(record)
        # Crash/timeout after this durable marker is ambiguous, even if a later
        # replay rejects. Legacy envelopes without a state are ambiguous too.
        retained['state'] = 'outcome_unknown'
        self.session.edit(pending=retained)
        try:
            result = self.client.request(record['path'], copy.deepcopy(record['body']))
        except DomainRejection as exc:
            if first and valid_rejection(exc.rejection, record['body']['request_id'], path=record['path']):
                retained.update(state='rejected', rejection=copy.deepcopy(exc.rejection))
                self.session.edit(pending=retained)
            raise
        retained['receipt'] = result
        retained['state'] = 'readback_unknown'
        self.session.edit(pending=retained)
        return self.readback()

    def resolve_rejection(self):
        record = self.pending()
        if (record.get('state') != 'rejected' or record['receipt'] is not None or
                not valid_rejection(record.get('rejection'), record['body']['request_id'], path=record['path'])):
            raise OperatorError('Verified first-attempt rejection required; unknown outcome remains locked')
        self.refresh()  # Refresh conversation CAS only; NEVER rebase the file.
        history = 'rejected:' + record['body']['command_id']
        self.session.state['drafts'][history] = copy.deepcopy(self.session.draft)
        self.session.draft.update(pending=None, proposal=copy.deepcopy(record))
        self.session.draft['generation'] += 1
        self.session.save()  # Archive and unlock atomically; text/base unchanged.
        return 'Rejected envelope archived. Text and exact file base retained; Save prepares a new command.'

    def readback(self):
        self.authorize()
        record = self.pending()
        receipt = record['receipt']
        if receipt is None:
            raise OperatorError('No acknowledged receipt. Explicit Replay exact reuses the saved command ID and body')
        if record['action'] == 'export':
            manifest = ExportManifest.model_validate(receipt)
            if (manifest.workspace_id != self.scope['workspace'] or manifest.conversation_id != self.scope['conversation']
                    or manifest.workspace_file_id != self.session.draft['base']['file']['workspace_file_id']
                    or manifest.revision_id != record['body']['version_id']
                    or manifest.input_sha256 != record['body']['sha256'] or manifest.format != record['body']['format']):
                raise OperatorError('Export receipt exact binding mismatch')
            self.session.edit(export=manifest.model_dump(mode='json'), pending=None, proposal=record)
            return 'Export ready; download verifies actual bytes and hash.'
        item = WorkspaceFile.model_validate(receipt)
        self.check_file(item)
        expected = record['body']['source']['sha256'] if record['action'] == 'create' else record['body']['sha256']
        if item.current.sha256 != expected or (record['action'] == 'edit' and item.workspace_file_id != self.session.draft['base']['file']['workspace_file_id']):
            raise OperatorError('Saved file receipt hash/identity mismatch')
        self.read_exact(item.current)  # Never follow the moving current head.
        self.session.edit(pending=None, proposal=record)
        # Keep old draft; open the confirmed exact saved version as a separate draft.
        self.open_file(item)
        self.version = None
        return 'Saved exact version and SHA256 verified. Earlier draft retained. Refresh list before the next save.'
