import { CanceledError, CommandType, ICommandService, IResourceManagerService, IUndoRedoService, UniverInstanceType, type IWorkbookData } from '@univerjs/core';
import { FormulaExecutedStateType, IMessageService, ISheetClipboardService, SheetInterceptorService } from '@univerjs/preset-sheets-core';
import type { createUniver } from '@univerjs/presets';
import { CHART_RESOURCE, chartData, sheetCharts, validateCharts, type ChartData, type SheetChart } from '../../../packages/workagent-contract/sheet-charts.mjs';
import { isHumanSheetMutation } from './drafts';
type Runtime = ReturnType<typeof createUniver>;
type Book = ReturnType<Runtime['univerAPI']['createWorkbook']>;
const mutationId = 'sheet.mutation.workagent-charts';
const structureMessage = 'Charts keep fixed source ranges in this first version. Remove the charts before changing tab structure, inserting/deleting/moving rows or columns, moving ranges, sorting, merging, clipboard paste/cut or autofill. Nothing was changed.';
function structural(id: string) {
  return /(?:command|mutation)\.(?:insert-|append-row|remove-(?:row|col|sheet)|delete-range|move-|copy-sheet|copy-worksheet|set-worksheet-(?:name|order|row-count|column-count|hidden|show)|add-worksheet-merge|remove-worksheet-merge|reorder-range|split-text-to-columns|auto-fill|refill|copy-down|copy-right)/.test(id) || /(?:command|operation)\..*(?:paste|cut)$/.test(id) || /(?:command|mutation)\..*sort/.test(id);
}
export function installCharts({ univer, univerAPI: api }: Runtime, initial: IWorkbookData, draftChanged: () => void) {
  validateCharts(initial);
  const injector = univer.__getInjector(), commands = injector.get(ICommandService), history = injector.get(IUndoRedoService);
  let definitions = structuredClone(sheetCharts(initial)), workbook: Book | undefined, disposed = false, generation = 0;
  let draft = false, timer: ReturnType<typeof setTimeout> | undefined, running = false;
  let data: Record<string, ChartData> = {}, status = 'Calculating chart values…';
  const subscribers = new Set<() => void>();
  const emit = () => subscribers.forEach(fn => fn());
  const resource = injector.get(IResourceManagerService).registerPluginResource<SheetChart[]>({
    pluginName: CHART_RESOURCE, businesses: [UniverInstanceType.UNIVER_SHEET],
    toJson: unitId => JSON.stringify(unitId === initial.id ? definitions : []),
    parseJson: raw => JSON.parse(raw),
    onLoad: (unitId, value) => { if (unitId === initial.id) definitions = structuredClone(validateCharts(initial, value)); },
    onUnLoad: () => {},
  });
  const assertActive = () => { if (disposed || !workbook) throw new Error('The chart editor changed. Reopen the current sheet.'); };
  const assertReady = () => { assertActive(); if (draft) throw new Error('Apply or cancel the open chart form before saving or leaving. The chart form is not saved until Apply.'); };
  const invalidate = () => {
    generation++; data = {}; status = 'Calculating chart values…'; emit();
    if (timer) clearTimeout(timer);
    if (!disposed && definitions.length) timer = setTimeout(() => { void refresh(); }, 150);
  };
  const refresh = async () => {
    if (running || disposed || !workbook || !definitions.length) return;
    running = true; const ticket = generation, formula = api.getFormula();
    let forced = false, completed = false;
    const start = formula.calculationStart(force => { forced = force; completed = false; });
    const end = formula.calculationEnd(state => { completed = state === FormulaExecutedStateType.SUCCESS; });
    try {
      if (workbook.isCellEditing()) throw new Error('Finish the cell edit to refresh charts.');
      // Inspect the complete bounded source, including labels and headers, from
      // the live model. A formula-free source needs no engine completion event:
      // Univer's zero-formula session can apply without emitting SUCCESS.
      const sources = definitions.map(chart => {
        const sheet = workbook!.getSheetBySheetId(chart.sheetId)?.getSheet();
        if (!sheet) throw new Error('Chart source sheet is unavailable.');
        return { chart, sheet };
      });
      const needsCalculation = sources.some(({ chart: { range }, sheet }) => {
        for (let row = range.startRow; row <= range.endRow; row++) {
          for (let col = range.startColumn; col <= range.endColumn; col++) {
            const cell = sheet.getCellRaw(row, col);
            if (cell?.f || cell?.si) return true;
          }
        }
        return false;
      });
      if (needsCalculation) {
        formula.executeCalculation();
        await formula.onCalculationResultApplied(10000);
      }
      if (disposed || ticket !== generation) return;
      if (needsCalculation && (!forced || !completed) || workbook.isCellEditing()) throw new Error('Chart calculation is not yet verified. Finish editing, then refresh charts.');
      const next: Record<string, ChartData> = {};
      for (const { chart, sheet } of sources) {
        next[chart.id] = chartData(chart, (row, col) => sheet.getCellRaw(row, col) ?? null);
      }
      data = next; status = 'Live calculated values'; emit();
    } catch (error) { if (!disposed && ticket === generation) { data = {}; status = error instanceof Error ? error.message : 'Chart calculation unavailable'; emit(); } }
    finally {
      start.dispose(); end.dispose(); running = false;
      if (!disposed && ticket !== generation) { if (timer) clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 150); }
    }
  };
  let clipboard: { dispose(): void } | undefined;
  let structureCheck: { dispose(): void } | undefined;
  const mutation = commands.registerCommand({ id: mutationId, type: CommandType.MUTATION, handler: (_accessor, params) => {
    const p = params as { unitId: string; charts: SheetChart[] };
    if (p?.unitId !== initial.id || disposed || !workbook) return false;
    definitions = structuredClone(validateCharts(workbook.save(), p.charts));
    invalidate(); return true;
  } });
  const before = api.addEvent(api.Event.BeforeCommandExecute, command => {
    if (disposed) return;
    const p = command.params as { unitId?: string } | undefined;
    if (p?.unitId && p.unitId !== initial.id) return;
    const undo = command.id === 'univer.command.undo', redo = command.id === 'univer.command.redo';
    if (draft && (undo || redo || structural(command.id))) {
      injector.get(IMessageService).show({ content: 'Apply or cancel the open chart form first.' }); throw new CanceledError();
    }
    if (!definitions.length) return;
    // Check the entire history entry before its first mutation, avoiding a
    // partially applied undo (e.g. cell payload followed by row restoration).
    const entry = undo ? history.pitchTopUndoElement() : redo ? history.pitchTopRedoElement() : null;
    if (structural(command.id) || entry && [...entry.undoMutations, ...entry.redoMutations].some(m => structural(m.id))) {
      injector.get(IMessageService).show({ content: structureMessage }); throw new CanceledError();
    }
  });
  const listener = api.addEvent(api.Event.CommandExecuted, command => {
    if (command.id !== mutationId && isHumanSheetMutation(command, false)) invalidate();
  });
  const apply = (next: SheetChart[]) => {
    assertActive();
    if (workbook!.isCellEditing()) throw new Error('Finish the cell edit before changing charts.');
    validateCharts(workbook!.save(), next);
    const old = structuredClone(definitions), wasDraft = draft;
    draft = false;
    try {
      if (!commands.syncExecuteCommand(mutationId, { unitId: initial.id, charts: next })) throw new Error('Chart change was refused.');
      history.pushUndoRedo({ unitID: initial.id, undoMutations: [{ id: mutationId, params: { unitId: initial.id, charts: old } }], redoMutations: [{ id: mutationId, params: { unitId: initial.id, charts: structuredClone(next) } }] });
    } catch (e) { draft = wasDraft; throw e; }
  };
  return {
    connect(value: Book) {
      workbook = value;
      structureCheck = injector.get(SheetInterceptorService).interceptBeforeCommand({ performCheck: async command => {
        if (!definitions.length || !structural(command.id)) return true;
        injector.get(IMessageService).show({ content: structureMessage }); return false;
      } });
      // Native DOM paste can enter the clipboard service without a top-level
      // command. Refuse before its mixed cell/merge/row mutation bundle starts.
      if (injector.has(ISheetClipboardService)) clipboard = injector.get(ISheetClipboardService).addClipboardHook({
        id: 'workagent-chart-structure', priority: 1000,
        onBeforePaste: target => {
          if (target.unitId !== initial.id || !definitions.length && !draft) return true;
          injector.get(IMessageService).show({ content: structureMessage }); return false;
        },
      });
      invalidate();
    },
    view: () => ({ charts: structuredClone(definitions), data, status }),
    subscribe(fn: () => void) { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
    tabs() { assertActive(); return workbook!.getSheets().map(s => ({ id: s.getSheetId(), name: s.getSheetName() })); },
    selected() {
      assertActive(); const sheet = workbook!.getActiveSheet(), ranges = sheet.getSelection()?.getActiveRangeList() ?? [];
      if (ranges.length !== 1) throw new Error('Select one rectangular chart source, including headers and labels.');
      const { startRow, endRow, startColumn, endColumn } = ranges[0].getRange();
      return { sheetId: sheet.getSheetId(), range: { startRow, endRow, startColumn, endColumn } };
    },
    stage() { assertActive(); draft = true; draftChanged(); },
    cancel() { assertActive(); draft = false; emit(); },
    get editing() { return draft; }, assertReady,
    put(chart: SheetChart) { apply(definitions.some(c => c.id === chart.id) ? definitions.map(c => c.id === chart.id ? chart : c) : [...definitions, chart]); },
    remove(id: string) { assertReady(); apply(definitions.filter(c => c.id !== id)); },
    refresh, invalidate,
    dispose() { disposed = true; generation++; if (timer) clearTimeout(timer); clipboard?.dispose(); structureCheck?.dispose(); before.dispose(); listener.dispose(); mutation.dispose(); resource.dispose(); subscribers.clear(); },
  };
}
export type ChartController = ReturnType<typeof installCharts>;
