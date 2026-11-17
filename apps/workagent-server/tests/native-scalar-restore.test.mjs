// Production HTTP/endpoint/licensed public sessions over in-memory Duplex only.
// Imported acceptance registrations are excluded by the focused script pattern.
import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './native-agent-acceptance.test.mjs';
import {CollaborationEvent} from '@univerjs-pro/collaboration';
import {wait} from './native-undo-delivery-fixture.mjs';
import {UNIT} from './native-history-sdk.test.mjs';
import {fixture as localFixture} from './native-comments-sdk.test.mjs';
import {SetRangeValuesCommand} from '@univerjs/sheets';
import {IUniverInstanceService} from '@univerjs/core';
import {CompressMutationService} from '@univerjs-pro/collaboration';
const base=`/api/work/${UNIT}/native-scalar-restore/1`;
async function ready(s){s.native.authority.restore.enabled=true;const a=await s.open(),b=await s.open('peer');await s.edit(b,'peer',71,1);await s.edit(a,'owner',11,0,{t:2});const source=s.head;await s.edit(a,'owner',44,0,{t:2});return {a,b,source};}
const prepare=(s,a,source,id='restore-one')=>s.http(base,{commandId:id,memberID:a.memberID,sourceRevision:source,currentHead:s.head});
async function execute(s,id='restore-one'){
 const confirmed=await s.http(base+'/'+id+'/confirm',{});assert.equal(confirmed.status,200,JSON.stringify(confirmed));assert.equal(confirmed.data.phase,'confirmed');
 const executor=await s.open('owner',confirmed.data.actionPath),receipt=await s.http(base+'/'+id);assert.equal(receipt.data.phase,'executor-admitted');return {executor,receipt:receipt.data};
}
test('scalar restore public command/compression and actual licensed action append one revision with GET-only receipt',()=>fixture(async s=>{
 assert.equal((await s.http(base,{})).data.error,'native_restore_disabled');const {a,b,source}=await ready(s),before=await s.data(),head=s.head;
 const p=await prepare(s,a,source);assert.equal(p.status,200,JSON.stringify(p));assert.deepEqual(p.data.preview,{sheetID:'sheet-1',sourceRevision:source,nativeRevision:head,row:0,column:0,before:44,after:11});assert.equal(s.head,head);
 const local=localFixture(before);try{local.univer.__getInjector().get(IUniverInstanceService).focusUnit(UNIT);assert.equal(await local.commands.executeCommand(SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:'sheet-1',range:{startRow:0,endRow:0,startColumn:0,endColumn:0},value:{v:11,t:2}}),true);const compressor=new CompressMutationService();try{const m=compressor.interceptor.fetchThroughInterceptors(compressor.interceptor.getInterceptPoints().COMPRESS_MUTATION_SEND)(structuredClone(local.emitted),local.univer.__getInjector().get(IUniverInstanceService));assert.equal(m.length,1);assert.deepEqual(m[0].params.cellValue,{0:{0:{v:11,t:2}}});}finally{compressor.interceptor.dispose();}}finally{local.dispose();}
 const {executor,receipt}=await execute(s);assert.equal(s.native.authority.sessions.size,3);await s.submit(executor,receipt);await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK));
 assert.equal(s.head,head+1);await wait(()=>[a,b].every(c=>c.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===s.head)));
 const after=await s.data();assert.equal(after.sheets['sheet-1'].cellData[0][0].v,11);assert.equal(after.sheets['sheet-1'].cellData[0][1].v,71);assert.deepEqual(after.resources,before.resources);
 assert.equal((await s.http(base+'/restore-one')).data.disposition,'committed');await s.submit(executor,receipt);assert.equal(s.head,head+1);
 const retained=await s.store.read(x=>x.works[UNIT].nativeScalarRestores);assert.equal((await s.http(base+'/restore-one')).data.revision,head+1);assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeScalarRestores),retained);
}));
test('scalar restore explicit unused abandonment, owner scope, immutable target and strict unsupported/no-op refusal',()=>fixture(async s=>{
 const {a,b,source}=await ready(s),input={commandId:'unused',memberID:a.memberID,sourceRevision:source,currentHead:s.head};
 assert.equal((await s.http(base,input,'peer')).status,403);assert.equal((await s.http(base.replace('/1','/2'),input)).status,403);
 assert.equal((await s.http(base,{...input,diff:[]})).status,409);assert.equal((await s.http(base,{...input,memberID:b.memberID})).status,409);
 assert.equal((await s.http(base,input)).status,200);assert.equal((await s.http(base,{...input,commandId:'replacement'})).status,409);
 await a.close();assert.equal((await s.http(base+'/unused/abandon',{})).data.phase,'abandoned');assert.equal((await s.http(base,input)).data.phase,'abandoned');assert.equal((await s.http(base+'/unused/confirm',{})).status,409);
 const fresh=await s.open();assert.equal((await prepare(s,fresh,source,'fresh')).status,200);assert.equal((await s.http(base+'/fresh/confirm',{})).data.phase,'confirmed');assert.equal((await s.http(base+'/fresh/abandon',{})).status,409);
}));
test('scalar restore commit fence preserves intervening peer edit and retained unknown is never a replacement',()=>fixture(async s=>{
 const {a,b,source}=await ready(s);assert.equal((await prepare(s,a,source)).status,200);const {executor,receipt}=await execute(s);let release,reached;const gate=new Promise(r=>release=r),readyGate=new Promise(r=>reached=r);
 s.native.service.use('submitChangeset',async(c,next)=>{if(c.request.changeset.sid===receipt.request.sid){reached();await gate;}await next();});
 const pending=s.submit(executor,receipt);await readyGate;await s.edit(b,'peer',77,1);const head=s.head;release();await pending;await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.PERMISSION_REJ));
 assert.equal(s.head,head);assert.equal((await s.data()).sheets['sheet-1'].cellData[0][1].v,77);assert.equal((await s.http(base+'/restore-one')).data.disposition,'rejected');assert.equal((await s.http(base+'/restore-one/abandon',{})).status,409);
}));

import {scalarRestoreDiff} from '../src/native-scalar-restore.mjs';
import {blank} from './native-comments-sdk.test.mjs';
import {mergeWorksheetSnapshotWithDefault} from '@univerjs/core';
test('scalar restore snapshot policy preserves existing tabs/resources/styles and refuses no-op, metadata and multiple effects',()=>{
 const target=blank('snapshot-proof');target.rev=2;target.sheets['sheet-1'].cellData={0:{0:{v:11,t:2,s:{bl:1}}}};target.sheetOrder.push('second');target.sheets.second=mergeWorksheetSnapshotWithDefault({id:'second',name:'Second',cellData:{0:{0:{v:71}}}});target.resources=[{name:'SHEET_UNIVER_THREAD_COMMENT_PLUGIN',data:JSON.stringify({'sheet-1':[{id:'retained',ref:'H9'}]})}];
 const current=structuredClone(target);current.rev=3;current.sheets['sheet-1'].cellData[0][0].v=44;
 const originals=structuredClone([current,target]);const diff=scalarRestoreDiff(current,target,2,3);assert.deepEqual(diff.params.cellValue,{0:{0:{v:11,t:2}}});assert.deepEqual([current,target],originals);
 for(const change of [d=>d.sheets.second.cellData[0][0].v=72,d=>d.sheets.second.name='Other',d=>d.sheets['sheet-1'].cellData[0][0].s={bl:0},d=>d.sheets['sheet-1'].cellData[0][0].f='=1',d=>d.sheets['sheet-1'].cellData[0][1]={v:99},d=>d.resources=[],d=>d.sheets['sheet-1'].mergeData=[{startRow:0,endRow:0,startColumn:0,endColumn:1}]]){const bad=structuredClone(current);change(bad);assert.throws(()=>scalarRestoreDiff(bad,target,2,3));}
 const noop=structuredClone(target);noop.rev=3;assert.throws(()=>scalarRestoreDiff(noop,target,2,3),/native_restore_no_change/);
});
test('scalar restore no-op and stale epoch cannot reserve or mutate; confirmed departure remains retained',()=>fixture(async s=>{
 s.native.authority.restore.enabled=true;const a=await s.open();await s.edit(a,'owner',11,0,{t:2});const source=s.head;await s.edit(a,'owner',11,0,{t:2});const head=s.head;
 assert.equal((await prepare(s,a,source)).data.error,'native_restore_no_change');assert.equal(s.head,head);assert.equal(await s.store.read(x=>x.works[UNIT].nativeScalarRestores),undefined);
 await s.edit(a,'owner',44,0,{t:2});assert.equal((await prepare(s,a,source)).status,200);assert.equal((await s.http(base+'/restore-one/confirm',{})).data.phase,'confirmed');await a.close();
 assert.equal((await s.http(base+'/restore-one')).data.phase,'confirmed');assert.equal((await s.http(base+'/restore-one/abandon',{})).status,409);
 await s.workspace.share('owner',UNIT,{commandId:'restore-epoch',peer:'peer',role:'read',accessRevision:1});assert.equal((await s.http(base+'/restore-one')).status,403);
}));
test('scalar restore to empty value appends revision without deleting history',()=>fixture(async s=>{
 s.native.authority.restore.enabled=true;const a=await s.open();const source=s.head;await s.edit(a,'owner',44,0,{t:2});const head=s.head;
 const p=await prepare(s,a,source);assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.data.preview.after,null);const {executor,receipt}=await execute(s);await s.submit(executor,receipt);await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK));assert.equal(s.head,head+1);assert.equal((await s.data()).sheets['sheet-1'].cellData?.[0]?.[0]?.v??null,null);assert.equal((await s.http(base+'/restore-one')).data.disposition,'committed');
}));

test('scalar restore absent settlement is exact, durable, scoped and idempotent after a refused preparation',()=>fixture(async s=>{
 s.native.authority.restore.enabled=true;const a=await s.open();await s.edit(a,'owner',11,0,{t:2});const source=s.head;await s.edit(a,'owner',11,0,{t:2});
 const input={commandId:'refused-unused',memberID:a.memberID,sourceRevision:source,currentHead:s.head},head=s.head;
 assert.equal((await s.http(base,input)).data.error,'native_restore_no_change');assert.equal((await s.http(base+'/'+input.commandId)).data.error,'native_restore_identity');assert.equal(await s.store.read(x=>x.works[UNIT].nativeScalarRestores),undefined);
 const url=base+'/'+input.commandId+'/abandon';assert.equal((await s.http(url,input,'peer')).status,403);assert.equal((await s.http(url.replace('/1/','/2/'),input)).status,403);
 const settled=await s.http(url,input);assert.equal(settled.status,200);assert.equal(settled.data.phase,'abandoned');assert.deepEqual(settled.data.target,input);assert.equal(settled.data.preview,undefined);assert.equal(settled.data.request,undefined);
 const retained=await s.store.read(x=>structuredClone(x.works[UNIT].nativeScalarRestores));assert.deepEqual((await s.http(url,input)).data,settled.data);
 assert.equal((await s.http(url,{...input,memberID:'foreign'})).status,409);assert.equal((await s.http(url,{...input,currentHead:head+1})).status,409);
 assert.equal((await s.http(url,input,'owner',s.otherOwnerHeaders())).status,409);
 assert.equal((await s.http(base,input)).data.phase,'abandoned');assert.equal((await s.http(base+'/'+input.commandId+'/confirm',{})).status,409);
 assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeScalarRestores),retained);assert.equal(s.head,head);
 await s.edit(a,'owner',44,0,{t:2});assert.equal((await prepare(s,a,source,'explicit-fresh')).status,200);
}));
test('scalar restore absent abandonment serializes against late preparation finalization without native effect',()=>fixture(async s=>{
 const {a,source}=await ready(s),r=s.native.authority.restore,input={commandId:'held-preview',memberID:a.memberID,sourceRevision:source,currentHead:s.head},head=s.head;
 const original=r.materialize.bind(r);let release,reached,held=false;const gate=new Promise(x=>release=x),entered=new Promise(x=>reached=x);
 r.materialize=async(...args)=>{const result=await original(...args);if(!held){held=true;reached();await gate;}return result;};
 const pending=s.http(base,input);await entered;
 try{const settled=await s.http(base+'/'+input.commandId+'/abandon',input);assert.equal(settled.status,200);const retained=await s.store.read(x=>structuredClone(x.works[UNIT].nativeScalarRestores));release();const late=await pending;assert.equal(late.status,200);assert.deepEqual(late.data,settled.data);assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeScalarRestores),retained);assert.equal(s.head,head);
 assert.equal((await s.http(base+'/'+input.commandId+'/confirm',{})).status,409);
 // Reusing the old purpose cannot reach ticket/admission even with valid current authority.
 const session={revision:1};await assert.rejects(r.action('owner',UNIT,session,{kind:'scalar-restore',id:input.commandId,binding:retained[input.commandId].binding}));
 assert.equal((await prepare(s,a,source,'separate-preview')).status,200);
 }finally{release();await pending;r.materialize=original;}
}));
test('scalar restore full-input settlement cannot release confirmed or admitted identities',()=>fixture(async s=>{
 const {a,source}=await ready(s);assert.equal((await prepare(s,a,source)).status,200);assert.equal((await s.http(base+'/restore-one/confirm',{})).status,200);
 const input={commandId:'restore-one',memberID:a.memberID,sourceRevision:source,currentHead:s.head};const before=await s.store.read(x=>structuredClone(x.works[UNIT].nativeScalarRestores));assert.equal((await s.http(base+'/restore-one/abandon',input)).status,409);assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeScalarRestores),before);
 const receipt=(await s.http(base+'/restore-one')).data;await s.open('owner',receipt.actionPath);const admitted=await s.store.read(x=>structuredClone(x.works[UNIT].nativeScalarRestores));assert.equal((await s.http(base+'/restore-one/abandon',input)).status,409);assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeScalarRestores),admitted);
}));
