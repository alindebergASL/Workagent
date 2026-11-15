import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { createSimulatedGoogleAdapter, GOOGLE_SCOPES } from '../src/google-adapter.mjs';
import { createGoogleSimulator, syntheticSheet } from './support/google-simulator.mjs';
const ranges = [{ sheetTitle: 'Inputs', range: 'A1:E2' }, { sheetTitle: "Team's notes", range: 'A1:B2' }];
const input = { spreadsheetId: 'synthetic_sheet', ranges, previewId: 'preview' };
const document = () => blankDocument('native_doc', 'Synthetic delivery', 'Plain text 🦉\nSecond line');
function journal(onRecord) {
  const entries = [], operations = new Set();
  return { entries, async reserve(e) { assert.equal(operations.has(e.operationId), false, 'logical operation must not be replayed'); operations.add(e.operationId); entries.push(structuredClone(e)); }, async record(e) { entries.push(structuredClone(e)); await onRecord?.(e); } };
}
const fails = (code, outcome) => e => { assert.equal(e.code, code); if (outcome) assert.equal(e.outcome, outcome); return true; };

test('Google adapter through a real loopback HTTP simulator (requires listen permission)', async t => {
  const sim = createGoogleSimulator();
  // EPERM is a real failed prerequisite, never a skipped/pass fake-fetch replacement.
  const origin = await sim.start();
  t.after(() => sim.close());
  const make = (credentials = sim.issue(), options = {}) => createSimulatedGoogleAdapter({ origin, credentials, ...options });
  const check = async (name, fn) => t.test(name, async () => {
    sim.events.length = 0; sim.faults.length = 0; sim.files.clear();
    sim.files.set('synthetic_sheet', { type: 'sheet', permissions: new Map([['alice', 'writer']]), data: syntheticSheet() });
    for (const account of sim.accounts.values()) { account.revoked = false; account.scopes = new Set(Object.values(GOOGLE_SCOPES)); }
    await fn();
  });
  const raw = (path, credentials, body, method = body ? 'POST' : 'GET') => fetch(origin + path, { method, redirect: 'manual', headers: { authorization: `Bearer ${credentials.accessToken}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const writes = () => sim.events.filter(e => e.method === 'POST' && e.path !== '/token');
  const docs = () => [...sim.files.values()].filter(f => f.type === 'doc');
  try {
    await check('bounded multi-tab typed import makes exactly one read and no adoption/write', async () => {
      const a = make(), result = await a.previewSheet(input);
      assert.deepEqual(result.book.sheets.google_0.cellData[0], { 0: { v: '0012', t: 1 }, 1: { v: 12.5, t: 2 }, 2: { v: false, t: 3 }, 4: { v: '=1+1', t: 1 } });
      assert.equal(result.book.sheets.google_7.cellData[0][0].v, 'second tab');
      assert.equal(result.provenance.adopted, false); assert.equal(result.provenance.synthetic, true); assert.equal(result.provenance.actualGoogleAccount, false);
      assert.equal(sim.events.length, 1); assert.equal(writes().length, 0);
    });
    await check('independent HTTP oracle: get default omits cells, includeGridData requests cells', async () => {
      const c = sim.issue(); const metadata = await (await raw('/v4/spreadsheets/synthetic_sheet', c)).json();
      assert.equal(metadata.sheets[0].data, undefined);
      const full = await (await raw('/v4/spreadsheets/synthetic_sheet?includeGridData=true', c)).json();
      assert.equal(full.sheets[0].data[0].rowData[0].values[1].userEnteredValue.numberValue, 12.5);
    });
    await check('server-side expiry triggers exactly one refresh; missing token sends nothing', async () => {
      const c = sim.issue(); sim.tokens.get(c.accessToken).expiresAt = 0;
      await make(c).previewSheet(input);
      assert.deepEqual(sim.events.map(e => [e.path, e.status]), [['/v4/spreadsheets/synthetic_sheet', 401], ['/token', 200], ['/v4/spreadsheets/synthetic_sheet', 200]]);
      const count = sim.events.length; await assert.rejects(make({}).previewSheet(input), fails('google_token_missing')); assert.equal(sim.events.length, count);
    });
    await check('revoked refresh and repeated 401 never spin', async () => {
      const c = sim.issue('alice', { expired: true }); sim.refreshTokens.get(c.refreshToken).revoked = true;
      await assert.rejects(make(c).previewSheet(input), fails('google_invalid_grant', 'refused')); assert.deepEqual(sim.events.map(e => e.path), ['/token']);
      sim.events.length = 0; const next = sim.issue(); sim.accounts.get('alice').revoked = true;
      await assert.rejects(make(next).previewSheet(input), fails('google_invalid_grant', 'refused')); assert.equal(sim.events.filter(e => e.path === '/token').length, 1); assert.equal(writes().length, 0);
    });
    await check('insufficient scope, cross-account access, 404 and permission revocation are per call', async () => {
      await assert.rejects(make(sim.issue('alice', { scopes: [GOOGLE_SCOPES.docs] })).previewSheet(input), fails('google_forbidden'));
      await assert.rejects(make(sim.issue('bob')).previewSheet(input), fails('google_forbidden'));
      const a = make(); await assert.rejects(a.previewSheet({ ...input, spreadsheetId: 'missing' }), fails('google_not_found'));
      await a.previewSheet(input); sim.files.get('synthetic_sheet').permissions.delete('alice');
      await assert.rejects(a.previewSheet(input), fails('google_forbidden')); assert.equal(writes().length, 0);
    });
    await check('formulas and malformed grid are refused without using cached values', async () => {
      const cell = sim.files.get('synthetic_sheet').data.sheets[0].data[0].rowData[0].values[0];
      cell.userEnteredValue = { formulaValue: '=1+1' }; cell.effectiveValue = { numberValue: 2 };
      await assert.rejects(make().previewSheet(input), fails('google_unsupported_sheet')); assert.equal(writes().length, 0);
    });
    await check('read 429/503/disconnect are bounded and never silently retried', async () => {
      for (const [fault, code, outcome] of [[{ status: 429 }, 'google_rate_limited', 'refused'], [{ status: 503 }, 'google_service_error', 'transient'], [{ disconnectBefore: true }, 'google_transport_failed', 'transient']]) {
        const count = sim.events.length; sim.faults.push({ path: '/v4/spreadsheets/synthetic_sheet', ...fault });
        await assert.rejects(make().previewSheet(input), fails(code, outcome)); assert.equal(sim.events.length, count + 1);
      }
    });
    await check('redirect and oversized read response fail closed with no second host request', async () => {
      sim.faults.push({ path: '/v4/spreadsheets/synthetic_sheet', status: 302, location: 'http://127.0.0.1:1/should-not-run' });
      await assert.rejects(make().previewSheet(input), fails('google_redirect_refused')); assert.equal(sim.events.length, 1);
      sim.faults.push({ path: '/v4/spreadsheets/synthetic_sheet', oversize: 3000 });
      await assert.rejects(make(undefined, { maxResponseBytes: 1024 }).previewSheet(input), fails('google_response_too_large')); assert.equal(sim.events.length, 2);
    });
    await check('documented t.0 survives explicit Docs create/read/insert/readback, with no duplicate replay', async () => {
      // Independent expected literal from https://developers.google.com/workspace/docs/api/samples/output-json
      const returnedTabIds = [], a = make(), j = journal(e => {
        if (e.stage === 'created') for (let i = 0; i < 2; i++) sim.faults.push({ path: `/v1/documents/${e.documentId}`, response: data => { returnedTabIds.push(data.tabs[0].tabProperties.tabId); return data; } });
      });
      const plan = a.prepareDocDelivery(document()); assert.equal(sim.events.length, 0);
      const receipt = await a.executeDocDelivery(plan, { operationId: 'delivery_one', recordEffect: j });
      assert.equal(receipt.outcome, 'verified'); assert.equal(receipt.provenance.mode, 'simulation'); assert.equal(receipt.url, undefined);
      assert.equal(docs().length, 1); assert.equal(docs()[0].text, plan.text); assert.equal(receipt.documentId, docs()[0].id);
      assert.notEqual(receipt.requiredRevisionId, receipt.readbackRevisionId); assert.equal(receipt.readbackRevisionId, docs()[0].revision);
      assert.deepEqual(returnedTabIds, ['t.0', 't.0']); assert.equal(receipt.tabId, 't.0');
      assert.deepEqual(writes()[1].insertTabIds, ['t.0']);
      assert.deepEqual(sim.events.map(e => e.method), ['POST', 'GET', 'POST', 'GET']);
      assert.deepEqual(j.entries.map(e => e.stage), ['prepared', 'create_dispatching', 'created', 'update_dispatching', 'verified']);
      await assert.rejects(a.executeDocDelivery(plan, { operationId: 'delivery_one', recordEffect: j })); assert.equal(writes().length, 2);
    });
    await check('independent oracle: create ignores content; batch stale is 400, validation atomic, reader cannot edit', async () => {
      const c = sim.issue(); const created = await (await raw('/v1/documents', c, { title: 'Oracle', body: { content: 'ignored' } })).json();
      const file = sim.files.get(created.documentId); assert.equal(file.text, '');
      assert.equal(file.tabId, 't.0');
      const request = { insertText: { location: { index: 1, tabId: file.tabId }, text: 'A' } };
      const path = `/v1/documents/${file.id}:batchUpdate`;
      const repairedId = { insertText: { ...request.insertText, location: { index: 1, tabId: 't_0' } } };
      assert.equal((await raw(path, c, { requests: [repairedId], writeControl: { requiredRevisionId: file.revision } })).status, 400); assert.equal(file.text, '');
      assert.equal((await raw(path, c, { requests: [request], writeControl: { requiredRevisionId: 'old' } })).status, 400);
      assert.equal((await raw(path, c, { requests: [request, { deleteContentRange: {} }], writeControl: { requiredRevisionId: file.revision } })).status, 400); assert.equal(file.text, '');
      file.permissions.set('bob', 'reader'); const bob = sim.issue('bob');
      const read = await (await raw(`/v1/documents/${file.id}?includeTabsContent=true`, bob)).json(); assert.equal(read.revisionId, undefined); assert.ok(read.tabs); assert.equal(read.body, undefined);
      assert.equal((await raw(path, bob, { requests: [request], writeControl: { requiredRevisionId: file.revision } })).status, 403); assert.equal(file.text, '');
    });
    await check('stale revision refuses update; created blank doc remains explicit partial effect', async () => {
      const a = make(); const j = journal(e => { if (e.stage === 'update_dispatching') sim.files.get(e.documentId).revision = 'opaque_changed_revision'; });
      await assert.rejects(a.executeDocDelivery(a.prepareDocDelivery(document()), { recordEffect: j }), e => { assert.equal(e.status, 400); assert.equal(e.callOutcome, 'refused'); assert.equal(e.outcome, 'unknown'); assert.ok(e.documentId); return true; });
      assert.equal(docs()[0].text, ''); assert.equal(writes().length, 2); assert.equal(sim.events.length, 3);
    });
    await check('scope and editor permission revoked between read and write are checked again', async () => {
      for (const scopeRevoked of [false, true]) {
        const a = make(); const start = writes().length;
        const j = journal(e => { if (e.stage === 'update_dispatching') { if (scopeRevoked) sim.accounts.get('alice').scopes.delete(GOOGLE_SCOPES.docs); else sim.files.get(e.documentId).permissions.set('alice', 'reader'); } });
        await assert.rejects(a.executeDocDelivery(a.prepareDocDelivery(document()), { recordEffect: j }), e => { assert.equal(e.code, 'google_forbidden'); assert.equal(e.callOutcome, 'refused'); assert.equal(e.outcome, 'unknown'); return true; });
        assert.equal(writes().length, start + 2); assert.equal(docs().at(-1).text, '');
      }
    });
    await check('disconnect after create preserves unknown request identity without replay', async () => {
      const a = make(), j = journal(); sim.faults.push({ path: '/v1/documents', disconnectAfter: true });
      await assert.rejects(a.executeDocDelivery(a.prepareDocDelivery(document()), { operationId: 'lost_create', recordEffect: j }), e => { assert.equal(e.outcome, 'unknown'); assert.equal(e.documentId, undefined); assert.equal(e.operationId, 'lost_create'); assert.equal(e.requestIds.length, 1); return true; });
      assert.equal(docs().length, 1); assert.equal(writes().length, 1); assert.equal(j.entries.at(-1).outcome, 'unknown');
    });
    await check('disconnect after update preserves known doc and unknown effect; no readback or replay', async () => {
      const a = make(); const j = journal(e => { if (e.stage === 'created') sim.faults.push({ path: `/v1/documents/${e.documentId}:batchUpdate`, disconnectAfter: true }); });
      await assert.rejects(a.executeDocDelivery(a.prepareDocDelivery(document()), { recordEffect: j }), e => { assert.equal(e.outcome, 'unknown'); assert.equal(e.documentId, docs()[0].id); assert.equal(e.requestIds.length, 2); return true; });
      assert.equal(docs()[0].text, 'Plain text 🦉\nSecond line'); assert.equal(writes().length, 2); assert.equal(sim.events.length, 3);
    });
    await check('503 write and failed readback cannot claim refusal/success or retry create', async () => {
      const a = make(); sim.faults.push({ path: '/v1/documents', status: 503 });
      await assert.rejects(a.executeDocDelivery(a.prepareDocDelivery(document()), { recordEffect: journal() }), fails('google_service_error', 'unknown')); assert.equal(writes().length, 1);
      const j = journal(e => { if (e.stage === 'created') sim.faults.push({ path: `/v1/documents/${e.documentId}:batchUpdate`, after: () => sim.faults.push({ path: `/v1/documents/${e.documentId}`, status: 503 }) }); });
      await assert.rejects(a.executeDocDelivery(a.prepareDocDelivery(document()), { recordEffect: j }), fails('google_service_error', 'unknown')); assert.equal(writes().length, 3); assert.equal(docs().length, 1);
    });
    await check('extra tabs refuse before text update; mismatched readback stays unknown', async () => {
      const a = make(); const j = journal(e => { if (e.stage === 'created') sim.files.get(e.documentId).extraTab = true; });
      await assert.rejects(a.executeDocDelivery(a.prepareDocDelivery(document()), { recordEffect: j }), fails('google_unsupported_document_response', 'unknown')); assert.equal(writes().length, 1);
      const j2 = journal(e => { if (e.stage === 'created') sim.faults.push({ path: `/v1/documents/${e.documentId}:batchUpdate`, after: (_s, file) => { file.text = 'concurrent edit'; } }); });
      await assert.rejects(a.executeDocDelivery(a.prepareDocDelivery(document()), { recordEffect: j2 }), fails('google_readback_mismatch', 'unknown')); assert.equal(writes().length, 3);
    });
    await check('rich input and effect-journal failure send no writes', async () => {
      const a = make(), d = document(); d.body.textRuns = [{ st: 0, ed: 5, ts: { it: 1 } }];
      assert.throws(() => a.prepareDocDelivery(d), fails('google_plain_text_required'));
      const j = journal(() => { throw new Error('synthetic storage unavailable'); });
      await assert.rejects(a.executeDocDelivery(a.prepareDocDelivery(document()), { recordEffect: j })); assert.equal(sim.events.length, 0);
    });
    assert.ok(!JSON.stringify(sim.events).includes('SIMULATED_'), 'request log excludes credentials');
  } finally { await sim.close(); }
});
