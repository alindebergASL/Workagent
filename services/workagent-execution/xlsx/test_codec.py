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
import json
from xml.etree import ElementTree as ET
from copy import deepcopy
from unittest.mock import patch
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('codec', Path(__file__).with_name('codec.py'))
codec = importlib.util.module_from_spec(spec); spec.loader.exec_module(codec)
import openpyxl
from openpyxl.styles import Font, PatternFill
from openpyxl.comments import Comment
from openpyxl.worksheet.datavalidation import DataValidation
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

def chart_fixture():
    # Independently authored Excel-style source: no native codec export involved.
    from openpyxl.chart import BarChart, LineChart, Reference
    wb=openpyxl.Workbook();ws=wb.active;ws.title="O'Brien & 雪"
    for row,values in enumerate([['Label','Units','Double'],['Zero',0,'=C3*2'],['Negative',-2,'=C4*2'],['Missing',None,None]],2):
        for col,value in enumerate(values,2): ws.cell(row,col,value)
    other=wb.create_sheet('Other');other.append(['Label','Number']);other.append(['One',1])
    for cls,sheet,end,col,anchor in [(BarChart,ws,5,4,'G2'),(LineChart,ws,5,4,'G20'),(BarChart,other,2,2,'D1')]:
        c=cls();c.title='<Budget & "雪">';c.visible_cells_only=False
        c.add_data(Reference(sheet,min_col=3 if sheet is ws else 2,max_col=col,min_row=2 if sheet is ws else 1,max_row=end),titles_from_data=True)
        c.set_categories(Reference(sheet,min_col=2 if sheet is ws else 1,min_row=3 if sheet is ws else 2,max_row=end));sheet.add_chart(c,anchor)
    out=io.BytesIO();wb.save(out);return out.getvalue()

def chart_rewrite(data, change):
    def edit(name,raw):
        if name=='xl/charts/chart1.xml':
            root=ET.fromstring(raw);change(root);return ET.tostring(root)
        return raw
    return rewrite(data,edit)

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

FP = 'http://schemas.microsoft.com/office/spreadsheetml/2022/featurepropertybag'
FP_REL = 'http://schemas.microsoft.com/office/2022/11/relationships/FeaturePropertyBag'
FP_TYPE = 'application/vnd.ms-excel.featurepropertybag+xml'
FP_URI = '{C7286773-470A-42A8-94C5-96B5CB345126}'
FP_PATH = 'xl/featurePropertyBag/featurePropertyBag.xml'

def checkbox_fixture(default=1):
    # Schema-generated package, deliberately reordered bags and non-origin cells.
    wb = openpyxl.Workbook(); ws = wb.active
    for ref, value in [('E9', False), ('E10', True), ('E11', None), ('F9', False)]:
        ws[ref] = value; ws[ref].font = Font(name='Arial', bold=True)
    ws['A1'] = '=1+2'
    second = wb.create_sheet('Second'); second['C4'] = True; second['C4'].font = Font(italic=True)
    dv = DataValidation(type='list', formula1='"One,Two"'); dv.add('B15:B16'); ws.add_data_validation(dv)
    out = io.BytesIO(); wb.save(out)
    with zipfile.ZipFile(io.BytesIO(out.getvalue())) as z: parts = {n: z.read(n) for n in z.namelist()}
    styles = ET.fromstring(parts['xl/styles.xml']); xfs = styles.find('{'+NS+'}cellXfs'); clones = {}
    for name, refs in [('xl/worksheets/sheet1.xml', {'E9','E10','E11'}), ('xl/worksheets/sheet2.xml', {'C4'})]:
        sheet = ET.fromstring(parts[name])
        for cell in sheet.iter('{'+NS+'}c'):
            if cell.get('r') not in refs: continue
            original = int(cell.get('s', '0'))
            if original not in clones:
                clone = deepcopy(xfs[original]); clones[original] = len(xfs); xfs.append(clone)
                ext = ET.SubElement(ET.SubElement(clone, '{'+NS+'}extLst'), '{'+NS+'}ext', uri=FP_URI)
                ET.SubElement(ext, '{'+FP+'}xfComplement', i='0')
            cell.set('s', str(clones[original]))
        parts[name] = ET.tostring(sheet)
    xfs.set('count', str(len(xfs))); parts['xl/styles.xml'] = ET.tostring(styles)
    parts[FP_PATH] = (f'<FeaturePropertyBags xmlns="{FP}"><bag type="XFComplement"><bagId k="XFControls">3</bagId></bag>'
        '<bag type="XFComplements" extRef="XFComplementsMapperExtRef"><a k="MappedFeaturePropertyBags"><bagId>0</bagId></a></bag>'
        f'<bag type="Checkbox"><i k="default">{default}</i></bag><bag type="XFControls"><bagId k="CellControl">2</bagId></bag></FeaturePropertyBags>').encode()
    rels = ET.fromstring(parts['xl/_rels/workbook.xml.rels'])
    ET.SubElement(rels, '{'+codec.PACKAGE_REL+'}Relationship', Id='checkbox', Type=FP_REL, Target='featurePropertyBag/featurePropertyBag.xml')
    parts['xl/_rels/workbook.xml.rels'] = ET.tostring(rels)
    types = ET.fromstring(parts['[Content_Types].xml'])
    ET.SubElement(types, '{'+codec.CONTENT+'}Override', PartName='/'+FP_PATH, ContentType=FP_TYPE)
    parts['[Content_Types].xml'] = ET.tostring(types)
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, body in parts.items(): z.writestr(name, body)
    return out.getvalue()

def request_codec(request):
    result = subprocess.run([sys.executable, '-I', '-B', str(Path(__file__).with_name('codec.py'))],
        input=json.dumps(request)+'\n', capture_output=True, text=True, timeout=12)
    response = json.loads(result.stdout)
    if result.returncode: raise ValueError(response.get('error', result.stderr))
    return response

def import_checkbox(raw): return request_codec({'op':'import', 'base64':base64.b64encode(raw).decode()})

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
    def test_checkbox_namespace_identity(self):
        # Two tabs, same address: checkbox false and ordinary boolean true.
        source = checkbox_fixture()
        def ordinary(name, raw):
            if name != 'xl/worksheets/sheet2.xml': return raw
            return f'<worksheet xmlns="{NS}"><sheetData><row r="9"><c r="E9" t="b"><v>1</v></c></row></sheetData></worksheet>'.encode()
        source = rewrite(source, ordinary)
        book = import_checkbox(source)['book']
        self.assertEqual([book['sheets'][s]['name'] for s in book['sheetOrder']], ['Sheet','Second'])
        self.assertEqual(book['sheets']['sheet1']['cellData']['8']['4']['v'], 0)
        self.assertIs(book['sheets']['sheet2']['cellData']['8']['4']['v'], True)
        self.assertNotIn('sheet2', json.loads(book['resources'][0]['data']))
        for scenario in ('foreign-sheets','duplicate-sheets','foreign-sheet','nested-workbook',
                         'sheet-name','sheet-id','sheet-name-attribute','sheet-id-attribute',
                         'foreign-xfs','duplicate-xfs','foreign-xf','foreign-ext',
                         'foreign-rel','rel-id','foreign-cell','row-child','nested-row','duplicate-data'):
            def mutate(name, raw):
                root = ET.fromstring(raw) if name.endswith(('.xml','.rels')) else None
                if name == 'xl/workbook.xml':
                    sheets = root.find('{'+NS+'}sheets'); sheet = sheets[0]
                    if scenario in ('foreign-sheets','duplicate-sheets'):
                        extra = deepcopy(sheets); extra[:] = list(reversed(extra))
                        if scenario == 'foreign-sheets': extra.tag = '{urn:foreign}sheets'
                        root.append(extra)
                    if scenario == 'foreign-sheet': sheet.tag = '{urn:foreign}sheet'
                    if scenario == 'nested-workbook': root.append(deepcopy(root))
                    if scenario == 'sheet-name': ET.SubElement(sheet, '{urn:foreign}name').text = 'Renamed'
                    if scenario == 'sheet-id': ET.SubElement(sheet, '{urn:foreign}id').text = 'rId2'
                    if scenario == 'sheet-name-attribute': sheet.set('{urn:foreign}name','Renamed')
                    if scenario == 'sheet-id-attribute': sheet.set('id','rId2')
                elif name == 'xl/styles.xml':
                    xfs = root.find('{'+NS+'}cellXfs')
                    if scenario in ('foreign-xfs','duplicate-xfs'):
                        extra = deepcopy(xfs); extra[:] = list(reversed(extra))
                        # No extra xfComplement: the old reference-count check
                        # alone cannot detect a replacement ordinary XF array.
                        for xf in extra:
                            for ext in list(xf):
                                if ext.tag == '{'+NS+'}extLst': xf.remove(ext)
                        if scenario == 'foreign-xfs': extra.tag = '{urn:foreign}cellXfs'
                        root.append(extra)
                    if scenario == 'foreign-xf': xfs[0].tag = '{urn:foreign}xf'
                    if scenario == 'foreign-ext': next(root.iter('{'+NS+'}extLst')).tag = '{urn:foreign}extLst'
                elif name == 'xl/_rels/workbook.xml.rels':
                    if scenario == 'foreign-rel': root[0].tag = '{urn:foreign}Relationship'
                    if scenario == 'rel-id': ET.SubElement(root[0], '{urn:foreign}Id').text = 'rId2'
                elif name == 'xl/worksheets/sheet1.xml':
                    data = root.find('{'+NS+'}sheetData'); row = next(r for r in data if r.get('r')=='9')
                    if scenario == 'foreign-cell': row[0].tag = '{urn:foreign}c'
                    if scenario == 'row-child': row[0].tag = '{urn:foreign}anything'
                    if scenario == 'nested-row': data.remove(row); ET.SubElement(root, '{urn:foreign}wrapper').append(row)
                    if scenario == 'duplicate-data': root.append(ET.Element('{'+NS+'}sheetData'))
                return ET.tostring(root) if root is not None else raw
            with self.subTest(scenario=scenario), self.assertRaises(ValueError):
                import_checkbox(rewrite(source, mutate))

    def test_loaded_checkbox_sheet_identity_mismatch_refused(self):
        source = checkbox_fixture()
        for scenario in ('order','name','relationship','path'):
            class DisagreeingReader(codec.ExcelReader):
                def read(self):
                    super().read()
                    if scenario == 'order': self.wb._sheets.reverse()
                    if scenario == 'name': self.parser.sheets[0].name = 'Changed'
                    if scenario == 'relationship': self.parser.sheets[0].id = self.parser.sheets[1].id
                    if scenario == 'path': self.parser.rels[self.parser.sheets[0].id].Target = 'xl/worksheets/wrong.xml'
            with self.subTest(scenario=scenario), patch.object(codec, 'ExcelReader', DisagreeingReader):
                with self.assertRaisesRegex(ValueError, 'identity/order mismatch'):
                    codec.import_book(source)

    def test_modern_checkbox_import_defaults_styles_and_roundtrip(self):
        for default in (0, 1, 2):
            imported = import_checkbox(checkbox_fixture(default)); book = imported['book']
            rules = json.loads(book['resources'][0]['data']); check = [r for r in rules['sheet1'] if r['type']=='checkbox']
            self.assertEqual(len(check), 1)
            self.assertEqual(check[0]['ranges'], [{'startRow':8,'endRow':10,'startColumn':4,'endColumn':4}])
            cells = book['sheets']['sheet1']['cellData']
            self.assertEqual((cells['8']['4']['v'],cells['8']['4']['t']), (0,3)); self.assertEqual((cells['9']['4']['v'],cells['9']['4']['t']), (1,3))
            self.assertNotIn('v', cells['10']['4']); self.assertIs(cells['8']['5']['v'], False)
            self.assertEqual(cells['8']['4']['s']['bl'], 1)
            result = request_codec({'op':'export','book':book}); raw = base64.b64decode(result['base64'])
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
                rel, = [r for r in rels if r.get('Type') == FP_REL]
                part = rel.get('Target').lstrip('/') if rel.get('Target').startswith('/') else 'xl/'+rel.get('Target')
                bags = ET.fromstring(z.read(part)); self.assertEqual(bags.tag, '{'+FP+'}FeaturePropertyBags')
                types = ET.fromstring(z.read('[Content_Types].xml'))
                self.assertTrue(any(e.get('PartName')=='/'+part and e.get('ContentType')==FP_TYPE for e in types))
                xfs = ET.fromstring(z.read('xl/styles.xml')).find('{'+NS+'}cellXfs')
                sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
                rawcells = {c.get('r'):c for c in sheet.iter('{'+NS+'}c')}
                style = lambda ref: xfs[int(rawcells[ref].get('s','0'))]
                self.assertIsNotNone(style('E9').find('.//{'+FP+'}xfComplement'))
                self.assertIsNone(style('F9').find('.//{'+FP+'}xfComplement'))
                mapping = int(style('E9').find('.//{'+FP+'}xfComplement').get('i'))
                mapper, = [bag for bag in bags if bag.get('type')=='XFComplements' and bag.get('extRef')=='XFComplementsMapperExtRef']
                complement = bags[int(mapper.find('{'+FP+'}a')[mapping].text)]
                self.assertEqual(complement.get('type'),'XFComplement')
                controls = bags[int(complement.find('{'+FP+'}bagId').text)]
                self.assertEqual(controls.get('type'),'XFControls')
                self.assertEqual(controls[0].get('k'),'CellControl')
                self.assertEqual(bags[int(controls[0].text)].get('type'),'Checkbox')
                cloned=deepcopy(style('E9')); cloned.remove(cloned.find('{'+NS+'}extLst'))
                self.assertEqual(ET.tostring(cloned),ET.tostring(style('F9')))
                self.assertEqual(rawcells['E9'].get('s'), rawcells['E11'].get('s'))
                self.assertEqual(rawcells['E9'].get('t'), 'b'); self.assertEqual(rawcells['E9'].find('{'+NS+'}v').text,'0')
                self.assertIsNone(rawcells['E11'].find('{'+NS+'}v'))
                self.assertEqual(len(list(sheet.iter('{'+NS+'}dataValidation'))), 1)
                self.assertFalse(rawcells['A1'].find('{'+NS+'}v').text)
            reopened = import_checkbox(raw)['book']
            self.assertEqual(json.loads(reopened['resources'][0]['data']), rules)
            self.assertEqual(reopened['sheets']['sheet2']['cellData']['3']['2']['s']['it'], 1)

    def test_modern_checkbox_bad_metadata_and_semantics_refused(self):
        source = checkbox_fixture()
        changes = [
            (FP_PATH, b'>3</', b'>0</'), # cycle / wrong referenced type
            (FP_PATH, b'>2</', b'>99</'),
            (FP_PATH, b'<i k="default">1', b'<i k="default">9'),
            (FP_PATH, b'<bagId>0</bagId>', b'<bagId>0</bagId>'*4001),
            (FP_PATH, b'<FeaturePropertyBags ', b'<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><FeaturePropertyBags '),
            ('xl/styles.xml', b'i="0"', b'i="3"'),
            ('xl/styles.xml', FP.encode(), b'urn:foreign'),
            ('xl/_rels/workbook.xml.rels', b'Target="featurePropertyBag/featurePropertyBag.xml"', b'Target="../outside.xml"'),
            ('xl/_rels/workbook.xml.rels', b'Target="featurePropertyBag/featurePropertyBag.xml"', b'Target="https://example.invalid/a" TargetMode="External"'),
            ('xl/worksheets/sheet1.xml', b'r="E9" s="3" t="b"', b'r="E9" s="999" t="b"'),
        ]
        for part, before, after in changes:
            with self.subTest(part=part, after=after[:70]), self.assertRaises(ValueError):
                import_checkbox(rewrite(source, lambda n,b: b.replace(before,after) if n==part else b))

    def test_modern_checkbox_export_semantics_overlap_merges_and_caps(self):
        book = import_checkbox(checkbox_fixture())['book']
        for cell in [{'v':'TRUE','t':1}, {'f':'=1=1','v':True,'t':3}, {'si':'shared','v':False}, {'p':{'body':{'dataStream':'rich\r\n'}}}]:
            bad=deepcopy(book); bad['sheets']['sheet1']['cellData']['8']['4']=cell
            with self.subTest(cell=cell), self.assertRaises(ValueError): request_codec({'op':'export','book':bad})
        for change in ['overlap','merge','custom','prompt','cap']:
            bad=deepcopy(book); rules=json.loads(bad['resources'][0]['data']); check=rules['sheet1'][-1]
            if change=='overlap': check['ranges']=[rules['sheet1'][0]['ranges'][0]]
            if change=='merge': bad['sheets']['sheet1']['mergeData']=[check['ranges'][0]]
            if change=='custom': check['formula1']='Yes'
            if change=='prompt': check['showInputMessage']=True
            if change=='cap':
                bad['sheets']['sheet1']['rowCount']=10000; bad['sheets']['sheet1']['columnCount']=200
                check['ranges']=[{'startRow':0,'endRow':249,'startColumn':0,'endColumn':199},{'startRow':250,'endRow':250,'startColumn':0,'endColumn':0}]
                rules['sheet1']= [check]
            bad['resources'][0]['data']=json.dumps(rules)
            with self.subTest(change=change), self.assertRaises(ValueError): request_codec({'op':'export','book':bad})

    def test_modern_checkbox_import_inheritance_overlap_and_relationship_refusals(self):
        source=checkbox_fixture()
        for scenario in ['formula','string','merge','validation','row','column','base','default-style','duplicate-rel','missing-part','dxf','range-cap']:
            def change(name, raw):
                if name=='xl/worksheets/sheet1.xml':
                    root=ET.fromstring(raw); cells={c.get('r'):c for c in root.iter('{'+NS+'}c')}; cell=cells['E9']; style=cell.get('s')
                    if scenario=='formula': ET.SubElement(cell,'{'+NS+'}f').text='1=1'
                    if scenario=='string': cell.set('t','str'); cell[0].text='TRUE'
                    if scenario=='merge': ET.SubElement(ET.SubElement(root,'{'+NS+'}mergeCells'),'{'+NS+'}mergeCell',ref='E9:E10')
                    if scenario=='validation': next(root.iter('{'+NS+'}dataValidation')).set('sqref','E9')
                    if scenario=='row': next(r for r in root.iter('{'+NS+'}row') if r.get('r')=='9').set('s',style)
                    if scenario=='column': ET.SubElement(ET.SubElement(root,'{'+NS+'}cols'),'{'+NS+'}col',min='5',max='16384',style=style)
                    if scenario=='range-cap':
                        data=root.find('{'+NS+'}sheetData'); data.clear()
                        for row in range(1,22):
                            r=ET.SubElement(data,'{'+NS+'}row',r=str(row))
                            for col in range(1,101,2): ET.SubElement(r,'{'+NS+'}c',r=f'{codec.get_column_letter(col)}{row*2-1}',s=style)
                            r.set('r',str(row*2-1))
                    return ET.tostring(root)
                if name=='xl/styles.xml' and scenario in ['base','dxf','default-style']:
                    root=ET.fromstring(raw); xfs=root.find('{'+NS+'}cellXfs'); ext=deepcopy(xfs[-1][0])
                    if scenario=='base': xfs[-1].set('xfId','99')
                    if scenario=='default-style': xfs[0].append(ext)
                    if scenario=='dxf': ET.SubElement(ET.SubElement(root,'{'+NS+'}dxfs'),'{'+NS+'}dxf').append(ext)
                    return ET.tostring(root)
                if name=='xl/_rels/workbook.xml.rels':
                    root=ET.fromstring(raw); rel=next(e for e in root if e.get('Type')==FP_REL)
                    if scenario=='duplicate-rel': duplicate=deepcopy(rel); duplicate.set('Id','another'); root.append(duplicate)
                    if scenario=='missing-part': rel.set('Target','missing.xml')
                    return ET.tostring(root)
                return raw
            with self.subTest(scenario=scenario), self.assertRaises(ValueError): import_checkbox(rewrite(source,change))

    def test_modern_checkbox_blank_base_style_grouping_and_sparse_cells(self):
        book=codec.import_book(fixture())['book']; sheet=book['sheets']['sheet2']
        # A rectangle of previously absent, unstyled cells needs actual <c>
        # records and one cloned default XF, without changing ordinary booleans.
        book['resources']=[{'name':codec.CONTROL_RESOURCE,'data':json.dumps({'sheet2':[{'uid':'blank','type':'checkbox','ranges':[{'startRow':3,'endRow':19,'startColumn':2,'endColumn':9}]}]})}]
        exported=request_codec({'op':'export','book':book}); imported=import_checkbox(base64.b64decode(exported['base64']))['book']
        check=json.loads(imported['resources'][0]['data'])['sheet2'][0]
        self.assertEqual(check['ranges'],[{'startRow':3,'endRow':19,'startColumn':2,'endColumn':9}])
        self.assertEqual(imported['sheets']['sheet1']['cellData']['0']['1']['v'],True)
        self.assertNotIn('sheet1',json.loads(imported['resources'][0]['data']))
        for row in range(3,20):
            for col in range(2,10): self.assertIsNone(imported['sheets']['sheet2']['cellData'].get(str(row),{}).get(str(col),{}).get('v'))

    def test_empty_conditional_resource_exports_but_rules_are_refused(self):
        book = codec.import_book(fixture())['book']
        for data in ['', '{}', json.dumps({'sheet1': []}), json.dumps({'deleted_sheet': [], 'sheet1': []})]:
            book['resources'] = [{'name': 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', 'data': data}]
            result = codec.export_book(book)
            reopened = codec.import_book(base64.b64decode(result['base64']))['book']
            self.assertEqual(reopened['sheets']['sheet1']['cellData']['0']['0']['v'], '00120')
        for data in [{'sheet1': [{'cfId': 'numeric', 'rule': {'type': 'highlightCell'}}]},
                     {'deleted_sheet': [{}]}, {'deleted_sheet': {}}, {'__proto__': []},
                     {'constructor': []}, {'prototype': []}, {'foreign/sheet': []}]:
            book['resources'][0]['data'] = json.dumps(data)
            with self.assertRaises(ValueError):
                codec.export_book(book)
        book['resources'] = [{'name': 'FOREIGN_PLUGIN', 'data': '{}'}]
        with self.assertRaises(ValueError):
            codec.export_book(book)

    def test_inline_lists_real_xml_multisheet_roundtrip(self):
        book = codec.import_book(fixture())['book']
        rules = {}
        for i, sid in enumerate(book['sheetOrder']):
            rules[sid] = [{'uid': 'list1', 'type': 'list', 'formula1': json.dumps(['Ready & <now>', '雪', '=1+1']),
                'formula2': '#ff0000,,', 'renderMode': 1, 'allowBlank': bool(i), 'showDropDown': not bool(i),
                'showErrorMessage': True, 'errorStyle': i, 'error': 'Choose a value', 'errorTitle': 'Choice',
                'showInputMessage': True, 'prompt': 'Pick one', 'promptTitle': 'Options',
                'ranges': [{'startRow': 4, 'endRow': 7, 'startColumn': 2, 'endColumn': 2},
                           {'startRow': 10, 'endRow': 10, 'startColumn': 0, 'endColumn': 0}]}]
        book['resources'] = [{'name': codec.CONTROL_RESOURCE, 'data': json.dumps(rules)}]
        result = codec.export_book(book); raw = base64.b64decode(result['base64'])
        wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=False)
        self.assertEqual(len(wb.worksheets), 2)
        for i, ws in enumerate(wb.worksheets):
            dv, = ws.data_validations.dataValidation
            self.assertEqual(dv.formula1, '"Ready & <now>,雪,=1+1"')
            self.assertEqual(str(dv.sqref), 'A11 C5:C8')
            self.assertEqual(dv.showDropDown, bool(i)); self.assertEqual(dv.allowBlank, bool(i))
            self.assertTrue(dv.showErrorMessage); self.assertEqual(dv.errorStyle, ['information', 'stop'][i])
            self.assertEqual(dv.prompt, 'Pick one'); self.assertIsNone(ws['C8'].value)
        self.assertEqual(wb['Inputs']['F1'].data_type, 's')
        self.assertTrue(wb['Inputs']['A2'].font.bold); self.assertIn('A3:C3', wb['Inputs'].merged_cells)
        self.assertEqual(wb['Summary']['A1'].value, "='Inputs'!A2*2")
        reopened = codec.import_book(raw)
        native = json.loads(reopened['book']['resources'][0]['data'])
        for i, sid in enumerate(book['sheetOrder']):
            rule, = native[sid]
            self.assertEqual(json.loads(rule['formula1']), ['Ready & <now>', '雪', '=1+1'])
            self.assertEqual(rule['showDropDown'], not bool(i)); self.assertEqual(rule['allowBlank'], bool(i))
            self.assertEqual(rule['errorStyle'], i); self.assertEqual(len(rule['ranges']), 2)
        self.assertTrue(any('presentation' in w for w in result['warnings']))
        self.assertNotIn('Not retained: dataValidation', reopened['warnings'])

    def test_list_encoding_refusal_and_exact_limits(self):
        for options in [['a,b'], ['a"b'], [''], ['line\nbreak'], ['a;b'], [' x'], ['_x0041_'], ['x'*200, 'y'*54], ['😀'*128]]:
            with self.subTest(options=options), self.assertRaises(ValueError): codec.inline_list(options)
        self.assertEqual(codec.inline_list(['x'*200, 'y'*52]), '"'+'x'*200+','+'y'*52+'"')

    def test_import_unsupported_validation_never_evaluates_references(self):
        for formula in ['A1:A2', '=Inputs!$A$1:$A$2', 'SecretName', "'[external.xlsx]Sheet'!A1", '=WEBSERVICE("https://example.invalid")']:
            wb = openpyxl.Workbook(); dv = DataValidation(type='list', formula1=formula); dv.add('A1:A3'); wb.active.add_data_validation(dv)
            out = io.BytesIO(); wb.save(out); result = codec.import_book(out.getvalue())
            self.assertNotIn('resources', result['book'])
            self.assertTrue(any('Unsupported validation' in w for w in result['warnings']))

    def test_validation_defaults_blank_extent_and_nonrepresentable_import(self):
        raw = f'<worksheet xmlns="{NS}"><sheetData/><dataValidations count="1"><dataValidation type="list" sqref="$AD$300:$AD$301"><formula1>"One,Two"</formula1></dataValidation></dataValidations></worksheet>'
        result = codec.import_book(package(raw, second=None))['book']
        rule = json.loads(result['resources'][0]['data'])['sheet1'][0]
        self.assertEqual((rule['allowBlank'], rule['showDropDown'], rule['showErrorMessage'], rule['showInputMessage'], rule['errorStyle']), (False, True, False, False, 1))
        self.assertEqual((result['sheets']['sheet1']['rowCount'], result['sheets']['sheet1']['columnCount']), (301, 30))
        self.assertEqual(result['sheets']['sheet1']['cellData'], {})
        disabled = raw.replace('count="1"', 'count="1" disablePrompts="1"').replace('type="list"', 'type="list" showInputMessage="1"')
        disabled_book = codec.import_book(package(disabled, second=None))['book']
        self.assertFalse(json.loads(disabled_book['resources'][0]['data'])['sheet1'][0]['showInputMessage'])
        for source in ['"One,,Two"', '"One;&quot;Two"', '"_x0041_"', '"'+'x'*256+'"']:
            with self.subTest(source=source), self.assertRaises(ValueError): codec.import_book(package(raw.replace('"One,Two"', source), second=None))

    def test_validation_preflight_rejects_overlap_bounds_and_schema(self):
        def sheet(rules): return f'<worksheet xmlns="{NS}"><sheetData/><dataValidations>{rules}</dataValidations></worksheet>'
        def rule(ref): return f'<dataValidation type="list" sqref="{ref}"><formula1>"One,Two"</formula1></dataValidation>'
        for rules in [rule('A1:A3')+rule('A3:A4'), rule('A1:XFD1048576'), rule('A1 A1'), rule('A0'),
                      rule('A1')*257, rule('A1').replace('<formula1>', '<formula2>'),
                      rule('A1').replace('type="list"', 'type="list" showDropDown="maybe"')]:
            with self.subTest(rules=rules[:100]), self.assertRaises(Exception): codec.import_book(package(sheet(rules), second=None))

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

    def test_chart_roundtrip_real_objects_and_xml(self):
        source=chart_fixture(); imported=codec.import_book(source); book=imported['book']
        charts=codec.native_charts(book)
        self.assertEqual([c['type'] for c in charts], ['bar','line','bar'])
        self.assertEqual(charts[0]['range'], {'startRow':1,'endRow':4,'startColumn':1,'endColumn':3})
        self.assertEqual(charts[0]['title'], '<Budget & "雪">')
        self.assertFalse(any('Not retained: drawing' in w for w in imported['warnings']))
        data=base64.b64decode(codec.export_book(book)['base64'])
        for attempt in range(2):
            wb=openpyxl.load_workbook(io.BytesIO(data)); self.assertEqual([len(w._charts) for w in wb], [2,1])
            c=wb.worksheets[0]._charts[0]
            self.assertEqual((c.type,c.grouping,c.visible_cells_only,c.display_blanks), ('col','clustered',False,'gap'))
            self.assertEqual(c.ser[0].tx.strRef.f, "'O''Brien & 雪'!C2")
            self.assertEqual(c.ser[0].cat.numRef.f, "'O''Brien & 雪'!$B$3:$B$5")
            self.assertEqual(c.ser[1].val.numRef.f, "'O''Brien & 雪'!$D$3:$D$5")
            self.assertIsNone(openpyxl.load_workbook(io.BytesIO(data),data_only=True).worksheets[0]['D3'].value)
            self.assertEqual([wb.worksheets[0][k].value for k in ['C3','C4','C5','D3']], [0,-2,None,'=C3*2'])
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                root=ET.fromstring(z.read('xl/charts/chart1.xml')); ns={'c':codec.CHART}
                self.assertEqual(len(root.findall('.//c:numCache',ns)),0)
                self.assertEqual(len(root.findall('.//c:strCache',ns)),0)
                self.assertEqual(root.find('.//c:barDir',ns).get('val'),'col')
                self.assertEqual(root.find('.//c:grouping',ns).get('val'),'clustered')
                self.assertIsNotNone(ET.fromstring(z.read('xl/workbook.xml')).find('{'+NS+'}calcPr'))
            self.assertEqual(codec.native_charts(codec.import_book(data)['book']), charts)
            out=io.BytesIO();wb.save(out);data=out.getvalue()

    def test_chart_excel_style_relative_relationships_and_caches(self):
        def change(name,raw):
            if name.endswith('.rels') and '/drawings/' in name:
                root=ET.fromstring(raw)
                for r in root: r.set('Target', '../charts/'+r.get('Target').rsplit('/',1)[-1])
                return ET.tostring(root)
            if name=='xl/drawings/drawing1.xml':
                root=ET.fromstring(raw);q=lambda n:'{'+codec.DRAW+'}'+n
                anchor=root[0];anchor.tag=q('twoCellAnchor');anchor.remove(anchor.find(q('ext')))
                to=ET.Element(q('to'))
                for key,value in [('col','14'),('colOff','0'),('row','18'),('rowOff','0')]:ET.SubElement(to,q(key)).text=value
                anchor.insert(1,to)
                ET.SubElement(anchor.find('.//'+q('cNvGraphicFramePr')),'{'+codec.ART+'}graphicFrameLocks',noGrp='1')
                return ET.tostring(root)
            if name=='xl/charts/chart1.xml':
                root=ET.fromstring(raw); q=lambda n:'{'+codec.CHART+'}'+n
                ET.SubElement(root,q('date1904'),val='0')
                ref=root.find('.//'+q('val')+'/'+q('numRef'))
                cache=ET.SubElement(ref,q('numCache'));ET.SubElement(cache,q('formatCode')).text='General';ET.SubElement(cache,q('ptCount'),val='3')
                ET.SubElement(ET.SubElement(cache,q('pt'),idx='0'),q('v')).text='999'
                return ET.tostring(root)
            return raw
        b=codec.import_book(rewrite(chart_fixture(),change))['book']
        self.assertEqual(b['sheets']['sheet1']['cellData']['2']['2']['v'],0)
        self.assertEqual(codec.native_charts(b)[0]['range']['startColumn'],1)

    def test_chart_unsupported_semantics_refused(self):
        q=lambda n:'{'+codec.CHART+'}'+n
        changes=[
            lambda r:r.find('.//'+q('barDir')).set('val','bar'),
            lambda r:r.find('.//'+q('grouping')).set('val','stacked'),
            lambda r:r.find('.//'+q('grouping')).set('val','percentStacked'),
            lambda r:r.find('.//'+q('barChart')).append(ET.Element(q('smooth'),val='1')),
            lambda r:r.find('.//'+q('plotArea')).append(ET.Element(q('lineChart'))),
            lambda r:r.find('.//'+q('plotArea')).append(ET.Element(q('bar3DChart'))),
            lambda r:r.find('.//'+q('plotArea')).append(ET.Element(q('scatterChart'))),
            lambda r:r.find('.//'+q('plotArea')).append(ET.Element(q('valAx'))),
            lambda r:r.find('.//'+q('dispBlanksAs')).set('val','zero'),
            lambda r:r.find('.//'+q('scaling')).append(ET.Element(q('logBase'),val='10')),
            lambda r:r.find('.//'+q('catAx')).append(ET.Element(q('axId'),val='999')),
            lambda r:r.find('.//'+q('barChart')+'/'+q('axId')).set('val','010'),
            lambda r:r.find('.//'+q('ser')+'/'+q('idx')).set('val','00'),
            lambda r:r.find('.//'+q('plotVisOnly')).set('val','yes'),
            lambda r:r.find('.//'+q('title')+'/'+q('tx')).append(ET.Element(q('strRef'))),
            lambda r:r.find('.//{'+codec.ART+'}p').append(ET.Element('{'+codec.ART+'}r')),
            lambda r:r.find('.//'+q('cat')).append(ET.Element(q('multiLvlStrRef'))),
        ]
        for change in changes:
            with self.subTest(change=change),self.assertRaises(ValueError):
                codec.import_book(chart_rewrite(chart_fixture(),change))
        for ref in ["'Other'!$B$3:$B$5",'Name',"'[evil.xlsx]Sheet1'!B3:B5", "'O''Brien & 雪'!B3:B5,B7", "'O''Brien & 雪'!B3:C5", "'O''Brien & 雪'!B3:B104"]:
            def change(r): r.find('.//'+q('cat')+'/'+q('numRef')+'/'+q('f')).text=ref
            with self.subTest(ref=ref),self.assertRaises(ValueError):codec.import_book(chart_rewrite(chart_fixture(),change))

    def test_chart_namespace_relationship_and_drawing_attacks(self):
        q=lambda n:'{'+codec.CHART+'}'+n
        changes=[lambda r:r.find('.//'+q('barDir')).__setattr__('tag','{urn:evil}barDir'),
                 lambda r:r.find('.//'+q('barChart')).append(ET.Element('{urn:evil}grouping',val='stacked')),
                 lambda r:r.find('.//'+q('val')+'/'+q('numRef')+'/'+q('f')).set('{urn:evil}f','Name')]
        for change in changes:
            with self.assertRaises(ValueError):codec.import_book(chart_rewrite(chart_fixture(),change))
        for target in ['https://example.invalid/chart.xml','../../../../etc/passwd','/xl/charts/%63hart1.xml','/xl/worksheets/sheet1.xml']:
            def change(n,raw):
                if n=='xl/drawings/_rels/drawing1.xml.rels':
                    root=ET.fromstring(raw);root[0].set('Target',target);return ET.tostring(root)
                return raw
            with self.subTest(target=target),self.assertRaises(ValueError):codec.import_book(rewrite(chart_fixture(),change))
        for attr,value in [('TargetMode','External'),('{urn:evil}Target','/xl/charts/chart1.xml')]:
            def change(n,raw):
                if n=='xl/drawings/_rels/drawing1.xml.rels':
                    r=ET.fromstring(raw);r[0].set(attr,value);return ET.tostring(r)
                return raw
            with self.assertRaises(ValueError):codec.import_book(rewrite(chart_fixture(),change))
        for bad in ['pic','sp','grpSp']:
            def change(n,raw):
                if n=='xl/drawings/drawing1.xml':
                    r=ET.fromstring(raw);r[0].append(ET.Element('{'+codec.DRAW+'}'+bad));return ET.tostring(r)
                return raw
            with self.assertRaises(ValueError):codec.import_book(rewrite(chart_fixture(),change))
        original_read=codec.ExcelReader.read
        def disagree(reader):
            original_read(reader);reader.wb.worksheets[0]._charts[0].ser[0].val.numRef.f="'Other'!B2:B4"
        with patch.object(codec.ExcelReader,'read',disagree):
            with self.assertRaisesRegex(ValueError,'Loaded chart semantics mismatch'):codec.import_book(chart_fixture())

    def test_chart_boundary_eight_hundred_four_and_unstacked_line(self):
        b=codec.import_book(chart_fixture())['book'];c=codec.native_charts(b)[0]
        c['range']={'startRow':1,'endRow':101,'startColumn':1,'endColumn':5}
        b['resources'][0]['data']=json.dumps([dict(c,id=f'chart-{i}',type='line' if i%2 else 'bar') for i in range(8)])
        data=base64.b64decode(codec.export_book(b)['base64']);rt=codec.import_book(data)['book']
        self.assertEqual(len(codec.native_charts(rt)),8)
        self.assertTrue(all(c['range']['endRow']==101 and c['range']['endColumn']==5 for c in codec.native_charts(rt)))
        wb=openpyxl.load_workbook(io.BytesIO(data));self.assertEqual(wb.worksheets[0]._charts[1].grouping,'standard')
        def change(n,raw):
            if n=='xl/charts/chart2.xml':
                r=ET.fromstring(raw);ET.SubElement(r.find('.//{'+codec.CHART+'}lineChart'),'{'+codec.CHART+'}smooth',val='1');return ET.tostring(r)
            return raw
        with self.assertRaises(ValueError):codec.import_book(rewrite(chart_fixture(),change))

    def test_chart_native_resource_caps_and_controls_coexist(self):
        b=codec.import_book(chart_fixture())['book'];spec=codec.native_charts(b)[0]
        controls={'sheet1':[{'uid':'check','type':'checkbox','ranges':[{'startRow':8,'endRow':9,'startColumn':0,'endColumn':0}]},
                   {'uid':'list','type':'list','formula1':'["Yes","No"]','ranges':[{'startRow':8,'endRow':9,'startColumn':1,'endColumn':1}]}]}
        b['resources'].append({'name':codec.CONTROL_RESOURCE,'data':json.dumps(controls)})
        b['sheets']['sheet1']['cellData']['8']={'0':{'v':True,'t':3},'1':{'v':'Yes','t':1}}
        rt=codec.import_book(base64.b64decode(codec.export_book(b)['base64']))['book']
        self.assertEqual(len(codec.native_charts(rt)),3)
        self.assertEqual(len(json.loads(next(r['data'] for r in rt['resources'] if r['name']==codec.CONTROL_RESOURCE))['sheet1']),2)
        for edit in [lambda c:c.update(extra={}),lambda c:c.update(id='__proto__'),lambda c:c.update(type='pie'),lambda c:c['range'].update(endRow=102),lambda c:c['range'].update(endColumn=6),lambda c:c['range'].update(startRow=True),lambda c:c.update(title='😀'*81),lambda c:c.update(sheetId='missing')]:
            c=deepcopy(spec);edit(c);bad=deepcopy(b);bad['resources'][0]['data']=json.dumps([c])
            with self.assertRaises(ValueError):codec.export_book(bad)
        for charts in [[spec,spec],[dict(spec,id=f'chart-{i}') for i in range(9)]]:
            bad=deepcopy(b);bad['resources'][0]['data']=json.dumps(charts)
            with self.assertRaises(ValueError):codec.export_book(bad)
        bad=deepcopy(b);bad['resources'].append({'name':'FOREIGN_PLUGIN','data':'{}'})
        with self.assertRaisesRegex(ValueError,'Unsupported native resource'):codec.export_book(bad)


    def test_chart_plain_multiline_title_native_export_reimport(self):
        titles=['Budget'+chr(10)+'2026', '\nBudget\n', 'Budget\n\n2026', 'None\n\nNone', '\n\n', '', '\n雪 & <Q> "quoted" 😀\n']
        self.assertIn(chr(10),titles[0]);self.assertNotIn('\\n',titles[0])
        for title in titles:
            with self.subTest(title=repr(title)):
                b=codec.import_book(chart_fixture())['book'];charts=codec.native_charts(b);charts[0]['title']=title
                b['resources'][0]['data']=json.dumps(charts)
                self.assertEqual(codec.native_charts(b)[0]['title'],title)
                # RED is export's own raw preflight: no artifact returned yet.
                data=base64.b64decode(codec.export_book(b)['base64'])
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    root=ET.fromstring(z.read('xl/charts/chart1.xml'))
                    ps=root.findall('.//{'+codec.CHART+'}title/{'+codec.CHART+'}tx/{'+codec.CHART+'}rich/{'+codec.ART+'}p')
                    if title:
                        self.assertEqual([''.join(p.itertext()) for p in ps],title.split('\n'))
                    else:self.assertEqual(ps,[])
                parsed=openpyxl.load_workbook(io.BytesIO(data)).worksheets[0]._charts[0]
                text='\n'.join(p.r[0].t or '' for p in parsed.title.tx.rich.p) if parsed.title else ''
                self.assertEqual(text,title)
                self.assertEqual(codec.native_charts(codec.import_book(data)['book'])[0]['title'],title)

    def test_chart_plain_multiline_title_independent_import(self):
        titles=['Budget'+chr(10)+'2026', '\nBudget\n', 'Budget\n\n2026', 'None\n\nNone', '\n\n', '', '\n雪 & <Q> "quoted" 😀\n']
        for title in titles:
            with self.subTest(title=repr(title)):
                # Authored directly with installed openpyxl, not codec export.
                wb=openpyxl.load_workbook(io.BytesIO(chart_fixture()));wb.worksheets[0]._charts[0].title=title
                out=io.BytesIO();wb.save(out);data=out.getvalue()
                b=codec.import_book(data)['book']
                self.assertEqual(codec.native_charts(b)[0]['title'],title)
                exported=base64.b64decode(codec.export_book(b)['base64'])
                self.assertEqual(codec.native_charts(codec.import_book(exported)['book'])[0]['title'],title)
        # A plain empty paragraph without an explicit empty run is also empty.
        def empty_paragraph(root):
            rich=root.find('.//{'+codec.CHART+'}title/{'+codec.CHART+'}tx/{'+codec.CHART+'}rich')
            rich.insert(1,ET.Element('{'+codec.ART+'}p'));ET.SubElement(rich,'{'+codec.ART+'}p')
        b=codec.import_book(chart_rewrite(chart_fixture(),empty_paragraph))['book']
        self.assertEqual(codec.native_charts(b)[0]['title'],'\n<Budget & "雪">\n')

    def test_chart_multiline_title_keeps_rich_linked_and_shadow_refusals(self):
        wb=openpyxl.load_workbook(io.BytesIO(chart_fixture()));wb.worksheets[0]._charts[0].title='Budget'+chr(10)+'2026'
        out=io.BytesIO();wb.save(out);data=out.getvalue();a=lambda n:'{'+codec.ART+'}'+n;c=lambda n:'{'+codec.CHART+'}'+n
        def rich(root):return root.find('.//'+c('title')+'/'+c('tx')+'/'+c('rich'))
        def extra_run(root):ET.SubElement(ET.SubElement(rich(root).findall(a('p'))[1],a('r')),a('t')).text='extra'
        def linked(root):
            tx=root.find('.//'+c('title')+'/'+c('tx'));tx.clear();ET.SubElement(ET.SubElement(tx,c('strRef')),c('f')).text="'O''Brien & 雪'!B2"
        def shadow(root):rich(root).findall(a('p'))[1].find(a('r')+'/'+a('t')).tag='{urn:evil}t'
        def field(root):ET.SubElement(rich(root).findall(a('p'))[1],a('fld'))
        def break_run(root):ET.SubElement(rich(root).findall(a('p'))[1],a('br'))
        def linked_run(root):ET.SubElement(ET.SubElement(rich(root).findall(a('p'))[1].find(a('r')),a('rPr')),a('hlinkClick'))
        for edit in (extra_run,linked,shadow,field,break_run,linked_run):
            with self.subTest(edit=edit.__name__),self.assertRaises(ValueError):codec.import_book(chart_rewrite(data,edit))
        def excessive(root):
            for _ in range(161):ET.SubElement(rich(root),a('p'))
        with self.assertRaises(ValueError):codec.import_book(chart_rewrite(data,excessive))


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
