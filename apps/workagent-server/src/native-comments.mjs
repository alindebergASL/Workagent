// Immutable bodies belong to Workspace; membership/anchors belong only to Univer.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
import { CollabError, UnitSnapshotMaterializer } from '@univerjs-pro/collaboration-service';
import { transformSnapshotToWorkbookData } from '@univerjs-pro/collaboration';
import { deserializeRangeWithSheet } from '@univerjs/engine-formula';
import { UniverType } from '@univerjs/protocol';
export const ADD_COMMENT = 'thread-comment.mutation.add-comment';
export const RESOLVE_COMMENT = 'thread-comment.mutation.resolve-comment';
export const DELETE_COMMENT = 'thread-comment.mutation.delete-comment';
const REMOVE = 'sheet.mutation.remove-rows', TAB = 'sheet-1', RESOURCE = 'SHEET_UNIVER_THREAD_COMMENT_PLUGIN';
const refuse = (code = 'native_comment_refused') => { throw new Fault(code, 409); };
// Convert only our known pre-commit policy refusals. Never classify a native
// commit/adapter exception (which may have committed) as a definitive rejection.
const policyRefusals = new Set(['native_comment_refused', 'native_comment_claim_mismatch', 'native_comment_request_reuse', 'native_comment_stale_anchor', 'native_comment_id_conflict', 'native_comment_root_absent', 'native_comment_structural_batch', 'native_comment_incomplete_delete']);
export async function nativeCommentPolicy(effect) {
  try { return await effect(); } catch (error) {
    if (error instanceof Fault && policyRefusals.has(error.code)) throw new CollabError('PERMISSION_DENIED', error.code, { retryable: false });
    if (error instanceof Fault && error.code === 'native_comment_head_changed') throw new CollabError('REVISION_MISMATCH', error.code, { retryable: true });
    throw error;
  }
}
const identifier = x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x) && !['__proto__', 'constructor', 'prototype'].includes(x);
export function cellAnchor(ref, sheet) {
  if (typeof ref !== 'string' || !/^[A-Z]{1,4}[1-9][0-9]{0,6}$/.test(ref)) refuse();
  const { range } = deserializeRangeWithSheet(ref);
  if (!sheet || !Number.isSafeInteger(range.startRow) || range.startRow !== range.endRow || range.startColumn !== range.endColumn || range.startRow >= sheet.rowCount || range.startColumn >= sheet.columnCount) refuse();
  return range;
}
export function nativeCommentView(data, revision) {
  const raw = data.resources?.find(r => r.name === RESOURCE);
  const roots = raw ? JSON.parse(raw.data)[TAB] ?? [] : [];
  if (!Array.isArray(roots)) refuse('native_comment_resource_invalid');
  return { revision, roots, sheet: data.sheets[TAB] };
}
export class NativeComments {
  constructor(authority, service, dbAdapter) { Object.assign(this, { authority, service, dbAdapter }); }
  async prepare(principal, unitID, session) {
    // This native read takes its OWN Workspace fence. Never call inside a store transaction.
    const loaded = await this.authority.scope.run({ unitID, session }, () => this.service.getUnitLoadDataWithBlocks({ unitID, type: UniverType.UNIVER_SHEET, revision: 0 }, { userID: principal }));
    const materializer = new UnitSnapshotMaterializer({ execution: { mode: 'in-process' } });
    try {
      const head = await materializer.materializeSnapshot(loaded);
      const view = nativeCommentView(await transformSnapshotToWorkbookData(head.snapshot, [...head.sheetBlocks]), loaded.targetRevision);
      // The server serializer drops resolved. Only admitted operations need
      // exact native-history evidence; ordinary revision growth is irrelevant.
      const actions = await this.authority.workspace.store.read(s => {
        this.authority.check(s, principal, unitID, false, session);
        return Object.values(s.works[unitID].nativeCommentActions ?? {});
      });
      const latest = new Map();
      for (const a of actions) if (a.attempt && !a.abandoned && a.head < view.revision && (!latest.has(a.input.commentId) || latest.get(a.input.commentId).head < a.head)) latest.set(a.input.commentId, a);
      // At most one exact-revision lookup per live root, serial (no unbounded
      // Promise fan-out or scan of unrelated cell edits). Admission caps records.
      for (const root of view.roots) {
        const action = latest.get(root.id); if (!action) continue;
        const receipt = await this.actionReceipt(principal, unitID, action);
        if (receipt.status === 'committed') root.resolved = receipt.resolved;
        else { delete root.resolved; root.resolutionUnknown = true; }
      }
      return view;
    } finally { await materializer.dispose(); }
  }
  async current(principal, unitID, view) {
    const unit = await this.dbAdapter.getUnit({ userID: principal, customData: {}, request: {} }, unitID);
    if (!unit || unit.headRevision !== view.revision) refuse('native_comment_head_changed');
  }
  async claim(principal, name, unitID, session, input, send) {
    if (!input || Object.keys(input).some(k => !['id', 'parentId', 'ref', 'body'].includes(k)) || !identifier(input.id) || (input.parentId !== undefined && !identifier(input.parentId)) || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 8000 || /[\u0000-\u0008\u000b-\u001f]/.test(input.body)) refuse();
    const view = await this.prepare(principal, unitID, session);
    await this.authority.workspace.store.transaction(async s => {
      const access = this.authority.check(s, principal, unitID, true, session);
      await this.current(principal, unitID, view);
      const root = input.parentId && view.roots.find(r => r.id === input.parentId);
      if (input.parentId && !root) refuse('native_comment_root_absent');
      const ref = root ? root.ref : input.ref; cellAnchor(ref, view.sheet);
      if (root && input.ref !== root.ref) refuse('native_comment_anchor_changed');
      const w = s.works[unitID], claims = w.nativeCommentClaims ??= {};
      const old = claims[input.id];
      if (old) {
        if (old.principal !== principal || old.epoch !== access.revision || old.comment.parentId !== input.parentId || old.comment.text.dataStream !== input.body + '\r\n' || old.comment.ref !== ref) refuse('native_comment_id_conflict');
        if (old.attempt && !view.roots.some(r => r.id === input.id || r.children?.some(c => c.id === input.id))) refuse('native_comment_attempt_retained');
        return;
      }
      if (Object.keys(claims).length >= 4096 || view.roots.some(r => r.id === input.id || r.children?.some(c => c.id === input.id))) refuse('native_comment_id_conflict');
      const comment = { id: input.id, threadId: input.parentId ?? input.id, unitId: unitID, subUnitId: TAB, personId: principal, authorName: name,
        ref, dT: new Date().toISOString(), text: { dataStream: input.body + '\r\n', paragraphs: [{ startIndex: input.body.length }] }, ...(input.parentId ? { parentId: input.parentId } : {}) };
      claims[input.id] = { principal, epoch: access.revision, head: view.revision, comment };
      // The HTTP response is sent only AFTER durable transaction completion below.
    });
    // A second lock checks access at enqueue, and returns only this actor's claim.
    await this.authority.workspace.store.transaction(s => {
      this.authority.check(s, principal, unitID, true, session);
      send(s.works[unitID].nativeCommentClaims[input.id].comment);
    });
  }
  async list(principal, unitID, session, send, pendingID) {
    if (pendingID !== undefined && !identifier(pendingID)) refuse();
    const view = await this.prepare(principal, unitID, session);
    await this.authority.workspace.store.transaction(async s => {
      this.authority.check(s, principal, unitID, false, session); await this.current(principal, unitID, view);
      const claims = s.works[unitID].nativeCommentClaims ?? {};
      const hydrate = (meta, ref) => {
        const claim = claims[meta.id];
        if (!claim || meta.personId !== claim.principal || meta.threadId !== claim.comment.threadId) return null;
        return { ...claim.comment, ...(meta.resolutionUnknown ? { resolutionUnknown: true, resolved: undefined } : { resolved: meta.resolved === true }), ref, children: (meta.children ?? []).map(c => hydrate(c, ref)).filter(Boolean) };
      };
      const receipt = pendingID === undefined ? undefined : await this.ownReceipt(principal, unitID, session, claims[pendingID], pendingID, view);
      const actions = [];
      for (const a of Object.values(s.works[unitID].nativeCommentActions ?? {}).filter(a => a.principal === principal && a.epoch === session.revision && a.binding === session.binding)) actions.push(await this.actionReceipt(principal, unitID, a));
      await this.current(principal, unitID, view);
      send({ actions, revision: view.revision, comments: view.roots.map(r => hydrate(r, r.ref)).filter(Boolean), ...(receipt ? { receipt } : {}) });
    });
  }
  // Called only under list's current ACL/epoch/head fence, never via a native
  // read middleware (no nested Workspace transaction). Public adapter history is
  // evidence, not a second dedup ledger. Missing/pruned history stays unknown.
  async ownReceipt(principal, unitID, session, claim, id, view) {
    const unknown = { id, status: 'unknown' };
    if (!claim?.attempt || claim.principal !== principal || claim.epoch !== session.revision || !Number.isSafeInteger(claim.head) || claim.head >= view.revision) return unknown;
    // Admission only permits an unrebasable add at exactly claim.head; the SDK
    // commits it at head+1. Adapter range is (from, to], verified in pinned 1.4.0.
    const history = await this.dbAdapter.getChangesets({ userID: principal, customData: {}, request: {} }, unitID, { from: claim.head, to: claim.head + 1 });
    const committed = history?.find(c => c.unitID === unitID && c.type === UniverType.UNIVER_SHEET && c.revision === claim.head + 1 && c.userID === principal && c.sid === claim.attempt.sid && c.reqId === claim.attempt.reqId && createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex') === claim.attempt.hash);
    if (!committed) return unknown;
    const present = view.roots.some(r => r.id === id || r.children?.some(c => c.id === id));
    return { id, status: present ? 'committed-present' : 'committed-removed', revision: committed.revision };
  }
  needs(changeset) { return changeset.mutations.some(m => [ADD_COMMENT, DELETE_COMMENT, RESOLVE_COMMENT, REMOVE].includes(m.id)); }
  async prepareAction(principal, unitID, session, input, send) {
    if (!input || Object.keys(input).sort().join() !== 'commentId,id,memberID,resolved' || !identifier(input.id) || !identifier(input.commentId) || !identifier(input.memberID) || typeof input.resolved !== 'boolean' || !session.binding) refuse();
    const view = await this.prepare(principal, unitID, session);
    await this.authority.workspace.store.transaction(async s => {
      const access = this.authority.check(s, principal, unitID, true, session);
      await this.current(principal, unitID, view);
      const member = this.authority.sessions.get(input.memberID);
      if (!member || member.action || member.userID !== principal || member.unitID !== unitID || member.revision !== session.revision || member.binding !== session.binding) refuse();
      const root = view.roots.find(r => r.id === input.commentId);
      if (!root || root.resolutionUnknown || (access.role !== 'owner' && root.personId !== principal)) refuse();
      const actions = s.works[unitID].nativeCommentActions ??= {};
      const old = actions[input.id];
      if (old) {
        if (old.principal !== principal || old.epoch !== session.revision || old.binding !== session.binding || !isDeepStrictEqual(old.input, input)) refuse('native_comment_id_conflict');
        return;
      }
      if ((root.resolved === true) === input.resolved || Object.keys(actions).length >= 4096 || Object.values(actions).some(a => a.head === view.revision && a.input.commentId === input.commentId && (!a.abandoned || (a.input.memberID === input.memberID && a.input.resolved === input.resolved)))) refuse('native_comment_request_reuse');
      actions[input.id] = { input: structuredClone(input), principal, epoch: session.revision, binding: session.binding, head: view.revision, ref: root.ref, author: root.personId, before: root.resolved === true };
    });
    await this.authority.workspace.store.transaction(async s => {
      this.authority.check(s, principal, unitID, true, session);
      send(await this.actionReceipt(principal, unitID, s.works[unitID].nativeCommentActions[input.id]));
    });
  }
  async abandonAction(principal, unitID, session, id, send) {
    if (!identifier(id) || !session.binding) refuse();
    await this.authority.workspace.store.transaction(s => {
      this.authority.check(s, principal, unitID, true, session);
      const a = s.works[unitID].nativeCommentActions?.[id];
      if (!a || a.principal !== principal || a.epoch !== session.revision || a.binding !== session.binding || a.attempt) refuse();
      // Same transaction lock as bind(): admission or abandonment wins, never both.
      // Original claim and attempt identity are never rewritten or removed.
      a.abandoned = true;
    });
    await this.authority.workspace.store.transaction(async s => {
      this.authority.check(s, principal, unitID, true, session);
      send(await this.actionReceipt(principal, unitID, s.works[unitID].nativeCommentActions[id]));
    });
  }
  async actionReceipt(principal, unitID, action) {
    const receipt = { ...action.input, status: action.abandoned ? 'abandoned' : 'unknown', phase: action.abandoned ? 'abandoned' : action.attempt ? 'admitted' : 'prepared', head: action.head };
    if (action.abandoned) return receipt;
    if (!action.attempt) return receipt;
    const history = await this.dbAdapter.getChangesets({ userID: principal, customData: {}, request: {} }, unitID, { from: action.head, to: action.head + 1 });
    const match = history?.find(c => c.unitID === unitID && c.type === UniverType.UNIVER_SHEET && c.revision === action.head + 1 && c.userID === action.principal && c.memberID === action.input.memberID && c.sid === action.attempt.sid && c.reqId === action.attempt.reqId && createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex') === action.attempt.hash);
    if (!match || match.baseRev !== action.head || match.mutations.length !== 1 || match.mutations[0].id !== RESOLVE_COMMENT) return receipt;
    let p; try { p = JSON.parse(match.mutations[0].data); } catch { return receipt; }
    if (p.unitId !== unitID || p.subUnitId !== TAB || p.commentId !== action.input.commentId || p.resolved !== action.input.resolved || Object.keys(p).some(k => !['unitId','subUnitId','commentId','resolved','trigger'].includes(k))) return receipt;
    return { ...receipt, status: 'committed', revision: match.revision };
  }
  resolution(s, context, session) {
    const c = context.request.changeset;
    if (!c.mutations.some(m => m.id === RESOLVE_COMMENT)) return;
    if (c.mutations.length !== 1) refuse();
    const p = JSON.parse(c.mutations[0].data);
    if (Object.keys(p).some(k => !['unitId','subUnitId','commentId','resolved','trigger'].includes(k)) || typeof p.resolved !== 'boolean') refuse();
    const matches = Object.values(s.works[c.unitID].nativeCommentActions ?? {}).filter(a => a.principal === context.userID && a.epoch === session.revision && a.binding === session.binding && a.input.memberID === context.memberID && a.head === c.baseRev && a.input.commentId === p.commentId && a.input.resolved === p.resolved);
    if (matches.length !== 1 || matches[0].abandoned) refuse('native_comment_claim_mismatch');
    return matches[0];
  }
  bind(s, context, session, admission) {
    const action = this.resolution(s, context, session);
    if (action) {
      const c = context.request.changeset, attempt = { sid: c.sid, reqId: c.reqId, hash: createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex') };
      if (action.attempt && !isDeepStrictEqual(action.attempt, attempt)) refuse('native_comment_request_reuse');
      if (!action.attempt) { if (!admission) refuse(); action.attempt = attempt; }
    }
    const c = context.request.changeset, claims = s.works[c.unitID].nativeCommentClaims ?? {};
    for (const m of c.mutations.filter(m => m.id === ADD_COMMENT)) {
      const p = JSON.parse(m.data), claim = claims[p.comment?.id];
      if (!claim || claim.principal !== context.userID || claim.epoch !== session.revision || !isDeepStrictEqual(claim.comment, p.comment)) refuse('native_comment_claim_mismatch');
      const attempt = { sid: c.sid, reqId: c.reqId, hash: createHash('sha256').update(JSON.stringify(c.mutations)).digest('hex') };
      if (claim.attempt && !isDeepStrictEqual(claim.attempt, attempt)) refuse('native_comment_request_reuse');
      if (!claim.attempt) { if (!admission) refuse(); claim.attempt = attempt; }
    }
  }
  validate(s, context, view) {
    const c = context.changeset, original = context.request.changeset;
    const parsed = c.mutations.map(m => ({ id: m.id, p: JSON.parse(m.data) }));
    if (parsed.some(m => m.id === RESOLVE_COMMENT)) {
      const session = this.authority.sessions.get(context.memberID), action = this.resolution(s, context, session);
      const root = view.roots.find(r => r.id === action?.input.commentId);
      const access = this.authority.check(s, context.userID, c.unitID, true, session);
      if (!action || parsed.length !== 1 || original.baseRev !== view.revision || action.head !== view.revision || !isDeepStrictEqual(c.mutations, original.mutations) || !root || root.resolutionUnknown || root.ref !== action.ref || root.personId !== action.author || (root.resolved === true) !== action.before || (access.role !== 'owner' && root.personId !== context.userID)) refuse('native_comment_stale_anchor');
      return;
    }
    const adds = parsed.filter(m => m.id === ADD_COMMENT), removes = parsed.filter(m => m.id === REMOVE), deletes = parsed.filter(m => m.id === DELETE_COMMENT);
    if (adds.length) {
      // Revisionless client anchors cannot safely be rebased here. Explicit refusal,
      // with private claim retained; never guess a transform or replay a new request.
      if (adds.length !== 1 || parsed.length !== 1 || original.baseRev !== view.revision) refuse('native_comment_stale_anchor');
      const comment = adds[0].p.comment, claim = s.works[c.unitID].nativeCommentClaims?.[comment?.id];
      if (!claim || claim.head !== view.revision || !isDeepStrictEqual(comment, claim.comment)) refuse('native_comment_stale_anchor');
      if (view.roots.some(r => r.id === comment.id || r.children?.some(x => x.id === comment.id))) refuse('native_comment_id_conflict');
      cellAnchor(comment.ref, view.sheet);
      if (comment.parentId && !view.roots.some(r => r.id === comment.parentId && r.ref === comment.ref && r.threadId === comment.threadId)) refuse('native_comment_root_absent');
    }
    if (!view.roots.length && !adds.length && !deletes.length) return; // Existing comment-free native rebasing remains qualified.
    if (removes.length || deletes.length) {
      // Bounded single native row-range command. Reject unqualified mixtures and
      // stale structural rebases rather than interpreting client trigger strings.
      if (removes.length !== 1 || parsed.length !== 1 + deletes.length || parsed[0].id !== REMOVE || original.baseRev !== view.revision) refuse('native_comment_structural_batch');
      const range = removes[0].p.range;
      if (!range || !Number.isSafeInteger(range.startRow) || !Number.isSafeInteger(range.endRow) || range.startRow < 0 || range.endRow < range.startRow || range.endRow >= view.sheet.rowCount) refuse();
      const expected = view.roots.filter(r => { const a = cellAnchor(r.ref, view.sheet); return a.startRow >= range.startRow && a.startRow <= range.endRow; }).map(r => r.id).sort();
      const actual = deletes.map(m => m.p.commentId).sort();
      if (!isDeepStrictEqual(actual, expected)) refuse('native_comment_incomplete_delete');
    }
  }
}
