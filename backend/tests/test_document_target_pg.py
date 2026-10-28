"""Parent-run disposable PostgreSQL regressions; no mocked document parser.

Requires optional parser dependencies, working confinement and migration 049.
The scoped correction session only collects these tests; it does not access DBs.
"""
from datetime import timedelta
import json

import pytest
from test_domain import context, cmd
from test_conversations import conversation, post
from test_responsibilities import product, delegate
from test_general_responses import target
from test_sustained_continuity import activate
from test_evidence_continuity import _run, REPLY
from test_document_journey_pg import ingest
from test_responsibility_execution import admitted
from workagent.document_models import DocumentRef
from workagent.models import now
from workagent.responsibility_models import (
    ActivateResponsibility, ResponsibilityDependency, ResponsibilityNextAction,
    ResponsibilityWait,
)
from document_fixtures import docx
from test_document_review_corrections import renamed_main
from test_document_ingestion import upload
from workagent.models import IngestDocument


@pytest.mark.parametrize('responsibility', [False, True])
def test_b_document_never_enters_a_request_or_a_only_responsibility(context, tmp_path, responsibility):
    s, p, ws, _, _ = context
    cv = conversation(context)
    a, _ = product(context, cv)
    b, _ = product(context, cv)
    detail, _, original = ingest(context, cv, docx('B PRIVATE DOCUMENT SENTINEL'), 'fixture.docx')
    grant = activate(context, cv, max_steps=5)
    cv = s.get_conversation(p, ws, cv.id).conversation
    attached = post(context, cv, 'Read this document for B.', target=target(b),
                    document_refs=[DocumentRef(document_id=detail.document_id, sha256=detail.sha256)])
    _run(context, tmp_path, attached.run.id, [REPLY])
    if responsibility:
        assignment = delegate(context, cv, 'Review only A')
        s.activate_responsibility(p, ws, assignment.id, cmd(ActivateResponsibility,
            expected_work_version=assignment.work_version, current_outcome='A requires review.',
            next_action=ResponsibilityNextAction(kind='continue_work', description='Review A only.'),
            dependencies=[ResponsibilityDependency(kind='artifact_revision', object_id=a.id,
                                                   expected_version=a.current_revision_id)],
            wait=ResponsibilityWait(kind='check_in', reason='Review A'),
            next_check_in_at=now()-timedelta(seconds=1)))
        s.advance_responsibilities(ws, grant.id)
        row, = admitted(s, ws)
        assert {d['object_id'] for d in row['config']['responsibility']['observations']} == {a.id}
        run_id = row['run_id']
    else:
        cv = s.get_conversation(p, ws, cv.id).conversation
        run_id = post(context, cv, 'Review only A.', target=target(a)).run.id
    observed = _run(context, tmp_path, run_id, [REPLY])
    assert observed.contexts
    assert 'B PRIVATE DOCUMENT SENTINEL' not in json.dumps(observed.contexts)
    with s.db.transaction() as c:
        receipt = c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',
                            (ws, run_id)).fetchone()['data']
    assert 'B PRIVATE DOCUMENT SENTINEL' not in json.dumps(receipt)
    assert receipt['document_context']['items'] == []
    assert s.download_document(p, ws, cv.id, detail.document_id)[1] == original


def test_renamed_dtd_rejection_retains_original_and_replays(context):
    s, p, ws, _, _ = context
    cv = conversation(context)
    raw = renamed_main()
    command = cmd(IngestDocument, **upload(raw, 'fixture.docx'))
    detail = s.ingest_document(p, ws, cv.id, command)
    assert detail.status == 'failed' and detail.text == ''
    assert s.download_document(p, ws, cv.id, detail.document_id)[1] == raw
    assert s.ingest_document(p, ws, cv.id, command) == detail
