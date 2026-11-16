// PARENT ONLY: actual SDK service + SQLite persistence, no HTTP/listener/provider.
// This bypasses Workagent routes deliberately to qualify SDK capability only;
// it is NOT an ACL/author-binding proof and enables no product comments route.
import assert from 'node:assert/strict';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UniverCollabService, UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { SQLiteDatabaseAdapter } from '@univerjs-pro/collaboration-database-sqlite';
import { UniverType } from '@univerjs/protocol';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { fixture, blank, add, insert, remove, resource, thread, TAB } from './native-comments-sdk.test.mjs';
if(process.env.WORKAGENT_NATIVE_COMMENTS_PROBE!=='fresh-synthetic-only')throw new Error('explicit_parent_opt_in_required');
const filename=process.argv[2];
if(!filename||!isAbsolute(filename)||resolve(filename)!==filename||await realpath(dirname(filename))!==dirname(filename))throw new Error('fresh_absolute_nonsymlink_path_required');
for(const path of [filename,filename+'-wal',filename+'-shm',filename+'-journal']){
  try{await lstat(path);throw new Error('existing_probe_storage_refused');}catch(error){if(error.code!=='ENOENT')throw error;}
}
// Exclusive ownership is established BEFORE the writable SDK constructor.
const file=await open(filename,'wx',0o600),identity=await file.stat();await file.close();
const unitID=`native-comments-${randomUUID()}`,initial=blank(unitID),local=fixture(initial),stages=[],contentFailures=[];
let db,service;
const start=async()=>{
  const stat=await lstat(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.ino,identity.ino);assert.equal(stat.dev,identity.dev);
  db=new SQLiteDatabaseAdapter({filename});
  service=new UniverCollabService({dbAdapter:db,enableUnitPermissionAnalysis:true,runtime:{execution:{mode:'in-process'}}});
};
const close=async()=>{try{if(service)await service.dispose();}finally{service=undefined;if(db)await db.dispose();db=undefined;}};
const load=()=>service.getUnitLoadDataWithBlocks({unitID,type:UniverType.UNIVER_SHEET,revision:0},{userID:'owner'});
const inspect=async()=>{
  const loaded=await load(),materializer=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});
  try{const head=await materializer.materializeSnapshot(loaded);return {revision:loaded.targetRevision,data:await transformSnapshotToWorkbookData(head.snapshot,[...head.sheetBlocks])};}
  finally{await materializer.dispose();}
};
let reqId=0;
const submit=async(label,emitted,userID='owner')=>{
  const mutations=emitted.filter(m=>!m.options.onlyLocal).map(m=>({id:m.id,data:JSON.stringify(m.params)}));
  assert.ok(mutations.length,`${label}: no native transmissible mutations`);
  const before=await load(),changeset={unitID,type:UniverType.UNIVER_SHEET,baseRev:before.targetRevision,revision:before.targetRevision+1,userID,memberID:`member-${userID}`,sid:`comments-proof-${userID}`,reqId:++reqId,mutations};
  const result=await service.submitChangeset({changeset},{userID,memberID:`member-${userID}`});
  assert.equal(result.status,'committed',`${label}: ${JSON.stringify(result)}`);
  const head=await inspect();assert.equal(head.revision,before.targetRevision+1);
  const view=fixture(head.data);
  try{if(label==='remove')assert.equal(thread(view),undefined,'deleted thread must not retarget replacement cell');else {
    const value=thread(view);assert.equal(value.root.ref,label==='insert'?'H10':'H9');
    if(value.root.text?.dataStream!=='Owner question\r\n')contentFailures.push({label,missing:'root text'});
    if(label!=='root'&&value.children[0]?.text?.dataStream!=='Peer reply\r\n')contentFailures.push({label,missing:'reply text'});
  }}
  finally{view.dispose();}
  stages.push({label,revision:head.revision,mutations,resource:resource(head.data)});return head;
};
try{
  await start();assert.equal((await service.createUnitFromData({type:UniverType.UNIVER_SHEET,data:initial},{userID:'owner'})).status,'created');
  await submit('root',await add(local,'root','owner'));
  await submit('reply',await add(local,'reply','peer','root'),'peer');
  const inserted=await submit('insert',await insert(local));
  const beforeRestart=await load();await close();await start();assert.deepEqual(await load(),beforeRestart,'retained native snapshot+changesets must survive restart');
  const reopened=await inspect();assert.deepEqual(resource(reopened.data),resource(inserted.data));
  const view=fixture(reopened.data);try{assert.equal(thread(view).root.ref,'H10');if(thread(view).root.text?.dataStream!=='Owner question\r\n')contentFailures.push({label:'restart',missing:'root text'});}finally{view.dispose();}
  await submit('remove',await remove(local));
  const afterDelete=await load();await close();await start();assert.deepEqual(await load(),afterDelete);
  const final=await inspect(),finalView=fixture(final.data);
  try{assert.equal(thread(finalView),undefined);assert.equal(finalView.model.getComment(unitID,TAB,'reply'),undefined);assert.equal(finalView.book.getActiveSheet().getCell(9,7).v,'replacement cell');}finally{finalView.dispose();}
  console.log(JSON.stringify({actualSDK:'1.4.0',unitID,stages,restart:'exact-native-load-data',finalResource:resource(final.data),acl:'NOT EXERCISED',authorBinding:'NOT EXERCISED',contentFailures}));
  assert.deepEqual(contentFailures,[],'native comment content retention failed; see emitted resource diagnostics');
}finally{local.dispose();await close();}
