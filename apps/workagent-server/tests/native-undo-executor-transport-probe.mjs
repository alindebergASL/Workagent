// PARENT ONLY: three legitimately admitted connections, same-principal executor.
// Positive delivery fork; original two-connection ACK-negative probe retained.
// Memory stores and trusted test-only intent injection; NOT production undo authorization,
// browser UI, durable receipts or safe pending-input reload qualification.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Subject, BehaviorSubject } from 'rxjs';
import { CombCmd } from '@univerjs/protocol';
import { createNodeTransport } from '@univerjs-pro/collaboration-transport-node';
import { CollaborationSession, MemberService, CommentService, CollaborationUIEventService, serializeCombRequest, deserializeToCombResponse, SyncedState } from '@univerjs-pro/collaboration-client';
import { CollaborationEvent, RevisionService, ITransformService, parseProtocolChangeset } from '@univerjs-pro/collaboration';
import { ILogService, ICommandService, IUndoRedoService } from '@univerjs/core';
import { SetRangeValuesCommand } from '@univerjs/sheets';
import { guardedEndpoint, validateNativeOrigin } from '../src/native-collaboration.mjs';
import { fixture, wait } from './native-undo-delivery-fixture.mjs';
import { guardedUndoFixture, operationHash } from './native-guarded-undo-fixture.mjs';
import { client, UNIT, TAB } from './native-history-sdk.test.mjs';
if (process.env.WORKAGENT_NATIVE_UNDO_TRANSPORT !== 'fresh-synthetic-only') throw new Error('parent_opt_in_required');
const s=await fixture(),transport=createNodeTransport(),httpServer=createServer();
const tokens=new Map(['owner','peer'].map(p=>[p,randomBytes(32).toString('hex')]));
const auth={authenticate(req){const user=[...tokens].find(([,v])=>req.headers.authorization===`Bearer ${v}`)?.[0];if(!user)throw new Error('unauthorized_fixture');return user;},profile:id=>({name:id})};
let origin,trustedIntent,guard,a,b,executor,state;
transport.attach(httpServer);
await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
origin=`http://127.0.0.1:${httpServer.address().port}`;
const access=principal=>({userID:principal,unitID:UNIT,revision:1});
transport.use(async(c,next)=>{
 try{
  validateNativeOrigin(c.incomingMessage,origin);const principal=auth.authenticate(c.incomingMessage);
  c.userID=principal;c.incomingMessage.nativeUnitID=UNIT;c.incomingMessage.nativeAccess=access(principal);
  await s.authority.checkNow(principal,UNIT,false,access(principal));
  await s.authority.scope.run({unitID:UNIT,session:access(principal)},()=>trustedIntent&&c.incomingMessage.method==='POST'?guard.withIntent(trustedIntent,next):next());
 }catch{if(!c.response.writableEnded){c.response.statusCode=403;c.response.end(JSON.stringify({error:'fixture_access_denied'}));}}
});
transport.useUpgrade(async(c,next)=>{
 try{validateNativeOrigin(c.incomingMessage,origin,true);const principal=auth.authenticate(c.incomingMessage);c.incomingMessage.nativeUnitID=UNIT;c.incomingMessage.nativeAccess=access(principal);await next();}
 catch{c.reject(403,'Access denied');}
});
transport.register(guardedEndpoint(s.endpoint,s.authority,auth,origin));
async function http(principal,path,body){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${tokens.get(principal)}`,Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal(response.status,200,'real HTTP route refused');return response.json();
}
async function connect(principal){
 const ticket=(await http(principal,'/universer-api/user/session-ticket')).ticket;
 assert.equal(typeof ticket,'string');
 const message$=new Subject(),close$=new Subject(),socket$=new BehaviorSubject(null),events=[];
 const ws=new WebSocket(origin.replace('http:','ws:')+'/universer-api/comb/connect?sessionTicket='+encodeURIComponent(ticket),{headers:{Origin:origin,Authorization:`Bearer ${tokens.get(principal)}`}});
 let memberID,transportFailure=false;
 ws.on('error',()=>{transportFailure=true;});
 ws.on('message',data=>{const frame=deserializeToCombResponse({data:data.toString()});if(frame.data?.memberID)memberID=frame.data.memberID;message$.next(frame);});
 ws.on('close',()=>close$.next());
 await once(ws,'open');ws.send(serializeCombRequest({cmd:CombCmd.HELLO,data:{},routeKey:'',routeType:''}));await wait(()=>memberID||transportFailure);assert.equal(transportFailure,false);assert.ok(memberID);
 const socket={memberID,message$,close$,open$:new Subject(),error$:new Subject(),close(){ws.close();},send(event){ws.send(serializeCombRequest(event));}};
 const local=client(s.initial,principal),members=local.univer.__getInjector().createInstance(MemberService),log={debug(){},info(){},warn(){},error(){}};
 const session=new CollaborationSession({localUnitId:UNIT,unitType:2,target:{unitId:UNIT,unitType:2}},socket$,log,members,new CommentService(),new CollaborationUIEventService());
 const observer=session.event$.subscribe(e=>events.push(e));socket$.next(socket);await wait(()=>session.sessionStatus===3);
 return {local,session,events,memberID,async close(){observer.unsubscribe();session.dispose();if(ws.readyState!==WebSocket.CLOSED){const closed=once(ws,'close');ws.close();await closed;}members.dispose();local.dispose();socket$.complete();message$.complete();close$.complete();}};
}
try{
 assert.equal(s.authority.unitID,null);assert.equal(s.authority.sessions.size,0);
 a=await connect('owner');b=await connect('peer');assert.equal(s.authority.sessions.size,2);
 const submitPath=`/universer-api/comb/2/unit/${UNIT}/new_changes`;
 const peerFirst=await b.local.run({service:{submitChangeset:async({changeset})=>{
  await http('peer',submitPath,{unitID:UNIT,type:2,memberID:b.memberID,changeset});
  await wait(()=>b.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.sid===changeset.sid&&e.data.reqId===changeset.reqId));
  const ack=b.events.find(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.sid===changeset.sid&&e.data.reqId===changeset.reqId);
  return {status:'committed',changeset:ack.data};
 }}},SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:TAB,range:{startRow:1,endRow:1,startColumn:1,endColumn:1},value:{v:22}});
 assert.equal(peerFirst.status,'committed');await wait(()=>a.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===2));a.local.receive(a.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===2).data);
 const first=await a.local.run({service:{submitChangeset:async({changeset})=>{
  await http('owner',submitPath,{unitID:UNIT,type:2,memberID:a.memberID,changeset});
  await wait(()=>a.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.sid===changeset.sid&&e.data.reqId===changeset.reqId));
  const ack=a.events.find(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.sid===changeset.sid&&e.data.reqId===changeset.reqId);
  return {status:'committed',changeset:ack.data};
 }}},SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:0,endColumn:0},value:{v:11}});
 assert.equal(first.status,'committed');await wait(()=>b.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===3));b.local.receive(b.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===3).data);
 executor=await connect('owner');assert.equal(s.authority.sessions.size,3);assert.notEqual(executor.memberID,a.memberID);
 guard=guardedUndoFixture(s);const c=first.changeset;trustedIntent=await guard.prepare('owner',a.memberID,{revision:c.revision,sid:c.sid,reqId:c.reqId,hash:operationHash(c)},executor.memberID);
 const inverse=guard.request(trustedIntent,'transport-inverse-'+randomBytes(8).toString('hex'),1);
 await http('owner',submitPath,{unitID:UNIT,type:2,memberID:executor.memberID,changeset:inverse});
 await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===4)&&a.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4)&&b.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4));
 assert.equal(guard.commitChecks,1);assert.equal(s.head,4);
 assert.equal(a.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===4),false);
 a.local.receive(a.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4).data);
 b.local.receive(b.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4).data);
 assert.equal(a.local.cell(0,0),null);assert.equal(b.local.cell(0,0),null);assert.equal((await s.data()).sheets[TAB].cellData?.[0]?.[0]?.v??null,null);
 assert.equal(a.local.cell(1,1),22);assert.equal(b.local.cell(1,1),22);assert.equal((await s.data()).sheets[TAB].cellData[1][1].v,22);
 const acknowledgements=executor.events.filter(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===4).length;
 await http('owner',submitPath,{unitID:UNIT,type:2,memberID:executor.memberID,changeset:inverse});await wait(()=>executor.events.filter(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===4).length>acknowledgements);assert.equal(s.head,4);assert.equal(guard.commitChecks,1);
 console.log(JSON.stringify({transport:'actual loopback HTTP and WebSocket',scope:'workspace-scoped actual endpoint admission, no manually registered member',admittedMembers:3,eachMemberSubmittedThroughLicensedEndpoint:true,peerDisjointValueRetained:22,submission:'actual native HTTP route with normal endpoint license admission',executorEvent:'changeset_ack',originEvent:'new_changesets',peerEvent:'new_changesets',originValue:null,peerValue:null,serverValue:null,head:4,duplicate:'actual HTTP duplicate ACK; no extra revision',guard:'test-only trusted intent; not production authorization',liveApply:'delivery demonstrated through distinct legitimately admitted same-principal executor; NOT production authorization/recovery proof',stores:'in-memory, not durability',browser:'not exercised'}));
}finally{
 state?.dispose();await executor?.close();await b?.close();await a?.close();await transport.dispose();httpServer.closeAllConnections();await new Promise(resolve=>httpServer.close(resolve));await s.dispose();
}
