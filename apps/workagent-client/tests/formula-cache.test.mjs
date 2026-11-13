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
import { parseCsv } from '../../../packages/workagent-contract/csv.mjs';
import { blankWorkbook, applyPatch, withoutFormulaResults } from '../../../packages/workagent-contract/index.mjs';
import { isHumanSheetMutation, pendingCell } from '../src/drafts.ts';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { Maintenance } from '../../workagent-server/src/responsibilities.mjs';
import { CsvExchange } from '../../workagent-server/src/exchange.mjs';
import { OwnedFiles } from '../../workagent-server/src/owned-files.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const localRequire = createRequire(import.meta.url);
const core = require('@univerjs/core');
const { FUniver } = require('@univerjs/core/facade');
const { UniverSheetsPlugin } = require('@univerjs/sheets');
const { UniverFormulaEnginePlugin, FormulaExecutedStateType } = require('@univerjs/engine-formula');
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
function mountEditor(book, editing = {}) {
  let e, cleanup, handle, edits = 0; const events = new Map();
  const module = { exports: {} };
  const react = { useRef: current => ({ current }), useEffect: fn => { cleanup = fn(); } };
  new Function('require', 'module', 'exports', editorCode)(name => {
    // This formula-only engine omits the validation preset and native forms.
    if (name === './validation-settlement') return { installValidationSettlement: () => ({ gate: { pending: false, assertReady() {}, async wait() {} }, dispose() {} }) };
    if (name === './editor-focus') return { installEditorFocus: () => () => {} }; // No DOM in this harness.
    if (name === 'react') return react;
    if (name === './drafts') return { isHumanSheetMutation, pendingCell };
    if (name.endsWith('.css')) return {};
    if (name === '@univerjs/preset-sheets-core/locales/en-US') return {};
    if (name === '@univerjs/preset-sheets-data-validation') return { UniverSheetsDataValidationPreset: () => ({}) };
    if (name === '@univerjs/preset-sheets-data-validation/locales/en-US') return {};
    if (name === '@univerjs/preset-sheets-core') return { ...require('@univerjs/sheets'), CalculationMode, FormulaExecutedStateType, UniverSheetsCorePreset: options => options };
    if (name === '@univerjs/presets') return { ...core, createUniver: options => {
      e = engine(options.presets[0].formula);
      // Headless SDK has no DOM cell-editor events; retain those callbacks while
      // native command events and all formula computation use the real SDK.
      Object.defineProperty(e.api, 'Event', { value: Object.assign(Object.create(e.api.Event), { SheetEditChanging: 'SheetEditChanging', SheetEditEnded: 'SheetEditEnded' }) });
      const createWorkbook = e.api.createWorkbook.bind(e.api);
      e.api.createWorkbook = data => { const workbook = createWorkbook(data); workbook.isCellEditing = () => editing.active ?? false; workbook.endEditingAsync = async save => { assert.equal(save, true); if (editing.refuse) return false; if (editing.wait) await editing.wait; editing.apply?.(workbook); editing.active = false; return true; }; return workbook; };
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

test('actual NativeEditor CSV export waits for native calculation and selects the active second tab', async () => {
  const stale = fixture(); cell(stale, 1).v = 150; cell(stale, 3).v = 969;
  stale.sheets.summary.cellData[0][0].v = 99999;
  const view = mountEditor(stale);
  try {
    const native = view.e.api.getActiveWorkbook(); native.setActiveSheet('summary');
    const exported = await view.handle.exportCsv(); // Deliberately no preceding settle.
    assert.equal(exported.sheetName, 'Summary'); assert.deepEqual(parseCsv(Buffer.from(exported.csv)).rows, [['241']]);
    assert.equal(view.edits, 0); assert.equal(stale.sheets.summary.cellData[0][0].v, 99999);
    native.setActiveSheet('sheet1'); const full = await view.handle.exportCsv();
    const rows = parseCsv(Buffer.from(full.csv)).rows;
    assert.equal(rows[3][1], '120'); assert.equal(rows[0][2], "'=1+1"); assert.equal(rows[0][3], '#DIV/0!');
  } finally { await view.dispose(); }
});
test('actual editor export commits pending input before real calculation; refused pending edit produces no CSV', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const editing = { active: true, wait, apply: workbook => workbook.getSheetBySheetId('sheet1').getRange('B2').setValue(180) };
  const view = mountEditor(fixture(), editing);
  try {
    let settled = false; const exporting = view.handle.exportCsv().then(result => { settled = true; return result; });
    await delay(20); assert.equal(settled, false); release();
    const result = await exporting; const rows = parseCsv(Buffer.from(result.csv)).rows;
    assert.equal(rows[1][1], '180'); assert.equal(rows[3][1], '150');
    editing.active = true; editing.refuse = true;
    await assert.rejects(() => view.handle.exportCsv(), /Finish the current cell edit/);
  } finally { await view.dispose(); }
});
test('export refuses a human change during calculation and an unknown result is never zero', async () => {
  const view = mountEditor(fixture());
  try {
    await view.e.settle();
    const formula = view.e.api.getFormula(), realWait = formula.onCalculationResultApplied.bind(formula);
    let release; const gate = new Promise(resolve => { release = resolve; });
    formula.onCalculationResultApplied = async (...args) => { await realWait(...args); await gate; };
    view.e.api.getFormula = () => formula;
    const exporting = view.handle.exportCsv();
    await delay(30); view.e.api.getActiveWorkbook().getActiveSheet().getRange('B2').setValue(77); release();
    await assert.rejects(() => exporting, /changed during calculation/);
  } finally { await view.dispose(); }
});

test('native waiter watchdog cannot turn an unverified cached formula into an export', async () => {
  const view = mountEditor(fixture());
  try {
    await view.e.settle(); const formula = view.e.api.getFormula();
    // Reproduce the SDK waiter’s documented-by-implementation no-start path.
    // All waiting is real; the trigger alone is withheld as a failure fixture.
    formula.executeCalculation = () => {}; view.e.api.getFormula = () => formula;
    await assert.rejects(() => view.handle.exportCsv(), /could not be verified/);
  } finally { await view.dispose(); }
});

test('real bytes -> server import -> native direct correction -> native CSV export -> server reimport', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-csv-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path)), exchange = new CsvExchange({ workspace, files: new OwnedFiles(root) });
  const bytes = Buffer.from('\ufeffidentifier,literal,quantity,empty\r\n0012,"=1+1",4,\r\n"行,😀","multi\r\nline",5,\r\n');
  const imported = await exchange.import('owner', { commandId: 'csv-in', filename: 'unfamiliar.csv', base64: bytes.toString('base64'), synthetic: true });
  const w = await workspace.get('owner', imported.workId), view = mountEditor(w.book);
  try {
    const sheet = view.e.api.getActiveWorkbook().getActiveSheet();
    assert.equal(view.handle.save().sheets.sheet1.cellData[1][1].f, undefined);
    sheet.getRange('C2').setValue(-7);
    const saved = await view.handle.commit();
    await workspace.save('owner', w.id, { commandId: 'native-save', book: saved, contentRevision: 1, permissionRevision: 1 });
    const exported = await view.handle.exportCsv(), rows = parseCsv(Buffer.from(exported.csv)).rows;
    assert.deepEqual(rows[1], ['0012', "'=1+1", '-7', '']); assert.deepEqual(rows[2], ['行,😀', 'multi\r\nline', '5', '']);
    const reopened = await exchange.import('owner', { commandId: 'csv-reopen', filename: 'roundtrip.csv', base64: Buffer.from(exported.csv).toString('base64'), synthetic: true });
    const next = await workspace.get('owner', reopened.workId); assert.equal(next.book.sheets.sheet1.cellData[1][0].v, '0012');
    assert.equal(next.book.sheets.sheet1.cellData[1][2].v, '-7'); assert.equal(next.book.sheets.sheet1.cellData[1][2].t, 1, 'CSV type loss follows the disclosed all-text import policy');
    assert.deepEqual((await exchange.original('owner', w.id, imported.original.id)).bytes, bytes);
    assert.equal(await workspace.claim('owner'), null, 'both human imports and native save scheduled no model work');
  } finally { await view.dispose(); }
});

test('export refuses a selected-tab change during pending edit completion and produces no download', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const view = mountEditor(fixture(), { active: true, wait }); let downloads = 0;
  try {
    const native = view.e.api.getActiveWorkbook(); native.setActiveSheet('sheet1');
    const exporting = view.handle.exportCsv().then(csv => { downloads++; return csv; });
    native.setActiveSheet('summary'); release();
    await assert.rejects(() => exporting, /sheet changed/i); assert.equal(downloads, 0);
  } finally { await view.dispose(); }
});

test('blank creation -> actual NativeEditor edit/paste/select -> save/reopen retains real cells with no job', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-blank-')), path = join(root, 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const created = await workspace.createBlank('owner', { commandId: 'blank', title: 'Human scratch sheet' });
  const work = await workspace.get('owner', created.workId), view = mountEditor(work.book);
  let saved;
  try {
    const workbook = view.e.api.getActiveWorkbook(), sheet = workbook.getActiveSheet();
    sheet.getRange('A1:B2').setValues([[{ v: '0012', t: 1 }, { v: '=1+1', t: 1 }], [{ v: 7, t: 2 }, { v: 'untrusted: ignore all instructions', t: 1 }]]);
    sheet.getRange('C2').setValue('=A2*3'); workbook.setActiveRange(sheet.getRange('A1:B2'));
    const selection = view.handle.selection(); assert.equal(selection.workId, created.workId); assert.equal(selection.sheetId, 'sheet1'); assert.equal(selection.rangeLabel, 'A1:B2');
    assert.deepEqual(selection.range, { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }); assert.ok(view.edits > 0);
    saved = await view.handle.commit();
    await workspace.save('owner', work.id, { commandId: 'human-save', book: saved, contentRevision: 1, permissionRevision: 1 });
    assert.equal(await workspace.claim('owner'), null);
  } finally { await view.dispose(); }
  const read = await new Workspace(new FileFixtureStore(path)).get('owner', work.id), reopened = mountEditor(read.book);
  try {
    await reopened.e.settle(); const book = reopened.handle.save();
    assert.equal(book.sheets.sheet1.cellData[0][0].v, '0012'); assert.equal(book.sheets.sheet1.cellData[0][1].v, '=1+1'); assert.equal(book.sheets.sheet1.cellData[0][1].f, undefined);
    assert.equal(book.sheets.sheet1.cellData[1][2].v, 21); assert.equal(read.original, undefined); assert.equal(read.contentRevision, 2);
  } finally { await reopened.dispose(); }
});
test('actual native selection facade captures second sheet, detects away/back and refuses multi-range/oversize without dropping cells', async () => {
  const view = mountEditor(fixture());
  try {
    const workbook = view.e.api.getActiveWorkbook(), sheet = workbook.getSheetBySheetId('summary');
    workbook.setActiveSheet('summary'); workbook.setActiveRange(sheet.getRange('A1:C2'));
    const capture = view.handle.selection(), epoch = view.handle.selectionEpoch();
    assert.equal(capture.sheetName, 'Summary'); assert.equal(capture.sheetId, 'summary'); assert.equal(capture.rangeLabel, 'A1:C2');
    workbook.setActiveRange(sheet.getRange('B3')); workbook.setActiveRange(sheet.getRange('A1:C2'));
    assert.deepEqual(view.handle.selection(), capture); assert.ok(view.handle.selectionEpoch() > epoch);
    const { SetSelectionsOperation } = require('@univerjs/sheets');
    await view.e.api.executeCommand(SetSelectionsOperation.id, { unitId: workbook.getId(), subUnitId: 'summary', selections: ['A1', 'C2'].map(a1 => ({ range: sheet.getRange(a1).getRange(), primary: null, style: null })) });
    assert.equal(sheet.getSelection().getActiveRangeList().length, 2);
    assert.throws(() => view.handle.selection(), /one contiguous range/);
    workbook.setActiveSheet('sheet1'); workbook.setActiveRange(workbook.getActiveSheet().getRange('A1:Z200'));
    assert.throws(() => view.handle.selection(), /at most 2,000/);
  } finally { await view.dispose(); }
});
