import { nativeEditDrafts, emptyEditDraftView, type EditDraftBasis } from './native-edit-drafts';
import { nativeCommentDrafts, emptyCommentDraftRecovery, type CommentDraftToken } from './native-comment-drafts';
import {nativeScalarRestore,emptyRestoreView} from './native-scalar-restore';
import {guardNativeWorksheets, WORKSHEET_GUIDANCE} from './native-worksheets';
import { guardNativeMerge, MERGE_GUIDANCE } from './native-merge';
import { nativeAgentAcceptance, emptyAcceptanceView } from './native-agent-acceptance';
import { nativeAgent, initialNativeAgentView } from './native-agent';
import { nativeReversal, guardReversalInput, type ReversalView } from './native-reversal';
import { openReversalAction, openAcceptanceAction, openRestoreAction } from './native-reversal-action';
import { historyMergeRange, containNativeUndo, NATIVE_UNDO_UNAVAILABLE, nativeHistory, type NativeHistoryView } from './native-history';
import { nativeComments } from './native-comments';
import type { CommentView } from './native-comments';
import { UniverThreadCommentPlugin, IThreadCommentDataSourceService } from '@univerjs/thread-comment';
import { UniverSheetsThreadCommentPlugin } from '@univerjs/sheets-thread-comment';
import { scopeNativeCache } from './native-cache';
import { nativeCursorSessionOverride } from './native-cursor-session';
import { observeNativePresence, observeNativeMembershipJoins } from './native-presence';
import { nativeCollaborationClient } from './native-collaboration-client';
import { nativeCapacityStatus } from './native-capacity-status';
import { nativeSocketRecovery } from './native-socket-recovery';
import { nativeFollow, nativePasteActivity } from './native-follow';
import type { NativeFollowState } from './native-follow';
import type { NativePresence } from './native-presence';
import { useEffect, useRef, useState } from 'react';
import { ICommandService, IResourceLoaderService, IUndoRedoService, IUniverInstanceService, LocaleType, LogLevel, UserManagerService } from '@univerjs/core';
import type { Workbook } from '@univerjs/core';
import { RefRangeService, SheetsSelectionsService } from '@univerjs/sheets';
import { UniverCollaborationPlugin, RevisionService } from '@univerjs-pro/collaboration';
import { UniverCollaborationClientPlugin, ILocalCacheService, CollaborationController, CollaborationSessionService, CollaborationUIEventService, MemberService, SessionStatus } from '@univerjs-pro/collaboration-client';
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

export interface NativeSession { principal: string; name: string; binding: string; owner: boolean; unitID: string; access: { role: string; revision: number }; peer?: string; basePath?: string; sessionPath?: string; comments?: boolean; history?: boolean; reversal?: boolean; agent?: boolean; acceptance?: boolean; restore?: boolean }
export interface NativeCollaborationHandle { canLeave(): boolean; close(): Promise<void> }
// Native operations/cache are the only synchronization path. Never call legacy
// save, create a local workbook, replace a snapshot or mint retry identities.
// Defer browser-storage access to each helper's guarded method calls. Some
// browsers throw when merely obtaining localStorage, not just on setItem.
const guardedLocalStorage = {
  get length() { return localStorage.length; },
  key: (index: number) => localStorage.key(index),
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
  removeItem: (key: string) => localStorage.removeItem(key),
};
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
  const commentComposerGeneration = useRef(0);
  const localCommentDrafts = useRef<ReturnType<typeof nativeCommentDrafts> | null>(null);
  const [localDraftView, setLocalDraftView] = useState(emptyCommentDraftRecovery);
  const submittedLocalDraft = useRef<CommentDraftToken | undefined>(undefined);
  const submittedDraftContext = useRef<{ helper: ReturnType<typeof nativeCommentDrafts>; threadID?: string } | undefined>(undefined);
  const replyMode = useRef<string | undefined>(undefined);
  const selectDraftMode = useRef<(threadID?: string) => void>(() => {});
  const publishedThreads = useRef(new Map<string, string>());
  const [chooseRecoveredAnchor, setChooseRecoveredAnchor] = useState(false);
  const submittingComment = useRef(false);
  const submittedDraft = useRef<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const editDraft = useRef('');
  const editGeneration = useRef(0);
  const editRecovery = useRef<ReturnType<typeof nativeEditDrafts> | null>(null);
  const [editRecoveryView,setEditRecoveryView] = useState(emptyEditDraftView);
  type EditEntry = ReturnType<ReturnType<typeof nativeEditDrafts>['get']>;
  const selectedEdit = useRef<EditEntry | null>(null);
  const submittedEditDrafts = useRef(new Map<string,{entry:EditEntry;token:CommentDraftToken}>());
  const savingEdit = useRef(false);
  const publishedEditTargets = useRef(new Map<string,{threadID:string;comment:CommentView['comments'][number]}>());
  const editBasis = (comment:CommentView['comments'][number], threadID:string): EditDraftBasis => ({commentID:comment.id,threadID,version:comment.bodyVersion!,original:comment.text.dataStream});
  const [editingComment, setEditingComment] = useState<CommentView['comments'][number] | null>(null);
  const [editText, setEditText] = useState('');
  const [commentView, setCommentView] = useState<CommentView>({ comments: [], message: 'Loading comments', pending: false });
  const history = useRef<ReturnType<typeof nativeHistory> | null>(null);
  const [historyView, setHistoryView] = useState<NativeHistoryView>({ entries: [], message: 'History not loaded' });
  const reversal = useRef<ReturnType<typeof nativeReversal> | null>(null);
  const [reversalView, setReversalView] = useState<ReversalView>({ message: 'Waiting for your own native acknowledgement.', active: false, locked: false, canPreview: false, canConfirm: false });
  const restore = useRef<ReturnType<typeof nativeScalarRestore> | null>(null);
  const [restoreView,setRestoreView] = useState(emptyRestoreView);
  const acceptance = useRef<ReturnType<typeof nativeAgentAcceptance> | null>(null);
  const [acceptanceView, setAcceptanceView] = useState(emptyAcceptanceView);
  const agentProposals = useRef<ReturnType<typeof initialNativeAgentView>['proposals']>([]);
  const agentUnsafe = useRef(false);
  const agent = useRef<ReturnType<typeof nativeAgent> | null>(null);
  const [agentView, setAgentView] = useState(() => initialNativeAgentView(session, guardedLocalStorage));
  const [mergeNotice, setMergeNotice] = useState(MERGE_GUIDANCE);
  const [undoNotice, setUndoNotice] = useState(NATIVE_UNDO_UNAVAILABLE);
  const [anchor, setAnchor] = useState('');
  const [commentAvailable, setCommentAvailable] = useState(false);
  const [reply, setReply] = useState<string | undefined>();
  const anchorRead = useRef<() => string>(() => '');
  useEffect(() => {
    if (!host.current) return;
    let live = true, revoked = false, conflict = false, loaded = false, authorityHealthy = true;
    let loadFailure: string | undefined;
    let capacity: ReturnType<typeof nativeCapacityStatus> | undefined;
    let freshAuthority = false;
    let online = () => false;
    const draftHelpers = new Map<string, ReturnType<typeof nativeCommentDrafts>>();
    const draftAuthority = () => live && freshAuthority && authorityHealthy && loaded && !loadFailure && online() && !revoked && !conflict && session.access.role !== 'read';
    const selectMode = (threadID?: string) => {
      replyMode.current = threadID;
      const key = threadID ?? '';
      if (session.comments && !draftHelpers.has(key)) {
        const helper = nativeCommentDrafts({ principal: session.principal, unitID: session.unitID, epoch: session.access.revision, threadID },
          () => localStorage, () => draftAuthority() && (threadID === undefined || publishedThreads.current.has(threadID)),
          value => { if (live && replyMode.current === threadID) setLocalDraftView(value); }, window.navigator?.locks);
        draftHelpers.set(key, helper);
      }
      localCommentDrafts.current = draftHelpers.get(key) ?? null;
      localCommentDrafts.current?.refresh();
    };
    selectDraftMode.current = selectMode;
    selectMode();
    const editDrafts = session.comments ? nativeEditDrafts({principal:session.principal,unitID:session.unitID,epoch:session.access.revision},
      () => localStorage, draftAuthority, id => { const t=publishedEditTargets.current.get(id); return t && {threadID:t.threadID,principal:t.comment.personId,version:t.comment.bodyVersion,original:t.comment.text.dataStream,unknown:t.comment.bodyUnknown}; },
      value => {if(live)setEditRecoveryView(value);}, window.navigator?.locks) : null;
    editRecovery.current=editDrafts;
    const refreshDrafts = () => {localCommentDrafts.current?.refresh();editDrafts?.refresh();};
    const draftStorageChanged = refreshDrafts;
    window.addEventListener('storage', draftStorageChanged);
    let presenceObserver: { dispose(): void } | undefined, joinsObserver: { dispose(): void } | undefined;
    const stopPresence = () => { capacity?.dispose(); refreshDrafts(); restore.current?.dispose(); restore.current = null; acceptance.current?.dispose(); acceptance.current = null; agentProposals.current = []; agent.current?.dispose(); agent.current = null; reversal.current?.dispose(); reversal.current = null; history.current?.dispose(); history.current = null; comments.current?.dispose(); comments.current = null; follow.current?.dispose(); follow.current = null; presenceObserver?.dispose(); joinsObserver?.dispose(); presenceObserver = joinsObserver = undefined; if (live) setPresence({ online: false, members: [] }); };
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
    const reversalGuard = guardReversalInput(univer.__getInjector().get(ICommandService), () => !!reversal.current?.locked() || !!acceptance.current?.locked() || !!restore.current?.locked());
    const undoGuard = containNativeUndo(session.unitID, univer.__getInjector().get(ICommandService), univer.__getInjector().get(IUndoRedoService), () => { if (live) setUndoNotice(NATIVE_UNDO_UNAVAILABLE); });
    if (session.history) history.current = nativeHistory(session, value => { if (live) setHistoryView(value); }, fetch);
    univer.__getInjector().get(UserManagerService).setCurrentUser({ userID: session.principal, name: session.name, avatar: '' });
    const cache = univer.__getInjector().get(ILocalCacheService);
    scopeNativeCache(cache, session.principal, session.binding, session.access.revision);
    joinsObserver = observeNativeMembershipJoins(session.unitID, session.principal,
      univer.__getInjector().get(CollaborationSessionService), univer.__getInjector().get(MemberService));
    const collaboration = nativeCollaborationClient(univer.__getInjector(), session.unitID);
    const socketRecovery = nativeSocketRecovery(session.unitID,
      univer.__getInjector().get(CollaborationSessionService), univer.__getInjector().get(CollaborationUIEventService),
      () => univer.__getInjector().get(CollaborationController).getCollabEntity(session.unitID)?.session,
      () => live && loaded && !loadFailure && !revoked && !conflict && authorityHealthy);
    let composing = false;
    const firstSheet = () => univerAPI.getActiveWorkbook()?.getActiveSheet().getSheetId() === 'sheet-1';
    const worksheetGuard = guardNativeWorksheets(session.unitID, univer.__getInjector().get(ICommandService),
      () => univer.__getInjector().get(IResourceLoaderService).saveUnit(session.unitID),
      () => univerAPI.getActiveWorkbook()?.getActiveSheet().getSheetId(),
      () => live && loaded && !revoked && !conflict && authorityHealthy && online() && session.access.role !== 'read',
      () => composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || !!comments.current?.pending() || !!reversal.current?.active() || !!acceptance.current?.active() || !!restore.current?.active(),
      message => { if (live) setMergeNotice(message); },
      () => univer.__getInjector().get(SheetsSelectionsService).getCurrentSelections()?.map(selection => selection.range) ?? []);
    const mergeGuard = guardNativeMerge(session.unitID, univer.__getInjector().get(ICommandService),
      () => univer.__getInjector().get(IResourceLoaderService).saveUnit(session.unitID),
      () => { const range = univerAPI.getActiveWorkbook()?.getActiveRange()?.getRange(); return range ? [range] : []; },
      () => live && loaded && !revoked && !conflict && authorityHealthy && online() && session.access.role !== 'read' && !composing && !paste.busy() && !univerAPI.getActiveWorkbook()?.isCellEditing() && !collaboration.hasWritePending() && !comments.current?.pending() && !reversal.current?.active() && !acceptance.current?.active() && !restore.current?.active(),
      message => { if (live) setMergeNotice(message); });
    if (session.agent && session.owner && session.access.role === 'owner') agent.current = nativeAgent(session,
      () => firstSheet() && live && loaded && !revoked && !conflict && authorityHealthy && online(),
      () => composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || !!reversal.current?.active() || !!acceptance.current?.active() || !!restore.current?.active(),
      () => univer.__getInjector().get(RevisionService).getCurrentRevOfUnit(session.unitID),
      value => { agentProposals.current = value.proposals; agentUnsafe.current = value.unsaved; if (live) setAgentView(value); }, fetch, guardedLocalStorage);

    anchorRead.current = () => {
      const book = univerAPI.getActiveWorkbook(), range = book?.getActiveRange();
      if (book?.getActiveSheet().getSheetId() !== 'sheet-1' || !range) return '';
      const r = range.getRange();
      return r.startRow === r.endRow && r.startColumn === r.endColumn ? range.getA1Notation() : '';
    };
    if (session.comments) comments.current = nativeComments(session, univer.__getInjector().get(IThreadCommentDataSourceService), univer.__getInjector().get(ICommandService),
      () => firstSheet() && loaded && !revoked && !conflict && !composing && !paste.busy() && !univerAPI.getActiveWorkbook()?.isCellEditing() && !collaboration.hasWritePending() && !reversal.current?.active() && !acceptance.current?.active() && !restore.current?.active(),
      value => { if (live && !revoked && !conflict) { publishedThreads.current = new Map(value.comments.map(root => [root.id, root.ref])); publishedEditTargets.current = new Map(value.comments.flatMap(root => [root,...(root.children ?? []).map(child=>({...child,ref:root.ref}))].map(comment=>[comment.id,{threadID:root.id,comment}] as const)));
        setCommentView(value); refreshDrafts();
        for(const editProof of value.editing?.confirmations ?? []){const submitted=submittedEditDrafts.current.get(editProof.version);
          if(submitted && submitted.entry.basis.commentID===editProof.commentId && submitted.entry.basis.version===editProof.previousVersion && submitted.token.text===editProof.body){
            const unchanged=selectedEdit.current===submitted.entry && editDraft.current===editProof.body && submitted.entry.helper.matches(submitted.token);
            void editDrafts?.complete(submitted.entry,submitted.token,editProof,editProof.version);
            if(unchanged){
              const published=publishedEditTargets.current.get(editProof.commentId);
              if(published && published.comment.personId===session.principal && published.comment.bodyVersion===editProof.version && published.comment.text.dataStream===editProof.body+'\r\n'){
                editGeneration.current++;selectedEdit.current=editDrafts?.get(editBasis(published.comment,published.threadID)) ?? null;setEditingComment(published.comment);
              }
            }
            submittedEditDrafts.current.delete(editProof.version);
          }
        }
        if (value.confirmed) {
        const token = submittedLocalDraft.current;
        const context = submittedDraftContext.current;
        const candidates = context?.threadID ? value.comments.find(root => root.id === context.threadID)?.children ?? [] : value.comments;
        const published = token && candidates.find(comment => comment.id === value.confirmed && comment.personId === session.principal && comment.text.dataStream === token.text + '\r\n');
        // Retire an older completed token even when the user has already typed
        // a newer draft. Only matching native publication supplies completion.
        const clearPublishedDraft = (!token || published) && draft.current === submittedDraft.current && (!token || context?.helper.matches(token) && replyMode.current === context.threadID);
        if (token && published) void context?.helper.complete(token, { commentId: published.id, principal: session.principal, text: token.text, threadID: context.threadID });
        if (clearPublishedDraft) { commentComposerGeneration.current++; draft.current = ''; setCommentDraft(''); setReply(undefined); selectMode(); }
        if (!token || published) { submittedLocalDraft.current = undefined; submittedDraftContext.current = undefined; submittedDraft.current = null; }
      } } }, fetch, () => { const entity = univer.__getInjector().get(CollaborationController).getCollabEntity(session.unitID); return entity?.session.sessionStatus === SessionStatus.ONLINE ? (entity.session.getMemberID() ?? '') : ''; }, guardedLocalStorage);
    const localInteraction = () => follow.current?.localInteraction();
    const element = host.current;
    const inputStart = () => { composing = true; localInteraction(); };
    const inputEnd = () => { composing = false; };
    const interactions = ['pointerdown', 'keydown', 'beforeinput', 'wheel'] as const;
    interactions.forEach(name => element.addEventListener(name, localInteraction, true));
    element.addEventListener('compositionstart', inputStart, true); element.addEventListener('compositionend', inputEnd, true);
    element.addEventListener('paste', localInteraction, true);
    const report = () => {
      refreshDrafts();
      agent.current?.refresh();
      acceptance.current?.refresh(); restore.current?.refresh();
      reversal.current?.refresh(collaboration.hasWritePending());
      if (live) setCommentAvailable(!!comments.current?.canAdd());
      if (!live || conflict || revoked) return;
      // Authority reachability and native transport are independent. A healthy
      // poll refreshes this view; it never marks the SDK online or loaded.
      const capacityView = capacity?.view();
      const name = !authorityHealthy ? 'Authority check unavailable — local work retained; keep this tab open'
        : capacityView?.domainRejected ? 'License domain rejected — local work retained; no confirmed save claim'
        : loadFailure ? loadFailure
        : !loaded ? 'Connecting — authoritative sheet not loaded'
        : !online() ? 'Disconnected — native SDK will reconnect; local work retained'
        : capacityView?.message ?? String(collaboration.getCollaborationStatus());
      setStatus(`${session.access.role === 'read' ? 'Read-only · ' : ''}${name}${collaboration.hasWritePending() ? ' — edits not yet acknowledged; keep this tab open' : ''}`);
    };
    capacity = nativeCapacityStatus(session.unitID, univer.__getInjector().get(CollaborationController), univer.__getInjector().get(CollaborationUIEventService), () => collaboration.hasWritePending(), report);
    const subscriptions = [
      collaboration.subscribe({ status: report, resend: report, conflict: event => {
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
    const beforeUnload = (event: BeforeUnloadEvent) => { if (univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || conflict || !!draft.current || !!editDraft.current || !!comments.current?.pending() || !!reversal.current?.active() || !!acceptance.current?.active() || !!restore.current?.active() || agentUnsafe.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    void collaboration.loadSheetAsync().then(book => {
      if (!live) return;
      if (!book) { loadFailure = 'Unable to load authoritative sheet. Retained operations have not been replaced.'; report(); setBlocked(true); return; }
      loaded = true; void comments.current?.refresh();
      if (revoked || conflict) return;
      const entity = univer.__getInjector().get(CollaborationController).getCollabEntity(session.unitID);
      if (entity) {
        const injector = univer.__getInjector();
        online = () => entity.session.sessionStatus === SessionStatus.ONLINE;
        const sessionStatus = entity.session.sessionStatus$.subscribe(report);
        subscriptions.push({ dispose: () => sessionStatus.unsubscribe() });
        agent.current?.refresh(); void agent.current?.check();
        if (session.restore && session.owner && session.access.role === 'owner') restore.current = nativeScalarRestore(session, entity.session,
          () => injector.get(RevisionService).getCurrentRevOfUnit(session.unitID),
          () => firstSheet() && live && loaded && !revoked && !conflict && authorityHealthy && online(),
          () => composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || !!comments.current?.pending() || !!reversal.current?.active() || !!acceptance.current?.active(),
          value => { if(live)setRestoreView(value); }, fetch, guardedLocalStorage,
          (path,signal) => openRestoreAction(session.unitID,path,session.binding,signal), () => { void history.current?.read(); });
        if (session.acceptance && session.owner && session.access.role === 'owner') acceptance.current = nativeAgentAcceptance(session, entity.session,
          () => agentProposals.current, () => injector.get(RevisionService).getCurrentRevOfUnit(session.unitID),
          () => firstSheet() && live && loaded && !revoked && !conflict && authorityHealthy && online(),
          () => composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || !!comments.current?.pending() || !!reversal.current?.active() || !!restore.current?.active(),
          value => { if (live) setAcceptanceView(value); }, fetch, guardedLocalStorage,
          (path, signal) => openAcceptanceAction(session.unitID, path, session.binding, signal), () => { void agent.current?.check(); });
        if (session.reversal) reversal.current = nativeReversal(session, entity.session,
          () => injector.get(RevisionService).getCurrentRevOfUnit(session.unitID),
          () => !firstSheet() || !loaded || revoked || conflict || composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || !!comments.current?.pending() || !!acceptance.current?.active() || !!restore.current?.active(),
          value => { if (live) setReversalView(value); }, fetch, guardedLocalStorage,
          (path, signal) => openReversalAction(session.unitID, path, session.binding, signal));
        follow.current = nativeFollow(session.unitID, entity.session,
          () => injector.get(IUniverInstanceService).getUnit<Workbook>(session.unitID) ?? null, injector.get(RefRangeService), injector.get(ICommandService),
          () => composing || paste.busy() || !!univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || revoked || conflict,
          value => { if (live) setFollowing(value); });
        presenceObserver = observeNativePresence(session.unitID, session.principal, entity.session, injector.get(MemberService),
          value => { if (live && !revoked && !conflict) { follow.current?.presence(value); setPresence(value); } });
      }
      report();
    }).catch(() => { if (live && !revoked && !conflict) { loadFailure = 'Connecting failed — retained operations have not been replaced.'; report(); setBlocked(true); } });
    // Authority also gates recovery of this instance's exhausted SDK socket.
    // The server still checks each commit/read/send under Workspace authority.
    let checking = false;
    const timer = window.setInterval(async () => {
      reversal.current?.refresh(collaboration.hasWritePending());
      agent.current?.poll();
      acceptance.current?.refresh(); restore.current?.refresh();
      if (checking || !live) return; checking = true;
      if (session.comments) { setAnchor(anchorRead.current()); setCommentAvailable(!!comments.current?.canAdd()); }
      if (!revoked && !conflict) void comments.current?.refresh();
      try {
        const response = await fetch(session.sessionPath ?? '/api/native/session', { headers: { 'X-Workagent-Session-Binding': session.binding } });
        if (!live || revoked || conflict) return;
        if (response.status === 401 || response.status === 403) { revoked = true; stopPresence(); setBlocked(true); setStatus('Access revoked or session expired — local work retained; no confirmed save claim.'); }
        else if (response.ok) {
          const current: NativeSession = await response.json();
          if (!live || revoked || conflict) return;
          authorityHealthy = current.principal === session.principal && current.access.revision === session.access.revision;
          if (current.principal !== session.principal || current.access.revision !== session.access.revision) { revoked = true; stopPresence(); setBlocked(true); setStatus('Access changed — this session is fenced. Preserve pending work before reopening.'); }
          else { freshAuthority = current.unitID === session.unitID && current.access.role === session.access.role; socketRecovery.authorityChecked(); report(); }
        } else { authorityHealthy = false; report(); }
      } catch { if (live && !revoked && !conflict) { authorityHealthy = false; report(); } }
      finally { checking = false; agent.current?.refresh(); }
    }, 1500);
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      if (live && (univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || conflict || !!draft.current || !!editDraft.current || !!comments.current?.pending() || !!reversal.current?.active() || !!acceptance.current?.active() || !!restore.current?.active() || agentUnsafe.current)) { closing = undefined; throw new Error('Native edits are pending; keep this editor open.'); }
      if (host.current) host.current.inert = true;
      await cache.exhaustSavingTask();
      stopPresence();
      worksheetGuard.dispose(); mergeGuard.dispose(); undoGuard.dispose(); reversalGuard.dispose(); univer.dispose();
    })().catch(error => { closing = undefined; if (live && host.current) host.current.inert = blocked; throw error; });
    ready.current?.({ canLeave: () => loaded && !univerAPI.getActiveWorkbook()?.isCellEditing() && !collaboration.hasWritePending() && !conflict && !draft.current && !editDraft.current && !comments.current?.pending() && !reversal.current?.active() && !acceptance.current?.active() && !restore.current?.active() && !agentUnsafe.current, close });
    return () => {
      ready.current?.(null);
      live = false; editDrafts?.dispose(); editRecovery.current=null; selectedEdit.current=null; editGeneration.current++; publishedEditTargets.current.clear(); draftHelpers.forEach(helper => helper.dispose()); localCommentDrafts.current = null; selectDraftMode.current = () => {}; publishedThreads.current.clear(); window.removeEventListener('storage', draftStorageChanged); socketRecovery.dispose(); capacity?.dispose(); clearInterval(timer); window.removeEventListener('beforeunload', beforeUnload);
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
    <p role="status" data-native-undo>{undoNotice}</p><p data-native-merge role="status">{mergeNotice}</p><p data-native-worksheets>{WORKSHEET_GUIDANCE}</p>
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
    {session.restore && session.owner && session.access.role === 'owner' && <section aria-label="Bounded scalar-value restore">
      <p>Restore one changed scalar cell on the original worksheet as a new native revision. Choose a revision in history below. Other-tab, structure, formatting and comment/resource changes are unsupported; whole-workbook restore is unavailable.</p>
      <p role="status" data-native-restore>{restoreView.message}</p>
      <button onPointerDown={e=>e.preventDefault()} disabled={blocked || !restoreView.canPreview || !historyView.preview} onClick={()=>{if(historyView.preview)void restore.current?.preview(historyView.preview.revision);}}>Preview scalar-value restore from selected history</button>
      {!blocked && restoreView.preview && <div><p>Revision {restoreView.preview.sourceRevision} value at row {restoreView.preview.row+1}, column {restoreView.preview.column+1}. Current head {restoreView.preview.nativeRevision}: {String(restoreView.preview.before??'(empty)')} → {String(restoreView.preview.after??'(empty)')}</p><button onPointerDown={e=>e.preventDefault()} disabled={!restoreView.canConfirm} onClick={()=>void restore.current?.confirm()}>Confirm scalar-value restore as new revision</button></div>}
      {!blocked && restoreView.canAbandon && <button onPointerDown={e=>e.preventDefault()} onClick={()=>void restore.current?.abandon()}>Abandon unused restore preview</button>}
      {restoreView.priorRetained && <p>Earlier restore identities remain isolated and retained, without replay.</p>}
      {restoreView.retained.map((r,n)=><p key={r.id}>Retained restore {n+1}. <button onPointerDown={e=>e.preventDefault()} disabled={blocked||restoreView.active} onClick={()=>void restore.current?.check(r.id)}>Check restore status {n+1}</button></p>)}
    </section>}
    {session.history && <details onToggle={event => { if (event.currentTarget.open && !blocked) void history.current?.read(); }}><summary onPointerDown={e => e.preventDefault()}>Native history (read-only)</summary>
      <p role="status">{historyView.message}</p>
      {!blocked && <><button onPointerDown={e => e.preventDefault()} onClick={() => void history.current?.read()}>Refresh history</button>
      <button onPointerDown={e => e.preventDefault()} onClick={() => void history.current?.read('?revision=1')}>Preview initial revision 1</button>
      {historyView.entries.map(entry => <p key={entry.revision}>Revision {entry.revision} · {entry.author} · {entry.operations.join(', ')} ({entry.operationCount}) <button onPointerDown={e => e.preventDefault()} onClick={() => void history.current?.read(`?revision=${entry.revision}`)}>Preview revision {entry.revision}</button></p>)}
      {historyView.before && <button onPointerDown={e => e.preventDefault()} onClick={() => void history.current?.read(`?before=${historyView.before}`)}>Earlier history</button>}
      {historyView.preview && <div aria-label="Historical sheet preview" style={{ overflowWrap: 'anywhere', maxHeight: '20rem', overflow: 'auto' }}><p>Revision {historyView.preview.revision} · values/formulas and merged ranges · first 50 populated cells per sheet, at most 4 sheets; long values truncated. Comments and other formatting are not shown.</p>{historyView.preview.sheets.map(sheet => <div key={sheet.id}><strong>{sheet.name}</strong> ({sheet.rows} × {sheet.columns})<p>Merged ranges: {sheet.merges?.length ? sheet.merges.map(historyMergeRange).join(', ') : 'None'}.{sheet.mergesTruncated ? ` Showing first 50 of ${sheet.mergeCount} ranges.` : ''}</p><ul>{sheet.cells.map(cell => <li key={cell.cell}>{cell.cell}: {cell.value}</li>)}</ul></div>)}</div>}</>}
    </details>}
    <div aria-label="Sheet collaborators" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', overflowWrap: 'anywhere', marginBottom: '0.5rem' }}>
      <span>{session.name} (you{session.access.role === 'read' ? ', read-only' : ''})</span>
      {presence.online ? presence.members.filter(m => !m.self).map(m => <span key={m.memberID}>{m.name || 'Unnamed collaborator'}{m.userID === session.principal ? ' (your other session)' : ''} <button onPointerDown={event => event.preventDefault()} onClick={() => follow.current?.follow(m.memberID)} aria-label={`Follow ${m.name || 'collaborator'}${m.userID === session.principal ? ' (your other session)' : ''}`}>Follow</button></span>) : <span>Live collaborators unavailable</span>}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', overflowWrap: 'anywhere' }}><span role="status" data-native-follow>{following.message}</span>{following.memberID && <button onPointerDown={event => event.preventDefault()} onClick={() => follow.current?.stop()}>Stop following</button>}</div>
    {session.comments && <details><summary>Cell comments</summary>
      <p role="status">{commentView.deletion?.message}</p>{commentView.deletion?.abandonable.map(id => <button key={id} disabled={blocked || commentView.deletion?.busy} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.deletion?.abandon(id); }}>Abandon unused deletion</button>)}
      {commentView.deletion?.preview && <div aria-label="Confirm comment removal"><p>Remove {commentView.deletion.preview.targets.length} comment(s) from {commentView.deletion.preview.ref}? Only these authors' current native entries disappear; private bodies and evidence remain retained.</p><ul>{commentView.deletion.preview.targets.map(target => { const root = commentView.comments.find(r => r.id === commentView.deletion?.preview?.rootId); const comment = root?.id === target.id ? root : root?.children?.find(c => c.id === target.id); return <li key={target.id}>{comment?.authorName}: {comment?.text.dataStream} · body version {target.bodyVersion}</li>; })}</ul><button disabled={blocked || !commentView.deletion.canConfirm} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.deletion?.confirm(); }}>Confirm comment removal</button><button disabled={commentView.deletion.busy} onMouseDown={event => event.preventDefault()} onClick={() => comments.current?.deletion?.cancel()}>Cancel removal</button></div>}
      <p>{commentView.editing?.message}</p>{commentView.editing?.abandonable.map(id => <button key={id} disabled={blocked || commentView.editing?.busy} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.editing?.abandon(id); }}>Abandon unused text edit</button>)}
      {editingComment && <div><label>Edited comment text<textarea aria-label="Edited comment text" value={editText} maxLength={8000} disabled={blocked || commentView.editing?.busy} onChange={event => { editGeneration.current++; editDraft.current = event.target.value; setEditText(event.target.value); void selectedEdit.current?.helper.edit(event.target.value); }}/></label><button disabled={blocked || !editText.trim() || !selectedEdit.current || !editRecovery.current?.current(selectedEdit.current.basis) || !comments.current?.editing?.canSave(editingComment, editText)} onMouseDown={event => event.preventDefault()} onClick={async () => {
          const entry=selectedEdit.current, recovery=editRecovery.current, body=editDraft.current, generation=editGeneration.current;
          if(savingEdit.current || !entry || !recovery?.current(entry.basis) || !comments.current?.editing?.canSave(editingComment,body))return;
          savingEdit.current=true;
          try{const token=await entry.helper.beforeAttempt();
            if(!token || entry!==selectedEdit.current || generation!==editGeneration.current || body!==editDraft.current || !recovery.current(entry.basis) || !comments.current?.editing?.canSave(editingComment,body))return;
            await comments.current.editing.edit(editingComment,body,id=>submittedEditDrafts.current.set(id,{entry,token}));
          }finally{savingEdit.current=false;}
        }}>Save text revision</button><button disabled={commentView.editing?.busy} onMouseDown={event => event.preventDefault()} onClick={() => { editGeneration.current++; void selectedEdit.current?.helper.edit(''); selectedEdit.current=null; editDraft.current = ''; setEditText(''); setEditingComment(null); }}>Cancel edit draft</button><p>If the published version changes, this draft stays on its original basis; Cancel and reopen to edit the latest text. Saving retains the prior body. Only native commit evidence publishes the revision; cancelling this draft never cancels a submitted edit.</p></div>}
      {session.access.role !== 'read' && <section aria-label="Local edit text recovery"><p role="status">{editRecoveryView.message}</p><p>Saved in this browser profile only; not native sync or protection against browser cleanup/device loss. Attempted edits are never offered for replay.</p>{editRecoveryView.attempted>0 && <p>{editRecoveryView.attempted} attempted edit text record(s) retained. Use comment status checks; nothing is resubmitted.</p>}{editRecoveryView.drafts.map((saved,index)=><div key={saved.id}>
        <p>Comment {saved.basis.commentID} · thread {saved.basis.threadID} · original version {saved.basis.version}. {saved.current ? 'Original body is still current.' : 'Original basis changed or is unavailable. Read-only saved text; restore and Save are unavailable.'}</p>
        <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{saved.text}</pre>
        <button disabled={blocked || !!editingComment || !saved.current || commentView.editing?.busy} onPointerDown={e=>e.preventDefault()} onClick={async()=>{
          if(selectedEdit.current || editDraft.current)return;
          const recovery=editRecovery.current,generation=editGeneration.current,result=await recovery?.restore(saved);
          if(!result)return;
          const published=publishedEditTargets.current.get(saved.basis.commentID);
          if(recovery===editRecovery.current && recovery?.current(saved.basis) && generation===editGeneration.current && !selectedEdit.current && !editDraft.current && published && comments.current?.editing?.canEdit(published.comment) && result.helper.acceptRestore(result.text)){
            editGeneration.current++;selectedEdit.current=result;editDraft.current=result.text;setEditText(result.text);setEditingComment(published.comment);
          }else result.helper.releaseRestore(result.text);
        }}>Restore saved edit text {index+1}</button>
        <button disabled={blocked} onPointerDown={e=>e.preventDefault()} onClick={()=>void editRecovery.current?.get(saved.basis).helper.discard(saved.id,saved.version)}>Discard saved edit text {index+1}</button>
      </div>)}</section>}
      <p>{commentView.resolution}</p>{commentView.abandonable?.map(id => <button key={id} disabled={blocked || commentView.resolutionBusy} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.abandon(id); }}>Abandon unused thread action</button>)}<button disabled={blocked || commentView.resolutionBusy} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.refresh(); }}>Check comment status</button>
      <p role="status">{blocked ? 'Comments unavailable — access or native state changed. Draft retained.' : commentView.message}</p>
      {!blocked && commentView.comments.map(root => <div key={root.id}><p><strong>{root.authorName}</strong> · {root.ref} · {root.resolutionUnknown ? 'Resolution status uncertain' : root.resolved ? 'Resolved' : 'Open'}: {root.bodyUnknown ? 'Current text uncertain — native receipt unavailable' : root.text.dataStream}</p>{[root, ...(root.children ?? []).map(child => ({ ...child, ref: root.ref }))].map(comment => <div key={comment.id}>{comment.id !== root.id && <p>{comment.authorName}: {('bodyUnknown' in comment && comment.bodyUnknown) ? 'Current text uncertain — native receipt unavailable' : comment.text.dataStream}</p>}{comment.personId === session.principal && session.access.role !== 'read' && <button disabled={blocked || !!editingComment || !editRecovery.current?.current(editBasis(comment,root.id)) || !comments.current?.editing?.canEdit(comment)} onMouseDown={event => event.preventDefault()} onClick={() => { const value = comment.text.dataStream.slice(0, -2); const helper=editRecovery.current; if(!helper?.current(editBasis(comment,root.id)))return; editGeneration.current++; selectedEdit.current=helper.get(editBasis(comment,root.id)); editDraft.current = value; setEditText(value); setEditingComment(comment); }}>Edit {comment.id === root.id ? 'comment' : 'reply'}</button>}{comment.personId === session.principal && session.access.role !== 'read' && <button disabled={blocked || !comments.current?.deletion?.canChoose(root, comment.id)} onMouseDown={event => event.preventDefault()} onClick={() => comments.current?.deletion?.choose(root, comment.id)}>Delete {comment.id === root.id ? 'comment' : 'reply'}</button>}{comment.id === root.id && root.personId === session.principal && root.children?.some(c => c.personId !== session.principal) && <p>This thread has another author's replies. Manual root deletion is unavailable; each author may remove their own reply.</p>}</div>)}{session.access.role !== 'read' && <button disabled={commentView.pending || !!commentDraft} onClick={() => { commentComposerGeneration.current++; setReply(root.id); selectDraftMode.current(root.id); setChooseRecoveredAnchor(false); setAnchor(root.ref); }}>Reply to {root.ref}</button>}{session.access.role !== 'read' && (session.owner || root.personId === session.principal) && <button disabled={blocked || !commentAvailable || !comments.current?.canResolve(root)} onMouseDown={event => event.preventDefault()} onClick={() => { void comments.current?.resolve(root); }}>{root.resolved ? 'Reopen thread' : 'Resolve thread'}</button>}</div>)}
      {session.access.role !== 'read' && <><p>{reply ? (commentView.comments.some(c => c.id === reply) ? `Reply to thread ${reply}` : 'Reply target is no longer published. Reply text stays retained; it cannot be restored or converted into another thread.') : `Selected cell: ${anchor || 'select a single cell'}`} </p>
        <section aria-label={reply ? "Local reply text recovery" : "Local root-comment text recovery"}><p role="status">{localDraftView.message}</p><p>Saved only in this browser profile; private mode, browser cleanup or device loss may remove it. Attempted text is never offered for reposting.</p>{localDraftView.attempted > 0 && <p>{localDraftView.attempted} attempted text record(s) retained for evidence. Use native comment status checks; recovery never resubmits them.</p>}{localDraftView.drafts.map((saved, index) => <div key={saved.id}><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{saved.text}</pre><button disabled={blocked || !!commentDraft || commentView.pending || !commentAvailable} onPointerDown={e => e.preventDefault()} onClick={async () => { if (draft.current || comments.current?.pending() || !comments.current?.canAdd()) return; const helper = localCommentDrafts.current, generation = commentComposerGeneration.current, target = replyMode.current; const body = await helper?.restore(saved.id, saved.version); if (body !== undefined && helper === localCommentDrafts.current && helper?.canRecover() && generation === commentComposerGeneration.current && target === replyMode.current && (target === undefined || publishedThreads.current.has(target)) && !draft.current && !comments.current?.pending() && comments.current?.canAdd() && helper.acceptRestore(body)) { commentComposerGeneration.current++; draft.current = body; setCommentDraft(body); if (target === undefined) { setAnchor(''); setChooseRecoveredAnchor(true); } } else if (body !== undefined) helper?.releaseRestore(body); }}>Restore saved {reply ? 'reply' : 'root'} text {index + 1}</button><button disabled={blocked} onPointerDown={e => e.preventDefault()} onClick={() => void localCommentDrafts.current?.discard(saved.id, saved.version)}>Discard saved {reply ? 'reply' : 'root'} text {index + 1}</button></div>)}</section>
        {chooseRecoveredAnchor && <p>Recovered text has no restored anchor. <button disabled={blocked || !commentAvailable} onPointerDown={e => e.preventDefault()} onClick={() => { const selected = anchorRead.current(); if (selected && comments.current?.canAdd()) { setAnchor(selected); setChooseRecoveredAnchor(false); } }}>Use current selected cell for recovered text</button></p>}
        <textarea aria-label="Comment draft" value={commentDraft} maxLength={8000} disabled={blocked || commentView.pending} onChange={event => { commentComposerGeneration.current++; draft.current = event.target.value; setCommentDraft(event.target.value); void localCommentDrafts.current?.edit(event.target.value); }}/>
        <button disabled={blocked || chooseRecoveredAnchor || commentView.pending || !!commentView.removed || !commentAvailable || !commentDraft.trim() || (reply ? !commentView.comments.some(c => c.id === reply) : !anchor)} onClick={async () => {
          if (submittingComment.current || chooseRecoveredAnchor || !comments.current?.canAdd()) return;
          const body = draft.current, helper = localCommentDrafts.current, target = replyMode.current, generation = commentComposerGeneration.current; submittingComment.current = true;
          try {
            const token = await helper?.beforeAttempt();
            if (!token || !helper) return;
            if (body !== draft.current || generation !== commentComposerGeneration.current || target !== replyMode.current || !helper.canRecover() || !comments.current?.canAdd()) return;
            const ref = target ? publishedThreads.current.get(target) : anchorRead.current();
            if (!ref) { comments.current?.explain('The selected cell or reply target is unavailable. Choose a current cell; draft retained.'); return; }
            submittedDraft.current = body; submittedLocalDraft.current = token; submittedDraftContext.current = { helper, threadID: target };
            await comments.current.add(body, ref, target);
          } finally { submittingComment.current = false; }
        }}>Add comment</button>
        {!commentAvailable && !blocked && !commentView.pending && <p>Finish active cell input, paste or pending native edits before adding.</p>}
        {(reply || commentView.removed) && <button disabled={commentView.pending} onClick={() => { if (reply && draft.current) { comments.current?.explain('Reply text cannot be converted to a new cell comment. Keep or explicitly clear this reply; attempted text remains evidence, never an unsent recovery.'); return; } commentComposerGeneration.current++; setReply(undefined); selectDraftMode.current(); setAnchor(anchorRead.current()); if (draft.current) void localCommentDrafts.current?.edit(draft.current); comments.current?.newDraft(); setCommentAvailable(!!comments.current?.canAdd()); }}>Use draft for a new cell comment</button>}
        <button disabled={commentView.pending} onClick={() => { commentComposerGeneration.current++; draft.current = ''; setCommentDraft(''); setReply(undefined); setChooseRecoveredAnchor(false); submittedDraft.current = null; submittedLocalDraft.current = undefined; submittedDraftContext.current = undefined; void localCommentDrafts.current?.edit(''); selectDraftMode.current(); comments.current?.newDraft(); setCommentAvailable(!!comments.current?.canAdd()); }}>Clear unsent comment draft</button>
        <p>Pending or refused comments retain this draft; no automatic retry. Authors can remove their own replies or wholly self-authored threads from live visibility. Prior bodies remain retained; restore is not enabled.</p></>}
    </details>}
    {hasRecovery && <button onClick={download}>Download retained recovery operations</button>}<div style={{ position: 'relative' }}><div ref={host} style={{ height: '75vh' }} inert={blocked || reversalView.locked || acceptanceView.locked || restoreView.locked || undefined}/>{blocked && <p>Editing paused. Keep this tab open while resolving access or pending work.</p>}</div></>;
}
