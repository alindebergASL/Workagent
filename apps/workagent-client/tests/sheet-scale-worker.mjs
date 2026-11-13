import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { workload, countCells, observedValues } from './sheet-scale-fixture.mjs';
import { validateWorkbook, withoutFormulaResults } from '../../../packages/workagent-contract/index.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { MaintenanceActions } from '../src/maintenance-actions.ts';

assert.ok(process.send, 'Run via sheet-scale.mjs so resource monitoring cannot be omitted');
const [root, count] = process.argv.slice(2), populated = Number(count);
let heapPeak = 0;
const memory = () => { const m = process.memoryUsage(); heapPeak = Math.max(heapPeak, m.heapUsed); return { ...m, sampledHeapPeak: heapPeak, maxRSS: process.resourceUsage().maxRSS * 1024 }; };
const send = data => process.send({ ...data, memory: memory() });
const sampler = setInterval(() => send({ type: 'memory' }), 50);
async function phase(name, fn) {
  await new Promise(resolve => { process.once('message', resolve); send({ type: 'phase', name }); });
  const start = performance.now();
  try { const detail = await fn(); send({ type: 'result', name, status: 'passed', wallMs: performance.now() - start, detail }); }
  catch (error) { send({ type: 'result', name, status: 'failed', wallMs: performance.now() - start, error: { name: error.name, code: error.code, message: error.message } }); throw error; }
}
function inspect(book, edited) {
  const counts = countCells(book), values = observedValues(book, populated, edited);
  send({ type: 'observations', counts, values, jsonBytes: Buffer.byteLength(JSON.stringify(book)), jsonCharacters: JSON.stringify(book).length });
  assert.equal(counts.populated, populated); assert.equal(counts.formulas, populated / 1000 * 140);
  assert.equal(counts.cachedFormulas, counts.formulas, 'every formula must have a result from the real engine');
  assert.equal(counts.formulaErrors, 0);
  for (const item of values) assert.equal(item.actual, item.expected, `${item.sheet}[${item.row},${item.column}]`);
  validateWorkbook(book);
  return counts;
}
let native, app;
try {
  const statePath = join(root, `workspace-${populated}.json`), snapshotPath = join(root, `snapshot-${populated}.json`);
  let workspace, workId, seed, mountNative, mountApp, versions, storage;
  await phase('generate-and-validate', async () => {
    seed = workload(populated);
    const counts = countCells(seed); assert.equal(counts.cachedFormulas, 0);
    const raw = JSON.stringify(seed);
    send({ type: 'seed', counts, jsonBytes: Buffer.byteLength(raw), jsonCharacters: raw.length, sha256: createHash('sha256').update(raw).digest('hex') });
    validateWorkbook(seed);
    // Preserve one bounded codec request for the separate XLSX negative check.
    if (populated === 100_000) writeFileSync(join(root, 'xlsx-request.json'), JSON.stringify({ op: 'export', book: seed }));
    writeFileSync(statePath, JSON.stringify(initialState('owner')));
    workspace = new Workspace(new FileFixtureStore(statePath));
    ({ workId } = await workspace.createBlank('owner', { commandId: 'scale-create', title: seed.name }));
    seed.id = workId;
    await workspace.save('owner', workId, { commandId: 'scale-seed', book: seed, contentRevision: 1, permissionRevision: 1 });
    return { counts, nativeGuard: 'JSON.stringify(book).length <= 4_000_000; <=20 tabs; <=10000 rows and <=200 columns per tab', source: 'packages/workagent-contract/index.mjs:16' };
  });
  await phase('load-installed-sdk', async () => {
    const harness = await import('./sheet-scale-harness.mjs');
    ({ mountNative, mountApp, versions } = harness); storage = harness.memoryStorage();
    return { node: process.version, versions };
  });
  let saveCalls = [], loseAck = true, pendingRequests = new Set();
  const fetcher = (path, options = {}) => {
    const operation = (async () => {
      const input = options.body ? JSON.parse(options.body) : undefined;
      let result;
      if (path === '/api/work') result = await workspace.list('owner');
      else if (path.startsWith('/api/events')) result = await workspace.events('owner', path.includes('?') ? Number(new URL(path, 'http://fixture').searchParams.get('after')) : undefined);
      else if (path === `/api/work/${workId}/save`) {
        saveCalls.push({ sha256: createHash('sha256').update(options.body).digest('hex'), bytes: Buffer.byteLength(options.body), commandId: input.commandId });
        result = await workspace.save('owner', workId, input);
        if (loseAck) { loseAck = false; throw new Error('synthetic lost acknowledgement after FileFixtureStore commit'); }
      } else { assert.equal(path, `/api/work/${workId}`); result = await workspace.get('owner', workId); }
      return { ok: true, status: 200, json: async () => result };
    })();
    pendingRequests.add(operation); operation.then(() => pendingRequests.delete(operation), () => pendingRequests.delete(operation)); return operation;
  };
  async function drain() {
    for (let i = 0; i < 20; i++) { await Promise.allSettled([...pendingRequests]); await app.flush(); if (pendingRequests.size === 0) return; }
    throw new Error('App request chain failed to settle');
  }
  await phase('native-create-and-calculate', async () => {
    app = mountApp(storage, fetcher); await drain(); await app.open(workId); await drain();
    assert.ok(app.native()); native = mountNative(app.native());
    const calculation = await native.settle(); assert.ok(calculation.starts.includes(true), 'NativeEditor must force initial calculation');
    const counts = inspect(native.handle.save(), false); assert.equal(native.edits, 0, 'formula caches must not create a human draft');
    seed = null;
    return { calculation, counts };
  });
  await phase('human-edit-and-recalculate', async () => {
    native.resetCalculation();
    native.api.getActiveWorkbook().getSheetBySheetId('inputs').getRange('A3').setValue(103);
    const calculation = await native.settle(), counts = inspect(native.handle.save(), true);
    assert.equal(native.edits, 1, 'one human edit; recalculation is not a second human edit');
    return { calculation, counts, humanEdits: native.edits, input: 'Inputs!A3: 3 -> 103', dependent: 'Operations!B2: 28 -> 428; Summary!A1: 94 -> 494', recoveryStorage: storage.usage() };
  });
  await phase('native-commit-app-save-lost-ack', async () => {
    const snapshot = await native.handle.commit(); inspect(snapshot, true);
    writeFileSync(snapshotPath, JSON.stringify(snapshot));
    await app.save(); await drain();
    assert.equal(saveCalls.length, 1);
    const pending = new MaintenanceActions(storage, `sheet-save:${workId}`).read(); assert.ok(pending);
    const saved = await workspace.get('owner', workId); assert.equal(saved.contentRevision, 3); inspect(saved.book, true);
    assert.equal(saved.intentRevision, 0); assert.equal(await workspace.claim('owner'), null);
    assert.ok(saved.humanCells.length >= populated, 'seeded human ownership is retained');
    assert.ok(saved.humanCells.includes('inputs:2:0'));
    return { contentRevision: saved.contentRevision, saveCalls, recoveryStorage: storage.usage(), storeBytes: Buffer.byteLength(readFileSync(statePath)), snapshotBytes: Buffer.byteLength(readFileSync(snapshotPath)) };
  });
  await phase('dispose-before-reopen', async () => { await delay(1100); native.dispose(); native = null; app.unmount(); app = null; return { disposed: true }; });
  await phase('snapshot-reopen-and-exact-save-resume', async () => {
    workspace = new Workspace(new FileFixtureStore(statePath));
    app = mountApp(storage, fetcher); await drain(); await app.open(workId); await drain();
    native = mountNative(app.native()); const calculation = await native.settle(); inspect(native.handle.save(), true);
    assert.equal(native.edits, 0);
    await app.save(); await drain();
    assert.equal(saveCalls.length, 2); assert.deepEqual(saveCalls[0], saveCalls[1], 'App retry must send byte-identical save body/command');
    assert.equal(new MaintenanceActions(storage, `sheet-save:${workId}`).read(), null);
    const saved = await workspace.get('owner', workId); assert.equal(saved.contentRevision, 3, 'exact retry cannot create revision 4'); inspect(saved.book, true);
    assert.deepEqual(withoutFormulaResults(JSON.parse(readFileSync(snapshotPath, 'utf8'))), withoutFormulaResults(saved.book));
    assert.equal(saved.intentRevision, 0); assert.equal(await workspace.claim('owner'), null);
    return { calculation, saveCalls, contentRevision: saved.contentRevision, recoveryStorage: storage.usage(), fixtureOnly: true };
  });
  await phase('cold-saved-snapshot-validation', async () => {
    await delay(1100); native.dispose(); native = null; app.unmount(); app = null;
    const saved = await new Workspace(new FileFixtureStore(statePath)).get('owner', workId);
    native = mountNative({ book: saved.book, version: 'cold' });
    const calculation = await native.settle(); inspect(native.handle.save(), true);
    assert.equal(native.edits, 0); return { calculation, contentRevision: saved.contentRevision };
  });
  await phase('dispose', async () => { await delay(1100); native.dispose(); native = null; return { disposed: true }; });
  send({ type: 'complete', status: 'passed', populated, versions });
} catch (error) {
  send({ type: 'complete', status: 'failed', populated, error: { name: error.name, code: error.code, message: error.message, stack: error.stack } });
  process.exitCode = 1;
} finally {
  clearInterval(sampler);
  // Exit also stops any outstanding SDK timers after a classified failure.
  process.disconnect(); process.exit(process.exitCode ?? 0);
}
