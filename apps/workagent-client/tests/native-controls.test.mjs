// Installed 1.4 SDK + real NativeEditor/App + authoritative file fixture. No browser/PG claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ComposerDrafts } from '../src/resume.ts';
import { XlsxExchange } from '../../workagent-server/src/xlsx-exchange.mjs';
import { mountNative, mountApp, memoryStorage } from './sheet-scale-harness.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { blankWorkbook, validateWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CONTROL_RESOURCE, sheetControls } from '../../../packages/workagent-contract/sheet-controls.mjs';
import { trustedCodec } from '../../workagent-server/tests/support/xlsx-fixture.mjs';
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-data-validation'));
require('@univerjs/sheets-data-validation/facade');
const plugins = [require('@univerjs/data-validation').UniverDataValidationPlugin, require('@univerjs/sheets-data-validation').UniverSheetsDataValidationPlugin];
test('real XLSX inline lists load into installed SDK, validate literals/blanks, Save and cold reopen', async () => {
  const book=blankWorkbook('xlsx-native');
  book.sheets.sheet1.cellData={0:{0:{v:'=1+1',t:1},2:{f:'=1+2'}},1:{0:{v:'Invalid',t:1}}};
  book.resources=[{name:CONTROL_RESOURCE,data:JSON.stringify({sheet1:[{uid:'list',type:'list',formula1:'["=1+1","Ready"]',allowBlank:false,showDropDown:true,showErrorMessage:true,errorStyle:1,ranges:[{startRow:0,endRow:2,startColumn:0,endColumn:0}]}]})}];
  const raw=trustedCodec({op:'export',book}); const imported=trustedCodec({op:'import',base64:raw.base64}).book;
  let view=mountNative({book:imported,version:'xlsx'},plugins), saved;
  try {
    await view.settle(); const sheet=view.api.getActiveWorkbook().getActiveSheet();
    assert.deepEqual(await sheet.getRange('A1:A3').getValidatorStatus(),[['valid','invalid','invalid']]);
    saved=view.handle.save(); validateWorkbook(saved);
    assert.equal(saved.sheets.sheet1.cellData[0][0].v,'=1+1'); assert.equal(saved.sheets.sheet1.cellData[0][0].f,undefined);
    assert.deepEqual(sheetControls(saved),sheetControls(imported)); assert.equal(view.edits,0); assert.deepEqual(view.handle.formatEdits(),{});
  } finally {await delay(1100);view.dispose();}
  view=mountNative({book:saved,version:'cold'},plugins);
  try {await view.settle(); assert.deepEqual(sheetControls(view.handle.save()),sheetControls(saved));
    assert.deepEqual(await view.api.getActiveWorkbook().getActiveSheet().getRange('A1:A3').getValidatorStatus(),[['valid','invalid','invalid']]);
  } finally {await delay(1100);view.dispose();}
});
for (const imported of [false, true]) test(`${imported ? 'imported' : 'new native'} dropdown commands preserve literal options, scope, undo, cold Save and XLSX reimport`, async () => {
  const choices = ['0012', 'TRUE', 'FALSE', '2026-11-13', '1e3', '$12.00', '=1+1', 'Ready'];
  const state = initialState('owner');
  const ws = new Workspace({ transaction: async fn => fn(state), read: async fn => fn(state) });
  const { workId } = await ws.createBlank('owner', { commandId: 'literal-new', title: 'Literal dropdowns' });
  let book = blankWorkbook(workId);
  book.sheets.sheet1.cellData = { 0: { 0: { v: 42, t: 2, s: { ff: 'Georgia', bl: 1, n: { pattern: '0.00' } } }, 2: { f: '=1+2' } },
    10: { 0: { v: 12, t: 2 } }, 11: { 0: { v: true, t: 3 } } };
  book.sheetOrder.push('second'); book.sheets.second = { ...structuredClone(book.sheets.sheet1), id: 'second', name: 'Second', cellData: {} };
  const rules = { sheet1: [{ uid: 'literal', type: 'list', formula1: JSON.stringify(choices), allowBlank: false,
    ranges: [{ startRow: 0, endRow: 19, startColumn: 0, endColumn: 0 }] }] };
  if (imported) {
    book.resources = [{ name: CONTROL_RESOURCE, data: JSON.stringify(rules) }];
    book = trustedCodec({ op: 'import', base64: trustedCodec({ op: 'export', book }).base64 }).book;
  }
  book.id = workId;
  state.works[workId].book = structuredClone(book);
  const secondId = book.sheetOrder[1];
  let view = mountNative({ book, version: 'literal' }, plugins), saved, humanCells;
  const payload = v => ({ v, p: null, f: null, si: null });
  const command = (value, row, column = 0, endRow = row, endColumn = column, sheetId = 'sheet1', unitId = book.id) =>
    view.api.executeCommand(require('@univerjs/sheets').SetRangeValuesCommand.id, {
      unitId, subUnitId: sheetId, range: { startRow: row, endRow, startColumn: column, endColumn }, value,
    });
  try {
    await view.settle(); assert.equal(view.edits, 0); assert.deepEqual(view.handle.formatEdits(), {});
    const wb = view.api.getActiveWorkbook(), sheet = wb.getActiveSheet();
    if (!imported) sheet.getRange('A1:A20').setDataValidation(view.api.newDataValidation().requireValueInList(choices).build());
    const style = sheet.getRange('A1').getCellStyleData();
    const initial = view.handle.save();
    assert.equal(initial.sheets.sheet1.cellData[10][0].v, 12); assert.equal(initial.sheets.sheet1.cellData[10][0].t, 2);
    assert.equal(initial.sheets.sheet1.cellData[11][0].t, 3);
    for (const [row, choice] of choices.entries()) assert.equal(await command(payload(choice), row), true);
    assert.deepEqual(await sheet.getRange('A1:A8').getValidatorStatus(), [choices.map(() => 'valid')]);
    await wb.undo(); assert.equal(view.handle.save().sheets.sheet1.cellData[7]?.[0]?.v ?? null, null);
    await wb.redo(); assert.equal(view.handle.save().sheets.sheet1.cellData[7][0].v, 'Ready');
    assert.deepEqual(sheet.getRange('A1').getCellStyleData(), style);
    // Scalar broadcasts, relative arrays and absolute sparse matrices all mix
    // controlled and ordinary cells; no payload object is shared after typing.
    await command(payload('0012'), 14, 0, 14, 1);
    await command([[payload('TRUE'), payload('TRUE')]], 15, 0, 15, 1);
    await command({ 16: { 0: payload('1e3'), 1: payload('1e3') } }, 0);
    await command({ v: '0012' }, 17); // Ordinary entry, even inside the list.
    await command(payload(12), 18); // Typed numeric payload is not an option string.
    await command({ ...payload('0012'), t: 2 }, 19);
    await command(payload('0012'), 0, 0, 0, 0, secondId);
    let snapshot = view.handle.save();
    for (const [row, literal, numeric, type] of [[14, '0012', 12, 2], [15, 'TRUE', 1, 3], [16, '1e3', 1000, 2]]) {
      assert.equal(snapshot.sheets.sheet1.cellData[row][0].v, literal);
      assert.equal(snapshot.sheets.sheet1.cellData[row][0].t, 1);
      assert.equal(snapshot.sheets.sheet1.cellData[row][1].v, numeric);
      assert.equal(snapshot.sheets.sheet1.cellData[row][1].t, type);
    }
    for (const row of [10, 17, 18, 19]) { assert.equal(snapshot.sheets.sheet1.cellData[row][0].v, 12); assert.equal(snapshot.sheets.sheet1.cellData[row][0].t, 2); }
    assert.equal(snapshot.sheets[secondId].cellData[0][0].v, 12);
    // Resolve the current rule on its target sheet, including changed/removed rules.
    const other = wb.getSheetBySheetId(secondId);
    other.getRange('A1').setDataValidation(view.api.newDataValidation().requireValueInList(['FALSE']).build());
    await command(payload('FALSE'), 0, 0, 0, 0, secondId);
    assert.equal(view.handle.save().sheets[secondId].cellData[0][0].v, 'FALSE');
    await command(payload('0012'), 0, 0, 0, 0, secondId);
    assert.equal(view.handle.save().sheets[secondId].cellData[0][0].v, 12, 'a non-option string keeps normal SDK inference');
    other.getRange('A1').setDataValidation(null);
    await command(payload('FALSE'), 0, 0, 0, 0, secondId);
    assert.equal(view.handle.save().sheets[secondId].cellData[0][0].t, 3);
    // Native checkbox payloads and their history remain numeric, not list strings.
    sheet.getRange('B2').setDataValidation(view.api.newDataValidation().requireCheckbox().build());
    wb.setActiveSheet(sheet);
    await view.api.executeCommand(require('@univerjs/sheets').SetRangeValuesCommand.id, {
      range: { startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }, value: { v: 1, p: null },
    });
    assert.equal(view.handle.save().sheets.sheet1.cellData[1][1].t, 2);
    await wb.undo(); assert.equal(view.handle.save().sheets.sheet1.cellData[1]?.[1]?.v ?? null, null);
    await wb.redo(); assert.equal(view.handle.save().sheets.sheet1.cellData[1][1].v, 1);
    // An additional workbook in this same SDK instance must not inherit the hook.
    const foreign = blankWorkbook('foreign'); foreign.resources = [{ name: CONTROL_RESOURCE, data: JSON.stringify(rules) }];
    view.api.createWorkbook(foreign);
    await command(payload('0012'), 0, 0, 0, 0, 'sheet1', foreign.id);
    assert.equal(view.api.getActiveWorkbook().save().sheets.sheet1.cellData[0][0].v, 12);
    saved = view.handle.save(); validateWorkbook(saved);
    assert.equal(saved.sheets.sheet1.cellData[0][2].f, '=1+2');
    assert.equal(saved.sheets.sheet1.cellData[11][0].t, 3);
    await ws.save('owner', workId, { commandId: 'literal-save', book: saved, formatEdits: view.handle.formatEdits(), contentRevision: 1, permissionRevision: 1 });
    const persisted = await ws.get('owner', workId);
    saved = persisted.book; humanCells = persisted.humanCells;
    for (const row of choices.keys()) assert.ok(humanCells.includes(`sheet1:${row}:0`));
    assert.ok(!humanCells.includes('sheet1:0:2'), 'calculation does not acquire human provenance');
  } finally { await delay(1100); view.dispose(); }
  view = mountNative({ book: saved, humanCells, version: 'literal-cold' }, plugins);
  try {
    await view.settle(); assert.equal(view.edits, 0); assert.deepEqual(view.handle.formatEdits(), {});
    const cold = view.handle.save();
    assert.deepEqual(await view.api.getActiveWorkbook().getActiveSheet().getRange('A1:A8').getValidatorStatus(), [choices.map(() => 'valid')]);
    for (const [row, choice] of choices.entries()) { assert.equal(cold.sheets.sheet1.cellData[row][0].v, choice); assert.equal(cold.sheets.sheet1.cellData[row][0].t, 1); }
    assert.equal(cold.sheets.sheet1.cellData[1][1].v, 1); assert.equal(cold.sheets.sheet1.cellData[1][1].t, 2);
    assert.deepEqual(sheetControls(cold), sheetControls(saved));
    // Checkbox file mapping remains explicitly unsupported; remove that rule by
    // its actual command before exercising the supported XLSX list round trip.
    view.api.getActiveWorkbook().getActiveSheet().getRange('B2').setDataValidation(null);
    const xlsx = trustedCodec({ op: 'export', book: view.handle.save() });
    const reimported = trustedCodec({ op: 'import', base64: xlsx.base64 }).book;
    for (const [row, choice] of choices.entries()) { assert.equal(reimported.sheets.sheet1.cellData[row][0].v, choice); assert.equal(reimported.sheets.sheet1.cellData[row][0].t, 1); }
    assert.equal(reimported.sheets.sheet1.cellData[0][2].f, '=1+2');
    assert.equal(reimported.sheets.sheet1.cellData[10][0].t, 2); assert.equal(reimported.sheets.sheet1.cellData[11][0].t, 3);
  } finally { await delay(1100); view.dispose(); }
});
for (const axis of ['row', 'column']) test(`removed blank control survives ${axis} deletion undo/redo, cold reopen, move and stale agent`, async () => {
  const state = initialState('owner');
  const ws = new Workspace({ transaction: async fn => fn(state), read: async fn => fn(state) });
  const { workId } = await ws.createBlank('owner', { commandId: 'new', title: 'Structural control history' });
  state.works[workId].book.sheets.sheet1.cellData = { 0: { 0: { f: '=TODAY()' } } };
  const derivedRow = axis === 'row' ? 4 : 1, derivedColumn = axis === 'row' ? 1 : 3;
  state.works[workId].book.sheets.sheet1.cellData[derivedRow] = { [derivedColumn]: { f: '=TODAY()' } };
  let saved = await ws.get('owner', workId), view = mountNative({ book: saved.book, version: 'first' }, plugins);
  const save = async commandId => {
    await ws.save('owner', workId, { commandId, book: view.handle.save(), formatEdits: view.handle.formatEdits(), contentRevision: saved.contentRevision, permissionRevision: 1 });
    saved = await ws.get('owner', workId);
  };
  try {
    await view.settle();
    const first = view.api.getActiveWorkbook().getActiveSheet();
    first.getRange('D5').setDataValidation(view.api.newDataValidation().requireCheckbox().build());
    first.getRange('D5').setDataValidation(null);
    await save('removed-rule');
    assert.ok(saved.humanCells.includes('sheet1:4:3'));
    await delay(1100); view.dispose(); view = null;
    view = mountNative({ book: saved.book, humanCells: saved.humanCells, version: 'cold' }, plugins);
    await view.settle();
    assert.equal(view.edits, 0); assert.deepEqual(view.handle.formatEdits(), {});
    const wb = view.api.getActiveWorkbook(), sheet = wb.getActiveSheet();
    const local = axis === 'row' ? 'E5' : 'D6', localAnchor = axis === 'row' ? 804 : 1003;
    sheet.getRange(local).setDataValidation(view.api.newDataValidation().requireCheckbox().build());
    sheet.getRange(local).setDataValidation(null);
    if (axis === 'row') sheet.deleteRows(4, 1); else sheet.deleteColumns(3, 1);
    assert.ok(!view.handle.formatEdits().sheet1?.includes(803));
    wb.undo();
    assert.ok(view.handle.formatEdits().sheet1?.includes(803), 'undo restores removed blank anchor without a cell payload');
    assert.ok(view.handle.formatEdits().sheet1?.includes(localAnchor), 'undo also restores unsaved blank intent');
    assert.ok(!view.handle.formatEdits().sheet1?.includes(derivedRow * 200 + derivedColumn), 'restoring an SDK-derived style is not human formatting');
    wb.redo();
    assert.ok(!view.handle.formatEdits().sheet1?.includes(803), 'redo retires deleted anchor');
    wb.undo();
    assert.ok(view.handle.formatEdits().sheet1?.includes(803), 'second undo restores the same anchor');
    // Native calculation must not become ownership through structural undo.
    assert.ok(!view.handle.formatEdits().sheet1?.includes(0));
    const stale = saved.expected;
    if (axis === 'row') sheet.insertRowsBefore(1, 1); else sheet.insertColumnsBefore(1, 1);
    const shifted = axis === 'row' ? 1003 : 804;
    assert.ok(view.handle.formatEdits().sheet1.includes(shifted));
    if (axis === 'row') sheet.moveRows(sheet.getRange('D6'), 9); else sheet.moveColumns(sheet.getRange('E5'), 8);
    const row = axis === 'row' ? 8 : 4, column = axis === 'row' ? 3 : 7;
    assert.ok(view.handle.formatEdits().sheet1.includes(row * 200 + column));
    wb.undo(); assert.ok(view.handle.formatEdits().sheet1.includes(shifted));
    wb.redo(); assert.ok(view.handle.formatEdits().sheet1.includes(row * 200 + column));
    await save('relocated');
    assert.ok(saved.humanCells.includes(`sheet1:${row}:${column}`));
    assert.ok(!saved.humanCells.includes('sheet1:0:0'), 'unmoved SDK-derived date remains agent-editable');
    for (const [label, expected] of [['stale', stale], ['fresh', saved.expected]]) {
      assert.equal((await ws.mutate('owner', workId, { commandId: label, expected,
        patch: { cells: [{ sheetId: 'sheet1', row, column, value: 'overwrite' }] } })).status, 'proposed');
      assert.equal((await ws.get('owner', workId)).proposals.at(-1).reason, 'human_edit');
    }
    assert.equal((await ws.mutate('owner', workId, { commandId: 'unowned', expected: saved.expected,
      patch: { cells: [{ sheetId: 'sheet1', row: 0, column: 0, value: null, formula: '=TODAY()+1' }] } })).status, 'applied');
    await delay(1100); view.dispose(); view = null;
    saved = await ws.get('owner', workId);
    view = mountNative({ book: saved.book, humanCells: saved.humanCells, version: 'second-cold' }, plugins);
    await view.settle(); assert.equal(view.edits, 0);
    if (axis === 'row') view.api.getActiveWorkbook().getActiveSheet().insertRowsBefore(1, 1);
    else view.api.getActiveWorkbook().getActiveSheet().insertColumnsBefore(1, 1);
    assert.ok(view.handle.formatEdits().sheet1.includes((row + (axis === 'row' ? 1 : 0)) * 200 + column + (axis === 'column' ? 1 : 0)));
    assert.equal(await ws.claim('owner'), null);
  } finally { if (view) { await delay(1100); view.dispose(); } }
});
test('native controls create/edit/delete blank cells, preserve values/styles/formulas, save/retry/reopen and relocate', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'native-controls-')), 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const ws = new Workspace(new FileFixtureStore(path));
  const {workId} = await ws.createBlank('owner', {commandId:'new',title:'Controls'});
  await ws.mutate('owner', workId, {commandId:'seed',expected:(await ws.get('owner',workId)).expected,patch:{cells:[{sheetId:'sheet1',row:0,column:0,value:'Existing'}, {sheetId:'sheet1',row:0,column:1,value:true}, {sheetId:'sheet1',row:0,column:2,value:null,formula:'=1+2'}]}});
  const calls = [], storage = memoryStorage(); let loseAck = true;
  const fetcher = async (url, options) => {
    const input = options.body && JSON.parse(options.body); let result;
    if(url === '/api/work') result = [{id:workId,title:'Controls',status:'ready'}];
    else if(url === '/api/events') result = {kind:'reset',cursor:1,events:[],works:[],snapshots:[]};
    else if(url.endsWith('/save')) { calls.push(input); result = await ws.save('owner',workId,input); if(loseAck) {loseAck=false;throw new Error('Lost acknowledgement fixture');} }
    else result = await ws.get('owner',workId);
    return {ok:true,status:200,json:async()=>structuredClone(result)};
  };
  new ComposerDrafts(storage).write(workId, {prompt: 'Unsent controls question', sourceName: '', sourceText: ''});
  let app = mountApp(storage,fetcher), view;
  try {
    await app.open(workId); for(let i=0;i<100&&!app.native();i++){await delay(10);await app.flush();}
    view = mountNative(app.native(),plugins); await view.settle(); assert.equal(view.edits,0);
    let wb = view.api.getActiveWorkbook(), sheet = wb.getActiveSheet();
    sheet.getRange('A1:A4').setDataValidation(view.api.newDataValidation().requireValueInList(['Existing','Next']).build());
    sheet.getRange('B1:B4').setDataValidation(view.api.newDataValidation().requireCheckbox().build());
    sheet.getRange('D7:D8').setDataValidation(view.api.newDataValidation().requireCheckbox().build());
    sheet.getRange('D7:D8').setDataValidation(null); // Net-zero resource change is still intent.
    sheet.getRange('C1').setFontWeight('bold');
    await app.flush(); assert.match(app.text(),/Unsaved changes/);
    const snapshot = view.handle.save(); validateWorkbook(snapshot);
    assert.equal(snapshot.sheets.sheet1.cellData[0][0].v,'Existing');
    assert.equal(snapshot.sheets.sheet1.cellData[0][1].v,true); assert.equal(snapshot.sheets.sheet1.cellData[0][1].t,3);
    assert.equal(snapshot.sheets.sheet1.cellData[0][2].f,'=1+2');
    assert.ok(view.handle.formatEdits().sheet1.includes(1203));
    await app.save(); await delay(20); await app.flush(); assert.equal(calls.length,1);
    await delay(1100); view.dispose(); view = null; app.unmount();
    app = mountApp(storage,fetcher); await app.open(workId);
    for(let i=0;i<100&&!app.native();i++){await delay(10);await app.flush();}
    view = mountNative(app.native(),plugins); await view.settle();
    assert.deepEqual(sheetControls(view.handle.save()),sheetControls(snapshot), 'recovery retains exact control definitions');
    assert.equal(new ComposerDrafts(storage).read(workId).prompt,'Unsent controls question');
    wb = view.api.getActiveWorkbook(); sheet = wb.getActiveSheet();
    await app.save(); await delay(20); await app.flush(); assert.deepEqual(calls[1],calls[0],'exact retry retains identity/resources/provenance');
    let saved = await ws.get('owner',workId); assert.equal(saved.contentRevision,3);
    assert.ok(saved.humanCells.includes('sheet1:3:0')); assert.ok(saved.humanCells.includes('sheet1:6:3'));
    assert.equal((await ws.mutate('owner',workId,{commandId:'agent',expected:saved.expected,patch:{cells:[{sheetId:'sheet1',row:3,column:0,value:'Invalid'}]}})).status,'proposed');
    sheet.getRange('A1:A4').setDataValidation(view.api.newDataValidation().requireValueInList(['Existing','Changed']).build());
    sheet.insertRowsBefore(0,1); await delay(20); await app.flush(); await app.save(); await delay(20); await app.flush();
    saved = await ws.get('owner',workId); validateWorkbook(saved.book);
    assert.equal(sheetControls(saved.book).sheet1.find(r=>r.type==='list').ranges[0].endRow,4);
    assert.ok(saved.humanCells.includes('sheet1:4:0'));
    sheet.getRange('A1:A5').setDataValidation(null); await app.flush(); await app.save(); await delay(20); await app.flush();
    saved = await ws.get('owner',workId); assert.equal(sheetControls(saved.book).sheet1.some(r=>r.type==='list'),false);
    assert.ok(saved.humanCells.includes('sheet1:4:0'));
    await delay(1100);view.dispose();view=null;
    const reopened = mountNative({book:saved.book,humanCells:saved.humanCells,version:'reopen'},plugins);
    try {await reopened.settle();assert.equal(reopened.edits,0);assert.deepEqual(sheetControls(reopened.handle.save()),sheetControls(saved.book));assert.equal(reopened.handle.save().sheets.sheet1.cellData[1][1].t,3);
      const s = reopened.api.getActiveWorkbook().getActiveSheet();
      s.insertRowsBefore(1,2); s.insertColumnsBefore(0,1);
      assert.ok(reopened.handle.formatEdits().sheet1.includes(1201), 'removed blank control ownership moves after cold reopen');
      const next = reopened.handle.save();
      await ws.save('owner',workId,{commandId:'cold-move',book:next,formatEdits:reopened.handle.formatEdits(),contentRevision:saved.contentRevision,permissionRevision:1});
      const current=await ws.get('owner',workId);
      assert.equal((await ws.mutate('owner',workId,{commandId:'moved-agent',expected:current.expected,patch:{cells:[{sheetId:'sheet1',row:6,column:1,value:'No'}]}})).status,'proposed');
      const xlsx=new XlsxExchange({workspace:ws,worker:{run(){throw new Error('must refuse before worker');}}});
      await assert.rejects(()=>xlsx.export('owner',{workId,book:next}),/xlsx_controls_not_supported/);
      assert.deepEqual((await ws.get('owner',workId)).book,next);
} finally {await delay(1100);reopened.dispose();}
    assert.equal(await ws.claim('owner'),null);
  } finally {if(view){await delay(1100);view.dispose();}app.unmount();}
});
const controlled = () => {const b=blankWorkbook('book'); b.resources=[{name:CONTROL_RESOURCE,data:JSON.stringify({sheet1:[{uid:'rule',type:'list',formula1:'["One","Two"]',formula2:',#ff0000',ranges:[{startRow:0,endRow:2,startColumn:0,endColumn:0}]}]})}];return b;};
test('bounded resource schema accepts actual list colors and rejects formulas, prototypes, arbitrary metadata and unlimited ranges',()=>{
  validateWorkbook(controlled());
  for(const mutate of [
    b=>b.resources.push({name:'UNKNOWN_PLUGIN',data:'{}'}),
    b=>b.resources.push({...b.resources[0]}),
    b=>b.resources[0].data='{"__proto__":[]}',
    b=>{const d=sheetControls(b);d.sheet1[0].formula1='=WEBSERVICE("https://example.com")';b.resources[0].data=JSON.stringify(d);},
    b=>{const d=sheetControls(b);d.sheet1[0].ranges[0].endRow=1e10;b.resources[0].data=JSON.stringify(d);},
    b=>{const d=sheetControls(b);d.sheet1[0].bizInfo={url:'https://example.com'};b.resources[0].data=JSON.stringify(d);},
  ]){const b=controlled();mutate(b);assert.throws(()=>validateWorkbook(b));}
});
