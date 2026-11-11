import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { bootHost } from '../src/host.mjs';
import { Responsibility } from '../src/responsibility.mjs';

const base = fileURLToPath(new URL('../../../.local/dsh-slice/state/', import.meta.url));
test('saved product constraint steers both live DSH workers before a result becomes current', { timeout: 15000 }, async () => {
  const stateRoot = await mkdtemp(`${base}intent-`);
  const gate = Promise.withResolvers(); const ready = Promise.withResolvers();
  const workers = new Set();
  const host = await bootHost({ stateRoot, concurrentWorkers: true, beforeFixtureStream: async (request, signal) => {
    if (JSON.stringify(request.messages).includes('Inspect fictional venue:') && !request.messages.some(message => message.role === 'tool')) {
      workers.add(request.sessionId); if (workers.size === 2) ready.resolve();
      await Promise.race([gate.promise, new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))]);
    }
  } });
  try {
    const product = await new Responsibility(host, join(stateRoot, 'product')).open();
    const started = await product.start();
    await ready.promise;
    const steered = await product.steer({ budgetCents: 74000, version: product.state.version });
    assert.equal(steered.steeringReceipts.length, 2);
    assert.ok(steered.steeringReceipts.every(receipt => receipt.accepted));
    assert.equal(steered.constraintApplied, false, 'inbox receipts must not be labeled applied');
    gate.resolve();
    await host.controller.wait({ sessionId: started.sessionId, timeoutMs: 5000 }, new AbortController().signal);
    const result = await product.view();
    assert.equal(result.status, 'ready');
    assert.equal(result.constraintApplied, true);
    assert.deepEqual(result.budget.alternatives.map(item => item.constraintVersion), [2, 2]);
    assert.match(result.generatedText, /Recommend Garden Studio/);
    const decision = result.budget.decision;
    assert.equal(decision.providerMode, 'deterministic-fallback');
    assert.equal(decision.jevEnabled, false);
    const selected = result.budget.alternatives.find(candidate => candidate.candidateId === decision.selectedCandidateId);
    assert.equal(selected.venue, 'Garden Studio');
    assert.deepEqual(decision.ranking[0].sourceIds, selected.sourceIds);
    assert.deepEqual(selected.sourceIds, ['fixtures/venues.csv#L3']);
    await product.steer({ budgetCents: 70000, version: product.state.version });
    await host.controller.wait({ sessionId: started.sessionId, timeoutMs: 5000 }, new AbortController().signal);
    const belowBoth = await product.view();
    assert.equal(belowBoth.budget.decision.selectedCandidateId, null);
    assert.match(belowBoth.generatedText, /Neither option/);
    console.log('product steering: intent persisted; 2 real child receipts; result promoted only after both reported constraint version 2');
  } finally { gate.resolve(); await host.close(); }
});
