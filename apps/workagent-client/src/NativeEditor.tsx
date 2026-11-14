import { conditionalRuleEditor, type ConditionalPanelProps } from './conditional-icon-editor';
import { CF_PANEL_KEY, UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import UniverSheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';
import { conditionalCorePreset, NativeConditionalPlugin, installConditionalStructure } from './native-conditional';
import { CONDITIONAL_SCOPE, conditionalRules, validateConditionalRules } from '../../../packages/workagent-contract/conditional-formatting.mjs';
import { createElement, useEffect, useRef, type ComponentType } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { adjustRangeOnMutation, CalculationMode, ComponentManager, IMessageService, FormulaExecutedStateType, InsertColMutation, InsertRowMutation, MoveColsMutation, MoveRowsMutation, RemoveColMutation, RemoveRowMutation, SetRangeValuesCommand, SheetInterceptorService, UniverSheetsCorePreset, type ISetRangeValuesCommandParams, type MutationsAffectRange } from '@univerjs/preset-sheets-core';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import UniverSheetsDataValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US';
import '@univerjs/preset-sheets-data-validation/lib/index.css';
import UniverSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { serializeCsv, type CsvResult } from '../../../packages/workagent-contract/csv.mjs';
import { isHumanSheetMutation, pendingCell } from './drafts';
import { installValidationSettlement } from './validation-settlement';
import { installEditorFocus } from './editor-focus';
import type { FormatEdits } from '../../../packages/workagent-contract/index.mjs';
import { CanceledError, LocaleService, CellValueType, CommandType, ICommandService, isICellData, type IWorkbookData, type ICellData } from '@univerjs/core';
import '@univerjs/preset-sheets-core/lib/index.css';
export type SheetSelection = { workId: string; sheetId: string; sheetName: string; rangeLabel: string; range: { startRow: number; endRow: number; startColumn: number; endColumn: number } };
export type EditorHandle = { formatEdits?: () => FormatEdits | undefined; save: () => IWorkbookData; commit: () => Promise<IWorkbookData>; isEditing: () => boolean; selection: () => SheetSelection; selectionEpoch: () => number; exportCsv: () => Promise<CsvResult> };
export function NativeEditor({ book, version, formatEdits, humanCells, onReady, onEdit }: { book: IWorkbookData; humanCells?: string[]; formatEdits?: FormatEdits | null; version: string; onReady: (editor: EditorHandle | null) => void; onEdit: (book?: IWorkbookData) => void }) {
  const container = useRef<HTMLDivElement>(null), edit = useRef(onEdit), ready = useRef(onReady);
  edit.current = onEdit; ready.current = onReady;
  useEffect(() => {
    const notifyEdit = edit.current, notifyReady = ready.current;
    // Existing native snapshots can contain results cached before an external
    // patch. Univer's default WHEN_EMPTY trusts them; rebuild on every reopen.
    const { univer, univerAPI } = createUniver({ plugins: [NativeConditionalPlugin], locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: mergeLocales(UniverSheetsCoreEnUS, UniverSheetsDataValidationEnUS, UniverSheetsConditionalFormattingEnUS) }, presets: [conditionalCorePreset(UniverSheetsCorePreset({ container: container.current!, formula: { initialFormulaComputing: CalculationMode.FORCED } })), UniverSheetsDataValidationPreset(), UniverSheetsConditionalFormattingPreset()] });
    let releaseFocus = () => {};
    try {
    releaseFocus = installEditorFocus(univer, container.current!);
    validateConditionalRules(book);
    const workbook = univerAPI.createWorkbook(structuredClone(book));
    const conditionalStructure = installConditionalStructure(univer.__getInjector(), book.id, () => structuredClone(workbook.save()));
    // Validate actual mutations before the SDK can install/evaluate a rule. No
    // formula rule or opaque plugin payload reaches the conditional engine.
    const conditionalGuard = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, command => {
      if (!['sheet.mutation.add-conditional-rule', 'sheet.mutation.set-conditional-rule'].includes(command.id)) return;
      const p = command.params as { unitId: string; subUnitId: string; cfId?: string; rule: ReturnType<typeof conditionalRules>[string][number] };
      if (p.unitId !== book.id || conditionalStructure.approved(p)) return;
      try {
        const current = workbook.save(), data = conditionalRules(current), rules = data[p.subUnitId] ?? [];
        const cfId = p.cfId || p.rule.cfId;
        const next = command.id === 'sheet.mutation.add-conditional-rule' ? [p.rule, ...rules]
          : rules.map(rule => rule.cfId === cfId ? p.rule : rule);
        // The SDK changes sheet dimensions before updating rules one by one.
        // Other, already validated rules can still have their old coordinates.
        // Validate the incoming rule against the current sheet, and enforce the
        // resource budgets without rechecking those transient old coordinates.
        validateConditionalRules(current, { [p.subUnitId]: [p.rule] });
        let count = 0, ranges = 0, area = 0;
        for (const list of Object.values({ ...data, [p.subUnitId]: next })) {
          if (new Set(list.map(rule => rule.cfId)).size !== list.length) throw new Error('duplicate rule');
          count += list.length;
          for (const rule of list) for (const range of rule.ranges) {
            ranges++; area += (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
          }
        }
        if (count > 256 || ranges > 1000 || area > 100000) throw new Error('conditional rule limit');
      }
      catch {
        univer.__getInjector().get(IMessageService).show({ content: 'Conditional rule was not applied. Use bounded numeric/text highlights, two/three-color scales, data bars or built-in 3/4/5-icon sets. Icon boundaries support numeric or 0–100 percent/percentile values and > or >=. Formula/custom thresholds, external icons and out-of-range quick presets are refused; use the rule editor. Existing sheet edits are kept.' });
        throw new CanceledError();
      }
    });
    // copyRangeStyles reads display interceptors, including every kind of CF.
    // Replace only its inherited insertion payload before native history is built.
    const inheritedStyles = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, command => {
      if (!['sheet.command.insert-row-by-range', 'sheet.command.insert-col-by-range'].includes(command.id)) return;
      const p = command.params as { unitId: string; subUnitId: string; range: { startRow: number; endRow: number; startColumn: number; endColumn: number }; cellValue?: Record<number, Record<number, ICellData>> };
      if (p.unitId !== book.id || !p.cellValue) return;
      const sheet = workbook.getSheetBySheetId(p.subUnitId)?.getSheet();
      if (!sheet) return;
      const rowAxis = command.id.includes('insert-row'), r = p.range;
      const cells: Record<number, Record<number, ICellData>> = {};
      for (let row = r.startRow; row <= r.endRow; row++) for (let col = r.startColumn; col <= r.endColumn; col++) {
        const source = sheet.getCellRaw(rowAxis ? r.startRow - 1 : row, rowAxis ? col : r.startColumn - 1);
        if (source?.s != null) (cells[row] ??= {})[col] = { s: structuredClone(source.s) };
      }
      p.cellValue = cells;
    });
    // The SDK panel submits its local form on Submit. Saving an open form would
    // otherwise acknowledge only the previous rule and lose the typed draft.
    let conditionalPanel: HTMLDivElement | null = null;
    const components = univer.__getInjector().get(ComponentManager);
    const NativeConditionalPanel = components.get(CF_PANEL_KEY) as ComponentType<ConditionalPanelProps>;
    const RuleEditComponent = conditionalRuleEditor(NativeConditionalPanel, univer.__getInjector(), book.id, () => structuredClone(workbook.save()));
    const panelRegistration = components.register(CF_PANEL_KEY, (props: object) => createElement('div', {
      ref: (node: HTMLDivElement | null) => { conditionalPanel = node; },
      onInputCapture: () => { edits++; notifyEdit(); },
    }, createElement(NativeConditionalPanel, { ...props, RuleEditComponent })), { override: true });
    const conditionalEditing = () => {
      const submit = univer.__getInjector().get(LocaleService).t('sheets-conditional-formatting-ui.panel.submit');
      return !!conditionalPanel && [...conditionalPanel.querySelectorAll('button')].some(button => button.textContent?.trim() === submit);
    };
    const conditionalReady = () => {
      if (conditionalEditing())
        throw new Error('Finish the conditional-formatting rule with Submit or Cancel before saving or leaving this sheet. Your open rule is kept.');
    };
    const validation = installValidationSettlement(univer, book.id, () => { edits++; notifyEdit(); });
    // The native dropdown clears rich text/formulas but omits the value type.
    // Specify STRING before the SDK infers numbers/booleans, so its ordinary
    // mutation and undo history retain the exact selected option and cell style.
    const literalSelection = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, command => {
      if (command.id !== SetRangeValuesCommand.id) return;
      const params = command.params as ISetRangeValuesCommandParams | undefined;
      if (params?.unitId !== book.id || !params.subUnitId) return;
      const sheet = workbook.getSheetBySheetId(params.subUnitId);
      if (!sheet) return;
      const optionPayload = (cell: ICellData | null | undefined) => !!cell && typeof cell.v === 'string'
        && cell.t == null && cell.p === null && cell.f === null && cell.si === null;
      const literal = (cell: ICellData | null | undefined, row: number, column: number) => {
        if (!cell || !optionPayload(cell)
          || !Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 0 || column < 0
          || row >= sheet.getMaxRows() || column >= sheet.getMaxColumns()) return cell;
        const rule = sheet.getRange(row, column).getDataValidation()?.rule;
        if (rule?.type !== 'list' || !rule.formula1) return cell;
        let options: unknown;
        try { options = JSON.parse(rule.formula1); } catch { return cell; }
        return Array.isArray(options) && options.includes(cell.v) ? { ...cell, t: CellValueType.STRING } : cell;
      };
      const { value, range } = params;
      if (Array.isArray(value) || isICellData(value)) {
        if (!Array.isArray(value) && !optionPayload(value)) return;
        // Scalar and array payloads are relative to the explicit target range.
        // Expand per cell: a mixed range must not inherit another cell's rule.
        if (!range || ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger)
          || range.startRow < 0 || range.startColumn < 0 || range.endRow >= sheet.getMaxRows() || range.endColumn >= sheet.getMaxColumns()) return;
        const matrix: Record<number, Record<number, ICellData>> = {};
        let changed = false;
        for (let row = range.startRow; row <= range.endRow; row++) {
          matrix[row] = {};
          for (let column = range.startColumn; column <= range.endColumn; column++) {
            const cell = Array.isArray(value) ? value[row - range.startRow][column - range.startColumn] : value;
            const next = literal(cell, row, column);
            changed ||= next !== cell;
            matrix[row][column] = next!;
          }
        }
        if (changed) params.value = matrix;
      } else if (value && typeof value === 'object') {
        // Sparse matrix payloads use absolute coordinates, independent of range.
        const matrix = value as Record<number, Record<number, ICellData>>;
        let changed = false;
        const next = Object.fromEntries(Object.entries(matrix).map(([row, cells]) => [row,
          Object.fromEntries(Object.entries(cells ?? {}).map(([column, cell]) => {
            const nextCell = literal(cell, +row, +column);
            changed ||= nextCell !== cell;
            return [column, nextCell];
          }))]));
        if (changed) params.value = next;
      }
    });
    // An ACK cannot clear a newer edit. Structural mutations relocate ownership;
    // deleted coordinates are retired, and native history restores their provenance.
    // null denotes a recovered legacy draft, whose provenance is unknown.
    const formatted = new Map(Object.entries(formatEdits ?? {}).map(([sid, cells]) => [sid, new Set(cells)]));
    // Saved blank rule removals have no cell/style payload. Keep their human
    // anchors available to structural commands after a cold reopen as well.
    const inherited = new Map<string, Set<number>>();
    for (const key of humanCells ?? []) {
      const [sid, r, c] = key.split(':');
      if (!inherited.has(sid)) inherited.set(sid, new Set());
      inherited.get(sid)!.add(+r * 200 + +c);
    }
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
    const authoredStyle = (sid: string, row: number, column: number) => workbook.getWorkbook().getStyles().getStyleByCell(workbook.getSheetBySheetId(sid)?.getSheet().getCellRaw(row, column));
    const beforeStyles = new WeakMap<object, { sid: string; cells: [number, string][] }>();
    const structuralIds = new Set([InsertRowMutation.id, InsertColMutation.id, RemoveRowMutation.id, RemoveColMutation.id, MoveRowsMutation.id, MoveColsMutation.id]);
    // Attach metadata to the SDK's own structural history entry. A deleted blank
    // rule has no cell payload for the SDK to restore, and restoring cell styles
    // alone would also misclassify derived formats as human intent.
    type Provenance = { unitId: string; subUnitId: string; cells: number[]; inherited: number[] };
    const provenance = (sid: string): Provenance => ({ unitId: book.id, subUnitId: sid,
      cells: [...formatted.get(sid) ?? []], inherited: [...inherited.get(sid) ?? []] });
    const structureCommands = new Set(['sheet.command.insert-row', 'sheet.command.insert-col', 'sheet.command.remove-row', 'sheet.command.remove-col', 'sheet.command.move-rows', 'sheet.command.move-cols']);
    const historyBefore = new WeakMap<object, Provenance>();
    const injector = univer.__getInjector();
    const restoreId = 'sheet.mutation.restore-human-provenance';
    const restoreProvenance = injector.get(ICommandService).registerCommand({ id: restoreId, type: CommandType.MUTATION,
      handler: (_accessor, params) => {
        const saved = params as Provenance | undefined;
        if (!saved || saved.unitId !== book.id || !workbook.getSheetBySheetId(saved.subUnitId)) return false;
        const previous = inherited.get(saved.subUnitId) ?? new Set<number>();
        // Reintroduced anchors must reach Save even if a prior deletion was
        // already saved (and retired an out-of-bounds authoritative anchor).
        formatted.set(saved.subUnitId, new Set([...saved.cells, ...saved.inherited.filter(cell => !previous.has(cell))]));
        inherited.set(saved.subUnitId, new Set(saved.inherited));
        pruneFormatting();
        return true;
      } });
    const interceptors = injector.get(SheetInterceptorService);
    const historyStart = interceptors.interceptCommand({ getMutations: command => {
      const params = command.params as { unitId?: string; subUnitId?: string } | undefined;
      if (structureCommands.has(command.id) && params?.unitId === book.id && params.subUnitId) historyBefore.set(params, provenance(params.subUnitId));
      return { undos: [], redos: [] };
    } });
    const historyEnd = interceptors.interceptAfterCommand({ getMutations: command => {
      const params = command.params, old = params && historyBefore.get(params);
      if (!old) return { undos: [], redos: [] };
      historyBefore.delete(params!);
      return { undos: [{ id: restoreId, params: old }], redos: [{ id: restoreId, params: provenance(old.subUnitId) }] };
    } });
    const beforeStructure = new WeakMap<object, { sid: string; cells: Set<number>; inherited: Set<number> }>();
    const before = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, command => {
      if (!isHumanSheetMutation(command, false)) return;
      const params = command.params as { unitId?: string; subUnitId?: string; cellValue?: Record<string, Record<string, ICellData | null>>; values?: Record<string, { ranges: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] }>; ranges?: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] } | undefined;
      if (!params || params.unitId !== book.id || !params.subUnitId) return;
      const sheet = workbook.getSheetBySheetId(params.subUnitId); if (!sheet) return;
      if (structuralIds.has(command.id)) {
        const mutation = { id: command.id, params: command.params as MutationsAffectRange };
        const moved = new Set<number>(), inheritedMoved = new Set<number>();
        const relocate = (row: number, column: number, owned: boolean) => {
          const next = adjustRangeOnMutation({ startRow: row, endRow: row, startColumn: column, endColumn: column }, mutation);
          if (next && (owned || next.startRow !== row || next.startColumn !== column)
            && next.startRow >= 0 && next.startRow < 10000 && next.startColumn >= 0 && next.startColumn < 200) moved.add(next.startRow * 200 + next.startColumn);
        };
        for (const cell of inherited.get(params.subUnitId) ?? []) {
          const row = Math.floor(cell / 200), column = cell % 200;
          relocate(row, column, false);
          const next = adjustRangeOnMutation({ startRow: row, endRow: row, startColumn: column, endColumn: column }, mutation);
          if (next && next.startRow >= 0 && next.startRow < 10000 && next.startColumn >= 0 && next.startColumn < 200) inheritedMoved.add(next.startRow * 200 + next.startColumn);
        }
        for (const cell of formatted.get(params.subUnitId) ?? []) relocate(Math.floor(cell / 200), cell % 200, true);
        // Also cover styles saved before this editor opened. A human moving a
        // styled cell adopts its destination, even if its style was calculated.
        // Unmoved derived styles and automatic engine mutations remain neutral.
        // Only structural actions scan this sheet's sparse cells; no snapshots
        // or extra work are added to calculation/value-edit paths or payloads.
        sheet.getSheet().getCellMatrix().forValue((row, column, cell) => {
          if (cell?.s != null) relocate(row, column, false);
        });
        beforeStructure.set(params, { sid: params.subUnitId, cells: moved, inherited: inheritedMoved });
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
      const sid = params.subUnitId;
      if (cells.size) beforeStyles.set(params, { sid, cells: [...cells].map(cell => [cell, stable(authoredStyle(sid, Math.floor(cell / 200), cell % 200))]) });
    });
    // Rule mutations carry deliberate human intent, including blank ranges and
    // removal. Reuse the bounded provenance/draft/retry channel for their cells.
    const ruleRanges = () => {
      const raw = workbook.save().resources?.find(r => r.name === 'SHEET_DATA_VALIDATION_PLUGIN')?.data;
      const controls = raw ? JSON.parse(raw) as Record<string, { uid: string; ranges: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] }[]> : {};
      const conditional = conditionalRules(workbook.save());
      return Object.fromEntries([...new Set([...Object.keys(controls), ...Object.keys(conditional)])].map(sid => [sid,
        [...(controls[sid] ?? []).map(r => ({ ...r, uid: `control:${r.uid}` })),
          ...(conditional[sid] ?? []).map((r, priority) => ({ ...r, uid: `conditional:${r.cfId}`, priority }))]]));
    };
    let priorRules = ruleRanges();
    let selectionEpoch = 0;
    const selectionKey = () => JSON.stringify([workbook.getActiveSheet().getSheetId(), workbook.getActiveSheet().getSelection()?.getActiveRangeList().map(r => r.getRange())]);
    let lastSelection = selectionKey();
    const selectionChanged = () => { const key = selectionKey(); if (key !== lastSelection) { lastSelection = key; selectionEpoch++; } };
    const selected = workbook.onSelectionChange(selectionChanged);
    let pending: IWorkbookData | null = null, disposed = false, edits = 0;
    const snapshot = () => {
      conditionalReady(); validation.gate.assertReady();
      const saved = structuredClone(pending ?? workbook.save());
      validateConditionalRules(saved);
      return saved;
    };
    const commit = async () => {
      conditionalReady();
      await validation.gate.wait();
      if (workbook.isCellEditing() && !await workbook.endEditingAsync(true)) throw new Error('Finish the current cell edit before continuing.');
      if (disposed || workbook.isCellEditing()) throw new Error('The editor changed. Retry from the current sheet.');
      conditionalReady();
      validation.gate.assertReady();
      pending = null;
      return snapshot();
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
    notifyReady({ formatEdits: formatting, save: snapshot, isEditing: () => workbook.isCellEditing() || validation.gate.pending || conditionalEditing(), commit, selection, selectionEpoch: () => selectionEpoch, exportCsv: async () => {
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
      edits++; notifyEdit(validation.gate.pending || conditionalEditing() ? undefined : snapshot());
    });
    const ended = univerAPI.addEvent(univerAPI.Event.SheetEditEnded, () => {
      pending = null;
      edits++; notifyEdit(validation.gate.pending ? undefined : structuredClone(workbook.save()));
    });
    const listener = univerAPI.addEvent(univerAPI.Event.CommandExecuted, command => {
      if (command.id === 'sheet.operation.set-worksheet-active' || command.id === 'sheet.operation.set-selections') selectionChanged();
      if (command.id.startsWith('data-validation.mutation.') || /^sheet\.mutation\.(add|set|delete|move)-conditional-rule$/.test(command.id)) {
        const next = ruleRanges();
        for (const sid of new Set([...Object.keys(priorRules), ...Object.keys(next)])) {
          const old = priorRules[sid] ?? [], current = next[sid] ?? [];
          for (const rule of [...old, ...current]) if (stable(old.find(r => r.uid === rule.uid)) !== stable(current.find(r => r.uid === rule.uid))) {
            if (!formatted.has(sid)) formatted.set(sid, new Set());
            for (const r of rule.ranges) for (let row = Math.max(0, r.startRow); row <= Math.min(9999, r.endRow); row++) for (let col = Math.max(0, r.startColumn); col <= Math.min(199, r.endColumn); col++) formatted.get(sid)!.add(row * 200 + col);
          }
        }
        priorRules = next;
      }
      const params = command.params as object | undefined, prior = params && beforeStyles.get(params);
      const structure = params && beforeStructure.get(params);
      if (structure) {
        beforeStructure.delete(params!);
        formatted.set(structure.sid, structure.cells);
        inherited.set(structure.sid, structure.inherited);
        pruneFormatting();
      }
      if (prior) {
        beforeStyles.delete(params!);
        const sheet = workbook.getSheetBySheetId(prior.sid);
        for (const [cell, old] of prior.cells) if (sheet && (command.id === 'sheet.mutation.set.numfmt' || command.id === 'sheet.mutation.remove.numfmt' || old !== stable(authoredStyle(prior.sid, Math.floor(cell / 200), cell % 200)))) {
          if (!formatted.has(prior.sid)) formatted.set(prior.sid, new Set());
          formatted.get(prior.sid)!.add(cell);
        }
      }
      if (isHumanSheetMutation(command, workbook.isCellEditing())) { edits++; notifyEdit(validation.gate.pending ? undefined : structuredClone(workbook.save())); }
    });
    return () => { disposed = true; panelRegistration.dispose(); conditionalGuard.dispose(); conditionalStructure.dispose(); inheritedStyles.dispose(); literalSelection.dispose(); validation.dispose(); releaseFocus(); selected.dispose(); before.dispose(); listener.dispose(); historyStart.dispose(); historyEnd.dispose(); restoreProvenance.dispose(); changing.dispose(); ended.dispose(); notifyReady(null); univer.dispose(); };
    } catch (error) { releaseFocus(); univer.dispose(); throw error; }
  }, [version]);
  return <><p className="exchange-policy">{CONDITIONAL_SCOPE}</p><div className="native-editor" ref={container} aria-label="Editable spreadsheet" /></>;
}
