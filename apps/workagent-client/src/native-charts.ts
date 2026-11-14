import { CanceledError, CommandType, UndoCommand, RedoCommand, type ICommand, type IExecutionOptions, type IUndoRedoItem, ICommandService, IResourceManagerService, IUndoRedoService, UniverInstanceType, isValidRowDimensions, isValidColumnDimensions, type IRange, type IWorkbookData } from '@univerjs/core';
import { FormulaDataModel, InsertRowByRangeCommand, InsertColByRangeCommand, RemoveRowByRangeCommand, RemoveColByRangeCommand, IRenderManagerService, SheetSkeletonManagerService, FormulaExecutedStateType, IAutoFillService, IMessageService, ISheetClipboardService, SheetInterceptorService } from '@univerjs/preset-sheets-core';
import type { createUniver } from '@univerjs/presets';
import { CHART_RESOURCE, chartData, sheetCharts, validateCharts, type ChartData, type SheetChart } from '../../../packages/workagent-contract/sheet-charts.mjs';
import { conditionalRules } from '../../../packages/workagent-contract/conditional-formatting.mjs';
import { isHumanSheetMutation } from './drafts';
import type { ConditionalSheetInterceptors } from './native-conditional';
type Runtime = ReturnType<typeof createUniver>;
type Book = ReturnType<Runtime['univerAPI']['createWorkbook']>;
const mutationId = 'sheet.mutation.workagent-charts';
const structureMessage = 'Chart source change refused. Whole rows/columns may be inserted or deleted within sheet and chart limits, preserving each header row, label column and at least one data row and series. Changes through merged cells, tab structure, moves, sorting, merging and cut are unsupported. Paste/fill touching control or conditional-formatting rules and changing a previous paste/fill mode remain unsupported. Nothing was changed.';
const beginId = 'sheet.mutation.workagent-chart-structure-begin';
const wholeCommand = /^sheet\.command\.(insert|remove)-(row|col)(?:-by-range)?$/;
const wholeMutation = /^sheet\.mutation\.(insert-row|insert-col|remove-rows|remove-col)$/;
const wholeEntry = /^sheet\.command\.(?:insert-(?:row-(?:before|after)|col-(?:before|after)|multi-rows-(?:above|after)|multi-cols-(?:before|right)))$/;
type Structure = { unitId: string; subUnitId: string; range: IRange; insert: boolean; row: boolean };
type StructurePlan = Structure & { before: SheetChart[]; after: SheetChart[]; rows: number; cols: number };
function structural(id: string) {
  return /(?:command|mutation)\.(?:insert-|append-row|remove-(?:row|col|sheet)|delete-range|move-|copy-sheet|copy-worksheet|set-worksheet-(?:name|order|row-count|column-count|hidden|show)|add-worksheet-merge|remove-worksheet-merge|reorder-range|split-text-to-columns|refill)/.test(id) || /(?:command|operation)\..*(?:optional-paste|cut)$/.test(id) || /(?:command|mutation)\..*sort/.test(id);
}
export function installCharts({ univer, univerAPI: api }: Runtime, initial: IWorkbookData, draftChanged: () => void) {
  validateCharts(initial);
  const injector = univer.__getInjector(), commands = injector.get(ICommandService);
  const history = injector.get(IUndoRedoService);
  let definitions = structuredClone(sheetCharts(initial)), workbook: Book | undefined, disposed = false, generation = 0;
  let draft = false, timer: ReturnType<typeof setTimeout> | undefined, running = false;
  let active: StructurePlan | undefined, structureVersion = 0, applied = false, moved = false;
  // SDK adds a top-level trigger during execution; all authored payload fields
  // (including ownership, dimensions, cells and affiliated resources) are sealed.
  const authoredParams = (value: object) => { const { trigger: _trigger, ...rest } = value as Record<string, unknown>; return rest; };
  const payload = (value: object) => JSON.stringify(authoredParams(value));
  const historyPayload = (item: IUndoRedoItem) => JSON.stringify({ ...item,
    undoMutations: item.undoMutations.map(m => ({ ...m, params: m.params && authoredParams(m.params) })),
    redoMutations: item.redoMutations.map(m => ({ ...m, params: m.params && authoredParams(m.params) })),
  });
  const plans = new WeakMap<object, string>(), affiliated = new WeakMap<object, string>();
  const sealedHistory = new WeakMap<object, string>();
  let transaction = false, recoveryFailed = false;
  let captureEditor = () => () => {};
  let historyEffects: (() => void)[] = [];
  const pushHistory = history.pushUndoRedo, popUndo = history.popUndoToRedo, popRedo = history.popRedoToUndo;
  const seal = (item: IUndoRedoItem) => {
    if ([...item.undoMutations, ...item.redoMutations].some(m => m.id === beginId)) sealedHistory.set(item, historyPayload(item));
  };
  const stagedPush: typeof pushHistory = function (item) {
    seal(item);
    if (transaction) historyEffects.push(() => pushHistory.call(history, item));
    else pushHistory.call(history, item);
  };
  const stagedUndo = () => { if (transaction) historyEffects.push(() => popUndo.call(history)); else popUndo.call(history); };
  const stagedRedo = () => { if (transaction) historyEffects.push(() => popRedo.call(history)); else popRedo.call(history); };
  const historyMethod = <K extends 'pushUndoRedo' | 'popUndoToRedo' | 'popRedoToUndo'>(key: K, value: typeof history[K]) => {
    history[key] = value;
    // Redi's lazy proxy caches bound methods on first read. Update that exposed
    // method as well as the service instance, and restore both on disposal.
    Object.defineProperty(history, key, { value, configurable: true, writable: true });
  };
  historyMethod('pushUndoRedo', stagedPush); historyMethod('popUndoToRedo', stagedUndo); historyMethod('popRedoToUndo', stagedRedo);
  const boundaries: { dispose(): void }[] = [];
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
  const assertReady = () => { assertActive(); if (active || transaction || recoveryFailed) throw new Error('Finish the current sheet structure change before saving.'); if (draft) throw new Error('Apply or cancel the open chart form before saving or leaving. The chart form is not saved until Apply.'); };
  const invalidate = () => {
    generation++; data = {}; status = 'Calculating chart values…';
    if (timer) clearTimeout(timer);
    if (active) return;
    emit();
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
  let clipboard: { dispose(): void } | undefined, fill: { dispose(): void } | undefined;
  let restoreRepaste = () => {};
  const guarded = () => !disposed && (!!definitions.length || draft);
  const refuse = (): never => {
    injector.get(IMessageService).show({ content: draft ? 'Apply or cancel the open chart form first.' : structureMessage });
    throw new CanceledError();
  };
  type Discrete = { rows: number[]; cols: number[] };
  const overlaps = (a: IRange, b: IRange) => a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn;
  // SDK ranges are inclusive, and insertion starts at range.start*, including
  // the facade's insert-after command (which has already added one).
  const project = (change: Structure, restore?: SheetChart[]) => {
    const book = structuredClone(workbook!.save()), sheet = book.sheets[change.subUnitId], r = change.range;
    if (!sheet || !Object.hasOwn(book.sheets, change.subUnitId) || !book.sheetOrder.includes(change.subUnitId)
      || change.unitId !== initial.id || !r || ![r.startRow, r.endRow, r.startColumn, r.endColumn].every(Number.isSafeInteger)) refuse();
    const { row, insert } = change, start = row ? r.startRow : r.startColumn, end = row ? r.endRow : r.endColumn;
    const size = (row ? sheet.rowCount : sheet.columnCount)!, count = end - start + 1;
    if (start < 0 || count < 1 || start > size || (!insert && end >= size)
      || (row ? r.startColumn !== 0 || r.endColumn !== sheet.columnCount! - 1 : r.startRow !== 0 || r.endRow !== sheet.rowCount! - 1)) refuse();
    const nextSize = size + (insert ? count : -count);
    if (nextSize < 1 || nextSize > (row ? 10000 : 200)) refuse();
    const lo = row ? 'startRow' : 'startColumn', hi = row ? 'endRow' : 'endColumn';
    sheet.mergeData = (sheet.mergeData ?? []).map(m => {
      // Crossing a merge is deliberately outside this bounded whole-axis path.
      if (insert ? start > m[lo] && start <= m[hi] : start <= m[hi] && end >= m[lo]) refuse();
      const shift = (insert ? start <= m[lo] : end < m[lo]) ? (insert ? count : -count) : 0;
      return { ...m, [lo]: m[lo] + shift, [hi]: m[hi] + shift };
    });
    if (row) sheet.rowCount = nextSize; else sheet.columnCount = nextSize;
    const next = restore ?? definitions.map(c => {
      if (c.sheetId !== change.subUnitId) return c;
      const a = c.range[lo], b = c.range[hi];
      if (!insert && start <= a && end >= a) refuse(); // Never reinterpret headings.
      const before = insert ? start <= a ? count : 0 : end < a ? -count : 0;
      const inside = insert ? start > a && start <= b ? count : 0 : start > a ? -Math.max(0, Math.min(end, b) - start + 1) : 0;
      return { ...c, range: { ...c.range, [lo]: a + before, [hi]: b + before + inside } };
    });
    try { return structuredClone(validateCharts(book, next)); } catch { return refuse(); }
  };
  const verify = (p: StructurePlan) => {
    const sheet = workbook!.getSheetBySheetId(p.subUnitId);
    if (plans.get(p) !== payload(p) || active || !sheet || sheet.getMaxRows() !== p.rows || sheet.getMaxColumns() !== p.cols
      || JSON.stringify(definitions) !== JSON.stringify(p.before)) refuse();
    project(p, p.after);
  };
  const matches = (id: string, q: Structure, plan: StructurePlan) => id === `sheet.mutation.${plan.insert ? 'insert-' : 'remove-'}${plan.row ? plan.insert ? 'row' : 'rows' : 'col'}`
    && q?.unitId === plan.unitId && q.subUnitId === plan.subUnitId
    && ['startRow', 'endRow', 'startColumn', 'endColumn'].every(k => q.range?.[k as keyof IRange] === plan.range[k as keyof IRange]);
  const begin = commands.registerCommand({ id: beginId, type: CommandType.MUTATION, handler: (_accessor, params) => {
    const p = params as StructurePlan; if (!transaction) refuse(); verify(p);
    active = p; moved = false; applied = false; invalidate(); return true;
  } });
  let structureHistory: { dispose(): void } | undefined;
  let structurePreflight: ConditionalSheetInterceptors['chartPreflight'];
  const checkRange = (sid: string, range: Discrete) => {
    const sheet = workbook?.getSheetBySheetId(sid)?.getSheet();
    const axis = (values: number[], size: number) => Array.isArray(values) && values.length > 0 && values.every((v, i) => Number.isSafeInteger(v) && v >= 0 && v < size && (!i || v > values[i - 1]));
    if (!sheet || !range || !axis(range.rows, sheet.getRowCount()) || !axis(range.cols, sheet.getColumnCount())) refuse();
    const rect = { startRow: range.rows[0], endRow: range.rows.at(-1)!, startColumn: range.cols[0], endColumn: range.cols.at(-1)! };
    // SDK merge clearing uses the enclosing rectangle, even with filtered rows.
    if (sheet!.getMergeData().some(m => overlaps(m, rect))) refuse();
    return rect;
  };
  const hasResources = (sid: string, rect: IRange) => {
    const saved = workbook!.save();
    // These SDK hooks can split/copy resource rules after writing cells. There
    // is no aggregate clipboard/fill mutation preflight in 1.4. Keep that exact
    // resource-changing path refused until its complete plan can be validated.
    const controls = JSON.parse(saved.resources?.find(r => r.name === 'SHEET_DATA_VALIDATION_PLUGIN')?.data || '{}') as Record<string, { ranges: IRange[] }[]>;
    const rules = [...conditionalRules(saved)[sid] ?? [], ...controls[sid] ?? []];
    return rules.some(rule => rule.ranges.some(r => overlaps(r, rect)));
  };
  const checkResources = (sid: string, range: Discrete) => { if (hasResources(sid, checkRange(sid, range))) refuse(); };
  let structureCheck: { dispose(): void } | undefined;
  const mutation = commands.registerCommand({ id: mutationId, type: CommandType.MUTATION, handler: (_accessor, params) => {
    const p = params as { unitId: string; charts: SheetChart[] };
    if (p?.unitId !== initial.id || disposed || !workbook) return false;
    definitions = structuredClone(validateCharts(workbook.save(), p.charts));
    if (active) applied = true;
    invalidate(); return true;
  } });
  // Facade BeforeCommandExecute/CommandExecuted explicitly exclude Undo/Redo.
  // Subscribe to the instance command service so history is preflighted too.
  const before = commands.beforeCommandExecuted((info, options) => {
    const command = { ...info, options };
    if (disposed) return;
    const p = command.params as { unitId?: string; subUnitId?: string; sourceRange?: IRange; targetRange?: IRange; clearRange?: IRange; selectionRange?: IRange } | undefined;
    const undo = command.id === 'univer.command.undo', redo = command.id === 'univer.command.redo';
    if (!undo && !redo && p?.unitId && p.unitId !== initial.id) return;
    const entry = undo ? history.pitchTopUndoElement() : redo ? history.pitchTopRedoElement() : null;
    if (draft && (undo || redo || structural(command.id) || isHumanSheetMutation(command, false))) {
      injector.get(IMessageService).show({ content: 'Apply or cancel the open chart form first.' }); throw new CanceledError();
    }
    if (!definitions.length && (!entry || !sealedHistory.has(entry))) return;
    if (wholeCommand.test(command.id)) {
      if (command.id.endsWith('-by-range')) {
        if (active) refuse();
        const q = command.params as Structure;
        project({ ...q, insert: command.id.includes('.insert-'), row: command.id.includes('-row-') });
      }
      return;
    }
    // Native menu confirmation wrappers only delegate to the protected remove
    // commands (or show the SDK's all-rows/columns guard without mutating).
    if (wholeEntry.test(command.id) || command.id === 'sheet.command.remove-row-confirm' || command.id === 'sheet.command.remove-col-confirm') return;
    if (wholeMutation.test(command.id)) {
      const q = command.params as Structure;
      if (!active || moved || !matches(command.id, q, active)) refuse();
      moved = true; return;
    }
    if (command.id === 'sheet.command.auto-fill' || command.id === 'sheet.command.auto-clear-content') {
      const sid = p?.subUnitId ?? workbook?.getActiveSheet().getSheetId();
      const sheet = sid && workbook?.getSheetBySheetId(sid);
      for (const r of command.id.endsWith('auto-fill') ? [p?.sourceRange, p?.targetRange] : [p?.clearRange, p?.selectionRange]) {
        if (!sheet || !r || ![r.startRow, r.endRow, r.startColumn, r.endColumn].every(Number.isSafeInteger)
          || r.startRow < 0 || r.startColumn < 0 || r.endRow < r.startRow || r.endColumn < r.startColumn
          || r.endRow >= sheet.getMaxRows() || r.endColumn >= sheet.getMaxColumns()
          || sheet.getSheet().getMergeData().some(m => overlaps(m, r))) refuse();
      }
    }
    // Check the entire history entry before its first mutation, avoiding a
    // partially applied undo (e.g. cell payload followed by row restoration).
    if (entry && (sealedHistory.has(entry) || [...entry.undoMutations, ...entry.redoMutations].some(m => structural(m.id) || m.id === beginId))) {
      if (entry.unitID !== initial.id || sealedHistory.get(entry) !== historyPayload(entry)) refuse();
      const mutations = undo ? entry.undoMutations : entry.redoMutations;
      const starts = mutations.filter(m => m.id === beginId);
      if (starts.length !== 1 || mutations[0] !== starts[0]) refuse();
      const plan = starts[0].params as StructurePlan;
      verify(plan);
      const axes = mutations.filter(m => wholeMutation.test(m.id));
      const charts = mutations.filter(m => m.id === mutationId);
      if (axes.length !== 1 || !matches(axes[0].id, axes[0].params as Structure, plan)
        || charts.length !== 1 || (charts[0].params as { unitId?: string })?.unitId !== initial.id || JSON.stringify((charts[0].params as { charts: SheetChart[] }).charts) !== JSON.stringify(plan.after)
        || mutations.some(m => structural(m.id) && !wholeMutation.test(m.id) && (!m.params || affiliated.get(m.params) !== payload(m.params)))) refuse();
      const dimensions = axes[0].params as { rowInfo?: Record<number, Parameters<typeof isValidRowDimensions>[0]>; colInfo?: Record<number, Parameters<typeof isValidColumnDimensions>[0]> };
      if (dimensions.rowInfo && !Object.values(dimensions.rowInfo).every(isValidRowDimensions)
        || dimensions.colInfo && !Object.values(dimensions.colInfo).every(isValidColumnDimensions)) refuse();
      return;
    }
    if (structural(command.id) && !(active && p && affiliated.get(p) === payload(p))) {
      injector.get(IMessageService).show({ content: structureMessage }); throw new CanceledError();
    }
  });
  const listener = commands.onCommandExecuted((info, options) => {
    const command = { ...info, options };
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
      if (disposed || workbook) throw new Error('The chart controller is already connected or disposed.');
      workbook = value;
      const restoreBook = (saved: IWorkbookData) => {
        const replace = (target: object, source: object) => {
          for (const key of Object.keys(target)) delete (target as Record<string, unknown>)[key];
          Object.assign(target, structuredClone(source));
        };
        for (const [sid, snapshot] of Object.entries(saved.sheets)) {
          const sheet = workbook!.getSheetBySheetId(sid)!.getSheet();
          // Restore the live model's existing matrix/managers, preserving facade,
          // reference-service and renderer identities. Workbook.load only replaces
          // serialized state and cannot recover an already running worksheet.
          replace(sheet.getCellMatrix().getMatrix(), snapshot.cellData ?? {});
          replace(sheet.getRowManager().getRowData(), snapshot.rowData ?? {});
          replace(sheet.getColumnManager().getColumnData(), snapshot.columnData ?? {});
          const cellData = sheet.getCellMatrix().getMatrix(), rowData = sheet.getRowManager().getRowData(), columnData = sheet.getColumnManager().getColumnData();
          replace(sheet.getSnapshot(), snapshot);
          Object.assign(sheet.getSnapshot(), { cellData, rowData, columnData });
          sheet.setMergeData(structuredClone(snapshot.mergeData ?? []));
        }
        const styles = workbook!.getWorkbook().getStyles();
        for (const id of Object.keys(styles.toJSON())) if (!Object.hasOwn(saved.styles, id)) styles.remove(id);
        for (const [id, style] of Object.entries(saved.styles)) styles.addCustomStyle(id, structuredClone(style));
        definitions = structuredClone(sheetCharts(saved));
        // Resource hooks rebuild their actual rule models and indexes. Call them
        // directly so recovery errors cannot be swallowed by loadResources().
        for (const hook of injector.get(IResourceManagerService).getAllResourceHooks()) {
          if (hook.pluginName === CHART_RESOURCE || !hook.businesses.includes(UniverInstanceType.UNIVER_SHEET)) continue;
          const previous = saved.resources?.find(r => r.name === hook.pluginName)?.data;
          if (previous !== undefined && hook.toJson(initial.id) !== previous) {
            const parsed = hook.parseJson(previous);
            hook.onUnLoad(initial.id); hook.onLoad(initial.id, parsed);
          }
        }
        const formulas = injector.get(FormulaDataModel);
        formulas.clearFormulaIdMap(initial.id);
        formulas.getFormulaData(); // Rebind shared formula IDs to restored live cells.
        const render = injector.get(IRenderManagerService).getRenderUnitById(initial.id);
        if (render) {
          const skeletons = render.with(SheetSkeletonManagerService);
          for (const sheetId of saved.sheetOrder) skeletons.makeDirty({ sheetId });
          skeletons.reCalculate(); render.mainComponent?.makeDirty();
        }
      };
      for (const original of [InsertRowByRangeCommand, InsertColByRangeCommand, RemoveRowByRangeCommand, RemoveColByRangeCommand, UndoCommand, RedoCommand] as ICommand[]) {
        commands.unregisterCommand(original.id);
        const registration = commands.registerCommand({ id: original.id, type: original.type, handler: (accessor, params, options) => {
          const item = original.id === UndoCommand.id ? history.pitchTopUndoElement() : original.id === RedoCommand.id ? history.pitchTopRedoElement() : null;
          const relevant = item ? [...item.undoMutations, ...item.redoMutations].some(m => m.id === beginId)
            : wholeCommand.test(original.id) && definitions.length && (params as { unitId?: string })?.unitId === initial.id;
          if (!relevant) return original.handler(accessor, params, options);
          if (transaction || recoveryFailed) refuse();
          const saved = structuredClone(workbook!.save()), restoreEditor = captureEditor();
          const formulas = injector.get(FormulaDataModel);
          const arrays = structuredClone(formulas.getArrayFormulaRange()[initial.id]);
          const arrayCells = structuredClone(formulas.getArrayFormulaCellData()[initial.id]);
          transaction = true; historyEffects = [];
          // SDK sequenceExecute catches a step exception and returns false.
          // Keep that original error across the enclosing synchronous handler.
          // This instance-only recorder exists for this transaction's lifetime;
          // every step still traverses all native authorization/listener gates.
          const execute = commands.syncExecuteCommand;
          let stepError: unknown, stepFailed = false;
          const recordFailure = function<P extends object = object, R = boolean>(id: string, p?: P, opts?: IExecutionOptions): R {
            try {
              const result = execute.call(commands, id, p, opts) as R;
              if (result === false && id.includes('.mutation.')) stepFailed = true;
              return result;
            }
            catch (error) { stepError ??= error; throw error; }
          };
          commands.syncExecuteCommand = recordFailure;
          const rollback = () => {
            restoreBook(saved);
            const ranges = formulas.getArrayFormulaRange(), cells = formulas.getArrayFormulaCellData();
            if (arrays === undefined) delete ranges[initial.id]; else ranges[initial.id] = arrays;
            if (arrayCells === undefined) delete cells[initial.id]; else cells[initial.id] = arrayCells;
            restoreEditor();
          };
          let success = false, failure: unknown;
          try {
            try {
              const result = original.handler(accessor, params, options);
              if (result instanceof Promise) throw new Error('Structural transaction requires a synchronous SDK handler.');
              if (stepError) throw stepError;
              success = result === true && !stepFailed && !!active && moved && applied;
            } catch (error) { failure = error; }
            if (!success) {
              try { rollback(); } catch (recovery) {
                recoveryFailed = true;
                throw new AggregateError([failure ?? new Error('Sheet structure was refused.'), recovery], 'Sheet structure failed and recovery is incomplete. Reopen the saved sheet.');
              }
              if (failure) throw failure;
              return false;
            }
            for (const publish of historyEffects) publish();
            structureVersion++;
            return true;
          } finally {
            if (commands.syncExecuteCommand === recordFailure) commands.syncExecuteCommand = execute;
            active = undefined; transaction = false; historyEffects = []; invalidate();
          }
        } });
        boundaries.push({ dispose() { registration.dispose(); commands.registerCommand(original); } });
      }
      const service = injector.get(SheetInterceptorService) as ConditionalSheetInterceptors;
      structureHistory = service.interceptCommand({ priority: -10000, getMutations: command => {
        if (!definitions.length || !/^sheet\.command\.(insert|remove)-(row|col)$/.test(command.id)) return { redos: [], undos: [] };
        if (draft || active) refuse();
        const p = command.params as { unitId: string; subUnitId: string; range: IRange };
        if (p?.unitId !== initial.id) return { redos: [], undos: [] };
        const change: Structure = { unitId: p.unitId, subUnitId: p.subUnitId, range: { ...p.range }, insert: command.id.includes('.insert-'), row: command.id.endsWith('-row') };
        const after = project(change), sheet = workbook!.getSheetBySheetId(p.subUnitId)!;
        const plan: StructurePlan = { ...change, before: structuredClone(definitions), after, rows: sheet.getMaxRows(), cols: sheet.getMaxColumns() };
        const count = change.row ? p.range.endRow - p.range.startRow + 1 : p.range.endColumn - p.range.startColumn + 1;
        const reverse: StructurePlan = { ...plan, insert: !plan.insert, before: after, after: plan.before,
          rows: plan.rows + (change.row ? (change.insert ? count : -count) : 0), cols: plan.cols + (!change.row ? (change.insert ? count : -count) : 0) };
        plans.set(plan, payload(plan)); plans.set(reverse, payload(reverse));
        return { preRedos: [{ id: beginId, params: plan }], preUndos: [{ id: beginId, params: reverse }],
          redos: [{ id: mutationId, params: { unitId: initial.id, charts: after } }], undos: [{ id: mutationId, params: { unitId: initial.id, charts: plan.before } }] };
      } });
      structurePreflight = service.chartPreflight = (_command, result) => {
        if (![...result.preRedos ?? []].some(m => m.id === beginId)) return;
        for (const m of [...result.preRedos ?? [], ...result.redos, ...result.preUndos ?? [], ...result.undos]) {
          const owner = m.params as { unitId?: string; unitID?: string } | undefined;
          if (owner?.unitId !== undefined && owner.unitId !== initial.id || owner?.unitID !== undefined && owner.unitID !== initial.id) refuse();
        }
        for (const list of [result.preRedos, result.preUndos]) if (list) {
          const index = list.findIndex(m => m.id === beginId);
          if (index > 0) list.unshift(...list.splice(index, 1));
        }
        // Native merge-reference mutations belong to this exact validated plan;
        // direct merge commands and unpaired history remain fenced.
        for (const m of [...result.preRedos ?? [], ...result.redos, ...result.preUndos ?? [], ...result.undos]) {
          if (/^sheet\.mutation\.(add|remove)-worksheet-merge$/.test(m.id) && m.params) affiliated.set(m.params, payload(m.params));
        }
      };
      structureCheck = injector.get(SheetInterceptorService).interceptBeforeCommand({ performCheck: async command => {
        if (wholeCommand.test(command.id)) return true;
        if (!definitions.length || !structural(command.id)) return true;
        injector.get(IMessageService).show({ content: structureMessage }); return false;
      } });
      // Both DOM/keyboard paste and facade paste reach these SDK hooks. The
      // effective discrete range is resolved by Univer, never by a TSV parser.
      if (injector.has(ISheetClipboardService)) {
        const service = injector.get(ISheetClipboardService);
        let copiedResources = false;
        clipboard = service.addClipboardHook({
          id: 'workagent-chart-structure', priority: -10000,
          onBeforeCopyFocusedObject: () => false,
          onBeforeCopy: (unit, sid, range, kind) => {
            if (unit === initial.id && guarded() && kind === 'CUT') refuse();
            // SDK resource hooks retain their own last-copy state even if the
            // source rule is removed before paste or charts are added later.
            copiedResources = unit !== initial.id || hasResources(sid, range);
          },
          onBeforePaste: target => {
            if (target.unitId !== initial.id || !guarded()) return true;
            if (draft) { injector.get(IMessageService).show({ content: 'Apply or cancel the open chart form first.' }); return false; }
            try { checkRange(target.subUnitId, target.range); return true; } catch { return false; }
          },
          onPasteCells: (source, target, matrix, payload) => {
            if (target.unitId !== initial.id || !guarded()) return { redos: [], undos: [] };
            if (draft || payload.copyType !== 'COPY' || payload.copyId && service.copyContentCache().get(payload.copyId)?.skipCellCopy) refuse();
            checkRange(target.subUnitId, target.range);
            matrix.forValue((_r, _c, cell) => { if (cell && ((cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1)) refuse(); });
            if (source?.unitId) {
              if (source.unitId !== initial.id || copiedResources) refuse();
              checkResources(source.subUnitId!, source.range);
              checkResources(target.subUnitId, target.range);
            }
            return { redos: [], undos: [] };
          },
          onPasteFiles: target => { if (target.unitId === initial.id && guarded()) refuse(); return { redos: [], undos: [] }; },
          onPasteUnrecognized: target => { if (target.unitId === initial.id && guarded()) refuse(); return { redos: [], undos: [] }; },
        });
        // 1.4 rePasteWithPasteType undoes the previous entry before calling
        // any hook. Its public service entry also needs an early refusal.
        const original = service.rePasteWithPasteType;
        const guardedRepaste: typeof original = function (...args) { if (guarded()) refuse(); return original.apply(service, args); };
        service.rePasteWithPasteType = guardedRepaste;
        restoreRepaste = () => { if (service.rePasteWithPasteType === guardedRepaste) service.rePasteWithPasteType = original; };
      }
      let freshFill = false;
      fill = injector.get(IAutoFillService).addHook({
        id: 'workagent-chart-cells',
        onBeforeFillData: location => {
          freshFill = false;
          if (location.unitId === initial.id && guarded()) {
            if (draft) refuse();
            checkResources(location.subUnitId, location.source); checkResources(location.subUnitId, location.target);
          }
          freshFill = true;
        },
        // Runs before fillData applies _prevUndos, including direct service use.
        onPrepareFillData: location => {
          if (location.unitId === initial.id && guarded()) {
            if (!freshFill || draft) refuse();
            checkResources(location.subUnitId, location.source); checkResources(location.subUnitId, location.target);
          }
          freshFill = false;
          return () => ({ redos: [], undos: [] });
        },
      });
      invalidate();
    },
    captureStructureEditor(fn: () => () => void) { captureEditor = fn; },
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
    get structurePending() { return !!active || transaction || recoveryFailed; }, get structureVersion() { return structureVersion; },
    put(chart: SheetChart) { apply(definitions.some(c => c.id === chart.id) ? definitions.map(c => c.id === chart.id ? chart : c) : [...definitions, chart]); },
    remove(id: string) { assertReady(); apply(definitions.filter(c => c.id !== id)); },
    refresh, invalidate,
    dispose() { if (disposed) return; disposed = true; generation++; active = undefined; if (timer) clearTimeout(timer); clipboard?.dispose(); fill?.dispose(); restoreRepaste(); boundaries.forEach(b => b.dispose());
      if (history.pushUndoRedo === stagedPush) historyMethod('pushUndoRedo', pushHistory);
      if (history.popUndoToRedo === stagedUndo) historyMethod('popUndoToRedo', popUndo);
      if (history.popRedoToUndo === stagedRedo) historyMethod('popRedoToUndo', popRedo);
      structureCheck?.dispose(); structureHistory?.dispose(); const service = injector.get(SheetInterceptorService) as ConditionalSheetInterceptors; if (service.chartPreflight === structurePreflight) service.chartPreflight = undefined; begin.dispose(); before.dispose(); listener.dispose(); mutation.dispose(); resource.dispose(); subscribers.clear(); },
  };
}
export type ChartController = ReturnType<typeof installCharts>;
