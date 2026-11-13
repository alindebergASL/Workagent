"""Trusted generated fixture tests; not namespace or live Word qualification."""
import sys
sys.dont_write_bytecode=True
import importlib.util, io, json, struct, unittest, zipfile, zlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('codec',Path(__file__).with_name('codec.py'))
c=importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement

def fixture():
 d=Document(); normal=d.styles['Normal']; normal.font.bold=True; normal.font.size=Pt(13)
 child=d.styles.add_style('Inherited',WD_STYLE_TYPE.PARAGRAPH); child.base_style=normal; child.font.italic=True
 p=d.add_paragraph(style=child); p.alignment=2
 r=p.add_run('  雪 🌍 <w:t>& literal  '); r.underline=True; r.font.color.rgb=RGBColor.from_string('123456')
 p.add_run(' plain').bold=False
 d.add_paragraph(''); d.add_paragraph('Tail\tspaces  ')
 d.sections[0].page_width=Inches(8); d.sections[0].left_margin=Inches(.5)
 out=io.BytesIO(); d.save(out); return out.getvalue()
def rewrite(data,change,extra=None):
 out=io.BytesIO()
 with zipfile.ZipFile(io.BytesIO(data)) as src,zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as dst:
  for i in src.infolist():
   name,raw=change(i.filename,src.read(i.filename)); dst.writestr(name,raw)
  for n,b in (extra or {}).items(): dst.writestr(n,b)
 return out.getvalue()
def replace_main(data,old,new):
 return rewrite(data,lambda n,b:(n,b.replace(old,new) if n=='word/document.xml' else b))
def default_fixture(which, flag, hidden=False, inherited=False):
 d=Document(); style=d.styles['Normal' if which=='paragraph' else 'Default Paragraph Font']
 if flag is None: style.element.attrib.pop(c.q('default'),None)
 else: style.element.set(c.q('default'),flag)
 target=style
 if inherited:
  target=d.styles.add_style('Default base',WD_STYLE_TYPE.PARAGRAPH if which=='paragraph' else WD_STYLE_TYPE.CHARACTER)
  style.base_style=target
 target.font.hidden=hidden; target.font.bold=True; target.font.italic=True
 target.font.underline=True; target.font.size=Pt(17); target.font.color.rgb=RGBColor.from_string('224466')
 if which=='paragraph': target.paragraph_format.alignment=1
 d.add_paragraph('HIDDEN HUMAN CONTENT' if hidden else 'Visible inherited style')
 out=io.BytesIO(); d.save(out); return out.getvalue()
def local_record():
 name=b'unindexed.xml'; payload=b'<payload/>'
 return struct.pack('<4s5H3I2H',b'PK\x03\x04',20,0,0,0,0,zlib.crc32(payload),len(payload),len(payload),len(name),0)+name+payload
def numbered_fixture():
 d=Document()
 for text,num in [('雪 🌍 first',7),('second',7),('plain',0),('restart at 5',42),('next',42),('continue old',7)]:
  p=d.add_paragraph(style='List Number'); p.add_run(text).bold=True
  np=p._p.get_or_add_pPr().get_or_add_numPr(); np.get_or_add_numId().val=num
 numbering=d.part.numbering_part.element
 num=OxmlElement('w:num'); num.set(c.q('numId'),'42')
 for tag,value in [('abstractNumId','7')]:
  e=OxmlElement('w:'+tag); e.set(c.q('val'),value); num.append(e)
 override=OxmlElement('w:lvlOverride'); override.set(c.q('ilvl'),'0')
 start=OxmlElement('w:startOverride'); start.set(c.q('val'),'5'); override.append(start); num.append(override); numbering.append(num)
 out=io.BytesIO(); d.save(out); return out.getvalue()
def markers(native):
 counts={}; result=[]
 for p in native['body']['paragraphs']:
  b=p.get('bullet')
  if not b: result.append(None); continue
  level=native['lists'][b['listType']]['nestingLevel'][0]
  counts[b['listId']]=b['startNumber']+1 if 'startNumber' in b else counts.get(b['listId'],level['startNumber'])+1
  result.append(level.get('glyphSymbol') or str(counts[b['listId']])+'.')
 return result
class CodecTests(unittest.TestCase):
 def test_missing_start_effective_override_and_invalid_values(self):
  data=numbered_fixture()
  def change(start,override=None,only_override=False):
   value=rewrite(data,lambda n,b:(n,b.replace(b'<w:start w:val="1"/>',start) if n=='word/numbering.xml' else b))
   if override is not None: value=rewrite(value,lambda n,b:(n,b.replace(b'<w:startOverride w:val="5"/>',override) if n=='word/numbering.xml' else b))
   if only_override: value=replace_main(value,b'<w:numId w:val="7"/>',b'<w:numId w:val="42"/>')
   return value
  for start in (b'',b'<w:start w:val="0"/>'):
   with self.subTest(start=start),self.assertRaisesRegex(ValueError,'positive'): c.import_document(change(start))
   valid=c.import_document(change(start,only_override=True))['document']
   self.assertEqual(markers(valid),['5.','6.',None,'7.','8.','9.'])
   self.assertEqual(markers(c.import_document(__import__('base64').b64decode(c.export_document(valid)['base64']))['document']),markers(valid))
   with self.assertRaisesRegex(ValueError,'positive'): c.import_document(change(start,b'<w:startOverride w:val="0"/>',True))
  for bad in (b'<w:start/>',b'<w:start w:val=""/>',b'<w:start w:val="true"/>',b'<w:start w:val="1.5"/>',b'<w:start w:val="-1"/>'):
   for override in (False,True):
    with self.subTest(bad=bad,override=override),self.assertRaises(ValueError): c.import_document(change(bad,only_override=override))
  with self.assertRaisesRegex(ValueError,'positive'): c.import_document(change(b'<w:start w:val="1"/>',b'<w:startOverride w:val="0"/>',True))
  unused=rewrite(data,lambda n,b:(n,b.replace(b'<w:start w:val="1"/>',b'<w:start/>',1) if n=='word/numbering.xml' else b))
  self.assertEqual(markers(c.import_document(unused)['document']),['1.','2.',None,'5.','6.','3.'])
  # Unused malformed starts and explicit numId=0 are not active semantics.
  plain=replace_main(change(b'<w:start/>'),b'<w:numId w:val="7"/>',b'<w:numId w:val="0"/>')
  plain=replace_main(plain,b'<w:numId w:val="42"/>',b'<w:numId w:val="0"/>')
  self.assertTrue(all(p.get('bullet') is None for p in c.import_document(plain)['document']['body']['paragraphs']))
 def test_effective_native_marker_style_is_encoded_in_numbering_rpr(self):
  d=Document();d.add_paragraph('First');out=io.BytesIO();d.save(out)
  native=c.import_document(out.getvalue())['document']
  native['body']['paragraphs'][0]['bullet']={'listId':'one','listType':'ORDER_LIST','nestingLevel':0}
  native['body']['textRuns'][0]['ts']={'bl':1,'it':1,'ul':{'s':1},'fs':24,'cl':{'rgb':'#FF0000'}}
  before=json.dumps(native);out=__import__('base64').b64decode(c.export_document(native)['base64'])
  with zipfile.ZipFile(io.BytesIO(out)) as z:
   root=c.xml(z.read('word/numbering.xml'));rp=root.findall(c.q('abstractNum'))[-1].find(c.q('lvl')+'/'+c.q('rPr'))
   for tag,value in [('b',None),('i',None),('u','single'),('sz','48'),('color','FF0000')]:
    self.assertIsNotNone(rp.find(c.q(tag)));self.assertEqual(c.val(rp.find(c.q(tag))),value)
  self.assertEqual(json.dumps(native),before)
 def test_conflicting_mixed_marker_and_explicit_mark_style_refuses_without_mutation(self):
  d=Document();d.add_paragraph('First');d.add_paragraph('Second');out=io.BytesIO();d.save(out)
  native=c.import_document(out.getvalue())['document']
  for p in native['body']['paragraphs']: p['bullet']={'listId':'one','listType':'ORDER_LIST','nestingLevel':0}
  native['body']['textRuns'][0]['ts']['bl']=1
  native['body']['paragraphs'][0]['paragraphStyle']['paragraphMarkTextStyle']={'bl':0}
  before=json.dumps(native)
  with self.assertRaisesRegex(ValueError,'Conflicting paragraph-mark'):c.export_document(native)
  self.assertEqual(json.dumps(native),before)
 def test_separate_num_ids_start_override_continuation_and_native_restart(self):
  data=numbered_fixture(); native=c.import_document(data)['document']
  self.assertEqual(markers(native),['1.','2.',None,'5.','6.','3.'])
  before=json.dumps(native); exported=__import__('base64').b64decode(c.export_document(native)['base64']); again=c.import_document(exported)['document']
  self.assertEqual(markers(again),markers(native)); self.assertEqual(again['body']['textRuns'],native['body']['textRuns']); self.assertEqual(json.dumps(native),before)
  native['body']['paragraphs'][1]['bullet']['startNumber']=8
  again=c.import_document(__import__('base64').b64decode(c.export_document(native)['base64']))['document']
  self.assertEqual(markers(again),['1.','9.',None,'5.','6.','10.'])
 def test_numpr_direct_precedence_style_level_binding_and_unused_templates(self):
  data=numbered_fixture()
  # In a paragraph style, ilvl is ignored; active abstract level pStyle wins.
  changed=rewrite(data,lambda n,b:(n,b.replace(b'<w:numId w:val="5"/>',b'<w:ilvl w:val="8"/><w:numId w:val="5"/>') if n=='word/styles.xml' else b))
  self.assertEqual(markers(c.import_document(changed)['document']),['1.','2.',None,'5.','6.','3.'])
  # Direct paragraph level overrides the style and is refused before adoption.
  changed=replace_main(data,b'<w:numId w:val="7"/>',b'<w:ilvl w:val="1"/><w:numId w:val="7"/>')
  with self.assertRaisesRegex(ValueError,'Nested'): c.import_document(changed)
  # Unsupported unused level definitions do not make a flat active list fail.
  changed=rewrite(data,lambda n,b:(n,b.replace(b'</w:abstractNum>',b'<w:lvl w:ilvl="8"><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%9)"/></w:lvl></w:abstractNum>') if n=='word/numbering.xml' else b))
  self.assertEqual(markers(c.import_document(changed)['document']),['1.','2.',None,'5.','6.','3.'])
 def test_unsupported_or_malicious_active_numbering_refuses(self):
  data=numbered_fixture()
  cases=[
   (b'<w:startOverride w:val="5"/>',b'<w:startOverride w:val="true"/>'),
   (b'<w:startOverride w:val="5"/>',b'<w:startOverride w:val="-1"/>'),
   (b'<w:startOverride w:val="5"/>',b'<w:startOverride w:val="1000001"/>'),
   (b'<w:startOverride w:val="5"/>',b'<w:startOverride w:val="5"/><w:startOverride w:val="6"/>'),
   (b'<w:startOverride w:val="5"/>',b'<w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>'),
   (b'<w:numFmt w:val="decimal"/>',b'<w:numFmt w:val="lowerRoman"/>'),
   (b'<w:lvlText w:val="%1."/>',b'<w:lvlText w:val="%1)"/>'),
   (b'<w:lvlText w:val="%1."/>',b'<w:lvlText w:val="%1."/><w:lvlRestart w:val="1"/>'),
   (b'<w:lvlText w:val="%1."/>',b'<w:lvlText w:val="%1."/><w:isLgl/>'),
   (b'<w:num w:numId="7">',b'<w:num w:numId="true">'),
   (b'<w:num w:numId="7">',b'<w:num w:numId="42">'),
   (b'<w:abstractNum w:abstractNumId="7">',b'<w:abstractNum w:abstractNumId="6">'),
   (b'<w:abstractNumId w:val="7"/>',b'<w:abstractNumId w:val="999"/>'),
   (b'<w:abstractNumId w:val="7"/>',b'<w:abstractNumId w:val="7"/><w:abstractNumId w:val="7"/>'),
  ]
  for old,new in cases:
   with self.subTest(new=new),self.assertRaises(ValueError): c.import_document(rewrite(data,lambda n,b:(n,b.replace(old,new) if n=='word/numbering.xml' else b)))
 def test_hidden_marker_onoff_aliases_are_strict(self):
  data=numbered_fixture()
  for flag in ('1','true','on','yes','TRUE'):
   changed=rewrite(data,lambda n,b:(n,b.replace(b'<w:lvlText w:val="%1."/>',b'<w:lvlText w:val="%1."/><w:rPr><w:vanish w:val="'+flag.encode()+b'"/></w:rPr>') if n=='word/numbering.xml' else b))
   with self.subTest(flag=flag),self.assertRaisesRegex(ValueError,'Hidden|OnOff'): c.import_document(changed)
 def test_flat_lists_style_inheritance_unicode_runs_and_roundtrip(self):
  d=Document(); d.add_paragraph('Intro')
  p=d.add_paragraph(style='List Bullet'); p.add_run('雪 🌍 bullet').bold=True
  d.add_paragraph('First',style='List Number'); d.add_paragraph('Second',style='List Number')
  d.add_paragraph('Gap'); d.add_paragraph('Continued',style='List Number')
  child=d.styles.add_style('List child',WD_STYLE_TYPE.PARAGRAPH); child.base_style=d.styles['List Number']
  d.add_paragraph('Inherited',style=child)
  out=io.BytesIO(); d.save(out); data=out.getvalue()
  native=c.import_document(data)['document']; p=native['body']['paragraphs']
  self.assertNotIn('bullet',p[0]); self.assertNotIn('bullet',p[4]); self.assertEqual(p[2]['bullet']['listId'],p[6]['bullet']['listId'])
  self.assertEqual(native['body']['textRuns'][1]['ts']['bl'],1)
  exported=__import__('base64').b64decode(c.export_document(native)['base64'])
  with zipfile.ZipFile(io.BytesIO(exported)) as z:
   self.assertIn(b'<w:numPr>',z.read('word/document.xml')); self.assertIn(b'<w:numFmt w:val="decimal"',z.read('word/numbering.xml'))
  again=c.import_document(exported)['document']
  self.assertEqual(again['body']['dataStream'],native['body']['dataStream']); self.assertEqual(again['body']['textRuns'],native['body']['textRuns'])
  self.assertEqual(again['body']['paragraphs'][2]['bullet']['listId'],again['body']['paragraphs'][6]['bullet']['listId'])
 def test_list_missing_references_and_active_override_refused(self):
  d=Document(); d.add_paragraph('Number',style='List Number'); out=io.BytesIO(); d.save(out)
  for old,new in [(b'w:numId="5"',b'w:numId="999"'),(b'<w:abstractNumId w:val="7"/>',b'<w:abstractNumId w:val="999"/>')]:
   data=rewrite(out.getvalue(),lambda n,b:(n,b.replace(old,new) if n=='word/numbering.xml' else b))
   with self.subTest(old=old),self.assertRaises(ValueError): c.import_document(data)
 def test_default_styles_hidden_onoff_and_inheritance(self):
  for which in ('paragraph','character'):
   for flag in ('1','true','on'):
    for inherited in (False,True):
     with self.subTest(which=which,flag=flag,inherited=inherited):
      data=default_fixture(which,flag,hidden=True,inherited=inherited)
      reopened=Document(io.BytesIO(data)); style=reopened.styles['Default base' if inherited else ('Normal' if which=='paragraph' else 'Default Paragraph Font')]
      self.assertIs(style.font.hidden,True)
      with self.assertRaisesRegex(ValueError,'Hidden content refused'): c.import_document(data)
 def test_default_styles_visible_supported_formatting_onoff(self):
  for which in ('paragraph','character'):
   for flag in ('1','true','on'):
    with self.subTest(which=which,flag=flag):
     data=default_fixture(which,flag,inherited=True)
     reopened=Document(io.BytesIO(data)); self.assertEqual(reopened.styles['Default base'].font.size.pt,17)
     b=c.import_document(data)['document']['body']
     self.assertEqual(b['textRuns'][0]['ts'],{'bl':1,'it':1,'ul':{'s':1},'fs':17,'cl':{'rgb':'#224466'}})
     if which=='paragraph': self.assertEqual(b['paragraphs'][0]['paragraphStyle']['horizontalAlign'],2)
 def test_default_styles_disabled_and_absent_are_not_enabled(self):
  for which in ('paragraph','character'):
   for flag in ('0','false','off',None):
    with self.subTest(which=which,flag=flag):
     b=c.import_document(default_fixture(which,flag,hidden=True))['document']['body']
     self.assertEqual(b['dataStream'],'HIDDEN HUMAN CONTENT\r\n')
     self.assertEqual(b['textRuns'][0]['ts']['bl'],0)
     self.assertNotEqual(b['textRuns'][0]['ts'].get('fs'),17)
 def test_default_styles_invalid_boolean_refused(self):
  for which in ('paragraph','character'):
   for flag in ('yes','TRUE',''):
    with self.subTest(which=which,flag=flag),self.assertRaisesRegex(ValueError,'Invalid.*[Oo]n[Oo]ff'):
     c.import_document(default_fixture(which,flag))
 def test_duplicate_enabled_paragraph_and_character_defaults_refused(self):
  for which in ('paragraph','character'):
   for flag in ('1','true','on'):
    with self.subTest(which=which,flag=flag):
     d=Document(io.BytesIO(default_fixture(which,'1')))
     extra=d.styles.add_style('Other default',WD_STYLE_TYPE.PARAGRAPH if which=='paragraph' else WD_STYLE_TYPE.CHARACTER)
     extra.element.set(c.q('default'),flag); out=io.BytesIO(); d.save(out)
     with self.assertRaisesRegex(ValueError,'Ambiguous default'): c.import_document(out.getvalue())
 def test_style_boolean_absence_toggle_and_direct_override(self):
  for flag,expected in [(None,1),('1',0),('true',0),('on',0),('0',1),('false',1),('off',1)]:
   with self.subTest(flag=flag):
    d=Document(io.BytesIO(default_fixture('paragraph','true')))
    child=d.styles.add_style('Child',WD_STYLE_TYPE.PARAGRAPH); child.base_style=d.styles['Normal']
    if flag is not None:
     e=OxmlElement('w:b'); e.set(c.q('val'),flag); child.element.get_or_add_rPr().append(e)
    p=d.paragraphs[0]; p.style=child; p.add_run(' direct off').bold=False
    out=io.BytesIO(); d.save(out); runs=c.import_document(out.getvalue())['document']['body']['textRuns']
    self.assertEqual(runs[0]['ts']['bl'],expected); self.assertEqual(runs[1]['ts']['bl'],0)
 def test_zip_leading_complete_unindexed_record_refused(self):
  source=fixture(); prefix=local_record()
  # Python zipfile silently relocates offsets for a prepended archive.
  with self.assertRaisesRegex(ValueError,'ZIP'): c.import_document(prefix+source)
  # Even internally consistent relocated offsets must not hide a first record.
  raw=bytearray(prefix+source); end=raw.rfind(b'PK\x05\x06')
  with zipfile.ZipFile(io.BytesIO(source)) as z:
   position=z.start_dir+len(prefix)
   for entry in z.infolist():
    struct.pack_into('<I',raw,position+42,entry.header_offset+len(prefix))
    n,e,k=struct.unpack_from('<HHH',raw,position+28); position+=46+n+e+k
   struct.pack_into('<I',raw,end+16,z.start_dir+len(prefix))
  with self.assertRaisesRegex(ValueError,'ZIP unexplained leading record'): c.import_document(raw)
 def test_zip_trailing_unindexed_record_and_eocd_bytes_refused(self):
  for suffix in (local_record(),b'unexplained trailing bytes'):
   with self.subTest(suffix=suffix[:4]),self.assertRaisesRegex(ValueError,'ZIP'): c.import_document(fixture()+suffix)
 def test_zip_local_and_central_gaps_refused(self):
  source=fixture(); end=source.rfind(b'PK\x05\x06')
  with zipfile.ZipFile(io.BytesIO(source)) as z: central=z.start_dir
  for at in (central,end):
   with self.subTest(at=at):
    gap=local_record(); raw=bytearray(source[:at]+gap+source[at:])
    if at==central: struct.pack_into('<I',raw,end+len(gap)+16,central+len(gap))
    with self.assertRaises((ValueError,zipfile.BadZipFile)): c.import_document(raw)
 def test_zip_eocd_counts_offsets_sizes_and_disks_refused(self):
  source=fixture(); end=source.rfind(b'PK\x05\x06')
  for field,fmt,delta in [(8,'H',1),(10,'H',-1),(12,'I',1),(16,'I',1),(4,'H',1),(6,'H',1)]:
   with self.subTest(field=field):
    raw=bytearray(source); value=struct.unpack_from('<'+fmt,raw,end+field)[0]
    struct.pack_into('<'+fmt,raw,end+field,value+delta)
    with self.assertRaises((ValueError,zipfile.BadZipFile)): c.import_document(raw)
  raw=bytearray(source); count=struct.unpack_from('<H',raw,end+10)[0]
  struct.pack_into('<HH',raw,end+8,count-1,count-1)
  with self.assertRaisesRegex(ValueError,'ZIP disk/count mismatch'): c.import_document(raw)
 def test_zip_member_disk_and_zip64_refused(self):
  source=fixture()
  with zipfile.ZipFile(io.BytesIO(source)) as z: central=z.start_dir
  raw=bytearray(source); struct.pack_into('<H',raw,central+34,1)
  with self.assertRaisesRegex(ValueError,'ZIP'): c.import_document(raw)
  out=io.BytesIO()
  with zipfile.ZipFile(io.BytesIO(source)) as src,zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as dst:
   for name in src.namelist():
    with dst.open(name,'w',force_zip64=True) as entry: entry.write(src.read(name))
  with self.assertRaisesRegex(ValueError,'ZIP'): c.import_document(out.getvalue())
 def test_zip_standard_comment_and_data_descriptors_preserved(self):
  class Streaming(io.BytesIO):
   def seek(self,*args): raise io.UnsupportedOperation('nonseekable fixture')
  for stream in (io.BytesIO(),Streaming()):
   with zipfile.ZipFile(io.BytesIO(fixture())) as src,zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as dst:
    dst.comment=b'Synthetic standard DOCX comment'
    for name in src.namelist(): dst.writestr(name,src.read(name))
   data=stream.getvalue(); self.assertEqual(len(Document(io.BytesIO(data)).paragraphs),3)
   self.assertEqual(c.import_document(data)['paragraphs'],3)
 def test_independent_python_docx_inheritance_unicode_whitespace_empty_and_geometry(self):
  result=c.import_document(fixture()); d=result['document']; b=d['body']
  self.assertEqual(b['dataStream'],'  雪 🌍 <w:t>& literal   plain\r\rTail\tspaces  \r\n')
  self.assertEqual(b['textRuns'][0]['ts'],{'bl':1,'it':1,'ul':{'s':1},'fs':13,'cl':{'rgb':'#123456'}})
  self.assertEqual(b['textRuns'][1]['ts']['bl'],0); self.assertEqual(len(b['paragraphs']),3)
  self.assertEqual(d['documentStyle']['pageSize']['width'],768); self.assertEqual(d['documentStyle']['marginLeft'],48)
 def test_actual_docx_export_reopens_and_reimports(self):
  d=c.import_document(fixture())['document']; before=json.dumps(d)
  import base64
  data=base64.b64decode(c.export_document(d)['base64']); reopened=Document(io.BytesIO(data))
  self.assertEqual(reopened.paragraphs[0].runs[0].text,'  雪 🌍 <w:t>& literal  ')
  self.assertTrue(reopened.paragraphs[0].runs[0].bold); self.assertTrue(reopened.paragraphs[0].runs[0].italic)
  again=c.import_document(data)['document']; self.assertEqual(again['body']['dataStream'],d['body']['dataStream'])
  self.assertEqual(again['body']['textRuns'],d['body']['textRuns']); self.assertEqual(again['documentStyle'],d['documentStyle'])
  self.assertEqual(json.dumps(d),before)
 def test_renamed_document_part_full_preflight(self):
  data=rewrite(fixture(),lambda n,b:('word/renamed.part' if n=='word/document.xml' else n,b.replace(b'word/document.xml',b'word/renamed.part').replace(b'Target="word/document.xml"',b'Target="word/renamed.part"') if n in ('[Content_Types].xml','_rels/.rels') else b))
  # Relationship source must follow the rename too.
  data=rewrite(data,lambda n,b:('word/_rels/renamed.part.rels' if n=='word/_rels/document.xml.rels' else n,b))
  self.assertEqual(c.import_document(data)['paragraphs'],3)
  bad=rewrite(data,lambda n,b:(n,b.replace(b'<w:body>',b'<w:body><w:tbl/>') if n=='word/renamed.part' else b))
  with self.assertRaises(ValueError): c.import_document(bad)
 def test_unsupported_content_refused_before_adoption(self):
  for tag in ['tbl','hyperlink','fldSimple','ins','del','drawing','pict','object','altChunk','sdt','customXml','footnoteReference','endnoteReference']:
   with self.subTest(tag=tag),self.assertRaises(ValueError): c.import_document(replace_main(fixture(),b'<w:body>',b'<w:body><w:'+tag.encode()+b'/>'))
  changed=rewrite(fixture(),lambda n,b:(n,b.replace(b'<w:styles ',b'<w:styles ',1).replace(b'</w:styles>',b'<w:rPrChange/></w:styles>') if n=='word/styles.xml' else b))
  with self.assertRaises(ValueError):c.import_document(changed)
 def test_headers_and_multiple_sections_refused(self):
  for mode in ['header','section']:
   d=Document(); d.add_paragraph('keep')
   if mode=='header': d.sections[0].header.paragraphs[0].text='retained content'
   if mode=='section': d.add_section()
   if mode=='list': d.paragraphs[0].style='List Bullet'
   out=io.BytesIO();d.save(out)
   with self.subTest(mode=mode),self.assertRaises(ValueError): c.import_document(out.getvalue())
 def test_external_and_unknown_relationships_even_unused(self):
  for rt in [b'TargetMode="External" ',b'Type="evil" ']:
   data=rewrite(fixture(),lambda n,b:(n,b.replace(b'<Relationship ',b'<Relationship '+rt,1) if n=='word/_rels/document.xml.rels' else b))
   with self.assertRaises(Exception): c.import_document(data)
 def test_dtd_entities_and_malformed_xml(self):
  for payload in [b'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>',b'<broken>']:
   with self.assertRaises(Exception): c.import_document(rewrite(fixture(),lambda n,b:(n,payload if n=='word/settings.xml' else b)))
 def test_unreferenced_malicious_part(self):
  with self.assertRaises(ValueError): c.import_document(rewrite(fixture(),lambda n,b:(n,b),{'unused.xml':b'<active/>'}))
 def test_duplicate_and_traversal_paths(self):
  for name in ['word/document.xml','word/../evil.xml','/evil.xml','word//evil.xml','WORD/document.xml']:
   with self.subTest(name=name),self.assertRaises(ValueError): c.import_document(rewrite(fixture(),lambda n,b:(n,b),{name:b'<evil/>'}))
 def test_forged_declared_sizes_crc_and_actual_inflation(self):
  original=fixture()
  with zipfile.ZipFile(io.BytesIO(original)) as z:
   entry=z.getinfo('word/document.xml'); central=z.start_dir
   for i in z.infolist():
    if i.filename==entry.filename: break
    n,e,k=struct.unpack_from('<HHH',original,central+28); central+=46+n+e+k
  raw=bytearray(original)
  for offset,sizeat,crcat in [(entry.header_offset,22,14),(central,24,16)]:
   struct.pack_into('<I',raw,offset+sizeat,1);struct.pack_into('<I',raw,offset+crcat,zlib.crc32(b'<'))
  with self.assertRaisesRegex(ValueError,'size/CRC'): c.import_document(raw)
 def test_style_cycles_and_inherited_content(self):
  for old,new in [(b'<w:basedOn w:val="Normal"/>',b'<w:basedOn w:val="Inherited"/>'),(b'<w:i/>',b'<w:i/><w:vanish/>')]:
   data=rewrite(fixture(),lambda n,b:(n,b.replace(old,new) if n=='word/styles.xml' else b))
   with self.assertRaises(ValueError): c.import_document(data)
 def test_native_export_preserves_full_arrays_and_refuses_surrogate_split(self):
  d=c.import_document(fixture())['document']; d['body']['textRuns'][0]['ed']=5 # splits the globe surrogate
  with self.assertRaises(UnicodeDecodeError): c.export_document(d)
 def test_limits(self):
  with self.assertRaises(ValueError): c.import_document(b'x'*2_000_001)
  d=Document()
  for _ in range(10001):d.add_paragraph('')
  out=io.BytesIO();d.save(out)
  with self.assertRaisesRegex(ValueError,'Paragraph limit'):c.import_document(out.getvalue())
 def test_nested_text_and_text_outside_runs_refused(self):
  for old,new in [(b'<w:body>',b'<w:body>KEEP'),(b'<w:tab/>',b'<w:tab><w:t>KEEP</w:t></w:tab>'),(b'Tail',b'<w:t>KEEP</w:t>Tail')]:
   with self.assertRaises(ValueError): c.import_document(replace_main(fixture(),old,new))
 def test_part_identity_and_relationship_aliases(self):
  for part,old,new in [('[Content_Types].xml',b'document.main+xml',b'styles+xml'),('_rels/.rels',b'word/document.xml',b'word/%64ocument.xml'),('_rels/.rels',b'Id="rId1"',b'Id="rId2"'),('word/document.xml',b'<w:document ',b'<w:notDocument ')]:
   data=rewrite(fixture(),lambda n,b:(n,b.replace(old,new) if n==part else b))
   with self.subTest(part=part),self.assertRaises(Exception): c.import_document(data)
 def test_zip_methods_crc_and_truncation(self):
  source=fixture()
  with self.assertRaises(Exception): c.import_document(source[:-32])
  data=bytearray(source)
  with zipfile.ZipFile(io.BytesIO(source)) as z: entry=z.getinfo('word/document.xml')
  data[entry.header_offset+30+len(entry.filename)+10]^=1
  with self.assertRaises(Exception): c.import_document(data)
  out=io.BytesIO()
  with zipfile.ZipFile(io.BytesIO(source)) as src,zipfile.ZipFile(out,'w',zipfile.ZIP_BZIP2) as dst:
   for n in src.namelist():dst.writestr(n,src.read(n))
  with self.assertRaises(ValueError):c.import_document(out.getvalue())
 def test_ratio_and_member_limits(self):
  for extra in [{'payload.xml':b'x'*500001},{f'part{i}.xml':b'<x/>' for i in range(257)}]:
   with self.assertRaises(ValueError): c.import_document(rewrite(fixture(),lambda n,b:(n,b),extra))
 def test_native_nonrepresentable_font_size_refused(self):
  d=c.import_document(fixture())['document'];d['body']['textRuns'][0]['ts']['fs']=13.3
  with self.assertRaisesRegex(ValueError,'half-point'):c.export_document(d)
if __name__=='__main__':
 if len(sys.argv)>1: unittest.main()
 else:
  import subprocess
  cases=unittest.defaultTestLoader.getTestCaseNames(CodecTests);failed=0
  for name in cases:
   r=subprocess.run([sys.executable,'-I','-B',__file__,'CodecTests.'+name],capture_output=True,text=True,timeout=30)
   print(('PASS ' if r.returncode==0 else 'FAIL ')+name,flush=True)
   if r.returncode:print(r.stdout+r.stderr,flush=True);failed+=1
  print(f'{len(cases)} codec tests, {failed} failed',flush=True);sys.exit(bool(failed))
