// Parent/CI only: actual renderer and namespace, fail closed (never skipped).
// poppler-utils is test-only; production does not invoke PDF text extraction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { blankDocument, documentListDefinition } from '../../../packages/workagent-contract/document.mjs';
import { PdfWorker, sandboxArgs, namespaceIdentity, collectChild } from '../src/pdf-worker.mjs';
import { listDocument, glyphs, numberedDocument, overhangDocument, nestedNativeCases, nestedWordCases } from './support/pdf-list-fixture.mjs';
import { importedWord, importedSaved, contrastNative } from './support/pdf-imported-fixture.mjs';
import { nestedDocx } from './support/docx-fixture.mjs';
import { DocxWorker } from '../src/docx-worker.mjs';
const venv = process.env.WORKAGENT_DOCX_VENV;
test('actual namespace imported Word and saved colour conflict preserve content, numbering origins and visible markers', async () => {
  const source = importedWord(), original = source, word = new DocxWorker({ venv }), pdf = new PdfWorker({ venv });
  const document = (await word.run({ op: 'import', base64: source })).document;
  const before = structuredClone(document);
  const result = await pdf.run({ op: 'export', document });
  const opened = await probe(`import sys,base64,pathlib,subprocess,json,re,xml.etree.ElementTree as E
p=pathlib.Path('/tmp/imported.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
text=subprocess.check_output(['/usr/bin/pdftotext','-layout',str(p),'-'],timeout=5).decode()
subprocess.run(['/usr/bin/pdftohtml','-xml','-zoom','1','-i',str(p),'/tmp/imported.xml'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5)
boxes=[(''.join(e.itertext()).strip(),float(e.attrib['left'])) for e in E.parse('/tmp/imported.xml').iter('text')]
markers=[(t,x) for t,x in boxes if re.fullmatch(r'[0-9]+\\.|•',t)]
assert [t for t,x in markers]==['•','•','1.','2.','5.','6.','3.'],markers
assert abs(markers[2][1]-markers[4][1]-36)<2,markers
print(json.dumps({'text':text,'markers':markers}))`, result.base64);
  for (const text of ['Heading', 'Bullet A', 'Bullet B', 'Note 00120', 'Inspect', '雪', '🌍', 'Finish', 'Continue']) assert.ok(opened.text.includes(text), text);
  assert.equal(source, original); assert.deepEqual(document, before);
  assert.equal((await word.run({ op: 'import', base64: (await word.run({ op: 'export', document })).base64 })).document.body.dataStream, document.body.dataStream);
  const saved = importedSaved(), copy = structuredClone(saved);
  const savedResult = await pdf.run({ op: 'export', document: saved });
  const savedOpened = await probe(`import sys,base64,pathlib,subprocess,json,re,xml.etree.ElementTree as E
p=pathlib.Path('/tmp/saved.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
# Layout extraction can sort the taller italic emoji before its paragraph.
# Check content order here and actual glyph placement in the XML below.
text=subprocess.check_output(['/usr/bin/pdftotext','-raw',str(p),'-'],timeout=5).decode()
subprocess.run(['/usr/bin/pdftohtml','-xml','-zoom','1','-i',str(p),'/tmp/saved.xml'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5)
root=E.parse('/tmp/saved.xml');fonts={e.attrib['id']:e.attrib for e in root.iter('fontspec')}
markers=[(''.join(e.itertext()).strip(),float(e.attrib['left']),fonts[e.attrib['font']]['color'].lower()) for e in root.iter('text') if re.fullmatch(r'[0-9]+\\.|•',''.join(e.itertext()).strip())]
assert [t for t,x,c in markers]==['•','•','1.','2.','5.','6.','7.','3.'],markers
assert [c for t,x,c in markers]==['#000000']*5+['#1b1c1f']+['#000000']*2,markers
assert abs(markers[2][1]-markers[4][1]-36)<2,markers
adjacent=[]
for token in ('Inspect','雪','🌍'):
 matches=[(page.attrib['number'],e) for page in root.iter('page') for e in page.iter('text') if token in ''.join(e.itertext())]
 assert len(matches)==1,(token,'expected one XML text box',len(matches))
 page,e=matches[0]
 adjacent.append((page,*[float(e.attrib[k]) for k in ('left','top','width','height')]))
for left,right in zip(adjacent,adjacent[1:]):
 page,x,y,w,h=left;next_page,nx,ny,nw,nh=right
 assert page==next_page and min(w,h,nw,nh)>0,('glyph page/bounds',left,right)
 # XML coordinates round to points; permit that rounding, not a detached glyph.
 assert -1<=nx-(x+w)<=2,('glyphs not horizontally adjacent',left,right)
 assert min(y+h,ny+nh)-max(y,ny)>=min(h,nh)/2,('glyphs not vertically overlapping',left,right)
print(json.dumps({'text':text,'markers':markers}))`, savedResult.base64);
  for (const text of saved.body.dataStream.split(/\r|\n/).filter(Boolean)) assert.ok(savedOpened.text.replace(/\s/g, '').includes(text.replace(/\s/g, '')), text);
  for (const glyph of ['雪', '🌍']) assert.equal(savedOpened.text.split(glyph).length - 1, 1, `exactly one ${glyph}`);
  assert.equal(pdf.active, false); assert.deepEqual(saved, copy);
  await assert.rejects(word.run({ op: 'export', document: saved }), /Conflicting paragraph-mark/);
});
test('actual PDF conflict keeps red/green styled markers distinct from blue body, with empty item and restart', async () => {
  const document = contrastNative(), before = structuredClone(document), worker = new PdfWorker({ venv });
  const result = await worker.run({ op: 'export', document });
  const opened = await probe(`import sys,base64,pathlib,subprocess,json,re,xml.etree.ElementTree as E
p=pathlib.Path('/tmp/contrast.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
subprocess.run(['/usr/bin/pdftohtml','-xml','-zoom','1','-i',str(p),'/tmp/contrast.xml'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5)
root=E.parse('/tmp/contrast.xml');fonts={e.attrib['id']:e.attrib for e in root.iter('fontspec')};markers=[];body=[]
for e in root.iter('text'):
 t=''.join(e.itertext()).strip();f=fonts[e.attrib['font']]
 if not t:continue
 if re.fullmatch(r'[0-9]+\\.',t):markers.append((t,f['color'].lower(),int(f['size'])))
 else:
  assert f['color'].lower()=='#0000ff',(t,f)
  body.append(t)
assert markers==[('5.','#ff0000',20),('6.','#ff0000',20),('7.','#008000',14),('2.','#ff0000',20),('3.','#008000',14)],markers
subprocess.run(['/usr/bin/pdftoppm','-f','1','-l','1','-singlefile','-r','72',str(p),'/tmp/contrast'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5)
data=pathlib.Path('/tmp/contrast.ppm').read_bytes();header=re.match(rb'P6\\s+(\\d+)\\s+(\\d+)\\s+255\\s',data);assert header
pixels=data[header.end():];counts=[0,0,0]
for i in range(0,len(pixels),3):
 r,g,b=pixels[i:i+3]
 if r>150 and g<80 and b<80:counts[0]+=1
 if g>60 and r<40 and b<40:counts[1]+=1
 if b>150 and r<80 and g<80:counts[2]+=1
assert min(counts)>10,counts
fonts=subprocess.check_output(['/usr/bin/pdffonts',str(p)],timeout=5).decode()
assert 'DejaVuSerif-BoldItalic' in fonts,fonts
print(json.dumps({'markers':markers,'body':' '.join(body),'ink':counts}))`, result.base64);
  for (const text of ['Red marker', 'blue body', 'Plain gap', 'Continuation', 'Restart', 'Tail']) assert.ok(opened.body.includes(text), opened.body);
  assert.deepEqual(document, before); assert.equal(worker.active, false);
});
async function probe(script, input = '') {
  const args = sandboxArgs(venv); args.splice(-1, 1, '-c', script);
  const child = spawn('/usr/bin/bwrap', args, { detached: true, env: { PDF_TEST_SECRET: 'synthetic-only' }, stdio: ['pipe','pipe','pipe','pipe','pipe','pipe'] });
  namespaceIdentity().forEach((text,i) => { child.stdio[i+3].on('error',()=>{});child.stdio[i+3].end(text); });
  return await new Promise((resolve,reject) => {
    const out=[],err=[];const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(Error('probe timeout'));},12000);
    child.stdout.on('data',c=>out.push(c));child.stderr.on('data',c=>err.push(c));child.stdin.on('error',()=>{});child.on('error',reject);
    child.on('close',code=>{clearTimeout(timeout);if(code)reject(Error(Buffer.concat(err).toString()||`exit ${code}`));else resolve(JSON.parse(Buffer.concat(out)));});child.stdin.end(input);
  });
}
test('PDF actual namespace has only scoped config, synthetic actor, cleared environment, no host network/state', async()=>{
  const result=await probe(`import os,socket,json,pwd,runpy,resource
m=runpy.run_path('/render.py');m['limits']()
r={'home':not os.path.exists('/home'),'state':not os.path.exists('/var/lib/workagent-b01'),'env':'PDF_TEST_SECRET' not in os.environ,'identity':pwd.getpwuid(os.getuid()).pw_name=='worker','etc':set(os.listdir('/etc'))=={'fonts','libreoffice','passwd','group','nsswitch.conf'},'cpu':resource.getrlimit(resource.RLIMIT_CPU)==(15,15),'memory':resource.getrlimit(resource.RLIMIT_AS)==(2147483648,2147483648)}
try:
 open('/usr/pdf-test-write','w');r['readonly']=False
except OSError:r['readonly']=True
try:
 s=socket.create_connection(('127.0.0.1',8310),timeout=.1);s.close();r['network']=False
except OSError:r['network']=True
print(json.dumps(r))`);
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
});
test('actual isolated native → qualified DOCX → LibreOffice PDF opens with rich/literal/Unicode/empty/multiple-page content', async()=>{
  const worker=new PdfWorker({venv});
  for(const content of ['', 'Guests: 40\nVolunteers: 5\nAccess code 00120. Noor. Readiness confirmed. 雪 🌍\n<script> & <w:t> literal\n', Array.from({length:300},(_,i)=>`Paragraph ${i} preserved on multiple pages.`).join('\n')]){
    const document=blankDocument('pdf-test','PDF fixture',content); if(content) document.body.textRuns=[{st:0,ed:6,ts:{bl:1,it:1,ul:{s:1},fs:18,cl:{rgb:'#224466'}}}];
    const copy=structuredClone(document),start=Date.now(),pending=worker.run({op:'export',document});
    await assert.rejects(worker.run({op:'export',document}),/busy_retry/);
    const result=await pending;assert.deepEqual(document,copy);assert.equal(worker.active,false);
    const opened=await probe(`import sys,base64,pathlib,subprocess,json
p=pathlib.Path('/tmp/check.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
t=subprocess.check_output(['/usr/bin/pdftotext','-layout',str(p),'-'],timeout=5).decode()
i=subprocess.check_output(['/usr/bin/pdfinfo',str(p)],timeout=5).decode()
print(json.dumps({'text':t,'info':i}))`,result.base64);
    if(content.includes('Guests')) for(const value of ['Guests: 40','Volunteers: 5','00120','Noor','Readiness confirmed.','雪','🌍','<script> & <w:t> literal']) assert.ok(opened.text.includes(value),value);
    if(content.includes('Paragraph 299')){assert.ok(opened.text.includes('Paragraph 299'));assert.ok(Number(/Pages:\s+(\d+)/.exec(opened.info)[1])>1);}
    console.log(JSON.stringify({fixture:content?'populated':'empty',bytes:Buffer.from(result.base64,'base64').length,elapsedMs:Date.now()-start,pages:/Pages:\s+(\d+)/.exec(opened.info)[1]}));
  }
});
test('actual PID namespace tears down a descendant that creates its own session on outer timeout',async()=>{
  const args=sandboxArgs(venv);args.splice(-1,1,'-c',`import subprocess,time
subprocess.Popen(['/usr/bin/python3','-c','import time;time.sleep(60)'],start_new_session=True)
time.sleep(60)`);
  const child=spawn('/usr/bin/bwrap',args,{detached:true,env:{},stdio:['pipe','pipe','pipe','pipe','pipe','pipe']});
  const pending=collectChild(child,'',{timeoutMs:1000});namespaceIdentity().forEach((v,i)=>{child.stdio[i+3].on('error',()=>{});child.stdio[i+3].end(v);});
  const start=Date.now();await assert.rejects(pending,/pdf_worker_timeout/);assert.ok(Date.now()-start<5000,'all descendant-held output pipes must close');
});

test('actual isolated PDF preserves adjacent, reversed and repeated Han/emoji and refuses unqualified text', async()=>{
  const worker=new PdfWorker({venv});
  const content='雪 🌍\n🌍 雪\n雪🌍雪🌍\n🌍雪🌍雪\nLatin café <script> & <w:t> 00120';
  const result=await worker.run({op:'export',document:blankDocument('pdf-order','Font order',content)});
  const opened=await probe(`import sys,base64,pathlib,subprocess,json
p=pathlib.Path('/tmp/order.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
t=subprocess.check_output(['/usr/bin/pdftotext','-layout',str(p),'-'],timeout=5).decode()
print(json.dumps({'text':t}))`,result.base64);
  assert.equal((opened.text.match(/雪/g)||[]).length,6);assert.equal((opened.text.match(/🌍/gu)||[]).length,6);
  assert.ok(opened.text.includes('Latin café <script> & <w:t> 00120'));
  const lines=opened.text.split('\n').map(s=>s.replace(/\s/g,''));
  for(const line of ['雪🌍','🌍雪','雪🌍雪🌍','🌍雪🌍雪'])assert.ok(lines.includes(line),line);
  for(const [text,error] of [['العربية','pdf_unsupported_text'],['e\u0301','pdf_unsupported_text'],['👩\u200d💻','pdf_unsupported_text'],['\u9fff','pdf_missing_glyph']]){
    await assert.rejects(worker.run({op:'export',document:blankDocument('pdf-order','Unsupported',text)}),new RegExp(error));assert.equal(worker.active,false);
  }
});

test('actual isolated lists: all markers/styles, independent continuations/restarts, ordinary labels and wrapped multipage text have visible ink and no overlap', async () => {
  const worker = new PdfWorker({ venv }), document = listDocument({ long: true }), before = structuredClone(document);
  const result = await worker.run({ op: 'export', document }); assert.deepEqual(document, before);
  const opened = await probe(`import sys,base64,pathlib,subprocess,json,re,xml.etree.ElementTree as E,math
p=pathlib.Path('/tmp/lists.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
text=subprocess.check_output(['/usr/bin/pdftotext','-layout',str(p),'-'],timeout=5).decode()
fonts=subprocess.check_output(['/usr/bin/pdffonts',str(p)],timeout=5).decode()
subprocess.run(['/usr/bin/pdftohtml','-xml','-zoom','1','-i',str(p),'/tmp/lists.xml'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5)
root=E.parse('/tmp/lists.xml').getroot();pages=root.findall('page');boxes=[];visible=[]
for page in pages:
 number=page.attrib['number'];prefix='/tmp/page'+number
 subprocess.run(['/usr/bin/pdftoppm','-f',number,'-l',number,'-singlefile','-r','72','-gray',str(p),prefix],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5)
 data=pathlib.Path(prefix+'.pgm').read_bytes();header=re.match(rb'P5\\s+(\\d+)\\s+(\\d+)\\s+255\\s',data);assert header,'PGM header'
 width,height=map(int,header.groups());pixels=data[header.end():];assert len(pixels)==width*height
 for e in page.findall('text'):
  value=''.join(e.itertext()).strip()
  if not value:continue
  x,y,w,h=[float(e.attrib[k]) for k in ('left','top','width','height')]
  assert 0<=x<x+w<=float(page.attrib['width'])+1 and 0<=y<y+h<=float(page.attrib['height'])+1,(value,'outside page')
  boxes.append([int(number),value,x,y,w,h,e.attrib['font']])
  if re.fullmatch(r'[0-9]+\\.|[●•○■▪]',value) or '雪' in value:
   ink=sum(pixels[row*width+col]<220 for row in range(max(0,int(y)),min(height,math.ceil(y+h))) for col in range(max(0,int(x)),min(width,math.ceil(x+w))))
   assert ink>3,(value,'no visible ink');visible.append(value)
# Every separate marker box must end before text on its line. The PDF font
# table plus raster ink check prevents text extraction alone being the proof.
for page,value,x,y,w,h,font in boxes:
 if re.fullmatch(r'[0-9]+\\.|[●•○■▪]',value):
  peers=[b for b in boxes if b[0]==page and abs(b[3]-y)<max(3,h/3) and b[2]>x and b[1]!=value]
  assert peers,(value,'no item');assert min(b[2] for b in peers)>=x+w-1,(value,'overlap')
print(json.dumps({'text':text,'fonts':fonts,'visible':visible,'pages':len(pages),'boxes':boxes}))`, result.base64);
  assert.ok(opened.pages > 1); assert.match(opened.fonts, /DejaVuSerif-BoldItalic/); assert.match(opened.fonts, /WenQuanYiZenHei/);
  for (const [marker, word] of [['1.', 'AlphaFirst'], ['2.', 'AlphaSecond'], ['3.', 'AlphaThird'], ['5.', 'BetaFive'], ['6.', 'BetaSix'], ['9.', 'AlphaNine'], ['10.', 'AlphaTen'], ['999.', 'LargeStart'], ['1000.', 'LargeNext'], ['1000.', 'MillionStart']]) {
    assert.match(opened.text, new RegExp(marker.replace('.', '\\.') + '\\s+' + word));
    assert.ok(opened.visible.includes(marker), `visible ${marker}`);
  }
  for (const glyph of glyphs) assert.ok(opened.visible.includes(glyph), `visible ${glyph}`);
  for (let i = 0; i < 90; i++) for (const token of [`Wrapped${i}`, `Tail${i}`]) assert.equal((opened.text.match(new RegExp('\\b' + token + '\\b', 'g')) ?? []).length, 1, token);
  for (const token of new Set(document.body.dataStream.match(/[A-Za-z]+[0-9]*/g))) {
    const pattern = new RegExp('\\b' + token + '\\b', 'g');
    assert.equal((opened.text.match(pattern) ?? []).length, (document.body.dataStream.match(pattern) ?? []).length, `no lost/duplicated ${token}`);
  }
  assert.equal((opened.text.match(/雪/g) ?? []).length, (document.body.dataStream.match(/雪/g) ?? []).length);
  assert.equal((opened.text.match(/🌍/gu) ?? []).length, (document.body.dataStream.match(/🌍/gu) ?? []).length);
  const first = opened.boxes.find(b => b[1] === '1.'), second = opened.boxes.find(b => b[1] === '2.');
  assert.ok(first && second); assert.notEqual(first[6], second[6], 'different inherited marker styles');
});


test('actual namespace refuses original wrong-number cases and effective out-of-range continuations', async () => {
  const bad = [listDocument({ largeNumbers: true }), numberedDocument(32767, { continuation: true, split: true }),
    numberedDocument(65534, { continuation: true }), numberedDocument(1000000, { continuation: true }),
    numberedDocument(1, { continuation: true, restart: 32768 })];
  for (const n of [32768, 65534, 65535, 65536, 65537, 999999, 1000000]) for (const template of [false, true]) bad.push(numberedDocument(n, { template }));
  const worker = new PdfWorker({ venv });
  for (const document of bad) {
    const before = structuredClone(document);
    await assert.rejects(worker.run({ op: 'export', document }), /unsupported_pdf_list_number/);
    assert.deepEqual(document, before);
  }
  // Exercise the independent Python boundary inside the real namespace too.
  // Passing Node refusals alone is not renderer/namespace qualification.
  const refused = await probe(`import json,sys,runpy
m=runpy.run_path('/render.py');out=[]
for d in json.load(sys.stdin):
 try:m['validate_document'](d)
 except m['Refused'] as e:out.append(str(e))
 else:out.append('ACCEPTED')
print(json.dumps(out))`, JSON.stringify(bad));
  assert.deepEqual(refused, bad.map(() => 'unsupported_pdf_list_number'));
});

test('actual renderer preserves 32767 and bounded continuation, restart and distinct-ID numbers', async () => {
  const worker = new PdfWorker({ venv });
  const cases = [
    [numberedDocument(32767), ['32767. First']],
    [numberedDocument(32767, { template: true }), ['32767. First']],
    [numberedDocument(32766, { continuation: true, split: true }), ['32766. First', '32767. Next']],
    [numberedDocument(32767, { continuation: true, split: true, restart: 1 }), ['32767. First', '1. Next']],
    [numberedDocument(32767, { continuation: true, split: true, distinct: true }), ['32767. First', '1. Next']],
  ];
  const overridden = numberedDocument(1000000, { template: true }); overridden.body.paragraphs[0].bullet.startNumber = 0;
  cases.push([overridden, ['1. First']]);
  for (const [document, expected] of cases) {
    const before = structuredClone(document), result = await worker.run({ op: 'export', document });
    assert.deepEqual(document, before);
    const text = await probe(`import sys,base64,pathlib,subprocess,json
p=pathlib.Path('/tmp/bound.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
print(json.dumps(subprocess.check_output(['/usr/bin/pdftotext','-layout',str(p),'-'],timeout=5).decode()))`, result.base64);
    for (const line of expected) assert.ok(text.replace(/\s+/g, ' ').includes(line), text);
  }
});

test('actual PDF raster separates marker ink from inherited 200pt italic body and wrapped runs', async () => {
  const worker = new PdfWorker({ venv });
  for (const options of [{}, { inheritance: 'document' }, { inheritance: 'default' }, { inheritance: 'paragraph' }, { wrapped: true }, { bodySize: 11, markerSize: 17.5 }]) {
    const document = overhangDocument(options), before = structuredClone(document);
    const result = await worker.run({ op: 'export', document }); assert.deepEqual(document, before);
    const markerSize = options.markerSize ?? 11;
    const opened = await probe(`import sys,base64,pathlib,subprocess,json,re,math
p=pathlib.Path('/tmp/overhang.pdf');p.write_bytes(base64.b64decode(sys.stdin.buffer.read()))
text=subprocess.check_output(['/usr/bin/pdftotext','-layout',str(p),'-'],timeout=5).decode()
subprocess.run(['/usr/bin/pdftoppm','-f','1','-l','1','-singlefile','-r','144','-gray',str(p),'/tmp/ink'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5)
data=pathlib.Path('/tmp/ink.pgm').read_bytes();header=re.match(rb'P5\\s+(\\d+)\\s+(\\d+)\\s+255\\s',data);assert header
w,h=map(int,header.groups());pixels=data[header.end():];assert len(pixels)==w*h
# BlankDocument's 72px margin is 54pt. Demand visible marker and body ink,
# plus a truly blank vertical strip beyond the one-em marker box. The retained
# bad PDF's italic A crosses this strip although pdftotext reports both glyphs.
a=math.ceil((54+${markerSize}+1)*2);b=math.floor((54+${markerSize}+5)*2)
assert any(pixels[y*w+x]<220 for y in range(h) for x in range(108,a)), 'missing marker ink'
assert any(pixels[y*w+x]<220 for y in range(h) for x in range(b,w)), 'missing body ink'
assert all(pixels[y*w+x]>=220 for y in range(h) for x in range(a,b)), 'marker/body ink not separated'
print(json.dumps({'text':text,'clearColumns':b-a}))`, result.base64);
    assert.equal((opened.text.match(/●/g) ?? []).length, 1);
    assert.equal((opened.text.match(/A/g) ?? []).length, (document.body.dataStream.match(/A/g) ?? []).length);
    assert.ok(opened.clearColumns >= 7);
  }
});

test('nested PDF actual render: native markers, independent text and page/marker/body bounds', async () => {
  const word = new DocxWorker({venv}), pdf = new PdfWorker({venv});
  for (const c of [...nestedNativeCases(), ...nestedWordCases]) {
    const {name, expected} = c;
    const document = c.document ?? (await word.run({op:'import',base64:nestedDocx(c.input)})).document;
    const before = structuredClone(document);
    const result = await pdf.run({op:'export',document});
    const page = {...document.documentStyle,...document.body.sectionBreaks?.[0]};
    const origins = document.body.paragraphs.filter(p=>p.bullet).map(p=>{
      const props = documentListDefinition(document,p.bullet).level.paragraphProperties ?? {};
      return ((page.marginLeft ?? 96)+(props.indentStart?.v ?? 0)-(props.hanging?.v ?? 0))*.75;
    });
    const opened = await probe(`import sys,base64,pathlib,subprocess,json,re,xml.etree.ElementTree as E
request=json.loads(sys.stdin.buffer.read());p=pathlib.Path('/tmp/nested.pdf');p.write_bytes(base64.b64decode(request['base64']))
text=subprocess.check_output(['/usr/bin/pdftotext','-raw',str(p),'-'],timeout=5).decode()
subprocess.run(['/usr/bin/pdftohtml','-xml','-zoom','1','-i',str(p),'/tmp/nested.xml'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=5)
root=E.parse('/tmp/nested.xml');markers=[];positions=[]
for page in root.iter('page'):
 boxes=[]
 for e in page.iter('text'):
  t=''.join(e.itertext()).strip()
  if not t:continue
  x,y,w,h=[float(e.attrib[k]) for k in ('left','top','width','height')]
  assert w>0 and h>0 and x>=0 and y>=0 and x+w<=float(page.attrib['width'])+1 and y+h<=float(page.attrib['height'])+1,('clipped',t,x,y,w,h)
  boxes.append((t,x,y,w,h))
 for t,x,y,w,h in boxes:
  if not re.fullmatch(r'[0-9A-Za-z.]+[.)]|[●•○■▪]',t):continue
  markers.append(t);positions.append(x)
  body=[b for b in boxes if b[0]!=t and abs((b[2]+b[4])-(y+h))<max(h,b[4])*.6 and b[1]>x]
  assert body and min(b[1] for b in body)>x+w+2,('marker/body overlap',t,boxes)
 if 'DeepStart' in request['source']:
  body=[b for b in boxes if b[0]!='■']
  assert body and all(b[1]>=body[0][1]-1 for b in body),('wrapped body lost indentation',body)
assert markers==request['expected'],(markers,request['expected'])
for x,origin in zip(positions,request['origins']):assert abs(x-origin)<3,('flattened or shifted marker',x,origin)
print(json.dumps({'text':text,'markers':markers,'pages':len(list(root.iter('page')))}))`, JSON.stringify({base64:result.base64,expected,origins,source:document.body.dataStream}));
    assert.deepEqual(opened.markers, expected, name);
    for (const token of document.body.dataStream.split(/\s+/).filter(Boolean)) assert.ok(opened.text.includes(token), name + ': missing ' + token);
    assert.deepEqual(document,before,name);
  }
});
