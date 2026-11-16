// Actual native service/history/materializer and production HTTP handler; memory
// Workspace/IDatabaseAdapter only. No listener, SQLite/Postgres or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { NativeHistory } from '../src/native-history.mjs';
import { createHandler } from '../src/http.mjs';
import { pair, edit, relay, UNIT } from './native-history-sdk.test.mjs';
const origin='http://history.invalid',token='synthetic-owner-only-history-test-credential',peer='synthetic-peer-only-history-test-credential';
function api(s){
  s.authority.history=new NativeHistory(s.authority,s.service,s.db);
  const handler=createHandler({workspace:s.workspace,native:{authority:s.authority},owner:'owner',token,origin,accounts:[{id:'peer',name:'Peer',token:peer}],clientRoot:'/unused'});
  return async(query='',principal='owner',epoch=1,method='GET',unit=UNIT)=>{
    const req=Readable.from([]);Object.assign(req,{url:`/api/work/${unit}/native-history/${epoch}${query}`,method,headers:{authorization:`Bearer ${principal==='owner'?token:peer}`,origin}});
    let data;const res={setHeader(){},writeHead(status){this.status=status;},end(value){data=JSON.parse(value);this.writableEnded=true;}};
    await handler(req,res);return {status:res.status,data};
  };
}
test('production history HTTP returns bounded native author/revision/operation pages and historical text preview without writes/resources',async()=>pair(async(s,a,b)=>{
  await relay(await edit(a,s,0,0,11),b);await relay(await edit(b,s,0,0,22),a);await s.claim();const request=api(s),head=s.head;
  const list=await request();assert.equal(list.status,200);assert.deepEqual(list.data.entries.map(e=>[e.revision,e.author]),[[3,'peer'],[2,'owner']]);assert.equal(list.data.entries[0].operations[0],'sheet.mutation.set-range-values');
  const preview=await request('?revision=2');assert.equal(preview.status,200);assert.deepEqual(preview.data.sheets[0].cells,[{cell:'A1',value:'11'}]);assert.equal(preview.data.resources,undefined);assert.equal(preview.data.comments,undefined);assert.ok(!JSON.stringify([list.data,preview.data]).includes('Anchored history proof'));assert.equal(s.head,head);assert.equal(a.cell(0,0),22);
  assert.equal((await request('?revision=999')).status,409);assert.equal((await request('?revision=0')).status,400);assert.equal((await request('?revision=2&before=3')).status,400);assert.equal((await request('', 'owner',1,'POST')).status,405);assert.equal((await request('', 'owner',1,'GET','foreign')).status,403);
  for(let n=0;n<27;n++)await relay(await edit(a,s,0,1,n),b);
  const page=await request();assert.equal(page.data.entries.length,25);assert.equal(page.data.before,6);const older=await request(`?before=${page.data.before}`);assert.deepEqual(older.data.entries.map(e=>e.revision),[5,4,3,2]);
}));
test('reader can inspect history; stale epoch and revoke during read prevent response enqueue',async()=>pair(async(s,a,b)=>{
  await relay(await edit(a,s,0,0,11),b);const request=api(s);
  await s.workspace.share('owner',UNIT,{commandId:'reader',peer:'peer',role:'read',accessRevision:1});
  assert.equal((await request('','peer',1)).status,403);assert.equal((await request('?revision=2','peer',2)).status,200);
  let reached,release;const waiting=new Promise(r=>reached=r),blocked=new Promise(r=>release=r),original=s.service.getChangesets.bind(s.service);
  s.service.getChangesets=async(...args)=>{const result=await original(...args);reached();await blocked;return result;};
  const pending=request('','peer',2);await waiting;await s.workspace.share('owner',UNIT,{commandId:'revoke',peer:'peer',role:null,accessRevision:2});release();
  const refused=await pending;assert.equal(refused.status,403);assert.equal(refused.data.entries,undefined);assert.equal((await request('?revision=2','peer',3)).status,403);
}));
