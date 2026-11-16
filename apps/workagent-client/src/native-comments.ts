import { AddCommentCommand, AddCommentMutation, ResolveCommentCommand, ResolveCommentMutation } from '@univerjs/thread-comment';
import type { IThreadComment, IThreadCommentDataSource, IThreadCommentDataSourceService } from '@univerjs/thread-comment';
import type { ICommandService } from '@univerjs/core';
import type { NativeSession } from './NativeCollaborationEditor';
type CommentRoot = IThreadComment & { resolutionUnknown?: boolean };
export interface CommentView { comments: CommentRoot[]; message: string; pending: boolean; confirmed?: string; removed?: string; resolution?: string; resolutionBusy?: boolean; abandonable?: string[] }
// Scoped to the existing native instance. No facade side effects or extra session.
export function nativeComments(session: NativeSession, source: IThreadCommentDataSourceService, commands: ICommandService,
  allowed: () => boolean, update: (view: CommentView) => void, request: typeof fetch = fetch, memberID: () => string = () => '', disk?: Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>) {
  type Action = { id: string; commentId: string; memberID: string; resolved: boolean };
  const scope = `workagent:native-comment-resolution:${session.principal}:${session.unitID}:${session.binding}:${session.access.revision}:`;
  let receipts = new Map<string, { phase: string; status: string; head: number }>(), currentRevision = 0;
  let retired: { action: Action; head: number }[] = [];
  let actions: Action[] = [], resolution = '', resolutionBusy = false, executing: Action | undefined, storageFailed = false;
  const reconcile = () => {
    if (!disk) return false;
    try {
      const result: Action[] = []; retired = [];
      if (!Number.isSafeInteger(disk.length)) throw Error();
      for (let n = 0; n < disk.length; n++) {
        const key = disk.key(n); if (key === null) throw Error(); if (!key.startsWith(scope + 'intent:')) continue;
        const a = JSON.parse(disk.getItem(key) ?? 'null');
        if (!a || Object.keys(a).sort().join() !== 'commentId,id,memberID,resolved' || ![a.id,a.commentId,a.memberID].every(x => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x)) || typeof a.resolved !== 'boolean' || key !== scope + 'intent:' + a.id) throw Error('Invalid retained resolution identity');
        const receipt = disk.getItem(scope + 'committed:' + a.id);
        if (receipt !== null && receipt !== JSON.stringify(a)) throw Error('Conflicting resolution evidence');
        const abandoned = disk.getItem(scope + 'abandoned:' + a.id);
        for (const prefix of ['started:', 'abandon-request:']) { const marker = disk.getItem(scope + prefix + a.id); if (marker !== null && marker !== JSON.stringify(a)) throw Error('Conflicting resolution attempt evidence'); }
        if (abandoned !== null) {
          const proof = JSON.parse(abandoned);
          if (receipt !== null || disk.getItem(scope + 'started:' + a.id) !== null || proof.id !== a.id || proof.commentId !== a.commentId || proof.memberID !== a.memberID || proof.resolved !== a.resolved || proof.status !== 'abandoned' || proof.phase !== 'abandoned' || !Number.isSafeInteger(proof.head)) throw Error('Conflicting abandoned resolution evidence');
          retired.push({ action: a, head: proof.head });
        } else if (receipt === null) result.push(a);
      }
      actions = result; return !storageFailed;
    } catch { storageFailed = true; resolution = 'Resolution recovery metadata unavailable. No action will be sent.'; return false; }
  };
  const append = (key: string, value: unknown) => {
    if (!disk) throw Error('Resolution storage unavailable');
    const encoded = JSON.stringify(value), old = disk.getItem(scope + key);
    if (old !== null && old !== encoded) throw Error('Resolution evidence conflict');
    if (old === null) disk.setItem(scope + key, encoded);
    if (disk.getItem(scope + key) !== encoded) throw Error('Resolution evidence could not be retained');
  };
  const abandonable = () => reconcile() && !resolutionBusy && session.access.role !== 'read' ? actions.filter(a => receipts.get(a.id)?.status === 'unknown' && receipts.get(a.id)?.phase === 'prepared' && disk!.getItem(scope + 'started:' + a.id) === null && disk!.getItem(scope + 'abandon-request:' + a.id) === null).map(a => a.id) : [];
  reconcile();
  const controller = new AbortController(); let live = true, pending: string | undefined, checking = false;
  let comments: CommentRoot[] = [], nativeAttempt = false, notice = '', removed: string | undefined;
  const mutationStart = commands.beforeCommandExecuted(command => {
    const params = command.params as { unitId?: string; comment?: { id?: string }; commentId?: string; resolved?: boolean } | undefined;
    if (command.id === ResolveCommentMutation.id && executing && params?.unitId === session.unitID && params.commentId === executing.commentId) {
      if (!live || !allowed() || memberID() !== executing.memberID || params.resolved !== executing.resolved || disk?.getItem(scope + 'abandon-request:' + executing.id) !== null || disk?.getItem(scope + 'abandoned:' + executing.id) !== null) throw Error('Resolution changed before native mutation; check retained status');
      append('started:' + executing.id, executing);
    }
    if (command.id === AddCommentMutation.id && params?.unitId === session.unitID && params.comment?.id === pending) nativeAttempt = true;
  });
  const url = `/api/work/${session.unitID}/native-comments/${session.access.revision}`;
  const assertScope = (unit: string, sub: string) => { if (!live || unit !== session.unitID || sub !== 'sheet-1') throw Error('Comment session changed'); };
  const call = async (body?: object, pendingID?: string) => {
    const response = await request(url + (pendingID ? `?pending=${encodeURIComponent(pendingID)}` : ''), { signal: controller.signal, method: body ? 'POST' : 'GET', headers: { 'X-Workagent-Session-Binding': session.binding, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!live) throw Error('Comment session changed');
    if (!response.ok) throw Error(`Comment request refused (${response.status}); draft retained`);
    const value = await response.json(); if (!live) throw Error('Comment session changed'); return value;
  };
  const unavailable = async () => { throw Error('Comment editing and manual deletion are not enabled'); };
  const dataSource: IThreadCommentDataSource = {
    async addComment(comment) {
      assertScope(comment.unitId, comment.subUnitId);
      if (!allowed() || session.access.role === 'read') throw Error('Comment creation is unavailable while input or native edits are pending');
      return call({ id: comment.id, ref: comment.ref, body: comment.text.dataStream.slice(0, -2), ...(comment.parentId ? { parentId: comment.parentId } : {}) });
    },
    updateComment: unavailable,
    async resolveComment(comment) {
      assertScope(comment.unitId, comment.subUnitId);
      const a = executing;
      if (!a || comment.id !== a.commentId || comment.resolved !== a.resolved || !allowed() || a.memberID !== memberID()) throw Error('Resolution is unavailable; retained identity requires a status check');
      const response = await request(url + '/actions', { method: 'POST', signal: controller.signal, headers: { 'X-Workagent-Session-Binding': session.binding, 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
      if (!live || !response.ok) throw Error('Resolution preparation refused or unavailable; identity retained, no automatic retry');
      const receipt = await response.json();
      if (!live || !allowed() || memberID() !== a.memberID || receipt.id !== a.id || receipt.commentId !== a.commentId || receipt.memberID !== a.memberID || receipt.resolved !== a.resolved || receipt.status !== 'unknown') throw Error('Resolution preparation changed; check status without retry');
      return true;
    }, deleteComment: unavailable, deleteThread: unavailable,
    async listComments(unit, sub, threads) { assertScope(unit, sub); const value = await call(); return value.comments.filter((c: IThreadComment) => threads.includes(c.threadId)); },
    saveCommentToSnapshot: comment => comment,
  };
  source.dataSource = dataSource; source.syncUpdateMutationToColla = true;
  const refresh = async () => {
    if (!live || checking) return; checking = true;
    try {
      const value = await call(undefined, pending); comments = value.comments; currentRevision = value.revision; receipts = new Map();
      reconcile();
      for (const a of actions) {
        const receipt = value.actions?.find((r: Action) => r.id === a.id);
        if (receipt && receipt.commentId === a.commentId && receipt.memberID === a.memberID && receipt.resolved === a.resolved && Number.isSafeInteger(receipt.head)) {
          receipts.set(a.id, receipt);
          if (receipt.status === 'abandoned' && receipt.phase === 'abandoned') { append('abandoned:' + a.id, receipt); resolution = 'Unused resolution abandoned. A new request is explicit; the same thread needs a newer native revision or a reopened editor.'; }
        }
        if (receipt?.status === 'committed' && receipt.commentId === a.commentId && receipt.memberID === a.memberID && receipt.resolved === a.resolved && Number.isSafeInteger(receipt.revision) && receipt.revision > 0 && receipt.revision <= value.revision) {
          try { append('committed:' + a.id, a); resolution = `Thread ${a.resolved ? 'resolution' : 'reopening'} recorded at native revision ${receipt.revision}.`; }
          catch { storageFailed = true; resolution = 'Cannot retain committed resolution evidence; no new action enabled.'; }
        }
      }
      reconcile();
      if (actions.length && !storageFailed) resolution = 'Retained thread resolution outcome unknown. Check status (GET only); no automatic retry.';
      const confirmed = pending && comments.some(c => c.id === pending || c.children?.some(r => r.id === pending)) ? pending : undefined;
      if (confirmed) { pending = undefined; notice = ''; removed = undefined; }
      else if (pending && value.receipt?.id === pending && value.receipt.status === 'committed-removed' && Number.isSafeInteger(value.receipt.revision) && value.receipt.revision > 0 && value.receipt.revision <= value.revision) {
        removed = pending; pending = undefined;
        notice = 'Comment was committed, then removed. Draft retained. Choose a new cell comment or clear the unsent draft; nothing will be replayed.';
      }
      update({ comments, pending: !!pending, confirmed, removed, resolution, resolutionBusy, abandonable: abandonable(), message: pending ? (notice || 'Comment awaiting native confirmation — keep this draft open') : (notice || 'Published comments at native revision ' + value.revision) });
    } catch (error) { if (live) update({ comments: [], pending: !!pending, removed, resolution, resolutionBusy, abandonable: abandonable(), message: String(error) }); }
    finally { checking = false; }
  };
  return {
    refresh,
    pending: () => !!pending || resolutionBusy,
    canResolve(root: CommentRoot) { return live && reconcile() && !root.resolutionUnknown && !actions.some(a => a.commentId === root.id) && !retired.some(r => r.action.commentId === root.id && r.action.memberID === memberID() && r.head === currentRevision && r.action.resolved === (root.resolved !== true)) && !resolutionBusy && !pending && allowed() && !!memberID() && session.access.role !== 'read' && (session.owner || root.personId === session.principal); },
    async resolve(root: CommentRoot) {
      if (!this.canResolve(root)) return;
      const a: Action = { id: crypto.randomUUID(), commentId: root.id, memberID: memberID(), resolved: root.resolved !== true };
      try {
        const key = scope + 'intent:' + a.id, encoded = JSON.stringify(a);
        if (disk!.getItem(key) !== null) throw Error();
        disk!.setItem(key, encoded); if (disk!.getItem(key) !== encoded) throw Error();
      } catch { storageFailed = true; resolution = 'Cannot retain resolution identity. No request sent.'; update({ comments, pending: !!pending, message: notice || 'Published comments — bodies unchanged', resolution }); return; }
      resolutionBusy = true; executing = a; resolution = 'Thread state change awaiting native confirmation; no automatic retry.';
      update({ comments, pending: !!pending, message: notice || 'Published comments — bodies unchanged', resolution, resolutionBusy });
      try {
        if (!await commands.executeCommand(ResolveCommentCommand.id, { unitId: session.unitID, subUnitId: 'sheet-1', commentId: a.commentId, resolved: a.resolved })) throw Error('Native resolution command did not complete');
      } catch (error) { resolution = String(error) + ' Identity retained. Check status (GET only).'; }
      finally { executing = undefined; resolutionBusy = false; if (live) update({ comments, pending: !!pending, message: notice || 'Published comments — bodies unchanged', resolution, resolutionBusy }); }
    },
    async abandon(id: string) {
      if (!live || !allowed() || !abandonable().includes(id)) return;
      const a = actions.find(a => a.id === id)!;
      try { append('abandon-request:' + id, a); } catch { storageFailed = true; resolution = 'Cannot retain abandonment identity. No request sent.'; return; }
      resolutionBusy = true;
      try {
        const response = await request(url + '/actions/' + id + '/abandon', { method: 'POST', signal: controller.signal, headers: { 'X-Workagent-Session-Binding': session.binding, 'Content-Type': 'application/json' }, body: '{}' });
        if (!live || !response.ok) throw Error('Abandonment not confirmed; use GET status only');
        const r = await response.json();
        if (!live || r.id !== a.id || r.commentId !== a.commentId || r.memberID !== a.memberID || r.resolved !== a.resolved || r.status !== 'abandoned' || r.phase !== 'abandoned' || !Number.isSafeInteger(r.head)) throw Error('Abandonment response mismatch; use GET status only');
        append('abandoned:' + id, r); reconcile();
        resolution = 'Unused resolution abandoned. New requests are explicit; the same thread needs a newer native revision or a reopened editor.';
      } catch (error) { if (live) resolution = String(error) + ' Identity retained; no automatic retry.'; }
      finally { resolutionBusy = false; if (live) update({ comments, pending: !!pending, message: notice || 'Published comments — bodies unchanged', resolution, resolutionBusy, abandonable: abandonable() }); }
    },
    canAdd: () => live && !pending && !resolutionBusy && !removed && allowed() && session.access.role !== 'read',
    explain(message: string) { notice = message; if (live) update({ comments, pending: !!pending, removed, message }); },
    newDraft() {
      if (!live || pending) return;
      removed = undefined; notice = 'New comment draft — no request sent';
      update({ comments, pending: false, message: notice });
    },
    async add(body: string, ref: string, parentId?: string) {
      if (!live) return;
      if (pending || resolutionBusy || removed || !allowed() || session.access.role === 'read') {
        update({ comments, pending: !!pending, removed, message: removed ? notice : session.access.role === 'read' ? 'Read-only — comments can be read' : 'Finish active cell input, paste or pending native edits before adding a comment. Draft retained.' }); return;
      }
      pending = crypto.randomUUID(); nativeAttempt = false; notice = '';
      const comment: IThreadComment = { id: pending, threadId: parentId ?? pending, unitId: session.unitID, subUnitId: 'sheet-1', personId: session.principal, authorName: session.name, ref, dT: '', text: { dataStream: body + '\r\n' }, ...(parentId ? { parentId } : {}) };
      update({ comments, pending: true, message: 'Preparing private comment body — not published' });
      try {
        const result = await commands.executeCommand(AddCommentCommand.id, { unitId: session.unitID, subUnitId: 'sheet-1', comment });
        if (!result) throw Error('Native comment command refused; draft retained');
        if (live) update({ comments, pending: true, message: 'Comment awaiting native confirmation — keep this draft open' });
      } catch (error) {
        // Public before-command notification fences the native-effect boundary.
        // A rejected prewrite can retain a private body, but cannot have added it
        // natively. After mutation entry, even a thrown command is uncertain.
        if (!nativeAttempt) pending = undefined;
        notice = String(error) + (nativeAttempt ? ' Native outcome unknown; keep this draft open. No automatic retry.' : ' No native add began. Edit this draft or choose a new explicit action; no automatic retry.');
        if (live) update({ comments, pending: !!pending, message: notice });
      }
    },
    dispose() { live = false; controller.abort(); mutationStart.dispose(); if (source.dataSource === dataSource) source.dataSource = null; },
  };
}
