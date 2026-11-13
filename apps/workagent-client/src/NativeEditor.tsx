import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { adjustRangeOnMutation, CalculationMode, FormulaExecutedStateType, InsertColMutation, InsertRowMutation, MoveColsMutation, MoveRowsMutation, RemoveColMutation, RemoveRowMutation, UniverSheetsCorePreset, type MutationsAffectRange } from '@univerjs/preset-sheets-core';
import UniverSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { serializeCsv, type CsvResult } from '../../../packages/workagent-contract/csv.mjs';
import { isHumanSheetMutation, pendingCell } from './drafts';
import { installEditorFocus } from './editor-focus';
import type { FormatEdits } from '../../../packages/workagent-contract/index.mjs';
import type { IWorkbookData, ICellData } from '@univerjs/core';
import '@univerjs/preset-sheets-core/lib/index.css';
export type SheetSelection = { workId: string; sheetId: string; sheetName: string; rangeLabel: string; range: { startRow: number; endRow: number; startColumn: number; endColumn: number } };
export type EditorHandle = { formatEdits?: () => FormatEdits | undefined; save: () => IWorkbookData; commit: () => Promise<IWorkbookData>; isEditing: () => boolean; selection: () => SheetSelection; selectionEpoch: () => number; exportCsv: () => Promise<CsvResult> };
export function NativeEditor({ book, version, formatEdits, onReady, onEdit }: { book: IWorkbookData; formatEdits?: FormatEdits | null; version: string; onReady: (editor: EditorHandle | null) => void; onEdit: (book: IWorkbookData) => void }) {
  const container = useRef<HTMLDivElement>(null), edit = useRef(onEdit), ready = useRef(onReady);
  edit.current = onEdit; ready.current = onReady;
  useEffect(() => {
    const notifyEdit = edit.current, notifyReady = ready.current;
    // Existing native snapshots can contain results cached before an external
    // patch. Univer's default WHEN_EMPTY trusts them; rebuild on every reopen.
    const { univer, univerAPI } = createUniver({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(UniverSheetsCoreEnUS) }, presets: [UniverSheetsCorePreset({ container: container.current!, formula: { initialFormulaComputing: CalculationMode.FORCED } })] });
    let releaseFocus = () => {};
    try {
    releaseFocus = installEditorFocus(univer, container.current!);
    const workbook = univerAPI.createWorkbook(structuredClone(book));
    // An ACK cannot clear a newer edit. Structural mutations relocate ownership;
    // deleted coordinates are retired, and undo restores styles via native mutations.
    // null denotes a recovered legacy draft, whose provenance is unknown.
    const formatted = new Map(Object.entries(formatEdits ?? {}).map(([sid, cells]) => [sid, new Set(cells)]));
    const pruneFormatting = () => {
      for (const [sid, cells] of formatted) {
        const sheet = workbook.getSheetBySheetId(sid);
        if (!sheet) { formatted.delete(sid); continue; }
        for (const cell of cells) if (!Number.isSafeInteger(cell) || cell < 0 || Math.floor(cell / 200) >= Math.min(10000, sheet.getMaxRows()) || cell % 200 >= Math.min(200, sheet.getMaxColumns())) cells.delete(cell);
        if (!cells.size) formatted.delete(sid);
      }
    };
    const formatting = (): FormatEdits | undefined => {
      pruneFormatting();
      return formatEdits === null ? undefined : Object.fromEntries([...formatted].map(([sid, cells]) => [sid, [...cells].sort((a, b) => a - b)]));
    };
    const stable = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
    const beforeStyles = new WeakMap<object, { sid: string; cells: [number, string][] }>();
    const structuralIds = new Set([InsertRowMutation.id, InsertColMutation.id, RemoveRowMutation.id, RemoveColMutation.id, MoveRowsMutation.id, MoveColsMutation.id]);
    const beforeStructure = new WeakMap<object, { sid: string; cells: Set<number> }>();
    const before = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, command => {
      if (!isHumanSheetMutation(command, false)) return;
      const params = command.params as { unitId?: string; subUnitId?: string; cellValue?: Record<string, Record<string, ICellData | null>>; values?: Record<string, { ranges: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] }>; ranges?: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] } | undefined;
      if (!params || params.unitId !== book.id || !params.subUnitId) return;
      const sheet = workbook.getSheetBySheetId(params.subUnitId); if (!sheet) return;
      if (structuralIds.has(command.id)) {
        const mutation = { id: command.id, params: command.params as MutationsAffectRange };
        const moved = new Set<number>();
        const relocate = (row: number, column: number, owned: boolean) => {
          const next = adjustRangeOnMutation({ startRow: row, endRow: row, startColumn: column, endColumn: column }, mutation);
          if (next && (owned || next.startRow !== row || next.startColumn !== column)
            && next.startRow >= 0 && next.startRow < 10000 && next.startColumn >= 0 && next.startColumn < 200) moved.add(next.startRow * 200 + next.startColumn);
        };
        for (const cell of formatted.get(params.subUnitId) ?? []) relocate(Math.floor(cell / 200), cell % 200, true);
        // Also cover styles saved before this editor opened. A human moving a
        // styled cell adopts its destination, even if its style was calculated.
        // Unmoved derived styles and automatic engine mutations remain neutral.
        // Only structural actions scan this sheet's sparse cells; no snapshots
        // or extra work are added to calculation/value-edit paths or payloads.
        sheet.getSheet().getCellMatrix().forValue((row, column, cell) => {
          if (cell?.s != null) relocate(row, column, false);
        });
        beforeStructure.set(params, { sid: params.subUnitId, cells: moved });
      }
      const cells = new Set<number>();
      if (command.id === 'sheet.mutation.set-range-values') {
        for (const [r, row] of Object.entries(params.cellValue ?? {})) for (const [c, value] of Object.entries(row ?? {})) {
          if (value === null || value && Object.hasOwn(value, 's')) cells.add(+r * 200 + +c);
        }
      } else if (command.id === 'sheet.mutation.set.numfmt' || command.id === 'sheet.mutation.remove.numfmt') {
        for (const range of params.ranges ?? Object.values(params.values ?? {}).flatMap(v => v.ranges)) {
          for (let r = range.startRow; r <= range.endRow; r++) for (let c = range.startColumn; c <= range.endColumn; c++) cells.add(r * 200 + c);
        }
      }
      if (cells.size) beforeStyles.set(params, { sid: params.subUnitId, cells: [...cells].map(cell => [cell, stable(sheet.getRange(Math.floor(cell / 200), cell % 200).getCellStyleData())]) });
    });
    let selectionEpoch = 0;
    const selectionKey = () => JSON.stringify([workbook.getActiveSheet().getSheetId(), workbook.getActiveSheet().getSelection()?.getActiveRangeList().map(r => r.getRange())]);
    let lastSelection = selectionKey();
    const selectionChanged = () => { const key = selectionKey(); if (key !== lastSelection) { lastSelection = key; selectionEpoch++; } };
    const selected = workbook.onSelectionChange(selectionChanged);
    let pending: IWorkbookData | null = null, disposed = false, edits = 0;
    const snapshot = () => structuredClone(pending ?? workbook.save());
    const commit = async () => {
      if (workbook.isCellEditing() && !await workbook.endEditingAsync(true)) throw new Error('Finish the current cell edit before continuing.');
      if (disposed || workbook.isCellEditing()) throw new Error('The editor changed. Retry from the current sheet.');
      pending = null;
      return structuredClone(workbook.save());
    };
    const selection = (): SheetSelection => {
      if (disposed) throw new Error('The editor changed. Attach the selection again.');
      const sheet = workbook.getActiveSheet(), ranges = sheet.getSelection()?.getActiveRangeList() ?? [];
      if (ranges.length !== 1) throw new Error('Select one contiguous range to attach. Multiple ranges cannot be attached yet.');
      const { startRow, endRow, startColumn, endColumn } = ranges[0].getRange();
      if (![startRow, endRow, startColumn, endColumn].every(n => Number.isSafeInteger(n) && n >= 0)
        || endRow < startRow || endColumn < startColumn || (endRow - startRow + 1) * (endColumn - startColumn + 1) > 2000) throw new Error('Select a range of at most 2,000 cells.');
      return { workId: book.id, sheetId: sheet.getSheetId(), sheetName: sheet.getSheetName(), rangeLabel: ranges[0].getA1Notation(), range: { startRow, endRow, startColumn, endColumn } };
    };
    notifyReady({ formatEdits: formatting, save: snapshot, isEditing: () => workbook.isCellEditing(), commit, selection, selectionEpoch: () => selectionEpoch, exportCsv: async () => {
      const sheetId = workbook.getActiveSheet().getSheetId();
      await commit();
      if (workbook.getActiveSheet().getSheetId() !== sheetId) throw new Error('The sheet changed while finishing the edit. Retry CSV export.');
      const generation = edits;
      const formula = univerAPI.getFormula();
      let forced = false, completed = false;
      const start = formula.calculationStart(force => { forced = force; completed = false; });
      const end = formula.calculationEnd(state => { completed = state === FormulaExecutedStateType.SUCCESS; });
      try {
        formula.executeCalculation();
        await formula.onCalculationResultApplied(10000);
        if (disposed || edits !== generation || workbook.isCellEditing() || workbook.getActiveSheet().getSheetId() !== sheetId) throw new Error('The sheet changed during calculation. Retry CSV export.');
        const saved = structuredClone(workbook.save());
        const formulas = Object.values(saved.sheets[sheetId].cellData ?? {}).some(row => (Object.values(row ?? {}) as (ICellData | null)[]).some(cell => cell?.f || cell?.si));
        // The SDK waiter can also resolve for a stopped session or its no-start
        // watchdog. Neither establishes freshness of formula caches.
        if (formulas && (!forced || !completed)) throw new Error('Formula calculation could not be verified. Retry CSV export.');
        return serializeCsv(saved, sheetId);
      } finally { start.dispose(); end.dispose(); }
    } });
    const changing = univerAPI.addEvent(univerAPI.Event.SheetEditChanging, event => {
      pending = pendingCell(workbook.save(), event.worksheet.getSheetId(), event.row, event.column, event.value.toPlainText(), event.value.getData());
      edits++; notifyEdit(snapshot());
    });
    const ended = univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => {
      pending = null;
      edits++; notifyEdit(structuredClone(workbook.save()));
    });
    const listener = univerAPI.addEvent(univerAPI.Event.CommandExecuted, command => {
      if (command.id === 'sheet.operation.set-worksheet-active' || command.id === 'sheet.operation.set-selections') selectionChanged();
      const params = command.params as object | undefined, prior = params && beforeStyles.get(params);
      const structure = params && beforeStructure.get(params);
      if (structure) {
        beforeStructure.delete(params!);
        formatted.set(structure.sid, structure.cells);
        pruneFormatting();
      }
      if (prior) {
        beforeStyles.delete(params!);
        const sheet = workbook.getSheetBySheetId(prior.sid);
        for (const [cell, old] of prior.cells) if (sheet && (command.id === 'sheet.mutation.set.numfmt' || command.id === 'sheet.mutation.remove.numfmt' || old !== stable(sheet.getRange(Math.floor(cell / 200), cell % 200).getCellStyleData()))) {
          if (!formatted.has(prior.sid)) formatted.set(prior.sid, new Set());
          formatted.get(prior.sid)!.add(cell);
        }
      }
      if (isHumanSheetMutation(command, workbook.isCellEditing())) { edits++; notifyEdit(structuredClone(workbook.save())); }
    });
    return () => { disposed = true; releaseFocus(); selected.dispose(); before.dispose(); listener.dispose(); changing.dispose(); ended.dispose(); notifyReady(null); univer.dispose(); };
    } catch (error) { releaseFocus(); univer.dispose(); throw error; }
  }, [version]);
  return <div className="native-editor" ref={container} aria-label="Editable spreadsheet" />;
}
