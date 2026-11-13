import type { Work } from './types';
import type { SheetSelection } from './NativeEditor';
import type { DocumentCapture } from './DocumentEditor';
import type { DocumentSelection } from '../../../packages/workagent-contract/document.mjs';
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
export type SelectionAttachment = ((SheetSelection & { kind?: 'sheet' }) | DocumentCapture) & { contentRevision: number };
export type SelectionContext = (SheetSelection & { kind?: 'sheet'; contentRevision: number }) | DocumentSelection;
export type ComposerDraft = { prompt: string; sourceName: string; sourceText: string; selection?: SelectionAttachment };
export class ApiError extends Error {
  readonly path: string;
  readonly status: number;
  readonly code: string;
  constructor(path: string, status: number, code: string) {
    super(code); this.path = path; this.status = status; this.code = code;
  }
}
export type Submission = { commandId: string; sourceCommandId: string; draft: ComposerDraft; intentRevision?: number; selection?: SelectionContext };
const empty = (): ComposerDraft => ({ prompt: '', sourceName: 'Pasted data', sourceText: '' });
function validSelection(s: any, workId: string | null, attached: boolean): boolean {
  if (!s || typeof s !== 'object' || Array.isArray(s) || typeof s.workId !== 'string' || s.workId !== workId || !Number.isSafeInteger(s.contentRevision) || s.contentRevision < 0) return false;
  if (s.kind === 'document') return s.documentId === workId && s.segmentId === '' && Number.isSafeInteger(s.startOffset) && s.startOffset >= 0
    && Number.isSafeInteger(s.endOffset) && s.endOffset > s.startOffset && s.endOffset - s.startOffset <= 10000
    && Object.keys(s).every(k => ['kind', 'workId', 'documentId', 'contentRevision', 'segmentId', 'startOffset', 'endOffset', ...(attached ? ['quote', 'title', 'editorId', 'selectionEpoch', 'contentEpoch'] : [])].includes(k))
    && (!attached || (typeof s.quote === 'string' && s.quote.length === s.endOffset - s.startOffset && typeof s.title === 'string'
      && typeof s.editorId === 'string' && s.editorId.length > 0 && Number.isSafeInteger(s.selectionEpoch) && s.selectionEpoch >= 0 && Number.isSafeInteger(s.contentEpoch) && s.contentEpoch >= 0));
  return (s.kind === undefined || s.kind === 'sheet') && typeof s.sheetId === 'string' && typeof s.sheetName === 'string' && typeof s.rangeLabel === 'string'
    && s.range && ['startRow', 'endRow', 'startColumn', 'endColumn'].every(k => Number.isSafeInteger(s.range[k]) && s.range[k] >= 0)
    && s.range.startRow <= s.range.endRow && s.range.startColumn <= s.range.endColumn;
}
function validDraft(value: any, workId: string | null): boolean {
  return value && typeof value === 'object' && !Array.isArray(value) && ['prompt', 'sourceName', 'sourceText'].every(k => typeof value[k] === 'string')
    && Object.keys(value).every(k => ['prompt', 'sourceName', 'sourceText', 'selection'].includes(k))
    && (value.selection === undefined || validSelection(value.selection, workId, true));
}
export class ComposerDrafts {
  private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  // A displayed lost-ACK attempt belongs to this consumer even if a sibling
  // settles it and clears shared storage. Never mint a second command on Retry.
  private attempts = new Map<string, Submission>();
  constructor(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) { this.storage = storage; }
  private key(workId: string | null) { return `workagent-composer:${workId ?? 'new'}`; }
  read(workId: string | null): ComposerDraft {
    const raw = this.storage.getItem(this.key(workId)); if (!raw) return empty();
    let value; try { value = JSON.parse(raw); } catch { throw new Error('invalid_composer_draft'); }
    if (!validDraft(value, workId)) throw new Error('invalid_composer_draft');
    return value;
  }
  write(workId: string | null, value: ComposerDraft) {
    this.read(workId); // Refuse to overwrite an unsupported recovery payload.
    if (!validDraft(value, workId)) throw new Error('invalid_composer_draft');
    this.storage.setItem(this.key(workId), JSON.stringify(value));
  }
  private storedPending(workId: string | null): Submission | null {
    const raw = this.storage.getItem(`${this.key(workId)}:send`); if (!raw) return null;
    let s; try { s = JSON.parse(raw); } catch { throw new Error('invalid_pending_send'); }
    const validId = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
    if (!s || !validId(s.commandId) || !validId(s.sourceCommandId) || !validDraft(s.draft, workId)
      || Object.keys(s).some(k => !['commandId', 'sourceCommandId', 'draft', 'intentRevision', 'selection'].includes(k))
      || (workId !== null && (!Number.isSafeInteger(s.intentRevision) || s.intentRevision < 0))
      || (s.selection !== undefined && !validSelection(s.selection, workId, false))
      || (!!s.draft.selection !== !!s.selection) || (s.selection && s.selection.kind !== s.draft.selection.kind)) throw new Error('invalid_pending_send');
    if (s.selection && (s.selection.kind === 'document'
      ? ['documentId', 'segmentId', 'startOffset', 'endOffset'].some(k => s.selection[k] !== s.draft.selection[k])
      : s.selection.sheetId !== s.draft.selection.sheetId || JSON.stringify(s.selection.range) !== JSON.stringify(s.draft.selection.range))) throw new Error('invalid_pending_send');
    return s;
  }
  pending(workId: string | null): Submission | null {
    const key = this.key(workId), own = this.attempts.get(key); if (own) return own;
    const saved = this.storedPending(workId); if (saved) this.attempts.set(key, saved); return saved;
  }
  submission(workId: string | null, draft: ComposerDraft, intentRevision: number | undefined, makeId: () => string, selection?: SelectionContext): Submission {
    const old = this.pending(workId);
    if (old) { if (JSON.stringify(old.draft) !== JSON.stringify(draft)) throw new Error('unresolved_send'); return old; }
    const next = { commandId: makeId(), sourceCommandId: makeId(), draft, intentRevision, ...(selection ? { selection } : {}) };
    this.storage.setItem(`${this.key(workId)}:send`, JSON.stringify(next)); this.attempts.set(this.key(workId), next); return next;
  }
  accepted(workId: string | null, commandId: string) {
    if (this.storedPending(workId)?.commandId === commandId) this.storage.removeItem(`${this.key(workId)}:send`);
    if (this.attempts.get(this.key(workId))?.commandId === commandId) this.attempts.delete(this.key(workId));
  }
  rejected(workId: string | null, commandId: string, error: unknown) {
    if (!(error instanceof ApiError) || this.pending(workId)?.commandId !== commandId) return false;
    const invalidInput = error.status === 400 && (
      (error.path === '/sources' && error.code === 'invalid_text') ||
      (error.path === '/work/commands' && ['invalid_text', 'invalid_sources', 'invalid_command', 'invalid_selection', 'invalid_document_selection'].includes(error.code)));
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
