// Offline integration: real Univer sheet + collaboration client, MOCKED socket only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Subject, of, NEVER, firstValueFrom, filter, timeout } from 'rxjs';
import { Univer, IAuthzIoService, IUndoRedoService, IMentionIOService, Plugin, Inject, Injector, ICommandService, IUniverInstanceService, UniverInstanceType, UserManagerService, createDefaultUser } from '@univerjs/core';
import { UniverSheetsPlugin, SetRangeValuesMutation, SetRangeValuesCommand, SheetsSelectionsService } from '@univerjs/sheets';
import { UniverCollaborationPlugin, RevisionService, CollaborationEvent as E, parseChangesetToProtocol } from '@univerjs-pro/collaboration';
import { UniverCollaborationClientPlugin, CollaborationController, CollaborationSessionService, SessionStatus, CollaborationStatus } from '@univerjs-pro/collaboration-client';
import { CombCmd, CmdRspCode, UnitRole } from '@univerjs/protocol';
import { nativeOperationRecovery } from '../src/native-operation-recovery.ts';
import { nativeCollaborationClient } from '../src/native-collaboration-client.ts';
import { nativeOutboundInspection } from '../src/native-outbound-inspection.ts';
import { nativeCursorSessionOverride } from '../src/native-cursor-session.ts';

const tab = 'sheet1', value = 'B05 fixture value';
const reason = 'Fixture validator rejected this edit';
const wait = (stream, phase) => firstValueFrom(stream.pipe(timeout(4000))).catch(cause => {
  throw Error(`Did not observe ${phase}`, {cause});
});

for (const mode of ['conflict', 'outbound']) test(mode === 'conflict'
  ? 'SDK conflict$ captures an ordinary rejected edit; recovery exports without send (mocked transport)'
  : 'public scalar SDK command on an ordinary editor session (mocked transport)', { timeout: 10_000 }, async t => {
  const unitID = randomUUID(), member = { ...createDefaultUser(UnitRole.Owner), memberID: randomUUID() };
  const offline = () => { throw Error('Offline fixture: network I/O is forbidden'); };
  const http = t.mock.method(globalThis, 'fetch', offline);
  const ws = t.mock.method(globalThis, 'WebSocket', function () { offline(); });
  let injector;
  class FixturePlugin extends Plugin {
    static pluginName = 'b05-fixture';
    constructor(_config, di) { super(); injector = di; }
  }
  Inject(Injector)(FixturePlugin, undefined, 1);
  const sends = [], submissions = [];
  let acknowledge;
  const replies = new Subject();
  class MockSocketService {
    async createSocket() {
      return { memberID: member.memberID, open$: of(new Event('open')), message$: replies.asObservable(),
        close$: NEVER, error$: NEVER, close() {}, async send(request) {
          const {cmd, data, routeKey} = request;
          sends.push([cmd, data?.eventID]);
          const respond = (cmd, data) => setImmediate(() => replies.next({ cmd, routeKey, data, code: CmdRspCode.OK }));
          switch (cmd) {
            case CombCmd.HELLO: return void respond(cmd, {memberID: member.memberID});
            case CombCmd.JOIN: return void respond(cmd, {roomInfos: {[unitID]: {roomID:unitID, members:[member]}}});
            case CombCmd.INGEST:
              if (data.eventID === E.FETCH_MISSING) return void respond(CombCmd.RECV, {eventID:E.PSEUDO_FETCH_MISSING_RESULT, data:{changesets:[]}});
              if (data.eventID === E.SUBMIT_CHANGESET) {
                const cs = structuredClone(data.data.changeset);
                submissions.push(cs);
                if (mode !== 'conflict') {
                  acknowledge = () => respond(CombCmd.RECV, {eventID:E.CHANGESET_ACK, data:parseChangesetToProtocol({...cs,revision:cs.baseRev+1})});
                  return;
                }
                return void respond(CombCmd.RECV, {eventID:E.CHANGESET_REJ, reason, data:{unitID, changeset:{baseRev:cs.baseRev, revision:cs.revision}}});
              }
              break;
            case CombCmd.LEAVE: return;
          }
          throw Error(`Unexpected mock request: ${cmd}/${data?.eventID}`);
        } };
    }
  }
  // Use collaborative undo and mention services; keep the headless core local authz provider.
  const u = new Univer({ locales: { enUS: {} }, override:[IUndoRedoService,IMentionIOService].map(id=>[id,null]) });
  t.after(() => { u.dispose(); replies.complete(); });
  u.registerPlugin(FixturePlugin);
  u.registerPlugin(UniverSheetsPlugin);
  u.registerPlugin(UniverCollaborationPlugin);
  let entity;
  const disk = new Map();
  const recovery = nativeOperationRecovery({principal:member.userID,unitID,epoch:1}, () => ({get length(){return disk.size;},key:i=>[...disk.keys()][i]??null,getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)}), () => true);
  const inspection = nativeOutboundInspection(unitID, member.userID, () => entity && ({
    entity, member: entity.session.getMemberID(), status: entity.state.status, pending: entity.hasWritePending(),
    revision: injector.get(RevisionService).getCurrentRevOfUnit(unitID),
  }), json => recovery.retainOutbound(json));
  t.after(() => { inspection.dispose(); recovery.dispose(); });
  u.registerPlugin(UniverCollaborationClientPlugin, { socketService: MockSocketService, override:[[IAuthzIoService,null],...nativeCursorSessionOverride,...inspection.override], collabWebSocketUrl:'ws://fixture.invalid', enableCollaboration:true, enableAuthServer:false, sendChangesetTimeout:10, changesetAckTimeout:200 });
  const book = u.createUnit(UniverInstanceType.UNIVER_SHEET, {id:unitID, name:'Fixture', rev:1, sheetOrder:[tab], sheets:{[tab]:{id:tab,name:'Sheet 1',rowCount:8,columnCount:8,cellData:{}}}});
  injector.get(UserManagerService).setCurrentUser(member);
  injector.get(IUniverInstanceService).focusUnit(unitID);
  const session = await injector.get(CollaborationSessionService).requireSession(unitID, UniverInstanceType.UNIVER_SHEET);
  await wait(session.sessionStatus$.pipe(filter(s=>s===SessionStatus.ONLINE)), 'ONLINE');
  const controller = injector.get(CollaborationController);
  await controller.readyForCollab(unitID);
  entity = controller.getCollabEntity(unitID) ?? await wait(controller.getCollabEntity$(unitID), 'entity');
  await wait(entity.status$.pipe(filter(s => s === CollaborationStatus.SYNCED)), 'initial SYNCED');
  const observer = nativeCollaborationClient(injector, unitID).subscribe({
    status() { inspection.available(); }, resend() {}, conflict: event => recovery.capture(event),
  });
  t.after(() => observer.dispose());
  assert.equal(recovery.exportJSON(), null);
  if (mode !== 'conflict') {
    for (const copy of [false, true]) await t.test(copy ? 'copy while awaiting' : 'sync without saving', async () => {
    const previous = submissions.length, head = injector.get(RevisionService).getCurrentRevOfUnit(unitID);
    const scalar = copy ? 38 : 37;
    const range = {startRow:1,endRow:1,startColumn:2,endColumn:2};
    injector.get(SheetsSelectionsService).setSelections(unitID, tab, [{range,primary:null,style:null}]);
    const commands = injector.get(ICommandService);
    assert.equal(await commands.executeCommand(SetRangeValuesCommand.id, { unitId:unitID, subUnitId:tab, range,
      value:{v:scalar,t:2,f:null,si:null,p:undefined,s:{cl:{rgb:'#1B1C1F'}}} }), true);
    await wait(entity.status$.pipe(filter(s=>s===CollaborationStatus.AWAITING)), 'AWAITING');
    assert.equal(entity.hasWritePending(),true);
    assert.equal(submissions.length,previous+1);
    const cs=submissions[previous], token=inspection.available();
    assert.equal(head,copy?2:1);
    assert.equal(cs.userID,member.userID);assert.equal(cs.baseRev,head);assert.equal(cs.reqId,copy?2:1);assert.ok(cs.sid);
    assert.equal(cs.mutations[0].params.cellValue[1][2].v,scalar);
    assert.equal(typeof token,'symbol',JSON.stringify(cs));
    assert.equal(disk.size,0);
    if(copy){
      inspection.save(token);inspection.save(token);
      const [record]=JSON.parse(recovery.exportJSON()).records;
      const saved=JSON.parse(record.serialized);
      assert.equal(saved.evidenceType,'outbound-observation');assert.equal(saved.event,JSON.stringify(cs));
    }
    const ackEvent = wait(session.event$.pipe(filter(e => e.eventID === E.CHANGESET_ACK)), 'ACK');
    const synced = wait(entity.status$.pipe(filter(s => s === CollaborationStatus.SYNCED)), 'post-ACK SYNCED');
    acknowledge();
    const [{data:ack}] = await Promise.all([ackEvent, synced]);
    assert.deepEqual([ack.unitID,ack.sid,ack.reqId,ack.baseRev,ack.revision], [unitID,cs.sid,cs.reqId,cs.baseRev,cs.baseRev+1]);
    assert.equal(entity.hasWritePending(),false);
    assert.equal(inspection.available(),undefined);inspection.save(token);
    assert.equal(disk.size,copy?1:0);assert.equal(submissions.length,previous+1);
    assert.equal(http.mock.callCount()+ws.mock.callCount(),0);
    });
    await t.test('large styled scalar submits unchanged without full inspection serialization', async t => {
      const before = new Map(disk), previous = submissions.length;
      const style = { ff: 'W'.repeat(512 * 1024), cl: { rgb: '#1B1C1F' } };
      const inspectorLengths = [], stringify = JSON.stringify;
      t.mock.method(JSON, 'stringify', function (object, ...options) {
        const encoded = stringify(object, ...options);
        if (object?.unitID === unitID && Array.isArray(object.mutations) &&
            new Error().stack?.includes('/src/native-outbound-inspection.ts:')) inspectorLengths.push(encoded.length);
        return encoded;
      });
      const range = {startRow:2,endRow:2,startColumn:2,endColumn:2};
      assert.equal(await injector.get(ICommandService).executeCommand(SetRangeValuesCommand.id, {
        unitId:unitID, subUnitId:tab, range, value:{v:39,t:2,s:style},
      }), true);
      await wait(entity.status$.pipe(filter(s=>s===CollaborationStatus.AWAITING)), 'large scalar AWAITING');
      const cs = submissions[previous], params = cs.mutations[0].params, cell = params.cellValue[2][2];
      assert.equal(cs.mutations.length,1); assert.equal(cell.v,39);
      assert.deepEqual(params.styleRefMap[cell.s],style);
      assert.equal(inspection.available(),undefined); assert.deepEqual(disk,before);
      const synced = wait(entity.status$.pipe(filter(s=>s===CollaborationStatus.SYNCED)), 'large scalar post-ACK SYNCED');
      acknowledge(); await synced;
      assert.equal(submissions.length,previous+1); assert.deepEqual(disk,before);
      assert.equal(http.mock.callCount()+ws.mock.callCount(),0);
      assert.deepEqual(inspectorLengths,[], 'full changeset lengths serialized on the inspector stack');
    });
    return;
  }
  const emitted = wait(entity.conflict$, 'conflict');
  assert.equal(await injector.get(ICommandService).executeCommand(SetRangeValuesMutation.id,{unitId:unitID,subUnitId:tab,cellValue:{0:{0:{v:value,t:1}}}}),true);
  assert.equal(book.getActiveSheet().getCell(0,0).v,value);
  const event = await emitted;
  assert.equal(event.unitID,unitID);
  assert.equal(entity.state.status, CollaborationStatus.CONFLICT);
  assert.equal(event.reason,'changeset_rejected');
  assert.equal(event.message,reason);
  assert.equal(submissions.length,1);
  const cs = event.localChanges.awaitingChangeset;
  assert.deepEqual(cs,submissions[0]);
  assert.equal(cs.mutations.length,1);
  assert.equal(cs.mutations[0].id,SetRangeValuesMutation.id);
  assert.equal(cs.mutations[0].params.cellValue[0][0].v,value);
  const before = sends.length;
  const exported = JSON.parse(recovery.exportJSON());
  assert.equal(exported.inspectionOnly,true);
  assert.equal(exported.records.length,1);
  assert.equal(JSON.parse(exported.records[0].serialized).event,JSON.stringify(event));
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(sends.length,before);
  assert.equal(http.mock.callCount() + ws.mock.callCount(), 0);
  t.diagnostic(`SDK reason=${event.reason}; A1=${value}; submissions=${submissions.length}; additional sends=${sends.length-before}`);
});
