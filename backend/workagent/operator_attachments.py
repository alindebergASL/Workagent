"""Bounded inert text snapshots for operator clients, never path-based replay.

Staging is local and does not call the API. The filename must already satisfy the
shared attachment contract: do not rename, normalize newlines, strip BOMs, execute
or silently truncate. The exact content must be journaled before sending.
"""
from dataclasses import dataclass, field
from hashlib import sha256
import os
from pathlib import Path
import stat
from pydantic import ValidationError
from .message_models import AttachmentInput, ATTACHMENT_BYTES, ATTACHMENT_COUNT
from .operator_journal import OperatorError


@dataclass(frozen=True)
class StagedText:
    filename: str
    mime_type: str
    content: str = field(repr=False)
    sha256: str
    byte_length: int

    def payload(self):
        return {'filename':self.filename,'mime_type':self.mime_type,'content':self.content}


def stage_text_files(paths):
    """Return immutable UTF-8 snapshots, all-or-nothing, for explicit local paths."""
    if not isinstance(paths,(list,tuple)) or len(paths)>ATTACHMENT_COUNT:
        raise OperatorError(f'Choose at most {ATTACHMENT_COUNT} text files; no files staged')
    staged=[]; total=0
    for value in paths:
        fd=None
        try:
            path=Path(value)
            fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size>ATTACHMENT_BYTES:
                raise OperatorError('Choose a regular bounded text file; no files staged')
            with os.fdopen(fd,'rb') as stream:
                fd=None
                raw=stream.read(ATTACHMENT_BYTES+1)
            if len(raw)>ATTACHMENT_BYTES:
                raise OperatorError('File exceeds the attachment byte limit; no files staged')
            attachment=AttachmentInput(filename=path.name,
                mime_type='text/csv' if path.name.endswith('.csv') else 'text/plain',
                content=raw.decode('utf-8'))
            total+=len(raw)
            if total>ATTACHMENT_BYTES:
                raise OperatorError('Combined attachments exceed the byte limit; no files staged')
            staged.append(StagedText(attachment.filename,attachment.mime_type,
                attachment.content,sha256(raw).hexdigest(),len(raw)))
        except (OSError,ValueError,TypeError,ValidationError):
            # No exception string, file content or private local path in diagnostics.
            raise OperatorError('Cannot stage file: require a regular UTF-8 text file with an accepted exact filename, no NUL, and bounded nonempty content') from None
        finally:
            if fd is not None:os.close(fd)
    return tuple(staged)


def validate_snapshots(attachments):
    """Validate retained payloads without ever reopening the original paths."""
    try:
        if not isinstance(attachments,list) or len(attachments)>ATTACHMENT_COUNT:
            raise ValueError()
        values=[AttachmentInput.model_validate(a).model_dump() for a in attachments]
        if values!=attachments or sum(len(a['content'].encode('utf-8')) for a in values)>ATTACHMENT_BYTES:
            raise ValueError()
        return values
    except (TypeError,ValueError):
        raise OperatorError('Invalid retained attachment snapshots') from None


def validate_documents(documents):
    """Validate original bytes and magic only; never parse documents in this process."""
    from .document_models import DocumentInput
    try:
        if not isinstance(documents,list) or len(documents)>2:raise ValueError()
        values=[DocumentInput.model_validate(d).model_dump() for d in documents]
        if values!=documents:raise ValueError()
        return values
    except (ValueError,TypeError):raise OperatorError('Choose at most two exact PDF/DOCX/XLSX originals, each at most 5 MiB') from None


def stage_documents(paths):
    import base64
    from .document_models import MAX_ORIGINAL, MIMES
    if not isinstance(paths,(list,tuple)) or len(paths)>2:raise OperatorError('Choose at most two documents')
    staged=[]
    for value in paths:
        fd=None
        try:
            path=Path(value);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
            info=os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or not 0<info.st_size<=MAX_ORIGINAL:raise ValueError()
            with os.fdopen(fd,'rb') as stream:
                fd=None;raw=stream.read(MAX_ORIGINAL+1)
            staged.append(dict(filename=path.name,mime_type=MIMES[path.suffix[1:]],
                content_base64=base64.b64encode(raw).decode('ascii'),sha256=sha256(raw).hexdigest()))
        except (OSError,ValueError,KeyError,TypeError):raise OperatorError('Cannot stage document: require a regular bounded file with an accepted exact filename') from None
        finally:
            if fd is not None:os.close(fd)
    return validate_documents(staged)


def save_download(destination,raw,expected_hash):
    """Explicit destination, exclusive creation; no implicit overwrite or execution."""
    if sha256(raw).hexdigest()!=expected_hash:raise OperatorError('Downloaded original hash mismatch; nothing saved')
    path=Path(destination)
    if not path.is_absolute() or '..' in path.parts:raise OperatorError('Choose an explicit absolute local destination')
    parent=None;created=False
    try:
        parent=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        for part in path.parts[1:-1]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            os.close(parent);parent=child
        fd=os.open(path.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent);created=True
        with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.fsync(parent)
    except OSError:
        if created:
            try:os.unlink(path.name,dir_fd=parent)
            except OSError:pass
        raise OperatorError('Download destination unavailable or already exists; choose a new destination') from None
    finally:
        if parent is not None:os.close(parent)
