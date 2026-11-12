// Actual installed Univer SDK; file persistence fixture, no browser or paid call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from '../../workagent-server/src/workspace.mjs';
import { initialState } from '../../workagent-server/src/store.mjs';
import { FileFixtureStore } from '../../workagent-server/tests/support/file-fixture.mjs';
import { DraftFence, isHumanSheetMutation, pendingCell } from '../src/drafts.ts';
// Resolve preset-owned plugins through their installed dependency graph. Use one
// CJS SDK instance throughout: mixing its ESM/CJS facades would split registration.
const require = createRequire(import.meta.resolve('@univerjs/preset-sheets-core'));
const { Univer, LocaleType, RichTextValue } = require('@univerjs/core');
const { FUniver } = require('@univerjs/core/facade');
const { UniverSheetsPlugin } = require('@univerjs/sheets');
require('@univerjs/sheets/facade');
function native(book) {
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: {} } });
  univer.registerPlugin(UniverSheetsPlugin);
  const api = FUniver.newAPI(univer);
  return { univer, api, book: api.createWorkbook(book) };
}
test('native Univer values/formulas survive authoritative file-fixture save/reopen and stale agent proposal', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'workagent-native-')), 'workspace.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const ws = new Workspace(new FileFixtureStore(path));
  const { workId } = await ws.command('owner', { commandId: 'start', kind: 'start', text: 'Synthetic native edit fixture', sourceIds: [] });
  const read = await ws.get('owner', workId), first = native(read.book);
  let events = 0;
  const listener = first.api.addEvent(first.api.Event.CommandExecuted, event => { if (event.id === 'sheet.mutation.set-range-values') events++; });
  let saved;
  try {
    const sheet = first.book.getActiveSheet();
    sheet.getRange('A1').setValue(7);
    sheet.getRange('B1').setValue('=A1*2');
    sheet.getRange('C1').setValue('Human correction');
    assert.ok(events >= 3);
    saved = first.book.save();
    assert.equal(saved.sheets.sheet1.cellData[0][1].f, '=A1*2');
    await ws.save('owner', workId, { commandId: 'save', book: saved, contentRevision: read.contentRevision, permissionRevision: read.expected.permissionRevision });
  } finally { listener.dispose(); first.univer.dispose(); }
  const reopened = new Workspace(new FileFixtureStore(path));
  const proposal = await reopened.mutate('owner', workId, { commandId: 'agent', expected: read.expected, patch: { cells: [{ sheetId: 'sheet1', row: 0, column: 0, value: 99 }] } });
  assert.equal(proposal.status, 'proposed');
  const second = native((await reopened.get('owner', workId)).book);
  try {
    const snapshot = second.book.save();
    assert.equal(snapshot.sheets.sheet1.cellData[0][0].v, 7);
    assert.equal(snapshot.sheets.sheet1.cellData[0][1].f, '=A1*2');
    assert.equal(snapshot.sheets.sheet1.cellData[0][2].v, 'Human correction');
  } finally { second.univer.dispose(); }
});
test('draft fence rejects delayed open/reload after typing or later navigation', () => {
  const fence = new DraftFence();
  const delayedOpen = fence.request(); fence.edit();
  assert.equal(fence.current(delayedOpen), false);
  const delayedReload = fence.request(); const latestOpen = fence.request();
  assert.equal(fence.current(delayedReload), false);
  assert.equal(fence.current(latestOpen), true);
});
for (const options of [{ fromFormula: true }, { applyFormulaCalculationResult: true }, { fromFormula: true, applyFormulaCalculationResult: true }]) {
  test(`native formula mutation ${JSON.stringify(options)} leaves agent revision eligible; human edits fence it`, async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'workagent-formula-')), 'workspace.json');
    await writeFile(path, JSON.stringify(initialState('owner')));
    const ws = new Workspace(new FileFixtureStore(path));
    const { workId } = await ws.command('owner', { commandId: 'start', kind: 'start', text: 'Formula fixture', sourceIds: [] });
    const initial = await ws.get('owner', workId);
    initial.book.sheets.sheet1.cellData = { 0: { 0: { v: 3 }, 1: { f: '=A1*2' } } };
    const editor = native(initial.book), fence = new DraftFence(); let drafts = 0, observed;
    const listener = editor.api.addEvent(editor.api.Event.CommandExecuted, event => {
      if (event.id === 'sheet.mutation.set-range-values') observed = event;
      if (isHumanSheetMutation(event, false)) { drafts++; fence.edit(); }
    });
    try {
      const incoming = fence.request();
      // Execute the actual installed mutation with the options used by its formula controller.
      await editor.api.executeCommand('sheet.mutation.set-range-values', { unitId: workId, subUnitId: 'sheet1', cellValue: { 0: { 1: { v: 6 } } } }, options);
      assert.deepEqual(observed.options, options);
      assert.equal(editor.book.save().sheets.sheet1.cellData[0][1].v, 6);
      assert.equal(drafts, 0, 'automatic formula results must not create a human draft');
      const applied = await ws.mutate('owner', workId, { commandId: 'agent', expected: initial.expected, patch: { cells: [{ sheetId: 'sheet1', row: 1, column: 0, value: 9 }] } });
      assert.equal(applied.status, 'applied');
      assert.equal(fence.current(incoming), true, 'agent revision can still replace the editor');
      editor.book.getActiveSheet().getRange('A1').setValue(7);
      assert.equal(drafts, 1); assert.equal(fence.current(incoming), false);
      const afterValue = fence.request();
      editor.book.getActiveSheet().getRange('B1').setValue('=A1*3');
      assert.equal(drafts, 2); assert.equal(fence.current(afterValue), false);
      assert.equal(isHumanSheetMutation(observed, true), false, 'active editing uses the pending-cell path');
    } finally { listener.dispose(); editor.univer.dispose(); }
  });
}
test('native rich text and unfinished formula recovery serialize without mutating the saved workbook', () => {
  const book = { id: 'draft', sheets: { s: { cellData: { 0: { 0: { v: 8 } } } } } };
  const value = RichTextValue.create({ id: 'edit', body: { dataStream: '=A1*3\r\n' } });
  const draft = pendingCell(book, 's', 0, 0, value.toPlainText(), value.getData());
  assert.equal(JSON.parse(JSON.stringify(draft)).sheets.s.cellData[0][0].f, '=A1*3');
  assert.equal(book.sheets.s.cellData[0][0].v, 8);
  const text = RichTextValue.create({ id: 'edit', body: { dataStream: 'Pending correction\r\n' } });
  const recovery = pendingCell(book, 's', 0, 0, text.toPlainText(), text.getData());
  assert.equal(recovery.sheets.s.cellData[0][0].p.body.dataStream, 'Pending correction\r\n');
});
