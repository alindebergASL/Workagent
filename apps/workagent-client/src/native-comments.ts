import { AddCommentCommand, AddCommentMutation } from '@univerjs/thread-comment';
import type { IThreadComment, IThreadCommentDataSource, IThreadCommentDataSourceService } from '@univerjs/thread-comment';
import type { ICommandService } from '@univerjs/core';
import type { NativeSession } from './NativeCollaborationEditor';
export interface CommentView { comments: IThreadComment[]; message: string; pending: boolean; confirmed?: string; removed?: string }
// Scoped to the existing native instance. No facade side effects or extra session.
export function nativeComments(session: NativeSession, source: IThreadCommentDataSourceService, commands: ICommandService,
  allowed: () => boolean, update: (view: CommentView) => void, request: typeof fetch = fetch) {
  const controller = new AbortController(); let live = true, pending: string | undefined, checking = false;
  let comments: IThreadComment[] = [], nativeAttempt = false, notice = '', removed: string | undefined;
  const mutationStart = commands.beforeCommandExecuted(command => {
    const params = command.params as { unitId?: string; comment?: { id?: string } } | undefined;
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
  const unavailable = async () => { throw Error('Comment editing, resolution and manual deletion are not enabled'); };
  const dataSource: IThreadCommentDataSource = {
    async addComment(comment) {
      assertScope(comment.unitId, comment.subUnitId);
      if (!allowed() || session.access.role === 'read') throw Error('Comment creation is unavailable while input or native edits are pending');
      return call({ id: comment.id, ref: comment.ref, body: comment.text.dataStream.slice(0, -2), ...(comment.parentId ? { parentId: comment.parentId } : {}) });
    },
    updateComment: unavailable, resolveComment: unavailable, deleteComment: unavailable, deleteThread: unavailable,
    async listComments(unit, sub, threads) { assertScope(unit, sub); const value = await call(); return value.comments.filter((c: IThreadComment) => threads.includes(c.threadId)); },
    saveCommentToSnapshot: comment => comment,
  };
  source.dataSource = dataSource; source.syncUpdateMutationToColla = true;
  const refresh = async () => {
    if (!live || checking) return; checking = true;
    try {
      const value = await call(undefined, pending); comments = value.comments;
      const confirmed = pending && comments.some(c => c.id === pending || c.children?.some(r => r.id === pending)) ? pending : undefined;
      if (confirmed) { pending = undefined; notice = ''; removed = undefined; }
      else if (pending && value.receipt?.id === pending && value.receipt.status === 'committed-removed' && Number.isSafeInteger(value.receipt.revision) && value.receipt.revision > 0 && value.receipt.revision <= value.revision) {
        removed = pending; pending = undefined;
        notice = 'Comment was committed, then removed. Draft retained. Choose a new cell comment or clear the unsent draft; nothing will be replayed.';
      }
      update({ comments, pending: !!pending, confirmed, removed, message: pending ? (notice || 'Comment awaiting native confirmation — keep this draft open') : (notice || 'Published comments at native revision ' + value.revision) });
    } catch (error) { if (live) update({ comments: [], pending: !!pending, removed, message: String(error) }); }
    finally { checking = false; }
  };
  return {
    refresh,
    pending: () => !!pending,
    canAdd: () => live && !pending && !removed && allowed() && session.access.role !== 'read',
    explain(message: string) { notice = message; if (live) update({ comments, pending: !!pending, removed, message }); },
    newDraft() {
      if (!live || pending) return;
      removed = undefined; notice = 'New comment draft — no request sent';
      update({ comments, pending: false, message: notice });
    },
    async add(body: string, ref: string, parentId?: string) {
      if (!live) return;
      if (pending || removed || !allowed() || session.access.role === 'read') {
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
