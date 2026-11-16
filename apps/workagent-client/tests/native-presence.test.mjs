// Actual pinned membership service; inert session status only. No transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorSubject, NEVER, Subject, config } from 'rxjs';
import { MemberService, SessionStatus, CollaborationSession, CollaborationUIEventService } from '@univerjs-pro/collaboration-client';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { CombCmd, CmdRspCode } from '@univerjs/protocol';
import { observeNativePresence, observeNativeMembershipJoins } from '../src/native-presence.ts';

function fixture({offline=false,room=true}={}) {
  const service = new MemberService({getTypeOfUnitDisposed$:()=>NEVER});
  // Production attaches only after loadSheetAsync has established this room.
  if(room){service.updateMember('A',{memberID:'initial',userID:'initial',name:'Initial'});service.removeMember('A','initial');}
  const status = new BehaviorSubject(offline?SessionStatus.OFFLINE:SessionStatus.ONLINE); let selfID = 'self';
  const session = {get sessionStatus(){return status.value;},sessionStatus$:status,getMemberID:()=>selfID};
  const values = [], watcher = observeNativePresence('A','owner',session,service,v=>values.push(v));
  const update = (unit, memberID, userID, name) => service.updateMember(unit,{memberID,userID,name});
  return {service,status,values,watcher,update,setSelf:id=>{selfID=id;},get last(){return values.at(-1);},dispose(){watcher.dispose();service.dispose();status.complete();}};
}
test('rejoin removes old self and departed peer; fresh JOIN preserves live peer and same-account tab',()=>{
  const f=fixture();try{
    f.update('A','self','owner','Owner');f.update('A','departed','peer','Departed');f.update('A','live','peer','Live');
    f.update('B','foreign','peer','Foreign');
    f.status.next(SessionStatus.OFFLINE);f.setSelf('new-self');f.status.next(SessionStatus.ONLINE);
    f.update('A','new-self','owner','Owner');f.update('A','live','peer','Live');f.update('A','other-tab','owner','Other tab');
    assert.deepEqual(f.last.members.map(m=>m.memberID),['new-self','live','other-tab']);
    assert.equal(f.last.members.find(m=>m.memberID==='other-tab').self,false);
    assert.equal(f.service.getMember('B','foreign').name,'Foreign');
  }finally{f.dispose();}
});
test('initial offline with no room: ONLINE precedes native room creation and membership still arrives',()=>{
  const f=fixture({offline:true,room:false});try{
    f.status.next(SessionStatus.ONLINE);assert.equal(f.last.online,false);
    f.update('B','foreign','peer','Foreign'); // waitForRoom$ can emit undefined for another room.
    f.update('A','self','owner','Owner');f.update('A','peer','peer','Peer');
    assert.equal(f.last.online,true);assert.deepEqual(f.last.members.map(m=>m.memberID),['self','peer']);
  }finally{f.dispose();}
});
test('SDK membership service scopes names to unit, distinguishes same-account tabs and removes departed members',()=>{
  const f=fixture();try{
    f.update('B','foreign','peer','Foreign');f.update('A','peer','peer','Peer');assert.equal(f.last.online,false);
    f.update('A','self','owner','Owner');assert.deepEqual(f.last.members.map(m=>[m.name,m.self]),[['Peer',false],['Owner',true]]);
    f.update('A','other-tab','owner','Owner');assert.equal(f.last.members.at(-1).self,false);
    f.service.removeMember('A','peer');assert.equal(f.last.members.some(m=>m.name==='Peer'),false);
    assert.equal(f.last.members.some(m=>m.name==='Foreign'),false);
  }finally{f.dispose();}
});
test('disconnect hides cached members; reconnect requires current authenticated member; disposal fences callbacks',()=>{
  const f=fixture();try{
    f.update('A','self','owner','Owner');f.update('A','peer','peer','Peer');assert.equal(f.last.online,true);
    f.status.next(SessionStatus.OFFLINE);assert.deepEqual(f.last,{online:false,members:[]});
    f.update('A','late','peer','Late');assert.equal(f.last.online,false);
    f.setSelf('fresh');f.status.next(SessionStatus.ONLINE);assert.equal(f.last.online,false);
    f.update('A','fresh','wrong-principal','Wrong');assert.equal(f.last.online,false);
    f.update('A','fresh','owner','Owner');assert.equal(f.last.online,true);
    f.watcher.dispose();const count=f.values.length;f.update('A','later','peer','Later');f.status.next(SessionStatus.ONLINE);
    assert.equal(f.values.length,count);assert.equal(f.status.observers.length,0);assert.deepEqual(f.last,{online:false,members:[]});
  }finally{f.dispose();}
});
test('native session completion clears roster and releases membership subscription',()=>{
  const f=fixture();try{
    f.update('A','self','owner','Owner');f.status.complete();assert.deepEqual(f.last,{online:false,members:[]});
    const count=f.values.length;f.update('A','late','peer','Late');assert.equal(f.values.length,count);
  }finally{f.dispose();}
});
test('real native JOIN ordering, current transport routing, enter/leave and late disposed events',()=>{
  const service=new MemberService({getTypeOfUnitDisposed$:()=>NEVER}), sockets=new Subject(), values=[], sent=[];
  const session=new CollaborationSession({localUnitId:'A',target:{unitId:'A',unitType:2}},sockets,{error:e=>{throw e;}},service,{},new CollaborationUIEventService());
  const makeSource=memberID=>({memberID,message$:new Subject(),send:e=>sent.push(e),close(){},open$:NEVER,error$:NEVER,close$:NEVER});
  const member=(memberID,userID='peer')=>({memberID,userID,name:memberID});
  const join=(source,list,unit='A')=>source.message$.next({cmd:CombCmd.JOIN,code:CmdRspCode.OK,routeKey:unit,data:{roomInfos:{[unit]:{roomID:unit,members:list}}}});
  const recv=(source,eventID,data,unit='A')=>source.message$.next({cmd:CombCmd.RECV,code:CmdRspCode.OK,routeKey:unit,data:{eventID,data}});
  let watcher;
  try {
    sockets.next(null); // Same ordering as cached native load completing offline.
    watcher=observeNativePresence('A','owner',session,service,v=>values.push(v));
    const old=makeSource('old-self');sockets.next(old);join(old,[member('old-self','owner'),member('departed'),member('live')]);
    assert.equal(values.at(-1).online,true);
    sockets.next(null);assert.deepEqual(values.at(-1),{online:false,members:[]});
    const fresh=makeSource('new-self');sockets.next(fresh);
    join(old,[member('old-self','owner'),member('stale')]); // Old native message subscription is gone.
    join(fresh,[member('foreign')],'B');assert.equal(values.at(-1).online,false);
    join(fresh,[member('live'),member('new-self','owner'),member('other-tab','owner')]);
    assert.deepEqual(values.at(-1).members.map(m=>m.memberID),['live','new-self','other-tab']);
    recv(fresh,CollaborationEvent.USERS_ENTER,{...member('new-peer'),unitID:'A'});
    assert.equal(values.at(-1).members.at(-1).memberID,'new-peer');
    recv(fresh,CollaborationEvent.USERS_LEAVE,{memberID:'live',unitID:'A'});
    assert.equal(values.at(-1).members.some(m=>m.memberID==='live'),false);
    watcher.dispose();const count=values.length;recv(fresh,CollaborationEvent.USERS_ENTER,{...member('late'),unitID:'A'});assert.equal(values.length,count);
    assert.ok(sent.every(e=>e.cmd===CombCmd.JOIN)); // Inert sources; observer sent nothing.
  }finally{watcher?.dispose();session.dispose();service.dispose();sockets.complete();}
});

test('JOIN reconciliation starts before the UI attaches; cached earlier joins and stale sources cannot survive',()=>{
  const service=new MemberService({getTypeOfUnitDisposed$:()=>NEVER}),sources=new Subject();
  const joins=observeNativeMembershipJoins('A','owner',{socket$:sources},service);
  const old={memberID:'old',message$:new Subject()},fresh={memberID:'new',message$:new Subject()};
  const member=(memberID,userID='peer')=>({memberID,userID,name:memberID});
  const event=(list,unit='A')=>({cmd:CombCmd.JOIN,code:CmdRspCode.OK,routeKey:unit,data:{roomInfos:{[unit]:{roomID:unit,members:list}}}});
  try {
    sources.next(old);for(const m of [member('old','owner'),member('departed'),member('live')])service.updateMember('A',m);
    sources.next(null);sources.next(fresh);
    const current=[member('new','owner'),member('live'),member('other-tab','owner')];
    // Native merge may run before our observer; both subscription orders work.
    for(const m of current)service.updateMember('A',m);fresh.message$.next(event(current));
    assert.deepEqual(service.getRoom('A').getAllMembers().map(m=>m.memberID),['live','new','other-tab']);
    const values=[],status=new BehaviorSubject(SessionStatus.ONLINE);
    const view=observeNativePresence('A','owner',{sessionStatus:SessionStatus.ONLINE,sessionStatus$:status,getMemberID:()=>fresh.memberID},service,v=>values.push(v));
    assert.equal(values.at(-1).online,true);assert.equal(values.at(-1).members.some(m=>m.memberID==='departed'),false);
    old.message$.next(event([member('old','owner')]));fresh.message$.next(event([member('new','intruder')]));fresh.message$.next(event([member('new','owner')],'B'));
    assert.equal(service.getRoom('A').getAllMembers().length,3);
    view.dispose();joins.dispose();fresh.message$.next(event([member('new','owner')]));assert.equal(service.getRoom('A').getAllMembers().length,3);
    assert.equal(old.message$.observers.length+fresh.message$.observers.length+sources.observers.length,0);status.complete();
  }finally{joins.dispose();service.dispose();sources.complete();}
});

test('malformed JOIN containers or members neither prune SDK membership nor raise observer errors',async()=>{
  const service=new MemberService({getTypeOfUnitDisposed$:()=>NEVER}),sources=new Subject();
  const source={memberID:'self',message$:new Subject()},errors=[];
  const previous=config.onUnhandledError;config.onUnhandledError=e=>errors.push(e);
  const member=(memberID,userID='peer')=>({memberID,userID,name:memberID});
  const original=[member('self','owner'),member('live')];
  for(const m of original)service.updateMember('A',m);
  const joins=observeNativeMembershipJoins('A','owner',{socket$:sources},service);
  const dataWith=members=>({roomInfos:{A:{roomID:'A',members}}});
  try{
    sources.next(source);
    const malformed=[
      {roomInfos:{A:{roomID:'A'}}}, // Reviewer's exact reproduction.
      undefined,null,false,1,'data',[],{},
      ...[null,1,'rooms',[]].map(roomInfos=>({roomInfos})),
      ...[null,1,'room',[],{}, {roomID:7,members:original}].map(A=>({roomInfos:{A}})),
      ...[null,false,1,'members',{}].map(dataWith),
      ...[null,false,1,'member',[],{}, {memberID:'bad'},
        {memberID:3,userID:'peer',name:'Bad'}, {memberID:'bad',userID:3,name:'Bad'},
        {memberID:'bad',userID:'peer',name:3}, {memberID:'bad',userID:'peer'},
        {memberID:'bad',userID:'peer',name:'Bad',avatar:null},
      ].map(bad=>dataWith([member('self','owner'),bad])),
    ];
    for(const data of malformed){
      source.message$.next({cmd:CombCmd.JOIN,code:CmdRspCode.OK,routeKey:'A',data});
      assert.deepEqual(service.getRoom('A').getAllMembers(),original,'malformed response must not reconcile a partial list');
    }
    // RxJS reports subscription exceptions asynchronously; observe, never hide them.
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(errors,[]);
    source.message$.next({cmd:CombCmd.JOIN,code:CmdRspCode.OK,routeKey:'A',data:dataWith([member('self','owner')])});
    assert.deepEqual(service.getRoom('A').getAllMembers(),[member('self','owner')]);
  }finally{
    joins.dispose();service.dispose();sources.complete();
    await new Promise(resolve=>setTimeout(resolve,0));
    config.onUnhandledError=previous;
  }
});
