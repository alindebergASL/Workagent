"""Deterministic worker primitives, no LibreOffice or unsandboxed rendering."""
import importlib.util
import copy
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
    def test_pdf_marker_seam_preserves_body_inheritance_empty_items_and_word_strictness(self):
        root = Path(__file__).resolve().parents[3]
        script = r'''
import runpy,copy,base64,io,zipfile
codec=runpy.run_path(ROOT+'/services/workagent-execution/docx/codec.py')
render=runpy.run_path(ROOT+'/services/workagent-execution/pdf/render.py')
fixture=runpy.run_path(ROOT+'/services/workagent-execution/pdf/fixtures/imported_lists.py')['contrast_native']
defaults={'bl':0,'it':0,'ul':{'s':0},'fs':11,'cl':{'rgb':'#000000'}}
def body_styles(d):
    result=[];start=0;style=d['documentStyle'];body=d['body'];raw=body['dataStream'].encode('utf-16-le')
    for p in body['paragraphs']:
        ps={**style.get('defaultParagraphStyle',{}),**p.get('paragraphStyle',{})}
        base={**defaults,**style.get('textStyle',{}),**ps.get('textStyle',{})}
        for pos in range(start,p['startIndex']):
            ts=dict(base)
            for r in body.get('textRuns',[]):
                if r['st']<=pos<r['ed']:ts.update(r['ts'])
            result.append((raw[pos*2:pos*2+2],{k:ts[k] for k in defaults}))
        start=p['startIndex']+1
    return result
for inheritance in ['document','default','paragraph','run']:
    d=fixture(inheritance);before=copy.deepcopy(d)
    try:codec['export_document'](d)
    except ValueError as e:assert 'Conflicting paragraph-mark' in str(e)
    else:raise AssertionError('Word must remain strict')
    mapped=render['export_intermediate'](d,codec)
    reopened=codec['import_document'](mapped)['document']
    assert reopened['body']['dataStream']==d['body']['dataStream']
    assert len(reopened['body']['paragraphs'])==6
    assert body_styles(reopened)==body_styles(d),inheritance
    labels=[];counts={};ids=[]
    for p in reopened['body']['paragraphs']:
        if 'bullet' not in p:continue
        b=p['bullet'];level=reopened['lists'][b['listType']]['nestingLevel'][0];ids.append(b['listId'])
        count=b['startNumber']+1 if 'startNumber' in b else counts.get(b['listId'],level['startNumber'])+1
        counts[b['listId']]=count;labels.append(count)
        actual={**defaults,**b['textStyle'],**level['textStyle']}
        expected=({'bl':1,'it':1,'ul':{'s':1},'fs':20,'cl':{'rgb':'#FF0000'}} if len(labels) in (1,2,4)
                  else {'bl':0,'it':0,'ul':{'s':0},'fs':14,'cl':{'rgb':'#008000'}})
        assert {k:actual[k] for k in defaults}==expected,(inheritance,labels,actual)
    assert labels==[5,6,7,2,3] and len(set(ids))==1 # shared abstract, explicit paragraph restart
    assert reopened['body']['paragraphs'][4]['bullet']['startNumber']==1
    assert d==before
    # Every other PDF boundary still precedes the trusted codec option.
    class Uncalled:
        def __getitem__(self,key):raise AssertionError('invalid PDF reached codec')
    for edit,code in [(lambda d:d['body']['paragraphs'][4]['bullet'].update(startNumber=32767),'unsupported_pdf_list_number'),
                      (lambda d:d['body']['paragraphs'][0]['bullet'].update(nestingLevel=1),'unsupported_document_list'),
                      (lambda d:d['documentStyle']['pageSize'].update(width=140),'unsupported_pdf_list_layout')]:
        invalid=copy.deepcopy(d);edit(invalid)
        try:render['export_intermediate'](invalid,Uncalled())
        except render['Refused'] as e:assert str(e)==code,(str(e),code)
        else:raise AssertionError('invalid PDF accepted')
# Conflict-free Word packages are identical with and without the trusted option.
source=runpy.run_path(ROOT+'/services/workagent-execution/pdf/fixtures/imported_lists.py')['source_docx']()
d=codec['import_document'](source)['document']
for lists in [True,False]:
    if not lists:
        for p in d['body']['paragraphs']:p.pop('bullet',None)
    strict=base64.b64decode(codec['export_document'](d)['base64'])
    pdf=base64.b64decode(codec['export_document'](d,_pdf_visible_markers=True)['base64'])
    def parts(data):
        with zipfile.ZipFile(io.BytesIO(data)) as z:return {n:z.read(n) for n in z.namelist()}
    assert parts(strict)==parts(pdf)
    assert parts(render['export_intermediate'](d,codec))==parts(render['map_generated_fonts'](strict,codec))
print('PDF marker/body distinction and unchanged Word semantics verified')
'''.replace('ROOT', repr(str(root)))
        result = subprocess.run([str(root/'.local/docx-python/bin/python'), '-I', '-B', '-c', script], capture_output=True, timeout=12)
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_imported_word_sequence_and_saved_conflict_have_visible_pdf_mapping(self):
        root = Path(__file__).resolve().parents[3]
        script = r'''
import runpy,base64,io,zipfile,copy,json
from pathlib import Path
from lxml import etree
codec=runpy.run_path(ROOT+'/services/workagent-execution/docx/codec.py')
render=runpy.run_path(ROOT+'/services/workagent-execution/pdf/render.py');q=codec['q']
fixtures=ROOT+'/services/workagent-execution/pdf/fixtures/'
source=runpy.run_path(fixtures+'imported_lists.py')['source_docx']();original=bytes(source)
native=codec['import_document'](source)['document'];before=copy.deepcopy(native)
assert [native['lists'][key]['nestingLevel'][0]['paragraphProperties'] for key in ['word-num-1','word-num-7','word-num-42']]==[
    {'indentStart':{'v':24.0},'hanging':{'v':24.0}},
    {'indentStart':{'v':72.0},'hanging':{'v':24.0}},
    {'indentStart':{'v':24.0},'hanging':{'v':24.0}}]
def labels(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        doc=etree.fromstring(z.read('word/document.xml'));numbering=etree.fromstring(z.read('word/numbering.xml'))
    nums={n.get(q('numId')):n for n in numbering.findall(q('num'))}
    abstracts={a.get(q('abstractNumId')):a for a in numbering.findall(q('abstractNum'))}
    counts={};result=[];origins=[];ids=[]
    for p in doc.iter(q('p')):
        np=p.find('./'+q('pPr')+'/'+q('numPr'))
        if np is None:continue
        key=np.find(q('numId')).get(q('val'));num=nums[key];ids.append(key)
        lvl=abstracts[num.find(q('abstractNumId')).get(q('val'))].find(q('lvl'))
        start=num.find('./'+q('lvlOverride')+'/'+q('startOverride'))
        if start is None:start=lvl.find(q('start'))
        counts[key]=counts.get(key,int(start.get(q('val')))-1)+1
        result.append(str(counts[key])+'.' if lvl.find(q('numFmt')).get(q('val'))=='decimal' else lvl.find(q('lvlText')).get(q('val')))
        ind=lvl.find('./'+q('pPr')+'/'+q('ind'));origins.append(int(ind.get(q('left')))-int(ind.get(q('hanging'))))
    return result,origins,ids
for restart,expected in [(False,['•','•','1.','2.','5.','6.','3.']), (True,['•','•','1.','9.','5.','6.','10.'])]:
    d=copy.deepcopy(native)
    if restart:d['body']['paragraphs'][4]['bullet']['startNumber']=8
    raw=base64.b64decode(codec['export_document'](d)['base64']);raw_copy=bytes(raw)
    mapped=render['export_intermediate'](d,codec)
    assert labels(raw)[0]==labels(mapped)[0]==expected
    assert labels(raw)[1]==labels(mapped)[1]==[0,0,720,720,0,0,720]
    assert labels(raw)[2]==labels(mapped)[2]
    assert len(set(labels(mapped)[2]))==(4 if restart else 3)
    assert codec['import_document'](mapped)['document']['body']['dataStream']==d['body']['dataStream']
    assert raw==raw_copy
assert native==before and source==original
saved=json.loads(Path(fixtures+'imported-list-saved.json').read_text());before=copy.deepcopy(saved)
render['validate_document'](saved) # Valid native/PDF geometry, NOT a unit error.
try:codec['export_document'](saved)
except ValueError as e:assert str(e)=='Conflicting paragraph-mark and mixed list-marker formatting is not mapped'
else:raise AssertionError('Word conflict was silently erased')
mapped=render['export_intermediate'](saved,codec)
assert labels(mapped)[0]==['•','•','1.','2.','5.','6.','7.','3.']
assert labels(mapped)[1]==[0,0,720,720,0,0,0,720]
assert len(set(labels(mapped)[2]))==3
assert codec['import_document'](mapped)['document']['body']['dataStream']==saved['body']['dataStream']
assert saved==before
for edit in [lambda d:d['body']['paragraphs'][1]['bullet'].update(nestingLevel=1),
             lambda d:d['body']['paragraphs'][1]['paragraphStyle'].update(direction=1),
             lambda d:d['lists']['word-num-7']['nestingLevel'][0]['paragraphProperties'].update(hanging={'v':100})]:
    d=copy.deepcopy(native);edit(d)
    try:render['export_intermediate'](d,codec)
    except render['Refused']:pass
    else:raise AssertionError('unsupported layout accepted')
print('imported and saved PDF sequences preserved; Word conflict refused without mutation')
'''.replace('ROOT', repr(str(root)))
        result = subprocess.run([str(root/'.local/docx-python/bin/python'), '-I', '-B', '-c', script], capture_output=True, timeout=12)
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_direct_python_boundary_checks_active_lists_and_all_pdf_formatting(self):
        document = {'documentStyle': {}, 'body': {'dataStream': 'text\r\n', 'paragraphs': [
            {'startIndex': 4, 'bullet': {'listType': 'ORDER_LIST', 'listId': 'list', 'nestingLevel': 0}}]}}
        self.assertEqual(render.validate_document(document), '1.')
        for symbol in render.BULLETS:
            d = copy.deepcopy(document)
            d['lists'] = {'ORDER_LIST': {'listType': 'BULLET_LIST', 'nestingLevel': [
                {'bulletAlignment': 1, 'startNumber': 0, 'glyphFormat': ' %1', 'glyphSymbol': symbol},
                {'glyphFormat': '%2.', 'glyphType': 4}]}}
            before = copy.deepcopy(d)
            self.assertEqual(render.validate_document(d), symbol)
            self.assertEqual(d, before)
        for edit in [lambda d: d['body']['paragraphs'][0]['bullet'].update(nestingLevel=9),
                     lambda d: d['body']['paragraphs'][0]['bullet'].update(startNumber=1000000),
                     lambda d: d['body']['paragraphs'][0]['bullet'].update(textStyle={'caps': True}),
                     lambda d: d['body']['paragraphs'][0]['bullet'].update(textStyle={'ul': {'s': True}}),
                     lambda d: d['body']['paragraphs'][0].update(paragraphStyle={'keepNext': 1}),
                     lambda d: d['body']['paragraphs'][0].update(paragraphStyle={'horizontalAlign': True}),
                     lambda d: d['body'].update(tables=[{}]),
                     lambda d: d['body'].update(textRuns=[{'st': 0, 'ed': 1, 'ts': {'fs': 12.3}}]),
                     lambda d: d['documentStyle'].update(defaultParagraphStyle={'textStyle': {'st': {'s': 1}}})]:
            d = copy.deepcopy(document); edit(d)
            with self.assertRaises(render.Refused):
                render.validate_document(d)
    def test_installed_fonts_and_bounded_text_coverage(self):
        coverage = render.font_charsets(time.monotonic()+5)
        for text in ['', '雪 🌍', '🌍 雪', '雪🌍雪🌍 🌍雪🌍雪', 'Latin café <script> & <w:t> 00120\t\r\n']:
            render.check_text(text, coverage)
        for text in ['العربية', 'देवनागरी', 'Ελληνικά', 'Кириллица', '日本かな', '한글', 'e\u0301', '👩\u200d💻', '🌍\ufe0f', '👍🏽', '\u202e', '\U00020000']:
            with self.subTest(text=text), self.assertRaisesRegex(render.Refused, 'unsupported_text'):
                render.check_text(text, coverage)
        with self.assertRaisesRegex(render.Refused, 'missing_glyph'):
            render.check_text('\u9fff', coverage)
        render.check_text(''.join(render.BULLETS) + '0123456789.', coverage, marker=True)
        for key in [k for k in coverage if k.startswith('latin')]:
            missing = copy.deepcopy(coverage); missing[key] = [(0x20, 0x7f)]
            with self.subTest(face=key), self.assertRaisesRegex(render.Refused, 'missing_glyph'):
                render.check_text('●', missing, marker=True)

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
            if name not in ('word/document.xml','word/styles.xml'):assert a.read(name)==b.read(name);continue
            before=etree.fromstring(a.read(name));after=etree.fromstring(b.read(name))
            for props in after.iter(q('rPr')):
                fonts=props.find(q('rFonts'));assert fonts is not None
                for key,value in {'ascii':'DejaVu Serif','hAnsi':'DejaVu Serif','eastAsia':'WenQuanYi Zen Hei'}.items():assert fonts.get(q(key))==value
                props.remove(fonts)
            for props in before.iter(q('rPr')):
                fonts=props.find(q('rFonts'))
                if fonts is not None:props.remove(fonts)
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

    def test_nested_shared_counter_gutters_are_per_level_and_numbering_is_unchanged(self):
        root = Path(__file__).resolve().parents[3]
        script = r"""
import runpy,io,zipfile,base64,copy
from lxml import etree
c=runpy.run_path(ROOT+'/services/workagent-execution/docx/codec.py')
r=runpy.run_path(ROOT+'/services/workagent-execution/pdf/render.py')
f=runpy.run_path(ROOT+'/services/workagent-execution/docx/test_codec.py')
source=f['nested_fixture']();d=c['import_document'](source)['document'];before=copy.deepcopy(d);labels=[]
r['validate_document'](d,labels)
assert labels==['3.','b.','3.b.i.','c.','4.','e.','5.','b.','5.b.i.'],labels
raw=base64.b64decode(c['export_document'](d)['base64']);mapped=r['export_intermediate'](d,c);q=c['q']
with zipfile.ZipFile(io.BytesIO(raw)) as a,zipfile.ZipFile(io.BytesIO(mapped)) as b:
 old=etree.fromstring(a.read('word/numbering.xml'));new=etree.fromstring(b.read('word/numbering.xml'))
 assert [etree.tostring(n) for n in old.findall(q('num'))]==[etree.tostring(n) for n in new.findall(q('num'))]
 active=new.findall(q('abstractNum'))[-1];widths=[]
 for depth,lvl in enumerate(active.findall(q('lvl'))):
  ind=lvl.find('./'+q('pPr')+'/'+q('ind'));left=int(ind.get(q('left')));hanging=int(ind.get(q('hanging')))
  assert left-hanging==315*depth
  label_width=max(len(label) for label,p in zip(labels,[p for p in d['body']['paragraphs'] if 'bullet' in p]) if p['bullet']['nestingLevel']==depth)
  assert hanging>=(label_width*11+11+6)*20
  widths.append(hanging)
 assert widths[2]>widths[1]==widths[0],widths
 for x,y in zip(old.iter(q('lvlText')),new.iter(q('lvlText'))):assert etree.tostring(x)==etree.tostring(y)
assert d==before
print('nested labels and separate gutters verified; not rendering proof')
""".replace('ROOT', repr(str(root)))
        result = subprocess.run([str(root/'.local/docx-python/bin/python'), '-I', '-B', '-c', script], capture_output=True, timeout=12)
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_limits_in_real_child(self):
        script = f"import runpy,resource,json;m=runpy.run_path({str(Path(__file__).with_name('render.py').resolve())!r});m['limits']();print(json.dumps([resource.getrlimit(k) for k in (resource.RLIMIT_AS,resource.RLIMIT_CPU,resource.RLIMIT_FSIZE,resource.RLIMIT_NOFILE)]))"
        result = subprocess.run(['/usr/bin/python3', '-I', '-c', script], capture_output=True, check=True, timeout=3)
        self.assertEqual(json.loads(result.stdout), [[2*1024**3]*2, [15]*2, [24*1024**2]*2, [128]*2])

    def test_real_docx_mapping_preserves_effective_list_styles_stock_definitions_and_sequences(self):
        root = Path(__file__).resolve().parents[3]
        script = r'''
import runpy,base64,io,zipfile,copy,json
from lxml import etree
codec=runpy.run_path(ROOT+'/services/workagent-execution/docx/codec.py')
render=runpy.run_path(ROOT+'/services/workagent-execution/pdf/render.py');q=codec['q']
lines=['First 雪🌍','Second 🌍雪','Plain','Continue','Restart','Large','Next']+['Bullet'+str(i) for i in range(5)]
stream='\r'.join(lines)+'\r\n';offset=0;paragraphs=[]
for line in lines:
    end=offset+len(line.encode('utf-16-le'))//2;paragraphs.append({'startIndex':end});offset=end+1
native={'id':'test','title':'Lists','documentStyle':{'pageSize':{'width':794,'height':1123},'marginLeft':72,'marginRight':72},
        'body':{'dataStream':stream,'paragraphs':paragraphs,'textRuns':[{'st':0,'ed':5,'ts':{'bl':1,'it':1,'ul':{'s':1},'fs':17.5}}]},'lists':{}}
for i in [0,1,3,4,5,6]:paragraphs[i]['bullet']={'listId':'alpha' if i<5 else 'large','listType':'ORDER_LIST','nestingLevel':0}
paragraphs[1]['paragraphStyle']={'textStyle':{'fs':12,'it':1}}
paragraphs[4]['bullet']['startNumber']=8;paragraphs[5]['bullet']['startNumber']=998
for i,glyph in enumerate(render['BULLETS']):
    key='bullet'+str(i);paragraphs[7+i]['bullet']={'listId':key,'listType':key,'nestingLevel':0}
    native['lists'][key]={'listType':'BULLET_LIST','nestingLevel':[{'bulletAlignment':1,'startNumber':0,'glyphFormat':' %1','glyphSymbol':glyph,'textStyle':{'fs':12,'bl':1,'it':1,'ul':{'s':1}}}]}
before=copy.deepcopy(native);render['validate_document'](native)
raw=base64.b64decode(codec['export_document'](native)['base64']);mapped=render['map_generated_fonts'](raw,codec);assert native==before
a=zipfile.ZipFile(io.BytesIO(raw));b=zipfile.ZipFile(io.BytesIO(mapped));an=etree.fromstring(a.read('word/numbering.xml'));bn=etree.fromstring(b.read('word/numbering.xml'))
ad=etree.fromstring(a.read('word/document.xml'));bd=etree.fromstring(b.read('word/document.xml'))
# Marker and text styling, numId/restart references and literal UTF-16 text
# remain byte-for-byte XML equivalent after removing only PDF font mappings.
for tree in [ad,bd]:
    for fonts in list(tree.iter(q('rFonts'))):fonts.getparent().remove(fonts)
assert etree.tostring(ad,method='c14n')==etree.tostring(bd,method='c14n')
nums={e.get(q('numId')):e for e in an.findall(q('num'))}
active={nums[e.get(q('val'))].find(q('abstractNumId')).get(q('val')) for e in ad.iter(q('numId'))}
for old,new in zip(an,bn):
    if old.tag!=q('abstractNum') or old.get(q('abstractNumId')) not in active:assert etree.tostring(old)==etree.tostring(new)
    else:
        level=new.find(q('lvl'));ind=level.find('./'+q('pPr')+'/'+q('ind'));tab=level.find('./'+q('pPr')+'/'+q('tabs')+'/'+q('tab'))
        assert int(ind.get(q('left')))>=int(ind.get(q('hanging')))>0 and tab.get(q('pos'))==ind.get(q('left'))
        for prop in ['start','numFmt','lvlText','lvlJc','suff']:assert etree.tostring(old.find(q('lvl')).find(q(prop)))==etree.tostring(level.find(q(prop)))
        for tag in ['b','i','u','sz','color']:
            x=old.find('./'+q('lvl')+'/'+q('rPr')+'/'+q(tag));y=level.find('./'+q('rPr')+'/'+q(tag))
            assert (etree.tostring(x) if x is not None else None)==(etree.tostring(y) if y is not None else None)
        for fonts in new.iter(q('rFonts')):assert fonts.get(q('eastAsia'))=='WenQuanYi Zen Hei' and fonts.get(q('ascii'))=='DejaVu Serif'
for name in a.namelist():
    if name not in ['word/document.xml','word/numbering.xml','word/styles.xml']:assert a.read(name)==b.read(name)
# Independent Word export remains unmodified and all sequence markers stay XML,
# never inserted into native body text. Reimport exercises the actual codec.
check=codec['import_document'](mapped)['document'];assert check['body']['dataStream']==stream
assert codec['import_document'](raw)['document']['body']['dataStream']==stream
print('preserved list styles and numbering')
'''.replace('ROOT', repr(str(root)))
        result = subprocess.run([str(root/'.local/docx-python/bin/python'), '-I', '-B', '-c', script], capture_output=True, timeout=12)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b'preserved list styles', result.stdout)

    def test_independent_effective_number_bound_and_continuations(self):
        for value in [1, 32767, 32768, 65534, 65535, 65536, 65537, 999999, 1000000]:
            for template in [False, True]:
                d = {'documentStyle': {}, 'body': {'dataStream': 'A\r\n', 'paragraphs': [
                    {'startIndex': 1, 'bullet': {'listId': 'a', 'listType': 'ORDER_LIST', 'nestingLevel': 0}}]}}
                if template:
                    d['lists'] = {'ORDER_LIST': {'listType': 'ORDER_LIST', 'nestingLevel': [
                        {'bulletAlignment': 1, 'startNumber': value-1, 'glyphFormat': '%1.', 'glyphType': 2}]}}
                else:
                    d['body']['paragraphs'][0]['bullet']['startNumber'] = value-1
                with self.subTest(value=value, template=template):
                    if value <= 32767:
                        render.validate_document(d)
                    else:
                        with self.assertRaisesRegex(render.Refused, '^unsupported_pdf_list_number$'):
                            render.validate_document(d)
                # An effective override wins over the template's unused start.
                d['body']['paragraphs'][0]['bullet']['startNumber'] = 32766
                render.validate_document(d)
                d['body']['dataStream'] = 'A\rPlain\rB\r\n'
                d['body']['paragraphs'] += [{'startIndex': 7}, {'startIndex': 9,
                    'paragraphStyle': {'textStyle': {'fs': 17.5, 'it': 1}},
                    'bullet': {'listId': 'a', 'listType': 'ORDER_LIST', 'nestingLevel': 0}}]
                with self.assertRaisesRegex(render.Refused, '^unsupported_pdf_list_number$'):
                    render.validate_document(d)
                d['body']['paragraphs'][-1]['bullet']['startNumber'] = 0
                render.validate_document(d)

    def test_pdf_gutter_accounts_for_body_overhang_in_generated_ooxml(self):
        root = Path(__file__).resolve().parents[3]
        script = r'''
import runpy,base64,io,zipfile,copy
from lxml import etree
codec=runpy.run_path(ROOT+'/services/workagent-execution/docx/codec.py')
render=runpy.run_path(ROOT+'/services/workagent-execution/pdf/render.py');q=codec['q']
for inheritance in ['document','default','paragraph','run','wrapped']:
    text='A' if inheritance!='wrapped' else 'small A A A A A A'
    d={'id':'doc','title':'Overhang','documentStyle':{},'body':{'dataStream':text+'\r\n','paragraphs':[{'startIndex':len(text),'bullet':{'listId':'a','listType':'BULLET_LIST','nestingLevel':0,'textStyle':{'fs':11,'it':0}}}]}}
    style={'fs':200,'it':1}
    if inheritance=='document':d['documentStyle']['textStyle']=style
    elif inheritance=='default':d['documentStyle']['defaultParagraphStyle']={'textStyle':style}
    elif inheritance=='paragraph':d['body']['paragraphs'][0]['paragraphStyle']={'textStyle':style}
    else:d['body']['textRuns']=[{'st':6 if inheritance=='wrapped' else 0,'ed':len(text),'ts':style}]
    before=copy.deepcopy(d);render['validate_document'](d)
    raw=base64.b64decode(codec['export_document'](d)['base64']);mapped=render['map_generated_fonts'](raw,codec)
    assert d==before
    with zipfile.ZipFile(io.BytesIO(mapped)) as z:
        doc=etree.fromstring(z.read('word/document.xml'));numbering=etree.fromstring(z.read('word/numbering.xml'))
        num_id=doc.find('.//'+q('numId')).get(q('val'))
        num=next(n for n in numbering.findall(q('num')) if n.get(q('numId'))==num_id)
        abstract_id=num.find(q('abstractNumId')).get(q('val'))
        abstract=next(a for a in numbering.findall(q('abstractNum')) if a.get(q('abstractNumId'))==abstract_id)
        ind=abstract.find('.//'+q('ind'))
        assert int(ind.get(q('hanging'))) >= (11+200+6)*20,(inheritance,etree.tostring(ind))
        assert ''.join(e.text or '' for e in doc.iter(q('t')))==text # no fake marker runs
    assert codec['import_document'](raw)['document']['body']['dataStream']==text+'\r\n'
    narrow=copy.deepcopy(d);narrow['documentStyle']['pageSize']={'width':300,'height':1123}
    try:render['validate_document'](narrow)
    except render['Refused'] as e:assert str(e)=='unsupported_pdf_list_layout'
    else:raise AssertionError('unsafe narrow body gutter accepted')
for start,continued in [(32768,False),(999999,False),(1000000,False),(32767,True)]:
    d={'id':'doc','title':'Numbers','documentStyle':{},'body':{'dataStream':'A\rB\r\n' if continued else 'A\r\n','paragraphs':[{'startIndex':1,'bullet':{'listId':'a','listType':'ORDER_LIST','nestingLevel':0,'startNumber':start-1}}]}}
    if continued:d['body']['paragraphs'].append({'startIndex':3,'paragraphStyle':{'textStyle':{'it':1}},'bullet':{'listId':'a','listType':'ORDER_LIST','nestingLevel':0}})
    raw=base64.b64decode(codec['export_document'](d)['base64'])
    try:render['map_generated_fonts'](raw,codec)
    except render['Refused'] as e:assert str(e)=='unsupported_pdf_list_number'
    else:raise AssertionError('PDF mapper accepted unsupported effective number')
print('body gutters preserved')
'''.replace('ROOT', repr(str(root)))
        # Each codec process has its unchanged eight-second CPU budget. Exercise
        # these independent requests separately, as the production worker does.
        cases = [([name], []) for name in ['document', 'default', 'paragraph', 'run', 'wrapped']]
        cases += [([], [pair]) for pair in [(32768, False), (999999, False), (1000000, False), (32767, True)]]
        for inheritances, boundaries in cases:
            with self.subTest(inheritances=inheritances, boundaries=boundaries):
                single = script.replace("['document','default','paragraph','run','wrapped']", repr(inheritances))
                single = single.replace('[(32768,False),(999999,False),(1000000,False),(32767,True)]', repr(boundaries))
                result = subprocess.run([str(root/'.local/docx-python/bin/python'), '-I', '-B', '-c', single], capture_output=True, timeout=12)
                self.assertEqual(result.returncode, 0, result.stderr.decode())

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
