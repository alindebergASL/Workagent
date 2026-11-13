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
const editorCode = ts.transpileModule(readFileSync(new URL('../src/NativeEditor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function mountEditor(book, editing = {}) {
  let e, cleanup, handle, edits = 0; const events = new Map();
  const module = { exports: {} };
  const react = { useRef: current => ({ current }), useEffect: fn => { cleanup = fn(); } };
  new Function('require', 'module', 'exports', editorCode)(name => {
    // This exchange-only engine omits the validation preset and native forms.
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

import { trustedCodec, originalXlsx } from '../../workagent-server/tests/support/xlsx-fixture.mjs';
test('XLSX Unicode sheet references and literal strings calculate with the installed native engine', async()=>{
  const seed=trustedCodec({op:'import',base64:originalXlsx.toString('base64')}).book;
  seed.sheets.sheet1.name='入力 雪';
  seed.sheets.sheet2.cellData={0:{0:{f:"=SUM('入力 雪'!A2,1E+2)"},1:{f:'=IF(A1>=100,"秘密","いいえ")'}}};
  const exported=trustedCodec({op:'export',book:seed});
  const imported=trustedCodec({op:'import',base64:exported.base64}).book;
  const e=engine({initialFormulaComputing:CalculationMode.FORCED});
  try {
    const book=e.api.createWorkbook(imported); await e.settle();
    const cells=book.save().sheets.sheet2.cellData[0];
    assert.equal(cells[0].v,112.5); assert.equal(cells[1].v,'秘密');
  } finally {await e.dispose();}
});
test('real XLSX -> actual NativeEditor/SDK recalc -> pending edit commit -> real export/reopen/native calculation', async()=>{
  const imported=trustedCodec({op:'import',base64:originalXlsx.toString('base64')});
  const editing={active:false,apply:book=>book.getActiveSheet().getRange('A2').setValue(27)};
  const view=mountEditor(imported.book,editing);let exported;
  try {
    await view.e.settle(); let saved=view.handle.save();assert.equal(saved.sheets.sheet2.cellData[0][0].v,25);
    assert.equal(saved.sheets.sheet1.cellData[0][1].t,3);assert.equal(saved.sheets.sheet1.cellData[0][3].t,2);
    editing.active=true;const pending=await view.handle.commit();assert.equal(pending.sheets.sheet1.cellData[1][0].v,27);
    exported=trustedCodec({op:'export',book:pending});
  }finally{await view.dispose();}
  const reopened=trustedCodec({op:'import',base64:exported.base64}).book;
  assert.equal(reopened.sheets.sheet2.cellData[0][0].v,undefined);assert.equal(reopened.sheets.sheet2.cellData[0][0].f,"='Inputs'!A2*2");
  assert.equal(reopened.sheets.sheet1.cellData[0][0].v,'00120');assert.equal(reopened.sheets.sheet1.cellData[0][5].v,'=1+1');
  assert.equal(reopened.sheets.sheet1.mergeData.length,1);assert.equal(reopened.sheets.sheet1.cellData[1][0].s.bl,1);
  const second=mountEditor(reopened);
  try{await second.e.settle();const saved=second.handle.save();assert.equal(saved.sheets.sheet2.cellData[0][0].v,54);assert.equal(saved.sheets.sheet1.cellData[0][1].t,3);}finally{await second.dispose();}
});
