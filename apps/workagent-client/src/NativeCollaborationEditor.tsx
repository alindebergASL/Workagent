import { useEffect, useRef, useState } from 'react';
import { LocaleType, LogLevel, UserManagerService } from '@univerjs/core';
import { UniverCollaborationPlugin } from '@univerjs-pro/collaboration';
import { UniverCollaborationClientPlugin, ILocalCacheService } from '@univerjs-pro/collaboration-client';
import CollaborationEnUS from '@univerjs-pro/collaboration-client/locale/en-US';
import { BrowserCollaborationSocketService, UniverCollaborationClientUIPlugin } from '@univerjs-pro/collaboration-client-ui';
import CollaborationUIEnUS from '@univerjs-pro/collaboration-client-ui/locale/en-US';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import SheetsEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { createUniver, defaultTheme, mergeLocales } from '@univerjs/presets';
import '@univerjs-pro/collaboration-client/facade';
import '@univerjs/preset-sheets-core/lib/index.css';
import '@univerjs-pro/collaboration-client-ui/lib/index.css';

export interface NativeSession { principal: string; name: string; binding: string; owner: boolean; unitID: string; access: { role: string; revision: number }; peer?: string }
// Native operations/cache are the only synchronization path. Never call legacy
// save, create a local workbook, replace a snapshot or mint retry identities.
export function NativeCollaborationEditor({ session }: { session: NativeSession }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Connecting — authoritative sheet not loaded');
  const [blocked, setBlocked] = useState(false);
  const recovery = useRef<string | null>(null);
  const [hasRecovery, setHasRecovery] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    let live = true, revoked = false, conflict = false;
    const recoveryKey = `workagent:native-recovery:${session.binding}:${session.unitID}`;
    try { recovery.current = localStorage.getItem(recoveryKey); setHasRecovery(!!recovery.current); } catch { /* SDK cache remains independent. */ }
    const base = `${location.origin}/universer-api`;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(SheetsEnUS, CollaborationEnUS, CollaborationUIEnUS) },
      theme: defaultTheme, logLevel: LogLevel.WARN, collaboration: true,
      presets: [UniverSheetsCorePreset({ container: host.current, ribbonType: 'grid' })],
      plugins: [UniverLicensePlugin, UniverCollaborationPlugin, [UniverCollaborationClientPlugin, {
        socketService: BrowserCollaborationSocketService, enableOfflineEditing: true, enableSingleActiveInstanceLock: true,
        sendChangesetTimeout: 200, authzUrl: `${base}/authz`, snapshotServerUrl: `${base}/snapshot`,
        collabSubmitChangesetUrl: `${base}/comb`, wsSessionTicketUrl: `${base}/user/session-ticket`,
        collabWebSocketUrl: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/universer-api/comb/connect`,
      }], UniverCollaborationClientUIPlugin],
    });
    univer.__getInjector().get(UserManagerService).setCurrentUser({ userID: session.principal, name: session.name, avatar: '' });
    const collaboration = univerAPI.getCollaboration();
    const report = () => {
      if (!live || conflict || revoked) return;
      const state = collaboration.getCollaborationStatus(session.unitID);
      const name = String(state);
      setStatus(`${name ?? state}${collaboration.hasWritePending(session.unitID) ? ' — edits not yet acknowledged; keep this tab open' : ''}`);
    };
    const subscriptions = [
      univerAPI.addEvent(univerAPI.Event.CollaborationStatusChanged, report),
      univerAPI.addEvent(univerAPI.Event.CollaborationChangesetResend, event => {
        if (live) setStatus(`Awaiting acknowledgement — SDK retry ${event.reqId}: ${event.reason}`);
      }),
      univerAPI.addEvent(univerAPI.Event.CollaborationConflict, event => {
        conflict = true; setBlocked(true);
        // Capture before any reload. Awaiting operations may have committed:
        // recovery is retained for inspection, never resubmitted as a new edit.
        recovery.current = JSON.stringify({ principal: session.principal, unitID: session.unitID, reason: event.reason, localChanges: event.localChanges });
        setHasRecovery(true);
        try {
          localStorage.setItem(recoveryKey, recovery.current);
          setStatus(`Conflict: ${event.reason}. Recovery operations retained. An awaiting edit may already be committed.`);
        } catch { setStatus(`Conflict: ${event.reason}. Recovery is in memory only — download it before closing this tab.`); }
      }),
    ];
    const beforeUnload = (event: BeforeUnloadEvent) => { if (collaboration.hasWritePending(session.unitID) || conflict) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    void collaboration.loadSheetAsync(session.unitID).then(book => {
      if (!live) return;
      if (!book) { setStatus('Unable to load authoritative sheet. Retained operations have not been replaced.'); setBlocked(true); return; }
      report();
    }).catch(() => { if (live) { setStatus('Connecting failed — retained operations have not been replaced.'); setBlocked(true); } });
    // Display only; server checks each commit/read/send under Workspace authority.
    let checking = false;
    const timer = window.setInterval(async () => {
      if (checking || !live) return; checking = true;
      try {
        const response = await fetch('/api/native/session');
        if (!live) return;
        if (response.status === 401 || response.status === 403) { revoked = true; setBlocked(true); setStatus('Access revoked or session expired — local work retained; no confirmed save claim.'); }
        else if (response.ok) {
          const current: NativeSession = await response.json();
          if (current.principal !== session.principal || current.access.revision !== session.access.revision) { revoked = true; setBlocked(true); setStatus('Access changed — this session is fenced. Preserve pending work before reopening.'); }
        } else setStatus('Stale — authority check failed; keep this tab open.');
      } catch { if (live) setStatus('Disconnected — local work may be pending; native SDK will reconnect.'); }
      finally { checking = false; }
    }, 1500);
    return () => {
      live = false; clearInterval(timer); window.removeEventListener('beforeunload', beforeUnload);
      subscriptions.forEach(s => s.dispose());
      // Complete the native cache save before disposing its editor.
      void univer.__getInjector().get(ILocalCacheService).exhaustSavingTask().finally(() => univer.dispose());
    };
  }, [session]);
  const download = () => {
    if (!recovery.current) return;
    const url = URL.createObjectURL(new Blob([recovery.current], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'native-operation-recovery.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <><p role="status" data-native-status>{status}</p>{hasRecovery && <button onClick={download}>Download retained recovery operations</button>}<div style={{ position: 'relative' }}><div ref={host} style={{ height: '75vh' }} inert={blocked || undefined}/>{blocked && <p>Editing paused. Keep this tab open while resolving access or pending work.</p>}</div></>;
}
