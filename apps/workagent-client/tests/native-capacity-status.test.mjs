// Public SDK events, inert delivery only. No licensed/server/browser evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BehaviorSubject,Subject} from 'rxjs';
import {CollaborationEvent,parseChangesetToProtocol} from '@univerjs-pro/collaboration';
import {CollaborationUIEventService,CollaborationUIEventId,SheetCollaborationEntity,SheetTransformSelectionsService,SessionStatus} from '@univerjs-pro/collaboration-client';
import {UserManagerService} from '@univerjs/core';
import {SetRangeValuesCommand} from '@univerjs/sheets';
import {nativeCapacityStatus} from '../src/native-capacity-status.ts';
import {client,UNIT,TAB} from '../../workagent-server/tests/native-history-sdk.test.mjs';
import {blank} from '../../workagent-server/tests/native-comments-sdk.test.mjs';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const resend=(reqId=1,reason='license_editing_connections_exceeded',unitID='A')=>({unitID,reqId,reason,attempt:1,elapsedMs:10,nextDelayMs:1000,unsyncedMutationCount:1});
const envelope=(reqId=1,sid='synthetic',unitID='A')=>({unitID,sid,reqId});
const retry=(data=envelope())=>({eventID:CollaborationEvent.CHANGESET_SHOULD_RETRY,data,code:9016});
const ack=(data=envelope())=>({eventID:CollaborationEvent.CHANGESET_ACK,data:{...data,revision:3}});
test('quota requires exact reason and scoped identity; unrelated, older and generic events cannot misattribute or clear it',()=>{
 const entities=new Subject(),events=new Subject(),resends=new Subject(),ui=new CollaborationUIEventService();let pending=true,notifications=0;
 const helper=nativeCapacityStatus('A',{getCollabEntity$:()=>entities},ui,()=>pending,()=>notifications++);
 const e={session:{event$:events},changesetResend$:resends};entities.next(e);
 try{
  resends.next(resend());assert.equal(helper.view().message,'Waiting for native acknowledgement','no SID from resend alone');
  events.next(retry());for(const reason of ['ack_timeout','should_retry','reconnect','request_failed']){resends.next(resend(1,reason));assert.doesNotMatch(helper.view().message,/capacity/i);}
  resends.next(resend(1,'license_editing_connections_exceeded','foreign'));assert.doesNotMatch(helper.view().message,/capacity/i);
  resends.next(resend());assert.match(helper.view().message,/Editing capacity refused/);
  events.next(ack(envelope(1,'foreign')));events.next(ack(envelope(2)));events.next(ack(envelope(1,'synthetic','foreign')));resends.next(resend(1,'ack_timeout'));assert.match(helper.view().message,/Editing capacity refused/);
  events.next(ack());assert.equal(helper.view().message,undefined);resends.next(resend());events.next(retry());assert.equal(helper.view().message,undefined);
  events.next(retry(envelope(2)));resends.next(resend(2));assert.match(helper.view().message,/Editing capacity refused/);
  events.next(ack());resends.next(resend(1,'request_failed'));assert.match(helper.view().message,/Editing capacity refused/);
  pending=false;assert.equal(helper.view().message,undefined);pending=true;resends.next(resend(2));assert.equal(helper.view().message,undefined);
  events.next(retry(envelope(3)));resends.next(resend(3));assert.match(helper.view().message,/Editing capacity refused/);
  const old=notifications;entities.next({session:{event$:new Subject()},changesetResend$:new Subject()});events.next(retry(envelope(4)));resends.next(resend(4));assert.equal(helper.view().message,undefined);assert.equal(notifications,old+1);
  ui.emitEvent({id:CollaborationUIEventId.LICENSE_DOMAIN_REJECTED,unitID:'foreign'});assert.equal(helper.view().domainRejected,false);
  ui.emitEvent({id:CollaborationUIEventId.LICENSE_DOMAIN_REJECTED,unitID:'A'});assert.equal(helper.view().domainRejected,true);
 }finally{helper.dispose();entities.complete();events.complete();resends.complete();}
 assert.deepEqual(helper.view(),{});
});

test('actual public SheetCollaborationEntity emits quota reason; HTTP completion is not ACK, matching native ACK settles',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const c=client(blank(UNIT),'owner'),injector=c.univer.__getInjector(),events=new Subject(),status=new BehaviorSubject(SessionStatus.ONLINE),sent=[];
 const ui=new CollaborationUIEventService();let entity,helper,sub;
 try{
  injector.get(UserManagerService).setCurrentUser({userID:'owner',name:'Owner',avatar:''});injector.add([SheetTransformSelectionsService]);injector.add([CollaborationUIEventService,{useValue:ui}]);
  const session={event$:events,sessionStatus$:status,get sessionStatus(){return status.value;},getMemberID:()=> 'member',async send(event){sent.push(structuredClone(event));}};
  entity=injector.createInstance(SheetCollaborationEntity,UNIT,2,session);await entity.init();
  const entities=new BehaviorSubject(entity),seen=[];
  helper=nativeCapacityStatus(UNIT,{getCollabEntity$:()=>entities},ui,()=>entity.hasWritePending(),()=>{});sub=entity.changesetResend$.subscribe(e=>seen.push(e));
  await c.commands.executeCommand(SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:0,endColumn:0},value:{v:44}});
  for(const mutation of c.emitted)entity.onLocalMutation(mutation);await flush();t.mock.timers.tick(2000);await flush();
  const submit=sent.find(e=>e.eventID===CollaborationEvent.SUBMIT_CHANGESET);assert.ok(submit,JSON.stringify({expected:'public entity submission',state:entity.state.status,mutations:c.emitted.length,events:sent.map(e=>e.eventID)}));
  const changeset=submit.data.changeset;assert.ok(changeset.sid);assert.equal(changeset.reqId,1);assert.equal(entity.hasWritePending(),true);assert.equal(helper.view().message,undefined);
  events.next({eventID:CollaborationEvent.CHANGESET_SHOULD_RETRY,data:changeset,code:9016});t.mock.timers.tick(0);await flush();
  assert.equal(seen.at(-1)?.reason,'license_editing_connections_exceeded');assert.equal(seen.at(-1)?.reqId,changeset.reqId);assert.match(helper.view().message,/Editing capacity refused/);
  assert.ok(sent.filter(e=>e.eventID===CollaborationEvent.SUBMIT_CHANGESET).every(e=>e.data.changeset.sid===changeset.sid&&e.data.changeset.reqId===changeset.reqId),'only SDK retry retains exact identity');
  await flush();assert.equal(entity.hasWritePending(),true,'resolved inert HTTP send is not native acknowledgement');assert.match(helper.view().message,/Editing capacity refused/);
  events.next({eventID:CollaborationEvent.CHANGESET_ACK,data:parseChangesetToProtocol({...changeset,revision:changeset.baseRev+1})});await flush();
  assert.equal(entity.hasWritePending(),false);assert.equal(helper.view().message,undefined);
 }finally{helper?.dispose();sub?.unsubscribe();entity?.dispose();c.dispose();events.complete();status.complete();}
});

test('capacity observation lifetime: complete public identity, duplicate entity, domain precedence and replacement/disposal cleanup',()=>{
 const entities=new Subject(),ui=new CollaborationUIEventService();let pending=true,notices=0;
 const first={session:{event$:new Subject()},changesetResend$:new Subject()},second={session:{event$:new Subject()},changesetResend$:new Subject()};
 const helper=nativeCapacityStatus('A',{getCollabEntity$:()=>entities},ui,()=>pending,()=>notices++);
 try{
  entities.next(first);
  first.session.event$.next(retry(envelope(1,'foreign','B')));first.changesetResend$.next(resend());assert.doesNotMatch(helper.view().message,/capacity/i,'wrong unit cannot establish first SID');
  first.session.event$.next(retry(envelope(0)));first.changesetResend$.next(resend());assert.doesNotMatch(helper.view().message,/capacity/i,'invalid request cannot establish first SID');
  first.session.event$.next(retry());first.changesetResend$.next(resend());assert.match(helper.view().message,/Editing capacity refused/);
  entities.next(first);assert.match(helper.view().message,/Editing capacity refused/,'duplicate same-entity notification is not a new lifetime');
  first.session.event$.next(retry(envelope(2,'foreign')));first.changesetResend$.next(resend());assert.match(helper.view().message,/Editing capacity refused/,'foreign SID cannot replace established request');
  const count=notices;first.changesetResend$.next({reqId:1,reason:'reconnect'});assert.equal(notices,count,'underspecified event is rejected, not a public contract');
  ui.emitEvent({id:CollaborationUIEventId.LICENSE_DOMAIN_REJECTED,unitID:'A'});assert.equal(helper.view().domainRejected,true);
  entities.next(second);assert.equal(first.session.event$.observers.length+first.changesetResend$.observers.length,0);assert.equal(helper.view().message,undefined);assert.equal(helper.view().domainRejected,true,'domain rejection belongs to mounted instance, not one request/entity');
  const after=notices;first.session.event$.next(retry());first.changesetResend$.next(resend());assert.equal(notices,after);
  second.session.event$.next(retry(envelope(1,'new')));second.changesetResend$.next(resend());assert.match(helper.view().message,/Editing capacity refused/);assert.equal(helper.view().domainRejected,true);
  helper.dispose();const disposed=notices;second.session.event$.next(retry(envelope(2,'new')));second.changesetResend$.next(resend(2));ui.emitEvent({id:CollaborationUIEventId.LICENSE_DOMAIN_REJECTED});assert.equal(notices,disposed);
  assert.equal(entities.observers.length+second.session.event$.observers.length+second.changesetResend$.observers.length,0);assert.deepEqual(helper.view(),{});
  const reopened=nativeCapacityStatus('A',{getCollabEntity$:()=>entities},ui,()=>pending,()=>{});try{entities.next(second);assert.equal(reopened.view().domainRejected,false);assert.equal(reopened.view().message,undefined);}finally{reopened.dispose();}
 }finally{helper.dispose();entities.complete();first.session.event$.complete();first.changesetResend$.complete();second.session.event$.complete();second.changesetResend$.complete();}
});
