// Pinned SDK cursor/debounce, session close and DI; transport boundaries are inert.
// No network, native server, database or browser evidence is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Subject } from 'rxjs';
import { Injector, ILogService, IConfigService, mergeOverrideWithDependencies, registerDependencies } from '@univerjs/core';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { CollaborationSession, CollaborationSessionService, CollaborationUIEventService, ICollaborationSocketService, ICollaborationClientAdapterService, SessionStatus } from '@univerjs-pro/collaboration-client';
import { UniverCollaborationClientUIPlugin } from '@univerjs-pro/collaboration-client-ui';
import { cursorSessionService, nativeCursorSessionOverride } from '../src/native-cursor-session.ts';

function session() {
  const status = new Subject(), events = new Subject(), calls = [], failures = [];
  const native = { sessionStatus: SessionStatus.ONLINE, sessionStatus$: status.asObservable(), event$: events.asObservable(),
    getMemberID() { assert.equal(this, native); return 'synthetic-member'; },
    send(...args) {
      assert.equal(this, native); calls.push(args);
      const promise = native.sessionStatus === SessionStatus.ONLINE ? Promise.resolve()
        : CollaborationSession.prototype.send.apply({ sessionStatus: native.sessionStatus, _socket: null }, args);
      // Test observation only. Production never catches or replaces send rejections.
      promise.catch(error => failures.push(error));
      return promise;
    },
    close() { assert.equal(this, native); status.complete(); events.complete(); },
    dispose() { assert.equal(this, native); native.close(); },
  };
  return { native, calls, failures, status, events };
}
function service(initial) {
  const sessions = new Map(initial), requested = []; let disposed = 0, reconnects = 0;
  const native = { requireSession(unit, type) { assert.equal(this, native); requested.push([unit, type]); return Promise.resolve(sessions.get(unit)); },
    closeSession(unit) { assert.equal(this, native); sessions.get(unit)?.close(); sessions.delete(unit); },
    reconnect() { assert.equal(this, native); reconnects++; },
    dispose() { assert.equal(this, native); disposed++; for (const s of sessions.values()) s.dispose(); sessions.clear(); },
  };
  return { native, sessions, requested, get disposed() { return disposed; }, get reconnects() { return reconnects; } };
}
// The SDK does not export SheetCollabCursorEntity. Capture its constructor from
// native registration using an inert injector; never instantiate a session.
async function cursorConstructor() {
  const registrations = [];
  UniverCollaborationClientUIPlugin.prototype._registerDependencies.call({ _config: {}, _injector: { add: d => registrations.push(d) } });
  const controller = registrations.map(d => d[0]).find(C => C?.prototype?._startSheetCollabCursor);
  let Cursor;
  await controller.prototype._startSheetCollabCursor.call({ _collabSessionService: { requireSession: async () => null },
    _injector: { createInstance(C) { Cursor = C; return { init() {} }; } } }, 'synthetic');
  return Cursor;
}
const Cursor = await cursorConstructor();
const cursorEvent = { eventID: CollaborationEvent.UPDATE_CURSOR, data: { unitID: 'A', memberID: 'synthetic-member', selection: '{}' } };
for (const transition of ['offline', 'close', 'dispose']) test(`SDK delayed cursor after ${transition} is discarded; fresh online presence still sends`, async () => {
  const a = session(), store = service([['A', a.native]]), adapter = cursorSessionService(store.native);
  const facade = await adapter.requireSession('A', 2);
  const cursor = new Cursor('A', facade, null, null, null, null, null, null);
  try {
    cursor._online = true;
    cursor._updateLocalCursor('sheet1', { range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } });
    if (transition === 'offline') a.native.sessionStatus = SessionStatus.OFFLINE;
    else if (transition === 'close') adapter.closeSession('A');
    else adapter.dispose();
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(a.calls.length, 0, 'expired cursor must never reach native send');
    assert.equal(a.failures.length, 0);
    if (transition === 'offline') {
      a.native.sessionStatus = SessionStatus.ONLINE;
      cursor._updateLocalCursor('sheet1', { range: { startRow: 1, endRow: 1, startColumn: 0, endColumn: 0 } });
      await new Promise(resolve => setTimeout(resolve, 150));
      assert.equal(a.calls.length, 1); assert.equal(a.calls[0][0].eventID, CollaborationEvent.UPDATE_CURSOR);
    }
  } finally { cursor.dispose(); if (transition !== 'dispose') adapter.dispose(); }
});

test('native session identity, public streams, close/regrant and method receivers remain native', async () => {
  const a = session(), b = session(), store = service([['A', a.native], ['B', b.native]]), adapter = cursorSessionService(store.native);
  const [first, second, other] = await Promise.all([adapter.requireSession('A', 2), adapter.requireSession('A', 2), adapter.requireSession('B', 2)]);
  assert.equal(first, second); assert.notEqual(first, other);
  assert.equal(first.sessionStatus$, a.native.sessionStatus$); assert.equal(first.event$, a.native.event$);
  assert.equal(first.getMemberID(), 'synthetic-member'); adapter.reconnect(); assert.equal(store.reconnects, 1);
  adapter.closeSession('A');
  const fresh = session(); store.sessions.set('A', fresh.native);
  const regrant = await adapter.requireSession('A', 2); assert.notEqual(regrant, first);
  await first.send(cursorEvent, 'A'); assert.equal(a.calls.length, 0, 'closed facade cannot revive even if old status was ONLINE');
  await regrant.send(cursorEvent, 'A'); assert.equal(fresh.calls.length, 1);
  await other.send(cursorEvent, 'B'); assert.equal(b.calls.length, 1);
  adapter.dispose(); assert.equal(store.disposed, 1);
});

test('actual SDK session close completes its public status stream; no transport is constructed', async () => {
  const sockets = new Subject(); // Never emits a socket or joins any room.
  const raw = new CollaborationSession({ localUnitId: 'A', target: { unitId: 'A', unitType: 2 } }, sockets, {}, {}, {}, {});
  const adapter = cursorSessionService(service([['A', raw]]).native);
  const facade = await adapter.requireSession('A'); let completed = false;
  facade.sessionStatus$.subscribe({ complete: () => { completed = true; } });
  assert.equal(facade instanceof CollaborationSession, true);
  raw.close(); assert.equal(completed, true);
  await facade.send(cursorEvent, 'A');
  adapter.dispose(); sockets.complete();
});

test('a requireSession resolving after service disposal cannot send an expired cursor', async () => {
  const a = session(), store = service([]); let resolve;
  store.native.requireSession = () => new Promise(r => { resolve = r; });
  const adapter = cursorSessionService(store.native), pending = adapter.requireSession('A');
  adapter.dispose(); resolve(a.native);
  const facade = await pending; await facade.send(cursorEvent, 'A'); assert.equal(a.calls.length, 0);
  a.native.dispose();
});

test('online cursors and critical messages preserve original arguments, errors and exact promises', async () => {
  const a = session(), adapter = cursorSessionService(service([['A', a.native]]).native), facade = await adapter.requireSession('A');
  const failure = new Error('synthetic critical rejection'), promise = Promise.reject(failure); promise.catch(() => {});
  const calls = [];
  a.native.send = function (...args) { assert.equal(this, a.native); calls.push(args); return promise; };
  const options = { timeout: 123 }, critical = { eventID: CollaborationEvent.FETCH_MISSING, data: { unitID: 'A', from: 1, to: 2 } };
  const operation = { eventID: CollaborationEvent.SUBMIT_CHANGESET, data: { unitID: 'A', changeset: { sid: 'native-sdk-sid', reqId: 7 } } };
  for (const event of [critical, operation]) for (const status of [SessionStatus.ONLINE, SessionStatus.OFFLINE]) {
    a.native.sessionStatus = status;
    const result = facade.send(event, 'A', options); assert.equal(result, promise); await assert.rejects(result, error => error === failure);
    assert.deepEqual(calls.at(-1), [event, 'A', options]); assert.equal(calls.at(-1)[0], event);
  }
  a.native.sessionStatus = SessionStatus.ONLINE;
  assert.equal(facade.send(cursorEvent, 'A', options), promise, 'online cursor failure is not swallowed');
  a.native.send = () => { throw failure; }; assert.throws(() => facade.send(critical, 'A'), error => error === failure);
  adapter.dispose(); assert.throws(() => facade.send(critical, 'A'), error => error === failure, 'critical send remains native even after disposal');
});

test('SDK public override and real Injector construct one native service with native constructor dependencies', () => {
  const injector = new Injector([
    [ILogService, { useValue: {} }], [IConfigService, { useValue: { getConfig() {} } }],
    [ICollaborationSocketService, { useValue: { createSocket() { assert.fail('no socket allowed'); } } }],
    [CollaborationUIEventService, { useValue: {} }],
    [ICollaborationClientAdapterService, { useValue: { resolveUnit() { assert.fail('no session allowed'); } } }],
  ]);
  registerDependencies(injector, mergeOverrideWithDependencies([[CollaborationSessionService]], nativeCursorSessionOverride));
  try {
    const first = injector.get(CollaborationSessionService);
    assert.ok(first instanceof CollaborationSessionService); assert.equal(first, injector.get(CollaborationSessionService));
    assert.equal(typeof first.requireSession, 'function'); assert.equal(typeof first.socket$.subscribe, 'function');
  } finally { injector.dispose(); }
});
