// Real installed Univer calculation + actual NativeEditor TSX lifecycle. No DOM,
// browser, database, service or provider is used by this regression.
import test from 'node:test';
import { mountEditor } from './sheet-scale-harness.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseCsv } from '../../../packages/workagent-contract/csv.mjs';
import { blankWorkbook, applyPatch, withoutFormulaResults } from '../../../packages/workagent-contract/index.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { Maintenance } from '../../workagent-server/src/responsibilities.mjs';
import { CsvExchange } from '../../workagent-server/src/exchange.mjs';
import { OwnedFiles } from '../../workagent-server/src/owned-files.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const core = require('@univerjs/core');
const { FUniver } = require('@univerjs/core/facade');
const { UniverSheetsPlugin } = require('@univerjs/sheets');
const { UniverFormulaEnginePlugin } = require('@univerjs/engine-formula');
const { UniverSheetsFormulaPlugin, CalculationMode } = require('@univerjs/sheets-formula');
require('@univerjs/sheets/facade'); require('@univerjs/engine-formula/facade'); require('@univerjs/sheets-formula/facade');
function engine(formula = {}) {
  const univer = new core.Univer({ locale: core.LocaleType.EN_US, locales: { [core.LocaleType.EN_US]: {} } });
  // Real preset loading registers UI facade observers; retain their native render dependency.
  univer.registerPlugin(require('@univerjs/engine-render').UniverRenderEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin, formula);
  const api = FUniver.newAPI(univer);
  return { univer, api, settle: () => api.getFormula().onCalculationResultApplied(4000),
    // The SDK's initial progress timer can outlive a fast headless calculation.
    async dispose() { await delay(1100); univer.dispose(); } };
}


import { trustedCodec, originalXlsx } from '../../workagent-server/tests/support/xlsx-fixture.mjs';
import { mountNative } from './sheet-scale-harness.mjs';
import { CONTROL_RESOURCE, sheetControls } from '../../../packages/workagent-contract/sheet-controls.mjs';
test('Boolean checkbox proposal accepted offline renders, validates and survives native save/reopen and XLSX exchange', async () => {
  const validationRequire = createRequire(import.meta.resolve('@univerjs/preset-sheets-data-validation'));
  validationRequire('@univerjs/sheets-data-validation/facade');
  const sdk = validationRequire('@univerjs/sheets-data-validation');
  const plugins = [validationRequire('@univerjs/data-validation').UniverDataValidationPlugin, sdk.UniverSheetsDataValidationPlugin];
  const dir = await mkdtemp(join(tmpdir(), 'checkbox-proposal-')), path = join(dir, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const ws = new Workspace(new FileFixtureStore(path));
  const { workId } = await ws.createBlank('owner', { commandId: 'offline-checkbox', title: 'Synthetic checkbox proposal' });
  const original = await ws.get('owner', workId), book = original.book;
  book.sheets.sheet1.cellData = { 0: { 0: { f: '=1+2' } } };
  // E11 is blank and human protected by the newly added control.
  const aliases = [[undefined, undefined], ['1', '0'], ['TRUE', 'FALSE'], ['true', 'false']];
  book.resources = [{ name: CONTROL_RESOURCE, data: JSON.stringify({ sheet1: aliases.map(([formula1, formula2], i) => ({
    uid: `check${i}`, type: 'checkbox', formula1, formula2,
    ranges: [{ startRow: 10, endRow: 11, startColumn: 4 + i, endColumn: 4 + i }],
  })) }) }];
  await ws.save('owner', workId, { commandId: 'offline-controls', book, contentRevision: original.contentRevision, permissionRevision: 1 });
  const before = await ws.get('owner', workId);
  assert.ok(before.humanCells.includes('sheet1:10:4'));
  const patch = { cells: aliases.flatMap((_, i) => [true, false].map((value, j) => ({ sheetId: 'sheet1', row: 10 + j, column: 4 + i, value }))) };
  const proposed = await ws.mutate('owner', workId, { commandId: 'offline-model', expected: before.expected, patch });
  assert.equal(proposed.status, 'proposed');
  assert.deepEqual((await ws.get('owner', workId)).book, before.book);
  const decision = { commandId: 'offline-accept', decision: 'accept', expected: before.expected };
  const accepted = await ws.decide('owner', workId, proposed.proposalId, decision);
  assert.deepEqual(await ws.decide('owner', workId, proposed.proposalId, decision), accepted);
  const reopened = await new Workspace(new FileFixtureStore(path)).get('owner', workId);
  assert.deepEqual(reopened.proposals[0].patch, patch, 'raw Boolean proposal is retained');
  assert.deepEqual(reopened.book.resources, before.book.resources);
  let saved = reopened.book;
  for (const stage of ['accepted', 'native-reopen', 'xlsx-reimport']) {
    if (stage === 'xlsx-reimport') saved = trustedCodec({ op: 'import', base64: trustedCodec({ op: 'export', book: saved }).base64 }).book;
    const view = mountNative({ book: saved, version: stage }, plugins);
    try {
      await view.settle();
      const model = view.api._injector.get(sdk.SheetDataValidationModel), validator = model.getValidator('checkbox');
      for (let column = 4; column < 8; column++) for (const row of [10, 11]) {
        const rule = model.getRuleByLocation(saved.id, 'sheet1', row, column), cell = saved.sheets.sheet1.cellData[row][column];
        assert.equal(validator.skipDefaultFontRender(rule, cell.v, { unitId: saved.id, subUnitId: 'sheet1' }), true, `${stage}: checkbox renderer at ${row}:${column}`);
        assert.equal(cell.v, row === 10 ? 1 : 0);
        // XLSX's Boolean storage reimports as native type 3 with numeric 1/0;
        // the renderer and validator above/below check its actual semantics.
        assert.equal(cell.t, stage === 'xlsx-reimport' ? 3 : 2, stage);
      }
      // The facade groups statuses by rule; XLSX may merge equivalent ranges.
      const statuses = await view.api.getActiveWorkbook().getActiveSheet().getRange('E11:H12').getValidatorStatus();
      assert.deepEqual(statuses.flat(), Array(8).fill('valid'));
      saved = view.handle.save();
    } finally { await delay(1100); view.dispose(); }
  }
});
test('installed SDK confirms last-control precedence and the ambiguity of explicit empty checkbox states', async () => {
  const validationRequire = createRequire(import.meta.resolve('@univerjs/preset-sheets-data-validation'));
  const sdk = validationRequire('@univerjs/sheets-data-validation');
  validationRequire('@univerjs/sheets-data-validation/facade');
  const book = blankWorkbook('checkbox-order'); book.sheets.sheet1.cellData = { 0: { 0: { f: '=1+2' } } };
  const range = column => [{ startRow: 10, endRow: 10, startColumn: column, endColumn: column }];
  const check = (uid, column, formula1 = '1', formula2 = '0') => ({ uid, type: 'checkbox', formula1, formula2, ranges: range(column) });
  const list = (uid, column) => ({ uid, type: 'list', formula1: '["Ready"]', ranges: range(column) });
  book.resources = [{ name: CONTROL_RESOURCE, data: JSON.stringify({ sheet1: [check('first', 4), list('last', 4), list('list-first', 5), check('check-last', 5), check('empty', 6, '', '')] }) }];
  const patched = applyPatch(book, { cells: [4, 5].map(column => ({ sheetId: 'sheet1', row: 10, column, value: true })) });
  const view = mountNative({ book: patched, version: 'order' }, [validationRequire('@univerjs/data-validation').UniverDataValidationPlugin, sdk.UniverSheetsDataValidationPlugin]);
  try {
    await view.settle(); const model = view.api._injector.get(sdk.SheetDataValidationModel);
    assert.equal(model.getRuleByLocation(book.id, 'sheet1', 10, 4).uid, 'last');
    assert.equal(model.getRuleByLocation(book.id, 'sheet1', 10, 5).uid, 'check-last');
    assert.equal(patched.sheets.sheet1.cellData[10][4].v, true);
    assert.equal(patched.sheets.sheet1.cellData[10][5].v, 1);
    const validator = model.getValidator('checkbox'), rule = model.getRuleByLocation(book.id, 'sheet1', 10, 6);
    for (const value of [0, 1]) assert.equal(validator.skipDefaultFontRender(rule, value, { unitId: book.id, subUnitId: 'sheet1' }), false);
    for (const value of [true, false]) assert.throws(() => applyPatch(book, { cells: [{ sheetId: 'sheet1', row: 10, column: 6, value }] }), e => e.code === 'unsupported_sheet_controls');
  } finally { await delay(1100); view.dispose(); }
});
test('modern XLSX checkbox controls load, toggle, undo, save and cold reopen with the installed SDK', async()=>{
  const validationRequire=createRequire(import.meta.resolve('@univerjs/preset-sheets-data-validation'));
  validationRequire('@univerjs/sheets-data-validation/facade');
  const plugins=[validationRequire('@univerjs/data-validation').UniverDataValidationPlugin,validationRequire('@univerjs/sheets-data-validation').UniverSheetsDataValidationPlugin];
  const book=blankWorkbook('checkbox-sdk');
  book.sheets.sheet1.cellData={0:{0:{f:'=1+2'}},8:{4:{v:false,t:3},5:{v:false,t:3}},9:{4:{v:true,t:3}}};
  book.resources=[{name:CONTROL_RESOURCE,data:JSON.stringify({sheet1:[{uid:'check',type:'checkbox',ranges:[{startRow:8,endRow:10,startColumn:4,endColumn:4}]}]})}];
  const imported=trustedCodec({op:'import',base64:trustedCodec({op:'export',book}).base64}).book;
  let view=mountNative({book:imported,version:'checkbox'},plugins), saved;
  try {
    await view.settle(); const wb=view.api.getActiveWorkbook(), sheet=wb.getActiveSheet();
    assert.equal(sheet.getRange('E9').getDataValidation().getCriteriaType(),'checkbox');
    const validator=view.api._injector.get(validationRequire('@univerjs/sheets-data-validation').SheetDataValidationModel).getValidator('checkbox');
    for (const row of [8,9,10]) assert.equal(validator.skipDefaultFontRender(sheetControls(imported).sheet1[0],imported.sheets.sheet1.cellData[row]?.[4]?.v,{unitId:imported.id,subUnitId:'sheet1'}),true);
    assert.deepEqual(await sheet.getRange('E9:E10').getValidatorStatus(),[['valid','valid']]);
    assert.equal(sheet.getRange('F9').getDataValidation(),undefined);
    assert.equal(view.handle.save().sheets.sheet1.cellData[10]?.[4]?.v ?? null,null);
    await view.api.executeCommand(require('@univerjs/sheets').SetRangeValuesCommand.id,{unitId:imported.id,subUnitId:'sheet1',range:{startRow:8,endRow:8,startColumn:4,endColumn:4},value:{v:1,p:null}});
    assert.equal(view.handle.save().sheets.sheet1.cellData[8][4].v,1);
    await wb.undo(); assert.ok(!view.handle.save().sheets.sheet1.cellData[8][4].v);
    await wb.redo(); saved=view.handle.save();
    assert.equal(sheetControls(saved).sheet1[0].type,'checkbox');
  } finally {await delay(1100);view.dispose();}
  const cold=trustedCodec({op:'import',base64:trustedCodec({op:'export',book:saved}).base64}).book;
  view=mountNative({book:cold,version:'checkbox-cold'},plugins);
  try {await view.settle(); const state=view.handle.save();
    assert.equal(state.sheets.sheet1.cellData[8][4].v,1);
    assert.equal(state.sheets.sheet1.cellData[8][5].v,false);
    assert.equal(state.sheets.sheet1.cellData[10]?.[4]?.v ?? null,null);
    assert.equal(sheetControls(state).sheet1[0].type,'checkbox');
  } finally {await delay(1100);view.dispose();}
});
test('XLSX Unicode sheet references and literal strings calculate with the installed native engine', async()=>{
  const seed=trustedCodec({op:'import',base64:originalXlsx.toString('base64')}).book;
  seed.sheets.sheet1.name='入力 雪';
  seed.sheets.sheet2.cellData={0:{0:{f:"=SUM('入力 雪'!A2,1E+2)"},1:{f:'=IF(A1>=100,"秘密","いいえ")'}}};
  const exported=trustedCodec({op:'export',book:seed});
  const imported=trustedCodec({op:'import',base64:exported.base64}).book;
  const e=engine({initialFormulaComputing:CalculationMode.FORCED});
  try {
    const book=e.api.createWorkbook(imported, {skipAutoRender:true}); await e.settle();
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
