// Real App + exchange components in the established component lifecycle fixture.
// Native handles, storage transactions and API are mocks. No browser geometry,
// native canvas/input/IME, accessibility-tree or physical-phone proof is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mountConditionalEditor } from './conditional-editor-harness.mjs';
import { FixtureArtifactStorage, draftRaw } from './artifact-storage-fixture.mjs';
import { blankWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { MaintenanceActions } from '../src/maintenance-actions.ts';
import { nativeCursorSessionOverride } from '../src/native-cursor-session.ts';
import { BehaviorSubject, Subject, NEVER } from 'rxjs';
import { SessionStatus, CollaborationController, DataLoaderService } from '@univerjs-pro/collaboration-client';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { serializeRangeWithSheet } from '@univerjs/engine-formula';
import { SheetPasteShortKeyCommand } from '@univerjs/sheets-ui';
const require = createRequire(import.meta.url);
const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return {promise,resolve,reject}; };
const exchangeNames = ['GoogleExchange','CsvExchange','XlsxExchange','DocumentExchange','DocxExchange','PdfExchange','PdfExport'];
const compiled = new Map();
function fixture(handler = () => { throw new Error('Unexpected mutation'); }, googleEnabled = false, collaboration) {
  const disk = new Map(), storage = {getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)};
  const works = Object.fromEntries(['sheet','doc','other'].map(id=>[id,{id,title:id,kind:id==='doc'?'document':'sheet', ...(id==='doc'?{document:blankDocument(id,'Document')}:{book:blankWorkbook(id,id)}),status:'working',messages:[],proposals:[],contentRevision:1,intentRevision:0,eventSequence:1,expected:{contentRevision:1,permissionRevision:1,intentRevision:0,cancellationEpoch:0}}]));
  const calls=[], native = new Map(), lifetimes=[];
  function mockedEditor(props, kind) {
    const latest=React.useRef(props);latest.current=props;
    const saved=React.useRef(null);
    React.useEffect(()=>{
      saved.current=structuredClone(kind==='document'?props.document:props.book);
      const handle={editorId:randomUUID(),save:()=>structuredClone(saved.current),commit:async()=>structuredClone(saved.current),isEditing:()=>false,contentEpoch:()=>0};
      const entry={handle,edit(value){if(kind==='document')saved.current.body=blankDocument(saved.current.id,saved.current.title,value).body;else saved.current.sheets.sheet1.cellData={0:{0:{v:value,t:1}}};latest.current.onEdit(structuredClone(saved.current));},title(value){saved.current.title=value;latest.current.onEdit(structuredClone(saved.current));}};
      native.set(saved.current.id,entry);lifetimes.push(['mount',saved.current.id,props.version]);props.onReady(handle);
      return ()=>{lifetimes.push(['dispose',saved.current.id,props.version]);props.onReady(null);};
    },[props.version]);
    return React.createElement('div',{'aria-label':kind==='document'?'Mock document':'Mock sheet'});
  }
  function NativeEditor(props){return mockedEditor(props,'sheet');}
  function DocumentEditor(props){return mockedEditor(props,'document');}
  let App;
  const fetcher=async(path,options={})=>{
    const input=options.body?JSON.parse(options.body):undefined;calls.push({path,input});
    const value=collaboration && path.endsWith('/native-session') ? collaboration.session(path) : path.startsWith('/api/exchange/google/')?(googleEnabled?await handler(path,input,works):{enabled:false,label:'Simulated Google — local only',connection:{generation:0,account:null},accounts:[],receipts:[]}):path==='/api/session'?{principal:'owner',name:'Owner',owner:true,binding:'fixture-owner'}:path==='/api/work'?Object.values(works).map(({id,title,status})=>({id,title,status})):path==='/api/events'?{kind:'reset',cursor:0,events:[],works:[],snapshots:[]}:path.endsWith('/sharing')||input?await handler(path,input,works):works[path.split('/').at(-1)];
    return {ok:true,status:200,json:async()=>structuredClone(value)};
  };
  const modules=new Map();
  function load(name){
    if(modules.has(name))return modules.get(name);
    if(!compiled.has(name))compiled.set(name,ts.transpileModule(readFileSync(new URL(`../src/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText);
    const m={exports:{}};
    new Function('require','module','exports','localStorage','document','window','fetch','crypto','setTimeout','clearTimeout','location','clearInterval',compiled.get(name))(dependency=>{
      if(name==='NativeCollaborationEditor' && dependency.startsWith('@univerjs')) return collaboration.dependency(dependency);
      if(dependency==='./NativeCollaborationEditor')return collaboration ? load('NativeCollaborationEditor') : { NativeCollaborationEditor() { assert.fail('Unexpected collaboration editor in legacy fixture'); } };
      if(dependency==='react-dom/client')return {createRoot:()=>({render:element=>{App=element.type;}})};
      if(dependency==='./NativeEditor')return {NativeEditor};
      if(dependency==='./DocumentEditor')return {DocumentEditor};
      if(dependency==='./MaintenancePanel')return {MaintenancePanel:()=>null};
      if(dependency==='./artifact-storage')return {ArtifactStorage:FixtureArtifactStorage};
      if(exchangeNames.includes(dependency.slice(2)))return load(dependency.slice(2));
      if(dependency.endsWith('.css'))return {};
      if(dependency.startsWith('./'))return require('../src/'+dependency.slice(2)+'.ts');
      return require(dependency);
    },m,m.exports,storage,{getElementById:()=>({})},collaboration?.window ?? {addEventListener(){},removeEventListener(){}},fetcher,{randomUUID},()=>1,collaboration?.clearInterval ?? (()=>{}),{origin:'http://fixture',host:'fixture',protocol:'http:'},collaboration?.clearInterval ?? (()=>{}));
    modules.set(name,m.exports);return m.exports;
  }
  load('main');
  let panel=mountConditionalEditor(App,{},undefined,collaboration?.attachHosts,[...exchangeNames,'NativeEditor','DocumentEditor','NativeCollaborationEditor']);
  const flush=async()=>{for(let i=0;i<12;i++){await new Promise(setImmediate);panel.flush();}};
  const find=predicate=>panel.find(predicate);
  const button=label=>find(n=>n.type==='button'&&text(n)===label);
  return {get panel(){return panel;},storage,calls,native,lifetimes,works,flush,find,button,
    async remount(){panel.dispose();panel=mountConditionalEditor(App,{},undefined,collaboration?.attachHosts,[...exchangeNames,'NativeEditor','DocumentEditor','NativeCollaborationEditor']);await flush();},
    async click(label){const b=button(label);assert.ok(!b.props.disabled,label);b.props.onClick();await flush();},
    async open(id){find(n=>n.props['aria-label']==='Saved work').props.onChange({target:{value:id}});await flush();},
    async message(value){find(n=>n.props.id==='prompt').props.onChange({target:{value}});await flush();},
    messageValue:()=>find(n=>n.props.id==='prompt').props.value,
    async chooseCsv(){const detail=find(n=>n.type==='details'&&text(n.props.children[0])==='Import / export CSV');nodes(detail).find(n=>n.type==='input').props.onChange({target:{files:[new File(['name,value\nA,7'],'preview.csv')],value:''}});await flush();},
    dispose:()=>panel.dispose()};
}
const tools='Work actions · Create, import / export';
for(const id of ['sheet','doc'])test(`${id}: mounted native draft, title and composer survive tools/views; protected navigation restores per-work/root drafts`,async()=>{
  const f=fixture();
  try{
    await f.flush();assert.equal(f.find(n=>n.props.id==='work-tools').props.hidden,false);
    await f.message('root unsent');await f.open(id);await f.click('Work area');
    assert.equal(f.find(n=>n.props.id==='work-tools').props.hidden,true);
    const native=f.native.get(id);native.edit('human local edit');if(id==='doc')native.title('Unsaved document title');
    await f.message('work unsent');
    const original=structuredClone(native.handle.save()),lifetime=structuredClone(f.lifetimes);
    await f.click(tools);assert.equal(f.button(tools).props['aria-expanded'],true);
    f.find(n=>n.props['aria-label']==='New work name').props.onChange({target:{value:'Unsubmitted name'}});await f.flush();
    for(let i=0;i<3;i++){await f.click(tools);await f.click('Conversation');await f.click('Work area');await f.click(tools);}
    await f.click(tools);
    assert.deepEqual(f.lifetimes,lifetime,'no editor disposal/recreation from chrome');
    assert.equal(f.native.get(id),native);assert.deepEqual(native.handle.save(),original);
    assert.equal(f.messageValue(),'work unsent');assert.match(f.panel.text(),/Unsaved changes/);
    assert.equal(f.find(n=>n.props['aria-label']==='New work name').props.value,'Unsubmitted name');
    assert.ok(f.button('Stop'),'conversation control remains mounted while working');
    assert.equal(f.calls.filter(c=>c.input).length,0,'no save/import/inference/cancel from layout');
    for(const label of [tools,'Conversation','Work area'])assert.equal(f.button(label).props.type,'button');
    await f.click(tools);await f.open('other');assert.equal(f.find(n=>n.props.id==='work-tools').props.hidden,true,'successful opening starts with native work');assert.ok(await draftRaw(f.storage,id));await f.message('other unsent');await f.open(id);
    assert.deepEqual(f.native.get(id).handle.save(),original);assert.equal(f.messageValue(),'work unsent');
    await f.open('');assert.equal(f.messageValue(),'root unsent');assert.equal(f.find(n=>n.props.id==='work-tools').props.hidden,false);
    await f.open('other');assert.equal(f.messageValue(),'other unsent');
    assert.equal(f.calls.filter(c=>c.input).length,0);
  }finally{f.dispose();}
});
test('real CSV preview and unresolved command survive collapse, views, root and work changes; late failure is visible outside hidden tools',async()=>{
  const gate=deferred();let attempts=0;
  const f=fixture((path,input)=>{
    if(path==='/api/exchange/csv/preview')return {filename:'preview.csv',bytes:14,encoding:'UTF-8',rows:2,columns:2,raggedRows:0,sample:[['name','value'],['A','7']]};
    assert.equal(path,'/api/exchange/csv/import');attempts++;return attempts===1?gate.promise:{workId:'other'};
  });
  try{
    await f.flush();await f.open('sheet');await f.click(tools);await f.chooseCsv();
    assert.match(f.panel.text(),/preview.csv: 14 bytes/);
    await f.click(tools);await f.click('Conversation');await f.click('Work area');await f.click(tools);
    assert.match(f.panel.text(),/preview.csv: 14 bytes/);assert.equal(f.calls.filter(c=>c.path.endsWith('/preview')).length,1);
    await f.click('Import as new work');const actions=new MaintenanceActions(f.storage,'csv-import'),pending=actions.read();assert.ok(pending);
    await f.click(tools);await f.open('doc');await f.open('');await f.open('sheet');
    assert.deepEqual(actions.read(),pending);assert.equal(attempts,1);
    gate.reject(new Error('Synthetic lost acknowledgement'));await f.flush();
    const notice=f.find(n=>n.props.className==='work-action-notices');assert.match(text(notice),/CSV: Synthetic lost acknowledgement/);
    assert.equal(f.find(n=>n.props.id==='work-tools').props.hidden,true);
    await f.click(tools);await f.click('Retry unresolved CSV import');
    const imports=f.calls.filter(c=>c.path.endsWith('/import'));assert.equal(imports.length,2);assert.deepEqual(imports[1].input,imports[0].input);
    assert.equal(actions.read(),null);assert.ok(f.button('Open imported sheet'));
    assert.equal(f.calls.filter(c=>c.path==='/api/work/commands'||c.path.endsWith('/save')).length,0);
    for(const label of ['Import / export Markdown / text','Import / export Word / DOCX','Import / export PDF','Import / export XLSX','Import / export CSV'])assert.equal(nodes(f.panel.tree).filter(n=>n.type==='summary'&&text(n)===label).length,1);
  }finally{f.dispose();}
});

test('pinned native engine observes hidden/visible and 360/390/430/desktop container changes without remounting',()=>{
  const sdkRequire=createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
  const {Engine}=sdkRequire('@univerjs/engine-render');
  const previous=Object.fromEntries(['window','ResizeObserver','getComputedStyle'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const idle=new Map(),sizes=[],transforms=[];let next=0,observer,mounts=0;
  const canvas={},container={width:0,height:0,appendChild(child){assert.equal(child,canvas);mounts++;},removeChild(child){assert.equal(child,canvas);}};
  // Actual SDK mount/resize/observer scheduling; only DOM geometry/canvas are fixtures.
  const engine=Object.create(Engine.prototype);
  engine._previousWidth=-1;engine._previousHeight=-1;
  engine._canvas={getCanvasEle:()=>canvas,setSize:(w,h)=>sizes.push([w,h]),getWidth:()=>sizes.at(-1)?.[0]??0,getHeight:()=>sizes.at(-1)?.[1]??0};
  engine.onTransformChange$={emitEvent:event=>transforms.push(event)};
  Object.defineProperty(globalThis,'window',{configurable:true,value:{requestIdleCallback(fn){idle.set(++next,fn);return next;},cancelIdleCallback:id=>idle.delete(id)}});
  Object.defineProperty(globalThis,'getComputedStyle',{configurable:true,value:el=>({width:el.width+'px',height:el.height+'px',borderTopWidth:'0px',borderLeftWidth:'0px',borderRightWidth:'0px',borderBottomWidth:'0px'})});
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class{constructor(fn){this.notify=fn;observer=this;}observe(el){assert.equal(el,container);}unobserve(el){assert.equal(el,container);this.released=true;}}});
  try{
    engine.mount(container);assert.deepEqual(sizes,[[0,0]]);
    for(const [width,height] of [[360,450],[390,510],[0,0],[430,560],[1000,680],[390,300]]){
      container.width=width;container.height=height;observer.notify();observer.notify();assert.equal(idle.size,1);
      const tasks=[...idle.values()];idle.clear();tasks.forEach(fn=>fn());assert.deepEqual(sizes.at(-1),[width,height]);
    }
    assert.equal(mounts,1);assert.equal(transforms.length,sizes.length);
    observer.notify();assert.equal(idle.size,1);engine.unmount();assert.equal(idle.size,0);assert.equal(observer.released,true);
  }finally{for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});

// Actual mounted App and GoogleExchange, actual service/adapter/simulator handlers;
// native editor, PostgreSQL wire and sockets remain explicit fixtures.
import { integrationFixture, handlerRequest, token as googleToken, accounts as googleAccounts, origin as googleOrigin } from '../../workagent-server/tests/support/google-integration-fixture.mjs';
import { createHandler } from '../../workagent-server/src/http.mjs';
async function googleFixture(t, intercept, afterResponse) {
  const service = integrationFixture(t);
  const route = createHandler({ workspace: service.workspace, google: service.exchange, owner: 'owner', token: googleToken, accounts: googleAccounts, origin: googleOrigin, clientRoot: '/tmp' });
  const f = fixture(async (path, input, works) => {
    await intercept?.(path, input);
    const response = await handlerRequest(route, path, { input });
    if (response.status !== 200) throw new Error(response.value.error);
    await afterResponse?.(path, input, response.value);
    if (path.endsWith('sheet-adopt')) { const w = await service.workspace.get('owner', response.value.workId); works[w.id] = { ...w, title: w.book.name }; }
    return response.value;
  }, true);
  await service.store.transaction(s => { s.works = structuredClone(f.works); for (const w of Object.values(s.works)) { w.cancellationEpoch = 0; w.sourceIds = []; w.humanCells = []; } });
  await f.flush();
  return { ...f, get panel(){return f.panel;}, service, async connect(account = 'alice') { f.find(n => n.props['aria-label'] === 'Simulated Google account').props.onChange({ target: { value: account } }); await f.flush(); } };
}
test('Google App: two-step typed adoption keeps native draft/composer through collapse and navigation; explicit Open only', async t => {
  const f = await googleFixture(t);
  try {
    await f.open('sheet'); await f.click(tools); const native = f.native.get('sheet'); native.edit('keep unsaved cell'); await f.message('keep unsent request');
    await f.connect(); await f.click('Preview simulated Sheets');
    assert.match(f.panel.text(), /0012/); assert.equal((await f.service.workspace.list('owner')).length, 3); assert.equal(f.service.writes().length, 0);
    await f.click(tools); assert.match(text(f.find(n => n.props['aria-label'] === 'File action messages')), /Sheets preview only/);
    await f.open('other'); await f.open('sheet'); await f.click(tools);
    assert.match(f.panel.text(), /0012/); assert.equal(f.messageValue(), 'keep unsent request');
    await f.click('Adopt preview as new native work');
    assert.equal((await f.service.workspace.list('owner')).length, 4);
    assert.equal(f.find(n => n.props['aria-label'] === 'Saved work').props.value, 'sheet');
    assert.equal(f.native.get('sheet').handle.save().sheets.sheet1.cellData[0][0].v, 'keep unsaved cell');
    assert.equal(f.calls.filter(c => c.path.endsWith('/save')).length, 0); assert.equal(f.service.writes().length, 0);
    await f.click('Open adopted Google sheet');
    const selected = f.find(n => n.props['aria-label'] === 'Saved work').props.value;
    assert.notEqual(selected, 'sheet'); assert.equal(f.native.get(selected).handle.save().sheets.google_0.cellData[0][0].v, '0012');
    await f.open('sheet'); assert.equal(f.messageValue(), 'keep unsent request'); assert.equal(f.native.get('sheet').handle.save().sheets.sheet1.cellData[0][0].v, 'keep unsaved cell');
  } finally { f.dispose(); }
});
test('Google App: unsaved native document/title → exact preview → confirmed readback receipt; collapse/navigation never resend/save', async t => {
  const f = await googleFixture(t);
  try {
    await f.open('doc'); await f.click(tools); const native = f.native.get('doc'); native.edit('Actual unsaved native text'); native.title('Unsaved delivery title'); await f.message('Unsent doc message'); await f.connect();
    await f.click('Preview plain-text Google Doc'); assert.equal(f.service.writes().length, 0);
    assert.match(f.panel.text(), /Actual unsaved native text/); assert.match(f.panel.text(), /Plain text in one Google Docs tab/);
    await f.click(tools); await f.click(tools); assert.equal(f.service.writes().length, 0);
    await f.click('Confirm simulated Google Doc delivery'); assert.equal(f.service.writes().length, 2); assert.match(f.panel.text(), /Readback verified/);
    assert.equal((await f.service.workspace.get('owner', 'doc')).document.title, 'Document');
    assert.equal(f.calls.filter(c => c.path.endsWith('/save')).length, 0);
    const receipt = (await f.service.exchange.state('owner', 'doc')).receipts[0]; assert.equal(f.service.sim.files.get(receipt.documentId).text, 'Actual unsaved native text');
    await f.click(tools); assert.match(text(f.find(n => n.props['aria-label'] === 'File action messages')), /Readback verified/);
    await f.open('other'); await f.open('doc'); assert.match(f.panel.text(), /Readback verified/); assert.equal(f.service.writes().length, 2);
    assert.equal(f.native.get('doc').handle.save().title, 'Unsaved delivery title'); assert.equal(f.messageValue(), 'Unsent doc message');
  } finally { f.dispose(); }
});
test('Google App: disconnect after preview refuses confirmation and delayed result cannot retarget another work', async t => {
  const gate = deferred(); let hold = false;
  const f = await googleFixture(t, async path => { if (hold && path.endsWith('sheet-preview')) await gate.promise; });
  try {
    await f.open('sheet'); await f.click(tools); await f.connect(); await f.click('Preview simulated Sheets');
    await f.click('Disconnect simulation'); assert.equal(f.service.writes().length, 0); assert.match(f.panel.text(), /Earlier previews cannot be confirmed/);
    await f.connect(); hold = true; await f.click('Preview simulated Sheets'); await f.open('other'); gate.resolve(); await f.flush();
    assert.ok(!f.panel.text().includes('0012')); assert.equal((await f.service.workspace.list('owner')).length, 3);
    await f.open('sheet'); assert.match(f.panel.text(), /Work or connection changed/); assert.equal(f.service.writes().length, 0);
  } finally { gate.resolve(); f.dispose(); }
});

test('Google App: lost request before admission cannot retry reviewed text after a native edit', async t => {
  let lose = true;
  const f = await googleFixture(t, async path => { if (path.endsWith('doc-deliver') && lose) { lose = false; throw new Error('request lost before admission'); } });
  try {
    await f.open('doc'); await f.click(tools); await f.connect();
    const native = f.native.get('doc'); native.edit('Reviewed original text');
    await f.click('Preview plain-text Google Doc'); await f.click('Confirm simulated Google Doc delivery');
    assert.equal((await f.service.exchange.state('owner', 'doc')).receipts.length, 0); assert.equal(f.service.writes().length, 0);
    native.edit('Human correction after lost request'); await f.flush();
    await f.click('Check / retry exact Google action');
    assert.equal(f.service.writes().length, 0); assert.equal(f.calls.filter(c => c.path.endsWith('doc-deliver')).length, 1);
    assert.match(f.panel.text(), /changed|stale/); assert.match(native.handle.save().body.dataStream, /Human correction/);
    await f.click('Preview plain-text Google Doc'); await f.click('Confirm simulated Google Doc delivery');
    const receipt = (await f.service.exchange.state('owner', 'doc')).receipts[0];
    assert.equal(f.service.sim.files.get(receipt.documentId).text, 'Human correction after lost request');
    assert.equal(f.service.writes().length, 2); assert.equal(f.calls.filter(c => c.path.endsWith('/save')).length, 0);
  } finally { f.dispose(); }
});

test('Google App: admitted receipt recovery preserves newer native draft and composer without another POST', async t => {
  let lose=true;
  const f=await googleFixture(t,undefined,async path=>{if(path.endsWith('doc-deliver')&&lose){lose=false;throw new Error('lost acknowledgement after admission');}});
  try {
    await f.open('doc');await f.click(tools);await f.connect();const native=f.native.get('doc');native.edit('Reviewed original text');
    await f.click('Preview plain-text Google Doc');await f.click('Confirm simulated Google Doc delivery');assert.equal(f.service.writes().length,2);
    native.edit('Newer unsaved human text');native.title('Newer local title');await f.message('Newer unsent request');const snapshot=native.handle.save();
    const start=f.calls.length;await f.click('Check / retry exact Google action');
    assert.ok(f.calls.slice(start).every(c=>c.input===undefined));assert.match(f.panel.text(),/Readback verified/);
    assert.deepEqual(native.handle.save(),snapshot);assert.equal(f.messageValue(),'Newer unsent request');
    await f.open('other');await f.open('doc');assert.deepEqual(f.native.get('doc').handle.save(),snapshot);assert.equal(f.messageValue(),'Newer unsent request');
    assert.equal(f.service.writes().length,2);assert.equal(f.calls.filter(c=>c.path.endsWith('doc-deliver')).length,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/save')).length,0);
  } finally {f.dispose();}
});

test('Google App: newly returned unknown survives a different successful delivery without refresh, collapse and remount', async t => {
  const f=await googleFixture(t);
  try {
    await f.open('doc');await f.click(tools);await f.connect();
    assert.equal((await f.service.exchange.state('owner','doc')).receipts.length,0);
    const reads=f.calls.filter(c=>c.path.includes('/exchange/google/state')).length;
    const native=f.native.get('doc');native.edit('First explicit delivery');
    f.service.sim.faults.push({path:'/v1/documents',disconnectAfter:true});
    await f.click('Preview plain-text Google Doc');await f.click('Confirm simulated Google Doc delivery');
    const unknown=(await f.service.exchange.state('owner','doc')).receipts[0];assert.equal(unknown.outcome,'unknown');
    assert.equal(f.service.writes().length,1);
    native.edit('Newer native draft delivered separately');native.title('Newer unsaved title');await f.message('Keep unsent composer');
    const snapshot=native.handle.save();
    await f.click('Preview plain-text Google Doc');await f.click('Confirm simulated Google Doc delivery');
    assert.equal(f.calls.filter(c=>c.path.includes('/exchange/google/state')).length,reads,'no state refresh between the two deliveries');
    assert.equal(f.service.writes().length,3,'one uncertain create and one explicit create/insert');
    await f.click(tools);assert.equal(f.find(n=>n.props.id==='work-tools').props.hidden,true);
    const notice=()=>text(f.find(n=>n.props['aria-label']==='File action messages'));
    assert.match(notice(),new RegExp(unknown.operationId+'.*unknown outcome'));assert.match(notice(),/Readback verified/);
    assert.deepEqual(native.handle.save(),snapshot);assert.equal(f.messageValue(),'Keep unsent composer');
    const start=f.calls.length;await f.remount();await f.open('doc');
    assert.equal(f.find(n=>n.props.id==='work-tools').props.hidden,true);
    assert.match(notice(),new RegExp(unknown.operationId+'.*unknown outcome'));assert.match(notice(),/Readback verified/);
    assert.deepEqual(f.native.get('doc').handle.save(),snapshot);assert.equal(f.messageValue(),'Keep unsent composer');
    assert.ok(f.calls.slice(start).every(c=>c.input===undefined),'remount only reads');
    assert.equal(f.calls.filter(c=>c.path.endsWith('doc-deliver')).length,2);assert.equal(f.service.writes().length,3);
    assert.equal(f.calls.filter(c=>c.path.endsWith('/save')).length,0);
  } finally {f.dispose();}
});

// Real App + real collaboration TSX. SDK, DOM hosts and timer delivery are
// interface fixtures. The existing reconciler honors the parent's React key.
function nativeLifecycle({ offline = false } = {}) {
  const timers = new Map(), listeners = new Set(), hosts = new WeakMap(), instances = [], sessions = new Map();
  let next = 0, active = 0, peak = 0;
  for (const unitID of ['A', 'B']) sessions.set(unitID, { principal: 'owner', name: 'Owner', owner: true, binding: 'fixture-owner', unitID, access: { role: 'owner', revision: 1 }, sessionPath: `/api/work/${unitID}/native-session` });
  const createUniver = options => {
    assert.equal(options.plugins.find(Array.isArray)[1].override, nativeCursorSessionOverride, 'production native editor supplies the cursor session override');
    const entry = { disposed: false, pending: false, events: new Map(), unitID: null, drain: null, members: null, membershipDisposed: 0, status: new BehaviorSubject(offline ? SessionStatus.OFFLINE : SessionStatus.ONLINE) }; instances.push(entry); active++; peak = Math.max(peak, active);
    entry.cursor = new Subject(); entry.scrolls = []; entry.watches = new Set(); entry.facadeEvents = new Map(); entry.editing = false;
    entry.commands = options.override[0][1].useFactory({createInstance:()=>({executeCommand:()=>entry.pastePromise,syncExecuteCommand(...args){entry.scrolls.push(args);return true;}})});
    const session = { get sessionStatus(){return entry.status.value;}, sessionStatus$: entry.status, event$:entry.cursor, getMemberID: () => 'self' };
    const entityInit = new Subject();
    const stream = name => ({subscribe(fn){entry.events.set(name,fn);return {unsubscribe(){entry.events.delete(name);}};}});
    const entity = {session,state:{status:'synced'},status$:stream('status'),changesetResend$:stream('resend'),conflict$:stream('conflict')};
    const controller = {getCollabEntity:id=>entry.unitID===id?entity:null,getCollabEntity$:()=>entityInit,hasWritePending:()=>entry.pending,readyForCollab:async id=>{assert.equal(id,entry.unitID);}};
    const loader = {loadUnit:async unitID=>{entry.unitID=unitID;if(!offline)entry.join();entityInit.next(entity);return {};}};
    let roomExists = !offline;
    const roomWaiters = new Set(), memberMap = new Map();
    const room = {getAllMembers:()=>[...memberMap.values()],members$:{subscribe(callback){entry.members=list=>callback(new Map(list.map(m=>[m.memberID,m])));callback(new Map(memberMap));return {unsubscribe(){entry.members=null;entry.membershipDisposed++;}};}}};
    entry.join = () => {for(const m of [{memberID:'self',userID:'owner',name:'Owner'},{memberID:'peer',userID:'peer',name:`Peer in ${entry.unitID}`}])memberMap.set(m.memberID,m);roomExists=true;for(const fn of roomWaiters)fn(room);entry.members?.([...memberMap.values()]);};
    const membership = {getRoom:()=>roomExists?room:undefined,removeMember(_unit,id){memberMap.delete(id);},waitForRoom$(){return {subscribe(fn){roomWaiters.add(fn);if(roomExists)fn(room);return {unsubscribe(){roomWaiters.delete(fn);}};}};}};
    const cache = { loadOfflineData: async () => null, saveOfflineData: async () => true, clearOfflineData: async () => {}, updateOfflineData() {}, exhaustSavingTask: async () => { await entry.drain; } };
    return { univer: { __getInjector: () => ({ get: key => {
      if(key==='user')return {setCurrentUser(){}};
      if(key==='collaboration-controller'||key===CollaborationController)return controller;
      if(key===DataLoaderService)return loader;
      if(key==='members')return membership;
      if(key==='collaboration-sessions')return {socket$:NEVER};
      if(key==='instances')return {getUnit:()=>({getSheetBySheetId:id=>id==='s'?{getRowCount:()=>100,getColumnCount:()=>26}:null,getActiveSheet:()=>({getSheetId:()=> 's'})})};
      if(key==='refs')return {watchRange(_unit,_sheet,_range,fn){entry.watches.add(fn);return {dispose(){entry.watches.delete(fn);}};}};
      if(key==='commands')return entry.commands;
      assert.equal(key,'cache');return cache;
    }}), dispose() { assert.equal(entry.disposed, false); entry.disposed = true; entry.status.complete();entityInit.complete(); active--; } },
      univerAPI: {getActiveWorkbook: () => ({ isCellEditing: () => entry.editing }),Event:{BeforeClipboardPaste:'beforePaste',ClipboardPasted:'pasted'},addEvent(name,fn){entry.facadeEvents.set(name,fn);return {dispose(){entry.facadeEvents.delete(name);}};}} };
  };
  return { instances, sessions, listeners, timers, get active(){return active;}, get peak(){return peak;},
    session: path => structuredClone(sessions.get(path.split('/')[3])),
    window: { addEventListener(_name, fn){listeners.add(fn);}, removeEventListener(_name, fn){listeners.delete(fn);}, setInterval(fn){timers.set(++next, fn);return next;} },
    clearInterval: id => timers.delete(id),
    async poll(){for(const timer of [...timers.values()])await timer();},
    attachHosts(tree){for(const node of nodes(tree))if(node.props.ref){const ref=node.props.ref;if(!hosts.has(ref))hosts.set(ref,{events:new Map(),addEventListener(name,fn){this.events.set(name,fn);},removeEventListener(name){this.events.delete(name);}});ref.current=hosts.get(ref);ref.current.inert=!!node.props.inert;}},
    dependency(name){
      if(name==='@univerjs/core')return {LocaleType:{EN_US:'enUS'},LogLevel:{WARN:1},UserManagerService:'user',IUniverInstanceService:'instances',ICommandService:'commands'};
      if(name==='@univerjs/sheets')return {RefRangeService:'refs'};
      if(name==='@univerjs-pro/collaboration-client')return {CollaborationController:'collaboration-controller',MemberService:'members',CollaborationSessionService:'collaboration-sessions',ILocalCacheService:'cache'};
      if(name==='@univerjs/presets')return {createUniver,mergeLocales:()=>({})};
      if(name==='@univerjs/preset-sheets-core')return {UniverSheetsCorePreset:()=>({})};
      return {};
    },
  };
}
test('native roster: reader names, disconnect/revoke cleanup, stale callbacks and drafts stay in their session', async () => {
  const native = nativeLifecycle(), f = fixture(undefined, false, native);
  for (const id of ['A','B']) f.works[id] = { id, kind:'native-sheet', title:id, status:'ready', access:{role:'read',revision:1} };
  native.sessions.get('A').access.role = 'read';
  try {
    await f.flush(); await f.message('retained root draft'); await f.open('A');
    assert.match(f.panel.text(), /Owner \(you, read-only\)/); assert.match(f.panel.text(), /Peer in A/);
    const a = native.instances[0], late = a.members;
    a.pending = true; await f.open('B'); assert.equal(native.instances.length,1); assert.match(f.panel.text(),/Peer in A/);
    a.status.next(SessionStatus.OFFLINE); await f.flush();
    assert.doesNotMatch(f.panel.text(), /Peer in A/); assert.match(f.panel.text(), /Live collaborators unavailable/);
    late([{memberID:'self',userID:'owner',name:'Owner'},{memberID:'late',userID:'peer',name:'Stale peer'}]); await f.flush();
    assert.doesNotMatch(f.panel.text(), /Stale peer/);
    a.status.next(SessionStatus.ONLINE); a.join(); await f.flush(); assert.match(f.panel.text(), /Peer in A/);
    native.sessions.get('A').access.revision = 2; await native.poll(); await f.flush();
    assert.doesNotMatch(f.panel.text(), /Peer in A/); assert.equal(a.members,null);
    a.pending = false; await f.open('B'); assert.equal(a.disposed,true); assert.match(f.panel.text(), /Peer in B/);
    late([{memberID:'self',userID:'owner',name:'Owner'},{memberID:'late',userID:'peer',name:'Stale peer'}]); await f.flush();
    assert.doesNotMatch(f.panel.text(), /Stale peer/);
    await f.open(''); assert.equal(f.messageValue(),'retained root draft'); assert.equal(native.peak,1);
  } finally {f.dispose(); await new Promise(setImmediate);}
  assert.equal(native.active,0); for(const entry of native.instances)assert.equal(entry.status.observers.length,0);
});
test('native component attaches while loaded offline, then observes ONLINE before room creation', async () => {
  const native=nativeLifecycle({offline:true}),f=fixture(undefined,false,native);
  f.works.A={id:'A',kind:'native-sheet',title:'A',status:'ready',access:{role:'owner',revision:1}};
  try {
    await f.flush();await f.open('A');const entry=native.instances[0];
    assert.match(f.panel.text(),/Live collaborators unavailable/);
    entry.status.next(SessionStatus.ONLINE);await f.flush();assert.doesNotMatch(f.panel.text(),/Peer in A/);
    entry.join();await f.flush();assert.match(f.panel.text(),/Peer in A/);
  }finally{f.dispose();await new Promise(setImmediate);}
  assert.equal(native.active,0);
});
test('scoped native streams retain retry feedback, pending leave guard and conflict recovery in the real component', async () => {
  const native=nativeLifecycle(),f=fixture(undefined,false,native);
  for(const id of ['A','B'])f.works[id]={id,kind:'native-sheet',title:id,status:'ready',access:{role:'owner',revision:1}};
  try {
    await f.flush();await f.open('A');const entry=native.instances[0];
    entry.pending=true;entry.events.get('resend')({reqId:9,reason:'reconnect'});await f.flush();
    assert.match(f.panel.text(),/SDK retry 9: reconnect/);
    let prevented=0;const event={preventDefault(){prevented++;},returnValue:null};for(const fn of native.listeners)fn(event);
    assert.ok(prevented>0);assert.equal(event.returnValue,'');
    await f.open('B');assert.equal(native.instances.length,1);
    const localChanges={awaitingChangeset:{sid:'retained-native',reqId:9}};
    entry.events.get('conflict')({unitID:'A',reason:'permission_rejected',localChanges,cacheCleared:true});await f.flush();
    assert.match(f.panel.text(),/Conflict: permission_rejected/);assert.match(f.panel.text(),/Download retained recovery/);
    assert.deepEqual(JSON.parse(f.storage.getItem('workagent:native-recovery:fixture-owner:A:1')).localChanges,localChanges);
    assert.equal(entry.members,null);entry.pending=false;entry.events.get('status')();await f.flush();
    assert.match(f.panel.text(),/Conflict: permission_rejected/);await f.open('B');assert.equal(native.instances.length,1);
  }finally{f.dispose();await new Promise(setImmediate);}
  assert.equal(native.active,0);assert.equal(native.instances[0].events.size,0);
});
for (const changed of ['unit', 'principal', 'binding', 'epoch']) test(`native session lifecycle: fresh ${changed} remounts through App while revoked source remains fenced`, async () => {
  const native = nativeLifecycle(), f = fixture(undefined, false, native);
  for (const id of ['A', 'B']) f.works[id] = { id, kind: 'native-sheet', title: id, status: 'ready', access: { role: 'owner', revision: 1 } };
  const recoveryKey = 'workagent:native-recovery:fixture-owner:A:1'; f.storage.setItem(recoveryKey, 'retained A operations');
  try {
    await f.flush(); await f.open('A'); assert.equal(native.instances.length, 1);
    const old = native.instances[0]; assert.match(f.panel.text(), /Download retained recovery/);
    native.sessions.get('A').access.revision = 2; await native.poll(); await f.flush();
    assert.equal(f.find(n => n.props.ref).props.inert, true); assert.match(f.panel.text(), /Access changed/);
    await f.click('Conversation'); await f.click('Work area'); old.events.get('status')(); await f.flush();
    assert.equal(native.instances.length, 1); assert.equal(f.find(n => n.props.ref).props.inert, true, 'same session stays fenced');
    const destination = changed === 'unit' ? 'B' : 'A';
    const fresh = native.sessions.get(destination);
    if (changed === 'principal') fresh.principal = 'peer';
    if (changed === 'binding') fresh.binding = 'rotated-binding';
    if (changed !== 'epoch') fresh.access.revision = 1;
    const drain = deferred(); old.drain = drain.promise;
    await f.open(destination); assert.equal(native.instances.length, 1, 'cache drain precedes next SDK construction');
    drain.resolve(); await f.flush();
    assert.equal(native.instances.length, 2); assert.equal(old.disposed, true); assert.equal(old.events.size, 0);
    assert.equal(native.active, 1); assert.equal(native.peak, 1); assert.equal(native.timers.size, 1);
    assert.equal(f.find(n => n.props.ref).props.inert, undefined, 'authorized destination must be editable');
    assert.match(f.panel.text(), /synced/); assert.doesNotMatch(f.panel.text(), /Access changed/);
    // A different principal/epoch/binding or unit must not inherit recovery state.
    if (changed !== 'principal') assert.doesNotMatch(f.panel.text(), /Download retained recovery/);
    assert.equal(f.storage.getItem(recoveryKey), 'retained A operations');
    native.instances[1].pending = true; await f.open(changed === 'unit' ? 'A' : 'B');
    assert.equal(native.instances.length, 2, 'pending work is not released by a new key');
    assert.equal(native.instances[1].disposed, false);
  } finally { f.dispose(); await new Promise(setImmediate); }
  assert.equal(native.active, 0); assert.equal(native.timers.size, 0);
});

// Actual App handlers and React keys; uncontrolled <details>.open is a host
// fixture here. Browser event/default-action behavior remains a Parent check.
for (const [source, destination] of [['A', 'B'], ['A', 'doc'], ['doc', 'A'], ['sheet', 'doc']]) {
  test(`sharing navigation ${source} → ${destination}: fresh panel, current peers and stable same-work edits`, async () => {
    const native = nativeLifecycle(), attachHosts = native.attachHosts;
    let panelHost = null;
    native.attachHosts = tree => {
      attachHosts(tree);
      const bar = nodes(tree).find(n => n.props.className === 'sharing-bar');
      const details = nodes(bar).find(n => n.type === 'details');
      if (!details) panelHost = null;
      else if (!panelHost || panelHost.key !== details.key) panelHost = { key: details.key, open: false };
    };
    const shares = Object.fromEntries([source, destination].map(id => [id, { revision: 1, peers: [{ id: `peer-${id}`, name: `Peer ${id}`, role: 'read' }] }]));
    const held = new Map();
    const f = fixture((path, input) => {
      assert.match(path, /^\/api\/work\/[^/]+\/sharing$/);
      const id = path.split('/')[3];
      if (input) {
        assert.equal(input.peer, `peer-${id}`);
        assert.equal(input.accessRevision, shares[id].revision);
        shares[id].revision++; shares[id].peers[0].role = input.role;
      } else if (held.has(id)) return held.get(id).promise;
      return structuredClone(shares[id]);
    }, false, native);
    for (const id of ['A', 'B']) f.works[id] = { id, kind: 'native-sheet', title: id, status: 'ready', access: { role: 'owner', revision: 1 } };
    const selectors = () => nodes(f.panel.tree).filter(n => n.type === 'select' && n.props['aria-label']?.startsWith('Access for '));
    const toggle = async () => {
      panelHost.open = !panelHost.open;
      f.find(n => n.type === 'summary' && text(n) === 'Share work').props.onClick();
      await f.flush();
    };
    try {
      await f.flush(); await f.message('retained root composer'); await f.open(source);
      await f.message('retained source composer');
      if (f.native.has(source)) f.native.get(source).edit('retained human draft');
      const editorLifetimes = structuredClone(f.lifetimes), sdkInstances = native.instances.length;
      assert.equal(panelHost.open, false); await toggle(); const originalPanel = panelHost;
      assert.equal(selectors().length, 1); assert.equal(selectors()[0].props['aria-label'], `Access for Peer ${source}`);
      selectors()[0].props.onChange({ target: { value: 'editor' } }); await f.flush();
      assert.equal(panelHost, originalPanel, 'same-work role update retains panel identity');
      assert.equal(panelHost.open, true); assert.equal(selectors()[0].props.value, 'editor');
      assert.deepEqual(f.lifetimes, editorLifetimes); assert.equal(native.instances.length, sdkInstances, 'sharing does not remount editors');
      assert.equal(f.messageValue(), 'retained source composer');
      const writes = f.calls.filter(c => c.input); assert.equal(writes.length, 1);
      assert.equal(writes[0].path, `/api/work/${source}/sharing`);
      // Leave an open source panel with a refresh still in flight.
      await toggle(); const lateSource = deferred(); held.set(source, lateSource); await toggle();
      assert.equal(panelHost.open, true); await f.open(destination);
      assert.notEqual(panelHost, originalPanel, 'work change must replace the uncontrolled sharing panel');
      assert.equal(panelHost.open, false, 'destination starts closed and can load on a fresh open');
      assert.equal(selectors().length, 0, 'source peers are not shown for the destination');
      const lateDestination = deferred(); held.set(destination, lateDestination); await toggle();
      assert.equal(panelHost.open, true); assert.equal(selectors().length, 0);
      lateSource.resolve(structuredClone(shares[source])); await f.flush();
      assert.equal(selectors().length, 0, 'late source response must not populate destination');
      lateDestination.resolve(structuredClone(shares[destination])); await f.flush();
      assert.equal(selectors().length, 1); assert.equal(selectors()[0].props['aria-label'], `Access for Peer ${destination}`);
      held.clear(); const destinationPanel = panelHost;
      await f.open(source); assert.notEqual(panelHost, destinationPanel); assert.notEqual(panelHost, originalPanel);
      assert.equal(panelHost.open, false); assert.equal(selectors().length, 0); await toggle();
      assert.equal(selectors()[0].props['aria-label'], `Access for Peer ${source}`); assert.equal(selectors()[0].props.value, 'editor');
      assert.equal(f.messageValue(), 'retained source composer');
      if (f.native.has(source)) assert.match(JSON.stringify(f.native.get(source).handle.save()), /retained human draft/);
      await f.open(''); assert.equal(f.messageValue(), 'retained root composer');
      assert.deepEqual(f.calls.filter(c => c.input), writes, 'toggle/navigation make no writes');
      assert.ok(native.peak <= 1, 'sharing adds no hidden SDK connections');
    } finally { f.dispose(); await new Promise(setImmediate); }
  });
}

test('native follow controls: reader view only, local input/clipboard, disconnect, epoch and drafts',async()=>{
  const native=nativeLifecycle(),f=fixture(undefined,false,native);
  for(const id of ['A','B'])f.works[id]={id,kind:'native-sheet',title:id,status:'ready',access:{role:'read',revision:1}};
  native.sessions.get('A').access.role='read';
  const cursor=entry=>entry.cursor.next({eventID:CollaborationEvent.UPDATE_CURSOR,data:{unitID:entry.unitID,memberID:'peer',userID:'peer',selection:serializeRangeWithSheet('s',{startRow:8,endRow:8,startColumn:7,endColumn:7})}});
  try{
    await f.flush();await f.message('root keep');await f.open('A');await f.message('A keep');const a=native.instances[0];
    const host=f.find(n=>n.props.ref).props.ref.current;
    let prevented=false;f.button('Follow').props.onPointerDown({preventDefault(){prevented=true;}});assert.equal(prevented,true,'follow must not blur/commit an active editor');
    await f.click('Follow');cursor(a);await f.flush();assert.equal(a.scrolls.length,1);assert.match(f.panel.text(),/Following Peer in A — view only/);assert.match(f.panel.text(),/read-only/);
    await f.click('Stop following');cursor(a);assert.equal(a.scrolls.length,1);assert.equal(a.cursor.observers.length,0);assert.equal(a.watches.size,0);
    // Worksheet-name paste is a DOM interaction, not a sheet ClipboardPasted lifecycle.
    host.events.get('paste')();await f.click('Follow');cursor(a);await f.flush();
    assert.equal(a.scrolls.length,2,'non-sheet paste must not latch following busy');
    a.scrolls.pop();await f.click('Stop following');
    a.editing=true;await f.click('Follow');cursor(a);await f.flush();assert.equal(a.scrolls.length,1);assert.match(f.panel.text(),/finish local input/);a.editing=false;
    await f.click('Follow');host.events.get('compositionstart')();cursor(a);await f.flush();assert.equal(a.scrolls.length,1);await f.click('Follow');assert.match(f.panel.text(),/Paused/);host.events.get('compositionend')();
    const clipboard=deferred();a.pastePromise=clipboard.promise;const pasting=a.commands.executeCommand(SheetPasteShortKeyCommand.id);
    await f.click('Follow');cursor(a);assert.equal(a.scrolls.length,1);clipboard.resolve(true);await pasting;
    a.pending=true;await f.click('Follow');cursor(a);assert.equal(a.scrolls.length,1);a.pending=false;
    await f.click('Follow');cursor(a);assert.equal(a.scrolls.length,2);host.events.get('wheel')();cursor(a);assert.equal(a.scrolls.length,2);
    await f.click('Follow');a.status.next(SessionStatus.OFFLINE);a.status.next(SessionStatus.ONLINE);a.join();cursor(a);await f.flush();assert.equal(a.scrolls.length,2);assert.doesNotMatch(f.panel.text(),/Following Peer in A/);
    await f.click('Follow');native.sessions.get('A').access.revision=2;await native.poll();await f.flush();cursor(a);assert.equal(a.scrolls.length,2);assert.equal(a.cursor.observers.length,0);
    await f.open('B');cursor(a);assert.equal(a.disposed,true);assert.equal(a.facadeEvents.size,0);assert.equal(host.events.size,0);assert.match(f.panel.text(),/Not following/);
    await f.open('A');assert.equal(f.messageValue(),'A keep');assert.match(f.panel.text(),/Not following/);
    await f.open('');assert.equal(f.messageValue(),'root keep');assert.equal(native.peak,1);
    assert.ok(f.calls.every(c=>c.input===undefined),'following issues no writes');
  }finally{f.dispose();await new Promise(setImmediate);}
  assert.equal(native.active,0);
});
