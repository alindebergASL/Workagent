import { blankDocument, validateDocument, requireSheet, workKind, workTitle } from '../../../packages/workagent-contract/document.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { Fault, id, text, revision, blankWorkbook, validateWorkbook, validatePatch, applyPatch, anchor } from '../../../packages/workagent-contract/index.mjs';
import { bindSelection } from './selection.mjs';
export const digest = data => createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
function canonical(x) { return Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x; }
export function authorize(s, principal) { if (!s.enabled || s.owner !== principal) throw new Fault('access_denied', 403); }
export function work(s, workId) { const w = s.works[id(workId)]; if (!w) throw new Fault('work_not_found', 404); return w; }
export function preconditions(s, w) { return { contentRevision: w.contentRevision, intentRevision: w.intentRevision, permissionRevision: s.permissionRevision, cancellationEpoch: w.cancellationEpoch }; }
export function same(a, b) { return Object.keys(b).every(k => a?.[k] === b[k]); }
export function event(s, w, kind) { s.events.push({ eventId: ++s.sequence, workId: w.id, kind, contentRevision: w.contentRevision, intentRevision: w.intentRevision }); }
export function dedup(s, key, input, fn) {
  id(key); const hash = digest(input), old = s.commands[key];
  if (old) { if (old.hash !== hash) throw new Fault('command_conflict'); return old.result; }
  const result = fn(); s.commands[key] = { hash, result }; return result;
}
function snapshot(s, w) { return { ...structuredClone(w), eventSequence: s.sequence, expected: preconditions(s, w) }; }
// Shared authoritative editor commit for agent and deterministic maintenance writes.
export function commitEditorPatch(s, w, patch, expected, kind = 'agent_changed') {
  requireSheet(w);
  const protectedCell = patch.cells.some(c => w.humanCells.includes(anchor(c)));
  if (protectedCell) return { status: 'protected', reason: 'human_edit' };
  if (!same(expected, preconditions(s, w)) || ['cancellation_requested', 'stopped'].includes(w.status)) return { status: 'protected', reason: 'revision_changed' };
  w.book = applyPatch(w.book, patch); w.contentRevision++; event(s, w, kind);
  return { status: 'applied', expected: preconditions(s, w) };
}
export class Workspace {
  constructor(store) { this.store = store; }
  async createBlank(principal, input) {
    if (!input || Object.keys(input).some(k => !['commandId', 'title', 'kind'].includes(k))) throw new Fault('invalid_command', 400);
    id(input.commandId); text(input.title, 200);
    if (input.kind !== undefined && !['sheet', 'document'].includes(input.kind)) throw new Fault('invalid_artifact_kind', 400);
    return this.store.transaction(s => {
      authorize(s, principal);
      return dedup(s, input.commandId, { operation: input.kind === 'document' ? 'blank-document' : 'blank-sheet', ...input }, () => {
        const workId = randomUUID();
        const w = { id: workId, ...(input.kind === 'document' ? { kind: 'document', document: blankDocument(workId, input.title.trim()), humanDocument: false } : { book: blankWorkbook(workId, input.title.trim()) }), contentRevision: 1, intentRevision: 0, cancellationEpoch: 0, messages: [], proposals: [], humanCells: [], sourceIds: [], status: 'ready' };
        s.works[workId] = w; event(s, w, 'human_created');
        return { workId, contentRevision: 1 };
      });
    });
  }
  async list(principal) { return this.store.transaction(s => { authorize(s, principal); return Object.values(s.works).map(w => ({ id: w.id, kind: workKind(w), title: workTitle(w), status: w.status })); }); }
  async get(principal, workId) { return this.store.transaction(s => { authorize(s, principal); return snapshot(s, work(s, workId)); }); }
  async events(principal, after) { return this.store.transaction(s => {
    authorize(s, principal);
    if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) throw new Fault('invalid_cursor', 400);
    // Bound the replay response, without deleting retained events or contributions.
    const events = s.events.filter(e => e.eventId > (after ?? s.sequence));
    const reset = after === undefined || after > s.sequence || s.sequence - after > 256
      || events.length !== s.sequence - after || events.some((e, i) => e.eventId !== after + i + 1);
    const changed = new Set(events.map(e => e.workId));
    return { kind: reset ? 'reset' : 'events', cursor: s.sequence, events: reset ? [] : events,
      works: Object.values(s.works).map(w => ({ id: w.id, kind: workKind(w), title: workTitle(w), status: w.status })),
      snapshots: Object.values(s.works).filter(w => reset || changed.has(w.id)).map(w => snapshot(s, w)) };
  }); }
  async source(principal, input) {
    id(input.commandId); text(input.name, 200); text(input.content, 200000);
    if (input.synthetic !== true) throw new Fault('synthetic_data_required', 400);
    return this.store.transaction(s => { authorize(s, principal); return dedup(s, input.commandId, input, () => { const source = { id: randomUUID(), name: input.name, content: input.content, owner: principal, synthetic: true, revision: 1 }; s.sources[source.id] = source; return { id: source.id, name: source.name }; }); });
  }
  async command(principal, input) {
    return (await this.admitCommand(principal, input)).result;
  }
  async admitCommand(principal, input) {
    id(input.commandId); if (!['start', 'continue', 'cancel'].includes(input.kind)) throw new Fault('invalid_command', 400);
    if (input.kind !== 'cancel') text(input.text);
    if (!Array.isArray(input.sourceIds) || input.sourceIds.length > 10) throw new Fault('invalid_sources', 400);
    return this.store.transaction(s => {
      authorize(s, principal);
      for (const sourceId of input.sourceIds) if (s.sources[id(sourceId)]?.owner !== principal) throw new Fault('source_access_denied', 403);
      const replay = !!s.commands[input.commandId];
      const result = dedup(s, input.commandId, input, () => {
        let w;
        if (input.kind === 'start') {
          const workId = randomUUID(); w = { id: workId, contentRevision: 0, intentRevision: 0, cancellationEpoch: 0, book: blankWorkbook(workId), messages: [], proposals: [], humanCells: [], sourceIds: [], status: 'queued' }; s.works[workId] = w;
        } else {
          w = work(s, input.workId); revision(input.expectedIntentRevision);
          if (input.expectedIntentRevision !== w.intentRevision) throw new Fault('intent_conflict');
        }
        const selection = input.selection === undefined ? undefined : bindSelection(w, input.selection, input.kind);
        w.intentRevision++; w.sourceIds = [...new Set([...w.sourceIds, ...input.sourceIds])];
        for (const j of Object.values(s.jobs)) if (j.workId === w.id && j.kind !== 'maintenance' && j.status === 'queued') j.status = 'superseded';
        if (input.kind === 'cancel') { w.cancellationEpoch++; w.status = Object.values(s.jobs).some(j => j.workId === w.id && j.kind !== 'maintenance' && j.status === 'running') ? 'cancellation_requested' : 'stopped'; }
        else {
          w.messages.push({ id: input.commandId, role: 'user', text: input.text, ...(selection?.kind === 'document' ? { selection: structuredClone(selection) } : {}) }); w.status = 'queued'; delete w.errorCode;
          s.jobs[input.commandId] = { id: input.commandId, workId: w.id, text: input.text, ...(selection ? { selection } : {}), status: 'queued', phase: 'admitted', expected: preconditions(s, w), sessionId: randomUUID(), requestIds: [] };
        }
        event(s, w, input.kind); return { workId: w.id, commandId: input.commandId, intentRevision: w.intentRevision };
      });
      // Admission metadata is transactional but never part of the stored/public result.
      return { result, admitted: !replay };
    });
  }
  async save(principal, workId, input) {
    const document = input.document === undefined ? undefined : validateDocument(input.document);
    const book = document ? undefined : validateWorkbook(input.book);
    if (document && input.book !== undefined) throw new Fault('artifact_type_mismatch', 400);
    revision(input.contentRevision); revision(input.permissionRevision);
    return this.store.transaction(s => {
      authorize(s, principal); const w = work(s, workId);
      if ((workKind(w) === 'document') !== !!document) throw new Fault('artifact_type_mismatch', 400);
      if ((document ?? book).id !== w.id) throw new Fault('workbook_identity', 400);
      return dedup(s, input.commandId, { workId, ...input }, () => {
        if (w.contentRevision !== input.contentRevision || s.permissionRevision !== input.permissionRevision) throw new Fault('save_conflict');
        if (document) {
          if (digest(w.document) !== digest(document)) w.humanDocument = true;
          w.document = document; w.contentRevision++; event(s, w, 'human_saved');
          return { contentRevision: w.contentRevision, permissionRevision: s.permissionRevision };
        }
        const human = new Set(w.humanCells);
        const cellMeaning = c => c?.f ? { f: c.f } : c?.si ? { si: c.si } : c ?? null;
        for (const sid of new Set([...w.book.sheetOrder, ...book.sheetOrder])) {
          const old = w.book.sheets[sid]?.cellData ?? {}, next = book.sheets[sid]?.cellData ?? {};
          for (const r of new Set([...Object.keys(old), ...Object.keys(next)])) for (const c of new Set([...Object.keys(old[r] ?? {}), ...Object.keys(next[r] ?? {})])) {
            if (digest(cellMeaning(old[r]?.[c])) !== digest(cellMeaning(next[r]?.[c]))) human.add(`${sid}:${r}:${c}`);
          }
        }
        for (const r of w.responsibilities ?? []) {
          const sid = r.target.sheetId;
          const structureChanged = digest(w.book.sheets[sid]?.rowData ?? {}) !== digest(book.sheets[sid]?.rowData ?? {})
            || w.book.sheets[sid]?.rowCount !== book.sheets[sid]?.rowCount || w.book.sheets[sid]?.columnCount !== book.sheets[sid]?.columnCount || !book.sheets[sid];
          if (human.has(anchor(r.target)) || structureChanged) { r.detached = true; r.lastOutcome = 'protected'; }
        }
        w.humanCells = [...human]; w.book = book; w.contentRevision++; event(s, w, 'human_saved');
        return { contentRevision: w.contentRevision, permissionRevision: s.permissionRevision };
      });
    });
  }
  async mutate(principal, workId, input) {
    const patch = validatePatch(input.patch);
    return this.store.transaction(s => {
      authorize(s, principal); const w = work(s, workId);
      return dedup(s, input.commandId, { workId, ...input }, () => {
        const current = preconditions(s, w);
        const result = commitEditorPatch(s, w, patch, input.expected);
        if (result.status === 'protected') {
          const proposal = { id: randomUUID(), patch, originalExpected: input.expected, expected: current, reason: result.reason, status: 'pending' };
          w.proposals.push(proposal); event(s, w, 'change_proposed'); return { status: 'proposed', proposalId: proposal.id };
        }
        return result;
      });
    });
  }
  async mutateDocument(principal, workId, input) {
    const document = validateDocument(input.document);
    return this.store.transaction(s => {
      authorize(s, principal); const w = work(s, workId);
      if (workKind(w) !== 'document' || document.id !== w.id) throw new Fault('document_identity', 400);
      return dedup(s, input.commandId, { operation: 'edit-document', workId, ...input }, () => {
        const current = preconditions(s, w);
        if (w.humanDocument || !same(input.expected, current) || ['stopped', 'cancellation_requested'].includes(w.status)) {
          const proposal = { id: randomUUID(), kind: 'document', patch: { document }, originalExpected: input.expected, expected: current, reason: w.humanDocument ? 'human_edit' : 'revision_changed', status: 'pending' };
          w.proposals.push(proposal); event(s, w, 'change_proposed');
          return { status: 'proposed', proposalId: proposal.id };
        }
        w.document = document; w.contentRevision++; event(s, w, 'agent_changed');
        return { status: 'applied', expected: preconditions(s, w) };
      });
    });
  }
  async decide(principal, workId, proposalId, input) {
    if (!['accept', 'reject'].includes(input.decision)) throw new Fault('invalid_decision', 400);
    return this.store.transaction(s => {
      authorize(s, principal); const w = work(s, workId);
      return dedup(s, input.commandId, { workId, proposalId, ...input }, () => {
        const p = w.proposals.find(p => p.id === proposalId); if (!p || p.status !== 'pending') throw new Fault('proposal_not_pending');
        if (input.decision === 'accept') {
          if (!same(input.expected, preconditions(s, w)) || !same(p.expected, preconditions(s, w))) throw new Fault('proposal_conflict');
          if (['stopped', 'cancellation_requested'].includes(w.status)) throw new Fault('work_cancelled');
          if (workKind(w) === 'document') {
            if (p.kind !== 'document') throw new Fault('document_identity', 400);
            const document = validateDocument(p.patch?.document);
            if (document.id !== w.id) throw new Fault('document_identity', 400);
            w.document = document; w.humanDocument = true;
          } else {
            w.book = applyPatch(w.book, p.patch);
            w.humanCells = [...new Set([...w.humanCells, ...p.patch.cells.map(anchor)])];
          }
          w.contentRevision++;
        }
        p.status = input.decision === 'accept' ? 'accepted' : 'rejected'; event(s, w, 'proposal_decided'); return { status: p.status, contentRevision: w.contentRevision };
      });
    });
  }
  async claim(principal) { return this.store.transaction(s => {
    authorize(s, principal);
    const running = new Set(Object.values(s.jobs).filter(j => j.status === 'running').map(j => j.workId));
    const j = Object.values(s.jobs).sort((a, b) => Number(a.kind === 'maintenance') - Number(b.kind === 'maintenance')).find(j => {
      if (j.status !== 'queued' || running.has(j.workId)) return false;
      const w = work(s, j.workId);
      if (j.kind === 'maintenance') return !Object.values(s.jobs).some(other => other.workId === j.workId && other.kind !== 'maintenance' && ['queued', 'running'].includes(other.status));
      if (!same(j.expected, { intentRevision: w.intentRevision, permissionRevision: s.permissionRevision, cancellationEpoch: w.cancellationEpoch })) { j.status = 'superseded'; return false; }
      return true;
    }); if (!j) return null;
    const w = work(s, j.workId);
    if (j.kind === 'maintenance') { j.status = 'running'; j.expected = preconditions(s, w); return j; }
    j.phase ??= 'admitted'; j.status = 'running'; w.status = 'working'; event(s, w, 'working');
    // Freeze the accepted context before native creation; recovery must use this same input.
    j.work ??= snapshot(s, w); j.sources ??= w.sourceIds.map(k => structuredClone(s.sources[k]));
    return j;
  }); }
  async checkpoint(principal, job, phase, details = {}) { return this.store.transaction(s => {
    authorize(s, principal); const j = s.jobs[job.id], w = work(s, job.workId);
    if (!j || j.status !== 'running' || j.sessionId !== job.sessionId) throw new Fault('job_not_running');
    if (!['completed', 'incomplete'].includes(phase) && !same(j.expected, { intentRevision: w.intentRevision, permissionRevision: s.permissionRevision, cancellationEpoch: w.cancellationEpoch })) throw new Fault('work_superseded');
    const phases = ['admitted', 'session_ready', 'prompt_accepted', 'execution_started', 'completed', 'incomplete'];
    if (!phases.includes(phase) || phases.indexOf(phase) < phases.indexOf(j.phase)) throw new Fault('invalid_job_phase');
    j.phase = phase;
    if (details.requestId && !(j.requestIds ??= []).includes(details.requestId)) j.requestIds.push(details.requestId);
    if (['completed', 'incomplete'].includes(phase)) { j.messages = details.messages ?? []; j.outcome = details.outcome; }
    return null;
  }); }
  async finish(principal, job, messages, status, errorCode) { return this.store.transaction(s => {
    authorize(s, principal); const j = s.jobs[job.id], w = work(s, job.workId);
    if (j.status !== 'running') return null;
    j.status = w.cancellationEpoch !== job.expected.cancellationEpoch ? 'stopped'
      : w.intentRevision !== job.expected.intentRevision ? 'superseded' : status;
    j.errorCode = errorCode ?? (j.status === 'stopped' && j.requestIds?.length ? 'cancelled_check_receipt' : undefined);
    for (const message of messages) if (!w.messages.some(m => m.id === message.id)) w.messages.push(message);
    if (w.status === 'cancellation_requested') { w.status = 'stopped'; w.errorCode = j.errorCode; }
    if (w.intentRevision === job.expected.intentRevision) { w.status = status; w.errorCode = errorCode; }
    event(s, w, 'work_finished'); return null;
  }); }
  async recover(principal, inspectNative) { return this.store.transaction(async s => {
    authorize(s, principal);
    for (const j of Object.values(s.jobs)) if (j.status === 'running') {
      const w = work(s, j.workId);
      if (j.kind === 'maintenance') { j.status = 'queued'; event(s, w, 'maintenance_recovered'); continue; }
      // No callback means no native-storage evidence, including for old B01 jobs.
      const native = inspectNative ? await inspectNative(j) : null;
      for (const message of native?.messages ?? []) if (!w.messages.some(m => m.id === message.id)) w.messages.push(message);
      const current = same(j.expected, { intentRevision: w.intentRevision, permissionRevision: s.permissionRevision, cancellationEpoch: w.cancellationEpoch });
      if (['completed', 'incomplete'].includes(j.phase) || native?.outcome) {
        for (const message of j.messages ?? []) if (!w.messages.some(m => m.id === message.id)) w.messages.push(message);
        const outcome = native?.outcome ?? j.outcome ?? { status: j.phase === 'completed' ? 'ready' : 'incomplete' };
        j.status = current ? outcome.status : w.cancellationEpoch !== j.expected.cancellationEpoch ? 'stopped' : 'superseded';
        j.errorCode = outcome.errorCode;
        if (j.status === 'stopped' && j.requestIds?.length) j.errorCode = 'cancelled_check_receipt';
      } else if (native && !native.uncertain && ['admitted', 'session_ready', 'prompt_accepted'].includes(j.phase)) {
        j.status = current ? 'queued' : w.cancellationEpoch !== j.expected.cancellationEpoch ? 'stopped' : 'superseded';
      } else { j.status = 'interrupted'; j.errorCode = 'interrupted_no_automatic_replay'; }
      // An older job must not overwrite a newer intent's queued state.
      if (current || w.status === 'cancellation_requested') {
        w.status = w.status === 'cancellation_requested' && j.status !== 'interrupted' ? 'stopped' : j.status;
        w.errorCode = j.errorCode;
      }
      event(s, w, 'recovered');
    }
    return null;
  }); }
}
