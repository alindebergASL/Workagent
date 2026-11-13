import { actionWasRejected, type Pending } from './maintenance-actions.ts';

export type Payload = { id: string; raw: string };
export type PayloadSlot = { value: Payload | null; retired: string[] };
// The callback is synchronous and runs inside the read/write transaction. Its
// result is released only on transaction completion, never on request success.
export interface PayloadTransactions {
  change<T>(key: string, update: (slot: PayloadSlot) => T): Promise<T>;
  changeMany<T>(keys: string[], update: (slots: PayloadSlot[]) => T): Promise<T>;
}
export class IndexedPayloadTransactions implements PayloadTransactions {
  private database?: Promise<IDBDatabase>;
  private factory: () => IDBFactory;
  constructor(factory: () => IDBFactory = () => indexedDB) { this.factory = factory; }
  private open() {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory().open('workagent-artifacts', 1);
        let failed = false;
        request.onupgradeneeded = () => { request.result.createObjectStore('payloads'); };
        request.onerror = () => reject(request.error ?? new Error('Browser storage could not open.'));
        request.onblocked = () => { failed = true; reject(new Error('Browser storage is blocked. Close older Workagent tabs and retry.')); };
        request.onsuccess = () => {
          const db = request.result;
          if (failed) { db.close(); return; }
          db.onversionchange = () => { db.close(); this.database = undefined; };
          db.onclose = () => { this.database = undefined; };
          resolve(db);
        };
      }).catch(error => { this.database = undefined; throw error; });
    }
    return this.database;
  }
  change<T>(key: string, update: (slot: PayloadSlot) => T): Promise<T> {
    return this.changeMany([key], slots => update(slots[0]));
  }
  async changeMany<T>(keys: string[], update: (slots: PayloadSlot[]) => T): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('payloads', 'readwrite', { durability: 'strict' });
      let result: T, failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Browser storage transaction aborted.'));
      transaction.onerror = () => { failure ??= transaction.error; };
      const store = transaction.objectStore('payloads'), slots: PayloadSlot[] = [];
      let remaining = keys.length;
      keys.forEach((key, index) => {
        const request = store.get(key);
        request.onsuccess = () => {
          slots[index] = request.result ?? { value: null, retired: [] };
          if (--remaining) return;
          try {
            result = update(slots);
            slots.forEach((slot, i) => store.put(slot, keys[i]));
          } catch (error) { failure = error; transaction.abort(); }
        };
      });
    });
  }
}

const matches = (a: Payload | null, b: Payload) => a?.id === b.id && a.raw === b.raw;
const payload = (raw: string): Payload => ({ id: crypto.randomUUID(), raw });
const fingerprint = async (raw: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, '0')).join('');
export type SaveAttempt = { record: Payload; request: Pending };

// Only native artifact drafts, recovery copies and Save retries use this store.
// Composer and small maintenance actions keep their existing storage contract.
export class ArtifactStorage {
  private legacy: Pick<Storage, 'getItem' | 'removeItem'>;
  private transactions: PayloadTransactions;
  constructor(legacy: Pick<Storage, 'getItem' | 'removeItem'>, transactions: PayloadTransactions = new IndexedPayloadTransactions()) { this.legacy = legacy; this.transactions = transactions; }
  private change<T>(key: string, legacyKey: string | null, update: (slot: PayloadSlot) => T): Promise<T> {
    return this.changeMany([key], [legacyKey], slots => update(slots[0]));
  }
  private async changeMany<T>(keys: string[], legacyKeys: (string | null)[], update: (slots: PayloadSlot[]) => T): Promise<T> {
    try {
      const records = await Promise.all(legacyKeys.map(async key => {
        const raw = key ? this.legacy.getItem(key) : null;
        return { key, raw, digest: raw === null ? null : await fingerprint(raw) };
      }));
      const result = await this.transactions.changeMany(keys, slots => {
        records.forEach(({ raw, digest }, index) => {
          const slot = slots[index];
          if (raw !== null && digest !== null && !slot.retired.includes(digest)) {
            // Do not replace an unresolved request or an independent draft from
            // another tab. Keep both and require recovery from the owning tab.
            if (slot.value && slot.value.raw !== raw) throw new Error('legacy_artifact_conflict');
            slot.value ??= payload(raw);
            slot.retired.push(digest);
          }
        });
        return update(slots);
      });
      // The digest remains even after settlement: failed removal or a delayed
      // legacy reader cannot resurrect a settled Save or discarded draft.
      for (const { key, raw } of records) if (key && raw !== null) {
        try { if (this.legacy.getItem(key) === raw) this.legacy.removeItem(key); } catch { /* Durable adoption is already complete. */ }
      }
      return result;
    } catch (error) {
      if (error instanceof Error && ['legacy_artifact_conflict', 'invalid_pending_save'].includes(error.message)) throw error;
      throw new Error('artifact_storage_unavailable', { cause: error });
    }
  }
  readDraft(workId: string) { return this.change(`draft:${workId}`, `workagent-draft:${workId}`, slot => slot.value); }
  writeDraft(workId: string, raw: string) {
    return this.change(`draft:${workId}`, `workagent-draft:${workId}`, slot => (slot.value = payload(raw)));
  }
  replaceDraft(workId: string, owned: Payload | null, raw: string | null) {
    return this.change(`draft:${workId}`, `workagent-draft:${workId}`, slot => {
      if (owned ? !matches(slot.value, owned) : slot.value !== null) return { matched: false, value: null };
      slot.value = raw === null ? null : payload(raw);
      return { matched: true, value: slot.value };
    });
  }
  archive(workId: string, raw: string) {
    return this.change(`recovery:${workId}:${crypto.randomUUID()}`, null, slot => { slot.value = payload(raw); });
  }
  private attempt(workId: string, record: Payload): SaveAttempt {
    let request: Pending;
    try { request = JSON.parse(record.raw); } catch { throw new Error('invalid_pending_save'); }
    if (request?.key !== 'save' || request.path !== `/work/${workId}/save` || !request.input || typeof request.input.commandId !== 'string'
      || !request.input.commandId || !Number.isInteger(request.input.contentRevision) || !Number.isInteger(request.input.permissionRevision)
      || ((request.input.book as { id?: string } | undefined)?.id !== workId && (request.input.document as { id?: string } | undefined)?.id !== workId) || (request.workId !== undefined && request.workId !== `sheet-save:${workId}`)) throw new Error('invalid_pending_save');
    return { record, request: { ...request, workId: `sheet-save:${workId}` } };
  }
  readSave(workId: string) {
    return this.change(`save:${workId}`, `workagent-maintenance:sheet-save:${workId}:pending`, slot => slot.value ? this.attempt(workId, slot.value) : null);
  }
  prepareSave(workId: string, input: Record<string, unknown>, makeId: () => string): Promise<SaveAttempt> {
    return this.change(`save:${workId}`, `workagent-maintenance:sheet-save:${workId}:pending`, slot => {
      if (!slot.value) slot.value = payload(JSON.stringify({ workId: `sheet-save:${workId}`, key: 'save', path: `/work/${workId}/save`, input: { ...input, commandId: makeId() } }));
      return this.attempt(workId, slot.value);
    });
  }
  settleSave(workId: string, submitted: SaveAttempt, owned: Payload | null, raw: string | null) {
    return this.changeMany([`save:${workId}`, `draft:${workId}`], [`workagent-maintenance:sheet-save:${workId}:pending`, `workagent-draft:${workId}`], ([save, draft]) => {
      if (submitted.request.workId !== `sheet-save:${workId}` || submitted.request.path !== `/work/${workId}/save`
        || (save.value && !matches(save.value, submitted.record))) return { accepted: false, matched: false, value: null };
      // A foreign recovery payload must keep its original retry available until
      // its owner can rebase it. Neither half of settlement may commit alone.
      if (owned ? !matches(draft.value, owned) : draft.value !== null) return { accepted: true, matched: false, value: null };
      draft.value = raw === null ? null : payload(raw);
      save.value = null;
      return { accepted: true, matched: true, value: draft.value };
    });
  }
  accepted(workId: string, submitted: SaveAttempt) {
    if (submitted.request.workId !== `sheet-save:${workId}` || submitted.request.path !== `/work/${workId}/save`) return Promise.resolve(false);
    return this.change(`save:${workId}`, `workagent-maintenance:sheet-save:${workId}:pending`, slot => {
      if (slot.value && !matches(slot.value, submitted.record)) return false;
      slot.value = null; return true;
    });
  }
  async rejected(workId: string, error: unknown, submitted: SaveAttempt) {
    if (actionWasRejected(error, submitted.request)) await this.accepted(workId, submitted);
  }
}
