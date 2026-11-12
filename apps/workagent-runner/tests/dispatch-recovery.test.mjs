import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { bootHost } from '../src/host.mjs';
import { createDispatcher } from '../src/dispatch.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'workagent-recovery-')), path = join(root, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), ws = new Workspace(store);
  const start = async (commandId, sourceIds = []) => ws.command('owner', { commandId, kind: 'start', text: commandId, sourceIds });
  return { root, path, store, ws, start };
}
class LocalProvider extends LlmAdapter {
  calls = [];
  providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }; }
  async *stream(options) {
    this.calls.push(options);
    const block = { type: 'text', text: 'Local fixture result' };
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: block.text };
    yield { type: 'block-end', index: 0, block };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
for (const boundary of ['session_ready', 'prompt_accepted', 'execution_started', 'completed']) {
  test(`real DSH restart at ${boundary} retains identity and never repeats possible dispatch`, { timeout: 15000 }, async () => {
    const { root, path, ws, start } = await setup(); await start('request');
    const job = await ws.claim('owner'), provider = new LocalProvider();
    let host = await bootHost({ stateRoot: root, workspace: ws, principal: 'owner', provider });
    const checkpoint = ws.checkpoint.bind(ws);
    ws.checkpoint = async (...args) => { const result = await checkpoint(...args); if (args[2] === boundary) throw new Error('fixture_crash'); return result; };
    await assert.rejects(host.run(job), /fixture_crash/); await host.close();
    const count = provider.calls.length;
    const reopened = new Workspace(new FileFixtureStore(path));
    host = await bootHost({ stateRoot: root, workspace: reopened, principal: 'owner', provider });
    try {
      await reopened.recover('owner', host.inspect);
      const recovered = await reopened.claim('owner');
      if (['session_ready', 'prompt_accepted'].includes(boundary)) {
        assert.equal(recovered.sessionId, job.sessionId); assert.equal(recovered.id, job.id);
        const messages = await host.run(recovered); await reopened.finish('owner', recovered, messages, 'ready');
        assert.equal(provider.calls.length, 1);
        const native = await host.inspect(job);
        assert.equal(native.events.filter(e => e.type === 'user/message').length, 1);
      } else {
        assert.equal(recovered, null); assert.equal(provider.calls.length, count);
        assert.equal((await reopened.get('owner', job.workId)).status, boundary === 'completed' ? 'ready' : 'interrupted');
      }
      const state = JSON.parse(await readFile(path));
      assert.equal(state.jobs.request.sessionId, job.sessionId);
      if (boundary === 'completed') assert.equal(state.works[job.workId].messages.filter(m => m.role === 'assistant').length, 1);
    } finally { await host.close(); }
  });
}
test('independent workers progress while a slow work holds its slot; same-work intents stay ordered', { timeout: 10000 }, async () => {
  const { ws, start, path } = await setup(), a = await start('slow');
  const release = Promise.withResolvers(), entered = Promise.withResolvers(), fastDone = Promise.withResolvers();
  const seen = [], host = { async run(job) { seen.push(job); if (job.id === 'slow') { entered.resolve(); await release.promise; } if (job.id === 'fast') fastDone.resolve(); return []; }, cancel() {} };
  const dispatch = createDispatcher({ workspace: ws, principal: 'owner', host, capacity: 2 });
  dispatch.wake(); await entered.promise;
  await ws.command('owner', { commandId: 'steer', kind: 'continue', workId: a.workId, expectedIntentRevision: 1, text: 'new intent', sourceIds: [] });
  const source = await ws.source('owner', { commandId: 'source', name: 'only fast', content: 'isolated', synthetic: true });
  await start('fast', [source.id]); dispatch.wake(); dispatch.wake(); await fastDone.promise;
  assert.deepEqual(seen.map(j => j.id), ['slow', 'fast']);
  assert.deepEqual(seen[0].sources, []); assert.equal(seen[1].sources[0].id, source.id);
  release.resolve(); await dispatch.idle();
  assert.deepEqual(seen.map(j => j.id), ['slow', 'fast', 'steer']);
  assert.equal(JSON.parse(await readFile(path)).jobs.slow.status, 'superseded');
  await dispatch.close();
});
test('claimed but unsent jobs recover; stale intents never claim; shutdown leaves interrupted state', async () => {
  const { ws, start } = await setup(); await start('claimed'); const job = await ws.claim('owner');
  await ws.recover('owner', async () => ({ exists: false, events: [], messages: [], uncertain: false }));
  assert.equal((await ws.claim('owner')).id, job.id);
  await ws.checkpoint('owner', job, 'execution_started');
  await ws.finish('owner', job, [], 'interrupted', 'service_stopped');
  assert.equal((await ws.get('owner', job.workId)).status, 'interrupted');
});
test('real DSH shutdown cancels active inference and retains a durable interrupted job', { timeout: 10000 }, async () => {
  const { root, ws, start, path } = await setup(); const started = await start('shutdown');
  const entered = Promise.withResolvers();
  class SlowProvider extends LocalProvider {
    async *stream(options) {
      entered.resolve();
      await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  const host = await bootHost({ stateRoot: root, workspace: ws, principal: 'owner', provider: new SlowProvider() });
  const dispatch = createDispatcher({ workspace: ws, principal: 'owner', host });
  try {
    dispatch.wake(); await entered.promise; await dispatch.close();
    assert.equal((await ws.get('owner', started.workId)).status, 'interrupted');
    assert.equal(JSON.parse(await readFile(path)).jobs.shutdown.requestIds.length, 1);
    await ws.recover('owner', host.inspect); assert.equal(await ws.claim('owner'), null);
  } finally { await host.close(); }
});
test('real DSH simultaneous works carry only their own sources and distinct native request bindings', { timeout: 10000 }, async () => {
  const { root, ws, start, path } = await setup();
  for (const name of ['first-secret', 'second-secret']) {
    const source = await ws.source('owner', { commandId: name, name, content: name, synthetic: true });
    await start(`work-${name}`, [source.id]);
  }
  const provider = new LocalProvider(), host = await bootHost({ stateRoot: root, workspace: ws, principal: 'owner', provider });
  const dispatch = createDispatcher({ workspace: ws, principal: 'owner', host });
  try {
    dispatch.wake(); await dispatch.idle(); assert.equal(provider.calls.length, 2);
    assert.notEqual(provider.calls[0].sessionId, provider.calls[1].sessionId);
    for (const call of provider.calls) { const body = JSON.stringify(call.messages); assert.notEqual(body.includes('first-secret'), body.includes('second-secret')); }
    const jobs = Object.values(JSON.parse(await readFile(path)).jobs);
    assert.equal(new Set(jobs.flatMap(j => j.requestIds)).size, 2); assert.ok(jobs.every(j => j.status === 'ready'));
  } finally { await dispatch.close(); await host.close(); }
});
for (const boundary of ['native_created', 'native_prompt', 'execution_started']) {
  test(`abrupt subprocess loss at ${boundary} reconciles the persisted native session`, { timeout: 15000 }, async () => {
    const { spawn } = await import('node:child_process');
    const { root, ws, start, path } = await setup(); await start('crash');
    const child = spawn(process.execPath, [new URL('./support/crash-host.mjs', import.meta.url).pathname, root, boundary], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', b => { stderr += b; });
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 78, stderr);
    const before = JSON.parse(await readFile(path)).jobs.crash;
    const provider = new LocalProvider(), host = await bootHost({ stateRoot: root, workspace: ws, principal: 'owner', provider });
    try {
      const native = await host.inspect(before); assert.equal(native.exists, true);
      if (boundary === 'native_prompt') assert.ok(native.events.some(e => e.type === 'agent/inbox/spliced' && e.data.inserted.some(m => m.id === 'crash')));
      await ws.recover('owner', host.inspect); const recovered = await ws.claim('owner');
      if (boundary === 'execution_started') { assert.equal(recovered, null); assert.equal(provider.calls.length, 0); }
      else {
        assert.equal(recovered.sessionId, before.sessionId);
        await ws.finish('owner', recovered, await host.run(recovered), 'ready');
        assert.equal(provider.calls.length, 1);
        assert.equal((await host.inspect(before)).events.filter(e => e.type === 'user/message').length, 1);
      }
    } finally { await host.close(); }
  });
}
test('restart keeps cancellation uncertainty visible and never overwrites a newer queued intent', async () => {
  const { ws, start } = await setup(); const { workId } = await start('old'); const old = await ws.claim('owner');
  await ws.checkpoint('owner', old, 'execution_started');
  await ws.command('owner', { commandId: 'cancel-old', kind: 'cancel', workId, expectedIntentRevision: 1, sourceIds: [] });
  assert.equal((await ws.get('owner', workId)).status, 'cancellation_requested');
  await ws.recover('owner', async () => ({ exists: true, uncertain: true, messages: [] }));
  assert.equal((await ws.get('owner', workId)).status, 'interrupted'); assert.equal(await ws.claim('owner'), null);
  await ws.command('owner', { commandId: 'explicit-next', kind: 'continue', workId, expectedIntentRevision: 2, sourceIds: [], text: 'Explicit new request' });
  const next = await ws.claim('owner'); await ws.checkpoint('owner', next, 'execution_started');
  await ws.command('owner', { commandId: 'newer', kind: 'continue', workId, expectedIntentRevision: 3, sourceIds: [], text: 'Latest request' });
  await ws.recover('owner', async () => ({ exists: true, uncertain: true, messages: [] }));
  assert.equal((await ws.get('owner', workId)).status, 'queued'); assert.equal((await ws.claim('owner')).id, 'newer');
});
test('completed native contribution plus lost product finish preserves cancellation and receipt uncertainty', async () => {
  const { ws, start } = await setup(); const { workId } = await start('complete-before-cancel');
  const job = await ws.claim('owner');
  await ws.checkpoint('owner', job, 'execution_started', { requestId: `${job.sessionId}:step:1` });
  await ws.checkpoint('owner', job, 'completed', { messages: [{ id: 'retained-result', role: 'assistant', text: 'Saved contribution' }] });
  await ws.command('owner', { commandId: 'cancel-completed', kind: 'cancel', workId, expectedIntentRevision: 1, sourceIds: [] });
  await ws.recover('owner', async () => ({ uncertain: true, messages: [] }));
  const work = await ws.get('owner', workId);
  assert.equal(work.status, 'stopped'); assert.equal(work.errorCode, 'cancelled_check_receipt');
  assert.equal(work.messages.filter(m => m.id === 'retained-result').length, 1); assert.equal(await ws.claim('owner'), null);
});
