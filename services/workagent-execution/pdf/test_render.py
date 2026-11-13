"""Deterministic worker primitives, no LibreOffice or unsandboxed rendering."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('render', Path(__file__).with_name('render.py'))
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)

class RendererTests(unittest.TestCase):
    def test_installed_fonts_and_bounded_text_coverage(self):
        coverage = render.font_charsets(time.monotonic()+5)
        for text in ['', '雪 🌍', '🌍 雪', '雪🌍雪🌍 🌍雪🌍雪', 'Latin café <script> & <w:t> 00120\t\r\n']:
            render.check_text(text, coverage)
        for text in ['العربية', 'देवनागरी', 'Ελληνικά', 'Кириллица', '日本かな', '한글', 'e\u0301', '👩\u200d💻', '🌍\ufe0f', '👍🏽', '\u202e', '\U00020000']:
            with self.subTest(text=text), self.assertRaisesRegex(render.Refused, 'unsupported_text'):
                render.check_text(text, coverage)
        with self.assertRaisesRegex(render.Refused, 'missing_glyph'):
            render.check_text('\u9fff', coverage)

    def test_fontconfig_success_does_not_hide_substitution_or_missing_fonts(self):
        family, path, _ = render.FONTS['latin']
        for output in [f'Other Font\n{path}\n20-ff\n', f'{family}\n/other/font.ttf\n20-ff\n',
                       f'{family}\n{path}\n20-30\n', f'{family}\n{path}\nnot-a-charset\n']:
            with self.subTest(output=output), patch.object(render, 'run_bounded', return_value=(0, output.encode())):
                with self.assertRaisesRegex(render.Refused, 'pdf_fonts_unavailable'):
                    render.font_charsets(time.monotonic()+1)
        with patch.object(render, 'run_bounded', return_value=(0, f'{family}\n{path}\n20-ff\n'.encode())), patch.object(Path, 'is_file', return_value=False):
            with self.assertRaisesRegex(render.Refused, 'pdf_fonts_unavailable'):
                render.font_charsets(time.monotonic()+1)

    def test_generated_font_mapping_preserves_parts_text_styles_geometry_and_rejects_ambiguous_zip(self):
        root = Path(__file__).resolve().parents[3]
        # Trusted generated fixtures only. No host LibreOffice or upload parsing.
        script = r'''
import base64,io,runpy,zipfile,warnings,sys
from lxml import etree
from docx import Document
from docx.shared import Pt
codec=runpy.run_path(ROOT+'/services/workagent-execution/docx/codec.py')
render=runpy.run_path(ROOT+'/services/workagent-execution/pdf/render.py')
q=codec['q']
for text in [sys.argv[1]]:
    doc=Document();doc.sections[0].page_width=Pt(500);doc.sections[0].left_margin=Pt(25)
    for line in text.split('\n'):
        p=doc.add_paragraph();p.alignment=2;r=p.add_run(line);r.bold=True;r.italic=True;r.underline=True;r.font.size=Pt(17.5)
    original=io.BytesIO();doc.save(original);original=original.getvalue()
    native=codec['import_document'](original)['document']
    generated=base64.b64decode(codec['export_document'](native)['base64']);copy=bytes(generated)
    mapped=render['map_generated_fonts'](generated,codec)
    assert generated==copy
    assert codec['import_document'](mapped)==codec['import_document'](generated)
    with zipfile.ZipFile(io.BytesIO(generated)) as a,zipfile.ZipFile(io.BytesIO(mapped)) as b:
        assert a.namelist()==b.namelist()
        for name in a.namelist():
            if name!='word/document.xml':assert a.read(name)==b.read(name);continue
            before=etree.fromstring(a.read(name));after=etree.fromstring(b.read(name))
            for props in after.iter(q('rPr')):
                fonts=props.find(q('rFonts'));assert fonts is not None
                assert fonts.attrib=={q('ascii'):'DejaVu Serif',q('hAnsi'):'DejaVu Serif',q('eastAsia'):'WenQuanYi Zen Hei'}
                props.remove(fonts)
            assert etree.tostring(before,method='c14n')==etree.tostring(after,method='c14n')
    # Original DOCX remains byte-exact and its native mapping is unchanged.
    assert codec['import_document'](original)['document']==native
bad=io.BytesIO(generated)
with warnings.catch_warnings():
    warnings.simplefilter('ignore')
    with zipfile.ZipFile(bad,'a') as z:z.writestr('word/document.xml',b'<duplicate/>')
for data in [bad.getvalue(),generated+b'trailing',b'leading'+generated]:
    try:render['map_generated_fonts'](data,codec)
    except ValueError:pass
    else:raise AssertionError('ambiguous ZIP accepted')
print('preserved')
'''.replace('ROOT', repr(str(root)))
        for text in ['', '雪 🌍', '🌍 雪', '雪🌍雪🌍 🌍雪🌍雪', 'Latin café <script> & <w:t> 00120', '\n'.join('Paragraph '+str(i) for i in range(300))]:
            with self.subTest(text=text[:50]):
                result = subprocess.run([str(root/'.local/docx-python/bin/python'), '-I', '-B', '-c', script, text], capture_output=True, timeout=12)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                self.assertEqual(result.stdout.strip(), b'preserved')

    def test_limits_in_real_child(self):
        script = f"import runpy,resource,json;m=runpy.run_path({str(Path(__file__).with_name('render.py').resolve())!r});m['limits']();print(json.dumps([resource.getrlimit(k) for k in (resource.RLIMIT_AS,resource.RLIMIT_CPU,resource.RLIMIT_FSIZE,resource.RLIMIT_NOFILE)]))"
        result = subprocess.run(['/usr/bin/python3', '-I', '-c', script], capture_output=True, check=True, timeout=3)
        self.assertEqual(json.loads(result.stdout), [[2*1024**3]*2, [15]*2, [24*1024**2]*2, [128]*2])

    def test_child_nonzero_and_missing(self):
        code, output = render.run_bounded(['/usr/bin/python3', '-c', 'print("failure");raise SystemExit(7)'], b'', time.monotonic()+2, 100)
        self.assertEqual(code, 7)
        self.assertIn(b'failure', output)
        with self.assertRaisesRegex(render.Refused, 'unavailable'):
            render.run_bounded(['/not-a-renderer'], b'', time.monotonic()+2, 100)

    def test_output_and_stderr_limits(self):
        for script in ['print("x"*10000,flush=True)', 'import sys;print("x"*20000,file=sys.stderr,flush=True)']:
            with self.assertRaisesRegex(render.Refused, 'output_limit'):
                render.run_bounded(['/usr/bin/python3', '-c', script], b'', time.monotonic()+2, 100)

    def test_timeout_kills_actual_descendant(self):
        with tempfile.TemporaryDirectory() as directory:
            pidfile = Path(directory)/'pid'
            script = f"import subprocess,time,pathlib;c=subprocess.Popen(['/usr/bin/python3','-c','import time;time.sleep(10)']);pathlib.Path({str(pidfile)!r}).write_text(str(c.pid));time.sleep(10)"
            started = time.monotonic()
            with self.assertRaisesRegex(render.Refused, 'timeout'):
                render.run_bounded(['/usr/bin/python3', '-c', script], b'', started+.3, 100)
            self.assertLess(time.monotonic()-started, 2)
            status = Path('/proc')/pidfile.read_text()/'status'
            for _ in range(20):
                if not status.exists() or '\nState:\tZ' in status.read_text():
                    break
                time.sleep(.01)
            else:
                self.fail('descendant still running')

    def test_invalid_missing_and_oversized_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'output.pdf'
            with self.assertRaisesRegex(render.Refused, 'invalid_output'):
                render.checked_pdf(path)
            for data in [b'not a PDF', b'%PDF-1.7\ntruncated', b'%PDF-1.7\nfake\n%%EOF\n', b'%PDF-1.7\nstartxref\n9999\n%%EOF\n']:
                path.write_bytes(data)
                with self.assertRaisesRegex(render.Refused, 'invalid_output'):
                    render.checked_pdf(path)
            with path.open('wb') as output:
                output.truncate(render.PDF_BYTES+1)
            with self.assertRaisesRegex(render.Refused, 'output_limit'):
                render.checked_pdf(path)

if __name__ == '__main__':
    unittest.main()
