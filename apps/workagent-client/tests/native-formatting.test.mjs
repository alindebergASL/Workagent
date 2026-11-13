// Installed SDK commands -> actual NativeEditor/App -> file-fixture authority.
// Headless hooks/input seam; toolbar geometry and browser storage are not tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { mountNative, mountApp, memoryStorage } from './sheet-scale-harness.mjs';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { validateFormatEdits } from '../../../packages/workagent-contract/index.mjs';
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const { UniverSheetsNumfmtPlugin } = require('@univerjs/sheets-numfmt');
require('@univerjs/sheets-numfmt/facade');
const style = (book, col) => {
  const s = book.sheets.sheet1.cellData[0][col].s;
  return typeof s === 'string' ? book.styles[s] : s;
};
test('real bold/italic/fill/number format notify App, save/reopen, and protect value and formula cells', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'native-formatting-')), 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const workspace = new Workspace(new FileFixtureStore(path));
  const { workId } = await workspace.createBlank('owner', { commandId: 'blank', title: 'Formatting fixture' });
  await workspace.mutate('owner', workId, { commandId: 'seed', expected: (await workspace.get('owner', workId)).expected,
    patch: { cells: [{ sheetId: 'sheet1', row: 0, column: 0, value: 12.5 }, { sheetId: 'sheet1', row: 0, column: 1, value: null, formula: '=A1*2' }] } });
  const initial = await workspace.get('owner', workId), calls = [];
  assert.deepEqual(initial.humanCells, []);
  const app = mountApp(memoryStorage(), async (url, options) => {
    const input = options.body && JSON.parse(options.body); let result;
    if (url === '/api/work') result = [{ id: workId, title: initial.title, status: initial.status }];
    else if (url === '/api/events') result = { kind: 'reset', cursor: 1, events: [], works: [], snapshots: [] };
    else if (url.endsWith('/save')) { calls.push(input); result = await workspace.save('owner', workId, input); }
    else result = await workspace.get('owner', workId);
    return { ok: true, status: 200, json: async () => structuredClone(result) };
  });
  let view, saved;
  try {
    await app.open(workId);
    for (let i = 0; i < 100 && !app.native(); i++) { await delay(10); await app.flush(); }
    assert.ok(app.native(), app.text());
    view = mountNative(app.native(), [UniverSheetsNumfmtPlugin]);
    await view.settle(); assert.equal(view.edits, 0);
    const range = view.api.getActiveWorkbook().getActiveSheet().getRange('A1:B1');
    for (const [apply, expected] of [
      [() => range.setFontWeight('bold'), { bl: 1 }],
      [() => range.setFontStyle('italic'), { it: 1 }],
      [() => range.setBackgroundColor('#ffe599'), { bg: { rgb: '#ffe599' } }],
      [() => range.setNumberFormat('#,##0.00'), { n: { pattern: '#,##0.00' } }],
    ]) {
      const before = view.edits; apply(); await app.flush();
      assert.ok(view.edits > before, 'each real formatting command notifies NativeEditor onEdit');
      for (const col of [0, 1]) for (const [key, value] of Object.entries(expected)) assert.deepEqual(style(view.handle.save(), col)[key], value);
      assert.match(app.text(), /Unsaved changes/);
    }
    saved = await view.handle.commit();
    assert.deepEqual(view.handle.save(), saved);
    await app.save();
    for (let i = 0; i < 100 && /Unsaved changes/.test(app.text()); i++) { await delay(10); await app.flush(); }
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].book, saved);
    assert.match(app.text(), /Saved/); assert.doesNotMatch(app.text(), /Unsaved changes/);
  } finally { if (view) { await delay(1100); view.dispose(); } app.unmount(); }
  const reopened = new Workspace(new FileFixtureStore(path));
  const stored = await reopened.get('owner', workId);
  assert.deepEqual(stored.book, saved, 'authoritative serialized snapshot retains every native style');
  const next = mountNative({ book: stored.book, version: 'reopened' }, [UniverSheetsNumfmtPlugin]);
  try {
    await next.settle(); assert.equal(next.edits, 0, 'recalculation is not a human formatting edit');
    const snapshot = next.handle.save(), cells = snapshot.sheets.sheet1.cellData[0];
    assert.equal(cells[0].v, 12.5); assert.equal(cells[1].f, '=A1*2'); assert.equal(cells[1].v, 25);
    for (const col of [0, 1]) assert.deepEqual(style(snapshot, col), style(saved, col));
  } finally { await delay(1100); next.dispose(); }
  assert.deepEqual(stored.humanCells.sort(), ['sheet1:0:0', 'sheet1:0:1'], 'format-only edits protect both literal and formula cells');
  for (const column of [0, 1]) {
    const result = await reopened.mutate('owner', workId, { commandId: `overwrite-${column}`, expected: stored.expected,
      patch: { cells: [{ sheetId: 'sheet1', row: 0, column, value: 99 }] } });
    assert.equal(result.status, 'proposed', 'even a fresh agent read cannot overwrite a human-formatted cell');
  }
  assert.deepEqual((await reopened.get('owner', workId)).book, saved);
  assert.equal(await reopened.claim('owner'), null, 'formatting/save creates no model job');
});

test('derived date/inherited formats stay agent-editable through actual calculation, A1 formatting, App Save and cold reopen', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'format-provenance-')), 'workspace.json');
  const state = initialState('owner');
  await writeFile(path, JSON.stringify(state));
  let ws = new Workspace(new FileFixtureStore(path));
  const { workId } = await ws.createBlank('owner', { commandId: 'new', title: 'Derived styles' });
  await ws.mutate('owner', workId, { commandId: 'seed', expected: (await ws.get('owner', workId)).expected, patch: { cells: [
    { sheetId: 'sheet1', row: 0, column: 0, value: 1 },
    { sheetId: 'sheet1', row: 0, column: 1, value: null, formula: '=TODAY()' },
    { sheetId: 'sheet1', row: 0, column: 2, value: null, formula: '=A1' },
  ] } });
  // Explicit fixture source formatting, not a human Save.
  await ws.store.transaction(s => {
    const book = s.works[workId].book;
    book.styles.percent = { n: { pattern: '0.00%' } };
    book.sheets.sheet1.cellData[0][0].s = 'percent';
    book.sheets.sheet1.cellData[0][3] = { f: '=A1', si: 'shared' };
    book.sheets.sheet1.cellData[1] = { 3: { si: 'shared' } };
  });
  const calls = [], storage = memoryStorage();
  const fetcher = async (url, options) => {
    const input = options.body && JSON.parse(options.body); let result;
    if (url === '/api/work') result = [{ id: workId, title: 'Derived styles', status: 'ready' }];
    else if (url === '/api/events') result = { kind: 'reset', cursor: 1, events: [], works: [], snapshots: [] };
    else if (url.endsWith('/save')) { calls.push(structuredClone(input)); result = await ws.save('owner', workId, input); }
    else result = await ws.get('owner', workId);
    return { ok: true, status: 200, json: async () => structuredClone(result) };
  };
  const open = async () => {
    const app = mountApp(storage, fetcher); await app.open(workId);
    for (let i = 0; i < 100 && !app.native(); i++) { await delay(10); await app.flush(); }
    const view = mountNative(app.native(), [UniverSheetsNumfmtPlugin]); await view.settle();
    return { app, view, async close() { await delay(1100); view.dispose(); app.unmount(); } };
  };
  let session = await open();
  try {
    const { app, view } = session;
    assert.equal(view.edits, 0); assert.deepEqual(view.handle.formatEdits(), {});
    const computed = view.handle.save();
    assert.ok(style(computed, 1).n.pattern, 'real TODAY calculation supplies date format');
    assert.equal(style(computed, 2).n.pattern, '0.00%', 'real reference calculation inherits percentage format');
    await view.api.executeCommand('sheet.mutation.set-range-values', { unitId: workId, subUnitId: 'sheet1', cellValue: { 0: { 2: { s: structuredClone(style(computed, 2)) } } } });
    assert.deepEqual(view.handle.formatEdits(), {}, 'equivalent resolved styles do not acquire ownership');
    view.api.getActiveWorkbook().getActiveSheet().getRange('A1').setFontWeight('bold');
    await app.flush(); await app.save();
    for (let i = 0; i < 100 && /Unsaved changes/.test(app.text()); i++) { await delay(10); await app.flush(); }
    assert.doesNotMatch(app.text(), /Unsaved changes/);
    assert.deepEqual(calls[0].formatEdits, { sheet1: [0] });
    const saved = await ws.get('owner', workId);
    assert.deepEqual(saved.humanCells, ['sheet1:0:0']);
    assert.deepEqual(saved.book, calls[0].book, 'complete native snapshot persisted unchanged');
    assert.deepEqual(style(saved.book, 1), style(computed, 1));
    assert.deepEqual(style(saved.book, 2), style(computed, 2));
    for (const column of [1, 2]) {
      const current = await ws.get('owner', workId);
      assert.equal((await ws.mutate('owner', workId, { commandId: `fresh-${column}`, expected: current.expected,
        patch: { cells: [{ sheetId: 'sheet1', row: 0, column, value: null, formula: column === 1 ? '=TODAY()+1' : '=A1*2' }] } })).status, 'applied');
    }
  } finally { await session.close(); }
  ws = new Workspace(new FileFixtureStore(path));
  session = await open();
  try {
    const { app, view } = session;
    assert.equal(view.edits, 0); assert.deepEqual(view.handle.formatEdits(), {});
    assert.deepEqual((await ws.get('owner', workId)).humanCells, ['sheet1:0:0']);
    const sheet = view.api.getActiveWorkbook().getActiveSheet();
    // Adopting even the existing automatic format is an explicit human action.
    sheet.getRange('B1').setNumberFormat(style(view.handle.save(), 1).n.pattern);
    sheet.getRange('D1:D2').setNumberFormat('0.000');
    await app.flush(); await app.save();
    for (let i = 0; i < 100 && /Unsaved changes/.test(app.text()); i++) { await delay(10); await app.flush(); }
    assert.doesNotMatch(app.text(), /Unsaved changes/);
    const saved = await ws.get('owner', workId);
    assert.deepEqual(saved.humanCells.sort(), ['sheet1:0:0', 'sheet1:0:1', 'sheet1:0:3', 'sheet1:1:3']);
    assert.equal(saved.book.sheets.sheet1.cellData[1][3].si, 'shared');
    assert.equal((await ws.mutate('owner', workId, { commandId: 'overwrite-formatted', expected: saved.expected,
      patch: { cells: [{ sheetId: 'sheet1', row: 0, column: 1, value: 42 }] } })).status, 'proposed');
    assert.equal((await ws.get('owner', workId)).proposals.at(-1).reason, 'human_edit');
    const equivalent = structuredClone(saved.book);
    equivalent.styles.alias = structuredClone(style(equivalent, 2)); equivalent.sheets.sheet1.cellData[0][2].s = 'alias';
    await ws.save('owner', workId, { commandId: 'equivalent-cache', book: equivalent, formatEdits: {}, contentRevision: saved.contentRevision, permissionRevision: 1 });
    assert.deepEqual((await ws.get('owner', workId)).humanCells.sort(), saved.humanCells.sort());
    assert.equal(await ws.claim('owner'), null);
  } finally { await session.close(); }
});

test('native structural edits and undo/redo relocate blank formatting through App Save and authority', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'format-structure-')), 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  let ws = new Workspace(new FileFixtureStore(path));
  const { workId } = await ws.createBlank('owner', { commandId: 'new', title: 'Structure' });
  await ws.mutate('owner', workId, { commandId: 'seed', expected: (await ws.get('owner', workId)).expected,
    patch: { cells: [{ sheetId: 'sheet1', row: 0, column: 0, value: 1 }, { sheetId: 'sheet1', row: 0, column: 1, value: null, formula: '=A1+1' },
      { sheetId: 'sheet1', row: 4, column: 0, value: 7 }, { sheetId: 'sheet1', row: 4, column: 1, value: null, formula: '=A5*3' },
      { sheetId: 'sheet1', row: 0, column: 2, value: null, formula: '=TODAY()' }] } });
  await ws.store.transaction(s => {
    const book = s.works[workId].book;
    book.sheetOrder.push('automatic'); book.styles.percent = { n: { pattern: '0.00%' } };
    book.sheets.automatic = { id: 'automatic', name: 'Automatic', rowCount: 20, columnCount: 10,
      cellData: { 0: { 0: { v: 0.5, t: 2, s: 'percent' }, 1: { f: '=TODAY()' }, 2: { f: '=A1' } } } };
  });
  const calls = [], storage = memoryStorage();
  const fetcher = async (url, options) => {
    const input = options.body && JSON.parse(options.body); let result;
    if (url === '/api/work') result = [{ id: workId, title: 'Structure', status: 'ready' }];
    else if (url === '/api/events') result = { kind: 'reset', cursor: 1, events: [], works: [], snapshots: [] };
    else if (url.endsWith('/save')) { calls.push(structuredClone(input)); result = await ws.save('owner', workId, input); }
    else result = await ws.get('owner', workId);
    return { ok: true, status: 200, json: async () => structuredClone(result) };
  };
  const open = async () => {
    const app = mountApp(storage, fetcher); await app.open(workId);
    for (let i = 0; i < 100 && !app.native(); i++) { await delay(10); await app.flush(); }
    assert.ok(app.native(), app.text());
    const view = mountNative(app.native(), [UniverSheetsNumfmtPlugin]); await view.settle();
    return { app, view, async close() { await delay(1100); view.dispose(); app.unmount(); } };
  };
  const cellStyle = (book, row, col, sid = 'sheet1') => {
    const s = book.sheets[sid].cellData[row]?.[col]?.s;
    return typeof s === 'string' ? book.styles[s] : s;
  };
  let session = await open(), step = 0;
  const checkSave = async (label, row, column, absent = []) => {
    const { app, view } = session;
    await delay(20); await app.flush();
    const book = await view.handle.commit(), formats = view.handle.formatEdits();
    assert.deepEqual(validateFormatEdits(formats, book), formats, label);
    assert.equal(formats.automatic, undefined, `${label}: untouched calculated formats stay unowned`);
    if (row !== null) {
      assert.equal(cellStyle(book, row, column)?.bl, 1, `${label}: blank style survives`);
      assert.equal(book.sheets.sheet1.cellData[row][column].v ?? null, null, `${label}: remains style-only`);
      assert.ok(formats.sheet1?.includes(row * 200 + column), `${label}: destination is protected`);
    }
    for (const coordinate of absent) assert.ok(!formats.sheet1?.includes(coordinate), `${label}: deleted coordinate retired`);
    const count = calls.length; await app.save();
    for (let i = 0; i < 100 && /Unsaved changes/.test(app.text()); i++) { await delay(10); await app.flush(); }
    assert.doesNotMatch(app.text(), /Unsaved changes/, label);
    assert.equal(calls.length, count + 1, label);
    assert.deepEqual(calls.at(-1).formatEdits, formats, label);
    assert.deepEqual(Object.keys(calls.at(-1)).sort(), ['book', 'commandId', 'contentRevision', 'formatEdits', 'permissionRevision']);
    const saved = await ws.get('owner', workId);
    assert.deepEqual(saved.book, calls.at(-1).book, `${label}: whole snapshot persisted`);
    assert.ok(!saved.humanCells.some(c => c.startsWith('automatic:')), label);
    for (const cell of saved.humanCells) {
      const [sid, r, c] = cell.split(':');
      assert.ok(saved.book.sheetOrder.includes(sid) && +r < saved.book.sheets[sid].rowCount && +c < saved.book.sheets[sid].columnCount, `${label}: bounded saved protection`);
    }
    if (row !== null) {
      const result = await ws.mutate('owner', workId, { commandId: `overwrite-${++step}`, expected: saved.expected,
        patch: { cells: [{ sheetId: 'sheet1', row, column, value: 99 }] } });
      assert.equal(result.status, 'proposed', `${label}: fresh agent cannot overwrite moved blank style`);
      assert.equal((await ws.get('owner', workId)).proposals.at(-1).reason, 'human_edit');
    }
  };
  try {
    let { view } = session;
    const workbook = view.api.getActiveWorkbook(), sheet = workbook.getSheetBySheetId('sheet1');
    assert.deepEqual(view.handle.formatEdits(), {}); assert.equal(view.edits, 0);
    assert.ok(cellStyle(view.handle.save(), 0, 1, 'automatic').n.pattern);
    assert.equal(cellStyle(view.handle.save(), 0, 2, 'automatic').n.pattern, '0.00%');
    sheet.getRange('D5').setFontWeight('bold'); sheet.getRange('Z200').setFontWeight('bold');
    sheet.deleteRows(199, 1); await checkSave('Parent last-row deletion', 4, 3, [39825]);
    assert.ok(!view.handle.formatEdits().sheet1.includes(2), 'same-sheet automatic date outside the deleted rows stays unowned');
    assert.ok(!(await ws.get('owner', workId)).humanCells.includes('sheet1:0:2'));
    workbook.undo(); await checkSave('undo row deletion', 199, 25);
    workbook.redo(); await checkSave('redo row deletion', 4, 3, [39825]);
    sheet.insertRowsBefore(0, 1); await checkSave('Parent row insertion', 5, 3);
    workbook.undo(); await checkSave('undo row insertion', 4, 3);
    workbook.redo(); await checkSave('redo row insertion', 5, 3);
    sheet.insertColumnsBefore(3, 1); await checkSave('column insertion', 5, 4);
    workbook.undo(); await checkSave('undo column insertion', 5, 3);
    workbook.redo(); await checkSave('redo column insertion', 5, 4);
    sheet.deleteColumns(3, 1); await checkSave('column deletion shifts blank style', 5, 3);
    workbook.undo(); await checkSave('undo column deletion', 5, 4);
    workbook.redo(); await checkSave('redo column deletion', 5, 3);
    sheet.moveRows(sheet.getRange('D6'), 9); await checkSave('row move down', 8, 3);
    workbook.undo(); await checkSave('undo row move', 5, 3);
    workbook.redo(); await checkSave('redo row move', 8, 3);
    sheet.moveColumns(sheet.getRange('D9'), 7); await checkSave('column move right', 8, 6);
    workbook.undo(); await checkSave('undo column move', 8, 3);
    workbook.redo(); await checkSave('redo column move', 8, 6);
    sheet.getRange('Z100').setFontWeight('bold');
    sheet.deleteColumns(25, 1); await checkSave('last-column deletion', 8, 6, [19825]);
    workbook.undo(); await checkSave('undo last-column deletion', 99, 25);
    workbook.redo(); await checkSave('redo last-column deletion', 8, 6, [19825]);
    await view.handle.exportCsv();
    const calculated = view.handle.save();
    assert.equal(calculated.sheets.sheet1.cellData[1][0].v, 1);
    assert.equal(calculated.sheets.sheet1.cellData[1][1].f, '=A2+1');
    assert.equal(calculated.sheets.sheet1.cellData[1][1].v, 2);
    assert.equal(calculated.sheets.sheet1.cellData[8][0].v, 7);
    assert.equal(calculated.sheets.sheet1.cellData[8][1].f, '=A9*3');
    assert.equal(calculated.sheets.sheet1.cellData[8][1].v, 21);
    await session.close(); session = null;
    ws = new Workspace(new FileFixtureStore(path)); session = await open(); view = session.view;
    assert.equal(view.edits, 0); assert.deepEqual(view.handle.formatEdits(), {});
    const reopened = view.api.getActiveWorkbook().getSheetBySheetId('sheet1');
    reopened.moveRows(reopened.getRange('G9'), 5);
    await checkSave('cold-open saved style moves up without local history', 5, 6);
    reopened.moveColumns(reopened.getRange('G6'), 3);
    await checkSave('column move left', 5, 3);
    assert.ok(!view.handle.formatEdits().sheet1.includes(202), 'unmoved calculated date is not adopted by unrelated moves after reopen');
    await view.handle.exportCsv();
    const moved = view.handle.save().sheets.sheet1.cellData;
    assert.equal(moved[5][0].v, 7); assert.equal(moved[5][1].f, '=A6*3'); assert.equal(moved[5][1].v, 21);
    for (const column of [1, 2]) {
      const saved = await ws.get('owner', workId);
      assert.equal((await ws.mutate('owner', workId, { commandId: `automatic-${column}`, expected: saved.expected,
        patch: { cells: [{ sheetId: 'automatic', row: 0, column, value: null, formula: column === 1 ? '=TODAY()+1' : '=A1*2' }] } })).status, 'applied');
    }
    assert.equal(await ws.claim('owner'), null);
  } finally { if (session) await session.close(); }
});
