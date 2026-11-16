// Actual production constructor/HTTP/Node transport/endpoint/public SDK sessions.
// WebSocket frames travel over in-memory Duplex streams (ws public Sender/Receiver),
// never TCP/listeners. Memory canonical/native adapters, NOT PG/SQLite/browser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Duplex, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { Sender, Receiver } from 'ws';
import { Subject, BehaviorSubject } from 'rxjs';
import { CollaborationSession, MemberService, CommentService, CollaborationUIEventService, serializeCombRequest, deserializeToCombResponse } from '@univerjs-pro/collaboration-client';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { CombCmd } from '@univerjs/protocol';
import { NativeAgentAcceptance } from '../src/native-agent-acceptance.mjs';
import { createNativeCollaboration } from '../src/native-collaboration.mjs';
import { createHandler, identity } from '../src/http.mjs';
import { nativeRoute } from '../src/native-workspace.mjs';
import { server, client, UNIT, TAB } from './native-history-sdk.test.mjs';
import { wait } from './native-undo-delivery-fixture.mjs';
const origin='http://acceptance.invalid',ownerToken='synthetic-acceptance-owner-only-0123456789',peerToken='synthetic-acceptance-peer-only-0123456789';
const normal=`/api/native/${UNIT}/1/universer-api`,apiPath=`/api/work/${UNIT}/native-agent-acceptance/1`;
async function fixture(fn){
 const seed=await server();await seed.dispose();seed.db.dispose=async()=>{};
 const settings={owner:'owner',token:ownerToken,origin,accounts:[{id:'peer',name:'Peer',token:peerToken}]},auth=identity(settings);
 const native=await createNativeCollaboration({dbAdapter:seed.db,workspace:seed.workspace,auth,origin,owner:'owner',mode:'workspace'}),connections=[];
 native.authority.agent.enabled=true;
 const handler=createHandler({...settings,workspace:seed.workspace,native,clientRoot:'/unused',onCommand(){throw Error('Acceptance must not dispatch a model job');}});
 const headers=who=>({authorization:`Bearer ${who==='owner'?ownerToken:peerToken}`,origin,'content-type':'application/json'});
 async function http(path,input,who='owner',extraHeaders={}){
  const req=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(req,{method:input===undefined?'GET':'POST',url:path,headers:{...headers(who),...extraHeaders}});
  let result,ended;const finished=new Promise(r=>ended=r);const res={statusCode:200,writableEnded:false,setHeader(){},writeHead(n){this.statusCode=n;},end(v){this.writableEnded=true;result=v?JSON.parse(v):null;ended();}};
  await handler(req,res);let timer;try{await Promise.race([finished,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('HTTP fixture completion timeout')),5000))]);}finally{clearTimeout(timer);}return {status:res.statusCode,data:result};
 }
 async function open(who='owner',path=normal){
  const ticket=await http(path+'/user/session-ticket',undefined,who);assert.equal(ticket.status,200);assert.ok(ticket.data.ticket);
  const events=[],frames=[],message$=new Subject(),close$=new Subject(),socket$=new BehaviorSubject(null),receiver=new Receiver({isServer:false});let memberID,handshake=false,buffer=Buffer.alloc(0),failure;
  const carrier=new Duplex({read(){},write(chunk,_enc,done){try{if(!handshake){buffer=Buffer.concat([buffer,chunk]);const end=buffer.indexOf('\r\n\r\n');if(end<0){done();return;}assert.match(buffer.subarray(0,end).toString(),/^HTTP\/1.1 101/);handshake=true;chunk=buffer.subarray(end+4);}if(chunk.length)receiver.write(chunk);done();}catch(e){failure=e;done(e);}},final(done){this.push(null);done();}});
  const outgoing=new Writable({write(chunk,_enc,done){carrier.push(Buffer.from(chunk));done();}}),sender=new Sender(outgoing);
  const send=event=>new Promise((resolve,reject)=>sender.send(serializeCombRequest(event),{binary:false,mask:true,fin:true,compress:false},e=>e?reject(e):resolve()));
  receiver.on('message',data=>{const frame=deserializeToCombResponse({data:data.toString()});frames.push(frame);if(frame.data?.memberID)memberID=frame.data.memberID;message$.next(frame);});
  receiver.on('conclude',(code,reason)=>{sender.close(code,reason,true,()=>carrier.push(null));});receiver.on('error',e=>{failure=e;});carrier.on('error',e=>{failure=e;});carrier.on('close',()=>close$.next());
  const req={method:'GET',url:path+'/comb/connect?sessionTicket='+encodeURIComponent(ticket.data.ticket),headers:{...headers(who),host:'acceptance.invalid',upgrade:'websocket',connection:'Upgrade','sec-websocket-version':'13','sec-websocket-key':Buffer.alloc(16,7).toString('base64')},socket:carrier};
  nativeRoute(req,origin,auth);await native.transport.handleUpgrade(req,carrier,Buffer.alloc(0));await wait(()=>handshake||failure);if(failure)throw failure;
  await send({cmd:CombCmd.HELLO,data:{},routeKey:'',routeType:''});await wait(()=>memberID||failure);if(failure)throw failure;
  const local=client(seed.initial,who),members=local.univer.__getInjector().createInstance(MemberService),log={debug(){},info(){},warn(){},error(){}};
  const session=new CollaborationSession({localUnitId:UNIT,unitType:2,target:{unitId:UNIT,unitType:2}},socket$,log,members,new CommentService(),new CollaborationUIEventService());
  const observer=session.event$.subscribe(e=>events.push(e));socket$.next({memberID,message$,close$,open$:new Subject(),error$:new Subject(),send,close(){carrier.destroy();}});await wait(()=>session.sessionStatus===3);
  let disposed=false;const connection={memberID,events,local,async close(){if(disposed)return;disposed=true;observer.unsubscribe();session.dispose();carrier.destroy();await wait(()=>!native.authority.sessions.has(memberID));members.dispose();local.dispose();socket$.complete();message$.complete();close$.complete();receiver.destroy();outgoing.destroy();}};connections.push(connection);return connection;
 }
 async function proposal(){
  await native.authority.agent.admit('owner',UNIT,{commandId:randomUUID(),kind:'continue',text:'Fixture scalar proposal only',sourceIds:[],expectedIntentRevision:0,accessRevision:1});
  const job=await seed.workspace.claim('owner'),read=await native.authority.agent.read('owner',job);
  const result=await native.authority.agent.propose('owner',job,'scalar-call',JSON.stringify({cells:[{sheetId:TAB,row:0,column:0,value:33}]}),read.basis);
  await seed.workspace.checkpoint('owner',job,'completed',{messages:[]});await seed.workspace.finish('owner',job,[],'ready');return result.proposalId;
 }
 async function edit(connection,who,v,col=0,extra={}){
  const request={unitID:UNIT,type:2,userID:who,memberID:connection.memberID,baseRev:seed.head,revision:seed.head+1,sid:'human_'+randomUUID(),reqId:1,mutations:[{id:'sheet.mutation.set-range-values',data:JSON.stringify({unitId:UNIT,subUnitId:TAB,cellValue:{0:{[col]:{v,...extra}}}})}]};
  await http(normal+`/comb/2/unit/${UNIT}/new_changes`,{unitID:UNIT,type:2,memberID:connection.memberID,changeset:request},who);await wait(()=>connection.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.sid===request.sid));return request;
 }
 async function submit(c,receipt,request=receipt.request,path=receipt.actionPath){return http(path+`/comb/2/unit/${UNIT}/new_changes`,{unitID:UNIT,type:2,memberID:c.memberID,changeset:request});}
 const s={...seed,native,http,open,proposal,edit,submit,otherOwnerHeaders:()=>({authorization:undefined,cookie:`workagent_session=${auth.login(ownerToken)}`}),get head(){return seed.head;},async data(){const load=await native.authority.scope.run({unitID:UNIT,session:{userID:'owner',unitID:UNIT,revision:1}},()=>native.service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision:0},{userID:'owner'}));const {UnitSnapshotMaterializer}=await import('@univerjs-pro/collaboration-service');const {transformSnapshotToWorkbookData}=await import('@univerjs-pro/collaboration');const m=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});try{const x=await m.materializeSnapshot(load);return transformSnapshotToWorkbookData(x.snapshot,[...x.sheetBlocks]);}finally{await m.dispose();}}};
 try{await fn(s);}finally{for(const c of connections.reverse())await c.close();await native.close();}
}
const prepare=(s,proposalId,a,id='accept-one')=>s.http(apiPath,{commandId:id,proposalId,memberID:a.memberID});
async function ready(s){s.native.authority.acceptance.enabled=true;const a=await s.open(),b=await s.open('peer');await s.edit(b,'peer',71,1);await s.edit(a,'owner',11,0,{t:2,f:null,si:null,ft:null,fd:null,s:{cl:{rgb:'#1B1C1F'}}});const proposalId=await s.proposal();return {a,b,proposalId};}
async function confirmed(s,a,proposalId,id='accept-one'){
 const p=await prepare(s,proposalId,a,id);assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.data.phase,'prepared');
 const confirm=await s.http(apiPath+'/'+id+'/confirm',{});assert.equal(confirm.status,200,JSON.stringify(confirm));assert.equal(confirm.data.phase,'confirmed');
 const executor=await s.open('owner',confirm.data.actionPath),receipt=await s.http(apiPath+'/'+id);assert.equal(receipt.status,200);return {executor,receipt:receipt.data};
}
test('acceptance default off; canonical preview/confirm uses actual Node transport HELLO/JOIN, commit and native receipt once',()=>fixture(async s=>{
 assert.equal((await s.http(apiPath,{})).data.error,'native_acceptance_disabled');const {a,b,proposalId}=await ready(s),before=await s.store.read(x=>x.works[UNIT].nativeAgentProposals),head=s.head;
 const {executor,receipt}=await confirmed(s,a,proposalId);assert.equal(s.native.authority.sessions.size,3);assert.notEqual(executor.memberID,a.memberID);assert.equal(receipt.disposition,'unknown');
 await s.submit(executor,receipt);await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK));
 assert.equal(s.head,head+1);await wait(()=>[a,b].every(c=>c.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===s.head)));
 const data=await s.data();assert.equal(data.sheets[TAB].cellData[0][0].v,33);assert.equal(data.sheets[TAB].cellData[0][1].v,71);const cell=data.sheets[TAB].cellData[0][0];assert.deepEqual(typeof cell.s==='string'?data.styles[cell.s]:cell.s,{cl:{rgb:'#1B1C1F'}});
 assert.equal((await s.http(apiPath+'/accept-one')).data.disposition,'committed');await s.submit(executor,receipt);assert.equal(s.head,head+1);
 assert.equal((await prepare(s,proposalId,a,'replacement')).status,409);assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentProposals),before);
 const counts=await s.store.read(x=>({jobs:Object.keys(x.jobs).length,proposals:Object.keys(x.works[UNIT].nativeAgentProposals).length}));assert.deepEqual(counts,{jobs:1,proposals:1});
}));
test('preview refuses client patches, foreign principal/unit/member/proposal; confirm required; one retained proposal reservation',()=>fixture(async s=>{
 const {a,b,proposalId}=await ready(s),input={commandId:'preview',proposalId,memberID:a.memberID};
 for(const bad of [{...input,patch:{cells:[]}},{...input,proposalId:'foreign'},{...input,memberID:b.memberID}])assert.equal((await s.http(apiPath,bad)).status,409);
 assert.equal((await s.http(apiPath,input,'peer')).status,403);assert.equal((await s.http(apiPath.replace(UNIT,'foreign'),input)).status,403);
 const results=await Promise.all([s.http(apiPath,input),s.http(apiPath,{...input,commandId:'other'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const kept=results.find(r=>r.status===200).data,before=await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances);
 assert.equal((await s.http(kept.actionPath+'/user/session-ticket')).status,409);
 assert.equal((await s.http(apiPath,{...input,commandId:kept.id,memberID:b.memberID})).status,409);
 assert.equal((await s.http(apiPath+'/'+kept.id+'/confirm',{value:999})).status,409);
 assert.equal((await s.http(apiPath.replace('/1','/2')+'/'+kept.id)).status,403);
 assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances),before);assert.equal(s.head,3);
}));
test('peer overlapping and disjoint commits between admission and native CAS definitively refuse without human loss',async()=>{
 for(const col of [0,1])await fixture(async s=>{
  const {a,b,proposalId}=await ready(s),{executor,receipt}=await confirmed(s,a,proposalId);let reached,release;
  const readyGate=new Promise(r=>reached=r),gate=new Promise(r=>release=r);
  s.native.service.use('submitChangeset',async(c,next)=>{if(c.request.changeset.sid===receipt.request.sid){reached();await gate;}await next();});
  const pending=s.submit(executor,receipt);await readyGate;await s.edit(b,'peer',77,col);release();await pending;
  await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.PERMISSION_REJ));const out=await s.http(apiPath+'/accept-one');assert.equal(out.data.disposition,'rejected');assert.equal(out.data.reason,'native_acceptance_head_changed');assert.equal(s.head,4);
  const data=await s.data();assert.equal(data.sheets[TAB].cellData[0][col].v,77);if(col===1)assert.equal(data.sheets[TAB].cellData[0][0].v,11);
  assert.equal((await prepare(s,proposalId,a,'retry-new-id')).status,409);
 });
});
test('intent/cancellation/permission changes and origin departure before commit refuse; ACL epoch revocation fences delivery',async()=>{
 for(const change of ['intent','cancel','permission','departure','epoch'])await fixture(async s=>{
  const {a,proposalId}=await ready(s),{executor,receipt}=await confirmed(s,a,proposalId);
  if(change==='departure')await a.close();
  else if(change==='epoch')await s.workspace.share('owner',UNIT,{commandId:'revoke',peer:'peer',role:'read',accessRevision:1});
  else if(change==='permission')await s.store.transaction(x=>x.permissionRevision++);
  else await s.native.authority.agent.admit('owner',UNIT,{commandId:'supersede',kind:change==='cancel'?'cancel':'continue',text:'Explicit fixture supersession',sourceIds:[],expectedIntentRevision:1,accessRevision:1});
  await s.submit(executor,receipt);assert.equal(s.head,3);
  const out=await s.http(apiPath+'/accept-one');if(change==='epoch')assert.equal(out.status,403);else {assert.equal(out.data.disposition,'rejected');assert.match(out.data.reason,/stale|origin/);}
 });
});
test('unknown receipt survives adapter reopen and executor departure; exact request identity cannot be replaced or submitted on human path',()=>fixture(async s=>{
 const {a,proposalId}=await ready(s),{executor,receipt}=await confirmed(s,a,proposalId),before=await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances);
 await s.submit(executor,receipt,{...receipt.request,mutations:[{id:'sheet.mutation.set-range-values',data:JSON.stringify({unitId:UNIT,subUnitId:TAB,cellValue:{0:{0:{v:999}}}})}]});
 await s.submit(a,receipt,receipt.request,normal);assert.equal(s.head,3);
 await executor.close();s.native.authority.acceptance=new NativeAgentAcceptance(s.native.authority,s.native.service,s.db);s.native.authority.acceptance.enabled=true;
 const after=await s.http(apiPath+'/accept-one');assert.equal(after.data.disposition,'unknown');assert.deepEqual(after.data.request,receipt.request);
 assert.equal((await prepare(s,proposalId,a,'new-id')).data.error,'native_acceptance_target_retained');assert.deepEqual((await prepare(s,proposalId,a)).data,after.data);
 assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances),before);assert.equal(s.head,3);
}));
test('authority change while pinned materialization waits prevents preview/reservation; receipt rechecks before enqueue',()=>fixture(async s=>{
 const {a,proposalId}=await ready(s);let reached,release;const readyGate=new Promise(r=>reached=r),gate=new Promise(r=>release=r),load=s.native.service.getUnitLoadDataWithBlocks.bind(s.native.service);
 s.native.service.getUnitLoadDataWithBlocks=async(...args)=>{const result=await load(...args);reached();await gate;return result;};
 const preparing=prepare(s,proposalId,a);await readyGate;await s.workspace.share('owner',UNIT,{commandId:'share-during-preview',peer:'peer',role:'read',accessRevision:1});release();
 assert.equal((await preparing).status,403);assert.equal(await s.store.read(x=>Object.keys(x.works[UNIT].nativeAgentAcceptances??{}).length),0);assert.equal(s.head,3);
}));
test('origin departure linearizes after an already-entered native CAS, never halfway through its Workspace fence',()=>fixture(async s=>{
 const {a,proposalId}=await ready(s),{executor,receipt}=await confirmed(s,a,proposalId),commit=s.db.commitChangeset;
 let reached,release;const atCAS=new Promise(r=>reached=r),gate=new Promise(r=>release=r);
 s.db.commitChangeset=async(...args)=>{reached();await gate;return commit(...args);};
 const pending=s.submit(executor,receipt);await atCAS;const leaving=a.close();await new Promise(setImmediate);
 assert.equal(s.native.authority.sessions.has(a.memberID),true,'departure waits on actual commit lock');assert.equal(s.head,3);
 release();await pending;await leaving;assert.equal(s.head,4);assert.equal(s.native.authority.sessions.has(a.memberID),false);assert.equal((await s.http(apiPath+'/accept-one')).data.disposition,'committed');
}));
test('unused acceptance can be explicitly abandoned after origin departure; fresh member accepts once without reviving old identity',()=>fixture(async s=>{
 const {a,proposalId}=await ready(s),original={commandId:'unused',proposalId,memberID:a.memberID};
 const preview=await s.http(apiPath,original);assert.equal(preview.status,200);await a.close();
 const refused=await s.http(apiPath+'/unused/confirm',{});assert.equal(refused.data.reason,'native_acceptance_origin');
 const retained=await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances.unused),canonical=await s.store.read(x=>x.works[UNIT].nativeAgentProposals);
 const abandoned=await s.http(apiPath+'/unused/abandon',{});assert.equal(abandoned.status,200);assert.equal(abandoned.data.disposition,'rejected');assert.equal(abandoned.data.phase,'abandoned');assert.equal(abandoned.data.reason,'native_acceptance_abandoned_unused');
 assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances.unused),{...retained,abandoned:'native_acceptance_abandoned_unused'});
 assert.deepEqual(await s.http(apiPath+'/unused/abandon',{}),abandoned);assert.deepEqual(await s.http(apiPath+'/unused'),abandoned);assert.deepEqual(await s.http(apiPath,original),abandoned);
 assert.equal((await s.http(apiPath+'/unused/confirm',{})).status,409);assert.equal((await s.http(preview.data.actionPath+'/user/session-ticket')).status,409);
 const fresh=await s.open();assert.equal(s.native.authority.sessions.size,2);
 assert.equal((await s.http(apiPath,{...original,memberID:fresh.memberID})).status,409,'old command may not retarget a new member');
 await s.submit(fresh,preview.data,{...retained.request,memberID:fresh.memberID});assert.equal(s.head,3);
 const {executor,receipt}=await confirmed(s,fresh,proposalId,'fresh');assert.equal(s.native.authority.sessions.size,3);await s.submit(executor,receipt);await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK));
 assert.equal(s.head,4);assert.equal((await s.http(apiPath+'/fresh')).data.disposition,'committed');await s.submit(executor,receipt);assert.equal(s.head,4);
 assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentProposals),canonical);assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances.unused),{...retained,abandoned:'native_acceptance_abandoned_unused'});
 assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,33);assert.equal((await s.data()).sheets[TAB].cellData[0][1].v,71);
}));
test('unused acceptance abandonment and confirmation serialize: exactly one wins in either lock order',async()=>{
 for(const first of ['abandon','confirm'])await fixture(async s=>{
  const {a,proposalId}=await ready(s);await prepare(s,proposalId,a,'race');
  const before=await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances.race),adapter=s.native.authority.acceptance,session=s.native.authority.sessions.get(a.memberID),second=first==='abandon'?'confirm':'abandon';
  // Both public operations enter the actual Workspace transaction queue, in
  // either order; no fake admission/receipt or transport success is supplied.
  const outputs=[];const invoke=method=>adapter[method]('owner',UNIT,session,session.binding,'race',{},r=>outputs.push(r));
  const results=await Promise.allSettled([invoke(first),invoke(second)]);assert.deepEqual(results.map(x=>x.status),['fulfilled','rejected']);
  assert.equal(outputs.length,1);assert.equal(outputs[0].phase,first==='abandon'?'abandoned':'confirmed');
  const after=await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances.race);
  assert.deepEqual(after,{...before,...(first==='abandon'?{abandoned:'native_acceptance_abandoned_unused'}:{confirmed:true})});
  if(first==='confirm'){assert.equal((await prepare(s,proposalId,a,'replacement')).data.error,'native_acceptance_target_retained');assert.equal((await s.http(apiPath+'/race/abandon',{})).status,409);}
  else{assert.equal((await prepare(s,proposalId,a,'fresh-explicit')).status,200);assert.equal((await s.http(apiPath+'/race/confirm',{})).status,409);}
  assert.equal(s.head,3);
 });
});
test('unused acceptance recovery never abandons confirmed, admitted unknown or disconnected executor reservations',()=>fixture(async s=>{
 const {a,proposalId}=await ready(s);await prepare(s,proposalId,a,'protected');const confirmed=await s.http(apiPath+'/protected/confirm',{});assert.equal(confirmed.data.phase,'confirmed');
 const beforeAdmission=await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances.protected);
 assert.equal((await s.http(apiPath+'/protected/abandon',{})).data.error,'native_acceptance_not_unused');assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances.protected),beforeAdmission);
 const executor=await s.open('owner',confirmed.data.actionPath),unknown=await s.http(apiPath+'/protected'),before=await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances.protected);
 assert.equal(unknown.data.disposition,'unknown');assert.equal((await s.http(apiPath+'/protected/abandon',{})).status,409);await executor.close();
 assert.equal((await s.http(apiPath+'/protected/abandon',{})).status,409);assert.deepEqual(await s.http(apiPath+'/protected'),unknown);assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances.protected),before);
 assert.equal((await prepare(s,proposalId,a,'new-identity')).data.error,'native_acceptance_target_retained');assert.equal(s.head,3);
}));
test('unused acceptance abandonment enforces current principal/unit/binding/epoch and keeps all records on refusal',()=>fixture(async s=>{
 const {a,proposalId}=await ready(s);await prepare(s,proposalId,a,'owned');const path=apiPath+'/owned/abandon',before=await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances);
 for(const [route,body,who,headers] of [[path,{},'peer'],[path.replace(UNIT,'foreign'),{},'owner'],[path,{},'owner',s.otherOwnerHeaders()],[path.replace('/1','/2'),{},'owner'],[apiPath+'/missing/abandon',{},'owner'],[path,{retry:true},'owner'],[path,[],'owner']]){
  assert.notEqual((await s.http(route,body,who,headers)).status,200);assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances),before);
 }
 await s.workspace.share('owner',UNIT,{commandId:'epoch-before-abandon',peer:'peer',role:'read',accessRevision:1});assert.equal((await s.http(path,{})).status,403);assert.notEqual((await s.http(path.replace('/1','/2'),{})).status,200);assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances),before);assert.equal(s.head,3);
}));
test('unused acceptance abandonment releases only reservation; fresh preparation still requires current native head and basis',()=>fixture(async s=>{
 const {a,b,proposalId}=await ready(s);await prepare(s,proposalId,a,'unused-stale');assert.equal((await s.http(apiPath+'/unused-stale/abandon',{})).status,200);
 const before=await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances);await s.edit(b,'peer',88,1);
 const attempt=await prepare(s,proposalId,a,'fresh-after-edit');assert.equal(attempt.status,409);assert.equal(attempt.data.error,'native_acceptance_head_changed');assert.deepEqual(await s.store.read(x=>x.works[UNIT].nativeAgentAcceptances),before);assert.equal(s.head,4);
}));
