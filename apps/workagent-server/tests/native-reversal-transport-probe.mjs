// PARENT ONLY: fresh in-memory stores, production HTTP/WS authorization and routes.
// No test intent injection; not persistence, mounted browser or recovery proof.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Subject, BehaviorSubject } from 'rxjs';
import { CombCmd } from '@univerjs/protocol';
import { UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { createHandler, identity } from '../src/http.mjs';
import { nativeRoute } from '../src/native-workspace.mjs';
import { CollaborationSession, MemberService, CommentService, CollaborationUIEventService, serializeCombRequest, deserializeToCombResponse, SyncedState } from '@univerjs-pro/collaboration-client';
import { CollaborationEvent, RevisionService, ITransformService, parseProtocolChangeset } from '@univerjs-pro/collaboration';
import { ILogService, ICommandService, IUndoRedoService } from '@univerjs/core';
import { SetRangeValuesCommand } from '@univerjs/sheets';
import { createNativeCollaboration } from '../src/native-collaboration.mjs';
import { wait } from './native-undo-delivery-fixture.mjs';
const operationHash=c=>createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex');
import { server, client, UNIT, TAB } from './native-history-sdk.test.mjs';
if (process.env.WORKAGENT_NATIVE_UNDO_TRANSPORT !== 'fresh-synthetic-only') throw new Error('parent_opt_in_required');
const seed=await server();await seed.dispose();seed.db.dispose=async()=>{};
const tokens=new Map(['owner','peer'].map(p=>[p,randomBytes(32).toString('hex')]));
const httpServer=createServer(),rawSockets=new Set();
await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${httpServer.address().port}`;
const settings={owner:'owner',token:tokens.get('owner'),origin,accounts:[{id:'peer',name:'Peer',token:tokens.get('peer')}]};
const auth=identity(settings),native=await createNativeCollaboration({dbAdapter:seed.db,workspace:seed.workspace,auth,origin,owner:'owner',mode:'workspace'});
httpServer.on('request',createHandler({...settings,workspace:seed.workspace,native,clientRoot:'/unused'}));
httpServer.on('upgrade',(req,socket,head)=>{try{nativeRoute(req,origin,auth);native.transport.handleUpgrade(req,socket,head);}catch{socket.destroy();}});
const materializer=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});
const s={initial:seed.initial,authority:native.authority,get head(){return seed.head;},async data(){
 const load=await native.authority.scope.run({unitID:UNIT,session:{userID:'owner',unitID:UNIT,revision:1}},()=>native.service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision:0},{userID:'owner'}));
 const m=await materializer.materializeSnapshot(load);return transformSnapshotToWorkbookData(m.snapshot,[...m.sheetBlocks]);
}};
const normalPath=`/api/native/${UNIT}/1/universer-api`,reversalPath=`/api/work/${UNIT}/native-reversal/1`;
let a,b,executor,state;
async function http(principal,path,body){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${tokens.get(principal)}`,Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal(response.status,200,'real HTTP route refused');return response.json();
}
async function connect(principal,basePath=normalPath){
 const ticket=(await http(principal,basePath+'/user/session-ticket')).ticket;
 assert.equal(typeof ticket,'string');
 const message$=new Subject(),close$=new Subject(),socket$=new BehaviorSubject(null),events=[];
 const ws=new WebSocket(origin.replace('http:','ws:')+basePath+'/comb/connect?sessionTicket='+encodeURIComponent(ticket),{headers:{Origin:origin,Authorization:`Bearer ${tokens.get(principal)}`}});
 rawSockets.add(ws);ws.on('close',()=>rawSockets.delete(ws));
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
 const submitPath=`${normalPath}/comb/2/unit/${UNIT}/new_changes`;
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
 const c=first.changeset;
 const prepared=await http('owner',reversalPath,{commandId:'actual-transport-reversal',revision:c.revision,memberID:a.memberID,sid:c.sid,reqId:c.reqId,hash:operationHash(c)});
 assert.equal(prepared.disposition,'unknown');assert.equal(prepared.request,undefined);
 executor=await connect('owner',prepared.actionPath);assert.equal(s.authority.sessions.size,3);assert.notEqual(executor.memberID,a.memberID);
 const receipt=await http('owner',reversalPath+'/'+prepared.id),inverse=receipt.request;
 assert.equal(inverse.memberID,executor.memberID);
 const actionSubmit=`${prepared.actionPath}/comb/2/unit/${UNIT}/new_changes`;
 await http('owner',actionSubmit,{unitID:UNIT,type:2,memberID:executor.memberID,changeset:inverse});
 await wait(()=>executor.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===4)&&a.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4)&&b.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4));
 assert.equal(s.head,4);
 assert.equal(a.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===4),false);
 a.local.receive(a.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4).data);
 b.local.receive(b.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4).data);
 assert.equal(a.local.cell(0,0),null);assert.equal(b.local.cell(0,0),null);assert.equal((await s.data()).sheets[TAB].cellData?.[0]?.[0]?.v??null,null);
 assert.equal(a.local.cell(1,1),22);assert.equal(b.local.cell(1,1),22);assert.equal((await s.data()).sheets[TAB].cellData[1][1].v,22);
 assert.equal((await http('owner',reversalPath+'/'+prepared.id)).disposition,'committed');
 const acknowledgements=executor.events.filter(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===4).length;
 await http('owner',actionSubmit,{unitID:UNIT,type:2,memberID:executor.memberID,changeset:inverse});await wait(()=>executor.events.filter(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===4).length>acknowledgements);assert.equal(s.head,4);
 console.log(JSON.stringify({transport:'actual loopback HTTP and WebSocket',scope:'workspace-scoped actual endpoint admission, no manually registered member',admittedMembers:3,eachMemberSubmittedThroughLicensedEndpoint:true,peerDisjointValueRetained:22,submission:'actual native HTTP route with normal endpoint license admission',executorEvent:'changeset_ack',originEvent:'new_changesets',peerEvent:'new_changesets',originValue:null,peerValue:null,serverValue:null,head:4,duplicate:'actual HTTP duplicate ACK; no extra revision',guard:'production NativeReversal, HTTP preparation, authenticated purpose ticket/upgrade, exact intent commit guard and native receipt',liveApply:'real transport plus headless native-state application; NOT mounted browser/recovery proof',stores:'in-memory, not durability',browser:'not exercised'}));
}finally{
 state?.dispose();await executor?.close();await b?.close();await a?.close();for(const ws of rawSockets)ws.terminate();await native.close();await materializer.dispose();httpServer.closeAllConnections();await new Promise(resolve=>httpServer.close(resolve));
}
