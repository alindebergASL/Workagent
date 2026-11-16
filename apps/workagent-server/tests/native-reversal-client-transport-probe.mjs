// PARENT ONLY: fresh in-memory stores, production HTTP/WS authorization and routes.
// No test intent injection; not persistence, mounted browser or recovery proof.
import { nativeReversal } from '../../workagent-client/src/native-reversal.ts';
import { openReversalAction } from '../../workagent-client/src/native-reversal-action.ts';
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
let a,b,executor,state,helper;const saved=new Map(),views=[],clientCalls=[];
const dropReply=process.env.WORKAGENT_NATIVE_REVERSAL_DROP_REPLY==='after-native-commit';
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
 const profile=await http('owner',`/api/work/${UNIT}/native-session`);
 const clientFetch=async(url,options={})=>{
  const headers=new Headers(options.headers);headers.set('Authorization',`Bearer ${tokens.get('owner')}`);headers.set('Origin',origin);
  clientCalls.push({path:new URL(url,origin).pathname,method:options.method??'GET'});
  const response=await fetch(new URL(url,origin),{...options,headers});
  if(dropReply&&options.method==='POST'&&String(url).endsWith('/new_changes')){await response.arrayBuffer();throw Error('Probe hid the native HTTP reply after the real server commit');}
  return response;
 };
 const storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)};
 const actionFactory=(path,signal)=>openReversalAction(UNIT,path,profile.binding,signal,clientFetch,url=>{
  const ws=new WebSocket(url,{headers:{Origin:origin,Authorization:`Bearer ${tokens.get('owner')}`}});rawSockets.add(ws);ws.on('close',()=>rawSockets.delete(ws));return ws;
 },origin);
 const mount=()=>nativeReversal(profile,a.session,()=>a.local.univer.__getInjector().get(RevisionService).getCurrentRevOfUnit(UNIT),()=>false,v=>views.push(v),clientFetch,storage,actionFactory);
 helper=mount();
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
 await wait(()=>views.at(-1)?.canPreview);await helper.preview();assert.equal(views.at(-1).canConfirm,true);
 await Promise.all([helper.confirm(),helper.confirm()]);
 await wait(()=>a.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4)&&b.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4));
 if(dropReply){assert.notEqual(views.at(-1).disposition,'committed');await helper.check();}
 assert.equal(views.at(-1).disposition,'committed');
 assert.equal(s.head,4);
 assert.equal(a.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===4),false);
 a.local.receive(a.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4).data);
 b.local.receive(b.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===4).data);
 assert.equal(a.local.cell(0,0),null);assert.equal(b.local.cell(0,0),null);assert.equal((await s.data()).sheets[TAB].cellData?.[0]?.[0]?.v??null,null);
 assert.equal(a.local.cell(1,1),22);assert.equal(b.local.cell(1,1),22);assert.equal((await s.data()).sheets[TAB].cellData[1][1].v,22);
 helper.refresh();assert.match(views.at(-1).message,/Live editor has reached/);
 await wait(()=>s.authority.sessions.size===2);
 const postsBefore=clientCalls.filter(c=>c.method==='POST');assert.equal(postsBefore.length,2);assert.equal(postsBefore.filter(c=>c.path.endsWith('/new_changes')).length,1);
 const retained=[...saved.values()][0];helper.dispose();helper=mount();await helper.check();await helper.confirm();await helper.preview();
 assert.equal(clientCalls.filter(c=>c.method==='POST').length,2);assert.equal([...saved.values()][0],retained);
 assert.equal(s.head,4);assert.equal(s.authority.sessions.size,2);
 console.log(JSON.stringify({transport:'actual production HTTP/WS with actual client nativeReversal and openReversalAction',candidate:'actual own ACK captured, not manually emitted',originValue:null,peerValue:null,serverValue:null,peerDisjointValueRetained:22,head:4,nativeSubmissionPosts:1,preparationPosts:1,duplicateConfirmAndRemount:'no additional POST; GET receipt only',actionCleanup:'only two human sessions remain',fault:dropReply?'client-hidden HTTP response after real native commit, explicit GET resolved receipt':'none',stores:'in-memory',application:'headless native state receives actual WS events; mounted browser NOT exercised'}));
}finally{
 helper?.dispose();state?.dispose();await executor?.close();await b?.close();await a?.close();for(const ws of rawSockets)ws.terminate();await native.close();await materializer.dispose();httpServer.closeAllConnections();await new Promise(resolve=>httpServer.close(resolve));
}
