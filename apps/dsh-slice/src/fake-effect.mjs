import { readFile, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

// A deliberately fake connector. Its durable dispatch log is the only effect.
// The guard is outside the agent's writable directory and survives a lost ack.
export class FakeEffectConnector {
  constructor(root, { loseAcknowledgement = false, onDispatch } = {}) {
    this.file = join(root, 'fake-effects.json'); this.attemptFile = join(root, 'fake-effect-attempts.jsonl');
    this.loseAcknowledgement = loseAcknowledgement; this.onDispatch = onDispatch;
    this.pending = Promise.resolve(); this.effects = {};
  }
  async load() {
    try { this.effects = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  async persist(next) {
    const file = await open(`${this.file}.next`, 'w', 0o600);
    try { await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync(); }
    finally { await file.close(); }
    await rename(`${this.file}.next`, this.file);
    this.effects = next;
  }
  dispatch(effectId, signal) {
    const task = this.pending.then(async () => {
      if (effectId !== 'workshop-reservation-v1') throw new Error('Unknown fixture effect');
      if (this.effects[effectId]) return { ...this.effects[effectId], duplicateSuppressed: true };
      const unknown = { effectId, fixture: true, state: 'unknown', attempts: 1, message: 'Fake connector dispatch may have happened; acknowledgement is unavailable. Do not resend.' };
      await this.persist({ ...this.effects, [effectId]: unknown });
      signal.throwIfAborted();
      const attempts = await open(this.attemptFile, 'a', 0o600);
      try { await attempts.writeFile(JSON.stringify({ effectId, fixture: true, dispatchedAt: new Date().toISOString() }) + '\n'); await attempts.sync(); }
      finally { await attempts.close(); }
      await this.onDispatch?.(effectId);
      if (this.loseAcknowledgement) await new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      const completed = { ...unknown, state: 'completed', message: 'Fake connector acknowledged its local fixture dispatch.' };
      await this.persist({ ...this.effects, [effectId]: completed });
      return completed;
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }
}
export function registerFakeEffect(ctx, connector) {
  ctx.tools.register(defineTool({ name: 'reserve_fixture_venue', description: 'FAKE connector: records one fictional reservation attempt locally. Never contacts a venue.',
    parameters: { effectId: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, result) => [{ type: 'text', text: result }] },
    async execute({ effectId }, exec) { return JSON.stringify(await connector.dispatch(effectId, exec.signal)); },
  }));
}
