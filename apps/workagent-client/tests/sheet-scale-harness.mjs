// Same headless consumer technique as formula-cache/csv-app tests. No DOM,
// native SDK/prototype mutation, browser storage quota or pending keystroke proof.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import * as drafts from '../src/drafts.ts';
import * as resume from '../src/resume.ts';
import { artifactFixture, FixtureArtifactStorage } from './artifact-storage-fixture.mjs';
import { MaintenanceActions } from '../src/maintenance-actions.ts';
// Event-only DOM seam: no canvas, layout, browser or focus assertions.
const localRequire = createRequire(import.meta.url);
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const conditionalRequire = createRequire(import.meta.resolve('@univerjs/preset-sheets-conditional-formatting'));
const conditionalSdk = conditionalRequire('@univerjs/sheets-conditional-formatting');
const conditionalUI = conditionalRequire('@univerjs/sheets-conditional-formatting-ui');
const ui = require('@univerjs/ui');
conditionalRequire('@univerjs/sheets-conditional-formatting/facade');
const core = require('@univerjs/core'), { FUniver } = require('@univerjs/core/facade');
const sheets = require('@univerjs/sheets'), { UniverSheetsPlugin } = sheets;
const { UniverFormulaEnginePlugin, FormulaExecutedStateType } = require('@univerjs/engine-formula');
const { UniverSheetsFormulaPlugin, CalculationMode } = require('@univerjs/sheets-formula');
require('@univerjs/sheets/facade'); require('@univerjs/engine-formula/facade'); require('@univerjs/sheets-formula/facade');
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const conditionalModule = { exports: {} };
new Function('require', 'module', 'exports', compile('../src/native-conditional.ts'))(name => {
  if (name === '@univerjs/preset-sheets-core') return { ...sheets, IMessageService: ui.IMessageService };
  if (name === '@univerjs/preset-sheets-conditional-formatting') return conditionalSdk;
  return localRequire(name);
}, conditionalModule, conditionalModule.exports);
const editorCode = compile('../src/NativeEditor.tsx'), appCode = compile('../src/main.tsx');
export const versions = Object.fromEntries(['core', 'sheets', 'engine-formula', 'sheets-formula'].map(name => [name, JSON.parse(readFileSync(new URL('../../package.json', pathToFileURL(require.resolve(`@univerjs/${name}`))), 'utf8')).version]));
export function mountNative(props, plugins = [], editing) {
  globalThis.window ??= new EventTarget();
  globalThis.document ??= {activeElement:null};
  let cleanup, handle, api, editorApi, univer, edits = 0;
  const events = new Map();
  const messages = [];
  let starts = [], ends = [], validation;
  const validationComponents = new Map();
  const validationRequire = createRequire(import.meta.resolve('@univerjs/preset-sheets-data-validation'));
  validationRequire('@univerjs/sheets-data-validation/facade');
  const validationSdk = { ...validationRequire('@univerjs/data-validation'), ...validationRequire('@univerjs/sheets-data-validation') };
  const IMessageService = ui.IMessageService;
  const ComponentManager = Symbol(), IEditorService = Symbol(), DataValidationPanelService = Symbol();
  const validationModule = { exports: {} };
  new Function('require', 'module', 'exports', compile('../src/validation-settlement.tsx'))(name => {
    if (name === '@univerjs/preset-sheets-core') return { ComponentManager, IEditorService };
    if (name === '@univerjs/preset-sheets-data-validation') return { ...validationSdk, DataValidationPanelService, DATA_VALIDATION_PANEL: 'panel' };
    return localRequire(name);
  }, validationModule, validationModule.exports);
  const react = { createElement: localRequire('react').createElement, useRef: current => ({ current }), useEffect: fn => { cleanup = fn(); } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', editorCode)(name => {
    if (name === './native-conditional') return conditionalModule.exports;
    if (name === './validation-settlement') return { installValidationSettlement: (univer, id, changed) => {
      const injector = univer.__getInjector();
      const manager = { get: key => validationComponents.get(key) ?? (() => null), register(key, component) { validationComponents.set(key, component); return { dispose() { validationComponents.delete(key); } }; } };
      const proxy = { __getInjector: () => ({ get(token) {
        if (token === ComponentManager) return manager;
        if (token === IEditorService) return { getEditor() {} };
        if (token === DataValidationPanelService) return { activeRule: null };
        return injector.get(token);
      } }) };
      validation = validationModule.exports.installValidationSettlement(proxy, id, changed);
      return validation;
    } };
    if (name === './editor-focus') return { installEditorFocus: () => () => {} }; // No DOM in this harness.
    if (name === 'react') return react;
    if (name === './drafts') return drafts;
    if (name.endsWith('.css') || name.endsWith('/locales/en-US')) return {};
    if (name === '@univerjs/preset-sheets-conditional-formatting') return { ...conditionalSdk, CF_PANEL_KEY: conditionalUI.CF_PANEL_KEY, UniverSheetsConditionalFormattingPreset: () => ({}) };
    if (name === '@univerjs/preset-sheets-data-validation') return { UniverSheetsDataValidationPreset: () => ({}) };
    if (name === '@univerjs/preset-sheets-core') return { ...sheets, ComponentManager: ui.ComponentManager, IMessageService, CalculationMode, FormulaExecutedStateType, UniverSheetsCorePreset: options => ({ ...options, plugins: [[UniverSheetsPlugin, {}]] }) };
    if (name === '@univerjs/presets') return { ...core, createUniver: options => {
      univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: {} } });
      for (const dependency of [[ui.IDialogService,{useClass:ui.DesktopDialogService}], [ui.IMessageService,{useValue:{show(message){messages.push(message.content);}}}], [ui.ILayoutService,{useClass:ui.DesktopLayoutService}], [ui.IPlatformService,{useClass:ui.PlatformService}], [ui.IUIPartsService,{useClass:ui.UIPartsService}], [ui.IUIRuntimeScopeService,{useClass:ui.UIRuntimeScopeService}], [ui.IRibbonService,{useClass:ui.DesktopRibbonService}], [ui.IContextMenuService,{useClass:ui.ContextMenuService}], [ui.FormatPainterSessionService], [ui.IShortcutService, {useValue:{registerShortcut(){return {dispose(){}};}}}], [ui.ComponentManager], [ui.IconManager], [ui.IMenuManagerService, {useClass:ui.MenuManagerService}], [ui.ISidebarService, {useClass:ui.DesktopSidebarService}]]) univer.__getInjector().add(dependency);
      univer.registerPlugin(require('@univerjs/engine-render').UniverRenderEnginePlugin);
      univer.registerPlugin(UniverSheetsPlugin, options.presets[0].plugins[0][1]); univer.registerPlugin(UniverFormulaEnginePlugin);
      univer.registerPlugin(UniverSheetsFormulaPlugin, options.presets[0].formula);
      const nativePlugins = new Set([conditionalSdk.UniverSheetsConditionalFormattingPlugin, conditionalUI.UniverSheetsConditionalFormattingUIPlugin, validationSdk.UniverDataValidationPlugin, validationSdk.UniverSheetsDataValidationPlugin, ...plugins]);
      for (const plugin of nativePlugins) univer.registerPlugin(plugin);
      for (const plugin of options.plugins ?? []) univer.registerPlugin(plugin);
      api = FUniver.newAPI(univer);
      api.getFormula().calculationStart(force => starts.push(force));
      api.getFormula().calculationEnd(state => ends.push(state));
      // Adapters supply only the absent DOM editor seam. Calculation, commands,
      // snapshots and selection methods remain bound to the installed SDK.
      const adapter = new Proxy(api, { get(target, key) {
        if (key === 'Event') return { ...target.Event, SheetEditChanging: 'headless-changing', SheetEditEnded: 'headless-ended', BeforeCommandExecute: target.Event.BeforeCommandExecute, CommandExecuted: target.Event.CommandExecuted };
        if (key === 'addEvent') return (event, fn) => {
          if (event.startsWith('headless-')) { events.set(event, fn); return { dispose() { events.delete(event); } }; }
          return target.addEvent(event, fn);
        };
        if (key === 'createWorkbook') return data => new Proxy(target.createWorkbook(data, {skipAutoRender:true}), { get(workbook, property) {
          if (property === 'isCellEditing') return () => editing?.active ?? false;
          if (property === 'endEditingAsync') return async save => {
            if (!editing) throw new Error('DOM editing is outside this qualification');
            assert.equal(save, true);
            if (editing.refuse) return false;
            if (editing.wait) await editing.wait;
            editing.apply?.(workbook);
            editing.active = false;
            return true;
          };
          const value = workbook[property]; return typeof value === 'function' ? value.bind(workbook) : value;
        } });
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      editorApi = adapter;
      return { univer, univerAPI: adapter };
    } };
    return localRequire(name);
  }, module, module.exports);
  module.exports.NativeEditor({ ...props, onReady(value) { handle = value; props.onReady?.(value); }, onEdit(book) { edits++; props.onEdit?.(book); } });
  return { api, editorApi, events, messages, conditional: univer.__getInjector().get(conditionalSdk.ConditionalFormattingService), commands: univer.__getInjector().get(core.ICommandService), get validation() { return validation; },
    formulaInput(props) { return validationComponents.get(validationSdk.LIST_FORMULA_INPUT_NAME)(props).props.children.props; },
    // Exercise the production wrapper's event/ref seam; no native form rendering.
    conditionalPanel() {
      const wrapper = univer.__getInjector().get(ui.ComponentManager).get(conditionalUI.CF_PANEL_KEY)({}).props;
      const submit = univer.__getInjector().get(core.LocaleService).t('sheets-conditional-formatting-ui.panel.submit');
      return { attach: () => wrapper.ref({ querySelectorAll: () => [{ textContent: submit }] }),
        input: () => wrapper.onInputCapture(), close: () => wrapper.ref(null) };
    },
    async conditionalSettled(action) {
      const model = univer.__getInjector().get(conditionalSdk.ConditionalFormattingViewModel);
      let subscription, timer;
      const settled = new Promise((resolve, reject) => { timer = setTimeout(() => { subscription.unsubscribe(); reject(new Error('SDK conditional invalidation missing')); }, 2000); subscription = model.markDirty$.subscribe(() => { clearTimeout(timer); subscription.unsubscribe(); resolve(); }); });
      action(); await settled;
    },
    get handle() { return handle; }, get edits() { return edits; }, resetCalculation() { starts = []; ends = []; },
    async settle() {
      await api.getFormula().onCalculationResultApplied(110_000);
      assert.ok(starts.length > 0, 'SDK watchdog/no-start is not calculation proof');
      assert.equal(ends.at(-1), FormulaExecutedStateType.SUCCESS, 'calculation must complete successfully');
      return { starts, ends, successState: FormulaExecutedStateType.SUCCESS };
    }, dispose: () => cleanup(),
  };
}

// Formula/CSV/XLSX consumers share the production helper, plugin and preset wiring.
// Only pending DOM input delivery is supplied by their existing editing fixture.
export function mountEditor(book, editing = {}) {
  const view = mountNative({ book, version: 'one' }, [], editing);
  return {
    get handle() { return view.handle; }, get edits() { return view.edits; }, events: view.events,
    e: { api: view.editorApi, settle: () => view.api.getFormula().onCalculationResultApplied(4000) },
    // The SDK's initial progress timer can outlive a fast headless calculation.
    async dispose() { await delay(1100); view.dispose(); },
  };
}

export function memoryStorage() {
  const map = new Map();
  const storage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k), usage: () => ({
    utf8Bytes: [...map].reduce((n, [k, v]) => n + Buffer.byteLength(k + v), 0),
    utf16Bytes: [...map].reduce((n, [k, v]) => n + (k.length + v.length) * 2, 0),
    entries: [...map].map(([key, value]) => ({ key, valueCharacters: value.length })),
    quota: 'unbounded asynchronous transaction fixture; real IndexedDB/browser quota NOT tested',
    artifactPayloads: [...artifactFixture(storage).rows].map(([key, slot]) => ({ key, valueCharacters: slot.value?.raw.length ?? 0 })),
  }) };
  return storage;
}
export function mountApp(storage, fetcher) {
  let root, index = 0, effects = [], tree, dirty = true, mounted = true; const hooks = [];
  const NativeEditor = () => null;
  const react = {
    useState(initial) { const i = index++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { if (mounted) { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; dirty = true; } }]; },
    useRef(initial) { const i = index++; hooks[i] ??= { current: initial }; return hooks[i]; },
    useCallback(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => v !== hooks[i].deps[j])) hooks[i] = { deps, fn }; return hooks[i].fn; },
    useEffect(fn, deps) { const i = index++; if (!hooks[i] || deps.some((v, j) => v !== hooks[i].deps[j])) { hooks[i] = { deps, cleanup: hooks[i]?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = fn(); }); } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'localStorage', 'document', 'window', 'fetch', 'crypto', 'setTimeout', 'clearTimeout', appCode)(name => {
    if (name === './editor-focus') return { installEditorFocus: () => () => {} }; // No DOM in this harness.
    if (name === 'react') return react;
    if (name === 'react-dom/client') return { createRoot: () => ({ render: element => { root = element.type; } }) };
    if (name === './NativeEditor') return { NativeEditor };
    if (/^\.\/(PdfExport|DocxExchange|DocumentExchange|DocumentEditor|XlsxExchange|CsvExchange|MaintenancePanel)$/.test(name)) return { [name.slice(2)]: () => null };
    if (name === './drafts') return drafts;
    if (name === './resume') return resume;
    if (name === './artifact-storage') return { ArtifactStorage: FixtureArtifactStorage };
    if (name === './maintenance-actions') return { MaintenanceActions };
    if (name.endsWith('.css')) return {};
    return localRequire(name);
  }, module, module.exports, storage, { getElementById: () => ({}) }, { addEventListener() {}, removeEventListener() {} }, fetcher, { randomUUID }, () => 1, () => {});
  const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n, ...nodes(n.props.children)] : [];
  const text = n => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : String(n ?? '');
  function render() { index = 0; dirty = false; tree = root(); const pending = effects; effects = []; pending.forEach(f => f()); }
  const flush = async () => { for (let i = 0; i < 10; i++) { if (dirty && mounted) render(); await new Promise(setImmediate); } };
  render();
  return { flush, get tree() { return tree; }, native: () => nodes(tree).find(n => n.type === NativeEditor)?.props, text: () => text(tree),
    async open(id) { await flush(); nodes(tree).find(n => n.props['aria-label'] === 'Saved work').props.onChange({ target: { value: id } }); await flush(); },
    async save() { await flush(); const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === 'Save sheet'); assert.ok(button); assert.ok(!button.props.disabled); button.props.onClick(); await flush(); },
    unmount() { mounted = false; hooks.forEach(h => h?.cleanup?.()); },
  };
}
