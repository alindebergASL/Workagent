// Test harness only: actual endpoint/production ACL wrappers, inert NodeRouter
// connections and public codecs. No listener, transport timing or durability proof.
import { CombCmd } from '@univerjs/protocol';
import { Subject, BehaviorSubject } from 'rxjs';
import { UniverCollabService, UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { UniverCollabEndpoint } from '@univerjs-pro/collaboration-endpoint';
import { CollaborationSession, MemberService, CommentService, CollaborationUIEventService, serializeCombRequest, deserializeToCombResponse } from '@univerjs-pro/collaboration-client';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { NativeAuthority, guardedEndpoint } from '../src/native-collaboration.mjs';
import { server, client, UNIT } from './native-history-sdk.test.mjs';
export const origin='http://native-proof.invalid';
export async function fixture(){
  // Reuse only the existing memory stores/seed; retire its service/authority.
  // The fresh authority below starts empty; only endpoint admission adds members.
  const seed=await server();await seed.dispose();
  const service=new UniverCollabService({dbAdapter:seed.db,enableUnitPermissionAnalysis:true,runtime:{execution:{mode:'in-process'}}});
  const authority=new NativeAuthority(seed.workspace,null),endpoint=new UniverCollabEndpoint(service);
  authority.install(service,endpoint);
  const auth={authenticate:r=>r.fixturePrincipal,profile:id=>({name:id})},routes={};
  const router=Object.fromEntries(['get','post','delete','upgrade'].map(method=>[method,(path,handler)=>{routes[`${method} ${path}`]=handler;}]));
  guardedEndpoint(endpoint,authority,auth,origin).register(router);
  const scope=(principal,fn)=>authority.scope.run({unitID:UNIT,session:{userID:principal,unitID:UNIT,revision:1}},fn);
  async function http(method,path,principal,body={}){
    let output,status=200;const req={method:method.toUpperCase(),url:path,headers:{origin},fixturePrincipal:principal,nativeUnitID:UNIT,nativeAccess:{userID:principal,unitID:UNIT,revision:1}};
    const response={setHeader(){},get statusCode(){return status;},set statusCode(v){status=v;},end(v){output=v;}};
    const handler=routes[`${method} ${path}`];if(!handler)throw Error(`missing registered route ${method} ${path}`);
    await scope(principal,()=>handler({incomingMessage:req,response,userID:principal,customData:{},params:{},readJson:async()=>body,readBody:async()=>Buffer.from(JSON.stringify(body))}));
    return {status,body:output?JSON.parse(output):null};
  }
  const materializer=new UnitSnapshotMaterializer({execution:{mode:'in-process'}});
  return {...seed,get head(){return seed.head;},service,authority,endpoint,routes,scope,http,
    async data(){const load=await scope('owner',()=>service.getUnitLoadDataWithBlocks({unitID:UNIT,type:2,revision:0},{userID:'owner'}));const m=await materializer.materializeSnapshot(load);return transformSnapshotToWorkbookData(m.snapshot,[...m.sheetBlocks]);},
    async dispose(){await endpoint.dispose();await materializer.dispose();await service.dispose();}
  };
}
export async function wait(fn){for(let n=0;n<300;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('delivery timeout');}
export async function connect(s,principal){
  const ticket=(await s.http('get','/universer-api/user/session-ticket',principal)).body.ticket;
  const frames=[],events=[],message$=new Subject(),close$=new Subject(),socket$=new BehaviorSubject(null);
  let handlers,memberID,closed=false;
  const connection={id:`inert-${principal}`,customData:{},send(data){
    const frame=deserializeToCombResponse({data:typeof data==='string'?data:new TextDecoder().decode(data)});
    frames.push(frame);if(frame.data?.memberID)memberID=frame.data.memberID;message$.next(frame);
  },close(){closed=true;close$.next();}};
  const incomingMessage={method:'GET',url:`/universer-api/comb/connect?sessionTicket=${encodeURIComponent(ticket)}`,headers:{origin,host:'native-proof.invalid'},fixturePrincipal:principal,nativeUnitID:UNIT,nativeAccess:{userID:principal,unitID:UNIT,revision:1}};
  await s.routes['upgrade /universer-api/comb/connect']({incomingMessage,customData:{},params:{},reject(code){throw Error(`upgrade rejected ${code}`);},accept(h){handlers=h;}});
  if(!handlers)throw Error('upgrade did not accept');
  await handlers.open({connection});await handlers.message({connection,data:serializeCombRequest({cmd:CombCmd.HELLO,data:{},routeKey:'',routeType:''}),customData:{}});await wait(()=>memberID);
  const socket={memberID,message$,close$,open$:new Subject(),error$:new Subject(),close(){connection.close();},send(event){return handlers.message({connection,data:serializeCombRequest(event),customData:{}});}};
  const log={debug(){},info(){},warn(){},error(){}};const local=client(s.initial,principal);const members=local.univer.__getInjector().createInstance(MemberService);
  const session=new CollaborationSession({localUnitId:UNIT,unitType:2,target:{unitId:UNIT,unitType:2}},socket$,log,members,new CommentService(),new CollaborationUIEventService());
  const observer=session.event$.subscribe(e=>events.push(e));socket$.next(socket);
  await wait(()=>session.sessionStatus===3);
  return {local,session,frames,events,memberID,get closed(){return closed;},async dispose(){observer.unsubscribe();session.dispose();members.dispose();local.dispose();socket$.complete();await handlers.close({connection,code:1000,reason:'proof complete'});message$.complete();close$.complete();}};
}
