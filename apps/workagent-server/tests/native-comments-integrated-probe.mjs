// PARENT ONLY: real native SQLite + production workspace-mode constructor/routes.
// Canonical store is a copy-on-write IN-MEMORY policy fixture, NOT PG durability.
// Existing storage/evidence is never adopted. No HTTP listener is opened.
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { SQLiteDatabaseAdapter } from '@univerjs-pro/collaboration-database-sqlite';
import { UniverType } from '@univerjs/protocol';
import { RemoveRowCommand } from '@univerjs/sheets';
import { IThreadCommentDataSourceService, AddCommentCommand } from '@univerjs/thread-comment';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { createHandler } from '../src/http.mjs';
import { nativeWorkspaceConfig, provisionNativeStorage, openNativeStorage } from '../src/native-qualification-storage.mjs';
import { fixture, blank, insert, remove } from './native-comments-sdk.test.mjs';
if(process.env.WORKAGENT_NATIVE_COMMENTS_INTEGRATED!=='fresh-synthetic-only')throw Error('parent_opt_in_required');
const filename=process.argv[2];if(!filename?.startsWith('/'))throw Error('fresh_absolute_path_required');
const owner='owner',token='synthetic-comments-owner-token-at-least-32',peerToken='synthetic-comments-peer-token-at-least-32',origin='http://127.0.0.1:8311';
const accounts=[{id:'peer',name:'Peer',token:peerToken}];
let state=initialState(owner),tail=Promise.resolve();
const store={read:async fn=>structuredClone(await fn(structuredClone(state))),transaction(fn){const task=tail.then(async()=>{const copy=structuredClone(state),result=await fn(copy);state=copy;return structuredClone(result);});tail=task.catch(()=>{});return task;}};
let workspace=new Workspace(store,{peers:accounts,nativeEnabled:true});
const config=nativeWorkspaceConfig({WORKAGENT_NATIVE_WORKSPACE:'synthetic-only',WORKAGENT_OWNER_ID:owner,WORKAGENT_AUTH_TOKEN:token,WORKAGENT_ORIGIN:origin,
  WORKAGENT_DATABASE_URL:'postgresql://synthetic-unused/workagent_native_comments',WORKAGENT_NATIVE_DATABASE_NAME:'workagent_native_comments',WORKAGENT_NATIVE_ROOT:dirname(filename),WORKAGENT_NATIVE_SQLITE:filename,WORKAGENT_SYNTHETIC_ACCOUNTS_JSON:JSON.stringify(accounts)});
const databaseID='comments-in-memory-policy-store';
await provisionNativeStorage({config,workspace,databaseID}); // Explicit NEW root only.
let native,handler,local,unitID,epoch=2,reqId=0;
const start=async()=>{native=await openNativeStorage({config,workspace,databaseID,makeAdapter:options=>new SQLiteDatabaseAdapter(options)});handler=createHandler({workspace,native,owner,token,origin,accounts,clientRoot:process.cwd()});};
const http=async(principal,path,input)=>{
  const req=Readable.from(input?[Buffer.from(JSON.stringify(input))]:[]);Object.assign(req,{url:path,method:input?'POST':'GET',headers:{origin,...(input?{'content-type':'application/json'}:{}),cookie:`workagent_session=${config.auth.login(principal==='owner'?token:peerToken)}`}});
  let status,value;const res={setHeader(){},writeHead(code){status=code;},end(body){value=JSON.parse(body);}};
  await handler(req,res);return {status,value};
};
const scope=principal=>({unitID,session:{unitID,userID:principal,revision:epoch}});
const load=()=>native.authority.scope.run(scope('owner'),()=>native.service.getUnitLoadDataWithBlocks({unitID,type:UniverType.UNIVER_SHEET,revision:0},{userID:owner}));
const register=()=>{for(const userID of ['owner','peer'])native.authority.sessions.set(`member-${userID}`,scope(userID).session);};
const read=async principal=>{const r=await http(principal,`/api/work/${unitID}/native-comments/${epoch}`);assert.equal(r.status,200,JSON.stringify(r));return r.value;};
const submit=async(principal,emitted)=>{
  const head=await load(),changeset={unitID,type:2,baseRev:head.targetRevision,revision:head.targetRevision+1,sid:`comments-${principal}-${epoch}`,reqId:++reqId,userID:principal,memberID:`member-${principal}`,mutations:emitted.filter(m=>!m.options.onlyLocal).map(m=>({id:m.id,data:JSON.stringify(m.params)}))};
  const result=await native.authority.scope.run(scope(principal),()=>native.service.submitChangeset({changeset},{userID:principal,memberID:`member-${principal}`}));
  assert.equal(result.status,'committed',JSON.stringify(result));return changeset;
};
const add=async(principal,id,body,parentId)=>{
  const source=local.univer.__getInjector().get(IThreadCommentDataSourceService);
  source.dataSource={addComment:async comment=>{
    const r=await http(principal,`/api/work/${unitID}/native-comments/${epoch}`,{id:comment.id,ref:comment.ref,body,...(parentId?{parentId}:{})});assert.equal(r.status,200,JSON.stringify(r));return r.value;
  },listComments:async()=>[],saveCommentToSnapshot:c=>c,updateComment:async()=>{throw Error('unsupported');},deleteComment:async()=>{throw Error('unsupported');},resolveComment:async()=>{throw Error('unsupported');}};
  const before=local.emitted.length;
  assert.equal(await local.commands.executeCommand(AddCommentCommand.id,{unitId:unitID,subUnitId:'sheet-1',comment:{id,threadId:parentId??id,parentId,unitId:unitID,subUnitId:'sheet-1',personId:principal,ref:'H9',dT:'',text:{dataStream:body+'\r\n'}}}),true);
  assert.ok(!(await read(principal)).comments.some(c=>c.id===id),'private body is not publication');
  return submit(principal,local.emitted.slice(before));
};
try{
  await start();const created=await http(owner,'/api/work/native',{commandId:'comment-proof-unit',title:'Comments integration proof'});assert.equal(created.status,200,JSON.stringify(created));unitID=created.value.workId;
  await workspace.share(owner,unitID,{commandId:'share',peer:'peer',role:'editor',accessRevision:1});register();local=fixture(blank(unitID));
  assert.equal((await http(owner,`/api/work/${unitID}/native-session`)).value.comments,true);
  await add('owner','root','Owner question');await add('peer','reply','Peer reply','root');
  let hydrated=await read('peer');assert.equal(hydrated.comments[0].text.dataStream,'Owner question\r\n');assert.equal(hydrated.comments[0].children[0].text.dataStream,'Peer reply\r\n');
  await submit('owner',await insert(local));hydrated=await read('peer');assert.equal(hydrated.comments[0].ref,'H10');
  const retained=await load();await native.close();native=null;workspace=new Workspace(store,{peers:accounts,nativeEnabled:true});await start();register();assert.deepEqual(await load(),retained);assert.deepEqual(await read('peer'),hydrated);
  const removal=await remove(local),head=await load();
  const bare={unitID,type:2,baseRev:head.targetRevision,revision:head.targetRevision+1,sid:`comments-owner-${epoch}`,reqId:++reqId,mutations:removal.filter(m=>m.id==='sheet.mutation.remove-rows').map(m=>({id:m.id,data:JSON.stringify(m.params)}))};
  const refused=await native.authority.scope.run(scope('owner'),()=>native.service.submitChangeset({changeset:bare},{userID:'owner',memberID:'member-owner'}));
  assert.equal(refused.status,'rejected',JSON.stringify(refused));
  await submit('owner',removal);assert.deepEqual((await read('peer')).comments,[]);
  assert.equal((await http('owner',`/api/work/${unitID}/native-comments/${epoch}`,{id:'root',ref:'H9',body:'Owner question'})).status,409);
  // Commit and remove BEFORE any post-commit comments GET: native history, not
  // first membership observation, must resolve the author's pending request.
  const fast=await add('owner','fast-removed','Retain this draft');
  const beforeRemoval=local.emitted.length;
  assert.equal(await local.commands.executeCommand(RemoveRowCommand.id,{unitId:unitID,subUnitId:'sheet-1',range:{startRow:8,endRow:8,startColumn:0,endColumn:25}}),true);
  await submit('owner',local.emitted.slice(beforeRemoval));
  const removedReceipt=await http('owner',`/api/work/${unitID}/native-comments/${epoch}?pending=fast-removed`);
  assert.equal(removedReceipt.status,200);assert.deepEqual(removedReceipt.value.comments,[]);
  assert.deepEqual(removedReceipt.value.receipt,{id:'fast-removed',status:'committed-removed',revision:fast.revision});
  assert.equal((await http('peer',`/api/work/${unitID}/native-comments/${epoch}?pending=fast-removed`)).value.receipt.status,'unknown');
  await workspace.share(owner,unitID,{commandId:'revoke',peer:'peer',role:null,accessRevision:epoch});epoch++;
  assert.equal((await http('peer',`/api/work/${unitID}/native-comments/${epoch}`)).status,403);
  console.log(JSON.stringify({actualSDK:'1.4.0',nativeSQLite:'root/reply/insert/delete/reopen/own-history-receipt',canonicalStore:'in-memory policy fixture only; PG durability NOT proven',routes:'normal production constructor and HTTP handlers without listener',browser:'NOT run'}));
}finally{local?.dispose();if(native)await native.close();}
