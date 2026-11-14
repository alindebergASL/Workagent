import { Plugin, UniverInstanceType, setDependencies, DependentOn, CanceledError, CellValueType, ColorKit, Injector, IUniverInstanceService, type ICommandInfo, type IRange, type IWorkbookData, type Workbook, type Worksheet } from '@univerjs/core';
import { UniverSheetsPlugin, SheetInterceptorService, IMessageService, getSheetCommandTarget } from '@univerjs/preset-sheets-core';
import { UniverSheetsConditionalFormattingPlugin, ConditionalFormattingViewModel, ConditionalFormattingRuleModel, ConditionalFormattingRangeIndexModel, ConditionalFormattingFormulaService, type IConditionFormattingRule } from '@univerjs/preset-sheets-conditional-formatting';
import { conditionalRules, validateConditionalRules, type ConditionalScale } from '../../../packages/workagent-contract/conditional-formatting.mjs';

type Point = { value: number; color: number[]; index: number };
// Convex combinations and normalized distances avoid overflowing b-a across
// opposite signs, while ordinary subtraction retains precision for close values.
const blend = (a: number, b: number, t: number) => t === 0 ? a : t === 1 ? b
  : Math.sign(a) === Math.sign(b) ? a + (b - a) * t : a * (1 - t) + b * t;
const fraction = (v: number, a: number, b: number) => Number.isFinite(b - a)
  ? (v - a) / (b - a) : (v / 2 - a / 2) / (b / 2 - a / 2);
const numeric = (sheet: Worksheet, row: number, col: number) => {
  const cell = sheet.getCellRaw(row, col);
  return cell?.t === CellValueType.NUMBER && typeof cell.v === 'number' && Number.isFinite(cell.v) ? cell.v : undefined;
};
function pointsFor(rule: IConditionFormattingRule, sheet: Worksheet): Point[] {
  const config = (rule.rule as ConditionalScale).config;
  const values = new Map<number, number>();
  if (config.some(p => p.value.type !== 'num')) for (const r of rule.ranges) {
    for (let row = r.startRow; row <= r.endRow; row++) for (let col = r.startColumn; col <= r.endColumn; col++) {
      const value = numeric(sheet, row, col);
      if (value !== undefined) values.set(row * 200 + col, value);
    }
  }
  const sorted = [...values.values()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (!sorted.length && config.some(p => p.value.type !== 'num')) return [];
  const min = sorted[0], max = sorted.at(-1)!;
  return config.map(p => {
    const threshold = p.value;
    let value: number;
    switch (threshold.type) {
      case 'min': value = min; break;
      case 'max': value = max; break;
      case 'num': value = threshold.value; break;
      case 'percent': value = blend(min, max, threshold.value / 100); break;
      case 'percentile': {
        const rank = (sorted.length - 1) * threshold.value / 100, lo = Math.floor(rank), hi = Math.ceil(rank);
        value = blend(sorted[lo], sorted[hi], rank - lo); break;
      }
    }
    const { r, g, b } = new ColorKit(p.color).toRgb();
    return { value, color: [r, g, b], index: p.index };
  }).sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : a.index - b.index)
    // Coincident points use the first authored point. A constant min/max range
    // therefore uses the minimum color; empty/non-numeric cells have no scale.
    .filter((p, i, list) => !i || p.value !== list[i - 1].value);
}
function scaleColor(points: Point[], value: number | undefined) {
  if (value === undefined || !points.length) return undefined;
  let color = points[0].color;
  if (value > points[0].value) {
    const hi = points.findIndex(p => p.value >= value);
    if (hi < 0) color = points.at(-1)!.color;
    else {
      const a = points[hi - 1], b = points[hi], t = fraction(value, a.value, b.value);
      color = a.color.map((c, i) => blend(c, b.color[i], t));
    }
  }
  return `rgb(${color.map(c => Math.round(c)).join(',')})`;
}

// Public DI override, owned/disposed by this Univer instance. Native highlights,
// invalidation, priority/stopIfTrue composition and rendering remain in the SDK.
class ScaleViewModel extends ConditionalFormattingViewModel {
  private points = new Map<IConditionFormattingRule, Point[]>();
  constructor(injector: Injector, private rules: ConditionalFormattingRuleModel, index: ConditionalFormattingRangeIndexModel, formulas: ConditionalFormattingFormulaService, private instances: IUniverInstanceService) {
    // Give native computation a read view excluding scales. This avoids running
    // its faulty scale arithmetic at all; it never changes the authored model.
    const nativeRules = new Proxy(rules, { get(target, key, receiver) {
      if (key === 'getSubunitRules') return (unit: string, sheet: string) => target.getSubunitRules(unit, sheet)?.filter(r => r.rule.type !== 'colorScale') ?? null;
      return Reflect.get(target, key, receiver);
    } });
    super(injector, nativeRules, index, formulas, instances);
    this.disposeWithMe(this.markDirty$.subscribe(() => this.points.clear()));
    this.disposeWithMe(this.cacheClear$.subscribe(() => this.points.clear()));
    this.disposeWithMe(rules.$ruleChange.subscribe(() => this.points.clear()));
  }
  override getCellCfs(unit: string, sid: string, row: number, col: number) {
    const native = super.getCellCfs(unit, sid, row, col) ?? [];
    const sheet = this.instances.getUnit<Workbook>(unit)?.getSheetBySheetId(sid);
    if (!sheet) return native;
    return (this.rules.getSubunitRules(unit, sid) ?? []).filter(r => r.ranges.some(range => row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn))
      .map((rule, priority) => {
        if (rule.rule.type !== 'colorScale') return { ...native.find(r => r.cfId === rule.cfId)!, priority };
        let points = this.points.get(rule);
        if (!points) { points = pointsFor(rule, sheet); this.points.set(rule, points); }
        const result = scaleColor(points, numeric(sheet, row, col));
        return { cfId: rule.cfId, result, matched: !!result, priority };
      });
  }
}

// Inspect the SDK's complete planned affiliated mutations, including split/moved
// ranges, before its command executes any mutation or adds a history entry.
class ConditionalSheetInterceptors extends SheetInterceptorService {
  preflight?: (command: ICommandInfo, result: ReturnType<SheetInterceptorService['onCommandExecute']>) => void;
  readonly approved = new WeakSet<object>();
  override onCommandExecute(command: ICommandInfo) {
    const result = super.onCommandExecute(command);
    this.preflight?.(command, result);
    return result;
  }
}
// Presets expose their plugin/config list; Sheets has a per-plugin DI override.
export function conditionalCorePreset(preset: import('@univerjs/presets').IPreset) {
  return { ...preset, plugins: preset.plugins.map(entry => {
    const [plugin, config] = Array.isArray(entry) ? entry : [entry, {}];
    return plugin === UniverSheetsPlugin ? [plugin, { ...config, override: [[SheetInterceptorService, {
      useFactory: (instances: IUniverInstanceService) => new ConditionalSheetInterceptors(instances), deps: [IUniverInstanceService],
    }]] }] as typeof entry : entry;
  }) };
}
// CF 1.4 has no plugin-config override. Register its public view-model dependency
// during plugin construction, before native onStarting resolves it.
export class NativeConditionalPlugin extends Plugin {
  static override pluginName = 'workagent.native-conditional';
  static override type = UniverInstanceType.UNIVER_SHEET;
  constructor(_config: unknown, protected readonly _injector: Injector) {
    super();
    _injector.replace([ConditionalFormattingViewModel, { useFactory: (i: Injector) => new ScaleViewModel(i, i.get(ConditionalFormattingRuleModel), i.get(ConditionalFormattingRangeIndexModel), i.get(ConditionalFormattingFormulaService), i.get(IUniverInstanceService)), deps: [Injector] }]);
  }
}
setDependencies(NativeConditionalPlugin, [Injector], 1);
DependentOn(UniverSheetsConditionalFormattingPlugin)(NativeConditionalPlugin);

export function installConditionalStructure(injector: Injector, unitId: string, save: () => IWorkbookData) {
  const service = injector.get(SheetInterceptorService) as ConditionalSheetInterceptors;
  service.preflight = (command, mutations) => {
    const changes = [...mutations.preRedos ?? [], ...mutations.redos].filter(m => /^sheet\.mutation\.(add|set|delete)-conditional-rule$/.test(m.id));
    const copying = command.id === 'sheet.command.copy-sheet';
    const structural = /^(sheet\.command\.(insert|remove)-(row|col)|sheet\.command\.insert-range-move-(down|right))$/.test(command.id);
    if (!changes.length && !structural) return;
    const target = getSheetCommandTarget(injector.get(IUniverInstanceService), command.params);
    if (!target || target.unitId !== unitId) return;
    const proposed = save(), data = conditionalRules(proposed), sheet = proposed.sheets[target.subUnitId];
    if (copying) {
      const p = command.params as { targetSubUnitId: string };
      proposed.sheetOrder.push(p.targetSubUnitId);
      proposed.sheets[p.targetSubUnitId] = { ...sheet, id: p.targetSubUnitId };
    }
    let rowCount = target.worksheet.getRowCount(), columnCount = target.worksheet.getColumnCount();
    const range = (command.params as { range?: IRange })?.range;
    if (range) {
      const rows = range.endRow - range.startRow + 1, cols = range.endColumn - range.startColumn + 1;
      if (command.id === 'sheet.command.insert-row') rowCount += rows;
      if (command.id === 'sheet.command.insert-col') columnCount += cols;
      if (command.id === 'sheet.command.remove-row') rowCount -= rows;
      if (command.id === 'sheet.command.remove-col') columnCount -= cols;
      if (command.id.startsWith('sheet.command.insert-range-move-')) {
        const matrix = target.worksheet.getCellMatrix(), bounds = matrix.getDataRange();
        if (command.id.endsWith('down')) rowCount += Math.max(matrix.getSlice(bounds.startRow, bounds.endRow, range.startColumn, range.endColumn).getDataRange().endRow + rows - bounds.endRow, 0);
        else columnCount += Math.max(matrix.getSlice(range.startRow, range.endRow, bounds.startColumn, bounds.endColumn).getDataRange().endColumn + cols - bounds.endColumn, 0);
      }
    }
    for (const change of changes) {
      const p = change.params as { unitId: string; subUnitId: string; cfId?: string; rule: ReturnType<typeof conditionalRules>[string][number] };
      if (p.unitId !== unitId) continue;
      const list = data[p.subUnitId] ?? [];
      if (change.id.includes('delete-')) data[p.subUnitId] = list.filter(r => r.cfId !== p.cfId);
      else if (change.id.includes('add-')) data[p.subUnitId] = [p.rule, ...list];
      else data[p.subUnitId] = list.map(r => r.cfId === p.cfId ? p.rule : r);
    }
    try {
      sheet.rowCount = rowCount; sheet.columnCount = columnCount;
      if (proposed.sheetOrder.length > 20 || rowCount < 1 || rowCount > 10000 || columnCount < 1 || columnCount > 200) throw new Error('sheet bounds');
      validateConditionalRules(proposed, data);
    } catch {
      injector.get(IMessageService).show({ content: 'Sheet change was not applied: it would exceed the sheet or conditional-formatting limits (256 rules, 1,000 ranges, 100,000 covered cells). Reduce the affected ranges first. Your sheet and Undo history are unchanged.' });
      throw new CanceledError();
    }
    for (const change of changes) if (change.params) service.approved.add(change.params);
  };
  return { approved: (params: object) => service.approved.has(params), dispose: () => { service.preflight = undefined; } };
}
