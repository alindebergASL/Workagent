import { nativeAgentAcceptance, emptyAcceptanceView } from './native-agent-acceptance';
import { nativeAgent, initialNativeAgentView } from './native-agent';
import { nativeReversal, guardReversalInput, type ReversalView } from './native-reversal';
import { openReversalAction, openAcceptanceAction } from './native-reversal-action';
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
import { UniverCollaborationPlugin, RevisionService } from '@univerjs-pro/collaboration';
import { UniverCollaborationClientPlugin, ILocalCacheService, CollaborationController, CollaborationSessionService, MemberService, SessionStatus } from '@univerjs-pro/collaboration-client';
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

export interface NativeSession { principal: string; name: string; binding: string; owner: boolean; unitID: string; access: { role: string; revision: number }; peer?: string; basePath?: string; sessionPath?: string; comments?: boolean; history?: boolean; reversal?: boolean; agent?: boolean; acceptance?: boolean }
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
  const editDraft = useRef('');
  const submittedEdit = useRef<{ commentId: string; body: string } | null>(null);
  const [editingComment, setEditingComment] = useState<CommentView['comments'][number] | null>(null);
  const [editText, setEditText] = useState('');
  const [commentView, setCommentView] = useState<CommentView>({ comments: [], message: 'Loading comments', pending: false });
  const history = useRef<ReturnType<typeof nativeHistory> | null>(null);
  const [historyView, setHistoryView] = useState<NativeHistoryView>({ entries: [], message: 'History not loaded' });
  const reversal = useRef<ReturnType<typeof nativeReversal> | null>(null);
  const [reversalView, setReversalView] = useState<ReversalView>({ message: 'Waiting for your own native acknowledgement.', active: false, locked: false, canPreview: false, canConfirm: false });
  const acceptance = useRef<ReturnType<typeof nativeAgentAcceptance> | null>(null);
  const [acceptanceView, setAcceptanceView] = useState(emptyAcceptanceView);
  const agentProposals = useRef<ReturnType<typeof initialNativeAgentView>['proposals']>([]);
  const agentUnsafe = useRef(false);
  const agent = useRef<ReturnType<typeof nativeAgent> | null>(null);
  const [agentView, setAgentView] = useState(() => initialNativeAgentView(session, localStorage));
  const [undoNotice, setUndoNotice] = useState(NATIVE_UNDO_UNAVAILABLE);
  const [anchor, setAnchor] = useState('');
  const [commentAvailable, setCommentAvailable] = useState(false);
  const [reply, setReply] = useState<string | undefined>();
  const anchorRead = useRef<() => string>(() => '');
  useEffect(() => {
    if (!host.current) return;
    let live = true, revoked = false, conflict = false, loaded = false, authorityHealthy = true;
    let online = () => false;
    let presenceObserver: { dispose(): void } | undefined, joinsObserver: { dispose(): void } | undefined;
    const stopPresence = () => { acceptance.current?.dispose(); acceptance.current = null; agentProposals.current = []; agent.current?.dispose(); agent.current = null; reversal.current?.dispose(); reversal.current = null; history.current?.dispose(); history.current = null; comments.current?.dispose(); comments.current = null; follow.current?.dispose(); follow.current = null; presenceObserver?.dispose(); joinsObserver?.dispose(); presenceObserver = joinsObserver = undefined; if (live) setPresence({ online: false, members: [] }); };
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
    const reversalGuard = guardReversalInput(univer.__getInjector().get(ICommandService), () => !!reversal.current?.locked() || !!acceptance.current?.locked());
    const undoGuard = containNativeUndo(session.unitID, univer.__getInjector().get(ICommandService), univer.__getInjector().get(IUndoRedoService), () => { if (live) setUndoNotice(NATIVE_UNDO_UNAVAILABLE); });
    if (session.history) history.current = nativeHistory(session, value => { if (live) setHistoryView(value); }, fetch);
    univer.__getInjector().get(UserManagerService).setCurrentUser({ userID: session.principal, name: session.name, avatar: '' });
    const cache = univer.__getInjector().get(ILocalCacheService);
    scopeNativeCache(cache, session.principal, session.binding, session.access.revision);
    joinsObserver = observeNativeMembershipJoins(session.unitID, session.principal,
      univer.__getInjector().get(CollaborationSessionService), univer.__getInjector().get(MemberService));
    const collaboration = nativeCollaborationClient(univer.__getInjector(), session.unitID);
    let composing = false;
    if (session.agent && session.owner && session.access.role === 'owner') agent.current = nativeAgent(session,
      () => live && loaded && !revoked && !conflict && authorityHealthy && online(),
      () => composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || !!reversal.current?.active() || !!acceptance.current?.active(),
      () => univer.__getInjector().get(RevisionService).getCurrentRevOfUnit(session.unitID),
      value => { agentProposals.current = value.proposals; agentUnsafe.current = value.unsaved; if (live) setAgentView(value); }, fetch, localStorage);

    anchorRead.current = () => {
      const book = univerAPI.getActiveWorkbook(), range = book?.getActiveRange();
      if (book?.getActiveSheet().getSheetId() !== 'sheet-1' || !range) return '';
      const r = range.getRange();
      return r.startRow === r.endRow && r.startColumn === r.endColumn ? range.getA1Notation() : '';
    };
    if (session.comments) comments.current = nativeComments(session, univer.__getInjector().get(IThreadCommentDataSourceService), univer.__getInjector().get(ICommandService),
      () => loaded && !revoked && !conflict && !composing && !paste.busy() && !univerAPI.getActiveWorkbook()?.isCellEditing() && !collaboration.hasWritePending() && !reversal.current?.active() && !acceptance.current?.active(),
      value => { if (live && !revoked && !conflict) { setCommentView(value); const editProof = value.editing?.confirmed; if (editProof && submittedEdit.current?.commentId === editProof.commentId && submittedEdit.current.body === editProof.body && editDraft.current === editProof.body) { const published = value.comments.flatMap(root => [root, ...(root.children ?? []).map(child => ({ ...child, ref: root.ref }))]).find(comment => comment.id === editProof.commentId); if (published) setEditingComment(published); submittedEdit.current = null; } if (value.confirmed && draft.current === submittedDraft.current) { draft.current = ''; setCommentDraft(''); setReply(undefined); submittedDraft.current = null; } } }, fetch, () => { const entity = univer.__getInjector().get(CollaborationController).getCollabEntity(session.unitID); return entity?.session.sessionStatus === SessionStatus.ONLINE ? (entity.session.getMemberID() ?? '') : ''; }, localStorage);
    const localInteraction = () => follow.current?.localInteraction();
    const element = host.current;
    const inputStart = () => { composing = true; localInteraction(); };
    const inputEnd = () => { composing = false; };
    const interactions = ['pointerdown', 'keydown', 'beforeinput', 'wheel'] as const;
    interactions.forEach(name => element.addEventListener(name, localInteraction, true));
    element.addEventListener('compositionstart', inputStart, true); element.addEventListener('compositionend', inputEnd, true);
    element.addEventListener('paste', localInteraction, true);
    const report = () => {
      agent.current?.refresh();
      acceptance.current?.refresh();
      reversal.current?.refresh(collaboration.hasWritePending());
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
    const beforeUnload = (event: BeforeUnloadEvent) => { if (univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || conflict || !!draft.current || !!editDraft.current || !!comments.current?.pending() || !!reversal.current?.active() || !!acceptance.current?.active() || agentUnsafe.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    void collaboration.loadSheetAsync().then(book => {
      if (!live) return;
      if (!book) { setStatus('Unable to load authoritative sheet. Retained operations have not been replaced.'); setBlocked(true); return; }
      loaded = true; report(); void comments.current?.refresh();
      if (revoked || conflict) return;
      const entity = univer.__getInjector().get(CollaborationController).getCollabEntity(session.unitID);
      if (entity) {
        const injector = univer.__getInjector();
        online = () => entity.session.sessionStatus === SessionStatus.ONLINE;
        agent.current?.refresh(); void agent.current?.check();
        if (session.acceptance && session.owner && session.access.role === 'owner') acceptance.current = nativeAgentAcceptance(session, entity.session,
          () => agentProposals.current, () => injector.get(RevisionService).getCurrentRevOfUnit(session.unitID),
          () => live && loaded && !revoked && !conflict && authorityHealthy && online(),
          () => composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || !!comments.current?.pending() || !!reversal.current?.active(),
          value => { if (live) setAcceptanceView(value); }, fetch, localStorage,
          (path, signal) => openAcceptanceAction(session.unitID, path, session.binding, signal), () => { void agent.current?.check(); });
        if (session.reversal) reversal.current = nativeReversal(session, entity.session,
          () => injector.get(RevisionService).getCurrentRevOfUnit(session.unitID),
          () => !loaded || revoked || conflict || composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || !!comments.current?.pending() || !!acceptance.current?.active(),
          value => { if (live) setReversalView(value); }, fetch, localStorage,
          (path, signal) => openReversalAction(session.unitID, path, session.binding, signal));
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
      reversal.current?.refresh(collaboration.hasWritePending());
      agent.current?.poll();
      acceptance.current?.refresh();
      if (checking || !live) return; checking = true;
      if (session.comments) { setAnchor(anchorRead.current()); setCommentAvailable(!!comments.current?.canAdd()); }
      if (!revoked && !conflict) void comments.current?.refresh();
      try {
        const response = await fetch(session.sessionPath ?? '/api/native/session', { headers: { 'X-Workagent-Session-Binding': session.binding } });
        if (!live) return;
        if (response.status === 401 || response.status === 403) { revoked = true; stopPresence(); setBlocked(true); setStatus('Access revoked or session expired — local work retained; no confirmed save claim.'); }
        else if (response.ok) {
          const current: NativeSession = await response.json();
          authorityHealthy = current.principal === session.principal && current.access.revision === session.access.revision;
          if (current.principal !== session.principal || current.access.revision !== session.access.revision) { revoked = true; stopPresence(); setBlocked(true); setStatus('Access changed — this session is fenced. Preserve pending work before reopening.'); }
        } else { authorityHealthy = false; setStatus('Stale — authority check failed; keep this tab open.'); }
      } catch { authorityHealthy = false; if (live) setStatus('Disconnected — local work may be pending; native SDK will reconnect.'); }
      finally { checking = false; agent.current?.refresh(); }
    }, 1500);
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      if (live && (univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || conflict || !!draft.current || !!editDraft.current || !!comments.current?.pending() || !!reversal.current?.active() || !!acceptance.current?.active() || agentUnsafe.current)) { closing = undefined; throw new Error('Native edits are pending; keep this editor open.'); }
      if (host.current) host.current.inert = true;
      await cache.exhaustSavingTask();
      stopPresence();
      undoGuard.dispose(); reversalGuard.dispose(); univer.dispose();
    })().catch(error => { closing = undefined; if (live && host.current) host.current.inert = blocked; throw error; });
    ready.current?.({ canLeave: () => loaded && !univerAPI.getActiveWorkbook()?.isCellEditing() && !collaboration.hasWritePending() && !conflict && !draft.current && !editDraft.current && !comments.current?.pending() && !reversal.current?.active() && !acceptance.current?.active() && !agentUnsafe.current, close });
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
    {session.agent && session.owner && session.access.role === 'owner' && <details aria-label="Native agent requests" style={{ maxWidth: '100%', overflowWrap: 'anywhere' }} onToggle={e => { if (e.currentTarget.open) void agent.current?.check(); }}>
      <summary>Ask about this collaborative Sheet</summary>
      <p>{session.acceptance ? 'Requests only read and propose. Apply a current scalar proposal only through explicit Preview and Confirm below.' : 'Read and propose only. Proposed changes are not applied; acceptance comes next.'}</p>
      <p role="status" data-native-agent>{agentView.message}</p>
      {agentView.priorUnknown && <p>Unknown requests from an earlier session or access epoch remain retained and isolated. They have not been replayed.</p>}
      <textarea aria-label="Native agent request draft" value={agentView.draft} maxLength={50000} disabled={blocked} style={{ boxSizing: 'border-box', width: '100%', maxWidth: '100%' }} onChange={e => agent.current?.edit(e.target.value)}/>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button onPointerDown={e => e.preventDefault()} disabled={blocked || !agentView.canSend} onClick={() => void agent.current?.send()}>Send native agent request</button>
        <button onPointerDown={e => e.preventDefault()} disabled={blocked || !agentView.canCancel} onClick={() => void agent.current?.cancel()}>Cancel native agent work</button>
        <button onPointerDown={e => e.preventDefault()} disabled={blocked || !agentView.canCheck} onClick={() => void agent.current?.check()}>Check request status</button>
      </div>
      {agentView.retained && <p>Request identities and text are retained. Unknown outcomes are never automatically resent.</p>}
      {!blocked && <div style={{ maxHeight: '40vh', overflow: 'auto' }}>
        {agentView.jobs.map((job, index) => <article key={job.id}><p>Request {index + 1}: {job.status}{job.phase ? ` · ${job.phase}` : ''}{job.errorCode ? ` · ${job.errorCode}` : ''}</p>{job.messages.map((m, i) => <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{m.text}</p>)}</article>)}
        {agentView.proposals.map(p => <article key={p.id}><p>Proposed scalar change · {p.review} · native revision {p.revision}</p><p>{p.sheet}, row {p.row + 1}, column {p.column + 1}: <span style={{ whiteSpace: 'pre-wrap' }}>{p.before}</span> → <span style={{ whiteSpace: 'pre-wrap' }}>{p.after}</span></p>{session.acceptance && <><button onPointerDown={e => e.preventDefault()} disabled={blocked || !acceptanceView.eligible.includes(p.id)} onClick={() => void acceptance.current?.preview(p.id)}>Preview proposed change</button>{!acceptanceView.eligible.includes(p.id) && <p>Preview unavailable while stale, input is unfinished, or an acceptance is retained. Check status below.</p>}</>}</article>)}
      </div>}
    </details>}
    {session.acceptance && session.owner && session.access.role === 'owner' && <section aria-label="Native proposal acceptance" style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <p role="status" data-native-acceptance>{acceptanceView.message}</p>
      {acceptanceView.priorRetained && <p>Earlier session or epoch acceptance identities remain retained and isolated. They have not been replayed.</p>}
      {!blocked && acceptanceView.preview && <div aria-label="Canonical acceptance preview">
        <p>Native revision {acceptanceView.preview.nativeRevision} · {acceptanceView.preview.sheetID}, row {acceptanceView.preview.row + 1}, column {acceptanceView.preview.column + 1}</p>
        <p>Current value: {String(acceptanceView.preview.before?.v ?? '(empty)')} → Proposed value: {String(acceptanceView.preview.after.v ?? '(empty)')}</p>
        <button onPointerDown={e => e.preventDefault()} disabled={!acceptanceView.canConfirm} onClick={() => void acceptance.current?.confirm()}>Confirm proposed change</button>
      </div>}
      {!blocked && acceptanceView.canAbandon && <button onPointerDown={e => e.preventDefault()} onClick={() => void acceptance.current?.abandon()}>Abandon unused acceptance preview</button>}
      {acceptanceView.retained.map((r, index) => <p key={r.id}>Retained acceptance {index + 1}{r.id === acceptanceView.selected ? ' (selected)' : ''}. <button onPointerDown={e => e.preventDefault()} disabled={blocked || acceptanceView.active} onClick={() => void acceptance.current?.check(r.id)}>Check acceptance status {index + 1}</button></p>)}
      <p>Status checks never retry a confirmation, reconnect an action, or replay a native mutation.</p>
    </section>}
    {session.reversal && <section aria-label="Explicit operation reversal" style={{ overflowWrap: 'anywhere' }}>
      <p role="status" data-native-reversal>{reversalView.message}</p>
      {session.access.role === 'read' ? <p>Read-only — reversal unavailable.</p> : <>
        <button onPointerDown={e => e.preventDefault()} disabled={blocked || !reversalView.canPreview} onClick={() => void reversal.current?.preview()}>Preview reversal</button>
        {!blocked && reversalView.preview && <div aria-label="Reversal preview"><p>Native operation revision {reversalView.targetRevision} · {reversalView.preview.sheetID}, row {reversalView.preview.row + 1}, column {reversalView.preview.col + 1}</p>
          <p>Current value: {String(reversalView.preview.after?.v ?? '(empty)')} → Previous value: {String(reversalView.preview.before?.v ?? '(empty)')}</p>
          <button onPointerDown={e => e.preventDefault()} disabled={!reversalView.canConfirm} onClick={() => void reversal.current?.confirm()}>Confirm reversal</button></div>}
      </>}
      {!blocked && reversalView.canAbandon && <button onPointerDown={e => e.preventDefault()} onClick={() => void reversal.current?.abandon()}>Abandon unused preview</button>}
      {reversalView.retainedID && <><p>Retained reversal: {reversalView.retainedID}. Unknown outcomes are never retried automatically.</p><button onPointerDown={e => e.preventDefault()} disabled={blocked || reversalView.active} onClick={() => void reversal.current?.check()}>Check reversal status</button></>}
    </section>}
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
      <p>{commentView.editing?.message}</p>{commentView.editing?.abandonable.map(id => <button key={id} disabled={blocked || commentView.editing?.busy} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.editing?.abandon(id); }}>Abandon unused text edit</button>)}
      {editingComment && <div><label>Edited comment text<textarea aria-label="Edited comment text" value={editText} maxLength={8000} disabled={blocked || commentView.editing?.busy} onChange={event => { editDraft.current = event.target.value; setEditText(event.target.value); }}/></label><button disabled={blocked || !editText.trim() || !comments.current?.editing?.canSave(editingComment, editText)} onMouseDown={event => event.preventDefault()} onClick={() => { if (comments.current?.editing?.canSave(editingComment, editDraft.current)) { submittedEdit.current = { commentId: editingComment.id, body: editDraft.current }; void comments.current.editing.edit(editingComment, editDraft.current); } }}>Save text revision</button><button disabled={commentView.editing?.busy} onMouseDown={event => event.preventDefault()} onClick={() => { editDraft.current = ''; submittedEdit.current = null; setEditText(''); setEditingComment(null); }}>Cancel edit draft</button><p>If the published version changes, this draft stays on its original basis; Cancel and reopen to edit the latest text. Saving retains the prior body. Only native commit evidence publishes the revision; cancelling this draft never cancels a submitted edit.</p></div>}
      <p>{commentView.resolution}</p>{commentView.abandonable?.map(id => <button key={id} disabled={blocked || commentView.resolutionBusy} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.abandon(id); }}>Abandon unused thread action</button>)}<button disabled={blocked || commentView.resolutionBusy} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.refresh(); }}>Check comment status</button>
      <p role="status">{blocked ? 'Comments unavailable — access or native state changed. Draft retained.' : commentView.message}</p>
      {!blocked && commentView.comments.map(root => <div key={root.id}><p><strong>{root.authorName}</strong> · {root.ref} · {root.resolutionUnknown ? 'Resolution status uncertain' : root.resolved ? 'Resolved' : 'Open'}: {root.bodyUnknown ? 'Current text uncertain — native receipt unavailable' : root.text.dataStream}</p>{[root, ...(root.children ?? []).map(child => ({ ...child, ref: root.ref }))].map(comment => <div key={comment.id}>{comment.id !== root.id && <p>{comment.authorName}: {('bodyUnknown' in comment && comment.bodyUnknown) ? 'Current text uncertain — native receipt unavailable' : comment.text.dataStream}</p>}{comment.personId === session.principal && session.access.role !== 'read' && <button disabled={blocked || !!editingComment || !comments.current?.editing?.canEdit(comment)} onMouseDown={event => event.preventDefault()} onClick={() => { const value = comment.text.dataStream.slice(0, -2); editDraft.current = value; setEditText(value); setEditingComment(comment); }}>Edit {comment.id === root.id ? 'comment' : 'reply'}</button>}</div>)}{session.access.role !== 'read' && <button disabled={commentView.pending || !!commentDraft} onClick={() => { setReply(root.id); setAnchor(root.ref); }}>Reply to {root.ref}</button>}{session.access.role !== 'read' && (session.owner || root.personId === session.principal) && <button disabled={blocked || !commentAvailable || !comments.current?.canResolve(root)} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.resolve(root); }}>{root.resolved ? 'Reopen thread' : 'Resolve thread'}</button>}</div>)}
      {session.access.role !== 'read' && <><p>{reply ? (commentView.comments.some(c => c.id === reply) ? `Reply to thread ${reply}` : 'Reply target is no longer published. Choose a new cell comment to keep using this draft.') : `Selected cell: ${anchor || 'select a single cell'}`} </p>
        <textarea aria-label="Comment draft" value={commentDraft} maxLength={8000} disabled={blocked || commentView.pending} onChange={event => { draft.current = event.target.value; setCommentDraft(event.target.value); }}/>
        <button disabled={blocked || commentView.pending || !!commentView.removed || !commentAvailable || !commentDraft.trim() || (reply ? !commentView.comments.some(c => c.id === reply) : !anchor)} onClick={() => { const ref = reply ? commentView.comments.find(c => c.id === reply)?.ref : anchorRead.current(); if (ref) { if (comments.current?.canAdd()) submittedDraft.current = draft.current; void comments.current?.add(draft.current, ref, reply); } else comments.current?.explain('The selected cell or reply target is unavailable. Choose a current cell; draft retained.'); }}>Add comment</button>
        {!commentAvailable && !blocked && !commentView.pending && <p>Finish active cell input, paste or pending native edits before adding.</p>}
        {(reply || commentView.removed) && <button disabled={commentView.pending} onClick={() => { setReply(undefined); setAnchor(anchorRead.current()); comments.current?.newDraft(); setCommentAvailable(!!comments.current?.canAdd()); }}>Use draft for a new cell comment</button>}
        <button disabled={commentView.pending} onClick={() => { draft.current = ''; setCommentDraft(''); setReply(undefined); submittedDraft.current = null; comments.current?.newDraft(); setCommentAvailable(!!comments.current?.canAdd()); }}>Clear unsent comment draft</button>
        <p>Pending or refused comments retain this draft; no automatic retry. Authors can retain new text revisions; manual deletion is not enabled.</p></>}
    </details>}
    {hasRecovery && <button onClick={download}>Download retained recovery operations</button>}<div style={{ position: 'relative' }}><div ref={host} style={{ height: '75vh' }} inert={blocked || reversalView.locked || acceptanceView.locked || undefined}/>{blocked && <p>Editing paused. Keep this tab open while resolving access or pending work.</p>}</div></>;
}
