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

test('author text versions: exact native commit publishes root/reply edits, immutable originals and bounded receipt proof',async()=>{
 const {UPDATE_COMMENT}=await import('../src/native-comment-editing.mjs');const f=await fixture();try{
  const root=await f.claim();await f.submit([[ADD_COMMENT,{comment:root}]]);
  const peer={userID:'peer',unitID:UNIT,revision:1,binding:'binding'};f.authority.sessions.set('peer',peer);
  let reply;await f.comments.claim('peer','Peer',UNIT,peer,{id:'reply',parentId:'root',ref:'H9',body:'Peer original'},c=>reply=c);await f.submitAs('peer','peer',[[ADD_COMMENT,{comment:reply}]]);
  const original=await f.store.read(s=>s.works[UNIT].nativeCommentClaims);
  const input={id:'edit-root',commentId:'root',memberID:'m',previousVersion:'original',body:'Owner revised'};
  await assert.rejects(f.comments.editing.prepare('peer',UNIT,peer,{...input,memberID:'peer'},()=>{}));
  await assert.rejects(f.comments.editing.prepare('owner',UNIT,f.session,{...input,commentId:'reply'},()=>{}));
  await f.comments.editing.prepare('owner',UNIT,f.session,input,()=>{});await f.comments.editing.prepare('owner',UNIT,f.session,input,()=>{});
  await assert.rejects(f.comments.editing.prepare('owner',UNIT,f.session,{...input,body:'different'},()=>{}));
  assert.equal((await f.list()).comments[0].text.dataStream,root.text.dataStream);
  const mutation=a=>[UPDATE_COMMENT,{payload:{commentId:a.commentId,text:{dataStream:a.body+'\r\n',paragraphs:[{startIndex:a.body.length}]}}}];
  assert.equal((await f.submit([mutation(input)])).status,'committed');
  let list=await f.list();assert.equal(list.comments[0].text.dataStream,'Owner revised\r\n');assert.equal(list.comments[0].bodyVersion,input.id);assert.equal(list.edits[0].status,'committed');
  const child={id:'edit-reply',commentId:'reply',memberID:'peer',previousVersion:'original',body:'Peer revised'};
  await f.comments.editing.prepare('peer',UNIT,peer,child,()=>{});assert.equal((await f.submitAs('peer','peer',[mutation(child)])).status,'committed');
  list=await f.list();assert.equal(list.comments[0].children[0].text.dataStream,'Peer revised\r\n');assert.equal(list.comments[0].children[0].dT,reply.dT);assert.equal(list.comments[0].ref,'H9');
  assert.deepEqual(await f.store.read(s=>s.works[UNIT].nativeCommentClaims),original);
  await f.checkpoint(5000);assert.equal((await f.list()).comments[0].text.dataStream,'Owner revised\r\n');
  const read=f.db.getChangesets;f.db.getChangesets=async(c,u,r)=>r.from===3?[]:read(c,u,r);list=await f.list();assert.equal(list.comments[0].bodyUnknown,true);assert.equal(list.comments[0].text.dataStream,'');assert.equal(list.comments[0].children[0].text.dataStream,'Peer revised\r\n');await f.claim('ordinary-new');
  await assert.rejects(f.comments.editing.prepare('owner',UNIT,f.session,{...input,id:'cannot-guess',previousVersion:'edit-root',body:'next'},()=>{}));
 }finally{await f.service.dispose();}
});
test('text edits: abandoned identity fences late use; admitted unknown, stale native head and revoked epoch never become new body',async()=>{
 const {UPDATE_COMMENT}=await import('../src/native-comment-editing.mjs');const f=await fixture();try{
  await f.submit([[ADD_COMMENT,{comment:await f.claim()}]]);
  const input={id:'unused-edit',commentId:'root',memberID:'m',previousVersion:'original',body:'new'};
  const mutation=[UPDATE_COMMENT,{payload:{commentId:'root',text:{dataStream:'new\r\n',paragraphs:[{startIndex:3}]}}}];
  await f.comments.editing.prepare('owner',UNIT,f.session,input,()=>{});await f.comments.editing.abandon('owner',UNIT,f.session,input.id,()=>{});await f.comments.editing.abandon('owner',UNIT,f.session,input.id,()=>{});
  assert.equal((await f.submit([mutation])).status,'rejected');assert.equal(f.head,2);
  await assert.rejects(f.comments.editing.prepare('owner',UNIT,f.session,{...input,id:'quarantine'},()=>{}));
  f.authority.sessions.set('fresh',{...f.session});await f.comments.editing.prepare('owner',UNIT,f.session,{...input,id:'fresh-edit',memberID:'fresh'},()=>{});
  await f.submit([['sheet.mutation.set-range-values',{cellValue:{0:{0:{v:71}}}}]]);
  assert.equal((await f.submitAs('owner','fresh',[mutation],2)).status,'rejected');
  await assert.rejects(f.comments.editing.abandon('owner',UNIT,f.session,'fresh-edit',()=>{}));
  const list=await f.list();assert.equal(list.comments[0].bodyUnknown,true);assert.equal(list.edits.find(e=>e.id==='fresh-edit').status,'unknown');
  await f.workspace.share('owner',UNIT,{commandId:'read-edit',peer:'peer',role:'read',accessRevision:1});
  await assert.rejects(f.comments.editing.prepare('owner',UNIT,f.session,{...input,id:'revoked'},()=>{}));
  assert.equal(f.head,3);
 }finally{await f.service.dispose();}
});

test('edit pre-prepare refusal explicitly settles exact unused input; late prepare/mutation cannot revive it',async()=>{
 const {UPDATE_COMMENT}=await import('../src/native-comment-editing.mjs');const f=await fixture();try{
  await f.submit([[ADD_COMMENT,{comment:await f.claim()}]]);const input={id:'stale-body',commentId:'root',memberID:'m',previousVersion:'unknown-prior',body:'Draft retained'};
  await assert.rejects(f.comments.editing.prepare('owner',UNIT,f.session,input,()=>{}));assert.equal((await f.list()).edits.length,0);
  let r;await f.comments.editing.abandon('owner',UNIT,f.session,input.id,v=>r=v,input);assert.equal(r.status,'abandoned');const retained=await f.store.read(s=>s.works[UNIT].nativeCommentEdits[input.id]);assert.deepEqual(retained.input,input);
  await f.comments.editing.prepare('owner',UNIT,f.session,input,v=>r=v);assert.equal(r.status,'abandoned');
  const mutation=[UPDATE_COMMENT,{payload:{commentId:'root',text:{dataStream:input.body+'\r\n',paragraphs:[{startIndex:input.body.length}]}}}];assert.equal((await f.submit([mutation])).status,'rejected');assert.equal(f.head,2);
  await assert.rejects(f.comments.editing.abandon('owner',UNIT,f.session,input.id,()=>{},{...input,body:'different'}));
  const next={...input,id:'fresh-body',previousVersion:'original',body:'Explicit different edit'};await f.comments.editing.prepare('owner',UNIT,f.session,next,()=>{});
  await assert.rejects(f.comments.editing.abandon('peer',UNIT,{...f.session,userID:'peer'},'foreign',()=>{},{...next,id:'foreign'}));
 }finally{await f.service.dispose();}
});

test('edit unused settlement serializes with preparation; head-read refusal settles without poisoning another reserved native tuple',async()=>{
 const f=await fixture();try{
  await f.submit([[ADD_COMMENT,{comment:await f.claim()}]]);const a={id:'head-refused',commentId:'root',memberID:'m',previousVersion:'original',body:'After head refusal'};
  const current=f.comments.current;f.comments.current=async()=>{throw new Fault('native_comment_head_changed',409);};await assert.rejects(f.comments.editing.prepare('owner',UNIT,f.session,a,()=>{}));f.comments.current=current;
  assert.equal((await f.list()).edits.length,0);await f.comments.editing.abandon('owner',UNIT,f.session,a.id,()=>{},a);
  for(const bad of [{...f.session,binding:'wrong'},{...f.session,revision:2}])await assert.rejects(f.comments.editing.abandon('owner',UNIT,bad,'wrong-scope',()=>{},{...a,id:'wrong-scope'}));
  const next={...a,id:'next',body:'Distinct explicit draft'};await f.comments.editing.prepare('owner',UNIT,f.session,next,()=>{});const saved=await f.store.read(s=>s.works[UNIT].nativeCommentEdits.next);
  await assert.rejects(f.comments.editing.abandon('owner',UNIT,f.session,'poison',()=>{},{...next,id:'poison'}));assert.deepEqual(await f.store.read(s=>s.works[UNIT].nativeCommentEdits.next),saved);
  await f.comments.editing.abandon('owner',UNIT,f.session,next.id,()=>{},next);
  const raced={...a,id:'raced',body:'Raced unused draft'};let received;
  await Promise.all([f.comments.editing.abandon('owner',UNIT,f.session,raced.id,()=>{},raced),f.comments.editing.prepare('owner',UNIT,f.session,raced,r=>received=r)]);assert.equal(received.status,'abandoned');assert.equal(f.head,2);
  const retained=await f.store.read(s=>s.works[UNIT].nativeCommentEdits);assert.deepEqual(retained[a.id].input,a);assert.equal(retained[raced.id].abandoned,true);assert.equal(retained.poison,undefined);
 }finally{await f.service.dispose();}
});
