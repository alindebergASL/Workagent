import { CollaborationUIEventId, SessionStatus } from '@univerjs-pro/collaboration-client';
import type { CollaborationSession, CollaborationSessionService, CollaborationUIEventService } from '@univerjs-pro/collaboration-client';

// The native service stops after SOCKET_FAILED. Let it own every retry within
// a cycle; only a new exhaustion event can authorize another recovery cycle.
// This helper has no timer, session creation or content submission path.
export function nativeSocketRecovery(
  unitID: string,
  service: Pick<CollaborationSessionService, 'reconnect'>,
  events: Pick<CollaborationUIEventService, 'event$'>,
  session: () => Pick<CollaborationSession, 'sessionStatus'> | undefined,
  eligible: () => boolean,
  now: () => number = () => performance.now(),
) {
  let live = true, exhausted = false, licenseRejected = false;
  let nextRecovery = -Infinity;
  const observation = events.event$.subscribe(event => {
    if (!live || (event.unitID && event.unitID !== unitID)) return;
    if (event.id === CollaborationUIEventId.LICENSE_DOMAIN_REJECTED) { licenseRejected = true; exhausted = false; }
    else if (event.id === CollaborationUIEventId.SOCKET_FAILED) exhausted = true;
    else if (event.id === CollaborationUIEventId.SOCKET_FAILED_RETRY) exhausted = false;
  });
  return {
    // Called only after a fresh, matching authority response, never by an event
    // or timer alone. HTTP success does not imply native ONLINE or an ACK.
    authorityChecked() {
      if (!live || licenseRejected || !eligible()) return;
      const status = session()?.sessionStatus;
      if (status === SessionStatus.ONLINE) { exhausted = false; return; }
      if (status !== SessionStatus.OFFLINE || !exhausted || now() < nextRecovery) return;
      exhausted = false;
      nextRecovery = now() + 60_000;
      // Public SDK method serializes socket creation and ignores an already
      // connecting/connected channel. Existing sessions, cache and SID survive.
      service.reconnect();
    },
    dispose() { live = false; exhausted = false; observation.unsubscribe(); },
  };
}
