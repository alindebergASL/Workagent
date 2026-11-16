// Test-only actual SDK entity/commands/service, in-memory public adapters.
// Session event delivery is an inert direct harness, NOT a socket/browser proof.
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BehaviorSubject, Subject } from 'rxjs';
import { UserManagerService, UndoCommand } from '@univerjs/core';
import { SetRangeValuesCommand } from '@univerjs/sheets';
import { CollaborationEvent, parseProtocolChangeset, parseChangesetToProtocol } from '@univerjs-pro/collaboration';
import { SheetCollaborationEntity, SheetTransformSelectionsService, CollaborationUIEventService, SessionStatus } from '@univerjs-pro/collaboration-client';
import { guardedUndoFixture, operationHash } from './native-guarded-undo-fixture.mjs';
import { server, client, UNIT, TAB } from './native-history-sdk.test.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const wait = async predicate => { const until=Date.now()+3000;while(!predicate()){assert.ok(Date.now()<until,'bounded SDK wait expired');await new Promise(r=>setTimeout(r,10));} };
async function entityClient(s, member='owner', userID='owner', initial=s.initial) {
  const c=client(initial,userID),injector=c.univer.__getInjector(),events=new Subject(),status=new BehaviorSubject(SessionStatus.ONLINE),sent=[],outcomes=[],faults=[];
  injector.get(UserManagerService).setCurrentUser({userID,name:userID,avatar:''});
  injector.add([SheetTransformSelectionsService]);injector.add([CollaborationUIEventService]);
  s.authority.sessions.set(member,{userID,unitID:UNIT,revision:1});
  let submit=changeset=>s.service.submitChangeset({changeset},{userID,memberID:member});
  const session={event$:events,sessionStatus$:status,get sessionStatus(){return status.value;},getMemberID:()=>member,
    async send(event){
      sent.push(structuredClone(event));
      if(event.eventID===CollaborationEvent.FETCH_MISSING){events.next({eventID:CollaborationEvent.PSEUDO_FETCH_MISSING_RESULT,data:{changesets:[],lastRevision:s.head}});return;}
      if(event.eventID!==CollaborationEvent.SUBMIT_CHANGESET)throw Error(`unexpected harness event ${event.eventID}`);
      const changeset=parseChangesetToProtocol(event.data.changeset);
      const result=await submit(changeset);outcomes.push(result);
      if(result.status==='committed')events.next({eventID:CollaborationEvent.CHANGESET_ACK,data:result.changeset});
      else {faults.push(result);if(result.status==='rejected')events.next({eventID:CollaborationEvent.PERMISSION_REJ,data:changeset,reason:result.error.message});}
    }
  };
  let entity,observer;
  try {entity=injector.createInstance(SheetCollaborationEntity,UNIT,2,session);await entity.init();observer={dispose(){}};}
  catch(error){entity?.dispose();c.dispose();events.complete();status.complete();throw error;}
  return {...c,entity,sent,outcomes,faults,setSubmit(fn){submit=fn;},
    async edit(value,col=0){return c.commands.executeCommand(SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:col,endColumn:col},value:{v:value}});},
    async settled(count){await wait(()=>outcomes.length>=count);assert.deepEqual(faults,[]);await wait(()=>!entity.hasWritePending());},
    remote(cs){events.next({eventID:CollaborationEvent.NEW_CHANGESETS,data:cs});},
    dispose(){observer.dispose();entity.dispose();c.dispose();events.complete();status.complete();}
  };
}
export { entityClient, hash, wait };
if(process.argv[1]===fileURLToPath(import.meta.url)){
test('actual native entity batches two commands and exposes request identities at direct ACK, not in undo entries',async t=>{
  const s=await server();let c;
  try {c=await entityClient(s);await c.edit(11);const first=structuredClone(c.undo.pitchTopUndoElement());await c.edit(22,1);const second=structuredClone(c.undo.pitchTopUndoElement());await c.settled(1);
    t.diagnostic(JSON.stringify({requests:c.outcomes.map(r=>({status:r.status,revision:r.changeset?.revision,sid:r.changeset?.sid,reqId:r.changeset?.reqId,mutationCount:r.changeset?.mutations.length,hash:hash(r.changeset?.mutations)})),undoEntryKeys:Object.keys(first),undoEntries:c.undo.getUndoRedoStatus(UNIT).undos}));
    assert.equal(c.outcomes.length,1);assert.equal(c.outcomes[0].changeset.mutations.length,2);assert.equal(c.outcomes[0].status,'committed');assert.equal(c.undo.getUndoRedoStatus(UNIT).undos,2);
    assert.equal(first.id,undefined);assert.equal(second.id,undefined);await assert.rejects(guardedUndoFixture(s).prepare('owner','owner',target(c.outcomes[0].changeset)),/guard_not_single_value_operation/);
  }finally{c?.dispose();await s.dispose();}
});

const target=c=>({revision:c.revision,sid:c.sid,reqId:c.reqId,hash:operationHash(c)});
test('repeated equal commands have indistinguishable undo entries and operation hashes but different native request IDs; other same-account tab is distinct',async t=>{
  const s=await server();let c,other;
  try{c=await entityClient(s);await c.edit(11);await c.settled(1);await c.edit(11);await c.settled(2);const second=structuredClone(c.undo.pitchTopUndoElement());await c.edit(11);await c.settled(3);const third=structuredClone(c.undo.pitchTopUndoElement());
    assert.deepEqual(second,third);const requests=c.outcomes.map(r=>r.changeset);assert.equal(operationHash(requests[1]),operationHash(requests[2]));assert.notEqual(requests[1].reqId,requests[2].reqId);
    other=await entityClient(s,'owner-other-tab','owner',await s.data());await other.edit(11);await other.settled(1);const next=other.outcomes[0].changeset;
    assert.equal(next.userID,requests[2].userID);assert.notEqual(next.sid,requests[2].sid);assert.notEqual(next.memberID,requests[2].memberID);
    const guard=guardedUndoFixture(s);await assert.rejects(guard.prepare('owner','owner',target(next)),/guard_original_identity/);await assert.rejects(guard.prepare('owner','owner',target(requests[2])),/guard_head_changed/);
    t.diagnostic(JSON.stringify({equalUndoEntries:true,equalOperationHashes:true,reqIds:requests.map(c=>c.reqId),samePrincipalDifferentMemberAndSID:true}));
  }finally{other?.dispose();c?.dispose();await s.dispose();}
});
test('single exact native request binds to SDK inverse factory; explicit inverse commit succeeds without executing local Undo',async t=>{
  const s=await server();let c;
  try{c=await entityClient(s);await c.edit(11);await c.settled(1);const original=c.outcomes[0].changeset,guard=guardedUndoFixture(s),intent=await guard.prepare('owner','owner',target(original));
    assert.deepEqual(intent.inverse,c.undo.pitchTopUndoElement().undoMutations[0]);
    const request=guard.request(intent);const result=await guard.submit(intent,request);assert.equal(result.status,'committed',JSON.stringify(result));assert.equal(guard.commitChecks,1);assert.equal(s.head,3);
    assert.equal(c.cell(0,0),11,'server submission does not run local Undo');c.remote(result.changeset);assert.equal(c.cell(0,0),null);assert.equal((await s.data()).sheets[TAB].cellData?.[0]?.[0]?.v??null,null);
    const retried=await guard.submit(intent,request);assert.equal(retried.status,'already-committed');assert.equal(s.head,3);
    t.diagnostic(JSON.stringify({serverHead:s.head,clientAfterNativeDelivery:c.cell(0,0),stackAfterDelivery:c.undo.getUndoRedoStatus(UNIT),sameRequestRetry:retried.status}));
  }finally{c?.dispose();await s.dispose();}
});
test('preflight then peer commit refuses undo at actual fenced commit without peer-value loss; manual editing remains legitimate',async t=>{
  const s=await server();let c,peer;
  try{c=await entityClient(s);await c.edit(11);await c.settled(1);const guard=guardedUndoFixture(s),intent=await guard.prepare('owner','owner',target(c.outcomes[0].changeset));
    peer=await entityClient(s,'peer','peer',await s.data());await peer.edit(22);await peer.settled(1);c.remote(peer.outcomes[0].changeset);
    const refused=await guard.submit(intent,guard.request(intent));assert.equal(refused.status,'rejected',JSON.stringify(refused));assert.equal(refused.error.retryable,false);assert.equal(guard.commitChecks,1);assert.equal(s.head,3);assert.equal(c.cell(0,0),22);assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,22);
    // Without a guarded intent this is an ordinary editor-authorized cell write.
    await c.edit(33);await c.settled(2);assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,33);
    t.diagnostic(JSON.stringify({guardedOutcome:refused.status,reason:refused.error.message,manualEditHead:s.head}));
  }finally{peer?.dispose();c?.dispose();await s.dispose();}
});
test('forged inverse and changed epoch refuse; local Undo before a racing refusal leaves recovery work, not an automatic rollback',async t=>{
  const s=await server();let c,peer;
  try{c=await entityClient(s);await c.edit(11);await c.settled(1);const guard=guardedUndoFixture(s),original=c.outcomes[0].changeset,intent=await guard.prepare('owner','owner',target(original));
    await assert.rejects(guard.prepare('peer','peer',target(original)),/guard_original_identity/);
    await assert.rejects(guard.prepare('owner','owner',{...target(original),hash:'forged'}),/guard_original_identity/);
    const forged=guard.request(intent,'forged-inverse');forged.mutations[0].data=JSON.stringify({...intent.inverse.params,cellValue:{0:{0:{v:999}}}});
    assert.equal((await guard.submit(intent,forged)).status,'rejected');assert.equal(s.head,2);
    peer=await entityClient(s,'peer','peer',await s.data());await peer.edit(22);await peer.settled(1);c.remote(peer.outcomes[0].changeset);
    c.setSubmit(cs=>guard.submit(intent,cs));const conflicts=[];const sub=c.entity.conflict$.subscribe(v=>conflicts.push(v));
    try{assert.equal(await c.commands.executeCommand(UndoCommand.id),true);await wait(()=>c.outcomes.length===2);await wait(()=>conflicts.length===1);
      assert.equal(c.outcomes[1].status,'rejected');assert.equal(c.cell(0,0),null);assert.equal((await s.data()).sheets[TAB].cellData[0][0].v,22);assert.equal(s.head,3);assert.equal(c.entity.state.status,'conflict');
      t.diagnostic(JSON.stringify({serverValue:22,localValue:c.cell(0,0),state:c.entity.state.status,recoveryReason:conflicts[0].reason,hasRecovery:!!conflicts[0].localChanges,automaticCompensation:false}));
    }finally{sub.unsubscribe();}
    await s.workspace.share('owner',UNIT,{commandId:'epoch-change',peer:'peer',role:'read',accessRevision:1});
    const revoked=await guard.submit(intent,guard.request(intent,'epoch-undo'));assert.equal(revoked.status,'rejected');assert.equal(s.head,3);
  }finally{peer?.dispose();c?.dispose();await s.dispose();}
});
}
