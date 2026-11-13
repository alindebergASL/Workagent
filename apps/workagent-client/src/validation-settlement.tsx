import { createElement, type ComponentType, type SyntheticEvent } from 'react';
import { CanceledError, ICommandService, type Univer } from '@univerjs/core';
import { ComponentManager, IEditorService, deserializeRangeWithSheet } from '@univerjs/preset-sheets-core';
import { DATA_VALIDATION_PANEL, DataValidationPanelService, LIST_FORMULA_INPUT_NAME, CHECKBOX_FORMULA_INPUT_NAME, SheetDataValidationModel } from '@univerjs/preset-sheets-data-validation';

type Identity = { unitId: string; subUnitId: string; ruleId: string };
type Entry = Identity & { kind: number; expected?: Record<string, unknown>; serial: number };
const inputTicket = Symbol('validation input');
type Ticketed = Record<string, unknown> & { [inputTicket]?: Entry };
const key = (p: Identity, kind: number) => JSON.stringify([p.unitId, p.subUnitId, p.ruleId, kind]);
const stable = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const equal = (a: unknown, b: unknown) => stable(a) === stable(b);
const coordinates = (value: unknown) => Array.isArray(value) ? value.map(r => ({ startRow: r.startRow, endRow: r.endRow, startColumn: r.startColumn, endColumn: r.endColumn })) : value;
const fieldEqual = (field: string, a: unknown, b: unknown) => equal(field === 'ranges' ? coordinates(a) : a, field === 'ranges' ? coordinates(b) : b);
const message = 'Native rule input is still finishing. Keep this page open and retry after finishing the rule.';

/** Pending form state is not workbook data. Only a matching applied SDK mutation
 * can retire it; a timer, Done, command admission, or another rule cannot. */
export class ValidationSettlement {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private serial = 0;
  private retired = new Map<string, number>();
  private disposed = false;
  constructor(private changed: () => void) {}
  get pending() { return this.entries.size > 0; }
  get checkpoint() { return this.serial; }
  mark(identity: Identity, kind: number, expected?: Record<string, unknown>) {
    if (this.disposed) return;
    const entry = { ...identity, kind, expected, serial: ++this.serial };
    this.entries.set(key(identity, kind), entry);
    this.changed();
    return entry;
  }
  obsolete(entry: Entry) { return this.disposed || entry.serial <= (this.retired.get(key(entry, entry.kind)) ?? 0); }
  retire(identity: Identity, kinds: number[], through: number) {
    for (const kind of kinds) {
      const k = key(identity, kind), entry = this.entries.get(k);
      this.retired.set(k, Math.max(through, this.retired.get(k) ?? 0));
      if (entry && entry.serial <= through) this.entries.delete(k);
    }
    for (const wake of this.listeners) wake();
  }
  before(identity: Identity, kind: number) { return this.entries.get(key(identity, kind))?.serial; }
  applied(identity: Identity, kind: number, serial: number | undefined, rule: Record<string, unknown> | undefined, payload: Record<string, unknown>) {
    const k = key(identity, kind), entry = this.entries.get(k);
    if (this.disposed || !entry || entry.serial !== serial || !rule) return;
    // Unknown form input stays pending until its component supplies an expected
    // value. Never infer completion from an unrelated mutation of the same rule.
    if (!entry.expected || !Object.entries(entry.expected).every(([field, value]) => fieldEqual(field, rule[field], value) && fieldEqual(field, payload[field], value))) return;
    this.entries.delete(k);
    for (const wake of this.listeners) wake();
  }
  assertReady() { if (this.disposed || this.pending) throw new Error(message); }
  async wait(timeout = 4000) {
    if (this.disposed) throw new Error(message);
    if (!this.pending) return;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        if (!this.disposed && this.pending) return;
        clearTimeout(timer); this.listeners.delete(finish);
        this.disposed ? reject(new Error(message)) : resolve();
      };
      const timer = setTimeout(() => { this.listeners.delete(finish); reject(new Error(message)); }, timeout);
      this.listeners.add(finish); finish();
    });
  }
  dispose() { this.disposed = true; for (const wake of this.listeners) wake(); this.listeners.clear(); }
}

/** Instance-local, supported ComponentManager overrides retain the SDK's native
 * panel and formula components. No SDK/prototype patch and no focus/blur replay. */
export function installValidationSettlement(univer: Univer, unitId: string, changed: () => void) {
  const gate = new ValidationSettlement(changed), injector = univer.__getInjector();
  const components = injector.get(ComponentManager), panel = injector.get(DataValidationPanelService);
  const model = injector.get(SheetDataValidationModel), commands = injector.get(ICommandService), editors = injector.get(IEditorService);
  const registrations: { dispose(): void }[] = [];
  const identity = () => { const p = panel.activeRule; return p?.unitId === unitId ? { unitId, subUnitId: p.subUnitId, ruleId: p.rule.uid } : null; };
  type FormulaProps = Identity & { value?: Record<string, unknown>; onChange?: (value: Record<string, unknown>) => void };
  for (const name of [LIST_FORMULA_INPUT_NAME, CHECKBOX_FORMULA_INPUT_NAME]) {
    const Native = components.get(name) as ComponentType<FormulaProps>;
    const Formula = (props: FormulaProps) => createElement('div', { 'data-workagent-rule-formula': true,
      onInputCapture: () => gate.mark(props, 0) }, createElement(Native, { ...props, onChange: value => {
        const rule = model.getRuleById(props.unitId, props.subUnitId, props.ruleId);
        // Native list inputs emit an initial effect even without human input.
        const ticket = gate.before(props, 0) !== undefined || Object.entries(value).some(([k, v]) => !equal((rule as unknown as Record<string, unknown> | undefined)?.[k], v)) ? gate.mark(props, 0, value) : undefined;
        // The native panel spreads this value into its debounced setting. Strip
        // the private ticket at command admission, before any SDK model/history.
        props.onChange?.(ticket ? { ...value, [inputTicket]: ticket } : value);
      } }));
    registrations.push(components.register(name, Formula, { override: true }));
  }
  const optionName = 'LIST_RENDER_MODE_OPTION_INPUT';
  const NativeOptions = components.get(optionName) as ComponentType<{ value?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }>;
  const Options = (props: { value?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) => createElement('div', { 'data-workagent-rule-formula': true }, createElement(NativeOptions, { ...props, onChange: value => {
    const id = identity(), ticket = id ? gate.mark(id, 2, value) : undefined;
    props.onChange(ticket ? { ...value, [inputTicket]: ticket } : value);
  } }));
  registrations.push(components.register(optionName, Options, { override: true }));
  const NativePanel = components.get(DATA_VALIDATION_PANEL) as ComponentType;
  const input = (event: SyntheticEvent) => {
    const id = identity(), target = event.target as HTMLElement;
    if (!id || target.closest('[data-workagent-rule-formula]')) return;
    const detail = target.closest('[data-u-comp="data-validation-detail"]');
    if (!detail) return;
    // The pinned native panel's first field is its range editor. Its input can
    // be canvas-backed, so its document model supplies the expected range.
    if (detail.firstElementChild?.contains(target)) return; // Tracked by its native document mutation below.
    else if (target instanceof HTMLInputElement && target.type === 'checkbox' && target.closest('label')?.textContent?.trim() === 'Allow blank values') gate.mark(id, 0, { allowBlank: target.checked });
    else if (target instanceof HTMLInputElement) {
      if (target.type === 'checkbox') gate.mark(id, 2, { showErrorMessage: target.checked });
      else if (target.type === 'radio') gate.mark(id, 2, { errorStyle: Number(target.value) });
      else gate.mark(id, 2, { error: target.value });
    } else gate.mark(id, 2);
  };
  const Panel = () => createElement('div', { onInputCapture: input }, createElement(NativePanel));
  registrations.push(components.register(DATA_VALIDATION_PANEL, Panel, { override: true }));
  const inFlight = new WeakMap<object, number | undefined>();
  const transitions = new WeakMap<object, { id: Identity; type?: string; through: number }[]>();
  const before = commands.beforeCommandExecuted(command => {
    const p = command.params as Identity & { setting?: Ticketed; options?: Ticketed; payload?: { type: number; payload: Record<string, unknown> } };
    if (p?.unitId !== unitId) return;
    const value = p.setting ?? p.options, ticket = value?.[inputTicket];
    if (ticket) {
      if (gate.obsolete(ticket) || key(ticket, ticket.kind) !== key(p, ticket.kind)) throw new CanceledError();
      delete value![inputTicket];
    }
    if (command.id === 'data-validation.mutation.removeRule' || command.id === 'data-validation.mutation.updateRule') {
      transitions.set(p, (Array.isArray(p.ruleId) ? p.ruleId : [p.ruleId]).map(ruleId => {
        const id = { unitId, subUnitId: p.subUnitId, ruleId };
        return { id, type: model.getRuleById(unitId, p.subUnitId, ruleId)?.type, through: gate.checkpoint };
      }));
    }
    if (command.id !== 'data-validation.mutation.updateRule' || !p?.payload || p.unitId !== unitId) return;
    inFlight.set(p, gate.before(p, p.payload.type));
  });
  const after = commands.onCommandExecuted(command => {
    // RangeSelector is a native document editor. Read its public model on the
    // actual document mutation, before the panel's debounced range command.
    if (command.id.startsWith('doc.mutation.')) {
      const id = identity(), editorId = (command.params as { unitId?: string })?.unitId;
      const editor = editorId ? editors.getEditor(editorId) : null;
      const detail = editor && editor.editorDOM.closest('[data-u-comp="data-validation-detail"]');
      if (id && editor && detail?.firstElementChild?.contains(editor.editorDOM)) {
        const text = editor.getDocumentDataModel()?.getPlainText() ?? '';
        const ranges = text.split(',').filter(Boolean).map(deserializeRangeWithSheet);
        const valid = ranges.length && ranges.every(r => !r.unitId && !r.sheetName && Object.values(r.range).every(v => typeof v !== 'number' || Number.isFinite(v)));
        const expected = ranges.map(r => r.range);
        if (gate.before(id, 1) !== undefined || !valid || !fieldEqual('ranges', model.getRuleById(id.unitId, id.subUnitId, id.ruleId)?.ranges, expected)) gate.mark(id, 1, valid ? { ranges: expected } : undefined);
      }
    }
    const p = command.params as Identity & { trigger?: string; payload?: { type: number; payload: Record<string, unknown> } };
    for (const prior of p && transitions.get(p) || []) {
      const rule = model.getRuleById(prior.id.unitId, prior.id.subUnitId, prior.id.ruleId);
      if (prior.type && command.id === 'data-validation.mutation.removeRule' && !rule) gate.retire(prior.id, [0, 1, 2], prior.through);
      else if (rule && p.payload && Object.entries(p.payload.type === 1 ? { ranges: p.payload.payload } : p.payload.payload).every(([field, value]) => fieldEqual(field, (rule as unknown as Record<string, unknown>)[field], value))) {
        if (prior.type && prior.type !== rule.type) gate.retire(prior.id, [0], prior.through);
        else if (p.trigger === 'univer.command.undo' || p.trigger === 'univer.command.redo') gate.retire(prior.id, [p.payload.type], prior.through);
      }
    }
    if (command.id !== 'data-validation.mutation.updateRule' || !p?.payload || p.unitId !== unitId) return;
    gate.applied(p, p.payload.type, inFlight.get(p), model.getRuleById(p.unitId, p.subUnitId, p.ruleId) as unknown as Record<string, unknown>, p.payload.type === 1 ? { ranges: p.payload.payload } : p.payload.payload);
  });
  return { gate, dispose() { gate.dispose(); before.dispose(); after.dispose(); registrations.forEach(r => r.dispose()); } };
}
