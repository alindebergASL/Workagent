"""Pure byte/format contracts; no provider, service or mocked database."""
import csv
import io
import json
from hashlib import sha256
import pytest
from pydantic import ValidationError
from workagent.workspace_file_models import WorkingText, FileVersionRef, CreateWorkspaceFile, TextBytes
from workagent.workspace_files import range_result, text_body
from workagent.artifact_exports import render, safe_csv_cell
from workagent.flexible_models import Body, Block
from workagent.errors import DomainError
from workagent.capabilities.file_adapters import FilesReadRange, FilesCompare, input_refs


def working(text='\ufeffα😀\r\nsecond\n', filename='sample.txt', mime='text/plain'):
    return WorkingText(filename=filename, mime_type=mime, content=text, sha256=sha256(text.encode()).hexdigest())


@pytest.mark.parametrize('change', [
    {'filename':'../sample.txt'}, {'filename':'/tmp/sample.txt'}, {'filename':'a\\b.txt'},
    {'filename':'sample.zip'}, {'filename':'sample.txt.zip'}, {'filename':'a.txt\r\nHeader:x'},
    {'filename':'sample.pdf'}, {'filename':'sample.exe'}, {'mime_type':'application/zip'},
    {'mime_type':'text/csv'}, {'sha256':'0'*64}, {'host_path':'/tmp/x'}, {'principal_id':'owner'},
    {'grants':['all']}, {'symlink':'target'},
])
def test_closed_mime_and_no_path_surface(change):
    with pytest.raises(ValidationError): WorkingText.model_validate(working().model_dump() | change)


@pytest.mark.parametrize('text', ['PK\x03\x04archive', '%PDF-1.7', '\x00binary', 'a\ud800', '😀'*50001])
def test_binary_invalid_unicode_and_byte_bounds(text):
    with pytest.raises((ValidationError, UnicodeError)): working(text)


def test_exact_bom_unicode_newline_ranges_and_omission_digests():
    value = working()
    raw = value.content.encode()
    ref = FileVersionRef(workspace_file_id='file', version_id='version', sha256=value.sha256)
    page = range_result(ref, raw, 3, 6)
    assert page.text == 'α😀' and page.next_offset == 9 and page.newline == 'mixed' and page.has_utf8_bom
    assert page.chunk_sha256 == sha256(raw[3:9]).hexdigest()
    assert [(r.start, r.end, r.sha256) for r in page.omitted_ranges] == [
        (0, 3, sha256(raw[:3]).hexdigest()), (9, len(raw), sha256(raw[9:]).hexdigest())]
    for offset, limit in [(1,8), (4,8), (3,1), (len(raw)+1,8), (0,8193)]:
        with pytest.raises(DomainError): range_result(ref, raw, offset, limit)
    body = text_body(value.content, value.sha256, value.mime_type)
    assert body.content.encode() == raw


@pytest.mark.parametrize('text', ['NaN', '{"x": Infinity}', '{bad}', '{"x":1,}', pytest.param('['*50000+'0'+']'*50000,id='excessive-json-nesting')])
def test_json_mime_checks_real_content(text):
    with pytest.raises(ValidationError): working(text, 'sample.json', 'application/json')


def test_json_preserves_bom_and_crlf_exactly():
    value = working('\ufeff{\r\n"é": "😀"\r\n}\r\n', 'sample.json', 'application/json')
    raw, _, _ = render(None, 'json', raw=value.content.encode(), mime_type=value.mime_type)
    assert raw == value.content.encode()


@pytest.mark.parametrize('cell', ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', ' \t=cmd', '\ufeff=cmd', '\tplain', '\n=cmd'])
def test_csv_formula_escape(cell):
    assert safe_csv_cell(cell) == "'" + cell


@pytest.mark.parametrize('cell', ['-1', '-0.25', '0', '123.45', 'ordinary', "'=already-safe"])
def test_safe_csv_negative_numbers_not_rewritten(cell):
    assert safe_csv_cell(cell) == cell


def test_csv_download_escaping_and_original_preservation():
    source = '\ufeffname,value\r\nα,-2.5\r\n'
    assert render(None, 'csv', raw=source.encode(), mime_type='text/csv')[0] == source.encode()
    source += 'unsafe,=1+1\r\n'
    raw, _, _ = render(None, 'csv', raw=source.encode(), mime_type='text/csv')
    rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'), newline='')))
    assert rows[1] == ['α', '-2.5'] and rows[2][1] == "'=1+1"
    assert raw.startswith(b'\xef\xbb\xbf') and b'\r\n' in raw


def test_all_basic_exports_include_human_notes_or_visible_coverage():
    body = Body(title='Human work', blocks=[Block(block_id='note',kind='protected_note',text='Keep Wednesday free.')])
    for format in ('txt','markdown','csv','json'):
        raw, annotations, omitted = render(body, format)
        assert b'Keep Wednesday free.' in raw and annotations == 'included' and not omitted
        raw, annotations, omitted = render(None, format, raw=b'extracted', mime_type='application/pdf',
                                           source_omissions=['Page 2 was not extracted.'])
        assert b'Page 2 was not extracted.' in raw and annotations == 'explicit_omissions'


def test_resource_refs_bind_the_arguments_and_exact_pair():
    ref = FileVersionRef(workspace_file_id='f', version_id='v', sha256='a'*64)
    req = FilesReadRange(kind='files_read_range', ref=ref, offset=0, limit=10)
    assert input_refs(req)[0].model_dump() == {'kind':'workspace_file','id':'f','version':'v','sha256':'a'*64}
    with pytest.raises(ValidationError):
        FilesCompare(kind='files_compare', left=ref, right=ref.model_copy(update={'workspace_file_id':'other'}))
    with pytest.raises(ValidationError):
        FilesReadRange.model_validate(req.model_dump() | {'principal_id':'human'})


def test_refresh_requires_exact_previous_version_and_original_ref():
    base = dict(schema_version='workagent/v1', request_id='req', command_id='cmd', expected_work_version=1,
                source={'kind':'document','document_id':'doc','sha256':'a'*64})
    with pytest.raises(ValidationError): CreateWorkspaceFile(**base, refresh_workspace_file_id='f')
    value = CreateWorkspaceFile(**base, refresh_workspace_file_id='f', expected_version_id='v')
    assert value.expected_version_id == 'v'
