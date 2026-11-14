"""Trusted synthetic fixtures only; this does NOT establish namespace isolation.
Parent: /usr/bin/python3 -I services/workagent-execution/pdf/test_extract.py
"""
import base64
import json
from pathlib import Path
import runpy
import subprocess
import unittest
ROOT = Path(__file__).resolve().parent
mapping = runpy.run_path(str(ROOT / 'extract.py'))
fixtures = runpy.run_path(str(ROOT / 'fixtures/text_import.py'))

def request(data):
    # One request per process, unchanged 8 second CPU cap.
    r = subprocess.run(['/usr/bin/python3', '-I', str(ROOT / 'extract.py')], input=json.dumps({'op':'import','base64':base64.b64encode(data).decode()}).encode(), capture_output=True, timeout=25)
    return json.loads(r.stdout)

class Extraction(unittest.TestCase):
    def test_plain_unicode_multipage(self):
        r = request(fixtures['make']('unicode', 2))
        self.assertEqual(r['pages'], 2)
        self.assertEqual(r['text'].count('Cafe\u0301 café Ω Ж 0012 1. Literal label'), 2)
        self.assertNotIn('\f', r['text'])
        self.assertIn('Second line\n\n', r['text'])
    def test_refusals(self):
        for kind, code in [('empty','pdf_ocr_not_supported'),('scanned','pdf_ocr_not_supported'),('encrypted','pdf_encrypted_not_supported'),('empty-password','pdf_encrypted_not_supported')]:
            with self.subTest(kind=kind): self.assertEqual(request(fixtures['make'](kind))['error'], code)
        self.assertEqual(request(b'%PDF-1.7\nmalformed\n%%EOF')['error'], 'pdf_malformed')
        self.assertEqual(request(fixtures['make']()[:-20])['error'], 'pdf_malformed')
    def test_pages_and_size(self):
        self.assertEqual(request(fixtures['make']('plain',200))['pages'],200)
        self.assertEqual(request(fixtures['make']('plain',201))['error'],'pdf_page_limit')
        self.assertEqual(request(b'x'*16_000_001)['error'],'pdf_input_limit')
    def test_mixed_scanned_and_blank_pages_refuse_whole_document(self):
        for kind in ('mixed-scanned', 'mixed-blank'):
            with self.subTest(kind=kind):
                self.assertEqual(request(fixtures['make'](kind)), {'error': 'pdf_page_without_text'})
    def test_actual_text_output_and_paragraph_limits(self):
        self.assertEqual(request(fixtures['make']('text-limit'))['error'], 'pdf_extraction_output_limit')
        self.assertEqual(request(fixtures['make']('paragraph-limit'))['error'], 'pdf_paragraph_limit')
        import io
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import DecodedStreamObject
        # Pad a valid inert stream, keeping correct xref offsets and a real EOF.
        size = 15_900_000
        for _ in range(4):
            writer = PdfWriter(); writer.append(PdfReader(io.BytesIO(fixtures['make']())))
            stream = DecodedStreamObject(); stream.set_data(b'x' * size); writer._add_object(stream)
            out = io.BytesIO(); writer.write(out); data = out.getvalue()
            if len(data) == 16_000_000: break
            size += 16_000_000 - len(data)
        self.assertEqual(len(data), 16_000_000)
        self.assertEqual(request(data)['pages'], 1)
    def test_mapping_literal_boundaries(self):
        m=mapping['map_text']
        self.assertEqual(m('  A\n\nB \n\fC\n\f'.encode(),2),{'text':'  A\n\nB \n\nC','pages':2})
        self.assertEqual(m('e\u0301\t1. X\n\f雪\n\f'.encode(),2)['text'],'e\u0301\t1. X\n\n雪')
        for raw in (b'A\n\f\f', b'\fA\n\f', b'A\n\f \n\t\f', b'A\n\f...\n\f'):
            with self.assertRaisesRegex(mapping['Refused'], 'pdf_page_without_text'): m(raw, 2)
        for raw, pages, code in [(b'A\n',1,'pdf_incomplete_extraction'),(b'A\n\f',2,'pdf_incomplete_extraction'),(b'A\r\n\f',1,'pdf_unsupported_text'),(b'\xff\f',1,'pdf_unsupported_text')]:
            with self.assertRaisesRegex(mapping['Refused'],code):m(raw,pages)
    def test_exact_text_paragraph_bounds(self):
        m=mapping['map_text']
        self.assertEqual(len(m(b'A'*199998+b'\n\f',1)['text']),199998)
        with self.assertRaisesRegex(mapping['Refused'],'pdf_text_limit'):m(b'A'*199999+b'\n\f',1)
        self.assertEqual(m(b'A\n'*10000+b'\f',1)['text'].count('\n')+1,10000)
        with self.assertRaisesRegex(mapping['Refused'],'pdf_paragraph_limit'):m(b'A\n'*10001+b'\f',1)

if __name__ == '__main__': unittest.main()
