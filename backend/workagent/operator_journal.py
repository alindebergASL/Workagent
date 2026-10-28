"""Private bounded command envelopes, not a queue. Contains unredacted prompts.

No credentials are stored. New IDs are exclusive; existing envelopes cannot be
replaced by a new invocation. Only outcome/receipt metadata may change. POSIX
no-follow directory handles keep untrusted paths and symlinks out of writes.

The record's format selects the client's validation grammar, not a storage
migration. Format-1 records and their digests remain unchanged; format-2 new
accepts carry explicit review booleans. Never insert defaults into stored bodies
here: outcome updates must preserve the original record and its payload bytes.
"""
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import uuid


class OperatorError(Exception):
    pass


class ReadUnavailable(OperatorError):
    """Transient GET failure, never a mutation outcome or access denial."""


# Deliberately narrow: these domain failures reject the transaction before effects.
REJECTION_CODES = {'version_conflict', 'source_changed', 'review_required'}


def valid_rejection(value, request_id, *, path=None):
    if not isinstance(value, dict) or set(value) != {'status', 'response'}:
        return False
    response = value['response']
    if (type(value['status']) is not int or
            not isinstance(response, dict) or set(response) !=
            {'code', 'message', 'request_id', 'next_action', 'details'} or
            not isinstance(response.get('code'),str) or
            response.get('request_id') != request_id):
        return False
    code=response['code'];status=value['status']
    # Endpoint-specific, proven pre-effect failures only. execute() still
    # refuses to settle any earlier ambiguous POST with a later rejection.
    allowed=(status==409 and code in REJECTION_CODES)
    if isinstance(path,str):
        allowed=allowed or (status==409 and code=='action_unresolved' and
            re.fullmatch(r'/[^/]+/conversations/[^/]+/stop',path) is not None)
        allowed=allowed or (status==422 and code=='validation_error' and
            re.fullmatch(r'/[^/]+/conversations/[^/]+/documents',path) is not None)
    if not allowed:return False
    from .models import ErrorEnvelope
    try: ErrorEnvelope.model_validate(response)
    except ValueError: return False
    return True


class DomainRejection(OperatorError):
    def __init__(self, rejection):
        self.rejection = rejection
        super().__init__('HTTP '+str(rejection['status'])+': ' + rejection['response']['code'] + '; command rejected')


MAX_RECORDS = 256
MAX_BYTES = 1024 * 1024


def digest(record):
    return hashlib.sha256(json.dumps(record, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class CommandJournal:
    def __init__(self):
        self.path = os.environ.get('WORKAGENT_OPERATOR_JOURNAL', str(Path.home()/'.local/state/workagent-commands'))

    @contextmanager
    def directory(self):
        fd = None
        try:
            path = Path(self.path)
            if not path.is_absolute() or '..' in path.parts or path == Path('/'):
                raise OperatorError('Journal requires an absolute non-traversing private path')
            fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            for part in path.parts[1:]:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = next_fd
                info = os.fstat(fd)
                if info.st_uid not in (0, os.getuid()):
                    raise OperatorError('Untrusted journal parent directory')
            info = os.fstat(fd)
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
                raise OperatorError('Journal directory must be owned by you with mode 700')
            # Serializes reservations and outcome writes, never holds a network call.
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield fd
        except (OSError, ValueError, TypeError):
            raise OperatorError('Private command journal unavailable or corrupt; no mutation retry was sent') from None
        finally:
            if fd is not None:
                os.close(fd)

    def filename(self, cid):
        if not isinstance(cid, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', cid):
            raise OperatorError('Invalid journal command ID')
        return cid + '.json'

    read_limit = 9 * 1024 * 1024

    def record_limit(self,record):
        # Only the new document command may exceed the historical journal bound.
        if record.get('format')==4 and record.get('action')=='document':
            from .document_models import DocumentInput
            try:DocumentInput.model_validate({k:record['body'][k] for k in ('filename','mime_type','content_base64','sha256')})
            except (KeyError,TypeError,ValueError):raise OperatorError('Invalid document journal record') from None
            return self.read_limit
        return MAX_BYTES

    def _read(self, fd, cid):
        file_fd = os.open(self.filename(cid), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(file_fd, 'rb') as file:
            info = os.fstat(file.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
                    stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1 or info.st_size > self.read_limit):
                raise OperatorError('Unsafe command journal record')
            data = json.loads(file.read(self.read_limit + 1))
        if (not isinstance(data, dict) or set(data) != {'record', 'digest', 'outcome'} or
                not isinstance(data['record'], dict) or not isinstance(data['outcome'], dict) or
                digest(data['record']) != data['digest'] or data['record'].get('command_id') != cid or
                data['outcome'].get('state') not in ('prepared', 'outcome_unknown', 'readback_unknown', 'confirmed', 'rejected', 'abandoned_rejection')):
            raise OperatorError('Corrupt command journal record; replay refused')
        if info.st_size>self.record_limit(data['record']):raise OperatorError('Command journal record exceeds scoped storage limit')
        if data['outcome']['state'] in ('rejected', 'abandoned_rejection'):
            outcome = data['outcome']
            body = data['record'].get('body')
            if (not isinstance(body,dict) or set(outcome) != {'state', 'rejection'} or not valid_rejection(
                    outcome['rejection'], body.get('request_id'),path=data['record'].get('path'))):
                raise OperatorError('Corrupt rejection evidence; command remains locked')
        return data

    def read(self, cid):
        with self.directory() as fd:
            try:
                return self._read(fd, cid)
            except FileNotFoundError:
                raise OperatorError('Command journal record missing; exact replay refused') from None

    def require_new(self, cid):
        with self.directory() as fd:
            try:
                os.stat(self.filename(cid), dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                return
            raise OperatorError('Command ID already reserved; inspect with command ID, then explicitly replay ID')

    def _write(self, fd, cid, data, *, exclusive):
        raw = json.dumps(data, ensure_ascii=True).encode()
        if len(raw) > self.record_limit(data['record']):
            raise OperatorError('Command journal record exceeds private storage limit')
        temp = '.pending-' + uuid.uuid4().hex
        try:
            file_fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            with os.fdopen(file_fd, 'wb') as file:
                file.write(raw)
                file.flush()
                os.fsync(file.fileno())
            if exclusive:
                # link is atomic and refuses an already reserved ID (including symlinks).
                os.link(temp, self.filename(cid), src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
            else:
                os.replace(temp, self.filename(cid), src_dir_fd=fd, dst_dir_fd=fd)
            os.fsync(fd)
        finally:
            try:
                os.unlink(temp, dir_fd=fd)
                os.fsync(fd)
            except FileNotFoundError:
                pass

    def reserve(self, record):
        with self.directory() as fd:
            if len(os.listdir(fd)) >= MAX_RECORDS:
                raise OperatorError('Command journal full; archive it privately after resolving outstanding commands')
            try:
                self._write(fd, record['command_id'], {'record': record, 'digest': digest(record),
                    'outcome': {'state': 'prepared'}}, exclusive=True)
            except FileExistsError:
                raise OperatorError('Command ID already reserved; only explicit replay is allowed') from None

    def outcome(self, cid, state, receipt=None, *, rejection=None):
        with self.directory() as fd:
            data = self._read(fd, cid)
            # Never erase a committed receipt when a later replay/readback fails.
            if state in ('rejected', 'abandoned_rejection'):
                evidence = rejection or data['outcome'].get('rejection')
                if ('receipt' in data['outcome'] or not valid_rejection(
                        evidence, data['record'].get('body', {}).get('request_id'),path=data['record'].get('path'))):
                    raise OperatorError('Verified rejection required; command remains locked')
                data['outcome']['rejection'] = evidence
            data['outcome']['state'] = state
            if receipt is not None:
                data['outcome']['receipt'] = receipt
            self._write(fd, cid, data, exclusive=False)

    def find(self, cid):
        """Read or prove absence for a pre-reservation UI marker; unsafe is an error.

        This does not authorize replay and never changes a saved envelope.
        """
        with self.directory() as fd:
            try:
                return self._read(fd, cid)
            except FileNotFoundError:
                return None
