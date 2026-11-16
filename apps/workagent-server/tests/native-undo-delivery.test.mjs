// Actual endpoint admission/envelopes/codecs/session and native public states.
// Inert NodeRouter connections, memory stores; not a live WebSocket/UI proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ILogService, ICommandService, IUndoRedoService } from '@univerjs/core';
import { SetRangeValuesCommand } from '@univerjs/sheets';
import { SyncedState } from '@univerjs-pro/collaboration-client';
import { CollaborationEvent, RevisionService, ITransformService, parseProtocolChangeset } from '@univerjs-pro/collaboration';
import { fixture,connect,wait } from './native-undo-delivery-fixture.mjs';
import { guardedUndoFixture,operationHash } from './native-guarded-undo-fixture.mjs';
import { client,UNIT,TAB } from './native-history-sdk.test.mjs';

test('endpoint-admitted origin receives real ACK, peer receives NEW; Synced origin cannot apply accepted explicit inverse',async t=>{
 const s=await fixture();let a,b,state;
 try{
  assert.equal(s.authority.unitID,null);assert.equal(s.authority.sessions.size,0);
  a=await connect(s,'owner');b=await connect(s,'peer');
  assert.equal(s.authority.sessions.size,2);assert.notEqual(a.memberID,b.memberID);
  assert.equal(s.authority.sessions.get(a.memberID).userID,'owner');
  const scoped={service:{submitChangeset:(request)=>s.scope('owner',()=>s.service.submitChangeset(request,{userID:'owner',memberID:a.memberID}))}};
  // Initial ordinary command uses the existing direct ACK state harness. All
  // inverse delivery below comes exclusively from endpoint -> codec -> Session.
  const first=await a.local.run(scoped,SetRangeValuesCommand.id,{unitId:UNIT,subUnitId:TAB,range:{startRow:0,endRow:0,startColumn:0,endColumn:0},value:{v:11}});
  assert.equal(first.status,'committed');
  await wait(()=>b.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS));
  b.local.receive(b.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS).data);
  const guard=guardedUndoFixture(s),c=first.changeset;
  const intent=await guard.prepare('owner',a.memberID,{revision:c.revision,sid:c.sid,reqId:c.reqId,hash:operationHash(c)});
  const request=guard.request(intent,'delivery-inverse',1);
  const result=await s.scope('owner',()=>guard.submit(intent,request));assert.equal(result.status,'committed');
  await wait(()=>a.events.some(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===3)&&b.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===3));
  const ack=a.events.find(e=>e.eventID===CollaborationEvent.CHANGESET_ACK&&e.data.revision===3);
  assert.equal(a.events.some(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===3),false);
  const i=a.local.univer.__getInjector();
  state=new SyncedState(UNIT,2,{onStateChange(){throw Error('unexpected state transition');}},i.get(RevisionService),i,i.get(IUndoRedoService),i.get(ICommandService),i.get(ILogService),i.get(ITransformService));
  assert.throws(()=>state.onRemoteAck(parseProtocolChangeset(ack.data)),/received acknowledgement/);
  b.local.receive(b.events.find(e=>e.eventID===CollaborationEvent.NEW_CHANGESETS&&e.data.revision===3).data);
  assert.equal(a.local.cell(0,0),11);assert.equal(b.local.cell(0,0),null);assert.equal(s.head,3);
  assert.equal((await s.data()).sheets[TAB].cellData[0]?.[0]?.v??null,null);
  const retry=await s.scope('owner',()=>guard.submit(intent,request));assert.equal(retry.status,'already-committed');assert.equal(s.head,3);
  // Snapshot reopening demonstrates clean recovery mechanics only. It is NOT a
  // production clean-client gate: pending input/composer/typing are not observable
  // in this headless fixture and no client is automatically disposed/reloaded.
  const recovered=client(await s.data(),'owner');try{assert.equal(recovered.cell(0,0),null);assert.deepEqual(recovered.undo.getUndoRedoStatus(UNIT),{undos:0,redos:0});}finally{recovered.dispose();}
  t.diagnostic(JSON.stringify({originEvent:ack.eventID,peerEvent:CollaborationEvent.NEW_CHANGESETS,origin:11,peer:null,head:s.head,duplicate:retry.status,reopenValue:null,liveApply:'unsupported',reloadSafety:'not established for pending UI work'}));
  await a.dispose();a=null;assert.equal(s.authority.sessions.size,1);
  const afterLeave=await s.scope('owner',()=>guard.submit(intent,request));assert.equal(afterLeave.status,'rejected');assert.equal(s.head,3);
 }finally{state?.dispose();await b?.dispose();await a?.dispose();await s.dispose();}
});
