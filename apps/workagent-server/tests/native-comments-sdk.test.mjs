// Actual installed SDK, headless only. No database, transport, session or server.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Univer, UniverInstanceType, LocaleType, ICommandService, IResourceLoaderService, CommandType } from '@univerjs/core';
import { UniverSheetsPlugin, InsertRowMutation, RemoveRowMutation, RemoveRowCommand } from '@univerjs/sheets';
import { UniverThreadCommentPlugin, ThreadCommentModel, AddCommentCommand, DeleteCommentMutation } from '@univerjs/thread-comment';
import { UniverSheetsThreadCommentPlugin, SHEET_UNIVER_THREAD_COMMENT_PLUGIN } from '@univerjs/sheets-thread-comment';
import { transformWorkbookDataToSnapshot, transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { UniverType, ErrorCode } from '@univerjs/protocol';
export const TAB='sheet-1';
export const tick=()=>new Promise(setImmediate);
export function blank(unitID='native-comments-proof'){
  return {id:unitID,name:'Synthetic comments proof',rev:1,appVersion:'',locale:'enUS',sheetOrder:[TAB],styles:{},resources:[],sheets:{[TAB]:{id:TAB,name:'Sheet 1',rowCount:30,columnCount:26,cellData:{8:{7:{v:'original anchor'}},9:{7:{v:'replacement cell'}}}}}};
}
export function fixture(data=blank()){
  const univer=new Univer({locale:LocaleType.EN_US,locales:{enUS:{}}});
  try{
    univer.registerPlugin(UniverSheetsPlugin);
    univer.registerPlugin(UniverThreadCommentPlugin);
    univer.registerPlugin(UniverSheetsThreadCommentPlugin);
    const book=univer.createUnit(UniverInstanceType.UNIVER_SHEET,structuredClone(data));
    const injector=univer.__getInjector(),commands=injector.get(ICommandService),model=injector.get(ThreadCommentModel),emitted=[];
    const observer=commands.onCommandExecuted((command,options)=>{if(command.type===CommandType.MUTATION)emitted.push({id:command.id,params:structuredClone(command.params),options:structuredClone(options??{})});});
    return {univer,book,commands,model,emitted,unitID:data.id,
      save:()=>injector.get(IResourceLoaderService).saveUnit(data.id),
      dispose(){observer.dispose();univer.dispose();}};
  }catch(error){univer.dispose();throw error;}
}
export function resource(data){
  const found=data.resources?.find(r=>r.name===SHEET_UNIVER_THREAD_COMMENT_PLUGIN);
  assert.ok(found,'native comment resource must be serialized');return JSON.parse(found.data);
}
export function thread(f){return f.model.getThread(f.unitID,TAB,'root');}
export async function add(f,id,personId,parentId){
  const content=id==='root'?'Owner question':'Peer reply';
  const comment={id,threadId:'root',dT:'2026-11-16T00:00:00.000Z',personId,authorName:personId,unitId:f.unitID,subUnitId:TAB,ref:'H9',text:{dataStream:content+'\r\n',paragraphs:[{startIndex:content.length}]},...(parentId?{parentId}:{})};
  const start=f.emitted.length;
  assert.equal(await f.commands.executeCommand(AddCommentCommand.id,{unitId:f.unitID,subUnitId:TAB,comment}),true);await tick();
  return f.emitted.slice(start);
}
export async function insert(f){
  const start=f.emitted.length;
  assert.equal(await f.commands.executeCommand(InsertRowMutation.id,{unitId:f.unitID,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:0,endColumn:25}}),true);await tick();
  assert.equal(thread(f).root.ref,'H10');return f.emitted.slice(start);
}
export async function remove(f,normal=true){
  const start=f.emitted.length;
  assert.equal(await f.commands.executeCommand(normal?RemoveRowCommand.id:RemoveRowMutation.id,{unitId:f.unitID,subUnitId:TAB,range:{startRow:9,endRow:9,startColumn:0,endColumn:25}}),true);await tick();
  return f.emitted.slice(start);
}
export function assertTree(f,ref='H9'){
  const value=thread(f);assert.ok(value);assert.equal(value.root.ref,ref);
  assert.equal(value.root.personId,'owner');assert.equal(value.root.text.dataStream,'Owner question\r\n');
  assert.equal(value.children.length,1);assert.equal(value.children[0].personId,'peer');assert.equal(value.children[0].text.dataStream,'Peer reply\r\n');assert.equal(value.children[0].parentId,'root');
  assert.deepEqual([...value.root.text.dataStream.slice(-2)].map(c=>c.charCodeAt(0)),[13,10]);
}
// Parent imports these public SDK helpers without registering/running tests.
if(process.argv[1]===fileURLToPath(import.meta.url)){
  test('native root/reply resource survives save → new instance load with authors/text/ref',async t=>{
    const f=fixture();let loaded;
    try{const root=await add(f,'root','owner'),reply=await add(f,'reply','peer','root');assertTree(f);const saved=f.save();resource(saved);loaded=fixture(saved);assertTree(loaded);t.diagnostic(JSON.stringify({root,reply,before:resource(saved),after:resource(loaded.save())}));assert.deepEqual(resource(loaded.save()),resource(saved),'STRICT boundary: native load normalizes embedded reply.ref to empty');}
    finally{loaded?.dispose();f.dispose();}
  });
  test('supported row deletion command removes anchored native thread instead of retargeting replacement cell',async t=>{
    const f=fixture();let loaded;
    try{await add(f,'root','owner');await add(f,'reply','peer','root');const insertion=await insert(f);assertTree(f,'H10');const deletion=await remove(f);t.diagnostic(JSON.stringify({insertion,deletion,resource:resource(f.save())}));
      assert.ok(deletion.some(m=>m.id===DeleteCommentMutation.id),'normal command must emit native comment deletion');
      assert.equal(thread(f),undefined,'deleted anchor must not remain attached to replacement H10');
      assert.equal(f.model.getComment(f.unitID,TAB,'reply'),undefined,'reply must not survive as an orphan');
      assert.equal(f.book.getActiveSheet().getCell(9,7).v,'replacement cell');loaded=fixture(f.save());assert.equal(thread(loaded),undefined);
    }finally{loaded?.dispose();f.dispose();}
  });
  test('OBSERVED UNSAFE BOUNDARY: raw remove-row alone retains H10 on replacement cell',async t=>{
    const f=fixture();try{await add(f,'root','owner');await add(f,'reply','peer','root');await insert(f);const deletion=await remove(f,false);
      assert.equal(thread(f).root.ref,'H10');assert.equal(f.book.getActiveSheet().getCell(9,7).v,'replacement cell');
      assert.equal(deletion.some(m=>m.id===DeleteCommentMutation.id),false);
      t.diagnostic(JSON.stringify({unsafeStandaloneStructuralMutation:true,deletion,retainedRoot:thread(f).root,resource:resource(f.save())}));
    }finally{f.dispose();}
  });
  test('actual server materializer executes generated comment/structural mutations and retains native resources',async t=>{
    const initial=blank('native-comments-materializer');initial.sheets[TAB].cellData={};
    // Native codec with in-memory snapshot sink, NOT a database/persistence adapter.
    const encoded=await transformWorkbookDataToSnapshot({},initial,initial.id,1,{saveSnapshot:async()=>({error:{code:ErrorCode.OK,message:''}}),saveSheetBlock:async()=>{throw new Error('empty workbook unexpectedly emitted a block');}});
    const source=fixture(initial),materializer=new UnitSnapshotMaterializer({execution:{mode:'in-process'}}),changesets=[],heads=[];
    try{
      for(const [label,operation] of [['root',()=>add(source,'root','owner')],['reply',()=>add(source,'reply','peer','root')],['insert',()=>insert(source)],['remove',()=>remove(source)]]){
        const emitted=await operation();
        changesets.push({unitID:initial.id,type:UniverType.UNIVER_SHEET,baseRev:changesets.length+1,revision:changesets.length+2,userID:label==='reply'?'peer':'owner',memberID:'synthetic',sid:'materializer-proof',reqId:changesets.length+1,mutations:emitted.filter(m=>!m.options.onlyLocal).map(m=>({id:m.id,data:JSON.stringify(m.params)}))});
        const head=await materializer.materializeSnapshot({snapshot:encoded.snapshot,sheetBlocks:[],changesets:structuredClone(changesets),targetRevision:changesets.length+1});
        const data=await transformSnapshotToWorkbookData(head.snapshot,[...head.sheetBlocks]),view=fixture(data);
        try{const saved=resource(data);heads.push(saved);t.diagnostic(JSON.stringify({serverMaterialized:label,revision:head.snapshot.rev,resource:saved,allResources:data.resources}));
          if(label==='remove'){assert.equal(thread(view),undefined);assert.equal(view.model.getComment(view.unitID,TAB,'reply'),undefined);}else {assert.equal(thread(view).root.ref,label==='insert'?'H10':'H9');assert.equal(thread(view).root.personId,'owner');}
        }finally{view.dispose();}
      }
      assert.equal(heads[1][TAB][0].text?.dataStream,'Owner question\r\n','server snapshot must retain root comment text');
      assert.equal(heads[1][TAB][0].children?.[0]?.text?.dataStream,'Peer reply\r\n','server snapshot must retain reply text');
    }finally{source.dispose();await materializer.dispose();}
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)) test('resolve/reopen public command emits only native root state mutation and retains bodies/replies/anchors',async()=>{
 const {ResolveCommentCommand,ResolveCommentMutation,IThreadCommentDataSourceService}=await import('@univerjs/thread-comment');
 const f=fixture();try{
  await add(f,'root','owner');await add(f,'reply','peer','root');
  const source=f.univer.__getInjector().get(IThreadCommentDataSourceService),calls=[];
  source.dataSource={saveCommentToSnapshot:c=>c,resolveComment:async c=>{calls.push(structuredClone(c));return true;}};source.syncUpdateMutationToColla=true;
  for(const resolved of [true,false]){
   const start=f.emitted.length;
   assert.equal(await f.commands.executeCommand(ResolveCommentCommand.id,{unitId:f.unitID,subUnitId:TAB,commentId:'root',resolved}),true);
   assert.equal(calls.at(-1).resolved,resolved);assertTree(f);
   const mutations=f.emitted.slice(start);assert.deepEqual(mutations.map(m=>[m.id,m.params,m.options.onlyLocal]),[[ResolveCommentMutation.id,{unitId:f.unitID,subUnitId:TAB,commentId:'root',resolved,trigger:ResolveCommentCommand.id},false]]);
   assert.equal(thread(f).root.resolved,resolved);
   const reopened=fixture(f.save());try{assert.equal(thread(reopened).root.resolved,resolved);assertTree(reopened);}finally{reopened.dispose();}
  }
 }finally{f.dispose();}
});

if(process.argv[1]===fileURLToPath(import.meta.url)) test('public update root and reply emits exact text payload and preserves original identity and anchor',async()=>{
 const {UpdateCommentCommand,UpdateCommentMutation,IThreadCommentDataSourceService}=await import('@univerjs/thread-comment');
 const f=fixture();try{
  await add(f,'root','owner');await add(f,'reply','peer','root');await insert(f);
  const source=f.univer.__getInjector().get(IThreadCommentDataSourceService),calls=[];
  source.dataSource={saveCommentToSnapshot:c=>c,updateComment:async c=>{calls.push(structuredClone(c));return true;}};source.syncUpdateMutationToColla=true;
  for(const id of ['root','reply']){
   const before=structuredClone(f.model.getComment(f.unitID,TAB,id)),payload={commentId:id,text:{dataStream:'Revised text\r\n',paragraphs:[{startIndex:12}]}};
   const start=f.emitted.length;
   assert.equal(await f.commands.executeCommand(UpdateCommentCommand.id,{unitId:f.unitID,subUnitId:TAB,payload}),true);
   assert.deepEqual(calls.at(-1).text,payload.text);
   assert.deepEqual(f.emitted.slice(start).map(m=>[m.id,m.params,m.options.onlyLocal]),[[UpdateCommentMutation.id,{unitId:f.unitID,subUnitId:TAB,payload,trigger:UpdateCommentCommand.id},false]]);
   const after=f.model.getComment(f.unitID,TAB,id);for(const k of ['id','personId','dT','ref','threadId','parentId'])assert.deepEqual(after[k],before[k]);assert.deepEqual(after.text,payload.text);
  }
  assert.equal(thread(f).root.ref,'H10');assert.equal(thread(f).children.length,1);
  const loaded=fixture(f.save());try{assert.equal(thread(loaded).root.text.dataStream,'Revised text\r\n');assert.equal(thread(loaded).children[0].text.dataStream,'Revised text\r\n');}finally{loaded.dispose();}
 }finally{f.dispose();}
});
