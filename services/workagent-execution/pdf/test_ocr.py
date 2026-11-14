"""Trusted synthetic worker unit checks; actual bwrap qualification is separate."""
import base64
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
from pypdf import PdfReader
ROOT = Path(__file__).resolve().parent
m = runpy.run_path(str(ROOT / 'ocr.py'))
f = runpy.run_path(str(ROOT / 'fixtures/ocr_import.py'))

def request(kind='scan', pages=1, mode='ocr-eng'):
    data = f['make'](kind, pages)
    with tempfile.TemporaryFile() as source:
        source.write(json.dumps({'op':'import','mode':mode,'base64':base64.b64encode(data).decode()}).encode()); source.seek(0)
        r = subprocess.run(['/usr/bin/python3', '-I', str(ROOT / ('ocr.py' if mode == 'ocr-eng' else 'extract.py'))], stdin=source, capture_output=True, timeout=55)
    return json.loads(r.stdout)

class OCR(unittest.TestCase):
    def test_real_image_only_and_leading_zeros(self):
        reader = PdfReader(io.BytesIO(f['make']()))
        self.assertFalse(reader.pages[0].extract_text().strip())
        self.assertEqual(len(reader.pages[0].images), 1)
        result = request(pages=3)
        self.assertEqual(result['pages'], 3)
        for line in ['Reference 00120', 'Guests 0042']:
            self.assertEqual(result['text'].count(line), 3, result)
        for n in range(1, 4): self.assertIn('English preview page %d' % n, result['text'])
        print('ACTUAL SYNTHETIC OCR:', repr(result['text']))
    def test_mixed_rasterizes_all_pages_ignores_hidden_text(self):
        r = request('mixed', 2)
        self.assertIn('English preview page 1', r['text'])
        self.assertIn('Visible text page 2', r['text'])
        self.assertEqual(r['text'].count('Reference 00120'), 2)
        self.assertNotIn('HIDDEN', r['text']); self.assertNotIn('99999', r['text'])
    def test_page_limit_blank_and_text_mode(self):
        self.assertEqual(request(pages=5)['pages'], 5)
        for kind,pages,error in [('scan',6,'pdf_ocr_page_limit'),('blank',1,'pdf_ocr_page_without_text'),('mixed-blank',2,'pdf_ocr_page_without_text')]:
            self.assertEqual(request(kind,pages), {'error':error})
        self.assertEqual(request(mode='text'), {'error':'pdf_ocr_not_supported'})
    def test_mode_and_unknown_keys(self):
        for value in [{}, {'op':'import','base64':'','mode':'text'}, {'op':'import','base64':'','mode':'ocr-eng','language':'eng'}]:
            with self.assertRaises(m['Refused']): m['extract'](value)
    def test_raster_and_text_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'x.pgm'
            for data,error in [(b'P5\n2401 1\n255\n' + b'x'*2401,'pdf_ocr_raster_limit'),(b'P5\n2 2\n255\nx','pdf_ocr_invalid_raster'),(b'x'*(m['RASTER_BYTES']+1),'pdf_ocr_raster_limit')]:
                path.write_bytes(data)
                with self.assertRaisesRegex(m['Refused'],error): m['raster_pixels'](path)
        for raw,error in [([b'...'],'pdf_ocr_page_without_text'),([b'A'*200001],'pdf_text_limit'),([b'ABC\n'*10001],'pdf_paragraph_limit'),([b'ABC\x00'],'pdf_unsupported_text'),([b'\xff'],'pdf_unsupported_text')]:
            with self.assertRaisesRegex(m['Refused'],error): m['map_pages'](raw)
        self.assertEqual(m['map_pages']([b'00120\n',b'0042\n'])['text'],'00120\n\n0042')
    def test_actual_child_diagnostics_output_timeout_threads_and_missing_runtime(self):
        run=m['run']; deadline=lambda:time.monotonic()+5
        python=lambda code:['/usr/bin/python3','-I','-c',code]
        good="import os,sys; assert os.environ['OMP_THREAD_LIMIT']=='1'; sys.stderr.write('Estimating resolution as 300\\n'); print('00120')"
        self.assertEqual(run(python(good),deadline(),100,ocr=True),b'00120\n')
        for code,limit,error in [("import sys; sys.stderr.write('warning: partial recognition\\n'); print('00120')",100,'pdf_ocr_diagnostics'),("print('x'*1000)",100,'pdf_ocr_output_limit'),("import sys; sys.stderr.write('x'*17000)",100,'pdf_ocr_output_limit'),("raise SystemExit(2)",100,'pdf_ocr_render_failed')]:
            with self.assertRaisesRegex(m['Refused'],error):run(python(code),deadline(),limit)
        with self.assertRaisesRegex(m['Refused'],'pdf_ocr_timeout'):run(python('import time;time.sleep(5)'),time.monotonic()+.05,100)
        with self.assertRaisesRegex(m['Refused'],'pdf_ocr_runtime_unavailable'):run(['/missing-ocr-engine'],deadline(),100)
        with patch.dict(m['extract'].__globals__,TESSDATA='/missing-tessdata'):
            with self.assertRaisesRegex(m['Refused'],'pdf_ocr_runtime_unavailable'):
                m['extract']({'op':'import','mode':'ocr-eng','base64':base64.b64encode(f['make']()).decode()})
    def test_total_pixel_budget_and_deadline_refuse_whole_document(self):
        req={'op':'import','mode':'ocr-eng','base64':base64.b64encode(f['make']()).decode()}
        for key,value,error in [('PIXELS',1,'pdf_ocr_raster_limit'),('DEADLINE_SECONDS',0,'pdf_ocr_timeout')]:
            with patch.dict(m['extract'].__globals__,{key:value}):
                with self.assertRaisesRegex(m['Refused'],error):m['extract'](req)

if __name__ == '__main__': unittest.main()
