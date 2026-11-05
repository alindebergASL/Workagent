"""Materialize a run's final text-only reply as an editable worker artifact.

P5: when a run completes with a text-only final reply and the conversation has
no worker-authored editable artifact, downstream corrections/resume/revoke/
forget transitions have no editable target (`missing_named_model_artifact`,
b35e 6/6). This seam publishes the exact reply bytes as an ordinary editable
file artifact BEFORE the run is marked terminal, so the existing transition
primary_artifact selection (exact filename -> exact title -> sole editable
document) can find a target. Ordinary authority, CAS, idempotency and the
command/audit ledger are unchanged; human-authored artifacts are never touched.
"""
from hashlib import sha256

from .errors import DomainError
from .models import new_id


REPLY_FILENAME = 'reply.txt'
REPLY_TITLE = 'Worker reply'
# FileBody's frozen schema allows only .txt/.csv/.wat; text/plain keeps the
# materialized document inside the transition selector's editable-document
# class (Body or FileBody .txt/.md + text) without inventing a new kind.
MIME = 'text/plain'


def reply_body(text):
    from .product_models import FileBody
    if not text:
        raise DomainError('validation_error')
    return FileBody(title=REPLY_TITLE, filename=REPLY_FILENAME, mime_type=MIME,
                    content=text, content_sha256=sha256(text.encode('utf-8')).hexdigest())


def conversation_has_editable_document(c, ws, conversation_id):
    """Any current editable worker document already selectable as a target.

    Mirrors the transition selector's editable-document classes (Body documents
    and FileBody text files) so materialization never creates ambiguity where a
    target already exists. Human-created files (workspace_files) are separate
    objects and never suppressed by this check.
    """
    return bool(c.execute(
        "SELECT 1 FROM artifacts a JOIN revisions r "
        "ON r.workspace_id=a.workspace_id AND r.artifact_id=a.id AND r.id=a.current_revision_id "
        "WHERE a.workspace_id=%s AND a.conversation_id=%s "
        "AND (r.data->'body'->>'kind'='file' OR r.data->'body' ? 'blocks') LIMIT 1",
        (ws, conversation_id)).fetchone())


def run_authored_artifact(c, ws, run_id):
    """True when this run already produced any artifact or file (P5 skip).

    Mirrors memory_revision_producers' producer attribution: initial products
    publish through product_observations, workspace files through their
    files.create_draft tool attempt, and this seam through producer_run_id.
    """
    return bool(
        c.execute('SELECT 1 FROM product_observations WHERE workspace_id=%s AND run_id=%s LIMIT 1',
                  (ws,run_id)).fetchone()
        or c.execute('SELECT 1 FROM revisions WHERE workspace_id=%s AND producer_run_id=%s LIMIT 1',
                     (ws,run_id)).fetchone()
        or c.execute("SELECT 1 FROM tool_attempts WHERE workspace_id=%s AND run_id=%s "
                     "AND capability_id='files.create_draft' LIMIT 1",(ws,run_id)).fetchone())


def run_reply_revision(c, ws, run_id):
    """The run's own materialized reply revision, if any (idempotent retry)."""
    row=c.execute(
        'SELECT artifact_id,id FROM revisions WHERE workspace_id=%s AND producer_run_id=%s '
        'ORDER BY revision_number LIMIT 1',(ws,run_id)).fetchone()
    return (row['artifact_id'],row['id']) if row else None


def materialize(service, c, p, run, cv, text):
    """Create the reply artifact for this run, or return the existing one.

    Idempotent by run/revision identity: a retry or process restart finds the
    run's producer-tagged revision and returns it without writing anything.
    Fires only when the run authored nothing and no editable document exists.
    """
    body=reply_body(text)
    existing=run_reply_revision(c,run.workspace_id,run.id)
    if existing:
        artifact,owner=service._artifact(c,p,run.workspace_id,existing[0])
        return service._revision(c,p,run.workspace_id,artifact,owner,existing[1])
    if conversation_has_editable_document(c,run.workspace_id,cv.id):
        # Existing editable work (worker or human) stays the sole selectable
        # document; never add a second one and never touch human artifacts.
        return None
    aid=new_id()
    c.execute('INSERT INTO artifacts(workspace_id,id,conversation_id) VALUES (%s,%s,%s)',
              (run.workspace_id,aid,cv.id))
    row,owner=service._artifact(c,p,run.workspace_id,aid)
    revision=service._append_revision(c,p,run.workspace_id,row,owner,body,cv.selected_source_refs,
                                      'worker',producer_run_id=run.id)
    service._event(c,p,run.workspace_id,'materialize_reply_artifact',run.id)
    return revision
