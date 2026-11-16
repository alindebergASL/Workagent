// Policy/concurrency tests with real Workspace and copied in-memory state; no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { NativeAuthority, NATIVE_UNIT as UNIT } from '../src/native-collaboration.mjs';
import { NativeComments, ADD_COMMENT, DELETE_COMMENT, nativeCommentView } from '../src/native-comments.mjs';
import { fixture as sdk, add as sdkAdd, remove as sdkRemove, resource } from './native-comments-sdk.test.mjs';
const TAB='sheet-1';
function fixture(){
  let state=initialState('owner'), tail=Promise.resolve(), revision=1, roots=[];
  state.nativeQualification={storage:{pairID:'pair',purpose:'workagent-native-workspace'}};
  state.works[UNIT]={id:UNIT,kind:'native-sheet',nativeCollaboration:true,status:'ready',accessRevision:1,acl:{peer:'editor'},nativeIdentity:{version:1,workspace:'owner',unitID:UNIT,pairID:'pair',owners:{}}};
  const store={read:async fn=>structuredClone(await fn(structuredClone(state))),transaction(fn){const operation=tail.then(async()=>{const copy=structuredClone(state),result=await fn(copy);state=copy;return structuredClone(result);});tail=operation.catch(()=>{});return operation;}};
  const workspace=new Workspace(store,{peers:[{id:'peer',name:'Peer'}],nativeEnabled:true}),authority=new NativeAuthority(workspace),hooks={};
  const comments=new NativeComments(authority,null,{getUnit:async()=>({headRevision:revision})});authority.comments=comments;
  comments.prepare=async()=>({revision,roots:structuredClone(roots),sheet:{rowCount:100,columnCount:26}});
  authority.install({use:(k,v)=>hooks[k]=v},{use(){},on(){}});
  const session={userID:'owner',unitID:UNIT,revision:1};authority.sessions.set('owner-member',session);
  const claim=async(input={},principal='owner',epoch=1)=>{let result;await comments.claim(principal,principal,UNIT,{userID:principal,unitID:UNIT,revision:epoch},{id:'root',ref:'H9',body:'Hello',...input},v=>result=v);return result;};
  const list=async(principal='peer',epoch=1)=>{let result;await comments.list(principal,UNIT,{userID:principal,unitID:UNIT,revision:epoch},v=>result=v);return result;};
  const context=(comment,reqId=1)=>{const changeset={unitID:UNIT,type:2,baseRev:revision,revision:revision+1,sid:'sid-owner',reqId,mutations:[{id:ADD_COMMENT,data:JSON.stringify({unitId:UNIT,subUnitId:TAB,comment})}]};return{userID:'owner',memberID:'owner-member',request:{changeset},changeset,requiredUnitPermissions:[]};};
  return {store,workspace,authority,comments,hooks,claim,list,context,session,get revision(){return revision;},publish:c=>{roots.push({...c,children:[]});revision++;},setRoots:v=>{roots=v;revision++;},advance:()=>revision++};
}
test('immutable prewrite is private, idempotent, actor/epoch bound; only native present IDs publish',async()=>{
  const f=fixture(),comment=await f.claim();assert.deepEqual(await f.claim(),comment);assert.deepEqual((await f.list()).comments,[]);
  await assert.rejects(f.claim({body:'changed'}),/conflict/);await assert.rejects(f.claim({},'peer'),/conflict/);
  await assert.rejects(f.claim({personId:'peer'}),/refused/);await assert.rejects(f.claim({},'owner',2),/denied/);
  f.publish(comment);assert.equal((await f.list()).comments[0].text.dataStream,'Hello\r\n');
  f.setRoots([]);assert.deepEqual((await f.list()).comments,[]);assert.ok((await f.store.read(s=>s.works[UNIT].nativeCommentClaims)).root);
  assert.equal((await f.workspace.get('owner',UNIT,true)).nativeCommentClaims,undefined);
});
test('durable first attempt binds exact SID/reqId/body before native commit; retries cannot steal/resurrect',async()=>{
  const f=fixture(),comment=await f.claim(),c=f.context(comment);let commits=0;
  await f.hooks.submitChangeset(c,async()=>{});await f.hooks.submitChangeset(c,async()=>{});
  await assert.rejects(f.hooks.submitChangeset(f.context(comment,2),async()=>{}),/request_reuse/);
  const forged=f.context({...comment,personId:'peer'});await assert.rejects(f.hooks.submitChangeset(forged,async()=>{}),/claim_mismatch/);
  await f.hooks.commitChangeset(c,async()=>{commits++;});assert.equal(commits,1);f.publish(comment);
  f.setRoots([]);await assert.rejects(f.claim(),/attempt_retained/);
  await assert.rejects(f.hooks.commitChangeset(c,async()=>{commits++;}),/stale_anchor/);assert.equal(commits,1);
});
test('reply requires published root; stale anchors, deleted roots, readers and regrant refuse',async()=>{
  const f=fixture();await assert.rejects(f.claim({id:'reply',parentId:'root'}),/root_absent/);
  const root=await f.claim();f.publish(root);const reply=await f.claim({id:'reply',parentId:'root'},'peer');assert.equal(reply.parentId,'root');
  const c=f.context(root);f.advance();await f.hooks.submitChangeset(c,async()=>{});await assert.rejects(f.hooks.commitChangeset(c,async()=>{}),/stale_anchor/);
  await f.workspace.share('owner',UNIT,{commandId:'share',peer:'peer',role:'read',accessRevision:1});
  await assert.rejects(f.claim({id:'reader'},'peer',2),/denied/);await assert.rejects(f.list('peer',1),/denied/);
  assert.equal((await f.list('peer',2)).comments.length,1);
});
test('revocation/head change between prepared native read and enqueue refuses without nested transaction',async()=>{
  const f=fixture(),original=f.comments.prepare;let enqueued=false;
  f.comments.prepare=async(...a)=>{const v=await original(...a);await f.workspace.share('owner',UNIT,{commandId:'revoke',peer:'peer',role:null,accessRevision:1});return v;};
  await assert.rejects(f.comments.list('peer',UNIT,{userID:'peer',revision:1},()=>enqueued=true),/denied/);assert.equal(enqueued,false);
  const g=fixture(),freshPrepare=g.comments.prepare;
  g.comments.prepare=async(...a)=>{const v=await freshPrepare(...a);g.advance();return v;};
  await assert.rejects(g.list('owner'),/head_changed/);
});
test('actual native row-delete batch passes; bare deletion, extra thread deletion and mixed edits refuse',async()=>{
  const local=sdk();try{
    await sdkAdd(local,'root','owner');await sdkAdd(local,'reply','peer','root');
    const view=nativeCommentView(local.save(),1),emitted=await sdkRemove(local); // remove row9 does not hit H9; choose actual row8 below
    const {RemoveRowCommand}=await import('@univerjs/sheets');
    const start=local.emitted.length;await local.commands.executeCommand(RemoveRowCommand.id,{unitId:local.unitID,subUnitId:TAB,range:{startRow:8,endRow:8,startColumn:0,endColumn:25}});
    const mutations=local.emitted.slice(start).filter(m=>!m.options.onlyLocal).map(m=>({id:m.id,data:JSON.stringify(m.params)}));
    assert.deepEqual(mutations.map(m=>m.id),['sheet.mutation.remove-rows',DELETE_COMMENT]);
    const f=fixture(),c={request:{changeset:{baseRev:1}},changeset:{unitID:UNIT,mutations}};
    f.comments.validate({works:{[UNIT]:{}}},c,view);
    for(const wrong of [mutations.slice(0,1),mutations.slice(1),[...mutations,mutations[1]],[...mutations,{id:'sheet.mutation.set-range-values',data:'{}'}]])assert.throws(()=>f.comments.validate({works:{[UNIT]:{}}},{...c,changeset:{unitID:UNIT,mutations:wrong}},view));
    assert.equal(local.model.getComment(local.unitID,TAB,'root'),undefined);
    assert.equal(local.model.getComment(local.unitID,TAB,'reply'),undefined);
    const reopened=sdk(local.save());try{assert.equal(reopened.model.getThread(reopened.unitID,TAB,'root'),undefined);assert.equal(reopened.model.getComment(reopened.unitID,TAB,'reply'),undefined);}finally{reopened.dispose();}
    assert.ok(emitted.length);
  }finally{local.dispose();}
});

test('permission query grants Comment only to enabled workspace owner/editor, never reader/foreign unit or qualification',async()=>{
  const {nativeRequest}=await import('../src/native-workspace.mjs'),{UnitAction}=await import('@univerjs/protocol');
  const f=fixture(),origin='http://localhost:8310';
  const query=async(principal,epoch)=>{let value;await nativeRequest({authority:f.authority},{authenticate:()=>principal},origin,{url:`/api/native/${UNIT}/${epoch}/universer-api/authz/-/object/-/batch_allowed`,method:'POST',headers:{origin}},null,async()=>({requests:[{unitID:UNIT,objectID:UNIT,actions:[UnitAction.Comment,UnitAction.Delete]},{unitID:'foreign',actions:[UnitAction.Comment]}]}),(_code,v)=>value=v);return value.objectActions;};
  for(const p of ['owner','peer'])assert.deepEqual((await query(p,1))[0].actions.map(a=>a.allowed),[true,false]);
  assert.equal((await query('owner',1))[1].actions[0].allowed,false);
  await f.workspace.share('owner',UNIT,{commandId:'reader',peer:'peer',role:'read',accessRevision:1});
  assert.equal((await query('peer',2))[0].actions[0].allowed,false);
  f.authority.comments=undefined;assert.equal((await query('owner',2))[0].actions[0].allowed,false);
});
test('comment-free native transformed row batches retain existing behavior; stray comment deletion still refuses',()=>{
  const f=fixture(),mutations=[{id:'sheet.mutation.remove-rows',data:JSON.stringify({range:{startRow:1,endRow:2}})},{id:'sheet.mutation.set-range-values',data:'{}'}],c={request:{changeset:{baseRev:1}},changeset:{mutations}};
  assert.doesNotThrow(()=>f.comments.validate({},c,{revision:7,roots:[],sheet:{rowCount:100,columnCount:26}}));
  c.changeset.mutations.push({id:DELETE_COMMENT,data:JSON.stringify({commentId:'someone-else'})});assert.throws(()=>f.comments.validate({},c,{revision:7,roots:[],sheet:{rowCount:100,columnCount:26}}));
});
