"""Synthetic, DB-free regressions; real optional parsers, never mocked extraction."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace as NS

import pytest
from document_fixtures import archive, docx_parts
from workagent.documents import Documents
from workagent.document_models import DocumentDetail, MessageDocument, MIMES, LIMITS


def document(ident, text):
    return DocumentDetail(document_id=ident, workspace_id='ws', conversation_id='cv',
        owner_id='owner', filename='fixture.docx', mime_type=MIMES['docx'],
        sha256=hashlib.sha256(ident.encode()).hexdigest(), byte_length=100,
        parser_version='confined-documents-v1', status='extracted', reason='text_extracted',
        text=text, text_bytes=len(text.encode()), text_sha256=hashlib.sha256(text.encode()).hexdigest(),
        limits=LIMITS, coverage={'omissions': ['headers']})


class Store(Documents):
    def __init__(self, *documents):
        self.documents = {d.document_id: d for d in documents}
        self.reads = []

    def _document(self, c, p, ws, cid, ident):
        self.reads.append(ident)
        return self.documents[ident], None


def message(sequence, target=None, documents=(), author='human', origin='human'):
    return NS(id=f'm{sequence}', sequence=sequence, target=NS(artifact_id=target) if target else None,
              document_refs=[MessageDocument(**d.model_dump()) for d in documents],
              author_kind=author, evidence_origin=origin)


def test_b_targeted_document_is_absent_from_a_context():
    a, b = document('a', 'ONLY A EVIDENCE'), document('b', 'SECRET B EVIDENCE')
    store = Store(a, b)
    messages = [message(1, 'B', [b]), message(2, 'A', [a])]
    result = store._document_context(None, None, NS(workspace_id='ws'), NS(id='cv'), messages, messages[-1], config={})
    assert 'SECRET B EVIDENCE' not in json.dumps(result)
    assert store.reads == ['a']


def renamed_main(declaration='Override', dtd=True):
    parts = docx_parts('HARMLESS DECOY')
    main = 'word/main.dat'
    parts[main] = ('<!DOCTYPE w:document>' if dtd else '') + docx_parts('ACTUAL MAIN TEXT')['word/document.xml']
    content_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
    entry = (f'<Override PartName="/{main}" ContentType="{content_type}"/>' if declaration == 'Override'
             else f'<Default Extension="dat" ContentType="{content_type}"/>')
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', entry + '</Types>')
    parts['_rels/.rels'] = parts['_rels/.rels'].replace('word/document.xml', main)
    return archive(parts)


def actual_extract(raw, kind='docx'):
    # Known synthetic fixtures only: this is a parser unit test, not a production
    # fallback if confinement is unavailable. Imports the actual source and libs.
    backend = Path(__file__).resolve().parents[1]
    code = ('import importlib.util,json,sys; '
            's=importlib.util.spec_from_file_location("parser",sys.argv[1]); '
            'm=importlib.util.module_from_spec(s); s.loader.exec_module(m); '
            'print(json.dumps(m.extract(sys.stdin.buffer.read(),sys.argv[2])))')
    result = subprocess.run([str(backend / '.venv-docs/bin/python'), '-I', '-B', '-c', code,
                             str(backend / 'workagent/document_parser.py'), kind],
                            input=raw, capture_output=True, env={}, timeout=15, check=True)
    return json.loads(result.stdout)


@pytest.mark.parametrize('declaration', ['Default', 'Override'])
def test_actual_parser_rejects_renamed_main_dtd(declaration):
    raw = renamed_main(declaration)
    result = actual_extract(raw)
    assert result['status'] in ('unsupported', 'failed'), result
    assert result['text'] == ''
    assert result['original_sha256'] == hashlib.sha256(raw).hexdigest()


@pytest.mark.parametrize('declaration', ['Default', 'Override'])
def test_valid_renamed_main_is_actually_parsed(declaration):
    result = actual_extract(renamed_main(declaration, dtd=False))
    assert result['status'] == 'extracted', result
    assert 'ACTUAL MAIN TEXT' in result['text'] and 'HARMLESS DECOY' not in result['text']


@pytest.mark.parametrize('target', [None, 'A', 'B'])
def test_a_only_responsibility_excludes_b_before_lookup(target):
    a, b = document('a', 'ONLY A EVIDENCE'), document('b', 'SECRET B EVIDENCE')
    store = Store(a, b)
    messages = [message(1, 'A', [a]), message(2, 'B', [b]), message(3, target, author='system', origin='runtime')]
    config = {'responsibility': {'observations': [{'kind': 'artifact_revision', 'object_id': 'A'}]}}
    result = store._document_context(None, None, NS(workspace_id='ws'), NS(id='cv'), messages, messages[-1], config)
    assert 'SECRET B EVIDENCE' not in json.dumps(result)
    assert store.reads == ([] if target == 'B' else ['a'])


def test_legacy_config_is_fail_closed_and_excluded_snapshots_are_projected():
    from workagent.documents import project_message_documents
    b = document('b', 'SECRET B EVIDENCE')
    store = Store(b)
    messages = [message(1, 'B', [b]), message(2, 'A')]
    result = store._document_context(None, None, NS(workspace_id='ws'), NS(id='cv'), messages, messages[-1])
    assert result is not None and result['items'] == [] and store.reads == []
    projected = {'document_refs': [MessageDocument(**b.model_dump()).model_dump()]}
    if result is not None:
        project_message_documents(projected)
    assert 'SECRET B EVIDENCE' not in json.dumps(projected)


@pytest.mark.parametrize('declaration', ['Default', 'Override'])
@pytest.mark.parametrize('media', ['application/xml', 'text/xml', 'application/custom+xml'])
def test_nonstandard_xml_parts_reject_dtd(declaration, media):
    parts = docx_parts()
    parts['extra.dat'] = '<!DOCTYPE x><x/>'
    entry = (f'<Override PartName="/extra.dat" ContentType="{media}"/>' if declaration == 'Override'
             else f'<Default Extension="dat" ContentType="{media}"/>')
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>', entry + '</Types>')
    result = actual_extract(archive(parts))
    assert result['status'] == 'failed' and result['text'] == ''


@pytest.mark.parametrize('target', ['missing.dat', '../word/document.xml', 'word/document.xml#fragment'])
def test_actual_main_relationship_must_be_valid(target):
    parts = docx_parts()
    parts['_rels/.rels'] = parts['_rels/.rels'].replace('word/document.xml', target)
    result = actual_extract(archive(parts))
    assert result['reason'] == 'format_container_mismatch' and result['text'] == ''


def test_actual_main_type_cannot_be_hidden_by_harmless_conventional_part():
    parts = docx_parts()
    parts['other.dat'] = '<x/>'
    parts['_rels/.rels'] = parts['_rels/.rels'].replace('word/document.xml', 'other.dat')
    result = actual_extract(archive(parts))
    assert result['reason'] == 'format_container_mismatch' and result['text'] == ''


def test_confined_renamed_dtd_rejected():
    from workagent.document_sandbox import parse_document
    result = parse_document(renamed_main(), 'docx')
    assert result.status in ('failed', 'unsupported'), result.reason
    assert result.text == ''


def test_xml_override_matching_is_case_insensitive_like_python_docx():
    parts = docx_parts()
    parts['extra.dat'] = '<!DOCTYPE x><x/>'
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>',
        '<Override PartName="/EXTRA.DAT" ContentType="application/xml"/></Types>')
    result = actual_extract(archive(parts))
    assert result['status'] == 'failed' and result['text'] == ''


def test_context_preserves_untargeted_evidence_but_excludes_future_and_nonhuman():
    common = document('common', 'CONVERSATION EVIDENCE')
    forbidden = document('forbidden', 'EXCLUDED EVIDENCE')
    store = Store(common, forbidden)
    messages = [message(1, documents=[common]), message(2, documents=[forbidden], author='assistant'),
                message(3, documents=[forbidden], origin='runtime'), message(4, 'A'),
                message(5, documents=[forbidden])]
    result = store._document_context(None, None, NS(workspace_id='ws'), NS(id='cv'), messages, messages[3], {})
    assert store.reads == ['common']
    assert 'CONVERSATION EVIDENCE' in json.dumps(result) and 'EXCLUDED EVIDENCE' not in json.dumps(result)


def test_untargeted_context_uses_same_work_area_snapshot_fence():
    a, b = document('a', 'ONLY A EVIDENCE'), document('b', 'SECRET B EVIDENCE')
    store = Store(a, b)
    messages = [message(1, 'A', [a]), message(2, 'B', [b]), message(3)]
    snapshot = {'artifacts': [{'artifact_id': 'A'}]}
    class Connection:
        def execute(self, sql, args):
            assert args == ('ws', 'run')
            return self
        def fetchone(self):
            return {'data': {'work_area_context': snapshot}}
    def area(c, p, ws, cv, **kwargs):
        assert kwargs == {'snapshot': snapshot, 'work_version': 7}
        return NS(artifacts=[NS(artifact_id='A')])
    store._work_area_context = area
    result = store._document_context(Connection(), None,
        NS(workspace_id='ws', id='run', profile='general-responses-v1'), NS(id='cv', work_version=8),
        messages, messages[-1], {}, {'responsibility_offer': {'conversation_work_version': 7}})
    assert store.reads == ['a'] and 'SECRET B EVIDENCE' not in json.dumps(result)
