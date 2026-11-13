// Explicit asynchronous, serialized transaction fixture. This is NOT IndexedDB
// or browser quota proof. Production has no in-memory storage fallback.
import { ArtifactStorage } from '../src/artifact-storage.ts';
export class AsyncPayloadTransactions {
  rows = new Map();
  tail = Promise.resolve();
  before = async () => {};
  complete = async () => {};
  change(key, update) {
    return this.changeMany([key], slots => update(slots[0]));
  }
  changeMany(keys, update) {
    const operation = this.tail.catch(() => {}).then(async () => {
      for (const key of keys) await this.before(key);
      const slots = keys.map(key => structuredClone(this.rows.get(key) ?? { value: null, retired: [] }));
      const result = update(slots);
      for (let i = 0; i < keys.length; i++) await this.complete(keys[i], slots[i]);
      // Publish all staged keys only after every completion hook succeeds.
      keys.forEach((key, i) => this.rows.set(key, structuredClone(slots[i])));
      return result;
    });
    this.tail = operation; return operation;
  }
}
const fixtures = new WeakMap();
export function artifactFixture(storage) {
  if (!fixtures.has(storage)) fixtures.set(storage, new AsyncPayloadTransactions());
  return fixtures.get(storage);
}
export const artifactStore = storage => new ArtifactStorage(storage, artifactFixture(storage));
export class FixtureArtifactStorage extends ArtifactStorage {
  constructor(storage) { super(storage, artifactFixture(storage)); }
}
export const draftRaw = async (storage, workId) => (await artifactStore(storage).readDraft(workId))?.raw ?? null;
export const saveActions = (storage, workId) => ({ read: async () => (await artifactStore(storage).readSave(workId))?.request ?? null });
