import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { CalculationMode, FormulaExecutedStateType, UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { serializeCsv, type CsvResult } from '../../../packages/workagent-contract/csv.mjs';
import { isHumanSheetMutation, pendingCell } from './drafts';
import type { IWorkbookData, ICellData } from '@univerjs/core';
import '@univerjs/preset-sheets-core/lib/index.css';
export type SheetSelection = { workId: string; sheetId: string; sheetName: string; rangeLabel: string; range: { startRow: number; endRow: number; startColumn: number; endColumn: number } };
export type EditorHandle = { save: () => IWorkbookData; commit: () => Promise<IWorkbookData>; isEditing: () => boolean; selection: () => SheetSelection; selectionEpoch: () => number; exportCsv: () => Promise<CsvResult> };
export function NativeEditor({ book, version, onReady, onEdit }: { book: IWorkbookData; version: string; onReady: (editor: EditorHandle | null) => void; onEdit: (book: IWorkbookData) => void }) {
  const container = useRef<HTMLDivElement>(null), edit = useRef(onEdit), ready = useRef(onReady);
  edit.current = onEdit; ready.current = onReady;
  useEffect(() => {
    const notifyEdit = edit.current, notifyReady = ready.current;
    // Existing native snapshots can contain results cached before an external
    // patch. Univer's default WHEN_EMPTY trusts them; rebuild on every reopen.
    const { univer, univerAPI } = createUniver({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(UniverSheetsCoreEnUS) }, presets: [UniverSheetsCorePreset({ container: container.current!, formula: { initialFormulaComputing: CalculationMode.FORCED } })] });
    const workbook = univerAPI.createWorkbook(structuredClone(book));
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
    notifyReady({ save: snapshot, isEditing: () => workbook.isCellEditing(), commit, selection, selectionEpoch: () => selectionEpoch, exportCsv: async () => {
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
      if (isHumanSheetMutation(command, workbook.isCellEditing())) { edits++; notifyEdit(structuredClone(workbook.save())); }
    });
    return () => { disposed = true; selected.dispose(); listener.dispose(); changing.dispose(); ended.dispose(); notifyReady(null); univer.dispose(); };
  }, [version]);
  return <div className="native-editor" ref={container} aria-label="Editable spreadsheet" />;
}
