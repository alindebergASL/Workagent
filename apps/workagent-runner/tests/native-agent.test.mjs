// Actual installed native service/materializer with memory adapters; existing
// fixture session admission is conceptual. Actual DSH, deterministic provider;
// no network/listener, SQLite/PG, live inference or browser qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { NativeAgent } from '../../workagent-server/src/native-agent.mjs';
import { createHandler } from '../../workagent-server/src/http.mjs';
import { bootHost } from '../../workagent-runner/src/host.mjs';
import { createDispatcher } from '../../workagent-runner/src/dispatch.mjs';
import { server, UNIT, TAB } from '../../workagent-server/tests/native-history-sdk.test.mjs';
import { createSheetReader } from '../../workagent-runner/src/sheet-read.mjs';
const request=(commandId='ask',expectedIntentRevision=0)=>({commandId,kind:'continue',expectedIntentRevision,accessRevision:1,text:'Suggest one scalar change to A1',sourceIds:[]});
const patch=value=>JSON.stringify({cells:[{sheetId:TAB,row:0,column:0,value}]});
async function setup(){const s=await server();s.agent=new NativeAgent(s.authority,s.service,s.db);s.agent.enabled=true;return s;}
async function job(s){await s.agent.admit('owner',UNIT,request());return s.workspace.claim('owner');}
async function value(s,v,who='owner',extra={}){return values(s,{0:{0:{v,...extra}}},who);}
async function values(s,cellValue,who='owner'){const r=await s.service.submitChangeset({changeset:{unitID:UNIT,type:2,userID:who,memberID:who,sid:`agent-fixture-${who}`,reqId:s.head,baseRev:s.head,revision:s.head+1,mutations:[{id:'sheet.mutation.set-range-values',data:JSON.stringify({unitId:UNIT,subUnitId:TAB,cellValue})}]}},{userID:who,memberID:who});assert.equal(r.status,'committed');return r;}
async function inspect(s){let v;await s.agent.inspect('owner',UNIT,1,x=>v=x);return v;}
async function fixture(fn){const s=await setup();try{await fn(s);}finally{await s.dispose();}}

test('actual native read and immutable scalar proposal retain style/basis; peer edit stays authoritative, duplicate payload conflicts',()=>fixture(async s=>{
 await value(s,11,'owner',{t:2,s:{cl:{rgb:'#123456'}}});const j=await job(s),read=await s.agent.read('owner',j);
 const output=JSON.parse(read.result);assert.equal(output.book.sheets[TAB].cellData[0][0].v,11);assert.equal(output.nativeBasis.nativeRevision,2);assert.equal(output.nativeBasis.sessionID,undefined);assert.equal(output.nativeBasis.jobID,undefined);assert.equal(output.expected.contentRevision,2);assert.deepEqual(output.book.resources,[]);
 await value(s,22,'peer');const result=await s.agent.propose('owner',j,'call-one',patch(33),read.basis);assert.equal(result.status,'proposed');assert.equal(result.review,'stale');assert.equal(s.head,3);
 const p=(await inspect(s)).proposals[0];assert.equal(p.before.v,11);assert.equal(p.after.v,33);assert.deepEqual(p.style,{cl:{rgb:'#123456'}});assert.deepEqual(p.after.s,p.before.s);assert.equal(p.basis.nativeRevision,2);assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,22);
 assert.deepEqual(await s.agent.propose('owner',j,'call-one',patch(33),read.basis),result);
 await assert.rejects(s.agent.propose('owner',j,'call-one',patch(44),read.basis),/command_conflict/);
 const reopened=new NativeAgent(s.authority,s.service,s.db);reopened.enabled=true;s.agent=reopened;assert.deepEqual((await inspect(s)).proposals[0],p);assert.equal(s.head,3);
 assert.equal((await s.workspace.get('peer',UNIT,true)).nativeAgentProposals,undefined);
}));
test('scoped admission is owner-only, immutable duplicate, opt-in; legacy mutate/save/decide and ordinary command stay closed',()=>fixture(async s=>{
 await assert.rejects(s.agent.admit('peer',UNIT,request()),/access_denied/);
 await assert.rejects(s.workspace.admitCommand('owner',{...request(),workId:UNIT}),/native_collaboration_required/);
 s.agent.enabled=false;await assert.rejects(s.agent.admit('owner',UNIT,request()),/native_collaboration_required/);s.agent.enabled=true;
 const a=await s.agent.admit('owner',UNIT,request());assert.equal(a.admitted,true);assert.equal((await s.agent.admit('owner',UNIT,request())).admitted,false);
 await assert.rejects(s.agent.admit('owner',UNIT,{...request(),text:'different'}),/command_conflict/);
 await assert.rejects(s.workspace.mutate('owner',UNIT,{commandId:'escape',expected:{},patch:JSON.parse(patch(2))}),/native_collaboration_required/);
 await assert.rejects(s.workspace.save('owner',UNIT,{commandId:'escape-save',book:s.initial,contentRevision:1,permissionRevision:1}),/native_collaboration_required/);
 await assert.rejects(s.workspace.decide('owner',UNIT,'anything',{commandId:'escape-accept',decision:'accept',expected:{}}),/native_collaboration_required/);
 assert.equal(s.head,1);
}));
test('read rechecks cancellation, intent, epoch and native head after async SDK load; no stale disclosure',async()=>{
 for(const change of ['cancel','intent','epoch','head','permission'])await fixture(async s=>{
  const j=await job(s);const load=s.service.getUnitLoadDataWithBlocks.bind(s.service);let reached,release;const ready=new Promise(r=>reached=r),wait=new Promise(r=>release=r);
  s.service.getUnitLoadDataWithBlocks=async(...args)=>{const data=await load(...args);reached();await wait;return data;};
  const reading=s.agent.read('owner',j);await ready;
  if(change==='head')await value(s,22,'peer');else if(change==='epoch')await s.workspace.share('owner',UNIT,{commandId:'epoch',peer:'peer',role:'read',accessRevision:1});else if(change==='permission')await s.store.transaction(x=>x.permissionRevision++);else await s.agent.admit('owner',UNIT,{...request('new',1),kind:change==='cancel'?'cancel':'continue'});
  release();await assert.rejects(reading);assert.equal((await s.store.read(x=>x.works[UNIT])).nativeAgentProposals,undefined);
 });
});
test('bounded pinned reads omit formula cache/private resources; stale cursor/expected and forged basis refuse',()=>fixture(async s=>{
 await value(s,999,'owner',{f:'=1+2'});const j=await job(s),reader=createSheetReader(UNIT),read=await s.agent.read('owner',j,undefined,reader),out=JSON.parse(read.result);
 assert.equal(out.book.sheets[TAB].cellData[0][0].f,'=1+2');assert.equal(out.book.sheets[TAB].cellData[0][0].v,undefined);
 await assert.rejects(s.agent.propose('owner',j,'formula',patch(33),read.basis),/scalar_only/);
 await assert.rejects(s.agent.propose('owner',j,'forged',patch(33),structuredClone(read.basis)),/read_required/);
 await assert.rejects(s.agent.read('peer',j),/access_denied/);
 await assert.rejects(s.agent.read('owner',{...j,workId:'foreign'}));
 await value(s,22,'peer',{f:null});await assert.rejects(s.agent.read('owner',j,JSON.stringify({expected:out.expected}),reader),/read_revision_changed/);
 assert.equal(s.head,3);
}));
test('cancelled job cannot propose; crash execution marker remains interrupted with no replay',()=>fixture(async s=>{
 const j=await job(s),read=await s.agent.read('owner',j);await s.workspace.checkpoint('owner',j,'execution_started',{requestId:'retained-request'});
 await s.agent.admit('owner',UNIT,{...request('cancel',1),kind:'cancel'});
 await assert.rejects(s.agent.propose('owner',j,'cancelled',patch(22),read.basis),/work_superseded/);
 await s.workspace.recover('owner',async()=>({uncertain:true,messages:[]}));const stored=await s.store.read(x=>x.jobs.ask);assert.equal(stored.status,'interrupted');assert.deepEqual(stored.requestIds,['retained-request']);assert.equal(await s.workspace.claim('owner'),null);assert.equal(s.head,1);
}));

test('actual DSH host/dispatcher consumes native read and retains peer-stale proposal with checkpoints; fixture provider only', {timeout:25000},()=>fixture(async s=>{
 await value(s,11);s.agent.enabled=false;const root=await mkdtemp(join(tmpdir(),'native-agent-dsh-'));let count=0;
 class Provider extends LlmAdapter {
  providerRetryPolicy(){return {mode:'normal',maxRetries:0,retryableCodes:[],initialDelayMs:0,maxDelayMs:0,jitterRatio:0};}
  async *stream(options){
   assert.deepEqual(options.tools.map(tool => tool.name).sort(), ['edit_sheet', 'read_sheet']);
   const n=++count;if(n===2)await value(s,22,'peer');const block=n===1?{type:'tool-call',id:'read-native',name:'read_sheet',arguments:'{}'}:n===2?{type:'tool-call',id:'propose-native',name:'edit_sheet',arguments:JSON.stringify({patch:patch(33)})}:{type:'text',text:'Fixture: proposed, not applied.'};yield {type:'block-start',index:0,blockType:block.type};yield block.type==='tool-call'?{type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments}:{type:'text-delta',index:0,text:block.text};yield {type:'block-end',index:0,block};yield {type:'usage',usage:{inputTokens:1,outputTokens:1}};yield {type:'finish',reason:{kind:n<3?'tool-calls':'stop'}};}
 }
 const host=await bootHost({stateRoot:root,workspace:s.workspace,principal:'owner',provider:new Provider(),nativeAgent:s.agent}),dispatch=createDispatcher({workspace:s.workspace,principal:'owner',host});
 try{await s.agent.admit('owner',UNIT,request());dispatch.wake();await dispatch.idle();const stored=await s.store.read(x=>x.jobs.ask);assert.equal(count,3);assert.equal(stored.status,'ready',stored.errorCode);assert.equal(stored.phase,'completed');assert.equal(stored.requestIds.length,3);
  const events=(await host.inspect(stored)).events,results=events.filter(e=>e.type==='tool/result');assert.equal(results.length,2);assert.match(JSON.stringify(results[0]),/nativeBasis/);assert.match(JSON.stringify(results[0]),/11/);assert.match(JSON.stringify(results[1]),/proposed/);
  assert.equal((await inspect(s)).proposals[0].review,'stale');assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,22);assert.equal(s.head,3);assert.equal((await s.store.read(x=>x.works[UNIT])).book,undefined);
 }finally{await dispatch.close();await host.close();}
}));

for (const count of [1,129]) test(`a reopened native follow-up includes the corrected value in its first provider input without replaying the old proposal (stored cells: ${count})`, {timeout:25000},t=>fixture(async s=>{
  const cells={};
  for(let i=0;i<count;i++) (cells[Math.floor(i/10)]??={})[i%10]={v:i===0?11:i};
  await values(s,cells);
  const first=await job(s), read=await s.agent.read('owner',first);
  await s.agent.propose('owner',first,'old-call',patch(33),read.basis);
  const history=[{id:'old-answer',role:'assistant',text:'A1 was 11.'}];
  await s.workspace.checkpoint('owner',first,'completed',{messages:history});
  await s.workspace.finish('owner',first,history,'ready');
  await value(s,23,'peer');
  s.agent=new NativeAgent(s.authority,s.service,s.db);
  const reads=t.mock.method(s.agent,'read');
  const prompts=[];
  class Capture extends LlmAdapter {
    async *stream(options){
      prompts.push(options.messages.findLast(m=>m.role==='user').content.map(c=>c.text).join('\n'));
      const block={type:'text',text:'Fixture captured the input.'};
      yield {type:'block-start',index:0,blockType:'text'};
      yield {type:'text-delta',index:0,text:block.text};
      yield {type:'block-end',index:0,block};
      yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  const root=await mkdtemp(join(tmpdir(),'native-followup-'));
  const host=await bootHost({stateRoot:root,workspace:s.workspace,principal:'owner',provider:new Capture(),nativeAgent:s.agent});
  const dispatch=createDispatcher({workspace:s.workspace,principal:'owner',host});
  try{
    const before=await inspect(s), bookBefore=await s.data();
    await s.agent.admit('owner',UNIT,{...request('followup',1),text:'What is twice the current A1? Answer only.'});
    dispatch.wake();await dispatch.idle();
    assert.equal(prompts.length,1);
    assert.match(prompts[0],/A1 was 11/);
    const snapshot=prompts[0].split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(data=>data.nativeBasis);
    assert.ok(snapshot,'first provider request needs the current native sheet alongside older conversation');
    assert.equal(snapshot.nativeBasis.unitID,UNIT);
    assert.equal(snapshot.nativeBasis.nativeRevision,3);
    assert.equal(reads.mock.callCount(),1,'initial context uses one native read');
    if(count===1){
      assert.equal(snapshot.book.sheets[TAB].cellData[0][0].v,23);
    }else{
      assert.equal(snapshot.workbookComplete,false);
      assert.equal(snapshot.sheetId,TAB);
      assert.deepEqual(snapshot.cells[0],{address:'A1',cell:{t:2,v:23}});
      assert.ok(snapshot.cells.length<count);
      assert.equal(snapshot.cells.some(c=>c.address==='I13'),false);
      assert.equal(snapshot.nextCursor,undefined);
      assert.match(prompts[0],/read_sheet for cells outside this page/);
    }
    assert.deepEqual((await inspect(s)).proposals,before.proposals);
    assert.deepEqual(await s.data(),bookBefore);
    assert.equal(s.head,3);
  }finally{await dispatch.close();await host.close();await rm(root,{recursive:true,force:true});}
}));

test('production constructor and authenticated scoped HTTP consume host binding; ordinary route, peer and wrong epoch refuse', {timeout:25000},async()=>{
 const seed=await server();await seed.dispose();seed.db.dispose=async()=>{};
 const {createNativeCollaboration}=await import('../../workagent-server/src/native-collaboration.mjs');
 const {identity}=await import('../../workagent-server/src/http.mjs');
 const origin='http://native-agent.invalid',token='synthetic-owner-native-agent-fixture',peerToken='synthetic-peer-native-agent-fixture';
 const accounts=[{id:'peer',name:'Peer',token:peerToken}],auth=identity({owner:'owner',token,origin,accounts});
 const native=await createNativeCollaboration({dbAdapter:seed.db,workspace:seed.workspace,auth,origin,owner:'owner',mode:'workspace'}),wake=[];
 const handler=createHandler({workspace:seed.workspace,native,owner:'owner',token,origin,accounts,clientRoot:'/unused',onCommand:(...args)=>wake.push(args)});
 async function http(path,input,who='owner') {const req=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(req,{url:path,method:input===undefined?'GET':'POST',headers:{authorization:`Bearer ${who==='owner'?token:peerToken}`,origin,'content-type':'application/json'}});let data;const res={setHeader(){},writeHead(status){this.status=status;},end(v){data=JSON.parse(v);this.writableEnded=true;}};await handler(req,res);return {status:res.status,data};}
 let host;
 try{
  const path=`/api/work/${UNIT}/native-agent/1`;
  assert.equal((await http(path)).status,409);assert.equal((await http(path,request())).status,409);
  class Unused extends LlmAdapter{async *stream(){throw Error('no provider dispatch authorized by this test');}}
  host=await bootHost({stateRoot:await mkdtemp(join(tmpdir(),'native-agent-http-')),workspace:seed.workspace,principal:'owner',nativeAgent:native.authority.agent,provider:new Unused()});
  assert.equal((await http(path)).data.expectedIntentRevision,0);
  assert.equal((await http(path,request(),'peer')).status,403);assert.equal((await http(path,request())).status,202);assert.equal(wake.length,1);assert.equal((await http(path,request())).status,202);assert.equal(wake.length,1);
  assert.equal((await http('/api/work/commands',{...request('legacy'),workId:UNIT})).status,409);
  assert.equal((await http(`/api/work/${UNIT}/native-agent/2`,{...request('wrong',1),accessRevision:2})).status,403);
  assert.equal((await http(path,undefined,'peer')).status,403);
  const claimed=await seed.workspace.claim('owner'),read=await native.authority.agent.read('owner',claimed);assert.equal(JSON.parse(read.result).nativeBasis.unitID,UNIT);
  await native.authority.agent.propose('owner',claimed,'http-call',patch(7),read.basis);
  assert.equal((await http(path)).data.proposals.length,1);assert.equal(seed.head,1);assert.equal((await http(`/api/work/${UNIT}`)).data.proposals,undefined);
  assert.equal((await http(path,{...request('stop',1),kind:'cancel'})).status,202);assert.equal((await http(path)).data.proposals[0].review,'stale');
  await assert.rejects(native.authority.agent.authorize('owner',claimed));
 }finally{await host?.close();await native.close();}
});

test('unsupported patches and post-read revocation cannot produce native writes or proposals; immutable call basis survives later reads',()=>fixture(async s=>{
 await value(s,11);const j=await job(s),read=await s.agent.read('owner',j);
 for(const raw of [JSON.stringify({title:'bad',cells:[]}),JSON.stringify({cells:[{sheetId:TAB,row:0,column:0,value:1,formula:'=1'}]}),JSON.stringify({cells:[{sheetId:TAB,row:0,column:0,value:1},{sheetId:TAB,row:0,column:1,value:2}]}),patch('=1')])await assert.rejects(s.agent.propose('owner',j,'invalid',raw,read.basis),/scalar_only/);
 await assert.rejects(s.agent.propose('owner',j,'foreign-sheet',JSON.stringify({cells:[{sheetId:'__proto__',row:0,column:0,value:1}]}),read.basis),/cell_invalid/);
 const first=await s.agent.propose('owner',j,'stable',patch(7),read.basis);await value(s,22,'peer');const later=await s.agent.read('owner',j);assert.deepEqual(await s.agent.propose('owner',j,'stable',patch(7),later.basis),first);
 const p=(await inspect(s)).proposals[0];assert.equal(p.basis.nativeRevision,2);assert.equal(p.before.v,11);assert.equal(p.review,'stale');
 await s.workspace.share('owner',UNIT,{commandId:'epoch-revoked',peer:'peer',role:null,accessRevision:1});await assert.rejects(s.agent.propose('owner',j,'revoked',patch(33),later.basis));await assert.rejects(inspect(s));let current;await s.agent.inspect('owner',UNIT,2,x=>current=x);assert.deepEqual(current.proposals,[p]);assert.equal(current.proposals[0].review,'stale');assert.equal(s.head,3);
}));

test('owner read response enqueue is fenced against revocation; disabled admission never silently replays a queued native job',()=>fixture(async s=>{
 const j=await job(s),read=await s.agent.read('owner',j);await s.agent.propose('owner',j,'kept',patch(7),read.basis);
 let release,reached;const wait=new Promise(r=>release=r),ready=new Promise(r=>reached=r),get=s.db.getUnit;
 s.db.getUnit=async(...args)=>{const result=await get(...args);reached();await wait;return result;};
 const order=[],reading=s.agent.inspect('owner',UNIT,1,()=>order.push('enqueued'));await ready;
 const revoke=s.workspace.share('owner',UNIT,{commandId:'locked-revoke',peer:'peer',role:null,accessRevision:1}).then(()=>order.push('revoked'));
 await new Promise(setImmediate);assert.deepEqual(order,[]);release();await reading;await revoke;assert.deepEqual(order,['enqueued','revoked']);s.db.getUnit=get;
 await assert.rejects(inspect(s));await s.workspace.finish('owner',j,[],'ready');assert.equal((await s.store.read(x=>x.jobs.ask)).status,'superseded');
 await s.agent.admit('owner',UNIT,{...request('later',1),accessRevision:2});s.agent.enabled=false;assert.equal(await s.workspace.claim('owner'),null);
 const state=await s.store.read(x=>x);assert.equal(state.jobs.later.status,'interrupted');assert.equal(state.jobs.later.errorCode,'native_agent_disabled_no_replay');assert.equal(state.works[UNIT].nativeAgentProposals[Object.keys(state.works[UNIT].nativeAgentProposals)[0]].before,null);assert.equal(s.head,1);
}));
test('current owner retains same-unit historical results after sharing; original evidence stays immutable and stale',()=>fixture(async s=>{
 await value(s,11);const j=await job(s),read=await s.agent.read('owner',j);await s.agent.propose('owner',j,'historical',patch(33),read.basis);const messages=[{id:'answer',role:'assistant',text:'Retained answer'}];await s.workspace.checkpoint('owner',j,'completed',{messages});await s.workspace.finish('owner',j,messages,'ready');
 const original=(await inspect(s)).proposals[0];assert.equal(original.review,'pending');
 // In-memory adversarial records test projection isolation, not provider output.
 await s.store.transaction(x=>{x.jobs.foreignUnit={...structuredClone(x.jobs.ask),id:'foreignUnit',workId:'foreign'};x.jobs.foreignPrincipal={...structuredClone(x.jobs.ask),id:'foreignPrincipal',principal:'peer'};
 const p=x.works[UNIT].nativeAgentProposals;x.works.foreign={nativeAgentProposals:{foreign:structuredClone(original)}};p.foreignPrincipal={...structuredClone(original),id:'foreignPrincipal',principal:'peer'};p.foreignUnit={...structuredClone(original),id:'foreignUnit',basis:{...original.basis,unitID:'foreign'}};});
 await s.workspace.share('owner',UNIT,{commandId:'retain-on-share',peer:'peer',role:'read',accessRevision:1});const before=await s.store.read(x=>x),head=s.head;
 let result;await s.agent.inspect('owner',UNIT,2,x=>result=x);
 assert.deepEqual(result.jobs.map(x=>x.id),[j.id]);assert.equal(result.jobs[0].status,'ready');assert.deepEqual(result.jobs[0].messages,before.jobs[j.id].messages);
 assert.equal(result.proposals.length,1);assert.deepEqual(result.proposals[0],{...original,review:'stale'});assert.equal(result.proposals[0].basis.accessRevision,1);
 await assert.rejects(s.agent.inspect('owner',UNIT,1,()=>assert.fail('old epoch disclosed')));
 await assert.rejects(s.agent.inspect('peer',UNIT,2,()=>assert.fail('peer disclosed')));
 await assert.rejects(s.agent.inspect('owner','foreign',2,()=>assert.fail('foreign unit disclosed')));
 assert.deepEqual(await s.store.read(x=>x),before);assert.equal(s.head,head);assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,11);
}));
test('inspection rechecks owner and epoch after async head read before enqueue (authority invalidation fixture)',async()=>{
 for(const change of ['owner','epoch','enabled'])await fixture(async s=>{
  const j=await job(s),read=await s.agent.read('owner',j);await s.agent.propose('owner',j,'retained',patch(33),read.basis);
  const before=await s.store.read(x=>x),head=s.head,check=s.authority.check.bind(s.authority),get=s.db.getUnit;let held,sent=false;
  s.authority.check=(state,...args)=>{held=state;return check(state,...args);};
  // Simulated invalidation of the transaction's authority while the real native
  // head read awaits; concurrent Workspace.share serialization is tested above.
  s.db.getUnit=async(...args)=>{const result=await get(...args);await new Promise(setImmediate);if(change==='owner')held.owner='peer';else if(change==='epoch')held.works[UNIT].accessRevision++;else s.agent.enabled=false;return result;};
  await assert.rejects(s.agent.inspect('owner',UNIT,1,()=>{sent=true;}));assert.equal(sent,false);assert.deepEqual(await s.store.read(x=>x),before);assert.equal(s.head,head);
 });
});

test('merged native target cannot become scalar proposal; unrelated target remains reviewable without native writes',()=>fixture(async s=>{
 const merged=await s.service.submitChangeset({changeset:{unitID:UNIT,type:2,userID:'owner',memberID:'owner',sid:'merge-agent-proof',reqId:1,baseRev:s.head,revision:s.head+1,mutations:[{id:'sheet.mutation.add-worksheet-merge',data:JSON.stringify({unitId:UNIT,subUnitId:TAB,ranges:[{startRow:0,endRow:0,startColumn:0,endColumn:1}]})}]}},{userID:'owner',memberID:'owner'});assert.equal(merged.status,'committed');
 const j=await job(s),read=await s.agent.read('owner',j),head=s.head;await assert.rejects(s.agent.propose('owner',j,'merged',patch(33),read.basis),/native_agent_merged_target/);
 const good=await s.agent.propose('owner',j,'outside',JSON.stringify({cells:[{sheetId:TAB,row:0,column:2,value:44}]}),read.basis);assert.equal(good.status,'proposed');assert.equal(s.head,head);
}));

test('additional worksheet reads stay identified; proposal writes remain explicitly original-sheet scoped',()=>fixture(async s=>{
 const {mergeWorksheetSnapshotWithDefault}=await import('@univerjs/core');
 const sheet=mergeWorksheetSnapshotWithDefault({id:'second',name:'Second'});
 const added=await s.service.submitChangeset({changeset:{unitID:UNIT,type:2,userID:'owner',memberID:'owner',sid:'agent-tabs-fixture',reqId:1,baseRev:s.head,revision:s.head+1,mutations:[{id:'sheet.mutation.insert-sheet',data:JSON.stringify({unitId:UNIT,index:1,sheet})}]}},{userID:'owner',memberID:'owner'});assert.equal(added.status,'committed');
 const j=await job(s),read=await s.agent.read('owner',j);assert.equal(JSON.parse(read.result).book.sheets.second.name,'Second');
 const head=s.head;await assert.rejects(s.agent.propose('owner',j,'wrong-tab',JSON.stringify({cells:[{sheetId:'second',row:0,column:0,value:99}]}),read.basis),/native_agent_cell_invalid/);assert.equal(s.head,head);assert.equal((await inspect(s)).proposals.length,0);
 assert.equal((await s.agent.propose('owner',j,'original-tab',patch(33),read.basis)).status,'proposed');assert.equal(s.head,head);
}));
