import { ApiError } from './resume.ts';
export type Pending = { workId: string; key: string; path: string; input: Record<string, unknown> };
// Scoped to a work, persisted before sending. Navigation/reload cannot turn a lost
// acknowledgement into a second source or responsibility.
export class MaintenanceActions {
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  private workId: string;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, workId: string) { this.storage = storage; this.workId = workId; }
  private get storageKey() { return `workagent-maintenance:${this.workId}:pending`; }
  read(): Pending | null {
    const raw = this.storage.getItem(this.storageKey);
    // Older persisted requests have the same work-scoped key and exact payload.
    return raw ? { ...JSON.parse(raw), workId: this.workId } : null;
  }
  prepare(key: string, path: string, input: Record<string, unknown>, makeId: () => string): Pending {
    const prior = this.read();
    if (prior) {
      if (prior.key !== key || prior.path !== path) throw new Error('Retry the unresolved maintenance action first. Its original values are retained.');
      return prior;
    }
    const next = { workId: this.workId, key, path, input: { ...input, commandId: makeId() } };
    this.storage.setItem(this.storageKey, JSON.stringify(next)); return next;
  }
  private matches(submitted: Pending) {
    const current = this.read();
    return submitted.workId === this.workId && current?.path === submitted.path && current?.key === submitted.key
      && current?.input.commandId === submitted.input.commandId;
  }
  accepted(submitted: Pending) { if (this.matches(submitted)) this.storage.removeItem(this.storageKey); }
  rejected(error: unknown, submitted: Pending) {
    if (!(error instanceof ApiError) || error.path !== submitted.path) return false;
    // Validation cannot have committed; these conflicts are checked after dedup.
    // Publication dedup precedes source revocation, so this exact 409 also proves
    // noncommit. Access denial and command conflicts still retain the identity.
    const revokedPublication = submitted.path === '/owned-sources' && typeof submitted.input.sourceId === 'string' && error.code === 'source_revoked';
    if (error.status === 400 || error.status === 409 && (revokedPublication || ['save_conflict', 'source_conflict', 'responsibility_conflict', 'cell_already_bound', 'source_field_unavailable', 'responsibility_ended'].includes(error.code))) {
      this.accepted(submitted); return true;
    }
    return false;
  }
}
