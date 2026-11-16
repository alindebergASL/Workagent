// Pure Workspace/HTTP-handler integration with constructor/content fakes. No DB,
// listeners, SDK service or browser; Parent qualifies the actual adapters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { NativeAuthority, createNativeWork, NATIVE_TAB } from '../src/native-collaboration.mjs';
import { createHandler, identity } from '../src/http.mjs';
import { nativeRoute, nativeSession } from '../src/native-workspace.mjs';
import { blankWorkbook } from '../../../packages/workagent-contract/index.mjs';
const owner = 'owner', token = 'synthetic-owner-credential-at-least-32-characters', origin = 'http://localhost:8310';
const accounts = [{ id: 'peer', name: 'Peer', token: 'synthetic-peer-credential-at-least-32-characters' }];
function fixture(enabled = true) {
  let state = initialState(owner), tail = Promise.resolve();
  state.nativeQualification = { storage: { purpose: 'workagent-native-workspace', pairID: 'pair' }, phase: 'ready' };
  const store = { read: async fn => structuredClone(await fn(structuredClone(state))), transaction(fn) { const result = tail.then(async () => { const copy = structuredClone(state); const r = await fn(copy); state = copy; return structuredClone(r); }); tail = result.catch(() => {}); return result; } };
  const workspace = new Workspace(store, { peers: accounts, nativeEnabled: enabled }), authority = new NativeAuthority(workspace, null), units = new Map();
  const dbAdapter = { getUnit: async (_c, unit) => units.get(unit) };
  const service = { createUnitFromData: async ({ data }) => { assert.ok(authority.scope.getStore()?.creating); units.set(data.id, structuredClone(data)); } };
  const native = { authority, endpoint: { invalidateUnitSessions: async () => {} }, createWork: input => createNativeWork({ workspace, authority, dbAdapter, service, owner, input }) };
  return { workspace, authority, units, native, store, service };
}
const create = (f, commandId = 'one') => f.native.createWork({ commandId, title: commandId });
test('explicit creation is idempotent and produces isolated units without snapshots/jobs; off refuses', async () => {
  const f = fixture(), [a, retry] = await Promise.all([create(f), create(f)]), b = await create(f, 'two');
  assert.deepEqual(a, retry); assert.notEqual(a.workId, b.workId); assert.equal(f.units.size, 2);
  assert.equal(f.units.get(a.workId).id, a.workId);
  assert.equal((await f.workspace.get(owner, a.workId, true)).book, undefined);
  assert.deepEqual((await f.workspace.events(owner)).snapshots, []);
  assert.deepEqual(await f.store.read(s => s.jobs), {});
  await assert.rejects(f.native.createWork({ commandId: 'one', title: 'changed' }), /command_conflict/);
  await assert.rejects(create(fixture(false)), /disabled/);
  await assert.rejects(f.workspace.get(owner, a.workId), /native_collaboration_required/);
  await assert.rejects(f.workspace.get('peer', a.workId, true), /access_denied/);
  await f.workspace.share(owner, a.workId, { commandId: 'share', peer: 'peer', role: 'editor', accessRevision: 1 });
  assert.deepEqual((await f.workspace.list('peer')).map(w => w.id), [a.workId]);
  await assert.rejects(f.authority.checkNow('peer', b.workId));
  await assert.rejects(f.workspace.save(owner, a.workId, { commandId: 'save', book: blankWorkbook(a.workId), contentRevision: 1, permissionRevision: 1 }), /native_collaboration_required/);
  await assert.rejects(f.workspace.command(owner, { commandId: 'agent', kind: 'continue', workId: a.workId, text: 'edit', sourceIds: [] }), /native_collaboration_required/);
  const legacy = await f.workspace.createBlank(owner, { commandId: 'legacy', title: 'Legacy' });
  assert.ok((await f.workspace.get(owner, legacy.workId)).book);
});
test('partial native creation retains reserved identity; explicit retry completes without reseeding existing native data', async () => {
  const f = fixture(), original = f.service.createUnitFromData;
  f.service.createUnitFromData = async input => { await original(input); throw Error('lost acknowledgement'); };
  await assert.rejects(create(f)); assert.equal(f.units.size, 1);
  const unit = [...f.units.keys()][0]; f.units.get(unit).rev = 42;
  f.service.createUnitFromData = () => assert.fail('reseed');
  const result = await create(f); assert.equal(result.workId, unit); assert.equal(f.units.get(unit).rev, 42);
  f.units.delete(unit); await assert.rejects(create(f), /retained_unit_missing/);
});
test('submission scope, member, epoch and SID ownership fence cross-work and regrant', async () => {
  const f = fixture(), a = (await create(f)).workId, b = (await create(f, 'two')).workId, hooks = {}, endpoint = {};
  f.authority.install({ use: (k,v) => hooks[k] = v }, { use: (k,v) => endpoint[k] = v, on() {} });
  const changeset = unitID => ({ unitID, type: 2, sid: 'same-sdk-sid', reqId: 1, mutations: [{ id: 'sheet.mutation.set-range-values', data: JSON.stringify({ unitId: unitID, subUnitId: NATIVE_TAB, cellValue: {} }) }] });
  const context = unitID => ({ userID: owner, memberID: 'm', request: { changeset: changeset(unitID) } });
  f.authority.sessions.set('m', { userID: owner, unitID: a, revision: 1 });
  const submit = c => f.authority.scope.run({ unitID: a }, () => hooks.submitChangeset(c, async () => {}));
  await submit(context(a)); await submit(context(a));
  await assert.rejects(submit(context(b))); await assert.rejects(submit({ ...context(a), userID: 'peer' }));
  await assert.rejects(endpoint.joinUnit({ session: { userID: owner, memberID: 'm' }, unitID: b }, () => assert.fail()));
  await f.workspace.share(owner, a, { commandId: 'share', peer: 'peer', role: 'editor', accessRevision: 1 });
  await assert.rejects(submit(context(a))); // stale connection
  f.authority.sessions.set('m', { userID: owner, unitID: a, revision: 2 });
  await assert.rejects(submit(context(a))); // old SID cannot replay across access epoch
  const fresh = context(a); fresh.request.changeset.sid = 'fresh-sdk-sid'; await submit(fresh);
  const restarted = new NativeAuthority(new Workspace(f.store, { peers: accounts, nativeEnabled: true }), null);
  await f.store.transaction(s => restarted.bindSubmission(s, fresh));
  await assert.rejects(f.store.transaction(s => restarted.bindSubmission(s, { ...fresh, userID: 'peer' }, true)));
});
test('normal handler authenticates create and session; epoch routes refuse foreign work and old read sessions', async () => {
  const f = fixture(), auth = identity({ owner, token, origin, accounts });
  const handler = createHandler({ workspace: f.workspace, native: f.native, owner, token, origin, accounts, clientRoot: '/unused' });
  async function request(path, principalToken, input) {
    const req = Readable.from(input ? [Buffer.from(JSON.stringify(input))] : []); Object.assign(req, { url: path, method: input ? 'POST' : 'GET', headers: { authorization: `Bearer ${principalToken}`, origin, 'content-type': 'application/json' } });
    let result; const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(data) { result = JSON.parse(data); this.writableEnded = true; } };
    await handler(req, res); return { status: res.status, result };
  }
  assert.equal((await request('/api/work/native', accounts[0].token, { commandId: 'peer', title: 'No' })).status, 403);
  const made = await request('/api/work/native', token, { commandId: 'one', title: 'Together' }); assert.equal(made.status, 200);
  const unit = made.result.workId;
  const opened = await request(`/api/work/${unit}/native-session`, token); assert.equal(opened.status, 200);
  assert.equal(opened.result.unitID, unit); assert.equal(opened.result.token, undefined);
  const req = { url: `${opened.result.basePath}/snapshot/test`, method: 'GET', headers: { origin, authorization: `Bearer ${token}` } };
  assert.equal(nativeRoute(req, origin, auth), unit); assert.equal(req.url, '/universer-api/snapshot/test');
  await f.workspace.share(owner, unit, { commandId: 'share', peer: 'peer', role: 'read', accessRevision: 1 });
  await assert.rejects(f.authority.checkNow(owner, unit, false, req.nativeAccess));
  await assert.rejects(nativeSession(f.native, auth, 'peer', 'foreign', () => assert.fail()));
  const off = createHandler({ workspace: f.workspace, owner, token, origin, accounts, clientRoot: '/unused' });
  const requestOff = Readable.from([Buffer.from('{}')]); Object.assign(requestOff, { url: '/api/work/native', method: 'POST', headers: { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  let status; await off(requestOff, { setHeader() {}, writeHead(s) { status = s; }, end() {} }); assert.equal(status, 409);
});
test('native agent capability is default-off and owner-only even for an editing peer',async()=>{
 const f=fixture(),auth=identity({owner,token,origin,accounts}),{workId}=await create(f);let value;
 await nativeSession(f.native,auth,owner,workId,(_s,v)=>value=v);assert.equal(value.agent,false);
 f.authority.agent={enabled:true};await nativeSession(f.native,auth,owner,workId,(_s,v)=>value=v);assert.equal(value.agent,true);
 await f.workspace.share(owner,workId,{commandId:'peer-agent',peer:'peer',role:'editor',accessRevision:1});await nativeSession(f.native,auth,'peer',workId,(_s,v)=>value=v);assert.equal(value.agent,false);
});

test('native acceptance capability is default-off and current-owner only',async()=>{
 const f=fixture();const {workId}=await create(f,'acceptance-capability');const auth={profile:()=>({owner:true})};let value;
 await nativeSession(f.native,auth,owner,workId,(_s,v)=>value=v);assert.equal(value.acceptance,false);
 f.authority.acceptance={enabled:true};await nativeSession(f.native,auth,owner,workId,(_s,v)=>value=v);assert.equal(value.acceptance,true);
 await f.workspace.share(owner,workId,{commandId:'acceptance-share',peer:'peer',role:'editor',accessRevision:1});await nativeSession(f.native,auth,'peer',workId,(_s,v)=>value=v);assert.equal(value.acceptance,false);
});
