import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootHost } from '../src/host.mjs';
import { OpenRouterAccounting } from '../src/provider-accounting.mjs';
import { OpenRouterProvider } from '../src/provider.mjs';
import { createDispatcher } from '../src/dispatch.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
const policy = { version: 2, pricingBasis: 'openrouter-text-context-v1', inputTokenCeiling: 1000000, completionTokenCeiling: 1000000, route: 'typesafe/jev-router', maxRequestBytes: 1000000, maxOutputTokens: 4096, provider: { max_price: { prompt: 1, completion: 5, request: 0, image: 0 }, allow_fallbacks: false, require_parameters: true } };
// Synthetic values only. This reproduces the live protocol's read -> reasoning-only length finish.
for (const [finish, edit, visible = false] of [['length', false], ['length', true], ['stop', false], ['stop', true, true]]) test(`actual DSH/wire: ${finish}, prior edit ${edit}, visible ${visible} preserves outcome and charges`, { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'workagent-outcome-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const start = await workspace.command('owner', { commandId: 'start', kind: 'start', text: 'Synthetic output fixture', sourceIds: [] });
  let calls = 0; const receipts = [];
  let accounting = { async policy() { return { policy, policyHash: 'a'.repeat(64) }; }, async reserve(r) { return { ...r, durable: true, reservationId: `fixture-${calls}` }; }, async dispatch() { return { dispatched: true }; }, async retain(r) { receipts.push(r); return { retained: true }; } };
  const fetchImpl = async (url, request) => {
    if (url.endsWith('/key')) return Response.json({ data: { limit: 100, limit_remaining: 40, limit_reset: null, usage: 60 } });
    assert.equal(JSON.parse(request.body).max_tokens, edit ? 32768 : 4096);
    assert.equal(JSON.parse(request.body).reasoning.effort, 'high');
    const n = ++calls, tool = n === 1 ? ['read_sheet', '{}'] : edit && n === 2 ? ['edit_sheet', JSON.stringify({ patch: JSON.stringify({ cells: [{ sheetId: 'sheet1', row: 0, column: 0, value: 42 }] }) })] : null;
    const delta = tool ? { ...(n === 2 ? { content: 'Saving a partial result.' } : {}), tool_calls: [{ index: 0, id: `fixture-tool-${n}`, function: { name: tool[0], arguments: tool[1] } }] } : visible ? { content: 'Synthetic completed result.' } : { reasoning: 'Synthetic reasoning only.' };
    const frames = [{ id: `synthetic-generation-${n}`, model: 'synthetic/reasoning', choices: [{ index: 0, delta, finish_reason: tool ? 'tool_calls' : finish, native_finish_reason: tool ? 'tool_calls' : finish === 'length' ? 'max_tokens' : 'stop' }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: tool ? 12 : 4096, completion_tokens_details: { reasoning_tokens: tool ? 0 : 4094 }, cost: 0.002 } }];
    return new Response(frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  if (edit) {
    const rows = [];
    accounting = new OpenRouterAccounting({ apiKey: 'synthetic', fetchImpl, journal: { async transaction(id, fn) { return fn(rows.filter(r => r.id === id), async (kind, data) => rows.push({ id, kind, data: structuredClone(data) })); } } });
    const retain = accounting.retain.bind(accounting); accounting.retain = async r => { receipts.push(r); return retain(r); };
  }
  const provider = new OpenRouterProvider({ accounting, apiKey: 'synthetic', fetchImpl });
  const host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider, reasoningEffort: 'high' });
  const dispatcher = createDispatcher({ workspace, principal: 'owner', host });
  try {
    dispatcher.wake(); await dispatcher.idle();
    const w = await workspace.get('owner', start.workId);
    assert.equal(w.status, visible ? 'ready' : 'incomplete');
    assert.equal(w.errorCode, visible ? undefined : finish === 'length' ? 'output_limit_reached' : 'empty_model_response');
    assert.equal(calls, edit ? 3 : 2, 'no automatic retry');
    assert.equal(receipts.length, calls); assert.ok(receipts.every(r => r.terminal && r.outcome === 'received' && r.usage.cost === 0.002));
    if (edit) { assert.equal(w.book.sheets.sheet1.cellData[0][0].v, 42); assert.ok(w.messages.some(m => m.text === 'Saving a partial result.')); }
    const state = JSON.parse(await readFile(path, 'utf8')), job = Object.values(state.jobs)[0];
    assert.equal(job.phase, visible ? 'completed' : 'incomplete');
    const native = await host.inspect(job);
    assert.equal(native.outcome.status, visible ? 'ready' : 'incomplete');
    // Simulate loss between the host terminal checkpoint and dispatcher finish.
    state.jobs[job.id].status = 'running'; state.works[start.workId].status = 'working';
    await writeFile(path, JSON.stringify(state));
    await workspace.recover('owner', host.inspect);
    assert.equal((await workspace.get('owner', start.workId)).status, visible ? 'ready' : 'incomplete');
    assert.equal(await workspace.claim('owner'), null);
  } finally { await dispatcher.close(); await host.close(); }
});

test('real DSH provider denial reaches a blocked workspace without retry', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'workagent-denial-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const start = await workspace.command('owner', { commandId: 'start', kind: 'start', text: 'Synthetic denial fixture', sourceIds: [] });
  let attempts = 0;
  const provider = new OpenRouterProvider({ apiKey: 'synthetic', accounting: { async policy() { attempts++; throw new Error('provider_budget_exhausted'); } } });
  const host = await bootHost({ stateRoot: root, workspace, principal: 'owner', provider });
  const dispatcher = createDispatcher({ workspace, principal: 'owner', host });
  try {
    dispatcher.wake(); await dispatcher.idle();
    const w = await workspace.get('owner', start.workId);
    assert.equal(w.status, 'blocked'); assert.equal(w.errorCode, 'provider_budget_exhausted'); assert.equal(attempts, 1);
  } finally { await dispatcher.close(); await host.close(); }
});
