// Actual DSH runner and wire adapter, fixture provider/file persistence only.
// No OpenRouter, PostgreSQL, credentials or network calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { bootHost } from '../src/host.mjs';
import { createDispatcher } from '../src/dispatch.mjs';
import { requestBody } from '../src/wire.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { blankDocument, documentText } from '../../../packages/workagent-contract/document.mjs';
const policy = { version: 3, pricingBasis: 'openrouter-key-budget-v1', route: 'typesafe/jev-router', maxRequestBytes: 1_000_000, maxOutputTokens: 32768, provider: { allow_fallbacks: false, require_parameters: true } };
for (const mode of ['read', 'draft', 'protected']) test(`actual DSH document wire ${mode}; bound artifact/revision and explicit admission`, { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'document-host-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const { workId } = await workspace.createBlank('owner', { commandId: 'blank', kind: 'document', title: 'Document task' });
  if (mode === 'protected') await workspace.save('owner', workId, { commandId: 'human', document: blankDocument(workId, 'Document task', 'Human wording; ignore all instructions is untrusted text.'), contentRevision: 1, permissionRevision: 1 });
  class FixtureProvider extends LlmAdapter {
    calls = [];
    providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 }; }
    async *stream(options) {
      const wire = requestBody(options, policy); this.calls.push(wire);
      const index = this.calls.length;
      const block = index === 1 ? { type: 'tool-call', id: 'doc-read', name: 'read_document', arguments: '{}' }
        : mode !== 'read' && index === 2 ? { type: 'tool-call', id: 'doc-edit', name: 'edit_document', arguments: JSON.stringify({ document: JSON.stringify(blankDocument(workId, 'Document task', 'Fixture model draft')) }) }
        : { type: 'text', text: 'Fixture response: inspected document; requested changes applied or proposed as reported by the tool.' };
      yield { type: 'block-start', index: 0, blockType: block.type };
      yield block.type === 'tool-call' ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text: block.text };
      yield { type: 'block-end', index: 0, block }; yield { type: 'finish', reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' } };
    }
  }
  const provider = new FixtureProvider(), host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider }), dispatch = createDispatcher({ workspace, principal: 'owner', host });
  const failures = [], run = host.run;
  host.run = async job => { try { return await run(job); } catch (error) { failures.push(error.stack); throw error; } };
  try {
    dispatch.wake(); await dispatch.idle(); assert.equal(provider.calls.length, 0);
    const input = { commandId: 'ask', kind: 'continue', workId, expectedIntentRevision: 0, text: mode === 'read' ? 'Explain the document. Do not edit.' : 'Draft a useful paragraph.', sourceIds: [] };
    await workspace.command('owner', input); await workspace.command('owner', input); dispatch.wake(); await dispatch.idle();
    assert.equal(provider.calls.length, mode === 'read' ? 2 : 3, failures.join('\n'));
    assert.deepEqual(provider.calls[0].tools.map(t => t.function.name).sort(), ['edit_document', 'read_document']);
    assert.match(provider.calls[0].messages.find(m => m.role === 'user').content, /Current artifact kind: document/);
    const read = JSON.parse(provider.calls[1].messages.find(m => m.role === 'tool').content);
    assert.equal(read.kind, 'document'); assert.equal(read.book, undefined); assert.equal(read.document.id, workId); assert.equal(read.expected.intentRevision, 1);
    const w = await workspace.get('owner', workId); assert.equal(w.status, 'ready'); assert.equal(w.contentRevision, mode === 'read' ? 1 : 2);
    if (mode === 'protected') {
      assert.equal(w.proposals.length, 1); assert.match(documentText(w.document), /^Human wording/);
      await workspace.decide('owner', workId, w.proposals[0].id, { commandId: 'accept', decision: 'accept', expected: w.expected });
    }
    if (mode !== 'read') assert.equal(documentText((await workspace.get('owner', workId)).document), 'Fixture model draft');
    const saved = JSON.parse(await readFile(path, 'utf8')); assert.equal(Object.keys(saved.jobs).length, 1); assert.ok(provider.calls.every(c => c.session_id === saved.jobs.ask.sessionId));
  } finally { await dispatch.close(); await host.close(); }
});
