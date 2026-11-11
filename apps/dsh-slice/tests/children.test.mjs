import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bootHost } from '../src/host.mjs';

const base = fileURLToPath(new URL('../../../.local/dsh-slice/state/', import.meta.url));
test('one workshop uses concurrent real children and applies user steering at their next steps', { timeout: 20000 }, async () => {
  const gate = Promise.withResolvers();
  const bothEntered = Promise.withResolvers();
  const childIds = new Set();
  const stateRoot = await mkdtemp(`${base}children-`);
  const signal = AbortSignal.timeout(15000);
  const host = await bootHost({ stateRoot, concurrentWorkers: true, beforeFixtureStream: async (request, streamSignal) => {
    const worker = request.messages.some(message => message.role === 'user' && message.content.some(block => block.type === 'text' && block.text.startsWith('Inspect fictional venue:')));
    if (worker && !request.messages.some(message => message.role === 'tool')) {
      childIds.add(request.sessionId);
      if (childIds.size === 2) bothEntered.resolve();
      await Promise.race([gate.promise, new Promise((_, reject) => streamSignal.addEventListener('abort', () => reject(streamSignal.reason), { once: true }))]);
    }
  } });
  try {
    const { sessionId } = await host.controller.create({ cwd: host.workDir });
    await host.controller.prompt({ sessionId, requestId: 'compare-with-workers', mode: 'queue', content: [{ type: 'text', text: 'Compare the fictional workshop venues for 16 attendees.' }] }, signal);
    await Promise.race([bothEntered.promise, new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))]);
    assert.equal(childIds.size, 2);
    for (const childId of childIds) assert.equal(host.ctx.agents.get(childId).status, 'running');
    const receipts = await Promise.all([...childIds].map((childSessionId, i) => host.ctx.subagents.prompt({
      parentSessionId: sessionId, childSessionId, mode: 'continuable', requestId: `constraint-2-${i}`, delivery: 'steer',
      content: [{ type: 'text', text: 'Updated user constraint: budget ceiling 74000 cents.' }],
    }, signal)));
    assert.ok(receipts.every(receipt => receipt.messageId));
    gate.resolve();
    const stopped = await host.controller.wait({ sessionId, timeoutMs: 10000 }, signal);
    assert.equal(stopped.reason, 'idle');
    assert.deepEqual(host.errors, []);
    assert.equal(host.provider.requests.length, 6);
    assert.equal(host.toolCalls.length, 2);
    const catalog = await host.ctx.subagents.listChildren(sessionId, signal);
    assert.equal(catalog.length, 2);
    for (const childSessionId of childIds) {
      const page = await host.controller.events({ address: { kind: 'subagent', parentSessionId: sessionId, childSessionId, mode: 'continuable' }, maxMessages: 100 }, signal);
      assert.ok(page.records.some(record => record.event.type === 'user/message' && JSON.stringify(record.event.data).includes('budget ceiling 74000 cents')));
      const dispatched = host.provider.requests.filter(request => request.sessionId === childSessionId);
      assert.equal(dispatched.length, 2);
      assert.match(JSON.stringify(dispatched[1].messages), /budget ceiling 74000 cents/);
    }
    const page = await host.controller.events({ address: { kind: 'session', sessionId }, maxMessages: 100 }, signal);
    const result = page.records.find(record => record.event.type === 'tool/result').event.data.message;
    const comparison = JSON.parse(result.content.find(block => block.type === 'text').text);
    assert.deepEqual(comparison.alternatives.map(venue => venue.budgetCeilingCents), [74000, 74000]);
    assert.ok(comparison.alternatives.every(venue => venue.constraintApplied));
    console.log('real DSH children: two live workers overlapped; both user steer receipts retained and applied in next provider requests');
  } finally { gate.resolve(); await host.close(); }
});
