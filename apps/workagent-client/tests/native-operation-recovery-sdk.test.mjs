// Offline integration: real Univer sheet + collaboration client, MOCKED socket only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Subject, of, NEVER, firstValueFrom, filter, timeout } from 'rxjs';
import { Univer, IAuthzIoService, IUndoRedoService, IMentionIOService, Plugin, Inject, Injector, ICommandService, IUniverInstanceService, UniverInstanceType, UserManagerService } from '@univerjs/core';
import { UniverSheetsPlugin, SetRangeValuesMutation } from '@univerjs/sheets';
import { UniverCollaborationPlugin, CollaborationEvent as E } from '@univerjs-pro/collaboration';
import { UniverCollaborationClientPlugin, CollaborationController, CollaborationSessionService, SessionStatus, CollaborationStatus } from '@univerjs-pro/collaboration-client';
import { CombCmd, CmdRspCode } from '@univerjs/protocol';
import { nativeOperationRecovery } from '../src/native-operation-recovery.ts';
import { nativeCollaborationClient } from '../src/native-collaboration-client.ts';

const unitID = 'b05-offline', tab = 'sheet1', value = 'B05 fixture value';
const member = { userID: 'fixture', name: 'Fixture', memberID: 'fixture-member', avatar: '' };
const reason = 'Fixture validator rejected this edit';
const wait = stream => firstValueFrom(stream.pipe(timeout(4000)));

test('SDK conflict$ captures an ordinary rejected edit; recovery exports without send (mocked transport)', { timeout: 10_000 }, async t => {
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
  u.registerPlugin(UniverCollaborationClientPlugin, { socketService: MockSocketService, override:[[IAuthzIoService,null]], collabWebSocketUrl:'ws://fixture.invalid', enableCollaboration:true, enableAuthServer:false, sendChangesetTimeout:10, changesetAckTimeout:200 });
  const book = u.createUnit(UniverInstanceType.UNIVER_SHEET, {id:unitID, name:'Fixture', rev:1, sheetOrder:[tab], sheets:{[tab]:{id:tab,name:'Sheet 1',rowCount:8,columnCount:8,cellData:{}}}});
  injector.get(UserManagerService).setCurrentUser(member);
  injector.get(IUniverInstanceService).focusUnit(unitID);
  const session = await injector.get(CollaborationSessionService).requireSession(unitID, UniverInstanceType.UNIVER_SHEET);
  await wait(session.sessionStatus$.pipe(filter(s=>s===SessionStatus.ONLINE)));
  const controller = injector.get(CollaborationController);
  await controller.readyForCollab(unitID);
  const entity = controller.getCollabEntity(unitID) ?? await wait(controller.getCollabEntity$(unitID));
  await wait(entity.status$.pipe(filter(s => s === CollaborationStatus.SYNCED)));
  const disk = new Map();
  const recovery = nativeOperationRecovery({principal:member.userID,unitID,epoch:1}, () => ({get length(){return disk.size;},key:i=>[...disk.keys()][i]??null,getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v)}), () => true);
  t.after(() => recovery.dispose());
  const observer = nativeCollaborationClient(injector, unitID).subscribe({
    status() {}, resend() {}, conflict: event => recovery.capture(event),
  });
  t.after(() => observer.dispose());
  assert.equal(recovery.exportJSON(), null);
  const emitted = wait(entity.conflict$);
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
