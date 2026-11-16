// Actual public command interception; helper network/session/storage doubles.
// Not browser, live transport or durability qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Subject, BehaviorSubject } from 'rxjs';
import { SessionStatus } from '@univerjs-pro/collaboration-client';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { nativeReversal, reversalCandidate, guardReversalInput } from '../src/native-reversal.ts';
import { client, UNIT, TAB } from '../../workagent-server/tests/native-history-sdk.test.mjs';
import { blank } from '../../workagent-server/tests/native-comments-sdk.test.mjs';
import { SetRangeValuesCommand, SetRangeValuesMutation } from '@univerjs/sheets';
const session={principal:'owner',binding:'binding',unitID:'A',access:{role:'owner',revision:1}};
const mutation={id:'sheet.mutation.set-range-values',data:JSON.stringify({unitId:'A',subUnitId:'sheet-1',cellValue:{0:{0:{t:2,v:11,f:null,si:null,s:'0',ft:null,fd:null}}},styleRefMap:{'0':{cl:{rgb:'#1B1C1F'}}}})};
const ack={unitID:'A',type:2,baseRev:1,revision:2,userID:'owner',memberID:'self',sid:'native-sid',reqId:1,mutations:[mutation]};
const flush=async()=>{for(let i=0;i<4;i++)await new Promise(setImmediate);};
function fixture(saved=new Map(),settings={}){
 const events=new Subject(),status=new BehaviorSubject(SessionStatus.ONLINE),views=[],calls=[],actions=[];let busy=false,head=2,mode='ok',prepared,receiptStatus='unknown',release;
 const storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
 const native={event$:events,sessionStatus$:status,get sessionStatus(){return status.value;},getMemberID:()=> 'self'};
 const fetcher=async(url,options={})=>{
  calls.push({url,options});if(mode==='hold')await new Promise(r=>release=r);if(mode==='lost')throw Error('response lost');if(mode==='denied')return {ok:false,status:403};
  if(options.method==='POST'&&url.endsWith('/abandon')){prepared={...prepared,disposition:'rejected',reason:'native_reversal_abandoned_unused'};receiptStatus='rejected';if(mode==='cancel-lost')throw Error('cancel reply lost');return {ok:true,json:async()=>prepared};}
  if(options.method==='POST'){assert.ok([...saved.values()].some(v=>JSON.parse(v).length),'identity retained before POST');const input=JSON.parse(options.body);prepared={id:input.commandId,disposition:'unknown',actionPath:`/api/native/A/1/reversal/${input.commandId}/universer-api`,preview:{sheetID:'sheet-1',row:0,col:0,before:null,after:{v:11}}};return {ok:true,json:async()=>prepared};}
  if(!prepared)return {ok:false,status:404};return {ok:true,json:async()=>({...prepared,disposition:receiptStatus,revision:receiptStatus==='committed'?3:undefined,request:actions.length?{...ack,memberID:'executor',baseRev:2,revision:3,sid:'reserved-inverse'}:undefined})};
 };
 const open=async()=>{const action={memberID:'executor',disposed:0,posts:[],async submit(request){this.posts.push(structuredClone(request));if(mode==='submit-lost')throw Error('native response lost');receiptStatus='committed';},dispose(){this.disposed++;}};actions.push(action);if(mode==='action-hold')await new Promise(r=>release=r);return action;};
 const helper=nativeReversal({...session,...settings},native,()=>head,()=>busy,v=>views.push(v),fetcher,storage,open,async v=>createHash('sha256').update(v).digest('hex'));
 return {helper,events,status,views,calls,saved,actions,emit(c=ack){events.next({eventID:CollaborationEvent.CHANGESET_ACK,data:c});},setBusy:v=>busy=v,setHead:v=>head=v,setMode:v=>mode=v,release:()=>release?.(),restore:v=>{prepared=v;receiptStatus=v.disposition;},view:()=>views.at(-1)};
}
test('exact own scalar ACK hashes protocol mutations; other tab/batch/formula/peer revision cannot become candidate',async()=>{
 const f=fixture();f.emit({...ack,memberID:'other-tab'});await flush();assert.equal(f.view().canPreview,false);
 f.emit();await flush();assert.equal(f.view().canPreview,true);await f.helper.preview();
 const sent=JSON.parse(f.calls[0].options.body);assert.equal(sent.hash,createHash('sha256').update(JSON.stringify(ack.mutations)).digest('hex'));
 assert.equal(reversalCandidate({...ack,mutations:[mutation,mutation]},'A'),false);
 assert.equal(reversalCandidate({...ack,mutations:[{...mutation,data:JSON.stringify({unitId:'A',subUnitId:'sheet-1',cellValue:{0:{0:{v:11,f:'=11'}}}})}]},'A'),false);
 f.events.next({eventID:CollaborationEvent.NEW_CHANGESETS,data:{...ack,revision:3,userID:'peer'}});assert.equal(f.view().canConfirm,false);f.helper.dispose();
});
test('prepare/confirm once, busy input preserves preview; receipt records server completion separately from live revision',async()=>{
 const f=fixture();f.emit();await flush();await f.helper.preview();assert.equal(f.view().canConfirm,true);
 for(const input of ['cell','paste','composition','pending']){f.setBusy(true);await f.helper.confirm();assert.equal(f.actions.length,0,input);assert.equal(f.view().canConfirm,false);f.setBusy(false);}
 await Promise.all([f.helper.confirm(),f.helper.confirm()]);assert.equal(f.actions.length,1);assert.equal(f.actions[0].posts.length,1);assert.equal(f.actions[0].disposed,1);assert.equal(f.view().disposition,'committed');assert.match(f.view().message,/Waiting for the live editor/);f.setHead(3);f.helper.refresh();assert.match(f.view().message,/Live editor has reached/);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);f.helper.dispose();
});
test('prepare lost response persists identity; remount and explicit checks are GET-only, never new ID or action',async()=>{
 const f=fixture();f.emit();await flush();f.setMode('lost');await f.helper.preview();const retained=[...f.saved.values()][0];f.helper.dispose();
 const fresh=fixture(f.saved);assert.equal(fresh.calls.length,0);await fresh.helper.check();await fresh.helper.preview();await fresh.helper.confirm();assert.ok(fresh.calls.every(c=>!c.options.method));assert.equal(fresh.actions.length,0);assert.equal([...f.saved.values()][0],retained);fresh.helper.dispose();
});
test('lost submit response, disconnect and remount preserve attempted identity; check never resubmits',async()=>{
 const f=fixture();f.emit();await flush();await f.helper.preview();f.setMode('submit-lost');await f.helper.confirm();assert.equal(f.actions[0].posts.length,1);assert.equal(f.actions[0].disposed,1);
 f.status.next(SessionStatus.OFFLINE);f.status.next(SessionStatus.ONLINE);await f.helper.confirm();f.setMode('ok');await f.helper.check();assert.equal(f.actions[0].posts.length,1);assert.equal(f.view().disposition,'unknown');const retained=[...f.saved.values()][0];f.helper.dispose();
 const fresh=fixture(f.saved);await fresh.helper.confirm();assert.equal(fresh.actions.length,0);assert.equal([...f.saved.values()][0],retained);fresh.helper.dispose();
});
test('new pending write invalidates preview; stale/disposed fetch and 403 hide private preview without removing metadata',async()=>{
 const f=fixture();f.emit();await flush();await f.helper.preview();f.helper.refresh(true);await f.helper.confirm();assert.equal(f.actions.length,0);
 f.setMode('denied');await f.helper.check();assert.equal(f.view().preview,undefined);assert.ok(f.saved.size);f.helper.dispose();
 const g=fixture();g.emit();await flush();g.setMode('hold');const pending=g.helper.preview();g.helper.dispose();g.release();await pending;assert.equal(g.view().preview,undefined);assert.ok(g.saved.size);assert.equal(g.calls[0].options.signal.aborted,true);
 const reader=fixture(new Map(),{access:{role:'read',revision:1}});reader.emit();await flush();await reader.helper.preview();assert.equal(reader.calls.length,0);reader.helper.dispose();
});
test('new input during action admission prevents POST; owned action is disposed, identity remains unknown',async()=>{
 const f=fixture();f.emit();await flush();await f.helper.preview();f.setMode('action-hold');const pending=f.helper.confirm();await flush();assert.equal(f.view().locked,true);f.setBusy(true);f.release();await pending;
 assert.equal(f.actions[0].posts.length,0);assert.equal(f.actions[0].disposed,1);assert.equal(f.view().locked,false);assert.equal(JSON.parse([...f.saved.values()][0])[0].attempted,true);f.helper.dispose();
});
test('actual instance command guard blocks local sync/async edits only during action, passes native remote mutations and preserves undo stack',async()=>{
 const c=client(blank(UNIT),'owner');let locked=true;const guard=guardReversalInput(c.commands,()=>locked);
 const p={unitId:UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:0,endColumn:0},value:{v:5}};
 try{assert.equal(await c.commands.executeCommand(SetRangeValuesCommand.id,p),false);assert.equal(c.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:UNIT,subUnitId:TAB,cellValue:{0:{0:{v:5}}}}),false);assert.equal(c.cell(0,0),null);
 assert.equal(c.commands.syncExecuteCommand(SetRangeValuesMutation.id,{unitId:UNIT,subUnitId:TAB,cellValue:{0:{0:{v:22}}}},{fromCollab:true}),true);assert.equal(c.cell(0,0),22);locked=false;assert.equal(await c.commands.executeCommand(SetRangeValuesCommand.id,p),true);assert.equal(c.cell(0,0),5);
 }finally{guard.dispose();c.dispose();}
});
test('action adapter uses actual endpoint HELLO/JOIN and public Session, submits once and disposes only its inert connection',async()=>{
 const {openReversalAction}=await import('../src/native-reversal-action.ts');
 const {fixture:serverFixture,origin}=await import('../../workagent-server/tests/native-undo-delivery-fixture.mjs');
 const s=await serverFixture(),sockets=[];let submits=0;
 class InertSocket extends EventTarget {
  constructor(url){super();this.pending=[];this.closed=false;sockets.push(this);this.start(url);}
  task(p){this.pending.push(p);p.catch(()=>this.dispatchEvent(new Event('error')));}
  async start(url){try{
   const req={url:new URL(url).pathname+new URL(url).search,method:'GET',headers:{origin,host:'native-proof.invalid'},fixturePrincipal:'owner',nativeUnitID:UNIT,nativeAccess:{userID:'owner',unitID:UNIT,revision:1}};
   await s.routes['upgrade /universer-api/comb/connect']({incomingMessage:req,customData:{},params:{},reject(){throw Error('admission failed');},accept:h=>this.handlers=h});
   this.connection={id:'actual-adapter-inert',customData:{},send:data=>this.dispatchEvent(new MessageEvent('message',{data})),close:()=>this.close()};
   await this.handlers.open({connection:this.connection});this.dispatchEvent(new Event('open'));
  }catch{this.dispatchEvent(new Event('error'));}}
  send(data){this.task(this.handlers.message({connection:this.connection,data,customData:{}}));}
  close(){if(this.closed)return;this.closed=true;this.task(this.handlers.close({connection:this.connection,code:1000,reason:'owned action complete'}));this.dispatchEvent(new Event('close'));}
 }
 const fetcher=async(url,options)=>{
  if(url.endsWith('/user/session-ticket')){const r=await s.http('get','/universer-api/user/session-ticket','owner');return {ok:true,json:async()=>r.body};}
  submits++;const input=JSON.parse(options.body);assert.equal(input.memberID,input.changeset.memberID);
  const handler=s.routes['post /universer-api/comb/:type/unit/:unitID/new_changes'];let output;
  await s.scope('owner',()=>handler({incomingMessage:{method:'POST',url:'/',headers:{origin},nativeUnitID:UNIT,nativeAccess:{userID:'owner',unitID:UNIT,revision:1}},userID:'owner',customData:{},params:{type:'2',unitID:UNIT},readJson:async()=>input,response:{setHeader(){},end:v=>output=v}}));return {ok:true,json:async()=>JSON.parse(output)};
 };
 let action;
 try{
  action=await openReversalAction(UNIT,`/api/native/${UNIT}/1/reversal/proof/universer-api`,'binding',new AbortController().signal,fetcher,url=>new InertSocket(url),origin);
  assert.equal(s.authority.sessions.size,1);assert.equal(s.authority.sessions.get(action.memberID).userID,'owner');
  const request={unitID:UNIT,type:2,baseRev:1,revision:2,userID:'owner',memberID:action.memberID,sid:'adapter-proof',reqId:1,mutations:[{id:SetRangeValuesMutation.id,data:JSON.stringify({unitId:UNIT,subUnitId:TAB,cellValue:{0:{0:{v:17}}}})}]};
  await action.submit(request);assert.equal(s.head,2);await assert.rejects(action.submit(request),/again/);assert.equal(submits,1);
  action.dispose();await Promise.all(sockets[0].pending);assert.equal(s.authority.sessions.size,0);assert.equal(sockets.length,1);assert.equal(sockets[0].closed,true);
 }finally{action?.dispose();for(const ws of sockets){ws.close();await Promise.all(ws.pending);}await s.dispose();}
});

test('explicit unused abandonment recovers new ACK without forgetting old identity or replacing its target',async()=>{
 const f=fixture();try{f.emit();await flush();await f.helper.preview();const old=f.view().retainedID;
 f.helper.refresh(true);f.setHead(3);f.emit({...ack,baseRev:2,revision:3,reqId:2});await flush();assert.equal(f.view().canPreview,false);assert.equal(f.view().canAbandon,true);
 await f.helper.abandon();assert.equal(f.view().canPreview,true);assert.equal(f.actions.length,0);await f.helper.preview();assert.notEqual(f.view().retainedID,old);
 const records=JSON.parse([...f.saved.values()][0]);assert.equal(records.length,2);assert.equal(records[0].disposition,'rejected');assert.equal(records[0].attempted,false);
 }finally{f.helper.dispose();}
 const g=fixture();try{g.emit();await flush();await g.helper.preview();await g.helper.abandon();assert.equal(g.view().canPreview,false);const count=g.calls.length;await g.helper.preview();assert.equal(g.calls.length,count);}finally{g.helper.dispose();}
});
test('lost abandonment response retains identity, disables confirm/repost and remount resolves by GET only',async()=>{
 const f=fixture();f.emit();await flush();await f.helper.preview();const id=f.view().retainedID;f.setMode('cancel-lost');await f.helper.abandon();assert.equal(f.view().canConfirm,false);assert.equal(f.view().canAbandon,false);const count=f.calls.length;await f.helper.abandon();assert.equal(f.calls.length,count);f.helper.dispose();
 const fresh=fixture(f.saved);try{fresh.restore({id,disposition:'rejected',reason:'native_reversal_abandoned_unused'});await fresh.helper.check();assert.equal(fresh.view().disposition,'rejected');assert.ok(fresh.calls.every(c=>!c.options.method));assert.equal(fresh.actions.length,0);}finally{fresh.helper.dispose();}
 const g=fixture();try{g.emit();await flush();await g.helper.preview();g.setMode('submit-lost');await g.helper.confirm();assert.equal(g.view().canAbandon,false);const count=g.calls.length;await g.helper.abandon();assert.equal(g.calls.length,count);}finally{g.helper.dispose();}
});
