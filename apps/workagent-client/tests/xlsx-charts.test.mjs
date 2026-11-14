// Trusted synthetic Excel-style fixture -> codec -> actual NativeEditor/SDK and
// production chart rendering. No browser, database, services or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { mountNative, ChartGraphic, SheetCharts } from './sheet-scale-harness.mjs';
import { mountConditionalEditor } from './conditional-editor-harness.mjs';
import { sheetCharts } from '../../../packages/workagent-contract/sheet-charts.mjs';
import { validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { trustedCodec } from '../../workagent-server/tests/support/xlsx-fixture.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = spawnSync(root+'.local/xlsx-python/bin/python', ['-I','-B','-c', `import importlib.util,base64
s=importlib.util.spec_from_file_location('fixtures',${JSON.stringify(root+'services/workagent-execution/xlsx/test_codec.py')})
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(base64.b64encode(m.chart_fixture()).decode())`], {encoding:'utf8',timeout:12000,maxBuffer:3000000});
assert.equal(fixture.status,0,fixture.stderr);

test('independent Excel charts render actual native formulas, zero, negative and gaps after import and export', async()=>{
  const original=fixture.stdout.trim(), imported=trustedCodec({op:'import',base64:original});
  validateWorkbook(imported.book);
  assert.equal(sheetCharts(imported.book).length,3);
  assert.match(imported.warnings.join('\n'),/Position, size/);
  const view=mountNative({book:imported.book,version:'xlsx-charts'}); let panel;
  try {
    await view.settle(); let state;
    for(let i=0;i<150;i++) { state=view.handle.charts.view(); if(state.status==='Live calculated values') break; await delay(20); }
    assert.equal(state.status,'Live calculated values');
    const [bar,line]=state.charts;
    assert.deepEqual(bar.range,{startRow:1,endRow:4,startColumn:1,endColumn:3});
    assert.deepEqual(state.data[bar.id].labels,['Zero','Negative','Missing']);
    assert.deepEqual(state.data[bar.id].series.map(s=>s.values),[[0,-2,null],[0,-4,null]]);
    assert.deepEqual(state.data[state.charts[2].id].series[0].values,[1]);
    panel=mountConditionalEditor(SheetCharts,{controller:view.handle.charts});
    assert.match(panel.text(),/Budget/);
    for(const c of [bar,line]) {
      const html=renderToStaticMarkup(React.createElement(ChartGraphic,{chart:c,data:state.data[c.id]}));
      assert.match(html,/Missing \(blank\)/); assert.doesNotMatch(html,/<Budget|NaN|Infinity/);
      assert.match(html,/Units/); assert.match(html,/Double/);
      assert.match(html,c.type==='bar'?/<rect /:/<line /);
    }
    const saved=await view.handle.commit(); const exported=trustedCodec({op:'export',book:saved});
    const reopened=trustedCodec({op:'import',base64:exported.base64}).book;
    validateWorkbook(reopened);assert.deepEqual(sheetCharts(reopened),sheetCharts(imported.book));
    assert.equal(reopened.sheets.sheet1.cellData[2][3].f,'=C3*2');
    assert.equal(reopened.sheets.sheet1.cellData[2][3].v,undefined);
    assert.equal(reopened.sheets.sheet1.cellData[4]?.[2]?.v,undefined);
  } finally {panel?.dispose();await delay(1100);view.dispose();}
});
