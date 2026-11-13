// Deterministic route/child fixtures: no DB, LibreOffice, browser or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { PdfExchange, validatePdfDocument, pdfBytes, PDF_BYTES } from '../src/pdf-exchange.mjs';
import { PdfWorker, sandboxArgs, namespaceIdentity, collectChild } from '../src/pdf-worker.mjs';
import { PostgresStore, initialState } from '../src/store.mjs';
import { createHandler } from '../src/http.mjs';
const bytes = Buffer.from('%PDF-1.7\nfixture only\n%%EOF\n'), result = { base64: bytes.toString('base64') };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
function fixture() {
  const state = initialState('owner'), document = blankDocument('doc', 'Current.docx', '<script> & <w:t> literal 雪 🌍\nGuests: 40 Volunteers: 5 00120 Noor Readiness confirmed.\n');
  state.works.doc = { id: 'doc', kind: 'document', document, contentRevision: 1 };
  let calls = [];
  const workspace = { store: { read: async fn => structuredClone(await fn(structuredClone(state))), transaction: () => assert.fail('PDF must not write') } };
  const worker = { run: async input => { calls.push(input); return result; } };
  return { state, document, calls, workspace, worker, pdf: new PdfExchange({ workspace, worker }), input: { workId: 'doc', contentRevision: 1, document } };
}
test('PDF exports exactly submitted rich/Unicode/empty native snapshot without mutation or writes', async () => {
  const f = fixture(); f.input.document = structuredClone(f.document); f.input.document.title = 'Unsaved.pdf';
  f.input.document.body.textRuns = [{ st: 0, ed: 8, ts: { bl: 1, it: 1, ul: { s: 1 }, fs: 17.5, cl: { rgb: '#224466' } } }];
  const before = structuredClone(f.state), submitted = structuredClone(f.input);
  const exported = await f.pdf.export('owner', f.input);
  assert.deepEqual(f.calls[0], { op: 'export', document: f.input.document }); assert.equal(exported.filename, 'Unsaved.pdf');
  assert.deepEqual(f.input, submitted); assert.deepEqual(f.state, before); assert.deepEqual(pdfBytes(exported), bytes);
  assert.match(exported.warnings.join(' '), /Fonts may be substituted/);
  for (const text of ['', '\n\n', 'page '.repeat(20000)]) validatePdfDocument(blankDocument('doc', 'text', text));
});
test('nested foreign structures, unsupported formatting, raw Office and wrong identity/kind refuse before worker', async () => {
  const f = fixture();
  for (const edit of [d => d.sheets = {}, d => d.body.tables = [{}], d => d.body.customRanges = [{}], d => d.documentStyle.textStyle = { st: { s: 1 } }, d => d.documentStyle.defaultParagraphStyle = { keepNext: 1 }, d => d.documentStyle.autoHyphenation = 0, d => d.documentStyle.renderConfig = { vertexAngle: 45 }, d => d.documentStyle.renderConfig = { background: { rgb: '#fff' } }, d => d.body.textRuns = [{ st: 0, ed: 1, ts: { fs: 12.3 } }], d => d.id = 'other']) {
    const input = structuredClone(f.input); edit(input.document); await assert.rejects(f.pdf.export('owner', input));
  }
  for (const input of [null, [], { ...f.input, base64: 'UEs=' }, { ...f.input, contentRevision: undefined }]) await assert.rejects(f.pdf.export('owner', input), /invalid_pdf_input/);
  f.state.works.doc.kind = 'sheet'; await assert.rejects(f.pdf.export('owner', f.input), /document_required/); assert.equal(f.calls.length, 0);
});
test('access, permission revision, saved work changes and cancellation fence export', async () => {
  const f = fixture(); await assert.rejects(f.pdf.export('other', f.input), /access_denied/); assert.equal(f.calls.length, 0);
  for (const field of ['permissionRevision', 'contentRevision', 'enabled']) {
    const g = fixture(); g.worker.run = async () => { if (field === 'contentRevision') g.state.works.doc.contentRevision++; else if (field === 'enabled') g.state.enabled = false; else g.state.permissionRevision++; return result; };
    await assert.rejects(g.pdf.export('owner', g.input), /access_changed|pdf_work_changed|access_denied/);
  }
  f.state.works.doc.contentRevision++; await assert.rejects(f.pdf.export('owner', f.input), /pdf_work_changed/);
  const g = fixture(), abort = new AbortController(); abort.abort(); await assert.rejects(g.pdf.export('owner', g.input, { signal: abort.signal }), /pdf_export_cancelled/); assert.equal(g.calls.length, 0);
});
test('Postgres read seam issues only SELECT and never persists callback mutation (query fixture)', async () => {
  const calls = [], row = initialState('owner');
  const store = new PostgresStore({ query: async (...args) => { calls.push(args); return { rows: [{ data: structuredClone(row) }] }; } }, 'owner');
  assert.equal(await store.read(s => { s.enabled = false; return s.owner; }), 'owner'); assert.equal(row.enabled, true);
  assert.equal(calls.length, 1); assert.match(calls[0][0], /^SELECT /); assert.doesNotMatch(calls[0][0], /FOR UPDATE/);
});
test('HTTP auth/origin/body fences, export-only route and disconnect abort', async () => {
  const f = fixture(), origin = 'https://private.test', token = 'synthetic-test-token-at-least-32-characters';
  const handler = createHandler({ ...f, owner: 'owner', origin, token, clientRoot: '/tmp', onCommand: () => assert.fail('no model') });
  async function req({ path = '/api/exchange/pdf/export', auth = true, from = origin, type = 'application/json', payload = JSON.stringify(f.input), disconnect = false } = {}) {
    const request = Readable.from([Buffer.from(payload)]); Object.assign(request, { url: path, method: 'POST', headers: { origin: from, 'content-type': type, ...(auth ? { authorization: `Bearer ${token}` } : {}) } });
    const res = new EventEmitter(); Object.assign(res, { setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = body; this.writableEnded = true; } });
    const operation = handler(request, res);
    if (disconnect) { await new Promise(setImmediate); res.destroyed = true; res.emit('close'); }
    await operation; return res;
  }
  assert.equal((await req({ auth: false })).status, 401); assert.equal((await req({ from: 'https://evil.test' })).status, 403);
  assert.equal((await req({ type: 'text/plain' })).status, 415); assert.equal((await req({ payload: '{' })).status, 400);
  assert.equal((await req({ payload: ' '.repeat(4_500_001) })).status, 413);
  assert.equal((await req({ path: '/api/exchange/pdf/import' })).status, 404);
  assert.equal((await req()).status, 200); assert.equal(f.calls.length, 1);
  let signal;
  f.worker.run = async (input, options) => { signal = options.signal; await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return result; };
  await req({ disconnect: true }); assert.equal(signal.aborted, true);
});
test('namespace mount/environment allowlist and identity use actual actor; unavailable config fails closed', async () => {
  const args = sandboxArgs('/dedicated/venv');
  assert.deepEqual(args.filter((x,i) => args[i-1] === '--ro-bind'), ['/usr', '/etc/fonts', '/etc/libreoffice', '/dedicated/venv', new URL('../../../services/workagent-execution/docx/codec.py', import.meta.url).pathname, new URL('../../../services/workagent-execution/pdf/render.py', import.meta.url).pathname]);
  for (const flag of ['--unshare-all', '--new-session', '--die-with-parent', '--clearenv']) assert.ok(args.includes(flag));
  assert.ok(!args.includes('--share-net')); assert.ok(!args.includes('/etc')); assert.ok(!args.includes('/home'));
  assert.match(namespaceIdentity(2345, 3456)[0], /worker:x:2345:3456/); assert.match(namespaceIdentity()[0], new RegExp(`:${process.getuid()}:${process.getgid()}:`));
  for (const venv of [undefined, 'relative', '/not-present-pdf-venv']) {
    const worker = new PdfWorker({ venv }); await assert.rejects(worker.run({ op: 'export', document: fixture().document }), /pdf_.*unavailable/); assert.equal(worker.active, false);
  }
});
function child(script) { return spawn('/usr/bin/python3', ['-c', script], { detached: true, env: {}, stdio: ['pipe', 'pipe', 'pipe'] }); }
for (const [code,status] of [['pdf_fonts_unavailable',503],['pdf_unsupported_text',400],['pdf_missing_glyph',400]]) test(`renderer ${code} remains a typed visible refusal`, async()=>{
  await assert.rejects(collectChild(child(`print('{"error":"${code}"}');raise SystemExit(1)`),''), error=>error.code===code && error.status===status);
});
for (const [name, script, error] of [
  ['nonzero', `import json,sys;print(json.dumps({'error':'pdf_render_failed'}));sys.exit(1)`, /pdf_render_failed/],
  ['invalid JSON', `print('oops')`, /pdf_sandbox_or_renderer_unavailable/],
  ['invalid PDF', `import json;print(json.dumps({'base64':'YWJj'}))`, /pdf_invalid_worker_output/],
  ['oversized stdout', `import sys,time;print('x'*10000,flush=True);time.sleep(10)`, /pdf_worker_output_limit/],
  ['oversized stderr', `import sys,time;print('x'*20000,file=sys.stderr,flush=True);time.sleep(10)`, /pdf_worker_stderr_limit/],
]) test('real child failure: ' + name, async () => { await assert.rejects(collectChild(child(script), '{}', { timeoutMs: 1500, outputLimit: 1000 }), error); });
test('output envelope rejects incomplete/oversized/noncanonical PDF bytes', () => {
  for (const base64 of ['!', Buffer.from('%PDF-1.7\nincomplete').toString('base64'), 'A'.repeat(Math.ceil(PDF_BYTES / 3) * 4 + 4)]) assert.throws(() => pdfBytes({ base64 }), /pdf_invalid_worker_output/);
});
for (const mode of ['timeout', 'disconnect', 'oversize']) test(`real process group and descendant terminated on ${mode}`, async () => {
  const process = child("import subprocess,time; c=subprocess.Popen(['/usr/bin/python3','-c','import time;time.sleep(10)']);print(c.pid,flush=True);time.sleep(10)");
  let pid; process.stdout.once('data', data => { pid = Number(data.toString().trim()); });
  const controller = new AbortController(), start = Date.now();
  const promise = collectChild(process, '{}', { signal: controller.signal, timeoutMs: 1500, outputLimit: mode === 'oversize' ? 1 : 1000 });
  if (mode === 'disconnect') process.stdout.once('data', () => controller.abort());
  await assert.rejects(promise, /pdf_worker_timeout|pdf_export_cancelled|pdf_worker_output_limit/); assert.ok(Date.now() - start < 2500); assert.ok(pid);
  let status = ''; for (let attempt = 0; attempt < 50; attempt++) { try { status = await readFile(`/proc/${pid}/status`, 'utf8'); } catch (e) { assert.ok(['ENOENT', 'ESRCH'].includes(e.code)); status = ''; } if (!status || /State:\s+Z/.test(status)) break; await new Promise(r => setTimeout(r, 10)); }
  if (status) assert.match(status, /State:\s+Z/);
});
