// Real loopback sockets and HTTP, actual application/simulator/adapter/store code.
// The PG protocol fixture is explicit; Parent separately qualifies a real database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace.mjs';
import { GoogleExchange } from '../src/google-exchange.mjs';
import { createGoogleSimulator } from '../src/google-simulation.mjs';
import { createServer } from '../src/http.mjs';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { storeFixture, token, peerToken, accounts } from './support/google-integration-fixture.mjs';

test('integrated Google exchange through real app and simulator HTTP (listen permission required)', async t => {
  const pg = storeFixture(), workspace = new Workspace(pg.store, { peers: accounts }), sim = createGoogleSimulator();
  // EPERM remains a failure, never a skipped or fixture-substituted pass.
  const simOrigin = await sim.start(); t.after(() => sim.close());
  const google = new GoogleExchange({ workspace, simulation: true, origin: simOrigin, credentialsFor: account => sim.issue(account) });
  const origin = 'http://127.0.0.1:8310', server = createServer({ workspace, google, owner: 'owner', token, origin, accounts, clientRoot: '/tmp' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => server.drain());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, input, bearer = token) => { const r = await fetch(base + '/api' + path, { method: input ? 'POST' : 'GET', headers: { origin, authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) }); return { status: r.status, value: await r.json() }; };
  const { value: { workId } } = await call('/work/blank', { commandId: 'native', kind: 'document', title: 'Native source' });
  await call('/exchange/google/connection', { commandId: 'connect', account: 'alice', connectionGeneration: 0 });
  const binding = { workId, contentRevision: 1, permissionRevision: 1, connectionGeneration: 1 };
  const sheet = await call('/exchange/google/sheet-preview', { ...binding, spreadsheetId: 'synthetic_sheet', ranges: [{ sheetTitle: 'Inputs', range: 'A1:E2' }] });
  assert.equal(sheet.status, 200); assert.equal((await call('/work')).value.length, 1);
  const adopted = await call('/exchange/google/sheet-adopt', { commandId: 'adopt', previewId: sheet.value.previewId, sourceHash: sheet.value.sourceHash, connectionGeneration: 1 });
  assert.equal(adopted.status, 200); assert.notEqual(adopted.value.workId, workId);
  const doc = await call('/exchange/google/doc-preview', { ...binding, document: blankDocument(workId, 'Unsaved synthetic snapshot', 'Native text 🦉') });
  const input = { operationId: 'deliver', previewId: doc.value.previewId, sourceHash: doc.value.sourceHash, digest: doc.value.plan.digest, connectionGeneration: 1 };
  const delivered = await call('/exchange/google/doc-deliver', input); assert.equal(delivered.status, 200); assert.equal(delivered.value.outcome, 'verified'); assert.equal(delivered.value.tabId, 't.0');
  assert.equal(sim.files.get(delivered.value.documentId).text, 'Native text 🦉');
  assert.deepEqual((await call('/exchange/google/doc-deliver', input)).value, delivered.value);
  assert.equal(sim.events.filter(e => e.method === 'POST').length, 2);
  await workspace.share('owner', workId, { commandId: 'share', peer: 'peer', role: 'editor', accessRevision: 0 });
  assert.equal((await call('/exchange/google/doc-deliver', input, peerToken)).status, 403);
  await call('/exchange/google/connection', { commandId: 'switch', account: 'bob', connectionGeneration: 1 });
  assert.equal((await call('/exchange/google/sheet-preview', { ...binding, connectionGeneration: 2, spreadsheetId: 'synthetic_sheet', ranges: [{ sheetTitle: 'Inputs', range: 'A1:B2' }] })).status, 400);
  assert.equal((await call('/exchange/google/sheet-preview', { ...binding, connectionGeneration: 2, spreadsheetId: 'synthetic_bob_sheet', ranges: [{ sheetTitle: 'Inputs', range: 'A1:B2' }] })).status, 200);
});
