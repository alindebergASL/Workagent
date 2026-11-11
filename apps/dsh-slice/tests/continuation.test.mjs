import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { bootHost } from '../src/host.mjs';
import { Responsibility } from '../src/responsibility.mjs';
import { PROVIDER, MODEL, FIXTURE_USAGE } from '../src/fixture-provider.mjs';

const base = fileURLToPath(new URL('../../../.local/dsh-slice/state/', import.meta.url));
test('DSH schedule survives restart, continues the responsibility, keeps human edits and accounts auxiliary fixture inference', { timeout: 20000 }, async () => {
  const root = await mkdtemp(`${base}continuation-`);
  let host = await bootHost({ stateRoot: root, concurrentWorkers: true });
  const signal = AbortSignal.timeout(15000);
  try {
    let work = await new Responsibility(host, join(root, 'product')).open();
    const started = await work.start();
    await host.controller.wait({ sessionId: started.sessionId, timeoutMs: 5000 }, signal);
    const humanText = 'Keep my own venue decision while the agent rechecks prices.';
    await work.edit({ text: humanText, version: work.state.version });
    const schedule = await host.ctx.schedule.create({ title: 'Recheck fictional workshop', prompt: 'Scheduled fixture follow-up: recheck venue costs.', timing: { kind: 'after', after_seconds: 2 }, target: { kind: 'session', sessionId: started.sessionId } }, started.sessionId, signal);
    await host.close();
    host = await bootHost({ stateRoot: root, concurrentWorkers: true });
    work = await new Responsibility(host, join(root, 'product')).open();
    let receipt;
    for (let i = 0; i < 60; i++) {
      const history = await host.ctx.schedule.history({ id: schedule.id, limit: 10 });
      if (JSON.stringify(history).includes('deliveredAt')) { receipt = history; break; }
      await delay(100, undefined, { signal });
    }
    assert.ok(receipt, 'persisted schedule must deliver');
    await host.controller.wait({ sessionId: started.sessionId, timeoutMs: 5000 }, signal);
    assert.equal((await work.view()).text, humanText);
    const events = await work.readEvents();
    assert.ok(events.some(event => event.type === 'user/message' && JSON.stringify(event.data).includes('Scheduled fixture follow-up')));
    assert.equal(host.provider.requests.length, 6, 'receipt alone does not prove continuation; parent and both children must run');
    for await (const chunk of host.ctx.llm.stream({ provider: PROVIDER, model: MODEL, messages: [], signal })) void chunk;
    const accepted = host.journal.records.filter(record => record.kind === 'accepted');
    const completed = host.journal.records.filter(record => record.kind === 'completed');
    assert.equal(accepted.length, 13);
    assert.equal(completed.length, 13);
    assert.equal(accepted.filter(record => record.purpose === 'auxiliary').length, 1);
    assert.ok(completed.every(record => JSON.stringify(record.usage) === JSON.stringify(FIXTURE_USAGE)));
    assert.equal(new Set(accepted.map(record => record.responseId)).size, 13);
    assert.ok(host.journal.records.every(record => record.actualCostUsd === 0 && record.fixture === true));
    console.log('real DSH continuation: persisted schedule delivered and executed after restart; human edit retained; 12 agent + 1 auxiliary scripted calls recorded');
  } finally { await host.close(); }
});
