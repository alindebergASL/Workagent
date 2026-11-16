import { SessionStatus } from '@univerjs-pro/collaboration-client';
import type { CollaborationSession, CollaborationSessionService, MemberService } from '@univerjs-pro/collaboration-client';
import { CombCmd, CmdRspCode, type IMember } from '@univerjs/protocol';

export interface NativePresence { online: boolean; members: (IMember & { self: boolean })[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Install before loadUnit: a reconnect can finish before the UI's entity is
// ready. Observe the existing default-endpoint stream (this consumer uses one
// native unit per instance), never request a session/socket or send a message.
export function observeNativeMembershipJoins(unitID: string, principal: string,
  sessions: Pick<CollaborationSessionService, 'socket$'>,
  membership: Pick<MemberService, 'getRoom' | 'removeMember'>) {
  let disposed = false, generation = 0, messages: { unsubscribe(): void } | undefined;
  const sockets = sessions.socket$.subscribe(socket => {
    const current = ++generation; messages?.unsubscribe(); messages = undefined;
    if (!socket || disposed) return;
    messages = socket.message$.subscribe(event => {
      if (disposed || current !== generation || !isRecord(event) || event.cmd !== CombCmd.JOIN || event.code !== CmdRspCode.OK || event.routeKey !== unitID) return;
      const data: unknown = event.data;
      if (!isRecord(data) || !isRecord(data.roomInfos)) return;
      const room = data.roomInfos[unitID];
      // Reject the whole malformed list: filtering entries could turn an
      // incomplete JOIN into apparent departures and prune live members.
      if (!isRecord(room) || room.roomID !== unitID || !Array.isArray(room.members) || !room.members.every(m =>
        isRecord(m) && typeof m.memberID === 'string' && typeof m.userID === 'string' && typeof m.name === 'string'
        && (m.avatar === undefined || typeof m.avatar === 'string'))) return;
      if (!room.members.some(m => m.memberID === socket.memberID && m.userID === principal)) return;
      const currentIDs = new Set(room.members.map(m => m.memberID));
      // Reconcile only departures; native JOIN remains the source of additions
      // and names. It merges its full authoritative list into MemberService.
      for (const old of membership.getRoom(unitID)?.getAllMembers() ?? []) if (!currentIDs.has(old.memberID)) membership.removeMember(unitID, old.memberID);
    });
  });
  return { dispose() { disposed = true; generation++; messages?.unsubscribe(); sockets.unsubscribe(); } };
}

// Observes the already loaded native session; never creates a session or sends.
// A membership list is display data, never an authorization decision.
export function observeNativePresence(
  unitID: string, principal: string,
  session: Pick<CollaborationSession, 'sessionStatus' | 'sessionStatus$' | 'getMemberID'>,
  membership: Pick<MemberService, 'getRoom' | 'waitForRoom$' | 'removeMember'>,
  changed: (presence: NativePresence) => void,
) {
  let disposed = false, generation = 0, initialStatus = true;
  let members: { unsubscribe(): void } | undefined, rooms: { unsubscribe(): void } | undefined;
  const clear = () => { generation++; members?.unsubscribe(); rooms?.unsubscribe(); members = rooms = undefined; changed({ online: false, members: [] }); };
  const status = session.sessionStatus$.subscribe({
    next: state => {
      if (disposed) return;
      const initial = initialStatus; initialStatus = false;
      clear();
      if (state !== SessionStatus.ONLINE) return;
      // Pinned SDK: a successful JOIN emits ONLINE synchronously BEFORE it
      // merges that JOIN's members. Remove only this room's previous join data
      // through the public API; the native JOIN then supplies the complete list.
      // The initial BehaviorSubject replay is not a new JOIN: this editor may
      // attach after its first load, so preserve that already-populated list.
      if (!initial) for (const member of membership.getRoom(unitID)?.getAllMembers() ?? []) membership.removeMember(unitID, member.memberID);
      const current = generation;
      const selfID = session.getMemberID();
      // ONLINE may precede even the first room creation. waitForRoom$ can emit
      // undefined for an unrelated room in 1.4.0, so check the actual room too.
      rooms = membership.waitForRoom$(unitID).subscribe(room => {
        if (disposed || current !== generation || !room || room !== membership.getRoom(unitID)) return;
        members?.unsubscribe();
        members = room.members$.subscribe(map => {
          const list = Array.from(map.values());
          if (disposed || current !== generation || session.sessionStatus !== SessionStatus.ONLINE || session.getMemberID() !== selfID) return;
          if (!selfID || !list.some(m => m.memberID === selfID && m.userID === principal)) {
            changed({ online: false, members: [] }); return;
          }
          changed({ online: true, members: list.map(m => ({ ...m, self: m.memberID === selfID })) });
        });
      });
    },
    complete: () => { if (!disposed) { disposed = true; clear(); } },
  });
  return { dispose() { if (disposed) return; disposed = true; status.unsubscribe(); clear(); } };
}
