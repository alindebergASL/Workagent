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
const require = createRequire(import.meta.url);
const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a;reject=b; }); return {promise,resolve,reject}; };
const exchangeNames = ['CsvExchange','XlsxExchange','DocumentExchange','DocxExchange','PdfExchange','PdfExport'];
const compiled = new Map();
function fixture(handler = () => { throw new Error('Unexpected mutation'); }) {
  const disk = new Map(), storage = {getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)};
  const works = Object.fromEntries(['sheet','doc','other'].map(id=>[id,{id,title:id,kind:id==='doc'?'document':'sheet', ...(id==='doc'?{document:blankDocument(id,'Document')}:{book:blankWorkbook(id,id)}),status:'working',messages:[],proposals:[],contentRevision:1,intentRevision:0,eventSequence:1,expected:{contentRevision:1,permissionRevision:1,intentRevision:0,cancellationEpoch:0}}]));
  const calls=[], native = new Map(), lifetimes=[];
  function mockedEditor(props, kind) {
    const latest=React.useRef(props);latest.current=props;
    const saved=React.useRef(null);
    React.useEffect(()=>{
      saved.current=structuredClone(kind==='document'?props.document:props.book);
      const handle={save:()=>structuredClone(saved.current),commit:async()=>structuredClone(saved.current),isEditing:()=>false,contentEpoch:()=>0};
      const entry={handle,edit(value){if(kind==='document')saved.current.body.dataStream=value+'\r\n';else saved.current.sheets.sheet1.cellData={0:{0:{v:value,t:1}}};latest.current.onEdit(structuredClone(saved.current));},title(value){saved.current.title=value;latest.current.onEdit(structuredClone(saved.current));}};
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
    const value=path==='/api/work'?Object.values(works).map(({id,title,status})=>({id,title,status})):path==='/api/events'?{kind:'reset',cursor:0,events:[],works:[],snapshots:[]}:input?await handler(path,input,works):works[path.split('/').at(-1)];
    return {ok:true,status:200,json:async()=>structuredClone(value)};
  };
  const modules=new Map();
  function load(name){
    if(modules.has(name))return modules.get(name);
    if(!compiled.has(name))compiled.set(name,ts.transpileModule(readFileSync(new URL(`../src/${name}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText);
    const m={exports:{}};
    new Function('require','module','exports','localStorage','document','window','fetch','crypto','setTimeout','clearTimeout',compiled.get(name))(dependency=>{
      if(dependency==='react-dom/client')return {createRoot:()=>({render:element=>{App=element.type;}})};
      if(dependency==='./NativeEditor')return {NativeEditor};
      if(dependency==='./DocumentEditor')return {DocumentEditor};
      if(dependency==='./MaintenancePanel')return {MaintenancePanel:()=>null};
      if(dependency==='./artifact-storage')return {ArtifactStorage:FixtureArtifactStorage};
      if(exchangeNames.includes(dependency.slice(2)))return load(dependency.slice(2));
      if(dependency.endsWith('.css'))return {};
      if(dependency.startsWith('./'))return require('../src/'+dependency.slice(2)+'.ts');
      return require(dependency);
    },m,m.exports,storage,{getElementById:()=>({})},{addEventListener(){},removeEventListener(){}},fetcher,{randomUUID},()=>1,()=>{});
    modules.set(name,m.exports);return m.exports;
  }
  load('main');
  const panel=mountConditionalEditor(App,{},undefined,undefined,[...exchangeNames,'NativeEditor','DocumentEditor']);
  const flush=async()=>{for(let i=0;i<12;i++){await new Promise(setImmediate);panel.flush();}};
  const find=predicate=>panel.find(predicate);
  const button=label=>find(n=>n.type==='button'&&text(n)===label);
  return {panel,storage,calls,native,lifetimes,works,flush,find,button,
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
