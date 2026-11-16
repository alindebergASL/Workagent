import { containNativeUndo, NATIVE_UNDO_UNAVAILABLE, nativeHistory, type NativeHistoryView } from './native-history';
import { nativeComments } from './native-comments';
import type { CommentView } from './native-comments';
import { UniverThreadCommentPlugin, IThreadCommentDataSourceService } from '@univerjs/thread-comment';
import { UniverSheetsThreadCommentPlugin } from '@univerjs/sheets-thread-comment';
import { scopeNativeCache } from './native-cache';
import { nativeCursorSessionOverride } from './native-cursor-session';
import { observeNativePresence, observeNativeMembershipJoins } from './native-presence';
import { nativeCollaborationClient } from './native-collaboration-client';
import { nativeFollow, nativePasteActivity } from './native-follow';
import type { NativeFollowState } from './native-follow';
import type { NativePresence } from './native-presence';
import { useEffect, useRef, useState } from 'react';
import { ICommandService, IUndoRedoService, IUniverInstanceService, LocaleType, LogLevel, UserManagerService } from '@univerjs/core';
import type { Workbook } from '@univerjs/core';
import { RefRangeService } from '@univerjs/sheets';
import { UniverCollaborationPlugin } from '@univerjs-pro/collaboration';
import { UniverCollaborationClientPlugin, ILocalCacheService, CollaborationController, CollaborationSessionService, MemberService } from '@univerjs-pro/collaboration-client';
import CollaborationEnUS from '@univerjs-pro/collaboration-client/locale/en-US';
import { BrowserCollaborationSocketService, UniverCollaborationClientUIPlugin } from '@univerjs-pro/collaboration-client-ui';
import CollaborationUIEnUS from '@univerjs-pro/collaboration-client-ui/locale/en-US';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import SheetsEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { createUniver, defaultTheme, mergeLocales } from '@univerjs/presets';
import '@univerjs/sheets-ui/facade';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs-pro/collaboration-client-ui/lib/index.css';

export interface NativeSession { principal: string; name: string; binding: string; owner: boolean; unitID: string; access: { role: string; revision: number }; peer?: string; basePath?: string; sessionPath?: string; comments?: boolean; history?: boolean }
export interface NativeCollaborationHandle { canLeave(): boolean; close(): Promise<void> }
// Native operations/cache are the only synchronization path. Never call legacy
// save, create a local workbook, replace a snapshot or mint retry identities.
export function NativeCollaborationEditor({ session, onReady }: { session: NativeSession; onReady?: (handle: NativeCollaborationHandle | null) => void }) {
  const ready = useRef(onReady); ready.current = onReady;
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Connecting — authoritative sheet not loaded');
  const [blocked, setBlocked] = useState(false);
  const recovery = useRef<string | null>(null);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [presence, setPresence] = useState<NativePresence>({ online: false, members: [] });
  const follow = useRef<ReturnType<typeof nativeFollow> | null>(null);
  const [following, setFollowing] = useState<NativeFollowState>({ message: 'Not following' });
  const comments = useRef<ReturnType<typeof nativeComments> | null>(null);
  const draft = useRef('');
  const submittedDraft = useRef<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentView, setCommentView] = useState<CommentView>({ comments: [], message: 'Loading comments', pending: false });
  const history = useRef<ReturnType<typeof nativeHistory> | null>(null);
  const [historyView, setHistoryView] = useState<NativeHistoryView>({ entries: [], message: 'History not loaded' });
  const [undoNotice, setUndoNotice] = useState(NATIVE_UNDO_UNAVAILABLE);
  const [anchor, setAnchor] = useState('');
  const [commentAvailable, setCommentAvailable] = useState(false);
  const [reply, setReply] = useState<string | undefined>();
  const anchorRead = useRef<() => string>(() => '');
  useEffect(() => {
    if (!host.current) return;
    let live = true, revoked = false, conflict = false, loaded = false;
    let presenceObserver: { dispose(): void } | undefined, joinsObserver: { dispose(): void } | undefined;
    const stopPresence = () => { history.current?.dispose(); history.current = null; comments.current?.dispose(); comments.current = null; follow.current?.dispose(); follow.current = null; presenceObserver?.dispose(); joinsObserver?.dispose(); presenceObserver = joinsObserver = undefined; if (live) setPresence({ online: false, members: [] }); };
    const recoveryKey = `workagent:native-recovery:${session.binding}:${session.unitID}:${session.access.revision}`;
    try { recovery.current = localStorage.getItem(recoveryKey); setHasRecovery(!!recovery.current); } catch { /* SDK cache remains independent. */ }
    const basePath = session.basePath ?? '/universer-api';
    const base = `${location.origin}${basePath}`;
    const paste = nativePasteActivity(() => follow.current?.localInteraction());
    const { univer, univerAPI } = createUniver({
      override: paste.override,
      locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(SheetsEnUS, CollaborationEnUS, CollaborationUIEnUS) },
      theme: defaultTheme, logLevel: LogLevel.WARN, collaboration: true,
      presets: [UniverSheetsCorePreset({ container: host.current, ribbonType: 'grid' })],
      plugins: [UniverLicensePlugin, UniverCollaborationPlugin, [UniverCollaborationClientPlugin, {
        override: nativeCursorSessionOverride,
        socketService: BrowserCollaborationSocketService, enableOfflineEditing: true, enableSingleActiveInstanceLock: true,
        sendChangesetTimeout: 200, authzUrl: `${base}/authz`, snapshotServerUrl: `${base}/snapshot`,
        collabSubmitChangesetUrl: `${base}/comb`, wsSessionTicketUrl: `${base}/user/session-ticket`,
        collabWebSocketUrl: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${basePath}/comb/connect`,
      }], UniverCollaborationClientUIPlugin, ...(session.comments ? [UniverThreadCommentPlugin, UniverSheetsThreadCommentPlugin] : [])],
    });
    const undoGuard = containNativeUndo(session.unitID, univer.__getInjector().get(ICommandService), univer.__getInjector().get(IUndoRedoService), () => { if (live) setUndoNotice(NATIVE_UNDO_UNAVAILABLE); });
    if (session.history) history.current = nativeHistory(session, value => { if (live) setHistoryView(value); }, fetch);
    univer.__getInjector().get(UserManagerService).setCurrentUser({ userID: session.principal, name: session.name, avatar: '' });
    const cache = univer.__getInjector().get(ILocalCacheService);
    scopeNativeCache(cache, session.principal, session.binding, session.access.revision);
    joinsObserver = observeNativeMembershipJoins(session.unitID, session.principal,
      univer.__getInjector().get(CollaborationSessionService), univer.__getInjector().get(MemberService));
    const collaboration = nativeCollaborationClient(univer.__getInjector(), session.unitID);
    let composing = false;
    anchorRead.current = () => {
      const book = univerAPI.getActiveWorkbook(), range = book?.getActiveRange();
      if (book?.getActiveSheet().getSheetId() !== 'sheet-1' || !range) return '';
      const r = range.getRange();
      return r.startRow === r.endRow && r.startColumn === r.endColumn ? range.getA1Notation() : '';
    };
    if (session.comments) comments.current = nativeComments(session, univer.__getInjector().get(IThreadCommentDataSourceService), univer.__getInjector().get(ICommandService),
      () => loaded && !revoked && !conflict && !composing && !paste.busy() && !univerAPI.getActiveWorkbook()?.isCellEditing() && !collaboration.hasWritePending(),
      value => { if (live && !revoked && !conflict) { setCommentView(value); if (value.confirmed && draft.current === submittedDraft.current) { draft.current = ''; setCommentDraft(''); setReply(undefined); submittedDraft.current = null; } } }, fetch);
    const localInteraction = () => follow.current?.localInteraction();
    const element = host.current;
    const inputStart = () => { composing = true; localInteraction(); };
    const inputEnd = () => { composing = false; };
    const interactions = ['pointerdown', 'keydown', 'beforeinput', 'wheel'] as const;
    interactions.forEach(name => element.addEventListener(name, localInteraction, true));
    element.addEventListener('compositionstart', inputStart, true); element.addEventListener('compositionend', inputEnd, true);
    element.addEventListener('paste', localInteraction, true);
    const report = () => {
      if (live) setCommentAvailable(!!comments.current?.canAdd());
      if (!live || conflict || revoked) return;
      const state = collaboration.getCollaborationStatus();
      const name = String(state);
      setStatus(`${session.access.role === 'read' ? 'Read-only · ' : ''}${name ?? state}${collaboration.hasWritePending() ? ' — edits not yet acknowledged; keep this tab open' : ''}`);
    };
    const subscriptions = [
      collaboration.subscribe({ status: report, resend: event => {
        if (live) setStatus(`Awaiting acknowledgement — SDK retry ${event.reqId}: ${event.reason}`);
      }, conflict: event => {
        conflict = true; stopPresence(); setBlocked(true);
        // Capture before any reload. Awaiting operations may have committed:
        // recovery is retained for inspection, never resubmitted as a new edit.
        recovery.current = JSON.stringify({ principal: session.principal, unitID: session.unitID, reason: event.reason, localChanges: event.localChanges });
        setHasRecovery(true);
        try {
          localStorage.setItem(recoveryKey, recovery.current);
          setStatus(`Conflict: ${event.reason}. Recovery operations retained. An awaiting edit may already be committed.`);
        } catch { setStatus(`Conflict: ${event.reason}. Recovery is in memory only — download it before closing this tab.`); }
      } }),
    ];
    const beforeUnload = (event: BeforeUnloadEvent) => { if (univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || conflict || !!draft.current || !!comments.current?.pending()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    void collaboration.loadSheetAsync().then(book => {
      if (!live) return;
      if (!book) { setStatus('Unable to load authoritative sheet. Retained operations have not been replaced.'); setBlocked(true); return; }
      loaded = true; report(); void comments.current?.refresh();
      if (revoked || conflict) return;
      const entity = univer.__getInjector().get(CollaborationController).getCollabEntity(session.unitID);
      if (entity) {
        const injector = univer.__getInjector();
        follow.current = nativeFollow(session.unitID, entity.session,
          () => injector.get(IUniverInstanceService).getUnit<Workbook>(session.unitID) ?? null, injector.get(RefRangeService), injector.get(ICommandService),
          () => composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || revoked || conflict,
          value => { if (live) setFollowing(value); });
        presenceObserver = observeNativePresence(session.unitID, session.principal, entity.session, injector.get(MemberService),
          value => { if (live && !revoked && !conflict) { follow.current?.presence(value); setPresence(value); } });
      }
    }).catch(() => { if (live) { setStatus('Connecting failed — retained operations have not been replaced.'); setBlocked(true); } });
    // Display only; server checks each commit/read/send under Workspace authority.
    let checking = false;
    const timer = window.setInterval(async () => {
      if (checking || !live) return; checking = true;
      if (session.comments) { setAnchor(anchorRead.current()); setCommentAvailable(!!comments.current?.canAdd()); }
      if (!revoked && !conflict) void comments.current?.refresh();
      try {
        const response = await fetch(session.sessionPath ?? '/api/native/session', { headers: { 'X-Workagent-Session-Binding': session.binding } });
        if (!live) return;
        if (response.status === 401 || response.status === 403) { revoked = true; stopPresence(); setBlocked(true); setStatus('Access revoked or session expired — local work retained; no confirmed save claim.'); }
        else if (response.ok) {
          const current: NativeSession = await response.json();
          if (current.principal !== session.principal || current.access.revision !== session.access.revision) { revoked = true; stopPresence(); setBlocked(true); setStatus('Access changed — this session is fenced. Preserve pending work before reopening.'); }
        } else setStatus('Stale — authority check failed; keep this tab open.');
      } catch { if (live) setStatus('Disconnected — local work may be pending; native SDK will reconnect.'); }
      finally { checking = false; }
    }, 1500);
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      if (live && (univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || conflict || !!draft.current || !!comments.current?.pending())) { closing = undefined; throw new Error('Native edits are pending; keep this editor open.'); }
      if (host.current) host.current.inert = true;
      await cache.exhaustSavingTask();
      stopPresence();
      undoGuard.dispose(); univer.dispose();
    })().catch(error => { closing = undefined; if (live && host.current) host.current.inert = blocked; throw error; });
    ready.current?.({ canLeave: () => loaded && !univerAPI.getActiveWorkbook()?.isCellEditing() && !collaboration.hasWritePending() && !conflict && !draft.current && !comments.current?.pending(), close });
    return () => {
      ready.current?.(null);
      live = false; clearInterval(timer); window.removeEventListener('beforeunload', beforeUnload);
      interactions.forEach(name => element.removeEventListener(name, localInteraction, true));
      element.removeEventListener('compositionstart', inputStart, true); element.removeEventListener('compositionend', inputEnd, true);
      element.removeEventListener('paste', localInteraction, true);
      stopPresence();
      subscriptions.forEach(s => s.dispose());
      // Complete the native cache save before disposing its editor.
      void close().catch(() => { /* Leave guard keeps the live editor on explicit flush failure. */ });
    };
  }, [session]);
  const download = () => {
    if (!recovery.current) return;
    const url = URL.createObjectURL(new Blob([recovery.current], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'native-operation-recovery.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <><p role="status" data-native-status>{status}</p>
    <p role="status" data-native-undo>{undoNotice}</p>
    {session.history && <details onToggle={event => { if (event.currentTarget.open && !blocked) void history.current?.read(); }}><summary onPointerDown={e => e.preventDefault()}>Native history (read-only)</summary>
      <p role="status">{historyView.message}</p>
      {!blocked && <><button onPointerDown={e => e.preventDefault()} onClick={() => void history.current?.read()}>Refresh history</button>
      <button onPointerDown={e => e.preventDefault()} onClick={() => void history.current?.read('?revision=1')}>Preview initial revision 1</button>
      {historyView.entries.map(entry => <p key={entry.revision}>Revision {entry.revision} · {entry.author} · {entry.operations.join(', ')} ({entry.operationCount}) <button onPointerDown={e => e.preventDefault()} onClick={() => void history.current?.read(`?revision=${entry.revision}`)}>Preview revision {entry.revision}</button></p>)}
      {historyView.before && <button onPointerDown={e => e.preventDefault()} onClick={() => void history.current?.read(`?before=${historyView.before}`)}>Earlier history</button>}
      {historyView.preview && <div aria-label="Historical sheet preview" style={{ overflowWrap: 'anywhere', maxHeight: '20rem', overflow: 'auto' }}><p>Revision {historyView.preview.revision} · values/formulas only · first 50 populated cells per sheet, at most 4 sheets; long values truncated. Comments and formatting are not shown.</p>{historyView.preview.sheets.map(sheet => <div key={sheet.id}><strong>{sheet.name}</strong> ({sheet.rows} × {sheet.columns})<ul>{sheet.cells.map(cell => <li key={cell.cell}>{cell.cell}: {cell.value}</li>)}</ul></div>)}</div>}</>}
    </details>}
    <div aria-label="Sheet collaborators" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', overflowWrap: 'anywhere', marginBottom: '0.5rem' }}>
      <span>{session.name} (you{session.access.role === 'read' ? ', read-only' : ''})</span>
      {presence.online ? presence.members.filter(m => !m.self).map(m => <span key={m.memberID}>{m.name || 'Unnamed collaborator'}{m.userID === session.principal ? ' (your other session)' : ''} <button onPointerDown={event => event.preventDefault()} onClick={() => follow.current?.follow(m.memberID)} aria-label={`Follow ${m.name || 'collaborator'}${m.userID === session.principal ? ' (your other session)' : ''}`}>Follow</button></span>) : <span>Live collaborators unavailable</span>}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', overflowWrap: 'anywhere' }}><span role="status" data-native-follow>{following.message}</span>{following.memberID && <button onPointerDown={event => event.preventDefault()} onClick={() => follow.current?.stop()}>Stop following</button>}</div>
    {session.comments && <details><summary>Cell comments</summary>
      <p role="status">{blocked ? 'Comments unavailable — access or native state changed. Draft retained.' : commentView.message}</p>
      {!blocked && commentView.comments.map(root => <div key={root.id}><p><strong>{root.authorName}</strong> · {root.ref}: {root.text.dataStream}</p>{root.children?.map(child => <p key={child.id}>{child.authorName}: {child.text.dataStream}</p>)}{session.access.role !== 'read' && <button disabled={commentView.pending || !!commentDraft} onClick={() => { setReply(root.id); setAnchor(root.ref); }}>Reply to {root.ref}</button>}</div>)}
      {session.access.role !== 'read' && <><p>{reply ? (commentView.comments.some(c => c.id === reply) ? `Reply to thread ${reply}` : 'Reply target is no longer published. Choose a new cell comment to keep using this draft.') : `Selected cell: ${anchor || 'select a single cell'}`} </p>
        <textarea aria-label="Comment draft" value={commentDraft} maxLength={8000} disabled={blocked || commentView.pending} onChange={event => { draft.current = event.target.value; setCommentDraft(event.target.value); }}/>
        <button disabled={blocked || commentView.pending || !!commentView.removed || !commentAvailable || !commentDraft.trim() || (reply ? !commentView.comments.some(c => c.id === reply) : !anchor)} onClick={() => { const ref = reply ? commentView.comments.find(c => c.id === reply)?.ref : anchorRead.current(); if (ref) { if (comments.current?.canAdd()) submittedDraft.current = draft.current; void comments.current?.add(draft.current, ref, reply); } else comments.current?.explain('The selected cell or reply target is unavailable. Choose a current cell; draft retained.'); }}>Add immutable comment</button>
        {!commentAvailable && !blocked && !commentView.pending && <p>Finish active cell input, paste or pending native edits before adding.</p>}
        {(reply || commentView.removed) && <button disabled={commentView.pending} onClick={() => { setReply(undefined); setAnchor(anchorRead.current()); comments.current?.newDraft(); setCommentAvailable(!!comments.current?.canAdd()); }}>Use draft for a new cell comment</button>}
        <button disabled={commentView.pending} onClick={() => { draft.current = ''; setCommentDraft(''); setReply(undefined); submittedDraft.current = null; comments.current?.newDraft(); setCommentAvailable(!!comments.current?.canAdd()); }}>Clear unsent comment draft</button>
        <p>Pending or refused comments retain this draft; no automatic retry. Body editing, resolution and manual deletion are not enabled.</p></>}
    </details>}
    {hasRecovery && <button onClick={download}>Download retained recovery operations</button>}<div style={{ position: 'relative' }}><div ref={host} style={{ height: '75vh' }} inert={blocked || undefined}/>{blocked && <p>Editing paused. Keep this tab open while resolving access or pending work.</p>}</div></>;
}
