// Real installed Univer calculation + actual NativeEditor TSX lifecycle. No DOM,
// browser, database, service or provider is used by this regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import { blankWorkbook, applyPatch, withoutFormulaResults } from '../../../packages/workagent-contract/index.mjs';
import { isHumanSheetMutation, pendingCell } from '../src/drafts.ts';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { Maintenance } from '../../workagent-server/src/responsibilities.mjs';
import { OwnedFiles } from '../../workagent-server/src/owned-files.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const localRequire = createRequire(import.meta.url);
const core = require('@univerjs/core');
const { FUniver } = require('@univerjs/core/facade');
const { UniverSheetsPlugin } = require('@univerjs/sheets');
const { UniverFormulaEnginePlugin } = require('@univerjs/engine-formula');
const { UniverSheetsFormulaPlugin, CalculationMode } = require('@univerjs/sheets-formula');
require('@univerjs/sheets/facade'); require('@univerjs/engine-formula/facade'); require('@univerjs/sheets-formula/facade');
function engine(formula = {}) {
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: {} } });
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin, formula);
  const api = FUniver.newAPI(univer);
  return { univer, api, settle: () => api.getFormula().onCalculationResultApplied(4000),
    // The SDK's initial progress timer can outlive a fast headless calculation.
    async dispose() { await delay(1100); univer.dispose(); } };
}
const cell = (book, row, col = 1) => book.sheets.sheet1.cellData[row][col];
function fixture() {
  const book = blankWorkbook('cache-regression');
  book.styles = { human: { bg: { rgb: '#f0cafe' }, n: { pattern: '0.00' } } };
  book.sheets.sheet1.cellData = {
    0: { 2: { v: '=1+1', t: 1 }, 3: { f: '=1/0' }, 4: { f: '=B2>200' }, 5: { f: '=IF(B2>200,"high","low")' } },
    1: { 1: { v: 240, t: 2 }, 2: { f: '=$B$2*2', si: 'human-shared', s: 'human' } },
    2: { 1: { v: 30, t: 2 }, 2: { si: 'human-shared', s: 'human' } },
    3: { 1: { f: '=B2-B3', s: 'human' } },
    4: { 1: { f: '=B4*2' } },
  };
  book.sheetOrder.push('summary');
  book.sheets.summary = { id: 'summary', name: 'Summary', rowCount: 20, columnCount: 10, cellData: { 0: { 0: { f: "='Sheet 1'!B5+1" } } } };
  return book;
}
async function humanSnapshot() {
  const e = engine(), book = e.api.createWorkbook(fixture());
  try {
    await e.settle(); assert.equal(cell(book.save(), 3).v, 210);
    book.getActiveSheet().getRange('B2').setValue(999);
    await e.settle(); const saved = book.save();
    assert.equal(cell(saved, 3).v, 969, 'real native human edit populates the cached result');
    assert.equal(cell(saved, 2, 2).v, 1998, 'native shared-formula follower calculated');
    return structuredClone(saved);
  } finally { await e.dispose(); }
}
function correct(book) {
  assert.equal(cell(book, 3).v, 120);
  assert.equal(cell(book, 4).v, 240);
  assert.equal(book.sheets.summary.cellData[0][0].v, 241);
  assert.equal(cell(book, 1, 2).v, 300); assert.equal(cell(book, 2, 2).v, 300);
  assert.equal(cell(book, 1, 2).si, 'human-shared'); assert.equal(cell(book, 2, 2).si, 'human-shared');
  assert.equal(cell(book, 3).f, '=B2-B3'); assert.equal(cell(book, 3).s, 'human');
  assert.equal(cell(book, 0, 2).v, '=1+1'); assert.equal(cell(book, 0, 2).t, 1); assert.ok(!cell(book, 0, 2).f);
  assert.equal(cell(book, 0, 3).v, '#DIV/0!'); assert.equal(cell(book, 0, 3).t, 1); assert.equal(cell(book, 0, 3).f, '=1/0');
  assert.equal(cell(book, 0, 4).v, 0); assert.equal(cell(book, 0, 4).t, 3);
  assert.equal(cell(book, 0, 5).v, 'low'); assert.equal(cell(book, 0, 5).t, 1);
  assert.deepEqual(book.styles.human, fixture().styles.human);
}
test('native human snapshot -> authoritative patch -> default native reopen recalculates dependencies', async () => {
  const saved = await humanSnapshot();
  const modelRead = withoutFormulaResults(saved);
  assert.equal(cell(modelRead, 3).v, undefined, 'model read also excludes unverified caches in legacy native saves');
  assert.equal(cell(modelRead, 2, 2).v, undefined);
  assert.equal(cell(modelRead, 0, 2).v, '=1+1');
  assert.equal(cell(modelRead, 3).f, '=B2-B3');
  const patched = applyPatch(saved, { cells: [{ sheetId: 'sheet1', row: 1, column: 1, value: 150 }] });
  const e = engine(), book = e.api.createWorkbook(structuredClone(patched));
  try {
    await e.settle(); correct(book.save());
    // This is the same authoritative workbook read_sheet returns, before any client opens.
    for (const sheet of Object.values(patched.sheets)) for (const row of Object.values(sheet.cellData)) for (const c of Object.values(row)) {
      if (c.f || c.si) { assert.equal(c.v, undefined); assert.equal(c.t, undefined); }
    }
    assert.equal(cell(saved, 3).v, 969, 'invalidation never mutates the human snapshot');
  } finally { await e.dispose(); }
});
const editorCode = ts.transpileModule(readFileSync(new URL('../src/NativeEditor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function mountEditor(book) {
  let e, cleanup, handle, edits = 0; const events = new Map();
  const module = { exports: {} };
  const react = { useRef: current => ({ current }), useEffect: fn => { cleanup = fn(); } };
  new Function('require', 'module', 'exports', editorCode)(name => {
    if (name === 'react') return react;
    if (name === './drafts') return { isHumanSheetMutation, pendingCell };
    if (name.endsWith('.css')) return {};
    if (name === '@univerjs/preset-sheets-core/locales/en-US') return {};
    if (name === '@univerjs/preset-sheets-core') return { CalculationMode, UniverSheetsCorePreset: options => options };
    if (name === '@univerjs/presets') return { ...core, createUniver: options => {
      e = engine(options.presets[0].formula);
      // Headless SDK has no DOM cell-editor events; retain those callbacks while
      // native command events and all formula computation use the real SDK.
      Object.defineProperty(e.api, 'Event', { value: Object.assign(Object.create(e.api.Event), { SheetEditChanging: 'SheetEditChanging', SheetEditEnded: 'SheetEditEnded' }) });
      const createWorkbook = e.api.createWorkbook.bind(e.api);
      e.api.createWorkbook = data => { const workbook = createWorkbook(data); workbook.isCellEditing = () => false; return workbook; };
      const addEvent = e.api.addEvent.bind(e.api);
      e.api.addEvent = (event, callback) => { events.set(event, callback); return event.startsWith('SheetEdit') ? { dispose() {} } : addEvent(event, callback); };
      return { univer: e.univer, univerAPI: e.api };
    } };
    return localRequire(name);
  }, module, module.exports);
  module.exports.NativeEditor({ book, version: 'one', onReady: value => { handle = value; }, onEdit: () => { edits++; } });
  return { get handle() { return handle; }, get edits() { return edits; }, e, events,
    async dispose() { await delay(1100); cleanup(); } };
}
test('actual NativeEditor reopens legacy stale caches without a draft; calculation preserves pending input', async () => {
  const stale = await humanSnapshot(); cell(stale, 1).v = 150; // Existing privately saved defect, no DB rewrite.
  const view = mountEditor(stale);
  try {
    await view.e.settle(); correct(view.handle.save());
    assert.equal(view.edits, 0, 'initial calculation must not call the human onEdit callback');
    const sheet = view.e.api.getActiveWorkbook().getActiveSheet();
    // Real editor event payload; only DOM keystroke delivery is a fixture here.
    view.events.get(view.e.api.Event.SheetEditChanging)({ worksheet: sheet, row: 1, column: 1, value: core.RichTextValue.create({ id: 'typing', body: { dataStream: 'unfinished human text\r\n' } }) });
    const pending = view.handle.save(); assert.equal(view.edits, 1);
    view.e.api.getFormula().executeCalculation(); await view.e.settle();
    assert.equal(view.edits, 1); assert.deepEqual(view.handle.save(), pending, 'formula events cannot replace pending cell input');
    assert.equal(cell(stale, 3).v, 969, 'reopen does not persist or alter incoming data');
  } finally { await view.dispose(); }
});
test('maintenance Relink of a genuine human snapshot invalidates saved results before native reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-formula-maintenance-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const maintenance = new Maintenance({ workspace, files: new OwnedFiles(root) });
  const { workId } = await workspace.command('owner', { commandId: 'start', kind: 'start', text: 'Synthetic inventory formula regression', sourceIds: [] });
  const initialJob = await workspace.claim('owner'); await workspace.finish('owner', initialJob, [], 'ready');
  const saved = await humanSnapshot(); saved.id = workId;
  await workspace.save('owner', workId, { commandId: 'human-save', book: saved, contentRevision: 0, permissionRevision: 1 });
  const get = () => workspace.get('owner', workId);
  const source = await maintenance.publish('owner', { commandId: 'source', name: 'Synthetic inventory', synthetic: true, content: '{"stock_on_hand":150}' });
  const binding = await maintenance.create('owner', workId, { commandId: 'bind', sourceId: source.id, field: 'stock_on_hand', target: { sheetId: 'sheet1', row: 1, column: 1 }, expected: (await get()).expected });
  async function run() { await maintenance.admitDue('owner'); const job = await workspace.claim('owner'); assert.equal(job.kind, 'maintenance'); return maintenance.run('owner', job); }
  assert.equal((await run()).outcome, 'protected');
  const protectedWork = await get(); assert.equal(cell(protectedWork.book, 1).v, 999);
  await maintenance.manage('owner', workId, binding.id, { commandId: 'relink', action: 'relink', revision: protectedWork.responsibilities[0].revision, expected: protectedWork.expected });
  assert.equal((await run()).outcome, 'changed');
  const current = await get();
  assert.equal(cell(current.book, 1).v, 150); assert.equal(cell(current.book, 3).v, undefined);
  assert.equal(cell(current.book, 2, 2).v, undefined);
  assert.ok(current.humanCells.includes('sheet1:3:1')); assert.ok(!current.humanCells.includes('sheet1:1:1'));
  const e = engine(), book = e.api.createWorkbook(current.book);
  try { await e.settle(); correct(book.save()); } finally { await e.dispose(); }
});
