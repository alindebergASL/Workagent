"""Provider/DB-free contract tests. Real confinement probes live separately."""
import base64
from hashlib import sha256
import pytest
from pydantic import ValidationError
from workagent.document_models import DocumentInput, Extraction, LIMITS, MAX_ORIGINAL, MIMES
from workagent.models import IngestDocument, PostMessage, ConversationMessage
from workagent.service import canonical, digest
from workagent.document_sandbox import parse_document, unavailable, jail_argv
from document_fixtures import pdf


def upload(raw=None, name='fixture.pdf'):
    raw = pdf() if raw is None else raw
    return dict(filename=name, mime_type=MIMES[name.rsplit('.', 1)[1]],
                content_base64=base64.b64encode(raw).decode(), sha256=sha256(raw).hexdigest())


def test_binary_exact_hash_and_envelope():
    raw = pdf()
    value = IngestDocument(schema_version='workagent/v1', request_id='request', command_id='command', **upload(raw))
    assert value.original() == raw
    assert value.sha256 == sha256(raw).hexdigest()
    assert 'content_base64' in value.model_dump()

@pytest.mark.parametrize('change', [
    {'filename':'../fixture.pdf'}, {'filename':'a\\b.pdf'}, {'filename':'x.pdf\r\nEvil: true'},
    {'filename':'a..pdf'}, {'filename':'a.exe'}, {'filename':'a.PDF'},
    {'mime_type':'text/plain'}, {'mime_type':MIMES['docx']}, {'sha256':'0'*64},
    {'content_base64':'JVBERi0=\n'}, {'content_base64':'!@#$'}, {'content_base64':'JVBERi1='},
])
def test_invalid_inputs(change):
    with pytest.raises(ValidationError):
        DocumentInput(**(upload() | change))

@pytest.mark.parametrize('raw', [b'', b'not a pdf', b'%PDF-'+b'x'*MAX_ORIGINAL], ids=['empty','bad-magic','oversize'])
def test_invalid_magic_size(raw):
    with pytest.raises(ValidationError): DocumentInput(**upload(raw))


def test_legacy_message_and_command_hash_unchanged():
    kwargs = dict(schema_version='workagent/v1', request_id='r', command_id='c', expected_work_version=1, text='Read the text')
    old = PostMessage(**kwargs).model_dump(mode='json')
    assert 'document_refs' not in old
    assert PostMessage(**kwargs, document_refs=[]).model_dump(mode='json') == old
    message = ConversationMessage(id='m', conversation_id='c', run_id='r', sequence=1,
        author_id='p', author_kind='human', text='hello', evidence_origin='human')
    dumped = message.model_dump(mode='json')
    assert 'document_refs' not in dumped
    assert digest(ConversationMessage.model_validate(dumped)) == digest(dumped)
    assert canonical(message) == canonical(dumped)


def test_refs_bound_and_exact():
    kwargs = dict(schema_version='workagent/v1', request_id='r', command_id='c', expected_work_version=1, text='read')
    ref = {'document_id':'document', 'sha256':'0'*64}
    assert PostMessage(**kwargs, document_refs=[ref]).document_refs[0].document_id == 'document'
    for refs in ([ref]*3, [ref | {'filename':'injected.pdf'}], [ref | {'sha256':'bad'}]):
        with pytest.raises(ValidationError): PostMessage(**kwargs, document_refs=refs)


def test_unavailable_manifest_never_contains_fabricated_text():
    result = unavailable(pdf(), 'confinement_unavailable')
    assert result.status == 'unavailable' and result.text == ''
    assert result.original_sha256 == sha256(pdf()).hexdigest()
    for update in ({'text':'fake'}, {'limits':{}}, {'text_sha256':'0'*64}, {'extra':True}):
        with pytest.raises(ValidationError): Extraction.model_validate(result.model_dump() | update)


def test_launcher_has_no_host_root_environment_or_repo_mount(tmp_path):
    args = jail_argv(tmp_path/'input', tmp_path/'parser', 'pdf')
    for flag in ('--unshare-all', '--new-session', '--die-with-parent', '--clearenv', '--cap-drop'):
        assert flag in args
    assert ['--ro-bind', '/', '/'] != args
    assert '--nproc=16:16' in args and '--as=536870912:536870912' in args
    mounts = [args[i+1:i+3] for i, a in enumerate(args) if a == '--ro-bind']
    assert all(dst in ('/usr','/lib','/lib64','/input','/parser.py') for _,dst in mounts)


def test_unavailable_detail_snapshot_is_exact_and_runtime_pointer_is_small():
    from workagent.document_models import DocumentDetail, MessageDocument
    from workagent.documents import project_message_documents
    result = unavailable(pdf(), 'confinement_unavailable')
    detail = DocumentDetail(document_id='doc', workspace_id='ws', conversation_id='cv', owner_id='owner',
        filename='fixture.pdf', mime_type=MIMES['pdf'], sha256=sha256(pdf()).hexdigest(),
        byte_length=len(pdf()), text_bytes=0, **result.model_dump(exclude={'original_sha256'}))
    snapshot = MessageDocument(**detail.model_dump())
    assert snapshot.model_dump() == detail.model_dump()
    value = {'document_refs':[snapshot.model_dump()]}
    project_message_documents(value)
    assert value['document_refs'] == [{'document_id':'doc','sha256':detail.sha256,
        'filename':'fixture.pdf','status':'unavailable','text_sha256':detail.text_sha256}]
    assert detail.text == '' and detail.coverage.omissions
    with pytest.raises(ValidationError):
        DocumentDetail.model_validate(detail.model_dump() | {'text_bytes':1})


@pytest.mark.parametrize('coverage', [
    {'omissions':[], 'total_pages':2, 'covered_pages':1, 'omitted_pages':0,
     'empty_pages_needing_ocr':[], 'partial_last_page':False},
    {'omissions':[], 'arbitrary':'unknown'},
    {'omissions':[], 'total_pages':'1'},
])
def test_strict_coverage_rejects_untrusted_parser_manifest(coverage):
    result = unavailable(pdf(), 'confinement_unavailable').model_dump()
    with pytest.raises(ValidationError): Extraction.model_validate(result | {'coverage':coverage})


def test_frozen_legacy_message_json_is_byte_identical():
    from datetime import datetime, timezone
    expected = {'id':'m','conversation_id':'c','run_id':'r','sequence':1,'author_id':'p',
        'author_kind':'human','text':'exact\r\ntext','evidence_origin':'human','result':None,
        'operation':None,'attachments':[],'target':None,'model_receipt':None,
        'created_at':'2026-10-16T00:00:00Z'}
    message = ConversationMessage(**expected)
    assert message.model_dump(mode='json') == expected
    assert canonical(message) == canonical(expected)
