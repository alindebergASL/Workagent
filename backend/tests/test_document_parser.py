"""Real generated files through the real jail. Missing confinement/deps FAIL."""
import hashlib
import io
import struct
import zipfile
import pytest
from workagent.document_sandbox import parse_document
from workagent.document_models import MAX_TEXT
from document_fixtures import pdf, docx, xlsx, docx_parts, archive


def extracted(raw, kind):
    result = parse_document(raw, kind)
    assert result.status in ('extracted', 'truncated'), result.model_dump(exclude={'text'})
    assert result.original_sha256 == hashlib.sha256(raw).hexdigest()
    assert result.text_sha256 == hashlib.sha256(result.text.encode()).hexdigest()
    return result


def test_real_pdf_pages_and_omissions():
    result = extracted(pdf('Distinct retained sentence', pages=52), 'pdf')
    assert 'Distinct retained sentence' in result.text
    assert '[Page 50]' in result.text and '[Page 51]' not in result.text
    assert result.status == 'truncated'
    assert result.coverage.model_dump()['total_pages'] == 52
    assert result.coverage.model_dump()['covered_pages'] == 50 and result.coverage.model_dump()['omitted_pages'] == 2


def test_real_docx_order_and_whitespace():
    result = extracted(docx('  Original whitespace  '), 'docx')
    assert result.text.index('  Original whitespace  ') < result.text.index('Cell A\tCell B') < result.text.index('After table')
    assert 'headers' in result.coverage.model_dump()['omissions'] and 'tracked changes' in result.coverage.model_dump()['omissions']


def test_real_xlsx_inert_formula_and_cached_value():
    result = extracted(xlsx(), 'xlsx')
    assert 'Synthetic cell' in result.text and 'A2: inert formula =SUM(B1,2); cached=5' in result.text
    assert result.coverage.model_dump()['sheets'][0]['merged_ranges'] == ['A1']
    assert result.coverage.model_dump()['sheets'][0]['state'] == 'visible'

@pytest.mark.parametrize('case', ['macro', 'external', 'traversal', 'symlink', 'bomb', 'entities', 'entries', 'encrypted'])
def test_real_zip_preflight_rejects_unsafe_content(case):
    parts = docx_parts()
    if case == 'macro': parts['word/vbaProject.bin'] = b'not executed'
    if case == 'external': parts['word/_rels/document.xml.rels'] = '<Relationships><Relationship TargetMode="External" Target="https://example.invalid/secret"/></Relationships>'
    if case == 'traversal': parts['../escaped'] = b'bad'
    if case == 'bomb': parts['bomb.xml'] = b' ' * 100000
    if case == 'entities': parts['evil.xml'] = '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'
    if case == 'entries': parts.update({f'entry{i}':b'x' for i in range(1001)})
    raw = archive(parts)
    if case == 'symlink':
        output = io.BytesIO(raw)
        with zipfile.ZipFile(output, 'a') as z:
            entry = zipfile.ZipInfo('link'); entry.create_system = 3; entry.external_attr = 0o120777 << 16
            z.writestr(entry, '/etc/passwd')
        raw = output.getvalue()
    if case == 'encrypted':
        # Actual ZIP encryption flags are rejected before opening any member.
        value = bytearray(raw)
        for signature, offset in ((b'PK\x03\x04',6),(b'PK\x01\x02',8)):
            start = 0
            while (start := value.find(signature,start)) >= 0:
                flags = struct.unpack_from('<H',value,start+offset)[0]
                struct.pack_into('<H',value,start+offset,flags|1); start += 4
        raw = bytes(value)
    result = parse_document(raw, 'docx')
    assert result.status in ('unsupported','encrypted','failed'), result.reason
    assert not result.text
    assert result.reason != 'confinement_unavailable'


def test_real_malformed_and_mismatched_container():
    for raw, kind in ((b'%PDF-corrupt', 'pdf'), (docx(), 'xlsx')):
        result = parse_document(raw, kind)
        assert result.status in ('failed','unsupported') and not result.text


def test_real_text_bound():
    # Store uncompressed: exercises the text bound, not the ZIP ratio rejection.
    raw = archive(docx_parts('é'*80000), compression=zipfile.ZIP_STORED)
    result = extracted(raw, 'docx')
    assert result.status == 'truncated' and len(result.text.encode()) <= MAX_TEXT


def synthetic_optional(code):
    """Generate synthetic bytes only; all extraction still uses the real jail."""
    import subprocess
    from pathlib import Path
    python = Path(__file__).resolve().parents[1] / '.venv-docs/bin/python'
    result = subprocess.run([str(python), '-I', '-c', code], env={},
                            capture_output=True, timeout=15, check=True)
    assert 0 < len(result.stdout) <= 5242880
    return result.stdout


def test_real_encrypted_pdf_and_empty_page_keep_honest_status():
    for encrypted in (False, True):
        raw = synthetic_optional('import sys\nfrom pypdf import PdfWriter\nw=PdfWriter()\nw.add_blank_page(width=612,height=792)\n'
                                 + ('w.encrypt("synthetic-password")\n' if encrypted else '')
                                 + 'import io\nbuffer=io.BytesIO()\nw.write(buffer)\nsys.stdout.buffer.write(buffer.getvalue())')
        result = parse_document(raw, 'pdf')
        assert result.status == ('encrypted' if encrypted else 'needs_ocr'), result.reason
        assert result.text == ''
        if not encrypted:
            assert result.coverage.covered_pages == 1
            assert result.coverage.empty_pages_needing_ocr == [1]


def test_real_sheet_limit_hidden_metadata_and_row_limit():
    raw = synthetic_optional('''import sys
from openpyxl import Workbook
w=Workbook(); w.active.title='Visible'
for i in range(11):
 s=w.create_sheet('Sheet'+str(i)); s['A1']='Retained '+str(i)
w['Sheet0'].sheet_state='hidden'
w.save(sys.stdout.buffer)
''')
    result = extracted(raw, 'xlsx')
    assert result.status == 'truncated' and result.coverage.total_sheets == 12
    assert result.coverage.covered_sheets == 10 and result.coverage.omitted_sheets == 2
    assert result.coverage.sheets[1].state == 'hidden'
    raw = synthetic_optional('''import sys
from openpyxl import Workbook
w=Workbook(); s=w.active
for i in range(1,1003): s.cell(i,1,'Row '+str(i))
w.save(sys.stdout.buffer)
''')
    result = extracted(raw, 'xlsx')
    assert result.status == 'truncated'
    assert result.coverage.covered_rows == 1000
    assert result.coverage.sheets[0].omitted_rows == 2
    assert 'A1000: Row 1000' in result.text and 'A1001:' not in result.text


def test_real_zip_total_expansion_limit():
    # Stored members avoid triggering the separate ratio test first.
    raw = archive({**docx_parts(), 'large.bin':b'x'*(20*1024*1024)}, compression=zipfile.ZIP_DEFLATED)
    result = parse_document(raw, 'docx')
    assert result.status == 'unsupported' and result.reason == 'zip_expansion_limit'
