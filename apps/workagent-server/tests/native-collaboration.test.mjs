// Conceptual concurrency tests: real Workspace/identity and adapter policy;
// serialized copy-on-write state and captured SDK hooks, no SDK DB or service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace.mjs';
import { blankWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { initialState } from '../src/store.mjs';
import { identity } from '../src/http.mjs';
import { NativeAuthority, NATIVE_UNIT, NATIVE_TAB, guardedEndpoint, validateNativeOrigin, fencedNativeSend } from '../src/native-collaboration.mjs';
const token = 'synthetic-owner-credential-at-least-32-characters';
const accounts = [{ id: 'peer', name: 'Peer', token: 'synthetic-peer-credential-at-least-32-characters' }];
export function fixture() {
  let state = initialState('owner'), tail = Promise.resolve();
  state.nativeQualification = { storage: { pairID: 'synthetic-pair' } };
  state.works[NATIVE_UNIT] = { nativeIdentity: { version: 1, workspace: 'owner', unitID: NATIVE_UNIT, pairID: 'synthetic-pair', owners: {} }, id: NATIVE_UNIT, kind: 'native-sheet', nativeCollaboration: true, accessRevision: 1, acl: { peer: 'editor' }, proposals: [{ id: 'pending', status: 'pending' }] };
  const store = { read: async fn => structuredClone(await fn(structuredClone(state))), transaction(fn) {
    const operation = tail.then(async () => { const copy = structuredClone(state); const result = await fn(copy); state = copy; return structuredClone(result); }); tail = operation.catch(() => {}); return operation;
  } };
  const workspace = new Workspace(store, { peers: accounts }), authority = new NativeAuthority(workspace);
  return { workspace, authority, store };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const share = (w, role, accessRevision = 1) => w.share('owner', NATIVE_UNIT, { commandId: `share-${accessRevision}`, peer: 'peer', role, accessRevision });
export const changeset = (reqId = 1) => ({ unitID: NATIVE_UNIT, type: 2, baseRev: 1, revision: 2, userID: 'forged-owner', memberID: 'member', sid: 'synthetic-edit-session', reqId, mutations: [{ id: 'sheet.mutation.set-range-values', data: JSON.stringify({ unitId: NATIVE_UNIT, subUnitId: NATIVE_TAB, cellValue: { 0: { 0: { v: 10 } } } }) }] });
function hooks(f) {
  const middleware = {}, endpointHooks = {};
  f.authority.install({ use: (k, v) => middleware[k] = v }, { use: (k, v) => endpointHooks[k] = v, on() {} });
  f.authority.sessions.set('member', { userID: 'peer', revision: 1 });
  const c = changeset(); return { middleware, context: { userID: 'peer', memberID: 'member', request: { changeset: c }, changeset: c, requiredUnitPermissions: [] } };
}
test('admitted edit is fenced after downgrade; regrant cannot revive old session', async () => {
  const f = fixture(), { middleware: m, context: c } = hooks(f);
  let admitted = false, committed = false;
  await m.submitChangeset(c, async () => { admitted = true; });
  await share(f.workspace, 'read');
  await assert.rejects(m.commitChangeset(c, async () => { committed = true; }), /denied/);
  await share(f.workspace, 'editor', 2);
  await assert.rejects(m.commitChangeset(c, async () => { committed = true; }), /denied/);
  assert.equal(admitted, true); assert.equal(committed, false);
});
test('ACL transition waits for actual in-progress commit; next commit and delivery refused', async () => {
  const f = fixture(), { middleware: m, context: c } = hooks(f), entered = deferred(), release = deferred();
  const order = [];
  await m.submitChangeset(c, async () => {});
  const committing = m.commitChangeset(c, async () => { entered.resolve(); await release.promise; order.push('native-commit'); });
  await entered.promise;
  const revoking = share(f.workspace, null).then(() => order.push('revoke'));
  await Promise.resolve(); assert.deepEqual(order, []); release.resolve();
  await Promise.all([committing, revoking]); assert.deepEqual(order, ['native-commit', 'revoke']);
  await assert.rejects(f.authority.fence('peer', NATIVE_UNIT, false, () => assert.fail('delivery')));
  await assert.rejects(m.commitChangeset(c, () => assert.fail('commit')));
  assert.deepEqual((await f.store.read(s => s.works[NATIVE_UNIT].proposals)), [{ id: 'pending', status: 'pending' }]);
});
test('foreign units, tabs, lifecycle, unqualified mutation and forged members rejected', async () => {
  const f = fixture(), { middleware: m, context: c } = hooks(f);
  for (const k of ['createUnit', 'deleteUnits', 'recoverUnits']) await assert.rejects(m[k]({}, () => assert.fail()));
  await assert.rejects(m.readUnitData({ userID: 'peer', request: { unitID: 'foreign', type: 2 } }, () => assert.fail()));
  for (const changed of [ { ...c, memberID: 'forged' }, { ...c, userID: 'owner' } ]) await assert.rejects(m.submitChangeset(changed, () => assert.fail()));
  for (const edit of [x => x.unitID = 'foreign', x => x.mutations[0].data = JSON.stringify({ unitId: NATIVE_UNIT, subUnitId: 'foreign' }), x => x.mutations[0].id = 'sheet.mutation.insert-sheet', x => delete x.sid]) { const x = changeset(); edit(x); assert.throws(() => f.authority.validateChangeset(x)); }
});
test('native unit excluded from legacy snapshots/mutations; normal sheets unchanged', async () => {
  const f = fixture(); assert.deepEqual(await f.workspace.list('owner'), []);
  await assert.rejects(f.workspace.get('owner', NATIVE_UNIT), /native_collaboration_required/);
  await assert.rejects(f.workspace.save('peer', NATIVE_UNIT, { commandId: 'save', book: blankWorkbook(NATIVE_UNIT), contentRevision: 1, permissionRevision: 1 }), /native_collaboration_required/);
  assert.deepEqual((await f.workspace.events('owner')).snapshots, []);
  const normal = await f.workspace.createBlank('owner', { commandId: 'blank', title: 'Normal' });
  assert.ok((await f.workspace.get('owner', normal.workId)).book);
});
test('public transport wrapper refuses queued HTTP/WS delivery after revocation', async () => {
  const f = fixture(), origin = 'https://synthetic.example.test', auth = identity({ owner: 'owner', token, accounts, origin });
  const routes = {}, handlers = {};
  let releaseHttp = deferred(), httpRead = deferred();
  const endpoint = { register(router) {
    router.get('/read', async c => { httpRead.resolve(); await releaseHttp.promise; c.response.end('secret'); });
    router.upgrade('/ws', c => c.accept({ open: x => { handlers.connection = x.connection; }, message() {} }));
  } };
  const router = { get: (p, h) => routes[p] = h, post() {}, delete() {}, upgrade: (p, h) => routes[p] = h };
  guardedEndpoint(endpoint, f.authority, auth, origin).register(router);
  const headers = { origin, cookie: `workagent_session=${auth.login(accounts[0].token)}` };
  let outgoing = [], closed = false;
  await routes['/ws']({ incomingMessage: { headers, method: 'GET' }, accept(h) { handlers.open = h.open; } });
  await handlers.open({ connection: { id: 'c', customData: {}, send: data => outgoing.push(data), close: () => closed = true } });
  const pending = routes['/read']({ userID: 'peer', response: { end: x => outgoing.push(x), setHeader() {} } });
  await httpRead.promise; await share(f.workspace, null); releaseHttp.resolve();
  await assert.rejects(pending); await handlers.connection.send('secret');
  assert.deepEqual(outgoing, []); assert.equal(closed, true);
});
test('origin and real credentials required; browser identity claims unused', () => {
  const origin = 'https://synthetic.example.test', auth = identity({ owner: 'owner', token, accounts, origin });
  for (const req of [{ method: 'POST', headers: {} }, { method: 'GET', headers: { origin: 'https://evil.test' } }, { method: 'GET', headers: { 'sec-fetch-site': 'cross-site' } }]) assert.throws(() => validateNativeOrigin(req, origin));
  assert.throws(() => validateNativeOrigin({ method: 'GET', headers: {} }, origin, true));
  assert.equal(auth.authenticate({ headers: { authorization: `Bearer ${accounts[0].token}`, userID: 'owner' } }), 'peer');
});

test('SID is claimed before dedup; forged payload identity cannot claim another principal SID', async () => {
  const f = fixture(), { middleware: m, context: peer } = hooks(f);
  f.authority.sessions.set('owner-member', { userID: 'owner', revision: 1 });
  const own = { ...peer, userID: 'owner', memberID: 'owner-member' };
  await assert.rejects(m.submitChangeset({ ...peer, memberID: 'owner-member' }, async () => assert.fail('foreign member')));
  const original = structuredClone(own.request.changeset);
  await m.submitChangeset(own, async () => {});
  let entered = false;
  peer.request.changeset.userID = 'owner'; peer.request.changeset.memberID = 'owner-member'; peer.request.changeset.reqId = 2;
  await assert.rejects(m.submitChangeset(peer, async () => { entered = true; }));
  assert.equal(entered, false);
  // Same owner retries the exact sid/reqId, even with a new transport member.
  f.authority.sessions.set('reconnect', { userID: 'owner', revision: 1 });
  await m.submitChangeset({ ...own, memberID: 'reconnect' }, async () => { entered = true; });
  assert.equal(entered, true); assert.equal(own.request.changeset.sid, original.sid);
  await assert.rejects(m.submitChangeset({ ...peer, userID: 'owner' }, async () => assert.fail('forged trusted principal')));
});
test('concurrent SID claim has one owner and survives Workspace/service restart, revocation and regrant', async () => {
  const f = fixture(), { middleware: m, context: peer } = hooks(f);
  f.authority.sessions.set('owner-member', { userID: 'owner', revision: 1 });
  const own = { ...peer, userID: 'owner', memberID: 'owner-member' };
  const claims = await Promise.allSettled([m.submitChangeset(own, async () => {}), m.submitChangeset(peer, async () => {})]);
  assert.deepEqual(claims.map(x => x.status), ['fulfilled', 'rejected']);
  await share(f.workspace, null); await share(f.workspace, 'editor', 2);
  const restarted = { workspace: new Workspace(f.store, { peers: accounts }), store: f.store };
  restarted.authority = new NativeAuthority(restarted.workspace);
  const { middleware: next, context: c } = hooks(restarted);
  restarted.authority.sessions.set('member', { userID: 'peer', revision: 3 });
  await assert.rejects(next.submitChangeset(c, async () => assert.fail('steal old SID')));
  restarted.authority.sessions.set('new-member', { userID: 'owner', revision: 3 });
  await next.submitChangeset({ ...c, userID: 'owner', memberID: 'new-member' }, async () => {});
});
test('ambiguous legacy SID ownership and unbounded SID input fail closed', async () => {
  const f = fixture(), { middleware: m, context: c } = hooks(f);
  for (const sid of [{}, 123, '', 'a'.repeat(129), 'space sid', '__proto__\n']) {
    const edit = changeset(); edit.sid = sid; assert.throws(() => f.authority.validateChangeset(edit));
  }
  await f.store.transaction(s => { delete s.works[NATIVE_UNIT].nativeIdentity; });
  await assert.rejects(m.submitChangeset(c, async () => assert.fail('legacy claim')));
  assert.equal((await f.store.read(s => s.works[NATIVE_UNIT])).nativeIdentity, undefined);
});
test('SID registry saturation preserves existing retry ownership and refuses new claims', async () => {
  const f = fixture(), { middleware: m, context: c } = hooks(f);
  await m.submitChangeset(c, async () => {});
  await f.store.transaction(s => { const owners = s.works[NATIVE_UNIT].nativeIdentity.owners; for (let i = 0; i < 4095; i++) owners[`retained-${i}`] = 'owner'; });
  await m.submitChangeset(c, async () => {});
  const next = structuredClone(c); next.request.changeset.sid = 'new-session';
  await assert.rejects(m.submitChangeset(next, async () => assert.fail('overflow')));
});
test('stalled native send releases ACL lock; later revocation and commits proceed without flush', async () => {
  const f = fixture(), flush = deferred(), enqueued = deferred(); let queued = 0;
  const original = { send() { queued++; enqueued.resolve(); return flush.promise; }, close() {} };
  const sending = fencedNativeSend({ authority: f.authority, principal: 'peer', original, data: 'old', authenticate() {}, timeoutMs: 1000 });
  await enqueued.promise;
  await share(f.workspace, null);
  let committed = false; await f.authority.fence('owner', NATIVE_UNIT, true, () => { committed = true; });
  assert.equal(committed, true);
  await fencedNativeSend({ authority: f.authority, principal: 'peer', original, data: 'new', authenticate() {} });
  assert.equal(queued, 1); flush.resolve(); await sending;
});
test('native send failure, timeout and authentication failure close without hanging the row lock', async () => {
  for (const send of [() => { throw Error('sync'); }, () => Promise.reject(Error('async')), () => new Promise(() => {})]) {
    const f = fixture(); let closed = 0;
    await fencedNativeSend({ authority: f.authority, principal: 'peer', original: { send, close() { closed++; } }, authenticate() {}, timeoutMs: 10 });
    assert.equal(closed, 1); await share(f.workspace, null);
  }
  const f = fixture(); let queued = false;
  await fencedNativeSend({ authority: f.authority, principal: 'peer', original: { send() { queued = true; }, close() {} }, authenticate() { throw Error('expired'); } });
  assert.equal(queued, false);
});
