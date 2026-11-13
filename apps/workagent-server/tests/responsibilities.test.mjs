// File-backed state/owned-file fixtures, with the real handlers and dispatcher.
// Not a PostgreSQL, listener, service, browser or provider proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { Workspace } from '../src/workspace.mjs';
import { initialState, PostgresStore } from '../src/store.mjs';
import { OwnedFiles, hashBytes } from '../src/owned-files.mjs';
import { Maintenance } from '../src/responsibilities.mjs';
import { createHandler } from '../src/http.mjs';
import { createDispatcher } from '../../workagent-runner/src/dispatch.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
import { applyPatch, Fault } from '../../../packages/workagent-contract/index.mjs';
import { MaintenanceActions } from '../../workagent-client/src/maintenance-actions.ts';
import { ApiError } from '../../workagent-client/src/resume.ts';
let serial = 0; const commandId = () => `test_${++serial}`;
const target = { sheetId: 'sheet1', row: 0, column: 0 };
async function setup(config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'b03-fixture-')), path = join(dir, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), workspace = new Workspace(store), files = new OwnedFiles(dir);
  let now = Date.parse('2026-11-13T12:00:00Z');
  const maintenance = new Maintenance({ workspace, files, now: () => now });
  const started = await workspace.command('owner', { commandId: commandId(), kind: 'start', text: 'Synthetic warehouse planning', sourceIds: [] });
  const initial = await workspace.claim('owner'); await workspace.finish('owner', initial, [], 'ready');
  const source = await maintenance.publish('owner', { commandId: commandId(), name: 'Synthetic inventory', synthetic: true, content: '{"available_units":120}' });
  const wid = started.workId;
  const r = await maintenance.create('owner', wid, { commandId: commandId(), sourceId: source.id, field: 'available_units', target, expected: (await workspace.get('owner', wid)).expected, ...config });
  const get = () => workspace.get('owner', wid);
  return { dir, path, store, workspace, files, maintenance, source, wid, rid: r.id, get,
    advance: ms => { now += ms; },
    async publish(value) { const sources = await maintenance.sources('owner'); const current = sources.find(s => s.id === source.id); return maintenance.publish('owner', { commandId: commandId(), sourceId: source.id, expectedRevision: current.revision, name: current.name, synthetic: true, content: JSON.stringify({ available_units: value }) }); },
    async run() { await maintenance.admitDue('owner'); const job = await workspace.claim('owner'); assert.equal(job?.kind, 'maintenance'); return maintenance.run('owner', job); },
    async manage(action, extra = {}) { const w = await get(), resp = w.responsibilities[0]; return maintenance.manage('owner', wid, r.id, { commandId: commandId(), action, revision: resp.revision, expected: w.expected, ...extra }); },
  };
}
const value = w => w.book.sheets.sheet1.cellData?.[0]?.[0]?.v;
async function human(f, val) { const w = await f.get(); return f.workspace.save('owner', f.wid, { commandId: commandId(), contentRevision: w.contentRevision, permissionRevision: w.expected.permissionRevision, book: applyPatch(w.book, { cells: [{ ...target, value: val }, { ...target, column: 1, value: 'keep this human cell' }] }) }); }
test('duplicate due admission and execution commit exactly one internal cell change', async () => {
  const f = await setup(); await Promise.all([f.maintenance.admitDue('owner'), f.maintenance.admitDue('owner')]);
  const state = JSON.parse(await readFile(f.path)); assert.equal(Object.values(state.jobs).filter(j => j.kind === 'maintenance').length, 1);
  const job = await f.workspace.claim('owner'); const result = await f.maintenance.run('owner', job); assert.equal(result.outcome, 'changed');
  const before = await f.get(); assert.deepEqual(await f.maintenance.run('owner', job), result); assert.equal((await f.get()).contentRevision, before.contentRevision); assert.equal(value(before), 120);
});
test('changed and unchanged observations update freshness without unchanged inbox chatter', async () => {
  const f = await setup(); await f.run(); f.advance(60000); assert.equal((await f.run()).outcome, 'unchanged');
  let w = await f.get(); assert.equal(w.inbox.length, 1); assert.equal(w.responsibilities[0].lastObservation.observedAt, '2026-11-13T12:01:00.000Z');
  await f.publish(135); assert.equal((await f.run()).outcome, 'changed'); w = await f.get(); assert.equal(value(w), 135); assert.equal(w.inbox.length, 2);
});
test('restart after observation/claim recovers the pinned snapshot, then catches newest source', async () => {
  const f = await setup(); await f.maintenance.admitDue('owner'); const claimed = await f.workspace.claim('owner'); await f.publish(160);
  const workspace = new Workspace(new FileFixtureStore(f.path)), maintenance = new Maintenance({ workspace, files: new OwnedFiles(f.dir) });
  await workspace.recover('owner', () => { throw new Error('maintenance must not inspect a native session'); });
  const recovered = await workspace.claim('owner'); assert.equal(recovered.id, claimed.id); assert.equal((await maintenance.run('owner', recovered)).observation.value, 120);
  assert.equal(value(await f.get()), 120); assert.equal((await f.run()).observation.sourceRevision, 2); assert.equal(value(await f.get()), 160);
  assert.equal(Object.keys(JSON.parse(await readFile(f.path)).observations).length, 2);
});
test('read outside transaction, concurrent publish discards stale admission', async () => {
  const f = await setup(); let changed = false; const read = f.files.read.bind(f.files);
  f.files.read = async (...args) => { const data = await read(...args); if (!changed) { changed = true; await f.publish(180); } return data; };
  await f.maintenance.admitDue('owner'); assert.equal(await f.workspace.claim('owner'), null);
  assert.equal((await f.run()).observation.value, 180);
});
test('latest catch-up retains earlier source revisions and records missed intervals', async () => {
  const f = await setup(); await f.run(); await f.publish(121); await f.publish(122); await f.publish(123); f.advance(3600000);
  const result = await f.run(); assert.equal(result.observation.value, 123); assert.equal(result.observation.coalescedRevisions, 2); assert.ok(result.observation.missedIntervals >= 59);
  assert.equal(JSON.parse(await readFile(f.path)).ownedSources[f.source.id].revisions.length, 4);
});
for (const action of ['pause', 'end', 'revoke', 'permission']) test(`${action} after claim fences commit and retains observation`, async () => {
  const f = await setup(); await f.maintenance.admitDue('owner'); const job = await f.workspace.claim('owner');
  if (action === 'revoke') await f.maintenance.revokeSource('owner', f.source.id, { commandId: commandId() });
  else if (action === 'permission') await f.store.transaction(s => { s.permissionRevision++; return null; });
  else await f.manage(action);
  const result = await f.maintenance.run('owner', job); assert.equal(result.outcome, ({ pause: 'paused', end: 'ended', revoke: 'revoked', permission: 'revoked' })[action]);
  assert.equal(value(await f.get()), undefined); assert.equal(result.observation.value, 120);
  if (action === 'pause') { await f.manage('resume'); assert.equal((await f.run()).outcome, 'changed'); }
});
test('human override after claim stays protected; explicit current relink releases only that cell', async () => {
  const f = await setup(); await f.maintenance.admitDue('owner'); const job = await f.workspace.claim('owner'); await human(f, 99);
  assert.equal((await f.maintenance.run('owner', job)).outcome, 'protected'); assert.equal(value(await f.get()), 99);
  await f.publish(144); assert.equal((await f.run()).outcome, 'protected'); assert.equal((await f.get()).responsibilities[0].lastObservation.value, 144);
  const stale = (await f.get()).expected; await human(f, 100);
  await assert.rejects(f.manage('relink', { expected: stale }), /save_conflict/);
  await f.manage('relink'); assert.deepEqual((await f.get()).humanCells, ['sheet1:0:1']); assert.equal((await f.run()).outcome, 'changed'); assert.equal(value(await f.get()), 144);
});
test('existing human cell binds protected without erasing any protected cell', async () => {
  const f = await setup(); await human(f, 77); assert.equal((await f.run()).outcome, 'protected'); assert.equal(value(await f.get()), 77);
});
test('end date reached after claim blocks commit and future admission', async () => {
  const f = await setup({ endAt: '2026-11-13T12:00:10Z' }); await f.maintenance.admitDue('owner'); const job = await f.workspace.claim('owner'); f.advance(10000);
  assert.equal((await f.maintenance.run('owner', job)).outcome, 'ended'); await f.maintenance.admitDue('owner'); assert.equal(await f.workspace.claim('owner'), null);
});
test('notifications honor thresholds, timezone quiet hours and durable digest', async () => {
  const f = await setup({ notifications: { threshold: 10, digestMinutes: 5, quiet: { start: 12, end: 13 } } });
  await f.run(); await f.publish(125); await f.run(); await f.publish(140); await f.run(); assert.equal((await f.get()).inbox, undefined);
  const w = await f.get(); assert.equal(w.responsibilities[0].pendingNotice.count, 2);
  f.advance(3600000); await f.maintenance.admitDue('owner'); const inbox = (await f.get()).inbox; assert.equal(inbox.length, 1); assert.equal(inbox[0].count, 2); assert.equal(inbox[0].value, 140);
});
test('human intent takes priority and maintenance cannot supersede or cancel it', async () => {
  const f = await setup(); await f.maintenance.admitDue('owner');
  await f.workspace.command('owner', { commandId: commandId(), kind: 'continue', workId: f.wid, expectedIntentRevision: 1, sourceIds: [], text: 'Human next step' });
  const humanJob = await f.workspace.claim('owner'); assert.notEqual(humanJob.kind, 'maintenance'); assert.equal(await f.workspace.claim('owner'), null);
  await f.workspace.finish('owner', humanJob, [], 'ready'); const job = await f.workspace.claim('owner'); assert.equal(job.kind, 'maintenance'); assert.equal((await f.maintenance.run('owner', job)).outcome, 'changed');
});
test('new human intent after maintenance claim blocks maintenance commit', async () => {
  const f = await setup(); await f.maintenance.admitDue('owner'); const job = await f.workspace.claim('owner');
  await f.workspace.command('owner', { commandId: commandId(), kind: 'continue', workId: f.wid, expectedIntentRevision: 1, sourceIds: [], text: 'Human next step' });
  assert.equal((await f.maintenance.run('owner', job)).outcome, 'work_changed'); assert.equal((await f.get()).status, 'queued');
});
test('actual dispatcher performs closed-client backend execution without host/model calls', async () => {
  const f = await setup(); let providerCalls = 0;
  const dispatcher = createDispatcher({ workspace: f.workspace, maintenance: f.maintenance, principal: 'owner', host: { run() { providerCalls++; throw new Error('unexpected model'); } } });
  dispatcher.wake(); await dispatcher.idle(); assert.equal(value(await f.get()), 120); await f.publish(212); dispatcher.wake(); await dispatcher.idle(); await dispatcher.close();
  assert.equal(value(await f.get()), 212); assert.equal(providerCalls, 0);
});
test('owned source access, traversal, arbitrary paths, size, parser and symlink boundaries', async () => {
  const f = await setup(); const input = { commandId: commandId(), name: 'Synthetic', synthetic: true, content: '{"n":1}' };
  await assert.rejects(f.maintenance.publish('intruder', input), /access_denied/);
  await assert.rejects(f.maintenance.publish('owner', { ...input, path: '/etc/passwd' }), /invalid_owned_source/);
  await assert.rejects(f.files.read('owner', '../outside'), /source_path_denied/);
  await assert.rejects(f.maintenance.publish('owner', { ...input, sourceId: 'unowned', expectedRevision: 1 }), /source_access_denied/);
  await assert.rejects(f.maintenance.publish('owner', { ...input, content: ' '.repeat(65537) }), /source_size/);
  await assert.rejects(f.maintenance.publish('owner', { ...input, content: '{"n":' }), /source_partial_or_invalid/);
  await assert.rejects(f.maintenance.publish('owner', { ...input, content: '{"n":{"shell":"do not execute"}}' }), /source_scalar_required/);
  const dir = await f.files.directory('owner'), content = '{"n":2}', hash = hashBytes(content), outside = join(f.dir, 'outside');
  await writeFile(outside, content); await symlink(outside, join(dir, `${hash}.json`)); await assert.rejects(f.files.read('owner', hash));
  const otherRoot = join(f.dir, 'other'); await mkdir(otherRoot); await symlink(dir, join(otherRoot, 'owned-sources')); await assert.rejects(new OwnedFiles(otherRoot).write('owner', content), /source_path_denied/);
});
test('formula-looking source text remains a native string, never a formula', async () => {
  const f = await setup(); await f.publish('=IMPORTXML("https://example.invalid")'); await f.run();
  const cell = (await f.get()).book.sheets.sheet1.cellData[0][0]; assert.equal(cell.f, undefined); assert.equal(cell.t, 1); assert.match(cell.v, /^=/);
  const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
  const { Univer, LocaleType } = require('@univerjs/core'), { FUniver } = require('@univerjs/core/facade');
  const { UniverSheetsPlugin } = require('@univerjs/sheets'); require('@univerjs/sheets/facade');
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: {} } }); univer.registerPlugin(UniverSheetsPlugin);
  try {
    const book = FUniver.newAPI(univer).createWorkbook((await f.get()).book), actual = book.save().sheets.sheet1.cellData[0][0];
    assert.equal(actual.f, undefined); assert.equal(actual.t, 1); assert.equal(actual.v, cell.v);
  } finally { univer.dispose(); }

});
test('unavailable, mutated and missing revision data produce durable visible outcomes', async () => {
  const f = await setup(); const read = f.files.read.bind(f.files);
  f.files.read = async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); };
  assert.equal((await f.run()).outcome, 'source_deleted_or_unavailable'); assert.equal(value(await f.get()), undefined);
  f.files.read = read; f.advance(60000); assert.equal((await f.run()).outcome, 'changed');
  const dir = await f.files.directory('owner'); await writeFile(join(dir, `${f.source.hash}.json`), '{"available_units":999}'); f.advance(60000);
  assert.equal((await f.run()).outcome, 'source_revision_mismatch'); assert.equal(value(await f.get()), 120);
  await f.store.transaction(s => { s.ownedSources[f.source.id].revision++; return null; }); f.advance(60000);
  assert.equal((await f.run()).outcome, 'source_revision_gap');
});
test('authenticated HTTP handlers expose owned source creation, configuration and pause', async () => {
  const f = await setup(), token = 'synthetic-fixture-token-at-least-32-characters', origin = 'https://private.invalid';
  const handle = createHandler({ workspace: f.workspace, maintenance: f.maintenance, owner: 'owner', token, origin, clientRoot: f.dir });
  async function request(url, input, auth = true) {
    const req = Readable.from(input ? [Buffer.from(JSON.stringify(input))] : []);
    Object.assign(req, { method: input ? 'POST' : 'GET', url, headers: { origin, 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) } });
    let status, body; await handle(req, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { body = JSON.parse(raw); } }); return { status, body };
  }
  assert.equal((await request('/api/owned-sources', null, false)).status, 401);
  assert.equal((await request('/api/owned-sources')).body.length, 1);
  const input = { commandId: commandId(), name: 'Synthetic capacity', synthetic: true, content: '{"capacity":28}' };
  const created = await request('/api/owned-sources', input); assert.equal(created.status, 200); assert.deepEqual(await request('/api/owned-sources', input), created);
  assert.equal((await request(`/api/work/${f.wid}/responsibilities/${f.rid}`, { commandId: commandId(), action: 'pause', revision: 1 })).body.status, 'paused');
});
test('PostgresStore fixture rolls back observation, outbox, cursor and cell together on commit failure', async () => {
  const f = await setup(); await f.maintenance.admitDue('owner'); const job = await f.workspace.claim('owner');
  const retained = JSON.parse(await readFile(f.path)); let rollback = false, written;
  const pool = { async connect() { return { async query(sql, args) {
    if (sql.startsWith('SELECT')) return { rows: [{ data: structuredClone(retained) }] };
    if (sql.startsWith('UPDATE')) written = JSON.parse(args[1]);
    if (sql === 'COMMIT') throw new Error('fixture_commit_failure');
    if (sql === 'ROLLBACK') rollback = true;
    return { rows: [] };
  }, release() {} }; } };
  const workspace = new Workspace(new PostgresStore(pool, 'owner')), maintenance = new Maintenance({ workspace, files: f.files });
  await assert.rejects(maintenance.run('owner', job), /fixture_commit_failure/); assert.equal(rollback, true); assert.equal(written.jobs[job.id].outcome, 'changed');
  assert.equal(retained.jobs[job.id].status, 'running'); assert.equal(retained.works[f.wid].contentRevision, 0);
});
test('partial staging file cannot publish a revision; next upload safely publishes complete bytes', async () => {
  const f = await setup(), dir = await f.files.directory('owner'), content = '{"available_units":250}', hash = hashBytes(content);
  await writeFile(join(dir, `${hash}-interrupted.pending`), '{"available_units":');
  const published = await f.publish(250); assert.equal(published.hash, hash); assert.equal((await f.run()).observation.value, 250);
  assert.equal(await readFile(join(dir, `${hash}-interrupted.pending`), 'utf8'), '{"available_units":');
});
test('source publication replay survives later revocation without reading revoked content', async () => {
  const f = await setup(); const input = { commandId: commandId(), sourceId: f.source.id, expectedRevision: 1, name: 'Synthetic inventory', synthetic: true, content: '{"available_units":180}' };
  const result = await f.maintenance.publish('owner', input);
  await f.maintenance.revokeSource('owner', f.source.id, { commandId: commandId() });
  f.files.write = () => { throw new Error('must not read or write on replay'); };
  assert.deepEqual(await f.maintenance.publish('owner', input), result);
  await assert.rejects(f.maintenance.publish('owner', { ...input, commandId: commandId() }), /source_revoked/);
});
test('disabled owner after claim retains revocation outcome without applying the bound value', async () => {
  const f = await setup(); await f.maintenance.admitDue('owner'); const job = await f.workspace.claim('owner');
  await f.store.transaction(s => { s.enabled = false; return null; });
  assert.equal((await f.maintenance.run('owner', job)).outcome, 'revoked');
  const state = JSON.parse(await readFile(f.path)); assert.equal(value(state.works[f.wid]), undefined); assert.equal(state.jobs[job.id].status, 'completed');
});
test('source ownership is rechecked before observation and again at occurrence commit', async () => {
  const f = await setup(); await f.maintenance.admitDue('owner'); const job = await f.workspace.claim('owner');
  await f.store.transaction(s => { s.ownedSources[f.source.id].owner = 'different-owner'; return null; });
  assert.equal((await f.maintenance.run('owner', job)).outcome, 'revoked');
  f.files.read = () => { throw new Error('must never read another owners source'); }; f.advance(60000); await f.maintenance.admitDue('owner');
  assert.equal((await f.get()).responsibilities[0].status, 'revoked'); assert.equal(await f.workspace.claim('owner'), null);
});
test('oversize maintenance settles durably, survives restart and End, and releases human continuation', async () => {
  const f = await setup({ target: { sheetId: 'sheet1', row: 199, column: 1 } });
  const w = await f.get();
  for (let row = 0; row < 199; row++) w.book.sheets.sheet1.cellData[row] = { 0: { v: 'x'.repeat(20000), t: 1 } };
  await f.workspace.save('owner', f.wid, { commandId: commandId(), contentRevision: w.contentRevision, permissionRevision: w.expected.permissionRevision, book: w.book });
  await f.publish('y'.repeat(20000)); await f.maintenance.admitDue('owner'); const claimed = await f.workspace.claim('owner');
  const workspace = new Workspace(new FileFixtureStore(f.path)), maintenance = new Maintenance({ workspace, files: new OwnedFiles(f.dir) });
  await workspace.recover('owner'); const recovered = await workspace.claim('owner'); assert.equal(recovered.id, claimed.id);
  const result = await maintenance.run('owner', recovered);
  assert.equal(result.outcome, 'validation_failed'); assert.equal(result.errorCode, 'invalid_workbook');
  let state = JSON.parse(await readFile(f.path)), saved = await f.get();
  assert.equal(state.jobs[claimed.id].status, 'completed'); assert.equal(state.jobs[claimed.id].errorCode, 'invalid_workbook');
  assert.deepEqual(result.observation, claimed.observation); assert.deepEqual(state.observations[claimed.observation.id], claimed.observation);
  assert.deepEqual(saved.book, w.book); assert.equal(saved.contentRevision, 1);
  assert.equal(saved.responsibilities[0].lastOutcome, 'validation_failed'); assert.equal(saved.responsibilities[0].lastErrorCode, 'invalid_workbook');
  assert.equal(saved.inbox.at(-1).errorCode, 'invalid_workbook');
  const restarted = new Workspace(new FileFixtureStore(f.path)); await restarted.recover('owner'); assert.equal(await restarted.claim('owner'), null);
  const terminal = state.jobs[claimed.id]; await f.manage('end');
  assert.deepEqual(await maintenance.run('owner', claimed), result);
  state = JSON.parse(await readFile(f.path)); assert.deepEqual(state.jobs[claimed.id], terminal); assert.equal((await f.get()).responsibilities[0].lastOutcome, 'end');
  await restarted.command('owner', { commandId: commandId(), kind: 'continue', workId: f.wid, expectedIntentRevision: saved.intentRevision, text: 'Help reduce the size of this sheet', sourceIds: [] });
  let calls = 0; const dispatcher = createDispatcher({ workspace: restarted, maintenance, principal: 'owner', host: { async run() { calls++; return []; } } });
  dispatcher.wake(); await dispatcher.idle(); await dispatcher.close(); assert.equal(calls, 1); assert.equal((await f.get()).status, 'ready');
  assert.equal(JSON.parse(await readFile(f.path)).ownedSources[f.source.id].revisions.length, 2);
});
test('store failures stay uncertain; a lost completed acknowledgement never overwrites a terminal job', async () => {
  for (const committed of [false, true]) {
    const f = await setup(); await f.maintenance.admitDue('owner'); const job = await f.workspace.claim('owner');
    // Even a validation-shaped transport failure is outside the synchronous editor boundary.
    const workspace = new Workspace({ async transaction(fn) { if (committed) await f.store.transaction(fn); throw new Fault('invalid_workbook', 400); } });
    const maintenance = new Maintenance({ workspace, files: f.files });
    await assert.rejects(maintenance.run('owner', job), /invalid_workbook/);
    const before = JSON.parse(await readFile(f.path)).jobs[job.id]; assert.equal(before.status, committed ? 'completed' : 'running'); assert.equal(before.errorCode, undefined);
    assert.equal((await f.maintenance.run('owner', job)).outcome, 'changed');
    if (committed) assert.deepEqual(JSON.parse(await readFile(f.path)).jobs[job.id], before);
  }
});
test('real HTTP source_revoked refusal releases only its publication and allows End; committed replay stays successful', async () => {
  const f = await setup(), token = 'synthetic-fixture-token-at-least-32-characters', origin = 'https://private.invalid';
  const handle = createHandler({ workspace: f.workspace, maintenance: f.maintenance, owner: 'owner', token, origin, clientRoot: f.dir });
  async function request(path, input) {
    const req = Readable.from([Buffer.from(JSON.stringify(input))]);
    Object.assign(req, { method: 'POST', url: `/api${path}`, headers: { origin, 'content-type': 'application/json', authorization: `Bearer ${token}` } });
    let status, body; await handle(req, { setHeader() {}, writeHead(code) { status = code; }, end(raw) { body = JSON.parse(raw); } });
    if (status !== 200) throw new ApiError(path, status, body.error); return body;
  }
  const values = new Map(), disk = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const actions = new MaintenanceActions(disk, f.wid), path = '/owned-sources';
  const acceptedInput = { commandId: commandId(), sourceId: f.source.id, expectedRevision: 1, name: 'Synthetic', synthetic: true, content: '{"stock_on_hand":12}' };
  const accepted = await request(path, acceptedInput);
  const pending = actions.prepare('publish', path, { ...acceptedInput, expectedRevision: 2, content: '{"stock_on_hand":15}' }, commandId);
  await f.maintenance.revokeSource('owner', f.source.id, { commandId: commandId() });
  await assert.rejects(request(path, pending.input), error => { assert.equal(error.status, 409); assert.equal(error.code, 'source_revoked'); actions.rejected(error, pending); return true; });
  assert.equal(actions.read(), null); assert.equal(JSON.parse(await readFile(f.path)).commands[pending.input.commandId], undefined);
  assert.deepEqual(await request(path, acceptedInput), accepted);
  const r = (await f.get()).responsibilities[0], end = actions.prepare('end', `/work/${f.wid}/responsibilities/${f.rid}`, { action: 'end', revision: r.revision }, commandId);
  assert.equal((await request(end.path, end.input)).status, 'ended'); actions.accepted(end); assert.equal(actions.read(), null);
});
