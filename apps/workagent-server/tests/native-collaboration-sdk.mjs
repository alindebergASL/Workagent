// PARENT ONLY. Actual SDK + fresh SQLite; no service binding or provider calls.
// Workspace store here is a serialization fake. PG/HTTP/browser proof is separate.
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { SQLiteDatabaseAdapter } from '@univerjs-pro/collaboration-database-sqlite';
import { UniverType } from '@univerjs/protocol';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { NATIVE_UNIT, NATIVE_TAB } from '../src/native-collaboration.mjs';
import { nativeQualificationConfig, provisionNativeStorage, openNativeStorage } from '../src/native-qualification-storage.mjs';
if (process.env.WORKAGENT_NATIVE_SDK_CHECK !== 'fresh-synthetic-only') throw new Error('parent_opt_in_required');
const filename = process.env.WORKAGENT_NATIVE_SDK_SQLITE;
if (!filename?.startsWith('/')) throw new Error('absolute_fresh_sqlite_path_required');
// Root must be NEW. Existing Parent evidence is never adopted or modified.
const owner = 'owner', accounts = [{ id: 'peer', name: 'Peer', token: 'synthetic-peer-credential-at-least-32-characters' }];
let state = initialState(owner), tail = Promise.resolve();
const store = { read: async fn => structuredClone(await fn(structuredClone(state))), transaction(fn) { const task = tail.then(async () => { const copy = structuredClone(state); const result = await fn(copy); state = copy; return result; }); tail = task.catch(() => {}); return task; } };
let workspace = new Workspace(store, { peers: accounts });
const config = nativeQualificationConfig({ WORKAGENT_NATIVE_QUALIFICATION: 'synthetic-only', WORKAGENT_OWNER_ID: owner,
  WORKAGENT_AUTH_TOKEN: 'synthetic-owner-credential-at-least-32-characters', WORKAGENT_ORIGIN: 'http://127.0.0.1:8311',
  WORKAGENT_DATABASE_URL: 'postgresql://synthetic-unused/workagent_native_sdk', WORKAGENT_NATIVE_DATABASE_NAME: 'workagent_native_sdk',
  WORKAGENT_NATIVE_ROOT: dirname(filename), WORKAGENT_NATIVE_SQLITE: filename, WORKAGENT_SYNTHETIC_ACCOUNTS_JSON: JSON.stringify(accounts) });
const databaseID = 'sdk-check-fake-workspace-store';
await provisionNativeStorage({ config, workspace, databaseID });
const start = () => openNativeStorage({ config, workspace, databaseID, makeAdapter: options => new SQLiteDatabaseAdapter(options) });
let native = await start();
const context = userID => ({ userID, memberID: `member-${userID}` });
const register = () => { for (const userID of ['owner', 'peer']) native.authority.sessions.set(context(userID).memberID, { userID, revision: state.works[NATIVE_UNIT].accessRevision }); };
const load = () => native.service.getUnitLoadDataWithBlocks({ unitID: NATIVE_UNIT, type: UniverType.UNIVER_SHEET, revision: 0 }, { userID: owner });
const edit = (userID, baseRev, reqId, row, value) => ({ unitID: NATIVE_UNIT, type: UniverType.UNIVER_SHEET, baseRev, revision: baseRev + 1, userID: 'untrusted-claim', memberID: context(userID).memberID, sid: `session-${userID}`, reqId, mutations: [{ id: 'sheet.mutation.set-range-values', data: JSON.stringify({ unitId: NATIVE_UNIT, subUnitId: NATIVE_TAB, cellValue: { [row]: { 0: { v: value } } } }) }] });
try {
  register(); const first = await load(), base = first.targetRevision;
  const a = edit('owner', base, 1, 0, 10), b = edit('peer', base, 1, 1, 20);
  const results = await Promise.all([native.service.submitChangeset({ changeset: a }, context('owner')), native.service.submitChangeset({ changeset: b }, context('peer'))]);
  assert.ok(results.every(x => x.status === 'committed'), JSON.stringify(results));
  let after = await load(); assert.equal(after.targetRevision, base + 2);
  // Review regression: owner (S,1), peer (S,2), owner (S,2).
  const poison = edit('peer', after.targetRevision, 2, 5, 999); poison.sid = a.sid;
  assert.equal((await native.service.submitChangeset({ changeset: poison }, context('peer'))).status, 'rejected');
  const legitimate = edit('owner', after.targetRevision, 2, 5, 55);
  assert.equal((await native.service.submitChangeset({ changeset: legitimate }, context('owner'))).status, 'committed');
  after = await load(); assert.equal(after.targetRevision, base + 3);
  const retry = await native.service.submitChangeset({ changeset: b }, context('peer'));
  assert.equal(retry.status, 'already-committed'); assert.equal((await load()).targetRevision, after.targetRevision);
  const overlap = await Promise.all(['owner', 'peer'].map((p, i) => native.service.submitChangeset({ changeset: edit(p, after.targetRevision, 3, 0, 30 + i) }, context(p))));
  assert.ok(overlap.every(x => x.status === 'committed'), JSON.stringify(overlap));
  const head = (await load()).targetRevision, row = edit('owner', head, 4, 0, 0);
  row.mutations = [{ id: 'sheet.mutation.insert-row', data: JSON.stringify({ unitId: NATIVE_UNIT, subUnitId: NATIVE_TAB, range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 25 } }) }];
  assert.equal((await native.service.submitChangeset({ changeset: row }, context('owner'))).status, 'committed');
  // Install a pause before the real authority commit hook, after SDK admission.
  let release, entered; const paused = new Promise(r => { entered = r; }); const wait = new Promise(r => { release = r; });
  native.service.use('applyChangeset', async (_c, next) => { entered(); await wait; await next(); });
  const deniedEdit = native.service.submitChangeset({ changeset: edit('peer', (await load()).targetRevision, 4, 3, 99) }, context('peer'));
  await Promise.race([paused, deniedEdit.then(result => { throw new Error(`submission_finished_before_race_pause:${result.status}`); })]);
  await workspace.share(owner, NATIVE_UNIT, { commandId: 'revoke', peer: 'peer', role: null, accessRevision: 1 });
  release(); const denied = await deniedEdit; assert.equal(denied.status, 'rejected', JSON.stringify(denied));
  const retained = await load(); assert.equal(retained.targetRevision, head + 1);
  await assert.rejects(native.service.getUnitLoadDataWithBlocks({ unitID: NATIVE_UNIT, type: UniverType.UNIVER_SHEET, revision: 0 }, { userID: 'peer' }));
  await native.close(); workspace = new Workspace(store, { peers: accounts }); native = await start();
  assert.deepEqual(await load(), retained);
  await workspace.share(owner, NATIVE_UNIT, { commandId: 'regrant', peer: 'peer', role: 'editor', accessRevision: 2 });
  register();
  // New member/session after reopen retains native sid/reqId and stored owner.
  const afterRestart = await native.service.submitChangeset({ changeset: legitimate }, context('owner'));
  assert.equal(afterRestart.status, 'already-committed');
  assert.equal(afterRestart.changeset.userID, 'owner');
  assert.equal((await native.service.submitChangeset({ changeset: poison }, context('peer'))).status, 'rejected');
  assert.equal((await load()).targetRevision, retained.targetRevision);
  console.log(JSON.stringify({ actualSDK: '1.4.0', sqlite: filename, revision: retained.targetRevision, dedup: retry.status, commitRace: denied.status, restart: 'deep-equal', browserConvergence: 'not exercised', postgres: 'not exercised', license: native.service.license.status }));
} finally { await native.close(); }
