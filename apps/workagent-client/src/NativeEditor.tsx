import { useEffect, useRef } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { CalculationMode, UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { isHumanSheetMutation, pendingCell } from './drafts';
import type { IWorkbookData } from '@univerjs/core';
import '@univerjs/preset-sheets-core/lib/index.css';
export type EditorHandle = { save: () => IWorkbookData; commit: () => Promise<IWorkbookData>; isEditing: () => boolean };
export function NativeEditor({ book, version, onReady, onEdit }: { book: IWorkbookData; version: string; onReady: (editor: EditorHandle | null) => void; onEdit: (book: IWorkbookData) => void }) {
  const container = useRef<HTMLDivElement>(null), edit = useRef(onEdit), ready = useRef(onReady);
  edit.current = onEdit; ready.current = onReady;
  useEffect(() => {
    // Existing native snapshots can contain results cached before an external
    // patch. Univer's default WHEN_EMPTY trusts them; rebuild on every reopen.
    const { univer, univerAPI } = createUniver({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(UniverSheetsCoreEnUS) }, presets: [UniverSheetsCorePreset({ container: container.current!, formula: { initialFormulaComputing: CalculationMode.FORCED } })] });
    const workbook = univerAPI.createWorkbook(structuredClone(book));
    let pending: IWorkbookData | null = null;
    const snapshot = () => structuredClone(pending ?? workbook.save());
    ready.current({ save: snapshot, isEditing: () => workbook.isCellEditing(), commit: async () => {
      if (workbook.isCellEditing()) await workbook.endEditingAsync(true);
      pending = null;
      return structuredClone(workbook.save());
    } });
    const changing = univerAPI.addEvent(univerAPI.Event.SheetEditChanging, event => {
      pending = pendingCell(workbook.save(), event.worksheet.getSheetId(), event.row, event.column, event.value.toPlainText(), event.value.getData());
      edit.current(snapshot());
    });
    const ended = univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => {
      pending = null;
      edit.current(structuredClone(workbook.save()));
    });
    const listener = univerAPI.addEvent(univerAPI.Event.CommandExecuted, command => {
      if (isHumanSheetMutation(command, workbook.isCellEditing())) edit.current(structuredClone(workbook.save()));
    });
    return () => { listener.dispose(); changing.dispose(); ended.dispose(); ready.current(null); univer.dispose(); };
  }, [version]);
  return <div className="native-editor" ref={container} aria-label="Editable spreadsheet" />;
}
