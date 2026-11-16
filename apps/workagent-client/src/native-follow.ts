import { CommandService, ICommandService, Injector, type DependencyOverride, type IExecutionOptions, type IRange, type Workbook } from '@univerjs/core';
import { deserializeRangeWithSheet } from '@univerjs/engine-formula';
import type { RefRangeService } from '@univerjs/sheets';
import { ScrollToRangeOperation, SheetPasteShortKeyCommand } from '@univerjs/sheets-ui';
import { PasteCommand } from '@univerjs/ui';
import { CollaborationEvent } from '@univerjs-pro/collaboration';
import { SessionStatus } from '@univerjs-pro/collaboration-client';
import type { CollaborationSession } from '@univerjs-pro/collaboration-client';
import type { NativePresence } from './native-presence';

export interface NativeFollowState { memberID?: string; message: string }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// Clipboard facade events have no error/cancellation completion and the menu
// path reads asynchronously before emitting them. Observe the actual public
// command promise instead. Scope the override to this native editor instance.
export function nativePasteActivity(onStart: () => void) {
  let pending = 0;
  const override: DependencyOverride = [[ICommandService, { deps: [Injector], useFactory: (injector: Injector) => {
    const native = injector.createInstance(CommandService), methods = new Map<PropertyKey, unknown>();
    const execute = <P extends object = object, R = boolean>(id: string, params?: P, options?: IExecutionOptions): Promise<R> => {
      if (id !== PasteCommand.id && id !== SheetPasteShortKeyCommand.id) return native.executeCommand<P, R>(id, params, options);
      pending++; onStart();
      return native.executeCommand<P, R>(id, params, options).finally(() => { pending--; });
    };
    return new Proxy(native, { get(target, key) {
      if (key === 'executeCommand') return execute;
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function' || key === 'constructor') return value;
      if (!methods.has(key)) methods.set(key, value.bind(target));
      return methods.get(key);
    } });
  } }]];
  return { override, busy: () => pending > 0 };
}

// One loaded session/React epoch only. No retained cursor coordinates, sends,
// selection changes or session creation. A new intent waits for a fresh cursor.
export function nativeFollow(unitID: string, session: Pick<CollaborationSession, 'event$' | 'sessionStatus' | 'sessionStatus$' | 'getMemberID'>,
  workbook: () => Workbook | null, refs: Pick<RefRangeService, 'watchRange'>,
  commands: Pick<ICommandService, 'syncExecuteCommand'>, busy: () => boolean,
  changed: (state: NativeFollowState) => void) {
  let disposed = false, generation = 0, position = 0, presence: NativePresence = { online: false, members: [] };
  let target: NativePresence['members'][number] | undefined;
  let events: { unsubscribe(): void } | undefined, watch: { dispose(): void } | undefined;
  const clear = () => { generation++; events?.unsubscribe(); watch?.dispose(); events = watch = undefined; };
  const stop = (message = 'Not following') => { clear(); target = undefined; if (!disposed) changed({ message }); };
  const pause = (message: string) => { clear(); if (!disposed) changed({ memberID: target?.memberID, message: `Paused — ${message}. Choose Follow again to resume.` }); };
  const online = () => !disposed && presence.online && session.sessionStatus === SessionStatus.ONLINE;
  const status = session.sessionStatus$.subscribe(value => { if (value !== SessionStatus.ONLINE) stop('Following stopped — disconnected'); });
  function follow(memberID: string) {
    if (disposed) return;
    stop();
    const member = presence.members.find(m => m.memberID === memberID && !m.self && m.memberID !== session.getMemberID());
    if (!online() || !member) return;
    target = { ...member };
    if (busy()) { pause('finish local input or pending edits first'); return; }
    changed({ memberID, message: `Following ${member.name || 'collaborator'} — waiting for their next selection` });
    const current = generation;
    events = session.event$.subscribe(event => {
      if (disposed || current !== generation || !online() || !target || !record(event) || event.eventID !== CollaborationEvent.UPDATE_CURSOR) return;
      const data: unknown = event.data;
      if (!record(data) || data.unitID !== unitID || data.memberID !== target.memberID || (data.userID !== undefined && data.userID !== target.userID)) return;
      if (busy()) { pause('finish local input or pending edits first'); return; }
      watch?.dispose(); watch = undefined;
      const currentPosition = ++position;
      if (typeof data.selection !== 'string' || data.selection.length > 4096) { pause('teammate position unavailable'); return; }
      let decoded: ReturnType<typeof deserializeRangeWithSheet>;
      try { decoded = deserializeRangeWithSheet(data.selection); } catch { pause('teammate position unavailable'); return; }
      const book = workbook(), sheet = book?.getSheetBySheetId(decoded.sheetName);
      const range = decoded.range;
      if (!sheet || (decoded.unitId && decoded.unitId !== unitID) || !validRange(range, sheet.getRowCount(), sheet.getColumnCount())) { pause('teammate position unavailable'); return; }
      if (book?.getActiveSheet()?.getSheetId() !== decoded.sheetName) { pause('teammate is on another worksheet; switch there explicitly'); return; }
      // Cursor events carry no revision. Track with native transforms, but do
      // not guess cursor/changeset causality or scroll through structural edits.
      watch = refs.watchRange(unitID, decoded.sheetName, range, (_before, after) => {
        if (disposed || current !== generation || currentPosition !== position) return;
        pause(after ? 'sheet structure changed; wait for a fresh teammate selection' : 'followed cells were removed');
      });
      if (!commands.syncExecuteCommand(ScrollToRangeOperation.id, { unitId: unitID, range })) { pause('viewport unavailable'); return; }
      changed({ memberID, message: `Following ${target.name || 'collaborator'} — view only` });
    });
  }
  return {
    follow, stop,
    localInteraction: () => { if (target) stop('Following stopped — local interaction'); },
    presence(value: NativePresence) {
      presence = value;
      if (target && (!online() || !value.members.some(m => m.memberID === target!.memberID && m.userID === target!.userID && !m.self))) stop('Following stopped — teammate unavailable');
    },
    dispose() { if (disposed) return; stop(); disposed = true; status.unsubscribe(); },
  };
}

function validRange(r: IRange, rows: number, columns: number) {
  return [r.startRow, r.endRow, r.startColumn, r.endColumn].every(n => Number.isSafeInteger(n) && n >= 0)
    && r.startRow <= r.endRow && r.startColumn <= r.endColumn && r.endRow < rows && r.endColumn < columns;
}
