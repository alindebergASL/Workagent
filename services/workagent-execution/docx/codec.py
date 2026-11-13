"""Bounded DOCX conversion. Production runs only in the rootless namespace worker.
No extraction, external references, field evaluation or parser fallback.
"""
import base64, io, json, math, posixpath, re, resource, struct, sys, zipfile, zlib
from pathlib import PurePosixPath
resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_FSIZE, (24 * 1024 * 1024, 24 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
from defusedxml.ElementTree import fromstring
from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml import OxmlElement
BYTES, INFLATED, ENTRY = 2_000_000, 20_000_000, 5_000_000
POLICY = [
 'Bounded Word exchange: paragraphs, literal Unicode text, bold/italic/single underline, font size, RGB colour, simple alignment and one page geometry. Original bytes remain downloadable.',
 'Tables, images, links, fields, tracked changes, headers/footers, notes, embedded objects, macros, lists and multiple sections are refused before import. No full Word or layout fidelity.',
 'Metadata, themes, font substitution, style names and unsupported passive formatting/layout are not preserved. Inherited supported formatting is resolved explicitly. Page measurements round to Word twips; font sizes must be half-point values.',
 'Limits: 2 MB compressed, 20 MB inflated, 5 MB per part, 256 parts, 200 KB text, 10,000 paragraphs/runs, 512 relationships; no external references.'
]
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PR='http://schemas.openxmlformats.org/package/2006/relationships'
CT='http://schemas.openxmlformats.org/package/2006/content-types'
WP='application/vnd.openxmlformats-officedocument.wordprocessingml.'
def need(ok, message):
 if not ok: raise ValueError(message)
def q(n): return '{'+W+'}'+n
def val(e, default=None): return e.get(q('val'),default) if e is not None else default
def onoff(value, absent=False):
 if value is None: return absent
 need(value in ('1','true','on','0','false','off'),'Invalid OOXML OnOff value')
 return value in ('1','true','on')
def utf16(s): return len(s.encode('utf-16-le'))//2
def safe_text(s):
 need(isinstance(s,str) and not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]',s), 'Unsupported control text')
 return s
def zip_extra(raw):
 position=0
 while position<len(raw):
  need(position+4<=len(raw),'ZIP extra field bounds')
  tag,size=struct.unpack_from('<HH',raw,position); position+=4
  need(tag!=1,'ZIP64 unsupported')
  position+=size; need(position<=len(raw),'ZIP extra field bounds')

def zip_structure(z, data, infos):
 # ZipFile permits prepended archives and ignores EOCD counts/trailing bytes.
 # Require one ordinary single-disk ZIP with every byte structurally accounted
 # for, including its declared (opaque, permitted) EOCD comment.
 end=len(data)-22-len(z.comment)
 need(end>=0 and data[end:end+4]==b'PK\x05\x06','ZIP trailing bytes or invalid EOCD')
 _,disk,central_disk,disk_count,count,size,offset,comment=struct.unpack_from('<4s4H2IH',data,end)
 need(disk==central_disk==0 and disk_count==count==len(infos),'ZIP disk/count mismatch')
 need(count!=0xffff and size!=0xffffffff and offset!=0xffffffff,'ZIP64 unsupported')
 need(comment==len(z.comment) and offset==z.start_dir and offset+size==end,'ZIP central bounds mismatch')
 need(min(e.header_offset for e in infos)==0,'ZIP unexplained leading record')
 position=offset
 for e in infos:
  need(position+46<=end and data[position:position+4]==b'PK\x01\x02','ZIP central record bounds')
  compressed,expanded=struct.unpack_from('<II',data,position+20)
  name_len,extra_len,comment_len,member_disk=struct.unpack_from('<4H',data,position+28)
  local=struct.unpack_from('<I',data,position+42)[0]
  need(member_disk==0,'ZIP multidisk member unsupported')
  need(0xffffffff not in (compressed,expanded,local),'ZIP64 unsupported')
  need(local==e.header_offset,'ZIP local offset mismatch')
  extra=position+46+name_len; position=extra+extra_len+comment_len
  need(position<=end,'ZIP central record bounds')
  zip_extra(data[extra:extra+extra_len])
 need(position==end,'ZIP central size/count mismatch')

def read_member(z, entry, data, total):
    # ZipExtFile stops at the advertised size. Use ZipFile's structural checks,
    # but verify the entire raw stream ourselves with bounded output chunks.
    with z.open(entry): pass # local filename, supported flags, overlap
    header = struct.unpack_from('<4s5H3I2H', data, entry.header_offset)
    _, _, flags, method, _, _, crc, compressed, size, name_len, extra_len = header
    need(flags == entry.flag_bits and method == entry.compress_type, 'ZIP local/central mismatch')
    start = entry.header_offset + 30 + name_len + extra_len
    zip_extra(data[entry.header_offset+30+name_len:start])
    end = start + entry.compress_size
    need(0 <= entry.compress_size <= BYTES and end <= z.start_dir and end <= len(data), 'ZIP compressed bounds')
    if flags & 8:
        need(crc in (0, entry.CRC) and compressed in (0, entry.compress_size) and size in (0, entry.file_size), 'ZIP local/central mismatch')
        descriptor = end + (4 if data[end:end+4] == b'PK\x07\x08' else 0)
        need(descriptor + 12 <= entry._end_offset and struct.unpack_from('<III', data, descriptor) == (entry.CRC, entry.compress_size, entry.file_size), 'ZIP data descriptor mismatch')
        need(descriptor + 12 == entry._end_offset, 'ZIP unreported stream tail')
    else:
        need((crc, compressed, size) == (entry.CRC, entry.compress_size, entry.file_size), 'ZIP local/central mismatch')
        need(end == entry._end_offset, 'ZIP unreported stream tail')
    raw = bytearray(); checksum = 0
    inflater = zlib.decompressobj(-15) if method == 8 else None
    position = start; pending = b''
    while position < end or pending:
        if not pending:
            pending = data[position:min(position+65536, end)]; position += len(pending)
        limit = min(65536, ENTRY-len(raw)+1, INFLATED-total[0]+1)
        chunk = inflater.decompress(pending, limit) if inflater else pending[:limit]
        pending = inflater.unconsumed_tail if inflater else pending[len(chunk):]
        total[0] += len(chunk)
        need(len(raw)+len(chunk) <= ENTRY and total[0] <= INFLATED, 'ZIP actual inflated entry/total limit')
        raw.extend(chunk); checksum = zlib.crc32(chunk, checksum)
        if inflater and inflater.eof:
            need(not inflater.unused_data and not pending and position == end, 'ZIP compressed stream tail')
            break
    need(not inflater or inflater.eof, 'Truncated ZIP compressed stream')
    need(len(raw) == entry.file_size and checksum == entry.CRC, 'ZIP size/CRC inconsistency')
    return raw


def xml(raw):
 root=fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
 stack=[(root,0)]; count=0
 while stack:
  e,depth=stack.pop(); count+=1
  need(depth<=64 and count<=200000 and len(e.attrib)<=64, 'XML complexity limit')
  need(all(len(v)<=20000 for v in e.attrib.values()), 'XML attribute limit')
  stack.extend((c,depth+1) for c in e)
 return root

def preflight(data):
 need(len(data)<=BYTES and data[:4]==b'PK\x03\x04', 'Choose an unencrypted DOCX under 2 MB')
 parts={}; names=set(); total=[0]
 with zipfile.ZipFile(io.BytesIO(data)) as z:
  infos=z.infolist(); need(1<=len(infos)<=256, 'ZIP member limit')
  zip_structure(z,data,infos)
  for e in infos:
   n=e.filename
   need(n==e.orig_filename and n and n.lower() not in names and str(PurePosixPath(n))==n and not n.startswith('/') and not re.search(r'[\\:%?#\x00-\x1f]',n) and '..' not in PurePosixPath(n).parts, 'Duplicate or noncanonical ZIP path')
   names.add(n.lower())
   need(not e.flag_bits & ~0x808 and e.compress_type in (0,8) and e.file_size<=ENTRY, 'Encrypted/unsupported ZIP member')
   parts[n]=bytes(read_member(z,e,data,total))
   need(len(parts[n])<=max(100000,e.compress_size*200), 'ZIP expansion ratio limit')
 need('[Content_Types].xml' in parts and '_rels/.rels' in parts,'Missing package identity')
 types=xml(parts['[Content_Types].xml']); need(types.tag=='{'+CT+'}Types','Invalid content types')
 overrides={}; defaults={}
 for e in types:
  if e.tag=='{'+CT+'}Override':
   n=e.get('PartName',''); need(n.startswith('/') and n[1:] in parts and n not in overrides,'Ambiguous content type')
   overrides[n]=e.get('ContentType')
  else:
   n=e.get('Extension'); need(e.tag=='{'+CT+'}Default' and n and n not in defaults,'Ambiguous content default')
   defaults[n]=e.get('ContentType')
 def kind(n): return overrides.get('/'+n,defaults.get(n.rsplit('.',1)[-1]))
 roots={WP+'document.main+xml':q('document'), WP+'styles+xml':q('styles'), WP+'numbering+xml':q('numbering'), WP+'settings+xml':q('settings'), WP+'webSettings+xml':q('webSettings'), WP+'fontTable+xml':q('fonts'),
  'application/vnd.ms-word.stylesWithEffects+xml':q('styles'),
  'application/vnd.openxmlformats-officedocument.theme+xml':'{http://schemas.openxmlformats.org/drawingml/2006/main}theme',
  'application/vnd.openxmlformats-package.core-properties+xml':'{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}coreProperties',
  'application/vnd.openxmlformats-officedocument.extended-properties+xml':'{http://schemas.openxmlformats.org/officeDocument/2006/extended-properties}Properties',
  'application/vnd.openxmlformats-officedocument.customXmlProperties+xml':'{http://schemas.openxmlformats.org/officeDocument/2006/customXml}datastoreItem',
  'application/vnd.openxmlformats-package.relationships+xml':'{'+PR+'}Relationships'}
 parsed={}; relationships={}; rel_count=0
 forbidden=set('altChunk drawing pict object fldSimple fldChar instrText delText ins del moveFrom moveTo footnoteReference endnoteReference commentReference headerReference footerReference hyperlink subDoc attachedTemplate control'.split())
 for n,raw in parts.items():
  if n=='[Content_Types].xml': continue
  typ=kind(n)
  if typ=='image/jpeg':
   # Package thumbnail only, never document content. Verified via relationships below.
   continue
  need(typ in roots or typ=='application/xml','Unsupported content part type')
  root=xml(raw); parsed[n]=root
  if typ=='application/xml':
   need(root.tag=='{http://schemas.openxmlformats.org/officeDocument/2006/bibliography}Sources' and len(root)==0,'Custom XML content refused')
  else: need(root.tag==roots[typ],'Part root/content type mismatch')
  for e in root.iter():
   need(not any(k.startswith('{'+R+'}') for k in e.attrib), 'Unsupported content relationship reference')
   if typ != WP+'document.main+xml':
    need(e.tag not in (q('t'), q('p'), q('r'), q('tbl')), 'Content in passive package part')
   need(not (e.tag.startswith('{'+W+'}') and (e.tag.rsplit('}',1)[-1] in forbidden or e.tag.endswith('Change') or e.tag==q('trackRevisions'))), 'Unsupported or active Word content')
  if typ=='application/vnd.openxmlformats-package.relationships+xml':
   if n=='_rels/.rels': source=''
   else:
    directory,filename=posixpath.split(n)
    need(posixpath.basename(directory)=='_rels' and filename.endswith('.rels'),'Invalid relationship part path')
    source=posixpath.join(posixpath.dirname(directory),filename[:-5]); need(source in parts,'Missing relationship source')
   need(source not in relationships,'Duplicate relationship source'); rels={}
   for e in root:
    rel_count+=1; need(rel_count<=512,'Relationship limit')
    rid,target,rt=e.get('Id'),e.get('Target',''),e.get('Type','')
    need(e.tag=='{'+PR+'}Relationship' and rid and rid not in rels and e.get('TargetMode','Internal')=='Internal','External or ambiguous relationship')
    need(target and not re.search(r'[\\:%?#\x00-\x1f]',target),'Unsafe relationship target')
    target=posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join(posixpath.dirname(source),target))
    need(target in parts and not target.startswith('../'),'Missing or escaping relationship target')
    expected={R+'/officeDocument':WP+'document.main+xml',R+'/styles':WP+'styles+xml',R+'/numbering':WP+'numbering+xml',R+'/settings':WP+'settings+xml',R+'/webSettings':WP+'webSettings+xml',R+'/fontTable':WP+'fontTable+xml',R+'/theme':'application/vnd.openxmlformats-officedocument.theme+xml',R+'/extended-properties':'application/vnd.openxmlformats-officedocument.extended-properties+xml',R+'/customXml':'application/xml',R+'/customXmlProps':'application/vnd.openxmlformats-officedocument.customXmlProperties+xml', 'http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects':'application/vnd.ms-word.stylesWithEffects+xml',PR+'/metadata/core-properties':'application/vnd.openxmlformats-package.core-properties+xml',PR+'/metadata/thumbnail':'image/jpeg'}
    need(rt in expected and kind(target)==expected[rt],'Unsupported relationship or target type')
    rels[rid]=(rt,target)
   relationships[source]=rels
 # All package parts must be accounted for; cycles and hidden unused payloads fail closed.
 visited=set(); active=set()
 def visit(source,depth=0):
  need(depth<=32 and source not in active,'Relationship cycle/depth limit')
  if source in visited: return
  active.add(source)
  for _,target in relationships.get(source,{}).values(): visit(target,depth+1)
  active.remove(source); visited.add(source)
 visit('')
 need(all(n in visited or n=='[Content_Types].xml' or kind(n)=='application/vnd.openxmlformats-package.relationships+xml' for n in parts),'Unreferenced package content refused')
 mains=[n for rt,n in relationships.get('',{}).values() if rt==R+'/officeDocument']
 need(len(mains)==1 and [n for n in parts if kind(n)==WP+'document.main+xml']==mains,'Ambiguous document identity')
 main=mains[0]; styles=[n for rt,n in relationships.get(main,{}).values() if rt==R+'/styles']
 need(len(styles)<=1,'Ambiguous style relationship')
 return parsed[main], parsed[styles[0]] if styles else None

RP=set('rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath'.split())
PP=set('pStyle keepNext keepLines pageBreakBefore widowControl suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr'.split())
def properties(e, allowed):
 if e is None: return
 seen=set()
 for c in e:
  name=c.tag.removeprefix('{'+W+'}')
  need(c.tag==q(name) and name in allowed and name not in seen,'Unsupported or duplicate Word property: '+name)
  seen.add(name)
  need(not any(x.tag==q('t') for x in c.iter()),'Content in formatting properties')

def import_document(data):
 root,styles_root=preflight(data)
 # Independent library reopening after complete ZIP/XML/relationship preflight.
 Document(io.BytesIO(data))
 need([e.tag for e in root]==[q('body')],'Unsupported document root content')
 for e in root.iter():
  if e.tag in (q('t'),q('tab')): need(not len(e), 'Nested text content refused')
  else: need(not (e.text or '').strip(), 'Text outside a text run refused')
  need(not (e.tail or '').strip(), 'Unexpected trailing content')
  need(not any(k.startswith('{'+R+'}') for k in e.attrib), 'Content relationship references refused')
 body=root[0]; need(len(body)>0 and body[-1].tag==q('sectPr'),'One final section required')
 need(all(e.tag==q('p') for e in list(body)[:-1]),'Only text paragraphs and one final section supported')
 need(1<=len(body)-1<=10000,'Paragraph limit')
 styles={}; defaults=None; pdefault=None; rdefault=None
 if styles_root is not None:
  defaults=styles_root.find(q('docDefaults')); entries=styles_root.findall(q('style')); need(len(entries)<=2000,'Style limit')
  for e in entries:
   sid=e.get(q('styleId')); need(sid and sid not in styles,'Ambiguous style'); styles[sid]=e
   if onoff(e.get(q('default'))):
    if e.get(q('type'))=='paragraph': need(pdefault is None,'Ambiguous default style'); pdefault=sid
    if e.get(q('type'))=='character': need(rdefault is None,'Ambiguous default character style'); rdefault=sid
 def chain(sid):
  out=[]; seen=set()
  while sid:
   need(sid in styles and sid not in seen and len(seen)<64,'Style cycle or missing base')
   seen.add(sid); e=styles[sid]; out.append(e); sid=val(e.find(q('basedOn')))
  return list(reversed(out))
 for sid in styles: chain(sid)
 default_r=defaults.find(q('rPrDefault')+'/'+q('rPr')) if defaults is not None else None
 default_p=defaults.find(q('pPrDefault')+'/'+q('pPr')) if defaults is not None else None
 def runstyle(layers):
  result={'bl':0,'it':0,'ul':{'s':0}}
  for rp,toggle in layers:
   properties(rp,RP)
   if rp is None: continue
   for tag,key in [('b','bl'),('i','it')]:
    el=rp.find(q(tag))
    if el is not None:
     enabled=onoff(val(el),absent=True)
     if toggle:
      if enabled: result[key]=1-result[key]
     else: result[key]=int(enabled)
   for tag in ('vanish','webHidden','specVanish'):
    e=rp.find(q(tag)); need(e is None or not onoff(val(e),absent=True),'Hidden content refused')
   e=rp.find(q('sz'))
   if e is not None:
    size=float(val(e)); need(math.isfinite(size) and .1<=size/2<=1000,'Font size limit'); result['fs']=size/2
   e=rp.find(q('color'))
   if e is not None:
    v=val(e); need(v=='auto' or bool(re.fullmatch('[0-9a-fA-F]{6}',v or '')),'Invalid colour')
    if v!='auto': result['cl']={'rgb':'#'+v.upper()}
    else: result.pop('cl',None)
   e=rp.find(q('u'))
   if e is not None:
    v=val(e,'single'); need(v in ('single','none'),'Only single underline supported'); result['ul']={'s':int(v=='single')}
  return result
 paragraphs=[]; runs=[]; stream=''; offset=0
 for p in list(body)[:-1]:
  need(all(e.tag in (q('pPr'),q('r')) for e in p) and len(p.findall(q('pPr')))<=1,'Unsupported paragraph content')
  pp=p.find(q('pPr')); properties(pp,PP)
  sid=val(pp.find(q('pStyle'))) if pp is not None else None
  pc=chain(sid or pdefault); pls=[default_p]+[e.find(q('pPr')) for e in pc]+[pp]
  ps={}
  for prop in pls:
   properties(prop,PP)
   if prop is not None:
    jc=prop.find(q('jc'))
    if jc is not None:
     alignment=val(jc); need(alignment in ('left','center','right','both'),'Unsupported paragraph alignment'); ps['horizontalAlign']={'left':1,'center':2,'right':3,'both':4}[alignment]
  base=[(default_r,False)]+[(e.find(q('rPr')),True) for e in pc]
  for r in p.findall(q('r')):
   need(all(e.tag in (q('rPr'),q('t'),q('tab')) for e in r) and len(r.findall(q('rPr')))<=1,'Unsupported run content')
   rp=r.find(q('rPr')); properties(rp,RP)
   rs=val(rp.find(q('rStyle'))) if rp is not None else None
   rc=chain(rs or rdefault)
   ts=runstyle(base+[(e.find(q('rPr')),True) for e in rc]+[(rp,False)])
   text=''.join('\t' if e.tag==q('tab') else e.text or '' for e in r if e.tag!=q('rPr'))
   safe_text(text); need('\r' not in text and '\n' not in text,'Embedded line breaks refused')
   if text:
    end=offset+utf16(text); runs.append({'st':offset,'ed':end,'ts':ts}); offset=end; stream+=text
   need(len(runs)<=10000 and len(stream.encode('utf-8'))<=200000,'Text/run limit')
  mark=pp.find(q('rPr')) if pp is not None else None
  ps['textStyle']=runstyle(base)
  if mark is not None: ps['paragraphMarkTextStyle']=runstyle(base+[(mark,False)])
  paragraphs.append({'startIndex':offset,'paragraphStyle':ps}); stream+='\r'; offset+=1
 need(len(stream.encode('utf-8'))-1<=200000,'Text limit')
 section=body[-1]
 need(all(e.tag in (q('pgSz'),q('pgMar'),q('cols'),q('docGrid'),q('type')) for e in section),'Unsupported section content')
 for tag in ('pgSz','pgMar','cols','docGrid','type'): need(len(section.findall(q(tag)))<=1,'Duplicate section property')
 cols=section.find(q('cols')); need(cols is None or (not len(cols) and cols.get(q('num'),'1')=='1'),'Multiple columns refused')
 geometry={'pageSize':{'width':794,'height':1123},'marginTop':72,'marginBottom':72,'marginLeft':72,'marginRight':72}
 def twips(v):
  n=int(v); need(0<=n<=1500000,'Page geometry limit'); return n/15
 size=section.find(q('pgSz'))
 if size is not None:
  geometry['pageSize']={'width':twips(size.get(q('w'))),'height':twips(size.get(q('h')))}
  need(min(geometry['pageSize'].values())>0,'Invalid page size')
 margins=section.find(q('pgMar'))
 if margins is not None:
  for tag,key in [('top','marginTop'),('bottom','marginBottom'),('left','marginLeft'),('right','marginRight'),('header','marginHeader'),('footer','marginFooter')]:
   if margins.get(q(tag)) is not None: geometry[key]=twips(margins.get(q(tag)))
  need(margins.get(q('gutter'),'0')=='0','Gutter layout unsupported')
 document={'id':'preview','title':'Imported Word document','documentStyle':geometry,'body':{'dataStream':stream+'\n','paragraphs':paragraphs,'textRuns':runs,'sectionBreaks':[{'startIndex':offset}]}}
 return {'document':document,'warnings':POLICY,'paragraphs':len(paragraphs),'runs':len(runs)}

def export_document(native):
 # The server validates the full native shape before this isolated conversion.
 body=native['body']; stream=body['dataStream']; need(stream.endswith('\r\n'),'Invalid native stream')
 safe_text(stream); need(len(stream[:-2].encode('utf-8'))<=200000,'Text limit')
 need(len(body['paragraphs'])<=10000 and len(body.get('textRuns',[]))<=10000,'Paragraph/run limit')
 doc=Document(); normal=doc.styles['Normal']; normal.font.bold=False; normal.font.italic=False
 normal.paragraph_format.space_after=Pt(0)
 style=dict(native['documentStyle']); sections=body.get('sectionBreaks',[])
 need(len(sections)<=1,'Multiple sections refused')
 if sections:
  sec=sections[0]; need(not sec.get('columnProperties'),'Columns refused'); style.update({k:v for k,v in sec.items() if k in ('pageSize','marginTop','marginBottom','marginLeft','marginRight','marginHeader','marginFooter')})
 section=doc.sections[0]; size=style.get('pageSize',{'width':794,'height':1123})
 section.page_width=Pt(size['width']*.75); section.page_height=Pt(size['height']*.75)
 for nativekey,key in [('marginTop','top_margin'),('marginBottom','bottom_margin'),('marginLeft','left_margin'),('marginRight','right_margin'),('marginHeader','header_distance'),('marginFooter','footer_distance')]:
  if nativekey in style: setattr(section,key,Pt(style[nativekey]*.75))
 def apply(r,ts):
  r.bold=bool(ts.get('bl',0)); r.italic=bool(ts.get('it',0)); r.underline=bool(ts.get('ul',{}).get('s',0))
  if ts.get('fs') is not None:
   need(math.isfinite(ts['fs']) and ts['fs']*2==round(ts['fs']*2), 'Word font sizes require half-point values'); r.font.size=Pt(ts['fs'])
  color=ts.get('cl') or {}; rgb=color.get('rgb')
  if rgb:
   need(bool(re.fullmatch(r'#[a-fA-F0-9]{6}',rgb)),'Only RGB colours export'); r.font.color.rgb=RGBColor.from_string(rgb[1:])
 start=0; raw=stream.encode('utf-16-le'); runs=body.get('textRuns',[]); run_index=0
 for para in body['paragraphs']:
  end=para['startIndex']; need(raw[end*2:end*2+2]==b'\r\x00','Invalid paragraph boundary')
  p=doc.add_paragraph(); ps={**style.get('defaultParagraphStyle',{}),**para.get('paragraphStyle',{})}
  alignment=ps.get('horizontalAlign',1); need(alignment in (0,1,2,3,4,5),'Unsupported alignment')
  p.alignment={0:0,1:0,2:1,3:2,4:3,5:3}[alignment]
  base={**style.get('textStyle',{}),**ps.get('textStyle',{})}
  while run_index<len(runs) and runs[run_index]['ed']<=start: run_index+=1
  relevant=[]; j=run_index
  while j<len(runs) and runs[j]['st']<=end:
   relevant.append(runs[j]); j+=1
  boundaries=sorted({start,end}|{max(start,min(end,r[k])) for r in relevant for k in ('st','ed') if r['ed']>start and r['st']<end})
  cursor=0
  for a,b in zip(boundaries,boundaries[1:]):
   ts=dict(base)
   while cursor<len(relevant) and relevant[cursor]['ed']<=a: cursor+=1
   if cursor<len(relevant) and relevant[cursor]['st']<=a: ts.update(relevant[cursor]['ts'])
   text=raw[a*2:b*2].decode('utf-16-le'); apply(p.add_run(text),ts)
  # Preserve supported paragraph-mark formatting even on empty paragraphs.
  mark={**base,**ps.get('paragraphMarkTextStyle',{})}
  for run in relevant:
   if run['st']<=end<run['ed']: mark.update(run['ts'])
  temp=p.add_run(); apply(temp,mark); rpr=temp._r.rPr
  p._p.get_or_add_pPr().append(rpr); p._p.remove(temp._r)
  start=end+1
 need(start==utf16(stream)-1,'Paragraphs do not cover native stream')
 out=io.BytesIO(); doc.save(out); data=out.getvalue(); need(len(data)<=BYTES,'DOCX output limit')
 # Reopen our actual output with python-docx and the strict import contract.
 reopened=Document(io.BytesIO(data)); checked=import_document(data)
 need(checked['document']['body']['dataStream']==stream and len(reopened.paragraphs)==len(body['paragraphs']),'DOCX roundtrip content mismatch')
 return {'base64':base64.b64encode(data).decode(),'warnings':POLICY}

def main():
 raw=sys.stdin.buffer.read(4_500_001); need(len(raw)<=4_500_000,'Input limit'); request=json.loads(raw)
 if request.get('op')=='import': result=import_document(base64.b64decode(request['base64'],validate=True))
 elif request.get('op')=='export': result=export_document(request['document'])
 else: raise ValueError('Unknown operation')
 output=json.dumps(result,ensure_ascii=True); need(len(output)<=6_000_000,'JSON output limit'); print(output)
if __name__=='__main__':
 try: main()
 except Exception as e:
  print(json.dumps({'error':str(e)[:300]})); sys.exit(1)
