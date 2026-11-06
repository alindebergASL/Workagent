"""Parent-owned disposable PG/API checks; real parser and worker, no paid calls.

Apply siblings 047/048 then 049 and provision optional parser env before running.
"""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import pytest
from test_domain import context, cmd, raises
from test_conversations import conversation, post
from test_general_responses_journey import api
from workagent.models import IngestDocument
from workagent.document_models import DocumentRef
from workagent.db import Database
from workagent.service import Service, Principal, canonical
from workagent.general_worker import GeneralWorker, ControlledTransport
from document_fixtures import pdf, docx, xlsx
from test_document_ingestion import upload


def ingest(context, cv, raw=None, name='fixture.pdf'):
    s,p,ws,_,_ = context
    raw = pdf('Actual retained PDF evidence') if raw is None else raw
    command = cmd(IngestDocument, **upload(raw, name))
    result = s.ingest_document(p,ws,cv.id,command)
    assert result.status == 'extracted', result.reason
    return result, command, raw


@pytest.mark.parametrize('kind,fixture', [('pdf',pdf),('docx',docx),('xlsx',xlsx)])
def test_original_survives_command_replay_and_service_restart(context, kind, fixture):
    s,p,ws,_,_ = context; cv = conversation(context)
    detail, command, raw = ingest(context,cv,fixture(),f'fixture.{kind}')
    again = Service(Database(s.db.dsn))
    assert again.ingest_document(p,ws,cv.id,command) == detail
    metadata, original = again.download_document(p,ws,cv.id,detail.document_id)
    assert original == raw and metadata.sha256 == sha256(raw).hexdigest()
    page = again.list_documents(p,ws,cv.id)
    assert [d.document_id for d in page.items] == [detail.document_id]
    assert 'text' not in page.items[0].model_dump() and 'content_base64' not in canonical(page)
    raises('command_conflict',lambda:again.ingest_document(p,ws,cv.id,
        command.model_copy(update={'filename':'changed.'+kind})))


def test_http_download_exact_headers_and_replay(context):
    s,p,ws,_,_ = context; cv = conversation(context)
    raw = pdf('HTTP exact content')
    command = cmd(IngestDocument,**upload(raw))
    with api(context) as client:
        root = f'/v1/workspaces/{ws}/conversations/{cv.id}/documents'
        # The real confined parser has a 15s wall bound; HTTPX's default 5s
        # read timeout is not the document endpoint's execution budget.
        first = client.post(root,json=command.model_dump(mode='json'),timeout=20)
        assert first.status_code == 201, first.text
        assert first.json()['status'] == 'extracted'
        second = client.post(root,json=command.model_dump(mode='json'))
        assert second.json() == first.json()
        download = client.get(root+'/'+first.json()['document_id']+'/download')
        assert download.status_code == 200 and download.content == raw
        assert download.headers['content-disposition'] == 'attachment; filename="fixture.pdf"'
        assert download.headers['x-content-type-options'] == 'nosniff'
        assert download.headers['content-type'] == 'application/pdf'
        assert 'text' not in client.get(root).json()['items'][0]


def test_same_command_concurrency_stores_one_document(context):
    s,p,ws,_,_ = context; cv = conversation(context)
    command = cmd(IngestDocument,**upload())
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _:s.ingest_document(p,ws,cv.id,command),range(2)))
    assert results[0] == results[1]
    assert len(s.list_documents(p,ws,cv.id).items) == 1


def test_exact_document_refs_reach_real_controlled_worker(context):
    s,p,ws,_,_ = context; cv = conversation(context)
    detail,_,raw = ingest(context,cv)
    ref = DocumentRef(document_id=detail.document_id,sha256=detail.sha256)
    queued = post(context,cv,'Read the retained document evidence.',document_refs=[ref])
    transport = ControlledTransport()
    GeneralWorker(s,transport=transport).work(p,ws,queued.run.id)
    assert transport.calls == 1
    ctx = transport.contexts[0]
    material = ctx['document_context']
    assert 'Untrusted document evidence' in material['notice']
    assert 'Actual retained PDF evidence' in material['items'][0]['text']
    assert material['items'][0]['sha256'] == sha256(raw).hexdigest()
    assert material['items'][0]['coverage']['covered_pages'] == 1
    assert 'content_base64' not in canonical(ctx)
    assert 'text' not in ctx['messages'][0]['document_refs'][0]
    with s.db.transaction() as c:
        receipt = c.execute('SELECT data FROM run_contexts WHERE workspace_id=%s AND run_id=%s',(ws,queued.run.id)).fetchone()['data']
        assert receipt['document_context'] == material
        assert c.execute("SELECT count(*) AS n FROM audit WHERE workspace_id=%s AND object_id=%s AND operation='read_document_context'",(ws,detail.document_id)).fetchone()['n'] == 1


def test_foreign_conversation_and_hash_are_denied(context):
    s,p,ws,_,_ = context; cv = conversation(context); other = conversation(context)
    detail,_,_ = ingest(context,cv)
    raises('not_found_or_not_authorized',lambda:s.get_document(p,ws,other.id,detail.document_id))
    raises('not_found_or_not_authorized',lambda:s.download_document(p,ws,other.id,detail.document_id))
    raises('not_found_or_not_authorized',lambda:post(context,other,'Read foreign evidence',
        document_refs=[DocumentRef(document_id=detail.document_id,sha256=detail.sha256)]))
    raises('source_changed',lambda:post(context,cv,'Wrong hash',
        document_refs=[DocumentRef(document_id=detail.document_id,sha256='0'*64)]))
    foreign = Principal('foreign-principal')
    for read in (lambda:s.list_documents(foreign,ws,cv.id),
                 lambda:s.get_document(foreign,ws,cv.id,detail.document_id),
                 lambda:s.download_document(foreign,ws,cv.id,detail.document_id)):
        raises('not_found_or_not_authorized',read)


def test_revoked_current_source_denies_metadata_bytes_and_message(context):
    s,p,ws,refs,admin = context
    from workagent.models import CreateConversation
    cv=s.create_conversation(p,ws,cmd(CreateConversation,title='Source protected docs',selected_source_refs=refs))
    detail,command,_=ingest(context,cv)
    post(context,cv,'Read protected evidence',document_refs=[DocumentRef(document_id=detail.document_id,sha256=detail.sha256)])
    with Database(admin).transaction() as c:
        c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
    for read in (lambda:s.list_documents(p,ws,cv.id), lambda:s.get_document(p,ws,cv.id,detail.document_id),
                 lambda:s.download_document(p,ws,cv.id,detail.document_id),
                 lambda:s.ingest_document(p,ws,cv.id,command), lambda:s.get_conversation(p,ws,cv.id)):
        raises('not_found_or_not_authorized',read)


def test_parse_failure_retains_exact_original(context):
    s,p,ws,_,_ = context; cv = conversation(context)
    raw = b'%PDF-malformed-synthetic'
    command = cmd(IngestDocument,**upload(raw))
    detail = s.ingest_document(p,ws,cv.id,command)
    assert detail.status == 'failed' and detail.text == ''
    assert s.download_document(p,ws,cv.id,detail.document_id)[1] == raw


def test_document_reaches_actual_responses_request_with_budget_accounting(context,tmp_path):
    import json
    from test_general_responses import Provider, activate, worker, totals
    s,p,ws,_,_ = context; cv = conversation(context)
    detail,_,_ = ingest(context,cv,docx('Real document text offered to Responses'), 'fixture.docx')
    grant = activate(context,[cv])
    class InspectRequest(Provider):
        def handle(self,request):
            if request.method == 'POST' and request.url.path == '/v1/responses':
                payload = json.loads(request.content)
                if payload['metadata']['step_id'] == 'selection':
                    self.projected = json.loads(payload['input'][0]['content'])
            return super().handle(request)
    transport = InspectRequest()
    queued = post(context,cv,'Read my attached document',document_refs=[DocumentRef(document_id=detail.document_id,sha256=detail.sha256)])
    result = worker(context,transport,tmp_path).work(p,ws,queued.run.id)
    assert result.state == 'ready'
    material = transport.projected['document_context']
    assert 'Real document text offered to Responses' in material['items'][0]['text']
    assert 'Untrusted document evidence' in material['notice']
    assert material['items'][0]['coverage']['paragraphs_covered'] == 2
    assert 'content_base64' not in canonical(transport.projected)
    # Existing Responses reservations/settlement remain authoritative.
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM provider_attempts WHERE workspace_id=%s AND run_id=%s',(ws,queued.run.id)).fetchone()['n'] == 1


def test_mismatched_office_mime_denied_before_storage(context):
    s,p,ws,_,_ = context; cv = conversation(context)
    command = cmd(IngestDocument,**upload(xlsx(),'misnamed.docx'))
    raises('validation_error',lambda:s.ingest_document(p,ws,cv.id,command))
    assert not s.list_documents(p,ws,cv.id).items


def test_same_workspace_member_cannot_read_owner_documents_or_transcript(context):
    s,p,ws,_,admin = context; cv = conversation(context)
    detail,_,_=ingest(context,cv)
    post(context,cv,'Read owned document',document_refs=[DocumentRef(document_id=detail.document_id,sha256=detail.sha256)])
    member=Principal('another-editor')
    with Database(admin).transaction() as c:
        c.execute("INSERT INTO memberships(workspace_id,principal_id,role) VALUES (%s,%s,'editor')",(ws,member.id))
    for read in (lambda:s.list_documents(member,ws,cv.id), lambda:s.get_document(member,ws,cv.id,detail.document_id),
                 lambda:s.download_document(member,ws,cv.id,detail.document_id), lambda:s.get_conversation(member,ws,cv.id)):
        raises('not_found_or_not_authorized',read)


def test_replay_and_denial_do_not_launch_parser(context,monkeypatch):
    s,p,ws,_,_=context; cv=conversation(context)
    detail,command,_=ingest(context,cv)
    def must_not_parse(*args,**kwargs):
        raise AssertionError('parser must not be invoked on replay or denial')
    monkeypatch.setattr('workagent.document_sandbox.parse_document',must_not_parse)
    assert s.ingest_document(p,ws,cv.id,command)==detail
    raises('not_found_or_not_authorized',lambda:s.ingest_document(Principal('outsider'),ws,cv.id,command))
    raises('command_conflict',lambda:s.ingest_document(p,ws,cv.id,command.model_copy(update={'filename':'changed.pdf'})))


def test_source_revoked_while_real_parser_runs_blocks_final_transaction(context,monkeypatch):
    from workagent.document_sandbox import parse_document as real_parse
    s,p,ws,refs,admin=context; cv=conversation(context,refs)
    def parse_then_revoke(raw,kind):
        result=real_parse(raw,kind)
        assert result.status=='extracted',result.reason
        with Database(admin).transaction() as c:
            c.execute('UPDATE source_access SET active=false WHERE workspace_id=%s AND principal_id=%s',(ws,p.id))
        return result
    monkeypatch.setattr('workagent.document_sandbox.parse_document',parse_then_revoke)
    command=cmd(IngestDocument,**upload())
    raises('not_found_or_not_authorized',lambda:s.ingest_document(p,ws,cv.id,command))
    with s.db.transaction() as c:
        assert c.execute('SELECT count(*) AS n FROM conversation_documents WHERE workspace_id=%s',(ws,)).fetchone()['n']==0
        assert c.execute('SELECT count(*) AS n FROM commands WHERE workspace_id=%s AND command_id=%s',(ws,command.command_id)).fetchone()['n']==0


def test_viewer_cannot_launch_upload_parser(context,monkeypatch):
    s,p,ws,_,admin=context; cv=conversation(context)
    with Database(admin).transaction() as c:
        c.execute("UPDATE memberships SET role='viewer' WHERE workspace_id=%s AND principal_id=%s",(ws,p.id))
    def must_not_parse(*args,**kwargs):
        raise AssertionError('write authority must be checked before parsing')
    monkeypatch.setattr('workagent.document_sandbox.parse_document',must_not_parse)
    raises('not_found_or_not_authorized',lambda:s.ingest_document(p,ws,cv.id,cmd(IngestDocument,**upload())))
