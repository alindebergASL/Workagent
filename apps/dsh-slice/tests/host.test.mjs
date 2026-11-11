import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bootHost } from '../src/host.mjs';
import { FIXTURE_USAGE, replayFor, PROVIDER, MODEL } from '../src/fixture-provider.mjs';

const stateBase = fileURLToPath(new URL('../../../.local/dsh-slice/state/', import.meta.url));

test('real DSH controller runs fixture tool and retains exact response facts across host restart', { timeout: 20000 }, async () => {
  const stateRoot = await mkdtemp(`${stateBase}host-`);
  let host = await bootHost({ stateRoot });
  const abort = new AbortController();
  let follow;
  try {
    assert.equal(await host.ctx.credentials.resolve('OPENAI_API_KEY'), undefined);
    const { sessionId } = await host.controller.create({ cwd: host.workDir });
    const address = { kind: 'session', sessionId };
    follow = host.controller.follow({ address, assistantStream: true }, abort.signal)[Symbol.asyncIterator]();
    const opening = await follow.next();
    assert.equal(opening.value.type, 'snapshot');
    const frames = [];
    const reading = (async () => {
      try { for await (const frame of { [Symbol.asyncIterator]: () => follow }) frames.push(frame); }
      catch (error) { if (!abort.signal.aborted) throw error; }
    })();
    await host.controller.prompt({ sessionId, requestId: 'fixture-first-prompt', mode: 'queue', content: [{ type: 'text', text: 'Compare fictional workshop venues and calculate the budget for 16 people.' }] }, abort.signal);
    const stopped = await host.controller.wait({ sessionId, maxMessages: 100, timeoutMs: 10000 }, abort.signal);
    assert.equal(stopped.reason, 'idle', JSON.stringify(stopped));
    assert.deepEqual(host.errors, []);
    assert.equal(host.provider.requests.length, 2);
    assert.equal(host.toolCalls.length, 1);
    assert.deepEqual(host.toolCalls[0].alternatives.map(x => x.totalCents), [76800, 71200]);
    await host.ctx.sessions.flush(host.ctx.agents.get(sessionId).session);
    const livePage = await host.controller.events({ address, maxMessages: 100 }, abort.signal);
    const events = livePage.records.map(record => record.event);
    const messages = events.filter(event => event.type === 'assistant/message');
    assert.equal(messages.length, 2);
    for (const [index, event] of messages.entries()) {
      assert.deepEqual(event.data.message.source, { kind: 'model', provider: PROVIDER, model: MODEL, replayState: replayFor(host.provider.requests[index].id) });
      assert.deepEqual(event.data.usage, FIXTURE_USAGE);
    }
    assert.ok(events.some(event => event.type === 'tool/result'), events.map(e => e.type).join(','));
    assert.ok(frames.some(frame => frame.type === 'event' && frame.event.type === 'tool/result'));
    assert.ok((await readdir(`${stateRoot}/sessions`)).length > 0);
    abort.abort();
    await reading;
    await host.close();
    host = await bootHost({ stateRoot });
    const coldAbort = new AbortController();
    const coldPage = await host.controller.events({ address, maxMessages: 100 }, coldAbort.signal);
    assert.deepEqual(coldPage, livePage);
    const reopened = host.controller.follow({ address }, coldAbort.signal)[Symbol.asyncIterator]();
    const snapshot = await reopened.next();
    assert.equal(snapshot.value.type, 'snapshot');
    assert.equal(host.provider.requests.length, 0, 'cold reads must not trigger inference');
    coldAbort.abort();
    await reopened.return();
    console.log(`real DSH: ${events.length} durable events; 2 scripted responses; 1 real CSV tool call; cold read and follow restored`);
  } finally {
    abort.abort();
    if (follow) await follow.return();
    await host.close();
  }
});
