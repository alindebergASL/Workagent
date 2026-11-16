// Actual pinned commands, collaborative undo/state, OT, materializer and service.
// Direct in-process delivery, with in-memory IDatabaseAdapter/Workspace stores.
// NOT socket, browser, persisted account undo, SQLite/PG or restart durability proof.
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Univer, LocaleType, ICommandService, IUndoRedoService, ILogService, IUniverInstanceService, Direction, CommandType, UndoCommand, RedoCommand } from '@univerjs/core';
import { UniverSheetsPlugin, SetRangeValuesCommand, InsertRowCommand } from '@univerjs/sheets';
import { UniverThreadCommentPlugin, ThreadCommentModel, AddCommentCommand } from '@univerjs/thread-comment';
import { UniverSheetsThreadCommentPlugin } from '@univerjs/sheets-thread-comment';
import { UniverCollaborationPlugin, RevisionService, ITransformService, parseChangesetToProtocol, parseProtocolChangeset, transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { CollaborativeUndoRedoService, SyncedState, AwaitingState } from '@univerjs-pro/collaboration-client';
import { UniverCollabService, UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { NativeAuthority, NATIVE_UNIT as UNIT } from '../src/native-collaboration.mjs';
import { NativeComments } from '../src/native-comments.mjs';
import { blank, TAB } from './native-comments-sdk.test.mjs';

async function server() {
  let state=initialState('owner'),tail=Promise.resolve(),unit,snapshot,blocks=[],changesets=[];
  state.nativeQualification={storage:{pairID:'history-proof',purpose:'workagent-native-workspace'}};
  state.works[UNIT]={id:UNIT,kind:'native-sheet',nativeCollaboration:true,status:'ready',accessRevision:1,acl:{peer:'editor'},nativeIdentity:{version:1,workspace:'owner',unitID:UNIT,pairID:'history-proof',owners:{}}};
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
  const comments=new NativeComments(authority,service,db);authority.comments=comments;
  authority.install(service,{use(){},on(){}});
  for(const userID of ['owner','peer'])authority.sessions.set(userID,{userID,unitID:UNIT,revision:1});
  const initial=blank(UNIT);initial.sheets[TAB].cellData={};
  await authority.scope.run({creating:true},()=>service.createUnitFromData({type:2,data:initial},{userID:'owner'}));
  const materializer=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});
  return {service,workspace,authority,initial,db,store,
    async claim(){let result;await comments.claim('owner','Owner',UNIT,authority.sessions.get('owner'),{id:'root',ref:'H9',body:'Anchored history proof'},v=>result=v);return result;},
    get head(){return unit.headRevision;},
    history:(principal='owner',from=1,to=unit.headRevision)=>service.getChangesets({unitID:UNIT,type:2,from,to},{userID:principal}),
    async data(revision=0){const load=await service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision},{userID:'owner'});const head=await materializer.materializeSnapshot(load);return transformSnapshotToWorkbookData(head.snapshot,[...head.sheetBlocks]);},
    async dispose(){await materializer.dispose();await service.dispose();}
  };
}
function client(data,userID){
  const univer=new Univer({locale:LocaleType.EN_US,locales:{enUS:{}},override:[[IUndoRedoService,{useClass:CollaborativeUndoRedoService}]]});
  univer.registerPlugin(UniverSheetsPlugin);univer.registerPlugin(UniverThreadCommentPlugin);univer.registerPlugin(UniverSheetsThreadCommentPlugin);univer.registerPlugin(UniverCollaborationPlugin);
  const book=univer.createUnit(2,structuredClone(data)),injector=univer.__getInjector(),commands=injector.get(ICommandService),undo=injector.get(IUndoRedoService),rev=injector.get(RevisionService),emitted=[];
  assert.ok(undo instanceof CollaborativeUndoRedoService);
  injector.get(IUniverInstanceService).focusUnit(UNIT);
  const handler={onStateChange(){throw Error('unexpected asynchronous state transition');},onSendChangeset(){throw Error('unexpected transport request');},onMissingChangesets(){throw Error('unexpected history gap');}};
  const synced=()=>new SyncedState(UNIT,2,handler,rev,injector,undo,commands,injector.get(ILogService),injector.get(ITransformService));
  let state=synced(),reqId=0;
  const observer=commands.onCommandExecuted((c,o)=>{if(c.type===CommandType.MUTATION&&!o?.onlyLocal&&!o?.fromCollab)emitted.push({id:c.id,params:structuredClone(c.params)});});
  return {univer,book,commands,undo,emitted,model:injector.get(ThreadCommentModel),
    cell:(r,c)=>book.getActiveSheet().getCell(r,c)?.v??null,
    receive(protocol){state=state.onRemoteChangeset(parseProtocolChangeset(protocol));assert.equal(state.status,'synced');},
    async run(s,id,params){
      emitted.length=0;const result=await commands.executeCommand(id,params);await new Promise(setImmediate);
      const mutations=structuredClone(emitted);if(!mutations.length)return {command:result,status:'no-mutations'};
      const cs={unitID:UNIT,type:2,baseRev:rev.getCurrentRevOfUnit(UNIT),revision:rev.getCurrentRevOfUnit(UNIT)+1,userID,memberID:userID,sid:`history-${userID}`,reqId:++reqId,mutations};
      state.dispose();state=new AwaitingState(UNIT,2,cs,handler,undefined,injector,rev,commands,injector.get(ILogService),injector.get(ITransformService),undo);
      const outcome=await s.service.submitChangeset({changeset:parseChangesetToProtocol(cs)},{userID,memberID:userID});
      if(outcome.status==='committed'){state=state.onRemoteAck(parseProtocolChangeset(outcome.changeset));assert.equal(state.status,'synced');}
      return {...outcome,command:result};
    },
    dispose(){state.dispose();observer.dispose();univer.dispose();}
  };
}
const edit=(c,s,r,col,v)=>c.run(s,SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:TAB,range:{startRow:r,endRow:r,startColumn:col,endColumn:col},value:{v}});
async function pair(fn){const s=await server(),a=client(s.initial,'owner'),b=client(s.initial,'peer');try{await fn(s,a,b);}finally{a.dispose();b.dispose();await s.dispose();}}
async function relay(result,other){assert.equal(result.status,'committed',JSON.stringify(result));other.receive(result.changeset);return result;}

export { server, client, pair, edit, relay, UNIT, TAB };
if(process.argv[1]===fileURLToPath(import.meta.url)){
test('native own undo/redo preserves disjoint peer edit; retained history records new revisions',async t=>pair(async(s,a,b)=>{
  await relay(await edit(a,s,0,0,11),b);await relay(await edit(b,s,0,1,22),a);
  assert.deepEqual(a.undo.getUndoRedoStatus(UNIT),{undos:1,redos:0});
  await relay(await a.run(s,UndoCommand.id),b);assert.deepEqual([a.cell(0,0),a.cell(0,1),b.cell(0,0),b.cell(0,1)],[null,22,null,22]);
  await relay(await a.run(s,RedoCommand.id),b);assert.deepEqual([a.cell(0,0),a.cell(0,1),b.cell(0,0),b.cell(0,1)],[11,22,11,22]);
  const history=await s.history();assert.deepEqual(history.changesets.map(c=>[c.revision,c.userID]),[[2,'owner'],[3,'peer'],[4,'owner'],[5,'owner']]);
  const historical=await s.data(2);assert.equal(historical.sheets[TAB].cellData[0][0].v,11);assert.equal(historical.sheets[TAB].cellData[0][1]?.v??null,null);
  const current=await s.data();assert.equal(current.sheets[TAB].cellData[0][0].v,11);assert.equal(current.sheets[TAB].cellData[0][1].v,22);
  const reopened=client(current,'owner');try{assert.deepEqual(reopened.undo.getUndoRedoStatus(UNIT),{undos:0,redos:0});}finally{reopened.dispose();}
  t.diagnostic(JSON.stringify({history:history.changesets.map(c=>({revision:c.revision,userID:c.userID,mutations:c.mutations.map(m=>m.id)})),reopenedUndo:{undos:0,redos:0}}));
}));
test('actual native history reads and generated undo submissions enforce current Workspace ACL',async()=>pair(async(s,a,b)=>{
  await relay(await edit(b,s,0,0,22),a);
  await s.workspace.share('owner',UNIT,{commandId:'revoke',peer:'peer',role:null,accessRevision:1});
  await assert.rejects(s.history('peer'),/denied/);
  const head=s.head,result=await b.run(s,UndoCommand.id);assert.equal(result.status,'rejected',JSON.stringify(result));assert.equal(result.error.retryable,false);assert.equal(s.head,head);
  assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,22);
}));
test('native peer row insertion transforms own cell undo and preserves native comment anchor',async t=>pair(async(s,a,b)=>{
  const comment=await s.claim();await relay(await a.run(s,AddCommentCommand.id,{unitId:UNIT,subUnitId:TAB,comment}),b);
  a.undo.clearUndoRedo(UNIT);b.undo.clearUndoRedo(UNIT);
  await relay(await edit(a,s,8,0,99),b);
  const inserted=await b.run(s,InsertRowCommand.id,{unitId:UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:0,endColumn:25},direction:Direction.UP});
  await relay(inserted,a);
  assert.equal(a.model.getComment(UNIT,TAB,'root').ref,'H10');assert.equal(a.cell(9,0),99);
  await relay(await a.run(s,UndoCommand.id),b);assert.equal(a.cell(9,0),null);assert.equal(b.cell(9,0),null);
  assert.equal(a.book.getActiveSheet().getRowCount(),31);assert.equal(a.model.getComment(UNIT,TAB,'root').ref,'H10');
  await relay(await a.run(s,RedoCommand.id),b);assert.equal(a.cell(9,0),99);assert.equal(b.cell(9,0),99);
  const data=await s.data();assert.equal(data.sheets[TAB].rowCount,31);assert.equal(data.sheets[TAB].cellData[9][0].v,99);
  const native=client(data,'owner');try{assert.equal(native.model.getComment(UNIT,TAB,'root').ref,'H10');}finally{native.dispose();}
  await relay(await b.run(s,UndoCommand.id),a);assert.equal(a.book.getActiveSheet().getRowCount(),30);assert.equal(a.cell(8,0),99);assert.equal(a.model.getComment(UNIT,TAB,'root').ref,'H9');
  await relay(await b.run(s,RedoCommand.id),a);assert.equal(a.book.getActiveSheet().getRowCount(),31);assert.equal(a.cell(9,0),99);assert.equal(a.model.getComment(UNIT,TAB,'root').ref,'H10');
  const final=client(await s.data(),'owner');try{assert.equal(final.model.getComment(UNIT,TAB,'root').ref,'H10');assert.equal(final.cell(9,0),99);}finally{final.dispose();}
  t.diagnostic(JSON.stringify({head:s.head,anchorAfterStructuralUndo:'H9',anchorAfterStructuralRedo:'H10',rows:31,cellAfterRedo:99,structuralMutations:inserted.changeset.mutations.map(m=>m.id)}));
}));
}
