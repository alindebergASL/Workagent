import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { CollaborationUIEventId } from '@univerjs-pro/collaboration-client';
import type { CollaborationController, CollaborationEntity, CollaborationUIEventService, IChangesetResendEvent } from '@univerjs-pro/collaboration-client';

const CAPACITY = 'Editing capacity refused this edit. Editing connections, including agent action connections, share the licensed limit. Edits remain unacknowledged; keep this tab open and wait for an editing slot.';
const waiting = {
  ack_timeout: 'Waiting for native acknowledgement',
  should_retry: 'Native service requested a retry; waiting for acknowledgement',
  reconnect: 'Native connection resumed; waiting for acknowledgement',
  request_failed: 'Native request failed; waiting for acknowledgement',
  license_editing_connections_exceeded: 'Waiting for native acknowledgement',
};
type Identity = { sid: string; reqId: number };
// Observation only. A resend reason has no SID. Pair it with the same entity's
// public retry envelope; never infer capacity from code 9016 or HTTP alone.
export function nativeCapacityStatus(unitID: string,
  controller: Pick<CollaborationController, 'getCollabEntity$'>,
  events: Pick<CollaborationUIEventService, 'event$'>,
  pending: () => boolean, changed: () => void) {
  let live = true, generation = 0, domainRejected = false;
  let streams: { unsubscribe(): void }[] = [];
  let currentEntity: CollaborationEntity | undefined;
  let identity: Identity | undefined, capacity: Identity | undefined, reason: string | undefined;
  let highest = 0, acknowledged = 0, sid: string | undefined;
  const reset = () => { identity = capacity = undefined; reason = undefined; highest = acknowledged = 0; sid = undefined; };
  const entities = controller.getCollabEntity$(unitID).subscribe((entity: CollaborationEntity) => {
    if (!live || entity === currentEntity) return;
    currentEntity = entity;
    const owned = ++generation; streams.forEach(s => s.unsubscribe()); reset();
    const current = () => live && generation === owned;
    streams = [entity.session.event$.subscribe(event => {
      if (!current()) return;
      if (event.eventID !== CollaborationEvent.CHANGESET_SHOULD_RETRY && event.eventID !== CollaborationEvent.CHANGESET_ACK) return;
      if (!('data' in event) || !event.data || typeof event.data !== 'object') return;
      const data = event.data as { unitID?: string; sid?: string; reqId?: number; revision?: number };
      if (data.unitID !== unitID || typeof data.sid !== 'string' || !data.sid || !Number.isSafeInteger(data.reqId) || data.reqId! < 1) return;
      if (event.eventID === CollaborationEvent.CHANGESET_SHOULD_RETRY) {
        if (!pending() || data.reqId! <= acknowledged || data.reqId! < highest || (sid && data.sid !== sid)) return;
        sid = data.sid; highest = data.reqId!; identity = {sid: data.sid, reqId: highest};
      } else {
        // Only the exact observed pending request can retire capacity evidence;
        // another SID, another request or a peer broadcast cannot do so.
        if (!identity || data.sid !== identity.sid || data.reqId !== identity.reqId || !Number.isSafeInteger(data.revision) || data.revision! < 1) return;
        acknowledged = Math.max(acknowledged, data.reqId!); identity = capacity = undefined; reason = undefined;
      }
      changed();
    }), entity.changesetResend$.subscribe((event: IChangesetResendEvent) => {
      if (!current() || event.unitID !== unitID || !pending() || !Number.isSafeInteger(event.reqId) || event.reqId <= acknowledged || event.reqId < highest || !Number.isSafeInteger(event.unsyncedMutationCount) || event.unsyncedMutationCount < 1) return;
      if (event.reqId > highest) { highest = event.reqId; identity = undefined; }
      if (event.reason === 'license_editing_connections_exceeded' && identity?.reqId === event.reqId) capacity = {...identity};
      reason = waiting[event.reason]; changed();
    })];
    changed();
  });
  const ui = events.event$.subscribe(event => {
    if (live && (!event.unitID || event.unitID === unitID) && event.id === CollaborationUIEventId.LICENSE_DOMAIN_REJECTED) { domainRejected = true; changed(); }
  });
  return {
    view() {
      if (!live) return {};
      if (!pending()) {
        // SDK no-pending is authoritative. Keep the monotonic floor so delayed
        // events cannot reattach a completed request to a later local edit.
        acknowledged = Math.max(acknowledged, highest); identity = capacity = undefined; reason = undefined;
      }
      return { domainRejected, message: capacity && capacity.reqId === highest && pending() ? CAPACITY : pending() ? reason : undefined };
    },
    dispose() { live = false; generation++; entities.unsubscribe(); ui.unsubscribe(); streams.forEach(s => s.unsubscribe()); streams = []; reset(); },
  };
}
