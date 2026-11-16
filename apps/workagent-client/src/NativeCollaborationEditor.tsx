import { scopeNativeCache } from './native-cache';
import { nativeCursorSessionOverride } from './native-cursor-session';
import { observeNativePresence, observeNativeMembershipJoins } from './native-presence';
import { nativeCollaborationClient } from './native-collaboration-client';
import type { NativePresence } from './native-presence';
import { useEffect, useRef, useState } from 'react';
import { LocaleType, LogLevel, UserManagerService } from '@univerjs/core';
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

export interface NativeSession { principal: string; name: string; binding: string; owner: boolean; unitID: string; access: { role: string; revision: number }; peer?: string; basePath?: string; sessionPath?: string }
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
  useEffect(() => {
    if (!host.current) return;
    let live = true, revoked = false, conflict = false, loaded = false;
    let presenceObserver: { dispose(): void } | undefined, joinsObserver: { dispose(): void } | undefined;
    const stopPresence = () => { presenceObserver?.dispose(); joinsObserver?.dispose(); presenceObserver = joinsObserver = undefined; if (live) setPresence({ online: false, members: [] }); };
    const recoveryKey = `workagent:native-recovery:${session.binding}:${session.unitID}:${session.access.revision}`;
    try { recovery.current = localStorage.getItem(recoveryKey); setHasRecovery(!!recovery.current); } catch { /* SDK cache remains independent. */ }
    const basePath = session.basePath ?? '/universer-api';
    const base = `${location.origin}${basePath}`;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(SheetsEnUS, CollaborationEnUS, CollaborationUIEnUS) },
      theme: defaultTheme, logLevel: LogLevel.WARN, collaboration: true,
      presets: [UniverSheetsCorePreset({ container: host.current, ribbonType: 'grid' })],
      plugins: [UniverLicensePlugin, UniverCollaborationPlugin, [UniverCollaborationClientPlugin, {
        override: nativeCursorSessionOverride,
        socketService: BrowserCollaborationSocketService, enableOfflineEditing: true, enableSingleActiveInstanceLock: true,
        sendChangesetTimeout: 200, authzUrl: `${base}/authz`, snapshotServerUrl: `${base}/snapshot`,
        collabSubmitChangesetUrl: `${base}/comb`, wsSessionTicketUrl: `${base}/user/session-ticket`,
        collabWebSocketUrl: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${basePath}/comb/connect`,
      }], UniverCollaborationClientUIPlugin],
    });
    univer.__getInjector().get(UserManagerService).setCurrentUser({ userID: session.principal, name: session.name, avatar: '' });
    const cache = univer.__getInjector().get(ILocalCacheService);
    scopeNativeCache(cache, session.principal, session.binding, session.access.revision);
    joinsObserver = observeNativeMembershipJoins(session.unitID, session.principal,
      univer.__getInjector().get(CollaborationSessionService), univer.__getInjector().get(MemberService));
    const collaboration = nativeCollaborationClient(univer.__getInjector(), session.unitID);
    const report = () => {
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
    const beforeUnload = (event: BeforeUnloadEvent) => { if (univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || conflict) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    void collaboration.loadSheetAsync().then(book => {
      if (!live) return;
      if (!book) { setStatus('Unable to load authoritative sheet. Retained operations have not been replaced.'); setBlocked(true); return; }
      loaded = true; report();
      if (revoked || conflict) return;
      const entity = univer.__getInjector().get(CollaborationController).getCollabEntity(session.unitID);
      if (entity) presenceObserver = observeNativePresence(session.unitID, session.principal, entity.session, univer.__getInjector().get(MemberService),
        value => { if (live && !revoked && !conflict) setPresence(value); });
    }).catch(() => { if (live) { setStatus('Connecting failed — retained operations have not been replaced.'); setBlocked(true); } });
    // Display only; server checks each commit/read/send under Workspace authority.
    let checking = false;
    const timer = window.setInterval(async () => {
      if (checking || !live) return; checking = true;
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
      if (live && (univerAPI.getActiveWorkbook()?.isCellEditing() || collaboration.hasWritePending() || conflict)) { closing = undefined; throw new Error('Native edits are pending; keep this editor open.'); }
      if (host.current) host.current.inert = true;
      await cache.exhaustSavingTask();
      stopPresence();
      univer.dispose();
    })().catch(error => { closing = undefined; if (live && host.current) host.current.inert = blocked; throw error; });
    ready.current?.({ canLeave: () => loaded && !univerAPI.getActiveWorkbook()?.isCellEditing() && !collaboration.hasWritePending() && !conflict, close });
    return () => {
      ready.current?.(null);
      live = false; clearInterval(timer); window.removeEventListener('beforeunload', beforeUnload);
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
    <div aria-label="Sheet collaborators" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', overflowWrap: 'anywhere', marginBottom: '0.5rem' }}>
      <span>{session.name} (you{session.access.role === 'read' ? ', read-only' : ''})</span>
      {presence.online ? presence.members.filter(m => !m.self).map(m => <span key={m.memberID}>{m.name || 'Unnamed collaborator'}{m.userID === session.principal ? ' (your other session)' : ''}</span>) : <span>Live collaborators unavailable</span>}
    </div>
    {hasRecovery && <button onClick={download}>Download retained recovery operations</button>}<div style={{ position: 'relative' }}><div ref={host} style={{ height: '75vh' }} inert={blocked || undefined}/>{blocked && <p>Editing paused. Keep this tab open while resolving access or pending work.</p>}</div></>;
}
