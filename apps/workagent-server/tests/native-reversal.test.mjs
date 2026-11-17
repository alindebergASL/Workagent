// Actual SDK/endpoint/HTTP handler, inert NodeRouter connections and memory stores.
// No listener, SQLite/PG persistence or browser input/recovery evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { SetRangeValuesCommand, SetRangeValuesMutation } from '@univerjs/sheets';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { NativeReversal } from '../src/native-reversal.mjs';
import { createHandler,identity } from '../src/http.mjs';
import { fixture,connect,wait,origin } from './native-undo-delivery-fixture.mjs';
import { UNIT,TAB } from './native-history-sdk.test.mjs';
const token='synthetic-reversal-owner-credential-0123456789',peer='synthetic-reversal-peer-credential-0123456789';
const hash=c=>createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex');
async function setup(){
 const s=await fixture(),auth=identity({owner:'owner',token,origin,accounts:[{id:'peer',name:'Peer',token:peer}]});
 s.authority.reversal=new NativeReversal(s.authority,s.service,s.db);
 let action;
 const binding=principal=>auth.sessionBinding({headers:{authorization:`Bearer ${principal==='owner'?token:peer}`}});
 for(const [key,handler] of Object.entries(s.routes))s.routes[key]=async c=>{
   const principal=c.incomingMessage.fixturePrincipal;
   if(c.accept){const accept=c.accept;c.accept=h=>accept({...h,open:x=>{x.connection.id=randomUUID();return h.open(x);}});}
   c.incomingMessage.nativeBinding=binding(principal);c.incomingMessage.nativeAction=action?{id:action,binding:binding(principal)}:undefined;
   c.customData={workagentAction:c.incomingMessage.nativeAction};c.params={unitID:UNIT,type:'2'};
   if(action)await s.authority.reversal.action(principal,UNIT,c.incomingMessage.nativeAccess,c.incomingMessage.nativeAction);
   return s.authority.scope.run({unitID:UNIT,session:c.incomingMessage.nativeAccess,action:c.incomingMessage.nativeAction},()=>handler(c));
 };
 const handler=createHandler({workspace:s.workspace,native:{authority:s.authority},owner:'owner',token,origin,accounts:[{id:'peer',name:'Peer',token:peer}],clientRoot:'/unused'});
 const api=async(input,id,principal='owner',epoch=1)=>{
  const req=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(req,{url:`/api/work/${UNIT}/native-reversal/${epoch}${id?'/'+id:''}`,method:input===undefined?'GET':'POST',headers:{authorization:`Bearer ${principal==='owner'?token:peer}`,origin,'content-type':'application/json'}});
  let data;const res={setHeader(){},writeHead(status){this.status=status;},end(v){data=JSON.parse(v);this.writableEnded=true;}};await handler(req,res);return {status:res.status,data};
 };
 const connections=[];
 return Object.assign(s,{api,binding,async open(principal='owner',intent){action=intent;try{const c=await connect(s,principal);connections.push(c);return c;}finally{action=undefined;}},
  async submit(c,changeset,intent){action=intent;try{return await s.http('post','/universer-api/comb/:type/unit/:unitID/new_changes',s.authority.sessions.get(c.memberID).userID,{unitID:UNIT,type:2,memberID:c.memberID,changeset});}finally{action=undefined;}},
  async close(){for(const c of connections.reverse())await c.dispose();await s.dispose();}
 });
}
const target=(c,commandId='reverse-one')=>({commandId,revision:c.revision,memberID:c.memberID,sid:c.sid,reqId:c.reqId,hash:hash(c)});
async function edit(s,c,value,col=0){
 const principal=s.authority.sessions.get(c.memberID).userID;
 return c.local.run({service:{submitChangeset:async({changeset})=>{
  await s.submit(c,changeset);await wait(()=>c.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.sid===changeset.sid&&e.data.reqId===changeset.reqId));
  return {status:'committed',changeset:c.events.find(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.sid===changeset.sid&&e.data.reqId===changeset.reqId).data};
 }}},SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:col,endColumn:col},value:{v:value}});
}
async function withFixture(fn){const s=await setup();try{await fn(s);}finally{await s.close();}}
test('production preparation/action admission/HTTP native commit/owned receipt; exact duplicate and no implicit resend',()=>withFixture(async s=>{
 const a=await s.open(),p=await s.open('peer');const original=await edit(s,a,11);
 const prep=await s.api(target(original.changeset));assert.equal(prep.status,200,JSON.stringify(prep));assert.equal(prep.data.disposition,'unknown');assert.equal(prep.data.request,undefined);
 assert.equal((await s.api(target(original.changeset))).data.id,prep.data.id);assert.equal(s.head,2);
 assert.equal((await s.api(undefined,prep.data.id,'peer')).status,409);
 const executor=await s.open('owner',prep.data.id);assert.notEqual(executor.memberID,a.memberID);
 const receipt=await s.api(undefined,prep.data.id);assert.equal(receipt.data.disposition,'unknown');assert.equal(receipt.data.request.memberID,executor.memberID);
 const request=receipt.data.request;
 await s.submit(executor,request,prep.data.id);await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK));
 assert.equal(s.head,3);assert.equal((await s.data()).sheets[TAB].cellData[0]?.[0]?.v??null,null);
 assert.equal((await s.api(undefined,prep.data.id)).data.disposition,'committed');
 await s.submit(executor,request,prep.data.id);assert.equal(s.head,3);
 assert.ok(a.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===3));assert.ok(p.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===3));
 // Purpose session cannot fall through to ordinary editing on either route.
 const forged={...request,sid:'ordinary-spoof',reqId:2};await s.submit(executor,forged);await s.submit(executor,forged,prep.data.id);await s.submit(a,request);
 assert.equal(s.head,3);assert.equal((await s.api(undefined,prep.data.id)).data.disposition,'committed');
}));
test('prepare then peer commit causes definitive native refusal, retained receipt and no peer loss',()=>withFixture(async s=>{
 const a=await s.open(),p=await s.open('peer'),original=await edit(s,a,11);
 p.local.receive(p.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS).data);
 const prep=await s.api(target(original.changeset)),executor=await s.open('owner',prep.data.id),request=(await s.api(undefined,prep.data.id)).data.request;
 await edit(s,p,22);await s.submit(executor,request,prep.data.id);
 await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.PERMISSION_REJ));
 const receipt=await s.api(undefined,prep.data.id);assert.equal(receipt.data.disposition,'rejected',JSON.stringify(receipt));assert.equal(receipt.data.reason,'native_reversal_head_changed');assert.equal(s.head,3);assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,22);
}));
test('target identity is exact and epoch fences receipts',()=>withFixture(async s=>{
 const a=await s.open(),original=await edit(s,a,11),t=target(original.changeset);
 for(const bad of [{...t,hash:'0'.repeat(64)},{...t,memberID:'unknown'},{...t,reqId:99},{...t,revision:3}])assert.equal((await s.api(bad)).status,409,JSON.stringify(bad));
 const prep=await s.api(t);assert.equal(prep.status,200);assert.equal((await s.api({...t,hash:'0'.repeat(64)})).status,409);
 await s.workspace.share('owner',UNIT,{commandId:'epoch-change',peer:'peer',role:'read',accessRevision:1});
 assert.equal((await s.api(undefined,prep.data.id)).status,403);assert.equal((await s.api(undefined,prep.data.id,'owner',2)).status,409);
}));
async function protocolEdit(s,c,mutations){
 const before=c.events.length,principal=s.authority.sessions.get(c.memberID).userID;
 const changeset={unitID:UNIT,type:2,userID:principal,memberID:c.memberID,baseRev:s.head,revision:s.head+1,sid:'scalar-'+randomUUID(),reqId:1,mutations};
 await s.submit(c,changeset);await wait(()=>c.events.slice(before).some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK));return c.events.slice(before).find(e=>e.eventID===CollaborationEvent.CHANGESET_ACK).data;
}
const mutation=(cell,col=0,style='#1B1C1F')=>({id:SetRangeValuesMutation.id,data:JSON.stringify({unitId:UNIT,subUnitId:TAB,cellValue:{0:{[col]:cell}},trigger:'sheet.command.set-range-values',...(cell.s?{styleRefMap:{[cell.s]:{cl:{rgb:style}}}}:{})})});
const browserCell=v=>({t:2,v,f:null,si:null,s:'0',ft:null,fd:null});
test('actual browser scalar/style envelope inverse restores full prior cell and color, preserves peer cell',()=>withFixture(async s=>{
 const a=await s.open(),peer=await s.open('peer');await protocolEdit(s,peer,[mutation({v:77},1)]);
 await protocolEdit(s,a,[mutation(browserCell(11),0,'#0000FF')]);
 const before=await s.data(),old=structuredClone(before.sheets[TAB].cellData[0][0]);
 const original=await protocolEdit(s,a,[mutation(browserCell(22))]);
 const prep=await s.api(target(original));assert.equal(prep.status,200,JSON.stringify(prep));
 const executor=await s.open('owner',prep.data.id),request=(await s.api(undefined,prep.data.id)).data.request;
 await s.submit(executor,request,prep.data.id);await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK));
 const after=await s.data(),cell=after.sheets[TAB].cellData[0][0];
 const resolved=(cell,styles)=>({...cell,s:styles[cell.s]});
 assert.deepEqual(resolved(cell,after.styles),resolved(old,before.styles));assert.deepEqual(after.styles[cell.s],before.styles[old.s]);assert.equal(after.styles[cell.s].cl.rgb,'#0000FF');assert.equal(after.sheets[TAB].cellData[0][1].v,77);
 assert.equal((await s.api(undefined,prep.data.id)).data.disposition,'committed');
}));
test('formula, rich text, unknown fields, multiple cells and multiple mutations cannot prepare; repeated equal operations retain distinct identities',()=>withFixture(async s=>{
 const a=await s.open();
 for(const mutations of [[mutation({v:1,f:'=1'})],[mutation({v:1,p:{body:{dataStream:'x\r\n'}}})],[mutation({v:1,custom:{x:1}})],[mutation({v:1}),mutation({v:2},1)]]){
  const c=await protocolEdit(s,a,mutations);assert.equal((await s.api(target(c,'unsupported-'+c.revision))).status,409);
 }
 const first=await protocolEdit(s,a,[mutation({v:11},2)]),second=await protocolEdit(s,a,[mutation({v:11},2)]);
 assert.equal(hash(first),hash(second));assert.notEqual(first.sid,second.sid);assert.equal((await s.api(target(first,'old'))).status,409);
 assert.equal((await s.api({...target(second),sid:first.sid})).status,409);
 assert.equal((await s.api(target(second))).status,200);
 const other=await s.open();assert.equal((await s.api({...target(second,'other-tab'),memberID:other.memberID})).status,409);
}));
test('wrong inverse cannot consume intent; unknown receipt and recreated backend never resend',()=>withFixture(async s=>{
 const a=await s.open(),c=await edit(s,a,11),prep=await s.api(target(c.changeset)),executor=await s.open('owner',prep.data.id),request=(await s.api(undefined,prep.data.id)).data.request;
 await s.submit(executor,{...request,mutations:[mutation({v:999})]},prep.data.id);assert.equal(s.head,2);
 s.authority.reversal=new NativeReversal(s.authority,s.service,s.db);
 assert.equal((await s.api(undefined,prep.data.id)).data.disposition,'unknown');assert.deepEqual((await s.api(undefined,prep.data.id)).data.request,request);assert.equal(s.head,2);
 const visible=await s.workspace.get('owner',UNIT,true);assert.equal(visible.nativeReversals,undefined);
}));
test('revocation after native history read prevents preparation response and retained intent',()=>withFixture(async s=>{
 const p=await s.open('peer'),c=await edit(s,p,11);let reached,release;
 const waiting=new Promise(r=>reached=r),blocked=new Promise(r=>release=r),read=s.service.getChangesets.bind(s.service);
 s.service.getChangesets=async(...args)=>{const result=await read(...args);reached();await blocked;return result;};
 const pending=s.api(target(c.changeset),undefined,'peer');await waiting;
 await s.workspace.share('owner',UNIT,{commandId:'revoke-during-prepare',peer:'peer',role:null,accessRevision:1});release();
 const result=await pending;assert.equal(result.status,403);assert.equal(result.data.preview,undefined);
 assert.equal(await s.store.read(state=>Object.keys(state.works[UNIT].nativeReversals??{}).length),0);assert.equal(s.head,2);
}));
test('public normal and action route parsing binds authenticated HTTP session without accepting browser claims',async()=>{
 const {nativeRoute}=await import('../src/native-workspace.mjs');
 const auth=identity({owner:'owner',token,origin});
 const request={method:'GET',url:`/api/native/${UNIT}/1/reversal/owned-intent/universer-api/user/session-ticket`,headers:{authorization:`Bearer ${token}`,origin}};
 nativeRoute(request,origin,auth);assert.equal(request.nativeAction.id,'owned-intent');assert.equal(request.nativeAction.binding,auth.sessionBinding(request));assert.equal(request.url,'/universer-api/user/session-ticket');
 const cookie=auth.login(token),other={headers:{cookie:`workagent_session=${cookie}`}};assert.notEqual(auth.sessionBinding(other),request.nativeAction.binding);
});
test('production workspace constructor consumes reversal module without opening a listener',async()=>{
 const {createNativeCollaboration}=await import('../src/native-collaboration.mjs');
 const s=await fixture();await s.dispose();s.db.dispose=async()=>{};
 const auth=identity({owner:'owner',token,origin});
 const native=await createNativeCollaboration({dbAdapter:s.db,workspace:s.workspace,auth,origin,owner:'owner',mode:'workspace'});
 try{assert.ok(native.authority.reversal instanceof NativeReversal);assert.equal(native.authority.unitID,null);assert.equal(native.authority.sessions.size,0);assert.equal(s.head,1);}finally{await native.close();}
});
test('peer commit after action admission but before native commit is fenced under actual commit transaction',()=>withFixture(async s=>{
 const a=await s.open(),p=await s.open('peer'),original=await edit(s,a,11);
 const prep=await s.api(target(original.changeset)),executor=await s.open('owner',prep.data.id),request=(await s.api(undefined,prep.data.id)).data.request;
 let reached,release;const waiting=new Promise(r=>reached=r),blocked=new Promise(r=>release=r);
 s.service.use('submitChangeset',async(c,next)=>{if(c.request.changeset.sid===request.sid){reached();await blocked;}await next();});
 const pending=s.submit(executor,request,prep.data.id);await waiting;
 // Direct scoped native submission here avoids the fixture's shared HTTP action
 // selector; the peer is still legitimately admitted and native commit is real.
 const peerRequest={unitID:UNIT,type:2,userID:'peer',memberID:p.memberID,sid:'race-peer',reqId:1,baseRev:s.head,revision:s.head+1,mutations:[mutation({v:22})]};
 const peer=await s.scope('peer',()=>s.service.submitChangeset({changeset:peerRequest},{userID:'peer',memberID:p.memberID}));assert.equal(peer.status,'committed');release();await pending;
 assert.equal(s.head,3);assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,22);assert.equal((await s.api(undefined,prep.data.id)).data.disposition,'rejected');
}));
test('retained unresolved target refuses a new command ID without changing the original receipt or native identity',()=>withFixture(async s=>{
 const a=await s.open(),original=await edit(s,a,11),first=target(original.changeset,'retained-a');
 assert.equal((await s.api(first)).status,200);
 const before=await s.store.read(state=>state.works[UNIT].nativeReversals),head=s.head;
 const refused=await s.api({...first,commandId:'retained-b'});
 assert.equal(refused.status,409);assert.equal(refused.data.error,'native_reversal_target_retained');
 assert.deepEqual(await s.store.read(state=>state.works[UNIT].nativeReversals),before);
 assert.equal(s.head,head);assert.equal((await s.api(first)).data.id,'retained-a');
 // A new, acknowledged native operation remains a distinct explicit target.
 const next=await edit(s,a,22,1),other=await s.api(target(next.changeset,'different-operation'));
 assert.equal(other.status,200);assert.equal(s.head,head+1);
 const intents=await s.store.read(state=>state.works[UNIT].nativeReversals);
 assert.equal(Object.keys(intents).length,2);assert.deepEqual(intents['retained-a'],before['retained-a']);
 assert.notEqual(intents['different-operation'].request.sid,before['retained-a'].request.sid);
}));
test('disconnected executor cannot bypass its unknown outcome with a new command ID',()=>withFixture(async s=>{
 const a=await s.open(),original=await edit(s,a,11),first=target(original.changeset,'disconnected-a');
 assert.equal((await s.api(first)).status,200);const executor=await s.open('owner',first.commandId);
 const beforeReceipt=await s.api(undefined,first.commandId),before=await s.store.read(state=>state.works[UNIT].nativeReversals);
 await executor.dispose();assert.equal(s.authority.sessions.has(executor.memberID),false);
 const refused=await s.api({...first,commandId:'disconnected-b'});
 assert.equal(refused.status,409);assert.equal(refused.data.error,'native_reversal_target_retained');
 assert.deepEqual(await s.store.read(state=>state.works[UNIT].nativeReversals),before);
 assert.deepEqual(await s.api(undefined,first.commandId),beforeReceipt);
 assert.deepEqual(await s.api(first),beforeReceipt);assert.equal(beforeReceipt.data.disposition,'unknown');assert.equal(s.head,2);
}));
test('concurrent different command IDs reserve exactly one identity for the same unresolved native target',()=>withFixture(async s=>{
 const a=await s.open(),original=await edit(s,a,11),first=target(original.changeset,'concurrent-a'),second={...first,commandId:'concurrent-b'};
 let arrivals=0,release;const both=new Promise(r=>release=r),load=s.service.getUnitLoadDataWithBlocks.bind(s.service);
 // Both have passed the initial read before either reaches reservation. The
 // actual canonical store transaction must serialize the final target check.
 s.service.getUnitLoadDataWithBlocks=async(...args)=>{const result=await load(...args);if(++arrivals===2)release();await both;return result;};
 const results=await Promise.all([s.api(first),s.api(second)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal(results.find(r=>r.status===409).data.error,'native_reversal_target_retained');
 const intents=await s.store.read(state=>state.works[UNIT].nativeReversals),ids=Object.keys(intents);
 assert.equal(ids.length,1);assert.equal(new Set(Object.values(intents).map(i=>i.request.sid)).size,1);assert.equal(s.head,2);
 const retained=structuredClone(intents[ids[0]]),winner=ids[0]===first.commandId?first:second;
 assert.equal((await s.api(winner)).data.id,ids[0]);assert.deepEqual(await s.store.read(state=>state.works[UNIT].nativeReversals[ids[0]]),retained);
}));

test('unused preview abandonment is durable/idempotent, retains target identity and permits only a distinct operation',()=>withFixture(async s=>{
 const a=await s.open(),original=await edit(s,a,11),input=target(original.changeset,'unused');await s.api(input);
 const before=await s.store.read(x=>x.works[UNIT].nativeReversals.unused);
 const abandoned=await s.api({},'unused/abandon');assert.equal(abandoned.status,200);assert.equal(abandoned.data.disposition,'rejected');assert.equal(abandoned.data.reason,'native_reversal_abandoned_unused');
 assert.deepEqual(await s.api({},'unused/abandon'),abandoned);assert.deepEqual(await s.api(undefined,'unused'),abandoned);
 assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeReversals.unused),{...before,rejected:'native_reversal_abandoned_unused'});
 assert.equal((await s.api({...input,commandId:'replacement'})).data.error,'native_reversal_target_retained');assert.equal(s.head,2);
 const next=await edit(s,a,22);assert.equal((await s.api(target(next.changeset,'distinct'))).status,200);
}));
test('abandonment refuses any admitted executor even after disconnect; current ownership/epoch remain mandatory',()=>withFixture(async s=>{
 const a=await s.open(),original=await edit(s,a,11);await s.api(target(original.changeset,'admitted'));
 assert.equal((await s.api({},'admitted/abandon','peer')).status,409);assert.notEqual((await s.api({},'admitted/abandon','owner',2)).status,200);
 const executor=await s.open('owner','admitted');await executor.dispose();const before=await s.api(undefined,'admitted');
 assert.equal((await s.api({},'admitted/abandon')).status,409);assert.deepEqual(await s.api(undefined,'admitted'),before);assert.equal(s.head,2);
}));

test('issued action ticket cannot admit after abandonment; admission and abandonment serialize in either order',()=>withFixture(async s=>{
 const a=await s.open(),original=await edit(s,a,11);await s.api(target(original.changeset,'ticket-abandon'));
 // Obtain a real action ticket via the fixture's normal endpoint, then pause
 // before its upgrade. No fictional members or direct SDK session injection.
 const http=s.http;let issued,release;const gotTicket=new Promise(r=>issued=r),proceed=new Promise(r=>release=r);
 s.http=async(...args)=>{const result=await http(...args);if(args[1]==='/universer-api/user/session-ticket'){issued();await proceed;}return result;};
 const admission=s.open('owner','ticket-abandon');await gotTicket;
 assert.equal((await s.api({},'ticket-abandon/abandon')).status,200);release();await assert.rejects(admission);s.http=http;
 assert.equal(s.authority.sessions.size,1);assert.equal(s.head,2);
 // Complementary ordering: HELLO binds its executor under the same store lock
 // before cancellation enters. Even a later disconnect cannot release it.
 const next=await edit(s,a,22);await s.api(target(next.changeset,'admission-wins'));
 const executor=await s.open('owner','admission-wins');const before=await s.api(undefined,'admission-wins');
 assert.equal((await s.api({},'admission-wins/abandon')).data.error,'native_reversal_executor_retained');assert.deepEqual(await s.api(undefined,'admission-wins'),before);assert.ok(s.authority.sessions.has(executor.memberID));
}));
test('abandonment obeys current ACL and epoch, never confirms an absent preparation',()=>withFixture(async s=>{
 const a=await s.open(),original=await edit(s,a,11);await s.api(target(original.changeset,'access-abandon'));
 const before=await s.store.read(x=>x.works[UNIT].nativeReversals);
 assert.notEqual((await s.api({},'missing/abandon')).status,200);
 await s.store.transaction(x=>{x.works[UNIT].accessRevision=2;});
 assert.notEqual((await s.api({},'access-abandon/abandon')).status,200);
 assert.notEqual((await s.api({},'access-abandon/abandon','owner',2)).status,200);
 assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeReversals),before);
}));

test('reversal refuses original cell inside native merge; unrelated scalar reversal remains available',()=>withFixture(async s=>{
 const a=await s.open();await protocolEdit(s,a,[{id:'sheet.mutation.add-worksheet-merge',data:JSON.stringify({unitId:UNIT,subUnitId:TAB,ranges:[{startRow:0,endRow:0,startColumn:0,endColumn:1}]})}]);
 const inside=await protocolEdit(s,a,[mutation({v:11})]);const denied=await s.api(target(inside,'inside'));assert.equal(denied.status,409);assert.equal(denied.data.error,'native_reversal_merged_target');
 const outside=await protocolEdit(s,a,[mutation({v:22},2)]);assert.equal((await s.api(target(outside,'outside'))).status,200);assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,11);
}));
