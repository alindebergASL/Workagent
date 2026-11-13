import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseCsv, csvWorkbook, serializeCsv, CSV_LIMITS } from '../../../packages/workagent-contract/csv.mjs';
import { validateWorkbook, blankWorkbook } from '../../../packages/workagent-contract/index.mjs';
import { CsvExchange } from '../src/exchange.mjs';
import { OwnedFiles, hashBytes } from '../src/owned-files.mjs';
import { Workspace } from '../src/workspace.mjs';
import { initialState } from '../src/store.mjs';
import { createHandler } from '../src/http.mjs';
import { FileFixtureStore } from './support/file-fixture.mjs';
const parse = s => parseCsv(Buffer.from(s));
const original = Buffer.from('\ufeff__proto__,constructor,identifier,date,notes,formula,flag,empty\r\n"comma, here","quote ""inside""",00120,2026-01-02,"line 1\r\n行 😀",=1+1,true,\r\nshort,row\r\n');
const input = (commandId = 'import') => ({ commandId, filename: '../../陌生.csv', synthetic: true, base64: original.toString('base64') });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'workagent-csv-')), path = join(root, 'state.json');
  await writeFile(path, JSON.stringify(initialState('owner')));
  const store = new FileFixtureStore(path), workspace = new Workspace(store), files = new OwnedFiles(root), exchange = new CsvExchange({ workspace, files });
  return { root, path, store, workspace, files, exchange, state: async () => JSON.parse(await readFile(path, 'utf8')) };
}
test('real UTF-8 bytes: BOM, quoted commas/quotes/CRLF, multiline Unicode, ragged/trailing empty fields stay literal', () => {
  const parsed = parseCsv(original); assert.equal(parsed.encoding, 'UTF-8 with BOM'); assert.equal(parsed.rowCount, 3); assert.equal(parsed.columns, 8); assert.equal(parsed.raggedRows, 1);
  assert.deepEqual(parsed.rows[1], ['comma, here', 'quote "inside"', '00120', '2026-01-02', 'line 1\r\n行 😀', '=1+1', 'true', '']);
  const book = validateWorkbook(csvWorkbook(parsed, 'work', 'Unfamiliar CSV'));
  for (const row of Object.values(book.sheets.sheet1.cellData)) for (const c of Object.values(row)) { assert.equal(c.t, 1); assert.equal(c.f, undefined); assert.equal(c.p, undefined); }
  assert.equal({}.polluted, undefined);
  const exported = serializeCsv(book, 'sheet1'), reparsed = parse(exported.csv);
  assert.equal(exported.neutralized, 1); assert.equal(reparsed.rows[1][5], "'=1+1");
  reparsed.rows[1][5] = '=1+1'; assert.deepEqual(reparsed.rows, parsed.rows);
});
test('clear rejection of malformed, truncated, empty, invalid UTF-8, binary and bounded input', () => {
  for (const text of ['', '\ufeff', 'a,"unfinished', 'a,b"c', '"closed" tail,x', 'a\0b']) assert.throws(() => parse(text));
  assert.throws(() => parseCsv(Buffer.from([0xff, 0xfe, 0x61, 0x00])), /UTF-8/);
  assert.throws(() => parseCsv(Buffer.alloc(CSV_LIMITS.bytes + 1)), /byte/);
  assert.throws(() => parse('a'.repeat(20001)), /field/);
  assert.throws(() => parse(Array(201).fill('x').join(',')), /columns/);
  assert.throws(() => parse('x\n'.repeat(10001)), /rows/);
  assert.throws(() => parse((Array(200).fill('x').join(',') + '\n').repeat(251)), /cells/);
  assert.deepEqual(parse('""').rows, [['']]); assert.deepEqual(parse('a,b,').rows, [['a', 'b', '']]); assert.deepEqual(parse('\n').rows, [['']]);
});
test('selected-sheet values export quotes every text field, neutralizes prefix variants and keeps negative numbers numeric', () => {
  const book = blankWorkbook('work'); book.sheetOrder.push('selected');
  const strings = ['=1', '+SUM(A1)', '-42', '@x', ' \t=1', '\r\n+1', '\u0001-1', '\u200b@x', '0012', '2026-01-01', 'https://example.test', '__proto__'];
  book.sheets.sheet1.cellData = { 0: { 0: { v: 'WRONG SHEET', t: 1 } } };
  book.sheets.selected = { id: 'selected', name: 'Chosen', rowCount: 200, columnCount: 26, cellData: { 0: Object.fromEntries(strings.map((v, i) => [i, { v, t: 1 }])), 1: { 0: { v: -42, t: 2 }, 1: { v: 0, t: 2 }, 2: { v: 1, t: 3 }, 3: { f: '=A9' }, 4: { f: '=1/0', v: '#DIV/0!', t: 1 } } } };
  const exported = serializeCsv(book, 'selected'), rows = parse(exported.csv).rows;
  assert.equal(exported.sheetName, 'Chosen'); assert.equal(exported.neutralized, 8); assert.equal(exported.unknown, 1);
  strings.forEach((v, i) => assert.equal(rows[0][i], i < 8 ? "'" + v : v));
  assert.deepEqual(rows[1].slice(0, 5), ['-42', '0', 'TRUE', '#UNKNOWN!', '#DIV/0!']); assert.match(exported.csv, /\r\n-42,0,/);
  assert.doesNotMatch(exported.csv, /WRONG SHEET/); assert.throws(() => serializeCsv(book, 'missing'));
});
test('preview/import retains exact originals, deduplicates after restart, creates no job and protects imported human cells', async () => {
  const f = await fixture(), before = await f.state();
  const preview = await f.exchange.preview('owner', input()); assert.equal(preview.rows, 3); assert.deepEqual(await f.state(), before);
  const result = await f.exchange.import('owner', input()), w = await f.workspace.get('owner', result.workId);
  assert.equal(w.contentRevision, 1); assert.equal(w.status, 'ready'); assert.equal(Object.keys((await f.state()).jobs).length, 0);
  assert.equal(result.original.hash, hashBytes(original)); assert.equal(result.original.size, original.length); assert.equal(result.original.filename, input().filename);
  const downloaded = await f.exchange.original('owner', result.workId, result.original.id); assert.deepEqual(downloaded.bytes, original);
  const second = new CsvExchange({ workspace: new Workspace(new FileFixtureStore(f.path)), files: new OwnedFiles(f.root) });
  assert.deepEqual(await second.import('owner', input()), result);
  await assert.rejects(() => second.import('owner', { ...input(), filename: 'different.csv' }), /command_conflict/);
  assert.equal(Object.keys((await f.state()).works).length, 1);
  const proposal = await f.workspace.mutate('owner', w.id, { commandId: 'model-patch', expected: w.expected, patch: { cells: [{ sheetId: 'sheet1', row: 1, column: 2, value: 120 }] } });
  assert.equal(proposal.status, 'proposed');
  const book = structuredClone(w.book); book.sheets.sheet1.cellData[1][2] = { v: '00121', t: 1 };
  await f.workspace.save('owner', w.id, { commandId: 'human-save', book, contentRevision: 1, permissionRevision: 1 });
  await assert.rejects(() => f.workspace.save('owner', w.id, { commandId: 'stale', book: w.book, contentRevision: 1, permissionRevision: 1 }), /save_conflict/);
  assert.deepEqual(await second.import('owner', input()), result); assert.equal((await f.workspace.get('owner', w.id)).book.sheets.sheet1.cellData[1][2].v, '00121');
  assert.deepEqual((await second.original('owner', w.id, result.original.id)).bytes, original);
  await f.workspace.command('owner', { commandId: 'continue', kind: 'continue', workId: w.id, expectedIntentRevision: 0, sourceIds: [], text: 'Summarize this sheet' });
  const job = await f.workspace.claim('owner'); assert.equal(job.workId, w.id); assert.equal(job.work.book.sheets.sheet1.cellData[1][2].v, '00121');
});
test('invalid import and denied ownership change no state; revocation during blob write never publishes work', async () => {
  const f = await fixture(), before = await f.state(); let writes = 0;
  const write = f.files.writeOriginal.bind(f.files); f.files.writeOriginal = async (...args) => { writes++; return write(...args); };
  for (const change of [{ base64: Buffer.from('a,"unfinished').toString('base64') }, { base64: '***' }, { synthetic: false }, { path: '/tmp/secret' }]) await assert.rejects(() => f.exchange.import('owner', { ...input(), ...change }));
  await assert.rejects(() => f.exchange.import('other', input()), /access_denied/); assert.equal(writes, 0); assert.deepEqual(await f.state(), before);
  f.files.writeOriginal = async (...args) => { const result = await write(...args); await f.store.transaction(s => { s.enabled = false; s.permissionRevision++; }); return result; };
  await assert.rejects(() => f.exchange.import('owner', input()), /access_denied/); assert.equal(Object.keys((await f.state()).works).length, 0);
});
test('new import isolates existing inflight work and owner-scoped original read is reauthorized after IO', async () => {
  const f = await fixture(); const old = await f.workspace.command('owner', { commandId: 'start', kind: 'start', text: 'Existing human work', sourceIds: [] }); await f.workspace.claim('owner');
  const before = await f.workspace.get('owner', old.workId), job = structuredClone((await f.state()).jobs.start);
  const result = await f.exchange.import('owner', input()); const after = await f.workspace.get('owner', old.workId);
  delete before.eventSequence; delete after.eventSequence; assert.deepEqual(after, before); assert.deepEqual((await f.state()).jobs.start, job);
  await assert.rejects(() => f.exchange.original('other', result.workId, result.original.id), /access_denied/);
  await assert.rejects(() => f.exchange.original('owner', old.workId, result.original.id), /source_access_denied/);
  await assert.rejects(() => f.files.readOriginal('other', result.original.hash), /ENOENT/);
  const read = f.files.readOriginal.bind(f.files); f.files.readOriginal = async (...args) => { const bytes = await read(...args); await f.store.transaction(s => { s.enabled = false; }); return bytes; };
  await assert.rejects(() => f.exchange.original('owner', result.workId, result.original.id), /access_denied/);
});
// Real HTTP handler with in-memory request/response streams; no listener/network.
test('HTTP consumer authenticates original download and CSRF-checks imports; importing never wakes model dispatch', async () => {
  const f = await fixture(), token = 'synthetic-test-access-key-at-least-32-characters', origin = 'https://private.example.test'; let wakes = 0;
  const handler = createHandler({ workspace: f.workspace, exchange: f.exchange, owner: 'owner', token, origin, clientRoot: f.root, onCommand: () => { wakes++; } });
  async function request(url, data, authenticated = true, requestOrigin = origin) {
    const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []); Object.assign(req, { url, method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin: requestOrigin, ...(authenticated ? { authorization: `Bearer ${token}` } : {}) } });
    const result = { headers: {} }; const res = { setHeader: (k, v) => { result.headers[k] = v; }, writeHead: (status, headers) => { result.status = status; Object.assign(result.headers, headers); }, end: bytes => { result.body = bytes; } };
    await handler(req, res); return result;
  }
  assert.equal((await request('/api/exchange/csv/import', input(), false)).status, 401);
  assert.equal((await request('/api/exchange/csv/import', input(), true, 'https://evil.test')).status, 403);
  assert.equal((await request('/api/exchange/csv/preview', input())).status, 200);
  const imported = await request('/api/exchange/csv/import', input()); assert.equal(imported.status, 200); const result = JSON.parse(imported.body);
  const path = `/api/work/${result.workId}/original/${result.original.id}`;
  assert.equal((await request(path, null, false)).status, 401); const downloaded = await request(path);
  assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.body, original); assert.match(downloaded.headers['Content-Disposition'], /^attachment;/);
  assert.equal(wakes, 0); assert.equal(Object.keys((await f.state()).jobs).length, 0);
});

test('workbook JSON expansion still obeys the existing four-million bound before publishing state', async () => {
  const f = await fixture(), content = Array(50).fill('\x01'.repeat(19000)).join(','), before = await f.state();
  assert.ok(Buffer.byteLength(content) < CSV_LIMITS.bytes);
  const upload = { ...input(), base64: Buffer.from(content).toString('base64') };
  await assert.rejects(() => f.exchange.preview('owner', upload), /invalid_workbook/);
  await assert.rejects(() => f.exchange.import('owner', upload), /invalid_workbook/);
  assert.deepEqual(await f.state(), before);
});
