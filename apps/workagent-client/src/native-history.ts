import { CanceledError, UndoCommand, RedoCommand } from '@univerjs/core';
import type { ICommandService, IUndoRedoService } from '@univerjs/core';

export const NATIVE_UNDO_UNAVAILABLE = 'Sheet undo/redo is unavailable: native undo can overwrite a teammate’s later edit. Text-input undo remains available. History is read-only.';
// Instance-scoped public interception, before either sync or async execution.
// Resolve the actual public stack target, including embedded text editors. Browser text
// input does not use this command route. Never clear or rewrite a native stack.
export function containNativeUndo(unitID: string, commands: Pick<ICommandService, 'beforeCommandExecuted'>,
  undo: Pick<IUndoRedoService, 'pitchTopUndoElement' | 'pitchTopRedoElement'>, report: () => void) {
  return commands.beforeCommandExecuted(command => {
    const target = command.id === UndoCommand.id ? undo.pitchTopUndoElement() : command.id === RedoCommand.id ? undo.pitchTopRedoElement() : null;
    if (target?.unitID === unitID) {
      report(); throw new CanceledError();
    }
  });
}
export interface NativeHistoryEntry { revision: number; author: string; operations: string[]; operationCount: number }
export interface NativeHistoryPreview { revision: number; sheets: { id: string; name: string; rows: number; columns: number; cells: { cell: string; value: string }[]; merges?: { startRow: number; endRow: number; startColumn: number; endColumn: number }[]; mergeCount?: number; mergesTruncated?: boolean }[]; limited: boolean }
export interface NativeHistoryView { message: string; head?: number; entries: NativeHistoryEntry[]; before?: number; preview?: NativeHistoryPreview }
export function nativeHistory(session: { unitID: string; binding: string; access: { revision: number } }, changed: (view: NativeHistoryView) => void, fetcher: typeof fetch) {
  let disposed = false, generation = 0, abort: AbortController | undefined;
  let view: NativeHistoryView = { message: 'History not loaded', entries: [] };
  async function read(query = '') {
    if (disposed) return;
    const current = ++generation; abort?.abort(); abort = new AbortController();
    changed({ ...view, message: 'Loading native history…' });
    try {
      const response = await fetcher(`/api/work/${session.unitID}/native-history/${session.access.revision}${query}`, { signal: abort.signal, headers: { 'X-Workagent-Session-Binding': session.binding } });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'History unavailable — access changed.' : 'History read failed. Try again explicitly.');
      const data = await response.json();
      if (disposed || current !== generation) return;
      view = query.startsWith('?revision=') ? { ...view, preview: data, message: `Read-only preview of revision ${data.revision}. Live sheet unchanged.` } : { ...data, message: 'Native history · read-only. Sheet Undo and whole-artifact restore remain unavailable; explicit operation reversal is separate.' };
      changed(view);
    } catch (error) {
      if (!disposed && current === generation) { view = { entries: [], message: error instanceof Error ? error.message : 'History unavailable.' }; changed(view); }
    }
  }
  return { read, dispose() { disposed = true; generation++; abort?.abort(); changed({ entries: [], message: 'History unavailable — session closed or access changed.' }); } };
}

export function historyMergeRange(range: { startRow: number; endRow: number; startColumn: number; endColumn: number }) {
  const cell = (row: number, column: number) => { let name = ''; for (let n = column + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return `${name}${row + 1}`; };
  return `${cell(range.startRow, range.startColumn)}:${cell(range.endRow, range.endColumn)}`;
}
