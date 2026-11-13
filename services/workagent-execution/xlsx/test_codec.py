"""Trusted, locally generated fixtures only. This is not isolation qualification."""
import sys
sys.dont_write_bytecode = True
import base64
import datetime
import io
import unittest
import zipfile
import struct
import subprocess
import zlib
from copy import deepcopy
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('codec', Path(__file__).with_name('codec.py'))
codec = importlib.util.module_from_spec(spec); spec.loader.exec_module(codec)
import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.comments import Comment
from openpyxl.utils.datetime import MAC_EPOCH

def fixture():
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Inputs'
    ws.append(['00120', True, False, 1, 0, '=1+1', 'snow 雪'])
    ws['F1'].data_type = 's'
    ws['A2'] = 12.5; ws['A2'].number_format = '0.00'; ws['A2'].font = Font(name='Arial', bold=True, italic=True, color='FF123456'); ws['A2'].fill = PatternFill('solid', fgColor='FFFFEEAA')
    ws['B2'] = datetime.datetime(2026, 11, 13); ws['B2'].number_format = 'yyyy-mm-dd'
    ws['A3'] = 'Merged'; ws.merge_cells('A3:C3'); ws.row_dimensions[3].height = 30; ws.column_dimensions['A'].width = 25
    ws['A1'].comment = Comment('Not carried', 'Fixture'); ws['G1'].hyperlink = 'https://example.invalid/'
    other = wb.create_sheet('Summary'); other['A1'] = "='Inputs'!A2*2"; other['A2'] = '=SUM(Inputs!D1:E1)'
    out = io.BytesIO(); wb.save(out); return out.getvalue()

def rewrite(data, change):
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist(): dst.writestr(item.filename, change(item.filename, src.read(item.filename)))
    return output.getvalue()

# Small, generated ZIP fixtures, parsed only in the test runner's sandbox.
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def package(sheet, second='other.xml', definitions='', extra=None, compression=zipfile.ZIP_DEFLATED, descriptor=False):
    names = ['sheet1.xml'] + ([second] if second else [])
    parts = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/{n}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for n in names) + '</Types>',
        '_rels/.rels': f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': f'<workbook xmlns="{NS}" xmlns:r="{REL}"><sheets>' + ''.join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(['First', 'Merged'][:len(names)], 1)) + '</sheets>' + definitions + '</workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="{REL}/worksheet" Target="worksheets/{name}"/>' for i, name in enumerate(names, 1)) + '</Relationships>',
        'xl/worksheets/sheet1.xml': f'<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1"><v>10</v></c></row></sheetData></worksheet>' if second else sheet,
    }
    if second: parts['xl/worksheets/' + second] = sheet
    parts.update(extra or {})
    class StreamingZip(io.BytesIO):
        def seek(self, *args): raise OSError('non-seekable fixture')
    out = StreamingZip() if descriptor else io.BytesIO()
    with zipfile.ZipFile(out, 'w', compression) as z:
        for name, body in parts.items(): z.writestr(name, body)
    return out.getvalue()

def merged_sheet(child=''):
    return f'<worksheet xmlns="{NS}"><dimension ref="A1:C1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Heading</t></is></c>{child}</row></sheetData><mergeCells count="1"><mergeCell ref="A1:C1"/></mergeCells></worksheet>'

def zip_headers(data, name, *, size=None, crc=None, compressed_delta=0, local_method=None):
    raw = bytearray(data)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        entry = z.getinfo(name); local = entry.header_offset; central = z.start_dir
        for info in z.infolist():
            if info.filename == name: break
            n, e, c = struct.unpack_from('<HHH', raw, central + 28); central += 46 + n + e + c
    for offset, size_at, crc_at, comp_at in [(local, 22, 14, 18), (central, 24, 16, 20)]:
        if size is not None: struct.pack_into('<I', raw, offset + size_at, size)
        if crc is not None: struct.pack_into('<I', raw, offset + crc_at, crc)
        if compressed_delta: struct.pack_into('<I', raw, offset + comp_at, entry.compress_size + compressed_delta)
    if local_method is not None: struct.pack_into('<H', raw, local + 8, local_method)
    return bytes(raw)

class CodecTests(unittest.TestCase):
    def test_renamed_worksheet_parts_receive_full_preflight(self):
        for part in ['other.xml', 'renamed/data.part']:
            valid = package(merged_sheet(), second=part)
            self.assertEqual(codec.import_book(valid)['book']['sheets']['sheet2']['mergeData'][0]['endColumn'], 2)
            for sheet in [
                merged_sheet('<c r="B1" t="inlineStr"><is><t>KEEP</t></is></c>'),
                merged_sheet().replace('A1:C1', 'A1:GS1'),
                merged_sheet('<c r="A1"><v>20</v></c>'),
            ]:
                with self.subTest(part=part, sheet=sheet), self.assertRaises(ValueError): codec.import_book(package(sheet, second=part))

    def test_worksheet_identity_ambiguities_refused(self):
        valid = package(merged_sheet())
        changes = [
            lambda n,b: b.replace(b'/worksheet"', b'/styles"') if n.endswith('workbook.xml.rels') else b,
            lambda n,b: b.replace(b'.worksheet+xml', b'.styles+xml') if n == '[Content_Types].xml' else b,
            lambda n,b: b.replace(b'<worksheet ', b'<notWorksheet ').replace(b'</worksheet>', b'</notWorksheet>') if n.endswith('other.xml') else b,
            lambda n,b: b.replace(b'Id="rId2"', b'Id="rId1"') if n.endswith('workbook.xml.rels') else b,
            lambda n,b: b.replace(b'worksheets/other.xml', b'worksheets/sheet1.xml') if n.endswith('workbook.xml.rels') else b,
        ]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(Exception): codec.import_book(rewrite(valid, change))

    def test_renamed_worksheet_preflight_cell_and_merge_counts(self):
        rows = ''.join(f'<row r="{r}">' + ''.join(f'<c r="{codec.get_column_letter(c)}{r}"/>' for c in range(1, 201 if r <= 250 else 2)) + '</row>' for r in range(1, 252))
        sheet = f'<worksheet xmlns="{NS}"><sheetData>{rows}</sheetData></worksheet>'
        with self.assertRaisesRegex(ValueError, '50,000'): codec.preflight(package(sheet))
        merges = ''.join(f'<mergeCell ref="A{r}:B{r}"/>' for r in range(1, 1002))
        sheet = f'<worksheet xmlns="{NS}"><sheetData/><mergeCells>{merges}</mergeCells></worksheet>'
        with self.assertRaisesRegex(ValueError, 'Merge expansion'): codec.preflight(package(sheet))

    def test_cell_address_aliases_and_merge_aliases_refused(self):
        for address in ['A1', 'a1', 'A01']:
            sheet = f'<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="{address}"><v>20</v></c></row></sheetData></worksheet>'
            with self.subTest(address=address), self.assertRaises(ValueError): codec.import_book(package(sheet, second=None))
        for address in ['b1', 'B01', 'XFD01']:
            with self.subTest(merged=address), self.assertRaises(ValueError): codec.import_book(package(merged_sheet(f'<c r="{address}"><v>20</v></c>')))
        sheet = f'<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="B1"><v>20</v></c></row></sheetData></worksheet>'
        cells = codec.import_book(package(sheet, second=None))['book']['sheets']['sheet1']['cellData']['0']
        self.assertEqual([cells['0']['v'], cells['1']['v']], [10, 20])

    def test_unicode_and_ascii_formula_names_refused_in_actual_zip(self):
        for name in ['秘密', 'SecretName', 'Δείγμα', '_name', '秘密.fn']:
            definitions = f'<definedNames><definedName name="{name}">First!$A$1</definedName></definedNames>'
            sheet = f'<worksheet xmlns="{NS}"><sheetData><row r="1"><c r="A1"><v>10</v></c><c r="B1"><f>SUM({name})</f><v>10</v></c></row></sheetData></worksheet>'
            with self.subTest(name=name), self.assertRaises(ValueError): codec.import_book(package(sheet, second=None, definitions=definitions))
        for f in ['=秘密(A1)', '=SUM(秘密+1)', '=SUM(A1秘密)', '=SUM(A1)+秘密', '=SUM(A1)@', '=FOO(A1)', '=ſUM(A1)', '=ıF(A1,1,0)', '=１２+1', '=١٢+1']:
            with self.subTest(f=f), self.assertRaises(ValueError): codec.formula(f)

    def test_formula_unicode_literals_sheets_numbers_and_comparisons(self):
        for f in ['=IF(A1>=1,"秘密","雪")', "=SUM('雪の表'!$A$1:$B$2)", "='L''été 雪'!A1+1", '=SUM(A1:B2)+1.2E-3', '=IF(A1<>2,TRUE,FALSE)', '=if(A1<>2,true,false)', '=1E+2', '=12.34E-2+.5E+1+0E-2', '=SUM(A1:B2)/2%']:
            with self.subTest(f=f): self.assertEqual(codec.formula(f), f)
        for f in ['=SUM(A:A)', '=SUM(1:10)', '=SUM(A1:GR10000)', '=SUM(A1:B10000,A1:B10000,A1:B10000)']:
            with self.subTest(f=f), self.assertRaises(ValueError): codec.formula(f)

    def test_zip_actual_inflation_not_declared_prefix_crc(self):
        for length in [32, 5_000_001]:
            raw = package(merged_sheet(), extra={'payload.bin': b'x' * length})
            forged = zip_headers(raw, 'payload.bin', size=1, crc=zlib.crc32(b'x'))
            with self.subTest(length=length), self.assertRaisesRegex(ValueError, 'actual inflated' if length > codec.ENTRY else 'size/CRC'): codec.import_book(forged)

    def test_zip_actual_cumulative_inflation_limit(self):
        extra = {f'payload{i}.bin': b'x' * 4_500_000 for i in range(4)}
        extra['last.bin'] = b'x' * 3_000_000
        raw = package(merged_sheet(), extra=extra)
        forged = zip_headers(raw, 'last.bin', size=1, crc=zlib.crc32(b'x'))
        with self.assertRaisesRegex(ValueError, 'actual inflated entry/total'): codec.preflight(forged)

    def test_zip_stream_truncation_tail_and_local_method_refused(self):
        raw = package(merged_sheet(), extra={'payload.bin': b'x' * 32})
        for forged in [zip_headers(raw, 'payload.bin', compressed_delta=-1), zip_headers(raw, 'payload.bin', local_method=0), zip_headers(raw, 'payload.bin', crc=0)]:
            with self.subTest(forged=forged[-24:]), self.assertRaises(Exception): codec.import_book(forged)
        # A stored member containing a raw DEFLATE stream plus junk, with both
        # headers claiming DEFLATE, exercises unused stream data independently.
        compressor = zlib.compressobj(wbits=-15); payload = compressor.compress(b'x') + compressor.flush() + b'junk'
        raw = bytearray(package(merged_sheet(), extra={'payload.bin': payload}, compression=zipfile.ZIP_STORED))
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            local = z.getinfo('payload.bin').header_offset
            central = raw.find(b'PK\x01\x02', local)
            while raw[central+46:central+57] != b'payload.bin': central = raw.find(b'PK\x01\x02', central+4)
        struct.pack_into('<H', raw, local+8, 8); struct.pack_into('<H', raw, central+10, 8)
        with self.assertRaises(Exception): codec.import_book(zip_headers(bytes(raw), 'payload.bin', size=1, crc=zlib.crc32(b'x')))

    def test_zip_normal_stored_and_deflated_members(self):
        for compression in [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED]:
            for descriptor in [False, True]:
                with self.subTest(compression=compression, descriptor=descriptor): self.assertEqual(len(codec.import_book(package(merged_sheet(), extra={'payload.bin': b'x'*32}, compression=compression, descriptor=descriptor))['book']['sheetOrder']), 2)

    def test_real_typed_styled_date_merge_formula_roundtrip(self):
        result = codec.import_book(fixture()); book = result['book']; cells = book['sheets']['sheet1']['cellData']
        self.assertEqual(cells['0']['0']['v'], '00120'); self.assertEqual(cells['0']['1'], {'v': True, 't': 3}); self.assertEqual(cells['0']['3']['t'], 2)
        self.assertEqual(cells['0']['5'], {'v': '=1+1', 't': 1})
        self.assertEqual(book['sheets']['sheet2']['cellData']['0']['0'], {'f': "='Inputs'!A2*2"})
        self.assertTrue(any('hyperlink' in w for w in result['warnings']))
        result = codec.export_book(book); data = base64.b64decode(result['base64']); reopen = openpyxl.load_workbook(io.BytesIO(data), data_only=False)
        self.assertEqual(reopen.sheetnames, ['Inputs','Summary']); self.assertEqual(reopen['Inputs']['A1'].value, '00120'); self.assertEqual(reopen['Inputs']['F1'].data_type, 's')
        self.assertEqual(reopen['Inputs']['B1'].data_type, 'b'); self.assertEqual(reopen['Inputs']['D1'].data_type, 'n')
        self.assertEqual(reopen['Inputs']['B2'].value, datetime.datetime(2026,11,13)); self.assertTrue(reopen['Inputs']['A2'].font.bold)
        self.assertIn('A3:C3', reopen['Inputs'].merged_cells); self.assertAlmostEqual(reopen['Inputs'].column_dimensions['A'].width, 25)
        self.assertEqual(reopen['Summary']['A1'].value, "='Inputs'!A2*2")
        self.assertIsNone(openpyxl.load_workbook(io.BytesIO(data), data_only=True)['Summary']['A1'].value)
        self.assertEqual(codec.import_book(data)['book']['sheets']['sheet1']['cellData']['0']['0']['v'], '00120')
    def test_shared_formulas_export_as_equivalent_formulas(self):
        book = codec.import_book(fixture())['book']; sheet = book['sheets']['sheet2']; sheet['cellData'] = {'0': {'0': {'f': '=Inputs!A2', 'si': 'group', 'v': 999}}, '1': {'0': {'si': 'group', 'v': 888}}}
        data = base64.b64decode(codec.export_book(book)['base64']); wb = openpyxl.load_workbook(io.BytesIO(data)); self.assertEqual(wb['Summary']['A2'].value, '=Inputs!A3')
        self.assertIsNone(openpyxl.load_workbook(io.BytesIO(data), data_only=True)['Summary']['A2'].value)
    def test_shared_formula_real_xml_import(self):
        data = rewrite(fixture(), lambda n,b: b.replace(b"<f>'Inputs'!A2*2</f>", b'<f t="shared" si="0" ref="A1:A2">Inputs!A2*2</f>').replace(b'<f>SUM(Inputs!D1:E1)</f>', b'<f t="shared" si="0"/>') if n == 'xl/worksheets/sheet2.xml' else b)
        b = codec.import_book(data)['book']; self.assertEqual(b['sheets']['sheet2']['cellData']['1']['0']['f'], '=Inputs!A3*2')
    def test_1904_refused_without_reinterpreting(self):
        wb = openpyxl.Workbook(); wb.epoch = MAC_EPOCH; wb.active['A1'] = datetime.datetime(2026,1,1); out=io.BytesIO(); wb.save(out)
        with self.assertRaisesRegex(ValueError, '1904'): codec.import_book(out.getvalue())
    def test_preflight_dimensions_entities_duplicates_macro_bomb(self):
        source=fixture()
        for name, data in [
            ('dimension', rewrite(source, lambda n,b: b.replace(b'A1:G3', b'A1:XFD1048576') if n.endswith('sheet1.xml') else b)),
            ('entity', rewrite(source, lambda n,b: b'<!DOCTYPE x [<!ENTITY bad SYSTEM "file:///etc/passwd">]>' + b if n.endswith('sheet1.xml') else b)),
            ('macro', rewrite(source, lambda n,b: b.replace(b'spreadsheetml.sheet.main+xml', b'ms-excel.sheet.macroEnabled.main+xml') if n == '[Content_Types].xml' else b)),
            ('invalid', b'not a zip'), ('compressed', b'PK\x03\x04'+b'x'*2_000_000)]:
            with self.subTest(name=name), self.assertRaises(Exception): codec.import_book(data)
        for path in ['../escape', '/absolute', 'xl/vbaProject.bin', 'xl/worksheets/sheet1.xml']:
            out=io.BytesIO(source)
            with zipfile.ZipFile(out, 'a') as z: z.writestr(path, b'x')
            with self.assertRaises(Exception): codec.preflight(out.getvalue())
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z: z.writestr('xl/bomb.xml', b' '*5_000_001)
        with self.assertRaisesRegex(ValueError,'entry'): codec.preflight(out.getvalue())
    def test_error_and_forced_text_are_never_mislabelled(self):
        wb=openpyxl.Workbook(); wb.active['A1']='#DIV/0!'; out=io.BytesIO(); wb.save(out)
        imported=codec.import_book(out.getvalue()); self.assertEqual(imported['book']['sheets']['sheet1']['cellData']['0']['0']['t'],1)
        self.assertTrue(any('literal error text' in w for w in imported['warnings']))
        imported['book']['sheets']['sheet1']['cellData']['0']['0']={'v':'00120','t':4}
        data=base64.b64decode(codec.export_book(imported['book'])['base64']); c=openpyxl.load_workbook(io.BytesIO(data)).active['A1']
        self.assertEqual(c.value,'00120'); self.assertEqual(c.data_type,'s')
    def test_merge_data_duplicate_cells_crc_and_external_relationship_refused(self):
        source=fixture()
        cases=[
          rewrite(source,lambda n,b:b.replace(b'<c r="A3"',b'<c r="B3"') if n.endswith('sheet1.xml') else b),
          rewrite(source,lambda n,b:b.replace(b'<c r="B1"',b'<c r="A1"') if n.endswith('sheet1.xml') else b),
          rewrite(source,lambda n,b:b.replace(b'/hyperlink',b'/externalLink') if n.endswith('.rels') else b),
          rewrite(source,lambda n,b:b.replace(b'A3:C3',b'A1:GR10000') if n.endswith('sheet1.xml') else b),
        ]
        for data in cases:
            with self.assertRaises(Exception): codec.import_book(data)
        corrupt=bytearray(source); corrupt[80] ^= 0xff
        with self.assertRaises(Exception): codec.import_book(bytes(corrupt))
    def test_entry_total_field_formula_count_limits(self):
        for mode in ['entries','inflated','field','formulas']:
            with self.subTest(mode=mode),self.assertRaises(Exception):
                if mode in ['entries','inflated']:
                    out=io.BytesIO()
                    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
                        for i in range(257 if mode=='entries' else 5): z.writestr(str(i),b'x' if mode=='entries' else b' '*4_500_000)
                    codec.preflight(out.getvalue())
                else:
                    wb=openpyxl.Workbook()
                    if mode=='field': wb.active['A1']='x'*20001
                    else:
                        for i in range(2001): wb.active.cell(i+1,1,'=1+1')
                    out=io.BytesIO();wb.save(out);codec.import_book(out.getvalue())
    def test_real_50000_cell_boundary_and_one_more_refused(self):
        wb=openpyxl.Workbook(); wb.create_sheet('Second')
        for ws in wb.worksheets:
            for r in range(250): ws.append(list(range(100)))
        out=io.BytesIO();wb.save(out); result=codec.import_book(out.getvalue())
        self.assertEqual(result['cells'],50000)
        self.assertLess(len(__import__('json').dumps(result['book'])),4000000)
        wb.create_sheet('Excess')['A1']=1; out=io.BytesIO();wb.save(out)
        with self.assertRaisesRegex(ValueError,'50,000'): codec.import_book(out.getvalue())
    def test_active_named_whole_column_complex_formulas_refused(self):
        for f in ['=WEBSERVICE("https://example.invalid")', '=HYPERLINK("file:///x")', "='[other.xlsx]Sheet1'!A1", '=SUM(A:A)', '=SecretName+1', '=SUM(A1:GR10000)', '=1'+ '+1'*201]:
            with self.subTest(f=f), self.assertRaises(ValueError): codec.formula(f)
    def test_export_refuses_content_loss_missing_shared_and_bounds(self):
        for cell in [{'si':'missing'}, {'p':{'body':{'dataStream':'rich\r\n'}}}, {'v':'x'*20001}, {'f':'=WEBSERVICE("x")'}]:
            b=codec.import_book(fixture())['book']; b['sheets']['sheet2']['cellData']={'0':{'0':cell}}
            with self.assertRaises(Exception): codec.export_book(b)
        b=codec.import_book(fixture())['book']; b['sheets']['sheet1']['cellData']['2']['1']={'v':'keep me','t':1}
        with self.assertRaisesRegex(ValueError,'discard'): codec.export_book(b)

if __name__ == '__main__':
    if len(sys.argv) > 1:
        unittest.main()
    else:
        # The codec sets an eight-second *process* CPU limit. Give each test its
        # own process, as production does for each conversion; never raise it.
        tests = unittest.defaultTestLoader.getTestCaseNames(CodecTests)
        failed = 0
        for name in tests:
            result = subprocess.run([sys.executable, '-I', '-B', __file__, 'CodecTests.'+name], capture_output=True, text=True, timeout=30)
            print(('PASS ' if result.returncode == 0 else 'FAIL ') + name, flush=True)
            if result.returncode:
                print(result.stdout + result.stderr, flush=True); failed += 1
        print(f'{len(tests)} codec tests, {failed} failed', flush=True)
        sys.exit(bool(failed))
