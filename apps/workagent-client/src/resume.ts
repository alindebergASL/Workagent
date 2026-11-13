import type { Work } from './types';
import type { SheetSelection } from './NativeEditor';
export type ProductBatch = { kind: 'reset' | 'events'; cursor: number; events: { eventId: number }[]; works: { id: string; title: string; status: string }[]; snapshots: Work[] };
// One committed product cursor, unrelated to DSH's native session log.
export class ProductCursor {
  after: number | undefined;
  private generation = 0;
  request() { return ++this.generation; }
  apply(ticket: number, batch: ProductBatch, apply: (batch: ProductBatch) => void | boolean) {
    if (ticket !== this.generation) return false;
    if (!Number.isSafeInteger(batch.cursor) || batch.cursor < 0) throw new Error('invalid_event_cursor');
    if (batch.kind === 'events' && (this.after === undefined || batch.cursor < this.after || batch.events.length !== batch.cursor - this.after || batch.events.some((e, i) => e.eventId !== this.after! + i + 1))) throw new Error('event_gap');
    if (batch.kind !== 'events' && batch.kind !== 'reset') throw new Error('invalid_event_batch');
    // A navigation fence can refuse the entire batch. Keep its cursor so the
    // next poll retries those snapshots instead of silently losing an update.
    if (apply(batch) === false) return false;
    this.after = batch.cursor; return true;
  }
}
export type SelectionAttachment = SheetSelection & { contentRevision: number };
export type ComposerDraft = { prompt: string; sourceName: string; sourceText: string; selection?: SelectionAttachment };
export class ApiError extends Error {
  readonly path: string;
  readonly status: number;
  readonly code: string;
  constructor(path: string, status: number, code: string) {
    super(code); this.path = path; this.status = status; this.code = code;
  }
}
type Submission = { commandId: string; sourceCommandId: string; draft: ComposerDraft; intentRevision?: number; selection?: SelectionAttachment };
const empty = (): ComposerDraft => ({ prompt: '', sourceName: 'Pasted data', sourceText: '' });
export class ComposerDrafts {
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) { this.storage = storage; }
  private key(workId: string | null) { return `workagent-composer:${workId ?? 'new'}`; }
  read(workId: string | null): ComposerDraft {
    const raw = this.storage.getItem(this.key(workId)); if (!raw) return empty();
    const value = JSON.parse(raw);
    if (!['prompt', 'sourceName', 'sourceText'].every(k => typeof value[k] === 'string')) throw new Error('invalid_composer_draft');
    return value;
  }
  write(workId: string | null, value: ComposerDraft) { this.storage.setItem(this.key(workId), JSON.stringify(value)); }
  pending(workId: string | null): Submission | null { const raw = this.storage.getItem(`${this.key(workId)}:send`); return raw ? JSON.parse(raw) : null; }
  submission(workId: string | null, draft: ComposerDraft, intentRevision: number | undefined, makeId: () => string, selection?: SelectionAttachment): Submission {
    const old = this.pending(workId);
    if (old) { if (JSON.stringify(old.draft) !== JSON.stringify(draft)) throw new Error('unresolved_send'); return old; }
    const next = { commandId: makeId(), sourceCommandId: makeId(), draft, intentRevision, ...(selection ? { selection } : {}) };
    this.storage.setItem(`${this.key(workId)}:send`, JSON.stringify(next)); return next;
  }
  accepted(workId: string | null, commandId: string) { if (this.pending(workId)?.commandId === commandId) this.storage.removeItem(`${this.key(workId)}:send`); }
  rejected(workId: string | null, commandId: string, error: unknown) {
    if (!(error instanceof ApiError) || this.pending(workId)?.commandId !== commandId) return false;
    const invalidInput = error.status === 400 && (
      (error.path === '/sources' && error.code === 'invalid_text') ||
      (error.path === '/work/commands' && ['invalid_text', 'invalid_sources', 'invalid_command', 'invalid_selection'].includes(error.code)));
    const intentConflict = error.path === '/work/commands' && error.status === 409 && ['intent_conflict', 'selection_conflict'].includes(error.code);
    // These validation failures cannot have admitted this exact input, and an
    // intent conflict is checked after command deduplication. Access denial is
    // different: grants may have changed after an earlier lost acknowledgement.
    if (!invalidInput && !intentConflict) return false;
    this.accepted(workId, commandId); return true;
  }
  clearIfUnchanged(workId: string | null, sent: ComposerDraft) {
    if (JSON.stringify(this.read(workId)) !== JSON.stringify(sent)) return false;
    this.storage.removeItem(this.key(workId)); return true;
  }
}
