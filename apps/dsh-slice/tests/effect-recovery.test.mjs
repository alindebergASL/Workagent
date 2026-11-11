import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { bootHost } from '../src/host.mjs';

const base = fileURLToPath(new URL('../../../.local/dsh-slice/state/', import.meta.url));
test('real DSH crash after fake effect dispatch preserves unknown and suppresses a second attempt', { timeout: 20000 }, async () => {
  const stateRoot = await mkdtemp(`${base}effect-`);
  const child = fork(fileURLToPath(new URL('./support/effect-worker.mjs', import.meta.url)), [stateRoot], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const exited = once(child, 'exit');
  let host;
  try {
    const message = await Promise.race([
      once(child, 'message', { signal: AbortSignal.timeout(10000) }).then(([value]) => value),
      exited.then(([code]) => { throw new Error(`Fixture worker exited early ${code}: ${output}`); }),
    ]);
    assert.equal(message.type, 'effect-dispatched');
    child.kill('SIGKILL'); await exited;
    host = await bootHost({ stateRoot, concurrentWorkers: true });
    assert.equal(host.fakeEffects.effects['workshop-reservation-v1'].state, 'unknown');
    const signal = AbortSignal.timeout(5000);
    await host.controller.prompt({ sessionId: message.sessionId, requestId: 'reconcile-after-crash', mode: 'queue', content: [{ type: 'text', text: 'Fixture effect: reconcile selected venue.' }] }, signal);
    await host.controller.wait({ sessionId: message.sessionId, timeoutMs: 5000 }, signal);
    const page = await host.controller.events({ address: { kind: 'session', sessionId: message.sessionId }, maxMessages: 100 }, signal);
    assert.match(JSON.stringify(page), /TOOL_OUTCOME_UNKNOWN/);
    assert.match(JSON.stringify(page), /duplicateSuppressed/);
    assert.equal(host.fakeEffects.effects['workshop-reservation-v1'].state, 'unknown');
    const attempts = (await readFile(`${stateRoot}/fake-effect-attempts.jsonl`, 'utf8')).trim().split('\n');
    assert.equal(attempts.length, 1);
    assert.equal(JSON.parse(attempts[0]).effectId, 'workshop-reservation-v1');
    console.log('real DSH recovery: killed owned worker after fake dispatch; repaired TOOL_OUTCOME_UNKNOWN; exactly one connector attempt after retry request');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    if (host) await host.close();
  }
});
