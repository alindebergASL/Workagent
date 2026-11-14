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
