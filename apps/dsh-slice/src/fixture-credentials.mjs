import { CredentialProvider } from '@deepseek-ai/dsh-credentials';

// The connection service needs its own random local browser-session grant.
// This adapter never reads environment variables, files or provider secrets.
export default class FixtureCredentials extends CredentialProvider {
  records = new Map();
  pending = Promise.resolve();
  async resolve() { return undefined; }
  async describe() { return { configured: false, writable: false }; }
  async set() { throw new Error('Provider credentials are disabled in this fixture'); }
  async unset() {}
  async readRecord(key) { return structuredClone(this.records.get(key)); }
  async describeRecord(key) {
    const value = this.records.get(key);
    return { configured: !!value, writable: key === 'client-connection/browser-session', ...(value ? { kind: value.kind } : {}) };
  }
  async listRecords() { return [...this.records].map(([key, value]) => ({ key, kind: value.kind })); }
  modifyRecord(key, mutate) {
    if (key !== 'client-connection/browser-session') throw new Error(`Fixture credential record forbidden: ${key}`);
    const operation = this.pending.then(async () => {
      const value = await mutate(structuredClone(this.records.get(key)));
      if (value !== undefined) this.records.set(key, structuredClone(value));
      return structuredClone(this.records.get(key));
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }
  async deleteRecord(key) { await this.pending; this.records.delete(key); }
}
