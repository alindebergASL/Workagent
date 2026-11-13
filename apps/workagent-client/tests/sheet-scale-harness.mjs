// Same headless consumer technique as formula-cache/csv-app tests. No DOM,
// native SDK/prototype mutation, browser storage quota or pending keystroke proof.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as drafts from '../src/drafts.ts';
import * as resume from '../src/resume.ts';
import { artifactFixture, FixtureArtifactStorage } from './artifact-storage-fixture.mjs';
import { MaintenanceActions } from '../src/maintenance-actions.ts';
const localRequire = createRequire(import.meta.url);
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const core = require('@univerjs/core'), { FUniver } = require('@univerjs/core/facade');
const { UniverSheetsPlugin } = require('@univerjs/sheets');
const { UniverFormulaEnginePlugin, FormulaExecutedStateType } = require('@univerjs/engine-formula');
const { UniverSheetsFormulaPlugin, CalculationMode } = require('@univerjs/sheets-formula');
require('@univerjs/sheets/facade'); require('@univerjs/engine-formula/facade'); require('@univerjs/sheets-formula/facade');
const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const editorCode = compile('../src/NativeEditor.tsx'), appCode = compile('../src/main.tsx');
export const versions = Object.fromEntries(['core', 'sheets', 'engine-formula', 'sheets-formula'].map(name => [name, JSON.parse(readFileSync(new URL('../../package.json', pathToFileURL(require.resolve(`@univerjs/${name}`))), 'utf8')).version]));
export function mountNative(props) {
  let cleanup, handle, api, univer, edits = 0;
  let starts = [], ends = [];
  const react = { useRef: current => ({ current }), useEffect: fn => { cleanup = fn(); } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', editorCode)(name => {
    if (name === 'react') return react;
    if (name === './drafts') return drafts;
    if (name.endsWith('.css') || name.endsWith('/locales/en-US')) return {};
    if (name === '@univerjs/preset-sheets-core') return { CalculationMode, FormulaExecutedStateType, UniverSheetsCorePreset: options => options };
    if (name === '@univerjs/presets') return { ...core, createUniver: options => {
      univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: {} } });
      univer.registerPlugin(UniverSheetsPlugin); univer.registerPlugin(UniverFormulaEnginePlugin);
      univer.registerPlugin(UniverSheetsFormulaPlugin, options.presets[0].formula);
      api = FUniver.newAPI(univer);
      api.getFormula().calculationStart(force => starts.push(force));
      api.getFormula().calculationEnd(state => ends.push(state));
      // Adapters supply only the absent DOM editor seam. Calculation, commands,
      // snapshots and selection methods remain bound to the installed SDK.
      const adapter = new Proxy(api, { get(target, key) {
        if (key === 'Event') return { ...target.Event, SheetEditChanging: 'headless-changing', SheetEditEnded: 'headless-ended', CommandExecuted: target.Event.CommandExecuted };
        if (key === 'addEvent') return (event, fn) => event.startsWith('headless-') ? { dispose() {} } : target.addEvent(event, fn);
        if (key === 'createWorkbook') return data => new Proxy(target.createWorkbook(data), { get(workbook, property) {
          if (property === 'isCellEditing') return () => false;
          if (property === 'endEditingAsync') return () => { throw new Error('DOM editing is outside this qualification'); };
          const value = workbook[property]; return typeof value === 'function' ? value.bind(workbook) : value;
        } });
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      return { univer, univerAPI: adapter };
    } };
    return localRequire(name);
  }, module, module.exports);
  module.exports.NativeEditor({ ...props, onReady(value) { handle = value; props.onReady?.(value); }, onEdit(book) { edits++; props.onEdit?.(book); } });
  return { api, get handle() { return handle; }, get edits() { return edits; }, resetCalculation() { starts = []; ends = []; },
    async settle() {
      await api.getFormula().onCalculationResultApplied(110_000);
      assert.ok(starts.length > 0, 'SDK watchdog/no-start is not calculation proof');
      assert.equal(ends.at(-1), FormulaExecutedStateType.SUCCESS, 'calculation must complete successfully');
      return { starts, ends, successState: FormulaExecutedStateType.SUCCESS };
    }, dispose: () => cleanup(),
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
  return { flush, native: () => nodes(tree).find(n => n.type === NativeEditor)?.props, text: () => text(tree),
    async open(id) { await flush(); nodes(tree).find(n => n.props['aria-label'] === 'Saved work').props.onChange({ target: { value: id } }); await flush(); },
    async save() { await flush(); const button = nodes(tree).find(n => n.type === 'button' && text(n.props.children) === 'Save sheet'); assert.ok(button); assert.ok(!button.props.disabled); button.props.onClick(); await flush(); },
    unmount() { mounted = false; hooks.forEach(h => h?.cleanup?.()); },
  };
}
