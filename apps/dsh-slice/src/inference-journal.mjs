import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Fixture gateway facts are durable independently of assistant completion.
// Values are synthetic usage, never actual billing or product-ledger entries.
export class FixtureInferenceJournal {
  constructor(root) { this.path = join(root, 'inference.jsonl'); this.records = []; this.pending = Promise.resolve(); }
  async load() {
    try { this.records = (await readFile(this.path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  record(value) {
    const task = this.pending.then(async () => {
      const record = { ...value, fixture: true, actualCostUsd: 0 };
      const file = await open(this.path, 'a', 0o600);
      try { await file.writeFile(JSON.stringify(record) + '\n'); await file.sync(); }
      finally { await file.close(); }
      this.records.push(record);
      return record;
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }
  async accepted({ sessionId, provider, model, responseId, purpose }) {
    return this.record({ kind: 'accepted', purpose: purpose ?? (sessionId ? 'agent' : 'auxiliary'), sessionId: sessionId ?? null, provider, model, responseId });
  }
}
