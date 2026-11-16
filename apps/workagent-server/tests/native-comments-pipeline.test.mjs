// Real pinned native service/OT/middleware with an in-memory implementation of
// public IDatabaseAdapter. No SQLite/Postgres, sockets or persistence proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UnitSnapshotMaterializer, UniverCollabService } from '@univerjs-pro/collaboration-service';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { NativeAuthority, NATIVE_UNIT as UNIT } from '../src/native-collaboration.mjs';
import { NativeComments, ADD_COMMENT, DELETE_COMMENT, RESOLVE_COMMENT } from '../src/native-comments.mjs';
import { blank } from './native-comments-sdk.test.mjs';
async function fixture() {
  let state=initialState('owner'),tail=Promise.resolve(),unit,snapshot,changesets=[],blocks=[];
  state.nativeQualification={storage:{pairID:'pair',purpose:'workagent-native-workspace'}};
  state.works[UNIT]={id:UNIT,kind:'native-sheet',nativeCollaboration:true,status:'ready',accessRevision:1,acl:{peer:'editor'},nativeIdentity:{version:1,workspace:'owner',unitID:UNIT,pairID:'pair',owners:{}}};
  const store={read:async fn=>structuredClone(await fn(structuredClone(state))),transaction(fn){const p=tail.then(async()=>{const copy=structuredClone(state),result=await fn(copy);state=copy;return structuredClone(result);});tail=p.catch(()=>{});return p;}};
  const db={
    getUnit:async()=>structuredClone(unit??null),getSnapshotInfo:async()=>snapshot?{unitID:UNIT,type:2,rev:snapshot.rev}:null,getSnapshot:async()=>structuredClone(snapshot??null),
    getSheetBlock:async(_c,_u,id)=>structuredClone(blocks.find(b=>b.id===id)??null),
    getChangesets:async(_c,_u,{from,to=Infinity})=>structuredClone(changesets.filter(c=>c.revision>from&&c.revision<=to)),
    createUnit:async(_c,input)=>{unit=structuredClone(input.record);snapshot=structuredClone(input.snapshot);blocks=structuredClone(input.sheetBlocks??[]);return {status:'created',record:unit};},
    saveSnapshot:async(_c,input)=>{snapshot=structuredClone(input.snapshot);blocks=structuredClone(input.sheetBlocks??[]);},
    commitChangeset:async(_c,{changeset})=>{if(changeset.revision!==unit.headRevision+1)return {status:'revision-mismatch',actualHeadRevision:unit.headRevision};changesets.push(structuredClone(changeset));unit.headRevision=changeset.revision;return {status:'committed',changeset,headRevision:unit.headRevision};},
  };
  const workspace=new Workspace(store,{peers:[{id:'peer',name:'Peer'}],nativeEnabled:true}),authority=new NativeAuthority(workspace);
  const service=new UniverCollabService({dbAdapter:db,enableUnitPermissionAnalysis:true,runtime:{execution:{mode:'in-process'}}});
  const comments=new NativeComments(authority,service,db);authority.comments=comments;authority.install(service,{use(){},on(){}});
  const session={userID:'owner',unitID:UNIT,revision:1,binding:'binding'};authority.sessions.set('m',session);
  const initial=blank(UNIT);initial.sheets['sheet-1'].cellData={};
  await authority.scope.run({creating:true},()=>service.createUnitFromData({type:2,data:initial},{userID:'owner'}));
  let reqId=0;
  const submit=(mutations,baseRev=unit.headRevision)=>service.submitChangeset({changeset:{unitID:UNIT,type:2,baseRev,revision:baseRev+1,userID:'owner',memberID:'m',sid:'comment-sid',reqId:++reqId,mutations:mutations.map(([id,p])=>({id,data:JSON.stringify({unitId:UNIT,subUnitId:'sheet-1',...p})}))}},{userID:'owner',memberID:'m'});
  const submitAs=(principal,member,mutations,baseRev=unit.headRevision)=>service.submitChangeset({changeset:{unitID:UNIT,type:2,baseRev,revision:baseRev+1,userID:principal,memberID:member,sid:'sid-'+member,reqId:++reqId,mutations:mutations.map(([id,p])=>({id,data:JSON.stringify({unitId:UNIT,subUnitId:'sheet-1',...p})}))}},{userID:principal,memberID:member});
  const claim=async(id='root')=>{let comment;await comments.claim('owner','Owner',UNIT,session,{id,ref:'H9',body:'Immutable'},v=>comment=v);return comment;};
  const list=async(pendingID,principal='owner',epoch=1)=>{let result;await comments.list(principal,UNIT,{userID:principal,unitID:UNIT,revision:epoch,binding:'binding'},v=>result=v,pendingID);return result;};
  const checkpoint = async revision => {
    // In-memory adapter fixture of an aged native snapshot, not 4,097 executed edits.
    const materializer = new UnitSnapshotMaterializer({execution:{mode:'in-process'}});
    try { const loaded=await authority.scope.run({unitID:UNIT,session},()=>service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision:0},{userID:'owner'}));const head=await materializer.materializeSnapshot(loaded);snapshot=head.snapshot;snapshot.rev=revision;blocks=[...head.sheetBlocks];unit.headRevision=revision; }finally{await materializer.dispose();}
  };
  return {service,db,comments,authority,workspace,store,claim,submit,submitAs,list,session,checkpoint,get head(){return unit.headRevision;},get changesets(){return changesets;}};
}
test('real service pipeline rejects deterministic incomplete structural deletion without retry, while adapter failure stays retryable',async()=>{
  const f=await fixture();try{
    const root=await f.claim();assert.equal((await f.submit([[ADD_COMMENT,{comment:root}]])).status,'committed');
    const range={startRow:8,endRow:8,startColumn:0,endColumn:25};
    const refused=await f.submit([['sheet.mutation.remove-rows',{range}]]);assert.equal(refused.status,'rejected',JSON.stringify(refused));assert.equal(refused.error.retryable,false);assert.equal(f.head,2);
    const checkHead=f.comments.current;f.comments.current=async()=>{throw new Fault('native_comment_head_changed');};
    const race=await f.submit([['sheet.mutation.remove-rows',{range}],[DELETE_COMMENT,{commentId:root.id}]]);assert.equal(race.status,'retry');assert.equal(race.error.code,'REVISION_MISMATCH');assert.equal(race.error.retryable,true);f.comments.current=checkHead;
    const original=f.db.commitChangeset;f.db.commitChangeset=async()=>{throw Error('simulated unknown adapter failure');};
    const unknown=await f.submit([['sheet.mutation.set-range-values',{cellValue:{0:{0:{v:2}}}}]]);assert.equal(unknown.status,'retry');assert.equal(unknown.error.retryable,true);f.db.commitChangeset=original;
  }finally{await f.service.dispose();}
});
test('own committed-then-removed disposition comes from actual native history; foreign/unbound/epoch/hash absence stays unknown',async()=>{
  const f=await fixture();try{
    const root=await f.claim();assert.equal((await f.list(root.id)).receipt?.status,'unknown');
    assert.equal((await f.submit([[ADD_COMMENT,{comment:root}]])).status,'committed');
    assert.equal((await f.submit([['sheet.mutation.remove-rows',{range:{startRow:8,endRow:8,startColumn:0,endColumn:25}}],[DELETE_COMMENT,{commentId:root.id}]])).status,'committed');
    const result=await f.list(root.id);assert.deepEqual(result.comments,[]);assert.deepEqual(result.receipt,{id:root.id,status:'committed-removed',revision:2});
    assert.equal((await f.list(root.id,'peer')).receipt.status,'unknown');
    assert.equal((await f.list('unbound')).receipt.status,'unknown');
    const original=f.db.getChangesets;f.db.getChangesets=async(c,u,range)=>range.to===2?[]:original(c,u,range);assert.equal((await f.list(root.id)).receipt.status,'unknown');f.db.getChangesets=original;
    await f.store.transaction(s=>s.works[UNIT].nativeCommentClaims[root.id].attempt.hash='wrong');assert.equal((await f.list(root.id)).receipt.status,'unknown');
    await f.workspace.share('owner',UNIT,{commandId:'epoch',peer:'peer',role:'read',accessRevision:1});await assert.rejects(f.list(root.id),/denied/);assert.equal((await f.list(root.id,'owner',2)).receipt.status,'unknown');
  }finally{await f.service.dispose();}
});

// Actual public service commit/materialization/history, with in-memory stores.
test('resolution/reopening commits only state; exact receipt, immutable bodies, authority and stale head fences',async()=>{
 const f=await fixture();try{
  const root=await f.claim();await f.submit([[ADD_COMMENT,{comment:root}]]);
  const original=await f.store.read(s=>s.works[UNIT].nativeCommentClaims.root.comment);
  const prepare=async(id,resolved,principal='owner',session=f.session)=>{let result;await f.comments.prepareAction(principal,UNIT,session,{id,commentId:'root',memberID:principal==='owner'?'m':'peer',resolved},r=>result=r);return result;};
  f.authority.sessions.set('peer',{userID:'peer',unitID:UNIT,revision:1,binding:'binding'});
  await assert.rejects(prepare('foreign',true,'peer',{userID:'peer',unitID:UNIT,revision:1,binding:'binding'}),/refused/);
  await assert.rejects(prepare('epoch',true,'owner',{...f.session,revision:2}),/denied/);
  await prepare('resolve',true);await prepare('resolve',true);
  await assert.rejects(prepare('resolve',false),/id_conflict/);
  assert.equal((await f.list()).comments[0].resolved,false);
  const result=await f.submit([[RESOLVE_COMMENT,{commentId:'root',resolved:true,trigger:'thread-comment.command.resolve-comment'}]]);
  assert.equal(result.status,'committed',JSON.stringify(result));
  const list=await f.list();assert.equal(list.comments[0].resolved,true);assert.equal(list.actions[0].status,'committed');assert.equal(list.actions[0].revision,3);
  assert.deepEqual(await f.store.read(s=>s.works[UNIT].nativeCommentClaims.root.comment),original);
  assert.equal((await f.submit([[RESOLVE_COMMENT,{commentId:'root',resolved:false}]])).status,'rejected');
  await prepare('reopen',false);assert.equal((await f.submit([[RESOLVE_COMMENT,{commentId:'root',resolved:false}]])).status,'committed');
  assert.equal((await f.list()).comments[0].resolved,false);
  await prepare('stale',true);
  // Use a guaranteed native value revision to invalidate the pinned preparation.
  await f.submit([['sheet.mutation.set-range-values',{cellValue:{0:{0:{v:7}}}}]]);
  const head=f.head;assert.equal((await f.submit([[RESOLVE_COMMENT,{commentId:'root',resolved:true}]],4)).status,'rejected');assert.equal(f.head,head);
  assert.equal((await f.list()).actions.find(a=>a.id==='stale').status,'unknown');
  await f.workspace.share('owner',UNIT,{commandId:'read',peer:'peer',role:'read',accessRevision:1});
  await assert.rejects(prepare('old',true),/denied/);await assert.rejects(prepare('reader',true,'peer',{userID:'peer',unitID:UNIT,revision:2,binding:'binding'}),/denied/);
 }finally{await f.service.dispose();}
});

test('aged snapshot: unused preparations create no history dependency; exact committed proof survives beyond 4096',async()=>{
 for(const commit of [false,true]){const f=await fixture();try{
  const root=await f.claim();await f.submit([[ADD_COMMENT,{comment:root}]]);
  await f.comments.prepareAction('owner',UNIT,f.session,{id:'old',commentId:'root',memberID:'m',resolved:true},()=>{});
  if(commit)assert.equal((await f.submit([[RESOLVE_COMMENT,{commentId:'root',resolved:true}]])).status,'committed');
  await f.checkpoint(5000);const ranges=[],read=f.db.getChangesets;f.db.getChangesets=async(c,u,r)=>{ranges.push(r);return read(c,u,r);};
  const list=await f.list();assert.equal(list.comments[0].resolved,commit);assert.ok(ranges.filter(r=>r.from<4999).every(r=>r.from===2&&r.to===3));
  await f.claim('new-comment');assert.equal(f.head,5000);
  if(commit){f.db.getChangesets=async(c,u,r)=>r.from===2&&r.to===3?[]:read(c,u,r);const uncertain=await f.list();assert.equal(uncertain.comments[0].resolutionUnknown,true);assert.equal(uncertain.comments[0].resolved,undefined);await f.claim('another');await assert.rejects(f.comments.prepareAction('owner',UNIT,f.session,{id:'conflicting',commentId:'root',memberID:'m',resolved:false},()=>{}));}
 }finally{await f.service.dispose();}}
});
test('explicit never-admitted abandonment retains evidence and fences late native admission',async()=>{
 const f=await fixture();try{
  const root=await f.claim();await f.submit([[ADD_COMMENT,{comment:root}]]);const input={id:'unused',commentId:'root',memberID:'m',resolved:true};
  await f.comments.prepareAction('owner',UNIT,f.session,input,()=>{});const original=await f.store.read(s=>s.works[UNIT].nativeCommentActions.unused);
  let receipt;await f.comments.abandonAction('owner',UNIT,f.session,'unused',r=>receipt=r);assert.equal(receipt.status,'abandoned');
  await f.comments.abandonAction('owner',UNIT,f.session,'unused',()=>{});
  const retained=await f.store.read(s=>s.works[UNIT].nativeCommentActions.unused);assert.deepEqual({...retained,abandoned:undefined},{...original,abandoned:undefined});assert.equal(retained.abandoned,true);
  assert.equal((await f.submit([[RESOLVE_COMMENT,{commentId:'root',resolved:true}]])).status,'rejected');assert.equal(f.head,2);
 }finally{await f.service.dispose();}
});

test('abandonment/admission serialize; fresh-member explicit retry commits while old tuple remains fenced',async()=>{
 const f=await fixture();try{
  const root=await f.claim();await f.submit([[ADD_COMMENT,{comment:root}]]);const input={id:'unused',commentId:'root',memberID:'m',resolved:true};
  await f.comments.prepareAction('owner',UNIT,f.session,input,()=>{});
  for(const session of [{...f.session,binding:'wrong'},{...f.session,revision:2}])await assert.rejects(f.comments.abandonAction('owner',UNIT,session,'unused',()=>{}));
  await assert.rejects(f.comments.abandonAction('peer',UNIT,{...f.session,userID:'peer'},'unused',()=>{}));
  f.authority.sessions.delete('m');await f.comments.abandonAction('owner',UNIT,f.session,'unused',()=>{});
  f.authority.sessions.set('m',f.session);await assert.rejects(f.comments.prepareAction('owner',UNIT,f.session,{...input,id:'replacement'},()=>{}));
  f.authority.sessions.set('fresh',f.session);await f.comments.prepareAction('owner',UNIT,f.session,{...input,id:'new-explicit',memberID:'fresh'},()=>{});
  assert.equal((await f.submit([[RESOLVE_COMMENT,{commentId:'root',resolved:true}]])).status,'rejected');
  let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);f.service.use('submitChangeset',async(_c,next)=>{enter();await gate;await next();});
  const pending=f.submitAs('owner','fresh',[[RESOLVE_COMMENT,{commentId:'root',resolved:true}]]);await entered;
  try{await assert.rejects(f.comments.abandonAction('owner',UNIT,f.session,'new-explicit',()=>{}));}finally{release();}
  assert.equal((await pending).status,'committed');assert.equal(f.head,3);assert.equal((await f.list()).comments[0].resolved,true);
 }finally{await f.service.dispose();}
});
test('root-author editor may resolve; other editor/read/epoch and commit-time ACL/head changes remain fenced',async()=>{
 const f=await fixture();try{
  const peer={userID:'peer',unitID:UNIT,revision:1,binding:'binding'};f.authority.sessions.set('peer',peer);
  let root;await f.comments.claim('peer','Peer',UNIT,peer,{id:'peer-root',ref:'H9',body:'Peer immutable'},r=>root=r);assert.equal((await f.submitAs('peer','peer',[[ADD_COMMENT,{comment:root}]])).status,'committed');
  await f.comments.prepareAction('peer',UNIT,peer,{id:'own',commentId:root.id,memberID:'peer',resolved:true},()=>{});assert.equal((await f.submitAs('peer','peer',[[RESOLVE_COMMENT,{commentId:root.id,resolved:true}]])).status,'committed');assert.equal((await f.list()).comments[0].resolved,true,'owner projection verifies other author native receipt');
  await f.comments.prepareAction('peer',UNIT,peer,{id:'reopen',commentId:root.id,memberID:'peer',resolved:false},()=>{});
  const prepare=f.comments.prepare;f.comments.prepare=async(...args)=>{const view=await prepare.apply(f.comments,args);await f.workspace.share('owner',UNIT,{commandId:'downgrade',peer:'peer',role:'read',accessRevision:1});return view;};
  const head=f.head;assert.notEqual((await f.submitAs('peer','peer',[[RESOLVE_COMMENT,{commentId:root.id,resolved:false}]])).status,'committed');assert.equal(f.head,head);
  f.comments.prepare=prepare;await assert.rejects(f.comments.abandonAction('peer',UNIT,{...peer,revision:2},'reopen',()=>{}));
 }finally{await f.service.dispose();}
});
