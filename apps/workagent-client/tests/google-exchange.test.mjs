// Actual GoogleExchange TSX, service, adapter and simulator handlers. Native
// capture, React scheduling, PG protocol and sockets are explicit fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mountConditionalEditor } from './conditional-editor-harness.mjs';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { integrationFixture, setup, handlerRequest, token, accounts, origin } from '../../workagent-server/tests/support/google-integration-fixture.mjs';
import { createHandler } from '../../workagent-server/src/http.mjs';
const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../src/GoogleExchange.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
const disk = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k) }; };
const held = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
function mount(storage, props) {
  const m = { exports: {} }; new Function('require', 'module', 'exports', 'localStorage', 'crypto', code)(require, m, m.exports, storage, { randomUUID });
  const panel = mountConditionalEditor(m.exports.GoogleExchange, props), flush = async () => { for (let i=0;i<12;i++) { await new Promise(setImmediate); panel.flush(); } };
  return { ...panel, flush, async click(label) { const b = panel.find(n => n.type === 'button' && text(n) === label); assert.ok(!b.props.disabled, label); b.props.onClick(); await flush(); },
    async update(next) { props = { ...props, ...next }; panel.update(props); await flush(); } };
}
async function fixture(t, intercept = async (_p, _i, fn) => fn()) {
  const service = integrationFixture(t), binding = await setup(service), storage = disk(), calls = [], notices = [];
  const work = await service.workspace.get('owner', binding.workId);
  let value = blankDocument(work.id, 'Unsaved title', 'Unsaved native text'), native;
  native = { editorId: randomUUID(), commit: async () => structuredClone(value), save: () => structuredClone(value), contentEpoch: () => 0, isEditing: () => false };
  const route = createHandler({ workspace: service.workspace, google: service.exchange, owner: 'owner', token, accounts, origin, clientRoot: '/tmp' });
  const props = { principal: 'owner', generation: 'one', work, editor: () => native, onImported: async () => {}, onOpen: async () => {}, onNotice: (_f,m) => notices.push(m),
    api: async (path,input) => { calls.push({path,input:structuredClone(input)}); return intercept(path,input,async () => { const r = await handlerRequest(route, '/api'+path, {input}); if (r.status !== 200) throw new Error(r.value.error); return r.value; }); } };
  return { service, storage, calls, props, notices, native, setValue(v) { value = v; }, setNative(n) { native = n; }, mount: () => mount(storage, props) };
}
test('mount, remount and status refresh never preview, save or write; rich input refuses visibly outside collapsed detail', async t => {
  const f = await fixture(t); let view = f.mount(); await view.flush();
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].path.includes('/state')); assert.equal(f.service.sim.events.length, 0);
  const rich = blankDocument(f.props.work.id, 'Rich', 'text'); rich.body.textRuns = [{st:0,ed:4,ts:{bl:1}}]; f.setValue(rich);
  await view.click('Preview plain-text Google Doc'); assert.match(view.text(), /Delivery refused/); assert.match(f.notices.at(-1), /rich formatting/); assert.equal(f.service.writes().length, 0);
  const container = view.find(n => n.props.className === 'google-exchange'); assert.equal(container.props.children[0].type, 'details'); assert.equal(container.props.children[1].props.role, 'status');
  view.dispose(); view = f.mount(); await view.flush(); assert.equal(f.service.writes().length, 0); assert.match(view.text(), /Delivery refused/); view.dispose();
});
for (const change of ['native-text', 'work-revision', 'permission', 'connection']) test(`confirmation after ${change} change has no external effects`, async t => {
  const f = await fixture(t), view = f.mount(); await view.flush(); await view.click('Preview plain-text Google Doc');
  if (change === 'native-text') f.setValue(blankDocument(f.props.work.id, 'Changed', 'New native text'));
  if (change === 'work-revision') await view.update({work:{...f.props.work,contentRevision:2}});
  if (change === 'permission') await view.update({work:{...f.props.work,expected:{...f.props.work.expected,permissionRevision:2}}});
  if (change === 'connection') await f.service.exchange.connect('owner',{commandId:'disconnect',account:null,connectionGeneration:1});
  await view.click('Confirm simulated Google Doc delivery'); assert.equal(f.service.writes().length,0); assert.match(view.text(), /changed|stale/); view.dispose();
});
for (const change of ['work', 'principal', 'editor', 'native-text']) test(`held doc preview result is fenced on ${change}`, async t => {
  const gate=held(); const f=await fixture(t,async(path,_input,fn)=>{const result=await fn();if(path.endsWith('doc-preview'))await gate.promise;return result;});
  const view=f.mount();await view.flush();await view.click('Preview plain-text Google Doc');
  if(change==='work')await view.update({generation:'two',work:{...f.props.work,id:'other'}});
  if(change==='principal')await view.update({principal:'peer'});
  if(change==='editor')f.setNative({...f.native});
  if(change==='native-text')f.setValue(blankDocument(f.props.work.id,'Later','Later text'));
  gate.resolve();await view.flush();assert.ok(!view.text().includes('Confirm simulated Google Doc delivery'));assert.equal(f.service.writes().length,0);view.dispose();
});
test('lost delivery acknowledgement survives remount; status read finds durable receipt without redispatch',async t=>{
  let lose=true;const f=await fixture(t,async(path,_input,fn)=>{const result=await fn();if(path.endsWith('doc-deliver')&&lose){lose=false;throw new Error('lost acknowledgement');}return result;});
  let view=f.mount();await view.flush();await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');
  assert.equal(f.service.writes().length,2);assert.match(view.text(),/Check \/ retry exact/);const count=f.calls.filter(c=>c.path.endsWith('doc-deliver')).length;view.dispose();
  view=f.mount();await view.flush();assert.match(view.text(),/Readback verified/);assert.ok(!view.text().includes('Check / retry exact'));assert.equal(f.calls.filter(c=>c.path.endsWith('doc-deliver')).length,count);assert.equal(f.service.writes().length,2);view.dispose();
});
test('unknown create stays visibly unknown across remount and exact retry; never creates another document',async t=>{
  const f=await fixture(t);f.service.sim.faults.push({path:'/v1/documents',disconnectAfter:true});let view=f.mount();await view.flush();await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');
  assert.match(view.text(),/unknown outcome/);assert.ok(!view.text().includes('Readback verified'));view.dispose();view=f.mount();await view.flush();await view.click('Refresh connection and receipts');assert.match(view.text(),/unknown outcome/);assert.equal(f.service.writes().length,1);view.dispose();
});
test('late receipt from one consumer cannot overwrite a newer preview retained by another',async t=>{
  const gate=held();let first=true;const f=await fixture(t,async(path,_input,fn)=>{const result=await fn();if(path.endsWith('doc-deliver')&&first){first=false;await gate.promise;}return result;});
  const a=f.mount();await a.flush();await a.click('Preview plain-text Google Doc');await a.click('Confirm simulated Google Doc delivery');
  const b=f.mount();await b.flush();assert.match(b.text(),/Readback verified/);await b.click('Preview plain-text Google Doc');
  const before=f.storage.getItem(`workagent-google:owner:${f.props.work.id}`);gate.resolve();await a.flush();assert.equal(f.storage.getItem(`workagent-google:owner:${f.props.work.id}`),before);assert.match(a.text(),/changed in another tab/);assert.equal(f.service.writes().length,2);a.dispose();b.dispose();
});

for (const change of ['native-text', 'work-revision', 'permission', 'generation', 'editor', 'work-roundtrip', 'principal-roundtrip', 'account', 'disconnect', 'remount']) test(`lost request before admission: ${change} fences exact retry without losing the operation ID`, async t => {
  let lose=true;
  const f=await fixture(t,async(path,_input,fn)=>{if(path.endsWith('doc-deliver')&&lose){lose=false;throw new Error('lost before admission');}return fn();});
  let view=f.mount();await view.flush();await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');
  assert.equal(f.service.writes().length,0);assert.equal((await f.service.exchange.state('owner',f.props.work.id)).receipts.length,0);
  const command=f.calls.find(c=>c.path.endsWith('doc-deliver')).input;
  if(change==='native-text')f.setValue(blankDocument(f.props.work.id,'New title','New draft'));
  if(change==='work-revision')await view.update({work:{...f.props.work,contentRevision:2}});
  if(change==='permission')await view.update({work:{...f.props.work,expected:{...f.props.work.expected,permissionRevision:2}}});
  if(change==='generation')await view.update({generation:'new-navigation'});
  if(change==='editor')f.setNative({...f.native,editorId:randomUUID()});
  if(change==='work-roundtrip'){await view.update({work:{...f.props.work,id:'other'},generation:'away'});await view.update({work:f.props.work,generation:'back'});}
  if(change==='principal-roundtrip'){await view.update({principal:'peer',generation:'peer-session'});await view.update({principal:'owner',generation:'owner-session-two'});}
  if(change==='account'||change==='disconnect')await f.service.exchange.connect('owner',{commandId:randomUUID(),account:change==='account'?'bob':null,connectionGeneration:1});
  if(change==='remount'){view.dispose();f.setNative({...f.native,editorId:randomUUID()});view=f.mount();await view.flush();}
  await view.click('Check / retry exact Google action');
  assert.equal(f.calls.filter(c=>c.path.endsWith('doc-deliver')).length,1,'retry must stop before POST');assert.equal(f.service.writes().length,0);
  const saved=JSON.parse(f.storage.getItem(`workagent-google:owner:${f.props.work.id}`));assert.deepEqual(saved.pending.input,command);
  assert.match(view.text(),/changed|stale/);view.dispose();
});
test('lost request before admission: unchanged explicit retry sends the original command exactly once',async t=>{
  let lose=true;const f=await fixture(t,async(path,_input,fn)=>{if(path.endsWith('doc-deliver')&&lose){lose=false;throw new Error('lost before admission');}return fn();});
  const view=f.mount();await view.flush();await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');
  const original=f.calls.find(c=>c.path.endsWith('doc-deliver')).input;
  await view.click('Check / retry exact Google action');assert.match(view.text(),/Readback verified/);
  const posts=f.calls.filter(c=>c.path.endsWith('doc-deliver'));assert.equal(posts.length,2);assert.deepEqual(posts[1].input,original);
  assert.equal(f.service.writes().length,2);await view.click('Refresh connection and receipts');assert.equal(f.service.writes().length,2);view.dispose();
});
for(const outcome of ['verified','unknown'])test(`admitted ${outcome} receipt recovery after newer draft is GET-only, including exact-action button`,async t=>{
  let lose=true;const f=await fixture(t,async(path,_input,fn)=>{const result=await fn();if(path.endsWith('doc-deliver')&&lose){lose=false;throw new Error('lost acknowledgement');}return result;});
  if(outcome==='unknown')f.service.sim.faults.push({path:'/v1/documents',disconnectAfter:true});
  const view=f.mount();await view.flush();await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');
  const newer=blankDocument(f.props.work.id,'Newer unsaved title','Newer local draft');f.setValue(newer);
  const writes=f.service.writes().length, start=f.calls.length;
  await view.click('Check / retry exact Google action');
  assert.ok(f.calls.slice(start).every(c=>c.input===undefined),'recovery performs only reads');assert.equal(f.service.writes().length,writes);
  assert.deepEqual(f.native.save(),newer);assert.match(view.text(),outcome==='verified'?/Readback verified/:/unknown outcome/);
  assert.ok(!view.text().includes('Check / retry exact'));view.dispose();
});
test('retry receipt read cannot cross a newer work revision while awaiting the response',async t=>{
  let lose=true,hold=false;const gate=held();const f=await fixture(t,async(path,_input,fn)=>{if(path.endsWith('doc-deliver')&&lose){lose=false;throw new Error('lost before admission');}const result=await fn();if(hold&&path.includes('/state'))await gate.promise;return result;});
  const view=f.mount();await view.flush();await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');
  hold=true;await view.click('Check / retry exact Google action');await view.update({work:{...f.props.work,contentRevision:2}});gate.resolve();await view.flush();
  assert.equal(f.calls.filter(c=>c.path.endsWith('doc-deliver')).length,1);assert.equal(f.service.writes().length,0);view.dispose();
});

async function receiptHistory(f, { latest = 'unknown', legacy = false, tied = false } = {}) {
  const deliver = async (operationId, outcome) => {
    const p = await f.service.exchange.previewDoc('owner', {workId:f.props.work.id,contentRevision:1,permissionRevision:1,connectionGeneration:1,document:blankDocument(f.props.work.id,operationId,'Synthetic receipt text')});
    if(outcome==='unknown')f.service.sim.faults.push({path:'/v1/documents',disconnectAfter:true});
    if(outcome==='not_started')f.service.pg.fail=s=>{const op=s.googleSimulation.operations[operationId];if(op&&op.receipt.stage!=='reserved')throw new Error('journal unavailable before dispatch');};
    try{return await f.service.exchange.deliverDoc('owner',{operationId,previewId:p.previewId,sourceHash:p.sourceHash,digest:p.plan.digest,connectionGeneration:1});}
    finally{f.service.pg.fail=undefined;}
  };
  await deliver('zz_earlier', 'verified');await deliver('aa_current',latest);
  await f.service.store.transaction(s=>{
    const g=s.googleSimulation;
    for(const [operationId,op] of Object.entries(g.operations)){
      const when=operationId==='zz_earlier'||tied?'2026-11-15T20:00:00.000Z':'2026-11-15T20:01:00.000Z';
      if(legacy)delete op.createdAt;else op.createdAt=when;
      if(op.receipt.recordedAt)op.receipt.recordedAt=when;
    }
    // JSONB-style key order is unrelated to operation chronology. This passes
    // through the real PostgresStore's JSON.stringify/parse transaction boundary.
    g.operations=Object.fromEntries(Object.entries(g.operations).sort(([a],[b])=>a.localeCompare(b)));
  });
  return (await f.service.exchange.state('owner',f.props.work.id)).receipts;
}
for(const active of [false,true])test(`receipt order: latest unknown survives reversed receipts, refresh and remount (stored identity ${active})`,async t=>{
  let reverse=false;const f=await fixture(t,async(path,_input,fn)=>{const result=await fn();if(path.includes('/state')&&reverse)result.receipts.reverse();return result;});
  const receipts=await receiptHistory(f,{legacy:true}), current=receipts.find(r=>r.operationId==='aa_current');
  const key=`workagent-google:owner:${f.props.work.id}`;
  if(active)f.storage.setItem(key,JSON.stringify({version:'retained',receipt:current}));
  const writes=f.service.writes().length;let view=f.mount();await view.flush();
  const check=()=>{assert.equal(JSON.parse(f.storage.getItem(key)).receipt.operationId,'aa_current');assert.match(f.notices.at(-1),/unknown outcome/);const container=view.find(n=>n.props.className==='google-exchange');assert.match(text(container.props.children[1]),/unknown outcome/);};
  check();reverse=true;await view.click('Refresh connection and receipts');check();view.dispose();view=f.mount();await view.flush();check();
  assert.ok(f.calls.every(c=>c.input===undefined));assert.equal(f.service.writes().length,writes);view.dispose();
});
for(const legacy of [false,true])test(`receipt order: reserved without recordedAt stays visible (legacy ${legacy})`,async t=>{
  const f=await fixture(t);await receiptHistory(f,{latest:'not_started',legacy});const count=f.service.writes().length;
  let view=f.mount();await view.flush();await view.click('Refresh connection and receipts');
  assert.match(f.notices.at(-1),/unresolved \/ not confirmed.*reserved/);assert.equal(JSON.parse(f.storage.getItem(`workagent-google:owner:${f.props.work.id}`)).receipt.operationId,'aa_current');
  view.dispose();view=f.mount();await view.flush();assert.match(f.notices.at(-1),/reserved/);assert.ok(f.calls.every(c=>c.input===undefined));assert.equal(f.service.writes().length,count);view.dispose();
});
for(const outcome of ['unknown','verified'])test(`receipt order: tied timestamps keep a stable selection and stored identity (${outcome})`,async t=>{
  let reverse=false;const f=await fixture(t,async(path,_input,fn)=>{const result=await fn();if(path.includes('/state')&&reverse)result.receipts.reverse();return result;});
  const receipts=await receiptHistory(f,{latest:outcome,tied:true}), key=`workagent-google:owner:${f.props.work.id}`;
  const selected=outcome==='unknown'?'aa_current':'zz_earlier';
  if(outcome==='verified')f.storage.setItem(key,JSON.stringify({version:'active',receipt:receipts.find(r=>r.operationId===selected)}));
  let view=f.mount();await view.flush();assert.equal(JSON.parse(f.storage.getItem(key)).receipt.operationId,selected);
  reverse=true;await view.click('Refresh connection and receipts');assert.equal(JSON.parse(f.storage.getItem(key)).receipt.operationId,selected);
  view.dispose();view=f.mount();await view.flush();assert.equal(JSON.parse(f.storage.getItem(key)).receipt.operationId,selected);assert.ok(f.calls.every(c=>c.input===undefined));view.dispose();
});
test('receipt order: exact pending receipt wins over a newer unrelated unknown receipt without redispatch',async t=>{
  const f=await fixture(t),receipts=await receiptHistory(f),earlier=receipts.find(r=>r.operationId==='zz_earlier'),key=`workagent-google:owner:${f.props.work.id}`;
  f.storage.setItem(key,JSON.stringify({version:'pending',receipt:receipts.find(r=>r.operationId==='aa_current'),pending:{path:'/exchange/google/doc-deliver',input:{operationId:earlier.operationId,previewId:earlier.previewId}}}));
  const writes=f.service.writes().length,view=f.mount();await view.flush();const saved=JSON.parse(f.storage.getItem(key));
  assert.equal(saved.receipt.operationId,earlier.operationId);assert.equal(saved.pending,undefined);assert.match(f.notices.at(-1),/Readback verified/);assert.match(f.notices.at(-1),/aa_current.*unknown outcome/);
  assert.ok(f.calls.every(c=>c.input===undefined));assert.equal(f.service.writes().length,writes);view.dispose();
});
test('receipt order: an unmatched pending action is never displayed as an older verified delivery',async t=>{
  const f=await fixture(t);await receiptHistory(f,{latest:'verified'});const key=`workagent-google:owner:${f.props.work.id}`;
  f.storage.setItem(key,JSON.stringify({version:'pending',message:'Request interrupted before response',pending:{path:'/exchange/google/doc-deliver',input:{operationId:'not-admitted',previewId:'not-admitted-preview'}}}));
  const view=f.mount();await view.flush();await view.click('Refresh connection and receipts');
  assert.match(f.notices.at(-1),/Unresolved Google action retained/);assert.doesNotMatch(f.notices.at(-1),/Readback verified/);
  assert.equal(JSON.parse(f.storage.getItem(key)).pending.input.operationId,'not-admitted');assert.ok(f.calls.every(c=>c.input===undefined));view.dispose();
});
test('receipt order: a later explicit success and a new preview never hide an earlier unknown action',async t=>{
  const f=await fixture(t);await receiptHistory(f);let view=f.mount();await view.flush();
  await view.click('Preview plain-text Google Doc');assert.match(f.notices.at(-1),/aa_current.*unknown outcome/);
  await view.click('Confirm simulated Google Doc delivery');assert.match(f.notices.at(-1),/Readback verified/);assert.match(f.notices.at(-1),/aa_current.*unknown outcome/);
  const key=`workagent-google:owner:${f.props.work.id}`,verified=JSON.parse(f.storage.getItem(key)).receipt.operationId,writes=f.service.writes().length,start=f.calls.length;
  await view.click('Refresh connection and receipts');view.dispose();view=f.mount();await view.flush();
  assert.equal(JSON.parse(f.storage.getItem(key)).receipt.operationId,verified);assert.match(f.notices.at(-1),/aa_current.*unknown outcome/);
  assert.ok(f.calls.slice(start).every(c=>c.input===undefined));assert.equal(f.service.writes().length,writes);view.dispose();
});

test('receipt continuity: returned history survives preview refusal, account changes and failed remount reads within its principal/work',async t=>{
  let failReads=false;
  const f=await fixture(t,async(path,_input,fn)=>{if(failReads&&path.includes('/state'))throw new Error('receipt read unavailable');return fn();});
  let view=f.mount();await view.flush();
  f.service.sim.faults.push({path:'/v1/documents',disconnectAfter:true});
  await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');
  const key=`workagent-google:owner:${f.props.work.id}`,unknown=JSON.parse(f.storage.getItem(key)).receipt;
  await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');
  const check=()=>assert.match(f.notices.at(-1),new RegExp(unknown.operationId+'.*unknown outcome'));
  check();assert.equal(f.calls.filter(c=>c.path.includes('/state')).length,1);
  const rich=blankDocument(f.props.work.id,'Newer draft','Keep this rich draft');rich.body.textRuns=[{st:0,ed:4,ts:{bl:1}}];f.setValue(rich);
  await view.click('Preview plain-text Google Doc');assert.match(f.notices.at(-1),/Delivery refused/);check();
  view.find(n=>n.props['aria-label']==='Simulated Google account').props.onChange({target:{value:'bob'}});await view.flush();check();
  await view.click('Disconnect simulation');check();
  const start=f.calls.length;failReads=true;view.dispose();view=f.mount();await view.flush();check();assert.match(f.notices.at(-1),/receipt read unavailable/);
  assert.equal(JSON.parse(f.storage.getItem(key)).receipts.length,2);
  await view.update({principal:'peer'});assert.doesNotMatch(f.notices.at(-1),/unknown outcome|Readback verified/);
  await view.update({principal:'owner',work:{...f.props.work,id:'another-work'}});assert.doesNotMatch(f.notices.at(-1),/unknown outcome|Readback verified/);
  await view.update({work:f.props.work});check();
  assert.deepEqual(f.native.save(),rich);assert.ok(f.calls.slice(start).every(c=>c.input===undefined));
  assert.equal(f.calls.filter(c=>c.path.endsWith('doc-deliver')).length,2);assert.equal(f.service.writes().length,3);view.dispose();
});

test('receipt continuity: authoritative readback replaces the same-operation unknown but retains a different unknown',async t=>{
  const f=await fixture(t),gate=held();let view=f.mount();await view.flush();
  f.service.sim.faults.push({path:'/v1/documents',disconnectAfter:true});
  await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');
  const key=`workagent-google:owner:${f.props.work.id}`,earlier=JSON.parse(f.storage.getItem(key)).receipt;
  const fetchFixture=globalThis.fetch;let dispatchHeld=false;
  // Hold the actual handler-backed create after its durable dispatch intent.
  // The second mount sees a genuine in-flight unknown, then genuine readback.
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(new URL(url).pathname==='/v1/documents'&&options.method==='POST'){dispatchHeld=true;await gate.promise;}
    return fetchFixture(url,options);
  });
  try {
    await view.click('Preview plain-text Google Doc');await view.click('Confirm simulated Google Doc delivery');assert.equal(dispatchHeld,true);
    const pending=JSON.parse(f.storage.getItem(key)).pending.input.operationId;
    view.dispose();const newer=blankDocument(f.props.work.id,'Local newer title','Local newer text');f.setValue(newer);
    view=f.mount();await view.flush();assert.match(f.notices.at(-1),/Unverified Google actions \(2\)/);
    assert.equal(JSON.parse(f.storage.getItem(key)).receipt.operationId,pending);
    const start=f.calls.length;gate.resolve();await view.flush();await view.click('Refresh connection and receipts');
    const saved=JSON.parse(f.storage.getItem(key));
    assert.equal(saved.receipt.operationId,pending);assert.equal(saved.receipt.outcome,'verified');
    assert.equal(saved.receipts.filter(r=>r.operationId===pending).length,1);assert.equal(saved.receipts.find(r=>r.operationId===pending).outcome,'verified');
    assert.match(f.notices.at(-1),/Unverified Google actions \(1\)/);assert.match(f.notices.at(-1),new RegExp(earlier.operationId+'.*unknown outcome'));
    assert.doesNotMatch(f.notices.at(-1),new RegExp(pending+'.*unknown outcome'));
    assert.ok(f.calls.slice(start).every(c=>c.input===undefined));assert.deepEqual(f.native.save(),newer);
    view.dispose();view=f.mount();await view.flush();assert.match(f.notices.at(-1),/Unverified Google actions \(1\)/);
    assert.equal(f.service.writes().length,3);assert.equal(f.calls.filter(c=>c.path.endsWith('doc-deliver')).length,2);
  } finally {gate.resolve();view.dispose();}
});
