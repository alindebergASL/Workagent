// Real pinned native service/OT/middleware with an in-memory implementation of
// public IDatabaseAdapter. No SQLite/Postgres, sockets or persistence proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { UniverCollabService } from '@univerjs-pro/collaboration-service';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { NativeAuthority, NATIVE_UNIT as UNIT } from '../src/native-collaboration.mjs';
import { NativeComments, ADD_COMMENT, DELETE_COMMENT } from '../src/native-comments.mjs';
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
  const session={userID:'owner',unitID:UNIT,revision:1};authority.sessions.set('m',session);
  const initial=blank(UNIT);initial.sheets['sheet-1'].cellData={};
  await authority.scope.run({creating:true},()=>service.createUnitFromData({type:2,data:initial},{userID:'owner'}));
  let reqId=0;
  const submit=(mutations,baseRev=unit.headRevision)=>service.submitChangeset({changeset:{unitID:UNIT,type:2,baseRev,revision:baseRev+1,userID:'owner',memberID:'m',sid:'comment-sid',reqId:++reqId,mutations:mutations.map(([id,p])=>({id,data:JSON.stringify({unitId:UNIT,subUnitId:'sheet-1',...p})}))}},{userID:'owner',memberID:'m'});
  const claim=async(id='root')=>{let comment;await comments.claim('owner','Owner',UNIT,session,{id,ref:'H9',body:'Immutable'},v=>comment=v);return comment;};
  const list=async(pendingID,principal='owner',epoch=1)=>{let result;await comments.list(principal,UNIT,{userID:principal,unitID:UNIT,revision:epoch},v=>result=v,pendingID);return result;};
  return {service,db,comments,authority,workspace,store,claim,submit,list,get head(){return unit.headRevision;},get changesets(){return changesets;}};
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
