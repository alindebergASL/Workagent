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
 'Bounded Word exchange: paragraphs, literal Unicode text, bold/italic/single underline, font size, RGB colour, simple alignment, nine-level bullets and conventional decimal, letter and Roman lists, and one page geometry. Original bytes remain downloadable.',
 'Custom marker patterns, nondefault restart rules and full level overrides are refused. Separate numbering instances, per-level starts and restarts are preserved; explicit native restarts become separate Word numbering instances. PDF applies additional text, counter and layout limits. Standard Symbol bullet glyphs map to Unicode bullets. Tables, images, links, fields, tracked changes, headers/footers, notes, embedded objects, macros and multiple sections are refused. No full Word or layout fidelity.',
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
 numbering=[n for rt,n in relationships.get(main,{}).values() if rt==R+'/numbering']
 need(len(numbering)<=1,'Ambiguous numbering relationship')
 return parsed[main], parsed[styles[0]] if styles else None, parsed[numbering[0]] if numbering else None

RP=set('rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath'.split())
PP=set('pStyle numPr keepNext keepLines pageBreakBefore widowControl suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr'.split())
def properties(e, allowed):
 if e is None: return
 seen=set()
 for c in e:
  name=c.tag.removeprefix('{'+W+'}')
  need(c.tag==q(name) and name in allowed and name not in seen,'Unsupported or duplicate Word property: '+name)
  seen.add(name)
  need(not any(x.tag==q('t') for x in c.iter()),'Content in formatting properties')

def word_int(value, maximum=2147483647):
 need(isinstance(value,str) and bool(re.fullmatch(r'[0-9]{1,10}',value)), 'Invalid numbering identifier/value')
 result=int(value); need(result<=maximum,'Numbering value limit'); return result

def numbering_index(root):
 abstracts={}; nums={}
 if root is None: return abstracts,nums
 need(len(root)<=2000,'Numbering definition limit')
 for e in root:
  if e.tag==q('abstractNum'):
   key=word_int(e.get(q('abstractNumId'))); need(key not in abstracts,'Duplicate abstractNumId'); abstracts[key]=e
   levels=set()
   for level in e.findall(q('lvl')):
    ilvl=word_int(level.get(q('ilvl')),8); need(ilvl not in levels,'Duplicate numbering level'); levels.add(ilvl)
  elif e.tag==q('num'):
   key=word_int(e.get(q('numId'))); need(key>0 and key not in nums,'Invalid or duplicate numId'); nums[key]=e
   need(len(e.findall(q('abstractNumId')))==1,'Missing/duplicate abstractNumId reference')
   word_int(val(e.find(q('abstractNumId'))))
   overrides=set()
   for override in e.findall(q('lvlOverride')):
    ilvl=word_int(override.get(q('ilvl')),8); need(ilvl not in overrides,'Duplicate numbering override'); overrides.add(ilvl)
 for num in nums.values(): need(word_int(val(num.find(q('abstractNumId')))) in abstracts,'Missing abstractNumId definition')
 return abstracts,nums

def list_indent(pp):
 result={}
 if pp is None: return result
 properties(pp,{'ind','tabs'})
 ind=pp.find(q('ind'))
 if ind is not None:
  need(not len(ind) and all(k in [q('left'),q('start'),q('hanging')] for k in ind.attrib),'Unsupported active list indentation')
  need(not (q('left') in ind.attrib and q('start') in ind.attrib),'Ambiguous list indentation')
  for tag,key in [('left','indentStart'),('start','indentStart'),('hanging','hanging')]:
   if q(tag) in ind.attrib: result[key]={'v':word_int(ind.get(q(tag)),1500000)/15}
 tabs=pp.find(q('tabs'))
 if tabs is not None:
  need(len(tabs)<=1,'Unsupported list tab stops')
  for tab in tabs:
   need(tab.tag==q('tab') and val(tab)=='num' and set(tab.attrib)<=set([q('val'),q('pos')]) and not len(tab),'Unsupported list tab stop')
   word_int(tab.get(q('pos')),1500000)
 return result

def import_document(data):
 root,styles_root,numbering_root=preflight(data)
 abstracts,nums=numbering_index(numbering_root)
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
 def runstyle(layers, sparse=False):
  result={} if sparse else {'bl':0,'it':0,'ul':{'s':0}}
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
 lists={}; list_keys={}; word_counts={}; native_counts={}; applied_overrides=set(); parsed_levels={}
 def resolve_list(layers, pc, direct):
  # Style ilvl is ignored by OOXML: the level's pStyle binding selects it.
  # Direct paragraph numPr has field-by-field precedence over style numPr.
  num_id=None; direct_level=None
  for prop in layers:
   np=prop.find(q('numPr')) if prop is not None else None
   if np is None: continue
   properties(np,{'numId','ilvl'})
   for item in np:
    need(set(item.attrib)=={q('val')} and not len(item),'Invalid numPr value')
    number=word_int(val(item),8 if item.tag==q('ilvl') else 2147483647)
    if item.tag==q('numId'): num_id=number
    elif prop is direct: direct_level=number
  if num_id in (None,0): return None
  need(num_id in nums,'Missing active numId; use a flat bullet or decimal list')
  num=nums[num_id]
  need(set(num.attrib)=={q('numId')},'Unsupported active numbering instance attributes')
  need(all(e.tag in (q('abstractNumId'),q('lvlOverride')) for e in num),'Unsupported active numbering instance')
  reference=num.find(q('abstractNumId')); need(set(reference.attrib)=={q('val')} and not len(reference),'Invalid abstractNumId reference')
  aid=word_int(val(reference)); need(aid in abstracts,'Missing active abstractNumId')
  abstract=abstracts[aid]
  need(all(e.tag in [q(n) for n in ('nsid','multiLevelType','tmpl','name','lvl')] for e in abstract),'Linked numbering styles are not mapped; use a flat list')
  need(set(abstract.attrib)=={q('abstractNumId')},'Unsupported active numbering attributes')
  level=direct_level
  if level is None:
   for style in reversed(pc):
    matches=[l for l in abstract.findall(q('lvl')) if val(l.find(q('pStyle')))==style.get(q('styleId'))]
    need(len(matches)<=1,'Ambiguous numbering style level')
    if matches: level=word_int(matches[0].get(q('ilvl')),8); break
  level=0 if level is None else level
  # numId selects starts/formatting; abstractNumId owns the running counter.
  # Keep one native identity and template, named for its first active instance.
  key=list_keys.setdefault(aid,'word-num-'+str(num_id))
  definition=lists.setdefault(key,{'listType':'ORDER_LIST','nestingLevel':[]})
  def parse_level(depth):
   if (num_id,depth) in parsed_levels: return parsed_levels[num_id,depth]
   levels=[e for e in abstract.findall(q('lvl')) if word_int(e.get(q('ilvl')),8)==depth]
   need(len(levels)==1,'Missing active numbering level')
   lvl=levels[0]; need(set(lvl.attrib)=={q('ilvl')},'Unsupported active level attributes')
   properties(lvl,{'start','numFmt','lvlText','lvlJc','suff','pPr','rPr','pStyle','lvlRestart'})
   for e in lvl:
    if e.tag not in (q('pPr'),q('rPr')): need(set(e.attrib)=={q('val')} and not len(e),'Unsupported active numbering property')
   restart=lvl.find(q('lvlRestart'))
   if restart is not None: need(depth>0 and word_int(val(restart),8)==depth,'Nondefault list restart rule is not mapped')
   fmt=val(lvl.find(q('numFmt'))); marker=val(lvl.find(q('lvlText')))
   need(fmt=='bullet' or fmt in WORD_GLYPHS,'Unsupported numbering format')
   need(val(lvl.find(q('lvlJc')),'left') in ('left','start') and val(lvl.find(q('suff')),'tab')=='tab','Unsupported list alignment/suffix; use left-aligned markers followed by a tab')
   base_start=word_int(val(lvl.find(q('start')),'0'),1000000)
   start=base_start; overridden=False
   for override in num.findall(q('lvlOverride')):
    if word_int(override.get(q('ilvl')),8)!=depth: continue
    need(set(override.attrib)=={q('ilvl')},'Unsupported active override attributes')
    properties(override,{'startOverride'})
    e=override.find(q('startOverride')); need(e is not None and set(e.attrib)=={q('val')} and not len(e),'Only start-value overrides are mapped')
    start=word_int(val(e),1000000)
    overridden=True
   need(start>=1,'List starts must be positive; effective zero is not mapped')
   rp=lvl.find(q('rPr')); properties(rp,{'rFonts','b','i','sz','color','u','vanish','webHidden','specVanish'})
   ts=runstyle([(rp,False)],sparse=True)
   fonts=rp.find(q('rFonts')) if rp is not None else None
   font=fonts.get(q('ascii'),'') if fonts is not None else ''
   if marker=='\uf0b7' and font.lower()=='symbol': marker='•'
   if fmt=='bullet': need(marker in BULLETS,'Unsupported bullet glyph; use a standard Unicode bullet')
   else: need(marker in conventional_patterns(depth),'Unsupported numbering marker pattern/reference')
   result=({'bulletAlignment':1,'startNumber':(base_start or start)-1,'glyphFormat':f' %{depth+1}' if fmt=='bullet' else marker,'textStyle':ts,'paragraphProperties':list_indent(lvl.find(q('pPr'))),**({'glyphSymbol':marker} if fmt=='bullet' else {'glyphType':WORD_GLYPHS[fmt]})},start,overridden)
   parsed_levels[num_id,depth]=result
   return result
  # The native counter cache seeds skipped ancestors from their definitions.
  # Resolve this prefix only; unused deeper Word definitions stay inactive.
  effective=[parse_level(depth) for depth in range(level+1)]
  for depth in range(len(definition['nestingLevel']),level+1): definition['nestingLevel'].append(effective[depth][0])
  active=definition['nestingLevel'][level]
  if not active.get('glyphSymbol'):
   for ref in re.findall(r'%([1-9])',active['glyphFormat']): need(not definition['nestingLevel'][int(ref)-1].get('glyphSymbol'),'Bullet parent references are not mapped')
  if definition['nestingLevel'][0].get('glyphSymbol'): definition['listType']='BULLET_LIST'
  else: definition['listType']='ORDER_LIST'
  item={'listId':key,'listType':key,'nestingLevel':level}
  counts=word_counts.setdefault(aid,{}); native=native_counts.setdefault(aid,{})
  _,start,overridden=effective[level]
  first_override=overridden and (num_id,level) not in applied_overrides
  # Parent's LibreOffice source renders apply an instance override once, then
  # use the abstract start on ancestor reset. This differs from the repeated
  # restart wording in ISO 29500's startOverride description; it is observed
  # reader behavior, not a claim that Microsoft Word was executed.
  value=start if first_override else counts.get(level,active['startNumber'])+1
  if first_override or value!=native.get(level,active['startNumber'])+1: item['startNumber']=value-1
  if overridden: applied_overrides.add((num_id,level))
  counts[level]=value; native[level]=value
  # LibreOffice's hierarchical number tree counts skipped ("phantom") parents
  # with counted descendants, independently of the marker's references:
  # sw/source/core/SwNumberTree/{SwNumberTree,SwNodeNum}.cxx. Composite source
  # markers expose these seeds directly; later outdents increment them.
  for depth in range(level):
   seed=definition['nestingLevel'][depth]['startNumber']+1
   native.setdefault(depth,seed)
   counts.setdefault(depth,seed)
  for cache in (counts,native):
   for depth in list(cache):
    if depth>level: del cache[depth]
  return item
 paragraphs=[]; runs=[]; stream=''; offset=0
 for p in list(body)[:-1]:
  need(all(e.tag in (q('pPr'),q('r')) for e in p) and len(p.findall(q('pPr')))<=1,'Unsupported paragraph content')
  pp=p.find(q('pPr')); properties(pp,PP)
  sid=val(pp.find(q('pStyle'))) if pp is not None else None
  pc=chain(sid or pdefault); pls=[default_p]+[e.find(q('pPr')) for e in pc]+[pp]
  bullet=resolve_list(pls,pc,pp)
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
  paragraph={'startIndex':offset,'paragraphStyle':ps}
  if bullet:
   # Word markers inherit the paragraph mark, then numbering rPr. Carry the
   # effective paragraph layer explicitly so native first-run styles cannot
   # accidentally override it; sparse level rPr retains its proper precedence.
   bullet['textStyle']=runstyle(base+[(mark,False)])
   paragraph['bullet']=bullet
  paragraphs.append(paragraph); stream+='\r'; offset+=1
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
 if lists: document['lists']=lists
 return {'document':document,'warnings':POLICY,'paragraphs':len(paragraphs),'runs':len(runs)}

WORD_GLYPHS={'decimal':2,'decimalZero':3,'upperLetter':4,'lowerLetter':5,'upperRoman':6,'lowerRoman':7}
BULLETS=('●','•','○','■','▪')
def conventional_patterns(depth):
 return (f'%{depth+1}.',f'%{depth+1})',''.join(f'%{i+1}.' for i in range(depth+1)))
def native_list_level(native,item,depth=None):
 depth=item['nestingLevel'] if depth is None else depth
 need(type(depth) is int and 0<=depth<=8,'Invalid native nesting level')
 template=native.get('lists',{}).get(item['listType'])
 if template is None:
  kind=item['listType']; need(kind in ('BULLET_LIST','ORDER_LIST','ORDER_LIST_1','ORDER_LIST_2','ORDER_LIST_3','ORDER_LIST_4','ORDER_LIST_5'),'Missing native list definition')
  need(kind!='ORDER_LIST_2' or depth<=6,'Missing native list level')
  glyph=2 if kind=='ORDER_LIST_2' else [4 if kind in ('ORDER_LIST_3','ORDER_LIST_4') else 3 if kind=='ORDER_LIST_5' else 2,2 if kind=='ORDER_LIST_4' else 5,7][depth%3]
  pattern=''.join(f'%{i+1}.' for i in range(depth+1)) if kind=='ORDER_LIST_2' else f'%{depth+1}'+(')' if kind=='ORDER_LIST_1' else '.')
  level={'bulletAlignment':1,'startNumber':0,'glyphFormat':f' %{depth+1}' if kind=='BULLET_LIST' else pattern,**({'glyphSymbol':BULLETS[(0,2,3)[depth%3]]} if kind=='BULLET_LIST' else {'glyphType':glyph}),'paragraphProperties':{'indentStart':{'v':21*(depth+1)},'hanging':{'v':21}}}
 else:
  need(isinstance(template,dict) and set(template)=={'listType','nestingLevel'} and template['listType'] in ('ORDER_LIST','BULLET_LIST') and isinstance(template['nestingLevel'],list) and depth<len(template['nestingLevel'])<=9,'Invalid native list definition')
  level=template['nestingLevel'][depth]
 need(isinstance(level,dict) and level.get('bulletAlignment')==1 and level.get('isLegal',False) is False,'Unsupported native list type/alignment')
 need(set(level)<=set(['bulletAlignment','startNumber','glyphFormat','glyphType','glyphSymbol','textStyle','paragraphProperties','isLegal']),'Unsupported native list properties')
 if level.get('glyphSymbol'):
  need('glyphType' not in level and level['glyphSymbol'] in BULLETS and level.get('glyphFormat') in (f' %{depth+1}',f'%{depth+1}'),'Unsupported native list marker')
 else: need(type(level.get('glyphType')) is int and level['glyphType'] in WORD_GLYPHS.values() and level.get('glyphFormat') in conventional_patterns(depth),'Unsupported native list marker')
 need(type(level.get('startNumber')) is int and 0<=level['startNumber']<=999999,'Invalid native list start')
 return level

def export_document(native, *, _pdf_visible_markers=False):
 # The server validates the full native shape before this isolated conversion.
 # Trusted PDF intermediate only: visible markers may replace conflicting
 # paragraph-mark editing metadata. Never read this option from native/JSON.
 # Body runs below keep their native styles; ordinary Word export stays strict.
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
 def apply(r,ts,sparse=False):
  if not sparse or 'bl' in ts: r.bold=bool(ts.get('bl',0))
  if not sparse or 'it' in ts: r.italic=bool(ts.get('it',0))
  if not sparse or 'ul' in ts: r.underline=bool(ts.get('ul',{}).get('s',0))
  if ts.get('fs') is not None:
   need(math.isfinite(ts['fs']) and ts['fs']*2==round(ts['fs']*2), 'Word font sizes require half-point values'); r.font.size=Pt(ts['fs'])
  color=ts.get('cl') or {}; rgb=color.get('rgb')
  if rgb:
   need(bool(re.fullmatch(r'#[a-fA-F0-9]{6}',rgb)),'Only RGB colours export'); r.font.color.rgb=RGBColor.from_string(rgb[1:])
 # Installed native renderer: first glyph -> bullet textStyle -> level
 # textStyle. Empty items use paragraph-mark formatting for their first glyph.
 # Common properties belong in numbering rPr. Per-item differences inherit
 # through paragraph-mark rPr, preserving one numId and its continuation.
 marker_styles={}; common_styles={}; cursor=0; run_cursor=0
 native_runs=body.get('textRuns',[])
 named={2:{'fs':26,'bl':1},3:{'fs':15,'cl':{'rgb':'#999999'}},4:{'fs':20,'bl':1},5:{'fs':18,'bl':1},6:{'fs':16,'bl':1},7:{'fs':14,'bl':1},8:{'fs':12,'bl':1}}
 for para in body['paragraphs']:
  end=para['startIndex']; item=para.get('bullet')
  while run_cursor<len(native_runs) and native_runs[run_cursor]['ed']<=cursor: run_cursor+=1
  if item:
   ps={**style.get('defaultParagraphStyle',{}),**para.get('paragraphStyle',{})}
   level=native_list_level(native,item)
   ts={**style.get('textStyle',{}),**named.get(ps.get('namedStyleType'),{}),**ps.get('textStyle',{})}
   if run_cursor<len(native_runs) and native_runs[run_cursor]['st']<=cursor<native_runs[run_cursor]['ed']: ts.update(native_runs[run_cursor]['ts'])
   if cursor==end: ts.update(ps.get('paragraphMarkTextStyle',{}))
   ts.update(level.get('paragraphProperties',{}).get('textStyle',{}))
   ts.update(item.get('textStyle',{})); ts.update(level.get('textStyle',{}))
   # Strike-through is always disabled on native markers. Other active marker
   # effects outside the bounded Word mapping must not disappear silently.
   ts.pop('st',None)
   need(set(ts)<=set(['bl','it','ul','fs','cl','ff','eastAsiaFontFamily','lang','altLang']),'Unsupported marker formatting')
   if 'ul' in ts: need(set(ts['ul'])=={'s'},'Unsupported marker underline')
   ts={'bl':0,'it':0,'ul':{'s':0},'fs':11,'cl':{'rgb':'#000000'},**ts}
   marker_styles[end]=ts
   key=(item['listId'],item['nestingLevel'])
   common_styles[key]={k:v for k,v in common_styles[key].items() if k in ts and ts[k]==v} if key in common_styles else dict(ts)
  cursor=end+1
 numbering=doc.part.numbering_part.element
 # Allocate within this fresh output package, retaining its unused stock
 # definitions and style references. Source bytes are never modified.
 sequences={}
 next_num=max((int(e.get(q('numId'))) for e in numbering.findall(q('num'))),default=0)
 next_abstract=max((int(e.get(q('abstractNumId'))) for e in numbering.findall(q('abstractNum'))),default=-1)+1
 def element(parent,tag,value=None,attrs=None):
  e=OxmlElement('w:'+tag)
  if value is not None: e.set(q('val'),str(value))
  for key,value in (attrs or {}).items(): e.set(q(key),str(value))
  if parent is numbering and tag=='abstractNum':
   # CT_Numbering requires all abstracts before concrete instances.
   first_num=parent.find(q('num'))
   parent.insert(list(parent).index(first_num) if first_num is not None else len(parent),e)
  else: parent.append(e)
  return e
 def positive_offset(value):
  need(type(value) is int and 0<=value<=999999,'Invalid native list start'); return value
 depths={}
 for para in body['paragraphs']:
  if para.get('bullet'):
   item=para['bullet']; depths[item['listId']]=max(depths.get(item['listId'],0),item['nestingLevel'])
 def emit_list(p,item,ps):
  nonlocal next_num,next_abstract
  need(set(item)<=set(['listId','listType','nestingLevel','startNumber','textStyle']),'Unsupported native list item')
  for key in ('listId','listType'):
   need(isinstance(item.get(key),str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{1,100}',item[key])) and item[key] not in ('__proto__','constructor','prototype'),'Invalid native list identifier')
  depth=item['nestingLevel']; level=native_list_level(native,item)
  previous=sequences.get(item['listId'])
  if previous: need(previous['type']==item['listType'],'Changing a list definition within a sequence is not mapped')
  if previous is None:
   abstract_id=next_abstract; next_abstract+=1
   abstract=element(numbering,'abstractNum',attrs={'abstractNumId':abstract_id}); element(abstract,'multiLevelType','multilevel' if depths[item['listId']] else 'singleLevel')
   for n in range(depths[item['listId']]+1):
    definition=native_list_level(native,item,n); ordered=not definition.get('glyphSymbol'); props=definition.get('paragraphProperties',{})
    need(set(props)<=set(['indentStart','hanging']),'Unsupported list layout; use simple hanging indentation')
    if ordered:
     for ref in re.findall(r'%([1-9])',definition['glyphFormat']): need(not native_list_level(native,item,int(ref)-1).get('glyphSymbol'),'Bullet parent references are not mapped')
    lvl=element(abstract,'lvl',attrs={'ilvl':n}); element(lvl,'start',definition['startNumber']+1)
    element(lvl,'numFmt',next(k for k,v in WORD_GLYPHS.items() if v==definition['glyphType']) if ordered else 'bullet')
    element(lvl,'lvlText',definition['glyphFormat'] if ordered else definition['glyphSymbol']); element(lvl,'lvlJc','left'); element(lvl,'suff','tab')
    if props:
     pp=element(lvl,'pPr'); attrs={}
     for key,tag in [('indentStart','left'),('hanging','hanging')]:
      if key in props:
       unit=props[key]; need(isinstance(unit,dict) and set(unit)<=set(['v','u']) and unit.get('u',0)==0 and type(unit.get('v')) in (int,float) and math.isfinite(unit['v']) and 0<=unit['v']<=100000,'Unsupported list indentation unit')
       attrs[tag]=round(unit['v']*15)
     element(pp,'ind',attrs=attrs)
    marker_style=common_styles.get((item['listId'],n),definition.get('textStyle',{}))
    temp=p.add_run(); apply(temp,marker_style,sparse=True); rpr=temp._r.rPr
    if rpr is not None: lvl.append(rpr)
    p._p.remove(temp._r)
   previous={'type':item['listType'],'abstract':abstract_id,'branches':[],'counts':{}}; sequences[item['listId']]=previous
  branches=previous['branches']; counts=previous['counts']
  # Restarts and synthesized continuations last only through their subtree.
  # Native seeds every skipped ancestor; readers can also visit ancestors in
  # composite markers. Explicit continuation instances pin the outdent value
  # in either case. Track actual paragraphs per branch, returning to the
  # enclosing instance so ancestor resets use the original abstract starts.
  while branches and depth<branches[-1][0]: branches.pop()
  if not branches or 'startNumber' in item or (depth in counts and depth not in branches[-1][2]):
   if 'startNumber' in item:
    while branches and depth<=branches[-1][0]: branches.pop()
   next_num+=1; num=element(numbering,'num',attrs={'numId':next_num}); element(num,'abstractNumId',previous['abstract'])
   for n in range(depth+1):
    value=positive_offset(item['startNumber'])+1 if n==depth and 'startNumber' in item else counts.get(n) if n<depth else counts[n]+1 if n in counts else None
    if value is not None:
     override=element(num,'lvlOverride',attrs={'ilvl':n}); element(override,'startOverride',value)
   branches.append((depth,next_num,set()))
  for n in range(depth): counts.setdefault(n,native_list_level(native,item,n)['startNumber']+1)
  counts[depth]=positive_offset(item['startNumber'])+1 if 'startNumber' in item else counts.get(depth,level['startNumber'])+1
  for n in list(counts):
   if n>depth: del counts[n]
  branches[-1][2].difference_update(n for n in tuple(branches[-1][2]) if n>depth)
  branches[-1][2].add(depth)
  np=element(p._p.get_or_add_pPr(),'numPr'); element(np,'ilvl',depth); element(np,'numId',branches[-1][1])
 start=0; raw=stream.encode('utf-16-le'); runs=body.get('textRuns',[]); run_index=0
 for para in body['paragraphs']:
  end=para['startIndex']; need(raw[end*2:end*2+2]==b'\r\x00','Invalid paragraph boundary')
  p=doc.add_paragraph(); ps={**style.get('defaultParagraphStyle',{}),**para.get('paragraphStyle',{})}
  if para.get('bullet'): emit_list(p,para['bullet'],ps)
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
  if para.get('bullet'):
   common=common_styles[(para['bullet']['listId'],para['bullet']['nestingLevel'])]
   explicit_mark=dict(ps.get('paragraphMarkTextStyle',{}))
   for run in relevant:
    if run['st']<=end<run['ed']: explicit_mark.update(run['ts'])
   for key,value in marker_styles[end].items():
    if key not in common:
     if not _pdf_visible_markers:
      need(key not in explicit_mark or explicit_mark[key]==value,'Conflicting paragraph-mark and mixed list-marker formatting is not mapped')
     mark[key]=value
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
