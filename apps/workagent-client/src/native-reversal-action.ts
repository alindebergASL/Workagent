import { Univer, ILogService } from '@univerjs/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { CombCmd, type IChangeset } from '@univerjs/protocol';
import type { ICombResponseEvent } from '@univerjs-pro/collaboration';
import { CollaborationSession, MemberService, CommentService, CollaborationUIEventService, SessionStatus, serializeCombRequest, deserializeToCombResponse } from '@univerjs-pro/collaboration-client';
import type { ICollaborationSocket } from '@univerjs-pro/collaboration-client';

export interface ReversalAction { memberID: string; submit(request: IChangeset): Promise<void>; dispose(): void }
// One owned native action connection, with no workbook, reconnect, retry or replay.
// Its isolated core instance supplies public MemberService DI and cannot clear the
// human editor's membership/resources when it is disposed.
async function openAction(unitID: string, path: string, binding: string, signal: AbortSignal,
  fetcher: typeof fetch = fetch, socketFactory: (url: string) => WebSocket = url => new WebSocket(url), origin = location.origin, purpose: 'reversal' | 'agent-acceptance' | 'scalar-restore' = 'reversal'): Promise<ReversalAction> {
  const base = new URL(path, origin);
  const match = /^\/api\/native\/([a-zA-Z0-9_-]+)\/[1-9][0-9]*\/(reversal|agent-acceptance|scalar-restore)\/[a-zA-Z0-9_-]+\/universer-api$/.exec(base.pathname);
  if (base.origin !== origin || base.search || base.hash || !binding || !match || match[1] !== unitID || match[2] !== purpose) throw Error('Invalid action path');
  const headers = { 'X-Workagent-Session-Binding': binding };
  const ticketResponse = await fetcher(`${base}/user/session-ticket`, { signal, credentials: 'same-origin', headers });
  if (!ticketResponse.ok) throw Error('Action admission unavailable; identity retained.');
  const { ticket } = await ticketResponse.json();
  if (typeof ticket !== 'string' || !ticket || signal.aborted) throw Error('Action admission interrupted.');
  const url = new URL(`${base}/comb/connect`); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'; url.searchParams.set('sessionTicket', ticket);
  const ws = socketFactory(url.href), messages = new Subject<ICombResponseEvent>(), closed = new Subject<Event>();
  const sockets = new BehaviorSubject<ICollaborationSocket | null>(null), owned = new Univer();
  const members = owned.__getInjector().createInstance(MemberService);
  let session: CollaborationSession | undefined, status: { unsubscribe(): void } | undefined;
  let disposed = false, sent = false, memberID = '', timer: ReturnType<typeof setTimeout> | undefined;
  let rejectReady: (error: Error) => void = () => {};
  const dispose = () => {
    if (disposed) return; disposed = true; clearTimeout(timer); signal.removeEventListener('abort', aborted);
    status?.unsubscribe(); sockets.next(null); session?.dispose(); sockets.complete(); members.dispose(); owned.dispose();
    ws.removeEventListener('open', opened); ws.removeEventListener('message', message); ws.removeEventListener('error', failed); ws.removeEventListener('close', disconnected);
    ws.close(); messages.complete(); closed.complete();
  };
  const failed = () => { rejectReady(Error('Action connection unavailable. No automatic retry.')); dispose(); };
  const aborted = () => { rejectReady(Error('Action interrupted; retained identity must be checked.')); dispose(); };
  const disconnected = () => { closed.next(new Event('close')); failed(); };
  const opened = () => { ws.send(serializeCombRequest({ cmd: CombCmd.HELLO, routeKey: '', routeType: '' })); };
  const message = (event: MessageEvent) => {
    if (disposed) return;
    try {
      const frame = deserializeToCombResponse(event);
      if (frame.cmd === CombCmd.HELLO && frame.data?.memberID && !session) {
        memberID = frame.data.memberID;
        const socket: ICollaborationSocket = { memberID, message$: messages, close$: closed, open$: new Subject(), error$: new Subject(), close: () => ws.close(), send: value => { if (disposed) throw Error('Action connection closed'); ws.send(serializeCombRequest(value)); } };
        session = new CollaborationSession({ localUnitId: unitID, unitType: 2, target: { unitId: unitID, unitType: 2 } }, sockets, owned.__getInjector().get(ILogService), members, new CommentService(), new CollaborationUIEventService());
        status = session.sessionStatus$.subscribe(value => { if (value === SessionStatus.ONLINE) ready(); });
        sockets.next(socket);
      }
      messages.next(frame);
    } catch { failed(); } // Only this action's malformed transport frames; never human content errors.
  };
  let ready: () => void = () => {};
  const connected = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
  ws.addEventListener('open', opened); ws.addEventListener('message', message); ws.addEventListener('error', failed); ws.addEventListener('close', disconnected);
  signal.addEventListener('abort', aborted, { once: true }); timer = setTimeout(failed, 10000);
  if (signal.aborted) aborted();
  try { await connected; clearTimeout(timer); } catch (error) { dispose(); throw error; }
  return { memberID, dispose, async submit(request) {
    if (disposed || sent || signal.aborted || request.memberID !== memberID || request.unitID !== unitID || session?.sessionStatus !== SessionStatus.ONLINE) throw Error('Action cannot be submitted again. Check its retained identity.');
    sent = true;
    const response = await fetcher(`${base}/comb/2/unit/${unitID}/new_changes`, { method: 'POST', credentials: 'same-origin', signal, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ unitID, type: 2, memberID, changeset: request }) });
    if (!response.ok) throw Error('Native submission outcome uncertain. Check status; do not retry.');
    // HTTP success/ACK/idle are not publication proof. Caller reads native receipt.
  } };
}

export function openReversalAction(...args: Parameters<OmitPurpose>) { return openAction(...args); }
type OmitPurpose = (unitID: string, path: string, binding: string, signal: AbortSignal, fetcher?: typeof fetch, socketFactory?: (url: string) => WebSocket, origin?: string) => Promise<ReversalAction>;
export const openAcceptanceAction: OmitPurpose = (unitID, path, binding, signal, fetcher, socketFactory, origin) => openAction(unitID, path, binding, signal, fetcher, socketFactory, origin, 'agent-acceptance');

export const openRestoreAction: OmitPurpose = (unitID, path, binding, signal, fetcher, socketFactory, origin) => openAction(unitID, path, binding, signal, fetcher, socketFactory, origin, 'scalar-restore');
