import { SessionStatus } from '@univerjs-pro/collaboration-client';
import type { CollaborationSession } from '@univerjs-pro/collaboration-client';
import type { IChangeset } from '@univerjs/protocol';
import type { NativeSession } from './NativeCollaborationEditor';
import type { ReversalAction } from './native-reversal-action';
interface Proposal { id: string; review: string; revision: number; sheet: string; row: number; column: number }
interface Identity { id: string; proposalId: string; memberID: string; revision: number; row: number; column: number }
interface Preview { sheetID: string; row: number; column: number; nativeRevision: number; before: Record<string, unknown> | null; after: Record<string, unknown>; style: unknown }
interface Receipt { id: string; proposalId: string; disposition: 'unknown' | 'committed' | 'rejected'; phase: 'prepared' | 'confirmed' | 'executor-admitted' | 'abandoned'; reason?: string; revision?: number; preview: Preview; actionPath: string; request?: IChangeset }
interface Retained { identity: Identity; receipt?: Receipt; confirm: boolean; abandon: boolean }
export interface AcceptanceView { message: string; active: boolean; locked: boolean; eligible: string[]; retained: { id: string; proposalId: string }[]; selected?: string; preview?: Preview; canConfirm: boolean; canAbandon: boolean; priorRetained: boolean }
type Disk = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>;
const id = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
const integer = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0;
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const rank = (r: Receipt) => r.phase === 'abandoned' ? 5 : r.disposition !== 'unknown' ? 4 : ({ prepared: 1, confirmed: 2, 'executor-admitted': 3, abandoned: 4 })[r.phase];
const terminal = (r?: Receipt) => !!r && r.disposition !== 'unknown';
const abandoned = (r?: Receipt) => r?.phase === 'abandoned' && r.disposition === 'rejected' && r.reason === 'native_acceptance_abandoned_unused';
// This backend receipt proves origin refusal happened BEFORE confirmation.
// A local confirm attempt is retained history, not evidence of admission.
const unusedRefusal = (r?: Receipt) => r?.phase === 'prepared' && r.disposition === 'rejected' && r.reason === 'native_acceptance_origin' && r.request === undefined && r.revision === undefined;
const canAbandonUnused = (r: Retained) => !r.abandon && (unusedRefusal(r.receipt) || !r.confirm && r.receipt?.phase === 'prepared' && r.receipt.disposition === 'unknown');
const unusedTransition = (a: Receipt, b: Receipt) => unusedRefusal(a) && abandoned(b) && stable({ ...a, phase: 'abandoned', reason: 'native_acceptance_abandoned_unused' }) === stable(b);
const positiveAdmission = (r: Receipt) => r.phase === 'confirmed' || r.phase === 'executor-admitted' || r.disposition === 'committed';

export const emptyAcceptanceView: AcceptanceView = { message: 'Select a current proposal to preview. Nothing applies automatically.', active: false, locked: false, eligible: [], retained: [], canConfirm: false, canAbandon: false, priorRetained: false };
// Immutable per-command identity and append-only evidence, never an aggregate
// read/modify/write. This is recovery storage, NOT a transactional cross-tab lock.
// Server reservation/confirmation/executor fences arbitrate simultaneous requests.
export function nativeAgentAcceptance(session: NativeSession, native: Pick<CollaborationSession, 'getMemberID' | 'sessionStatus' | 'sessionStatus$'>,
  proposals: () => Proposal[], head: () => number, healthy: () => boolean, inputBusy: () => boolean,
  changed: (v: AcceptanceView) => void, fetcher: typeof fetch, disk: Disk,
  openAction: (path: string, signal: AbortSignal) => Promise<ReversalAction>, onTerminal: () => void = () => {}) {
  const prefix = `workagent:native-agent-acceptance:${session.principal}:${session.unitID}:`, scope = `${prefix}${session.binding}:${session.access.revision}:`;
  const base = `/api/work/${session.unitID}/native-agent-acceptance/${session.access.revision}`;
  const headers = { 'X-Workagent-Session-Binding': session.binding, 'Content-Type': 'application/json' };
  let records: Retained[] = [], selected: string | undefined, prepared: string | undefined, failed = false, priorRetained = false;
  let hidden = false;
  let disposed = false, active = false, locked = false, generation = 0, message = emptyAcceptanceView.message;
  let abort: AbortController | undefined, action: ReversalAction | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const allowed = () => session.acceptance === true && session.owner && session.access.role === 'owner';
  const ready = () => !failed && allowed() && healthy() && native.sessionStatus === SessionStatus.ONLINE && !inputBusy();
  const path = (i: Identity) => `/api/native/${session.unitID}/${session.access.revision}/agent-acceptance/${i.id}/universer-api`;
  function validate(r: Receipt, i: Identity) {
    if (!r || r.id !== i.id || r.proposalId !== i.proposalId || r.actionPath !== path(i) || !['unknown','committed','rejected'].includes(r.disposition) || !['prepared','confirmed','executor-admitted','abandoned'].includes(r.phase)) throw Error('Acceptance receipt identity mismatch');
    const p = r.preview;
    if (!p || p.sheetID !== 'sheet-1' || p.row !== i.row || p.column !== i.column || p.nativeRevision !== i.revision || !p.after || typeof p.after !== 'object' || Array.isArray(p.after) || p.before !== null && (typeof p.before !== 'object' || Array.isArray(p.before))) throw Error('Acceptance preview mismatch');
    if (r.disposition === 'committed' && (r.revision !== i.revision + 1 || r.phase !== 'executor-admitted')) throw Error('Invalid committed receipt');
    if (r.phase === 'abandoned' && !abandoned(r)) throw Error('Invalid abandoned receipt');
    if (r.disposition === 'rejected' && typeof r.reason !== 'string') throw Error('Missing refusal reason');
    if (r.request) {
      const q = r.request;
      if (r.phase !== 'executor-admitted' || q.unitID !== session.unitID || q.type !== 2 || q.userID !== session.principal || !id(q.memberID) || q.baseRev !== i.revision || q.revision !== i.revision + 1 || typeof q.sid !== 'string' || !/^acceptance_[a-zA-Z0-9_-]+$/.test(q.sid) || q.reqId !== 1 || !integer(q.createTime) || q.mutations?.length !== 1 || q.mutations[0].id !== 'sheet.mutation.set-range-values') throw Error('Acceptance request identity mismatch');
      const params = JSON.parse(q.mutations[0].data);
      const expected = { unitId: session.unitID, subUnitId: 'sheet-1', cellValue: { [p.row]: { [p.column]: p.after } }, ...(typeof p.after.s === 'string' ? { styleRefMap: { [p.after.s]: p.style } } : {}) };
      if (stable(params) !== stable(expected)) throw Error('Acceptance request differs from canonical preview');
    } else if (r.phase === 'executor-admitted') throw Error('Missing admitted request');
    return r;
  }
  function append(key: string, value: unknown) {
    const encoded = stable(value), old = disk.getItem(key);
    if (old !== null && old !== encoded) throw Error('Retained acceptance evidence conflict');
    if (old === null) disk.setItem(key, encoded);
    if (disk.getItem(key) !== encoded) throw Error('Acceptance identity could not be retained');
  }
  function reconcile() {
    if (failed) return false;
    try {
      const keys: string[] = []; if (!Number.isSafeInteger(disk.length) || typeof disk.key !== 'function') throw Error();
      for (let n = 0; n < disk.length; n++) { const k = disk.key(n); if (k === null) throw Error(); keys.push(k); }
      priorRetained = keys.some(k => k.startsWith(prefix) && !k.startsWith(scope));
      const next: Retained[] = [];
      for (const k of keys.filter(k => k.startsWith(scope + 'identity:'))) {
        const i = JSON.parse(disk.getItem(k) ?? 'null') as Identity;
        if (!i || !id(i.id) || !id(i.proposalId) || !id(i.memberID) || !integer(i.revision) || !integer(i.row) || !integer(i.column) || k !== scope + 'identity:' + i.id || Object.keys(i).sort().join() !== 'column,id,memberID,proposalId,revision,row') throw Error();
        const r: Retained = { identity: i, confirm: false, abandon: false };
        const receipts: Receipt[] = [];
        for (const e of keys.filter(k => k.startsWith(scope + 'evidence:' + i.id + ':'))) {
          const value = JSON.parse(disk.getItem(e) ?? 'null');
          if (e === scope + 'evidence:' + i.id + ':confirm' || e === scope + 'evidence:' + i.id + ':abandon') {
            if (stable(value) !== stable(i)) throw Error();
            if (e.endsWith(':confirm')) r.confirm = true; else r.abandon = true;
          } else {
            const receipt = validate(value, i);
            if (e !== scope + 'evidence:' + i.id + ':' + receipt.phase + ':' + receipt.disposition) throw Error();
            // Check ALL evidence, not just the highest-ranked receipt: a terminal
            // prepared refusal must never hide earlier confirmed/admitted proof.
            for (const prior of receipts) {
              if (stable(prior.preview) !== stable(receipt.preview) || prior.request && receipt.request && stable(prior.request) !== stable(receipt.request)) throw Error();
              if ((unusedRefusal(prior) || abandoned(prior)) && positiveAdmission(receipt) || (unusedRefusal(receipt) || abandoned(receipt)) && positiveAdmission(prior)) throw Error();
              if (terminal(prior) && terminal(receipt) && stable(prior) !== stable(receipt) && !unusedTransition(prior, receipt) && !unusedTransition(receipt, prior)) throw Error();
            }
            receipts.push(receipt);
            if (!r.receipt || rank(receipt) > rank(r.receipt)) r.receipt = receipt;
          }
        }
        next.push(r);
      }
      // Orphan/malformed evidence is uncertainty, not permission to mint an ID.
      for (const k of keys.filter(k => k.startsWith(scope))) if (!next.some(r => k === scope + 'identity:' + r.identity.id || k.startsWith(scope + 'evidence:' + r.identity.id + ':'))) throw Error();
      records = next; if (!selected) selected = records.find(r => !terminal(r.receipt))?.identity.id ?? records.at(-1)?.identity.id;
      return true;
    } catch { failed = true; prepared = undefined; message = 'Retained acceptance metadata unavailable or conflicting. No request sent; preserve this storage for recovery.'; return false; }
  }
  const current = () => records.find(r => r.identity.id === selected);
  const candidate = (p: Proposal) => p.review === 'pending' && p.sheet === 'sheet-1' && p.revision === head() && integer(p.row) && integer(p.column);
  const matches = (r: Retained) => r.identity.memberID === native.getMemberID() && r.identity.revision === head() && proposals().some(p => p.id === r.identity.proposalId && candidate(p));
  function emit() {
    if (disposed) return; reconcile(); const r = current();
    if (!failed && !hidden && r?.receipt?.disposition === 'committed') message = `Recorded as native revision ${r.receipt.revision}. ${head() >= r.receipt.revision! ? 'Live editor has reached this revision.' : 'Waiting for native delivery; no local replay.'}`;
    const eligible = !failed && !active && ready() && !records.some(r => !terminal(r.receipt)) ? proposals().filter(p => candidate(p) && !records.some(r => r.identity.proposalId === p.id && !abandoned(r.receipt))).map(p => p.id) : [];
    changed({ message, active, locked, eligible, retained: records.map(r => ({ id: r.identity.id, proposalId: r.identity.proposalId })), selected, priorRetained,
      preview: r?.receipt && healthy() && !hidden ? r.receipt.preview : undefined,
      canConfirm: !failed && !active && ready() && !!r && prepared === r.identity.id && !r.confirm && !r.abandon && r.receipt?.phase === 'prepared' && r.receipt.disposition === 'unknown' && matches(r),
      canAbandon: !failed && !active && allowed() && healthy() && !!r && canAbandonUnused(r) });
  }
  function keep(receipt: Receipt, i: Identity) {
    validate(receipt, i); hidden = false; append(scope + 'evidence:' + i.id + ':' + receipt.phase + ':' + receipt.disposition, receipt); if (!reconcile()) throw Error('Retained acceptance evidence conflicts. No further action.');
    const r = records.find(r => r.identity.id === i.id)?.receipt;
    message = r?.disposition === 'committed' ? `Recorded as native revision ${r.revision}. ${head() >= r.revision! ? 'Live editor has reached this revision.' : 'Waiting for native delivery; no local replay.'}`
      : abandoned(r) ? 'Unused preview explicitly abandoned. Evidence retained. A fresh preview requires a separate action.'
      : r?.disposition === 'rejected' ? `Acceptance refused: ${r.reason}. Retained identity will not be retried.`
      : r?.phase === 'prepared' ? 'Preview prepared, not applied. Confirm explicitly, or abandon this unused preview.' : 'Acceptance outcome uncertain. Check status only; no reconnect or replay.';
    if (terminal(r)) { prepared = undefined; onTerminal(); }
  }
  async function request(i: Identity, signal: AbortSignal, operation?: 'prepare' | 'confirm' | 'abandon') {
    const url = operation === 'prepare' ? base : `${base}/${i.id}${operation ? '/' + operation : ''}`;
    const response = await fetcher(url, { credentials: 'same-origin', headers, signal, ...(operation ? { method: 'POST', body: JSON.stringify(operation === 'prepare' ? { commandId: i.id, proposalId: i.proposalId, memberID: i.memberID } : {}) } : {}) });
    if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'Access changed. Private preview hidden; identity retained.' : 'Request refused or outcome uncertain. Check status only; do not resend.');
    return validate(await response.json(), i);
  }
  async function run(i: Identity, operation: 'prepare' | 'confirm' | 'abandon' | 'check') {
    active = true; locked = operation === 'confirm'; const token = ++generation; abort = new AbortController(); const signal = abort.signal;
    timer = setTimeout(() => abort?.abort(), 30000); const live = () => !disposed && token === generation && !signal.aborted && healthy(); emit();
    try {
      const r = await request(i, signal, operation === 'check' ? undefined : operation); if (!live()) return;
      keep(r, i);
      if (operation === 'prepare' && r.phase === 'prepared' && r.disposition === 'unknown' && matches(current()!)) prepared = i.id;
      if (operation === 'confirm' && r.phase === 'confirmed' && r.disposition === 'unknown') {
        if (!ready() || !matches(current()!)) throw Error('Input or native revision changed. Confirmation retained; no submission or retry.');
        action = await openAction(path(i), signal); if (!live()) return;
        const admitted = await request(i, signal); if (!live()) return; keep(admitted, i);
        if (!ready() || !matches(current()!) || admitted.disposition !== 'unknown' || admitted.phase !== 'executor-admitted' || !admitted.request || admitted.request.memberID !== action.memberID) throw Error('Action identity/input changed. No submission; check retained status.');
        await action.submit(admitted.request); if (!live()) return;
        const final = await request(i, signal); if (live()) keep(final, i);
      }
    } catch (error) { if (!disposed && token === generation) { prepared = undefined; hidden = true; message = error instanceof Error ? error.message : 'Outcome uncertain; check status only.'; } }
    finally { clearTimeout(timer); action?.dispose(); action = undefined; if (!disposed && token === generation) { active = locked = false; emit(); } }
  }
  function write(key: string, value: unknown) { try { append(key, value); return true; } catch { failed = true; prepared = undefined; message = 'Cannot retain exact acceptance identity. No request sent.'; emit(); return false; } }
  async function preview(proposalId: string) {
    if (disposed || active || !reconcile() || !ready()) return;
    const p = proposals().find(p => p.id === proposalId);
    if (!p || !candidate(p) || records.some(r => !terminal(r.receipt) || r.identity.proposalId === proposalId && !abandoned(r.receipt))) { message = 'Proposal stale or an acceptance is retained. Check status; abandon only a confirmed-unused preview explicitly.'; emit(); return; }
    const memberID = native.getMemberID(); if (!id(memberID)) return;
    const i: Identity = { id: crypto.randomUUID(), proposalId, memberID, revision: p.revision, row: p.row, column: p.column };
    if (!id(i.memberID) || !write(scope + 'identity:' + i.id, i)) return;
    selected = i.id; prepared = undefined; await run(i, 'prepare');
  }
  async function confirm() {
    if (disposed || active || !reconcile() || !ready()) return; const r = current();
    if (!r || prepared !== r.identity.id || r.confirm || r.abandon || r.receipt?.phase !== 'prepared' || terminal(r.receipt) || !matches(r)) { message = 'Confirmation unavailable: finish input or check retained status. A new revision invalidates this preview.'; emit(); return; }
    if (!write(scope + 'evidence:' + r.identity.id + ':confirm', r.identity)) return;
    prepared = undefined; await run(r.identity, 'confirm');
  }
  async function abandon() {
    if (disposed || active || !reconcile() || !allowed() || !healthy()) return; const r = current();
    if (!r || !canAbandonUnused(r)) return;
    if (!write(scope + 'evidence:' + r.identity.id + ':abandon', r.identity)) return;
    prepared = undefined; await run(r.identity, 'abandon');
  }
  async function check(which = selected) {
    if (disposed || active || !allowed() || !healthy() || !reconcile()) return;
    const r = records.find(r => r.identity.id === which); if (!r) return; selected = which; await run(r.identity, 'check');
  }
  let wasOffline = false, connectionDetail = '';
  const status = native.sessionStatus$.subscribe(v => {
    if (v !== SessionStatus.ONLINE) {
      if (!wasOffline && hidden && !message.startsWith('Native connection restored.')) connectionDetail = message;
      wasOffline = true; prepared = undefined; abort?.abort();
      if (!failed) message = 'Disconnected. Acceptance identities retained; status recovery is GET only.';
    } else if (wasOffline) {
      wasOffline = false;
      // Connection state is not permission, confirmation or publication proof.
      // Reconcile retained evidence only; never re-arm or resume any action.
      if (reconcile()) message = records.length
        ? 'Native connection restored. Retained acceptance outcomes require a status check (GET only); unknown outcomes are not retried.' + (hidden && connectionDetail ? ` ${connectionDetail}` : '')
        : 'Native connection restored. Select a current proposal to preview; current authority and input checks still apply.';
    }
    emit();
  });
  emit();
  return { preview, confirm, abandon, check, active: () => active, locked: () => locked, refresh() { if (!healthy() || inputBusy() || current() && !matches(current()!)) prepared = undefined; emit(); }, dispose() { disposed = true; generation++; clearTimeout(timer); abort?.abort(); action?.dispose(); action = undefined; status.unsubscribe(); active = locked = false; changed({ ...emptyAcceptanceView, message: 'Acceptance session closed. Identities retained; no automatic replay.' }); } };
}
