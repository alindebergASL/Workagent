import { CanceledError, CommandType } from '@univerjs/core';
import type { ICommandService } from '@univerjs/core';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { SessionStatus } from '@univerjs-pro/collaboration-client';
import type { CollaborationSession } from '@univerjs-pro/collaboration-client';
import type { IChangeset } from '@univerjs/protocol';
import type { ReversalAction } from './native-reversal-action';

interface Target { revision: number; memberID: string; sid: string; reqId: number; hash: string }
interface Retained { id: string; target: Target; attempted: boolean; abandonRequested?: boolean; disposition?: string }
interface Receipt { id: string; disposition: 'unknown' | 'committed' | 'rejected'; revision?: number; reason?: string; actionPath: string; request?: IChangeset; preview: { sheetID: string; row: number; col: number; before: { v?: unknown } | null; after: { v?: unknown } } }
export interface ReversalView { message: string; canPreview: boolean; canConfirm: boolean; canAbandon?: boolean; retainedID?: string; active: boolean; locked: boolean; preview?: Receipt['preview']; targetRevision?: number; disposition?: string }
interface Session { principal: string; binding: string; unitID: string; access: { role: string; revision: number } }
export function guardReversalInput(commands: Pick<ICommandService, 'beforeCommandExecuted'>, locked: () => boolean) {
  return commands.beforeCommandExecuted((command, options) => {
    if (locked() && !options?.fromCollab && (command.type === CommandType.COMMAND || command.type === CommandType.MUTATION)) throw new CanceledError();
  });
}
export function reversalCandidate(c: IChangeset, unitID: string): boolean {
  if (c.unitID !== unitID || c.type !== 2 || !Number.isSafeInteger(c.revision) || c.mutations?.length !== 1 || c.mutations[0].id !== 'sheet.mutation.set-range-values') return false;
  try {
    const p = JSON.parse(c.mutations[0].data), rows = Object.entries(p.cellValue ?? {});
    if (p.unitId !== unitID || p.subUnitId !== 'sheet-1' || Object.keys(p).some(k => !['unitId', 'subUnitId', 'cellValue', 'trigger', 'styleRefMap'].includes(k)) || rows.length !== 1) return false;
    const columns = Object.entries(rows[0][1] as object); if (columns.length !== 1) return false;
    const cell = columns[0][1] as Record<string, unknown>;
    if (!cell || !['string','number','boolean'].includes(typeof cell.v) || Object.keys(cell).some(k => !['v','t','f','si','s','ft','fd'].includes(k)) || ['f','si','ft','fd'].some(k => cell[k] != null)) return false;
    if (cell.t !== undefined && cell.t !== ({ string: 1, number: 2, boolean: 3 } as Record<string, number>)[typeof cell.v]) return false;
    const styles = p.styleRefMap ?? {};
    if (cell.s != null) { const style = styles[String(cell.s)]; if (typeof cell.s !== 'string' || Object.keys(styles).length !== 1 || !style || Object.keys(style).join() !== 'cl' || Object.keys(style.cl ?? {}).join() !== 'rgb' || !/^#[a-fA-F0-9]{6}$/.test(style.cl.rgb)) return false; }
    else if (Object.keys(styles).length) return false;
    return true;
  } catch { return false; }
}
export function nativeReversal(session: Session, native: Pick<CollaborationSession, 'event$' | 'sessionStatus$' | 'sessionStatus' | 'getMemberID'>,
  head: () => number, inputBusy: () => boolean, changed: (view: ReversalView) => void,
  fetcher: typeof fetch, storage: Pick<Storage, 'getItem' | 'setItem'>,
  openAction: (path: string, signal: AbortSignal) => Promise<ReversalAction>,
  digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(n => n.toString(16).padStart(2, '0')).join('')) {
  const key = `workagent:native-reversal:${session.principal}:${session.unitID}:${session.binding}:${session.access.revision}`;
  const base = `/api/work/${session.unitID}/native-reversal/${session.access.revision}`, headers = { 'X-Workagent-Session-Binding': session.binding };
  let records: Retained[] = [], retained: Retained | undefined, candidate: Target | undefined, prepared: Receipt | undefined;
  let disposed = false, active = false, locked = false, generation = 0, candidateGeneration = 0, abort: AbortController | undefined, owned: ReversalAction | undefined;
  let recordedRevision: number | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const begin = () => { abort = new AbortController(); clearTimeout(deadline); deadline = setTimeout(() => abort?.abort(), 30000); };
  let storageFailed = false, message = 'Reverse only your latest acknowledged scalar cell operation. No eligible acknowledgement yet.';
  try { const raw = storage.getItem(key); if (raw) { const parsed: Retained[] = JSON.parse(raw); if (!Array.isArray(parsed) || parsed.some(r => !r.id || !r.target)) throw Error(); records = parsed; retained = [...records].reverse().find(r => !['committed','rejected'].includes(r.disposition ?? '')) ?? records.at(-1); if (retained) message = 'Retained reversal identity. Check status (GET only); no automatic retry or reconnect.'; } } catch { storageFailed = true; message = 'Retained reversal metadata unavailable. Preparation disabled to preserve unknown outcomes.'; }
  const unresolved = () => records.some(r => !['committed','rejected'].includes(r.disposition ?? ''));
  const sameTarget = (a: Target, b: Target) => a.revision === b.revision && a.memberID === b.memberID && a.sid === b.sid && a.reqId === b.reqId && a.hash === b.hash;
  const reservedTarget = () => !!candidate && records.some(r => sameTarget(r.target, candidate!));
  const canAbandon = () => !storageFailed && !active && !!retained && retained.attempted === false && !retained.abandonRequested && !['committed','rejected'].includes(retained.disposition ?? '') && session.access.role !== 'read';
  const eligible = () => !!candidate && candidate.memberID === native.getMemberID() && candidate.revision === head() && native.sessionStatus === SessionStatus.ONLINE && !inputBusy() && session.access.role !== 'read';
  const emit = () => { if (recordedRevision !== undefined && message.startsWith('Recorded as native revision')) message = `Recorded as native revision ${recordedRevision}. ${head() >= recordedRevision ? 'Live editor has reached that revision.' : 'Waiting for the live editor to reach that revision; no local replay.'}`; if (!disposed) changed({ message, active, locked, retainedID: retained?.id, canAbandon: canAbandon(), canPreview: !storageFailed && !active && !unresolved() && !reservedTarget() && eligible(), canConfirm: !active && !!prepared && !retained?.attempted && !retained?.abandonRequested && prepared.id === retained?.id && eligible() && retained.target.revision === candidate?.revision, preview: prepared?.preview, targetRevision: retained?.target.revision ?? candidate?.revision, disposition: retained?.disposition }); };
  const save = () => { storage.setItem(key, JSON.stringify(records)); };
  const safe = (ticket: number) => !disposed && ticket === generation;
  async function read(signal: AbortSignal): Promise<Receipt> {
    const response = await fetcher(`${base}/${retained!.id}`, { headers, signal, credentials: 'same-origin' });
    if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'Access changed — retained identity is preserved; private preview hidden.' : 'Outcome unknown. Retained identity has not been retried.');
    const value: Receipt = await response.json(); if (value.id !== retained!.id) throw Error('Receipt identity mismatch'); return value;
  }
  function apply(receipt: Receipt) {
    if (!retained) return;
    retained.disposition = receipt.disposition; save();
    recordedRevision = receipt.disposition === 'committed' ? receipt.revision : undefined;
    message = receipt.disposition === 'committed' ? `Recorded as native revision ${receipt.revision}. ${head() >= (receipt.revision ?? Infinity) ? 'Live editor has reached that revision.' : 'Waiting for the live editor to reach that revision; no local replay.'}` : receipt.disposition === 'rejected' && receipt.reason === 'native_reversal_abandoned_unused' ? 'Unused preview abandoned. Its identity remains reserved; a distinct acknowledged operation can be previewed.' : receipt.disposition === 'rejected' ? `Reversal refused: ${receipt.reason ?? 'native policy'}. No retry.` : 'Outcome unknown. Check status; do not retry or create a replacement request.';
    if (receipt.disposition !== 'unknown') prepared = undefined;
  }
  async function check() {
    if (disposed || active || !retained) return;
    active = true; const ticket = ++generation; begin(); emit();
    try { const result = await read(abort!.signal); if (safe(ticket)) apply(result); }
    catch (error) { if (safe(ticket)) { prepared = undefined; message = error instanceof Error ? error.message : 'Outcome unknown'; } }
    finally { clearTimeout(deadline); if (safe(ticket)) { active = false; emit(); } }
  }
  async function abandon() {
    if (disposed || !canAbandon() || !retained) return;
    // Persist the one explicit cancellation attempt before sending. A lost
    // response is resolved by GET only, including after remount.
    retained.abandonRequested = true;
    try { save(); } catch { storageFailed = true; prepared = undefined; message = 'Cannot retain abandonment identity. No cancellation sent.'; emit(); return; }
    active = true; prepared = undefined; const ticket = ++generation; begin(); message = 'Checking that this preview never admitted an executor…'; emit();
    try {
      const response = await fetcher(`${base}/${retained.id}/abandon`, { method: 'POST', credentials: 'same-origin', headers, signal: abort!.signal });
      if (!response.ok) throw Error('Abandonment refused or uncertain. Identity retained; check status without retry.');
      const result: Receipt = await response.json(); if (!safe(ticket)) return;
      if (result.id !== retained.id) throw Error('Receipt identity mismatch');
      apply(result);
    } catch (error) { if (safe(ticket)) message = error instanceof Error ? error.message : 'Abandonment outcome unknown. Check status.'; }
    finally { clearTimeout(deadline); if (safe(ticket)) { active = false; emit(); } }
  }
  async function preview() {
    if (disposed || active) return;
    if (storageFailed || unresolved() || reservedTarget() || !eligible()) { message = 'Preview unavailable: finish cell input/paste/composition/pending edits, or check the retained reversal first.'; emit(); return; }
    const target = { ...candidate! }; retained = { id: crypto.randomUUID(), target, attempted: false }; records.push(retained);
    try { save(); } catch { records.pop(); retained = records.at(-1); storageFailed = true; message = 'Cannot retain request identity. No preparation sent.'; emit(); return; }
    active = true; prepared = undefined; const ticket = ++generation; begin(); message = 'Preparing an exact native reversal preview…'; emit();
    try {
      const response = await fetcher(base, { method: 'POST', credentials: 'same-origin', headers: { ...headers, 'Content-Type': 'application/json' }, signal: abort!.signal, body: JSON.stringify({ commandId: retained.id, ...target }) });
      if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'Access changed. Identity retained; preview hidden.' : 'Preparation refused or uncertain. Check retained identity; no automatic retry.');
      const result: Receipt = await response.json(); if (!safe(ticket)) return;
      if (result.id !== retained.id || result.disposition !== 'unknown') { apply(result); return; }
      prepared = result; message = 'Prepared preview only. Confirm once to submit through a separate native action connection.';
    } catch (error) { if (safe(ticket)) { prepared = undefined; message = error instanceof Error ? error.message : 'Preparation outcome unknown.'; } }
    finally { clearTimeout(deadline); if (safe(ticket)) { active = false; emit(); } }
  }
  async function confirm() {
    if (disposed || active) return;
    if (!prepared || !retained || retained.attempted || retained.abandonRequested || !eligible() || candidate?.revision !== retained.target.revision) { message = 'Confirmation paused: finish new cell input or pending edits. A newer native revision invalidates this preview.'; emit(); return; }
    retained.attempted = true;
    try { save(); } catch { storageFailed = true; message = 'Cannot retain action attempt. Nothing submitted.'; emit(); return; }
    active = locked = true; const ticket = ++generation; begin(); message = 'Submitting once through a separate native action session…'; emit();
    try {
      const expectedPath = `/api/native/${session.unitID}/${session.access.revision}/reversal/${retained.id}/universer-api`;
      if (prepared.actionPath !== expectedPath) throw Error('Action path mismatch');
      owned = await openAction(expectedPath, abort!.signal); if (!safe(ticket)) { owned.dispose(); return; }
      const receipt = await read(abort!.signal); if (!safe(ticket)) return;
      if (!eligible() || receipt.disposition !== 'unknown' || !receipt.request || receipt.request.memberID !== owned.memberID || receipt.request.baseRev !== retained.target.revision) throw Error('Action not submitted: input, revision or receipt changed. Identity retained.');
      await owned.submit(receipt.request); if (!safe(ticket)) return;
      const confirmed = await read(abort!.signal); if (safe(ticket)) apply(confirmed);
    } catch (error) { if (safe(ticket)) { prepared = undefined; message = error instanceof Error ? error.message : 'Outcome unknown. Check status without retry.'; } }
    finally { clearTimeout(deadline); owned?.dispose(); owned = undefined; if (safe(ticket)) { active = locked = false; emit(); } }
  }
  const events = native.event$.subscribe(event => {
    if (disposed) return;
    if (event.eventID === CollaborationEvent.NEW_CHANGESETS) { candidateGeneration++; candidate = undefined; if (!active) message = 'A newer native revision invalidated the reversal candidate/preview. Any retained identity can be checked; no replacement request.'; emit(); return; }
    if (event.eventID !== CollaborationEvent.CHANGESET_ACK) return;
    if (!('data' in event)) return;
    const c = event.data as IChangeset;
    if (c.unitID !== session.unitID || c.userID !== session.principal || c.memberID !== native.getMemberID()) return;
    if (typeof c.sid !== 'string' || typeof c.reqId !== 'number' || !Number.isSafeInteger(c.reqId) || c.reqId < 1) { candidate = undefined; message = 'Acknowledgement lacks an exact native request identity.'; emit(); return; }
    const { sid, reqId } = c;
    const token = ++candidateGeneration; candidate = undefined;
    if (!reversalCandidate(c, session.unitID)) { message = 'Latest ACK is not one supported scalar cell mutation (batch/formula/rich text/multi-cell operations cannot be reversed here).'; emit(); return; }
    void digest(JSON.stringify(c.mutations)).then(hash => { if (disposed || token !== candidateGeneration) return; candidate = { revision: c.revision, memberID: c.memberID, sid, reqId, hash }; if (!unresolved()) message = `Your acknowledged native operation at revision ${c.revision} is available for preview.`; emit(); }, () => { if (!disposed && token === candidateGeneration) { candidate = undefined; message = 'Cannot hash exact native acknowledgement. Preview unavailable.'; emit(); } });
  });
  let wasOffline = false;
  const status = native.sessionStatus$.subscribe(value => {
    const preserveOutcome = storageFailed || retained?.disposition === 'committed' || retained?.disposition === 'rejected';
    if (value !== SessionStatus.ONLINE) {
      wasOffline = true;
      candidateGeneration++; candidate = undefined; prepared = undefined;
      if (!preserveOutcome) message = 'Native session disconnected. Retained identity can be checked; no action reconnect or retry.';
    } else if (wasOffline) {
      wasOffline = false;
      if (!preserveOutcome) message = retained
        ? 'Native session connected. Retained reversal outcome remains unknown. Check status (GET only); no action reconnect or retry.'
        : 'Native session connected. No eligible acknowledgement yet. Wait for a new own acknowledged scalar cell operation.';
    }
    emit();
  });
  emit();
  return { preview, confirm, check, abandon, active: () => active, locked: () => locked, refresh(pending = false) { if (pending) { candidateGeneration++; candidate = undefined; prepared = undefined; if (!active) message = 'Pending native edits invalidated the previous reversal candidate.'; } emit(); }, dispose() { if (disposed) return; disposed = true; generation++; candidateGeneration++; clearTimeout(deadline); abort?.abort(); owned?.dispose(); owned = undefined; events.unsubscribe(); status.unsubscribe(); active = locked = false; changed({ message: 'Reversal unavailable — session closed or access changed. Identity retained.', active: false, locked: false, canPreview: false, canConfirm: false }); } };
}
