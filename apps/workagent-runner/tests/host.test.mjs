// Bounded fixture mechanism test using actual public DSH. Requires local install.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { bootHost } from '../src/host.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
class MechanismProvider extends LlmAdapter {
  count = 0;
  providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }; }
  async *stream() {
    const index = ++this.count;
    const block = index === 1 ? { type: 'tool-call', id: 'native-read-id', name: 'read_sheet', arguments: '{}' } : index === 2 ? { type: 'tool-call', id: 'native-edit-id', name: 'edit_sheet', arguments: JSON.stringify({ patch: JSON.stringify({ cells: [{ sheetId: 'sheet1', row: 0, column: 0, value: 6 }, { sheetId: 'sheet1', row: 1, column: 0, value: null, formula: '=A1*2' }] }) }) } : { type: 'text', text: 'The fixture has written a native workbook value and formula.' };
    yield { type: 'block-start', index: 0, blockType: block.type };
    yield block.type === 'tool-call' ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text: block.text };
    yield { type: 'block-end', index: 0, block };
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: 'finish', reason: { kind: index < 3 ? 'tool-calls' : 'stop' }, replayState: { response: { fixture: true, nativeResponseId: `response-${index}` } } };
  }
}
test('real DSH mechanism fixture: native tool loop writes durable sheet data and retains session', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'workagent-dsh-fixture-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const started = await workspace.command('owner', { commandId: 'brief', kind: 'start', text: 'Exercise synthetic cell editing', sourceIds: [] });
  const job = await workspace.claim('owner'), provider = new MechanismProvider();
  const host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider });
  try {
    const messages = await host.run(job); assert.equal(provider.count, 3); assert.match(messages[0].text, /fixture/);
    const w = await workspace.get('owner', started.workId); assert.equal(w.book.sheets.sheet1.cellData[0][0].v, 6); assert.equal(w.book.sheets.sheet1.cellData[1][0].f, '=A1*2');
    assert.ok((await readdir(join(root, 'sessions'))).length > 0);
  } finally { await host.close(); }
});
test('real DSH cancellation: only a newer admitted intent interrupts, and normal return finishes stopped', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'workagent-dsh-cancel-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const start = await workspace.command('owner', { commandId: 'start', kind: 'start', text: 'Cancellation fixture', sourceIds: [] });
  const job = await workspace.claim('owner'), entered = Promise.withResolvers(), release = Promise.withResolvers();
  class PausedProvider extends MechanismProvider {
    async *stream(options) {
      entered.resolve(options.signal);
      try { await release.promise; options.signal.throwIfAborted(); yield { type: 'finish', reason: { kind: 'stop' } }; }
      finally { this.closed = true; }
    }
  }
  const provider = new PausedProvider(), host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider });
  try {
    const running = host.run(job), signal = await entered.promise;
    host.cancel(start.workId, job.expected.intentRevision);
    assert.equal(signal.aborted, false, 'a delayed callback cannot cancel its own or newer intent');
    host.cancel('other-work', job.expected.intentRevision + 1);
    assert.equal(signal.aborted, false);
    const cancel = await workspace.command('owner', { commandId: 'cancel', kind: 'cancel', workId: start.workId, expectedIntentRevision: start.intentRevision, sourceIds: [] });
    host.cancel(start.workId, cancel.intentRevision);
    assert.equal(signal.aborted, true);
    release.resolve();
    const messages = await running; // Actual DSH cancellation can return without agent/error.
    await workspace.finish('owner', job, messages, 'ready');
    assert.equal(provider.closed, true);
    assert.equal((await workspace.get('owner', start.workId)).status, 'stopped');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).jobs[job.id].status, 'stopped');
    assert.equal(await workspace.claim('owner'), null);
  } finally { release.resolve(); await host.close(); }
});
