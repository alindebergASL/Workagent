import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankDocument } from '../../../packages/workagent-contract/document.mjs';
import { GoogleExchange, startGoogleSimulation } from '../src/google-exchange.mjs';
import { createHandler } from '../src/http.mjs';
import { integrationFixture, setup, handlerRequest, token, peerToken, accounts, origin } from './support/google-integration-fixture.mjs';
const ranges = [{ sheetTitle: 'Inputs', range: 'A1:E2' }, { sheetTitle: "Team's notes", range: 'A1:B2' }];
const preview = (f, b) => f.exchange.previewDoc('owner', { ...b, document: blankDocument(b.workId, 'Edited unsaved title', 'Current native draft\n雪') });
const delivery = (p, operationId = 'deliver') => ({ operationId, previewId: p.previewId, sourceHash: p.sourceHash, digest: p.plan.digest, connectionGeneration: p.connectionGeneration });
const adopt = p => ({ commandId: 'adopt', previewId: p.previewId, sourceHash: p.sourceHash, connectionGeneration: p.connectionGeneration });
const handler = f => createHandler({ workspace: f.workspace, google: f.exchange, owner: 'owner', token, origin, accounts, clientRoot: '/tmp' });

test('simulation off by default; exact constructor opt-in only, no credentials/listeners or provider traffic', async t => {
  const f = integrationFixture(t);
  for (const simulation of [undefined, false, 'true']) {
    const runtime = await startGoogleSimulation({ workspace: f.workspace, simulation });
    assert.equal((await runtime.exchange.state('owner')).enabled, false); await runtime.close();
  }
  const disabled = new GoogleExchange({ workspace: f.workspace });
  await assert.rejects(disabled.connect('owner', { commandId: 'c', account: 'alice', connectionGeneration: 0 }), /google_simulation_disabled/);
  assert.equal(f.sim.events.length, 0);
});
test('actual HTTP handler → Workspace/PostgresStore transactions → typed two-step Sheets adoption, provenance and duplicate commands', async t => {
  const f = integrationFixture(t), b = await setup(f, 'sheet'), route = handler(f), before = await f.workspace.get('owner', b.workId);
  const response = await handlerRequest(route, '/api/exchange/google/sheet-preview', { input: { ...b, spreadsheetId: 'synthetic_sheet', ranges } });
  assert.equal(response.status, 200); const p = response.value;
  assert.deepEqual(p.book.sheets.google_0.cellData[0][0], { v: '0012', t: 1 }); assert.deepEqual(p.book.sheets.google_0.cellData[0][2], { v: false, t: 3 });
  assert.equal((await f.workspace.list('owner')).length, 1); assert.equal(f.writes().length, 0);
  const result = await handlerRequest(route, '/api/exchange/google/sheet-adopt', { input: adopt(p) }); assert.equal(result.status, 200);
  assert.deepEqual(await f.restart().adoptSheet('owner', adopt(p)), result.value);
  assert.equal((await f.workspace.list('owner')).length, 2);
  assert.deepEqual(await f.workspace.get('owner', b.workId), { ...before, eventSequence: 2 });
  const imported = await f.workspace.get('owner', result.value.workId);
  assert.equal(imported.googleSource.spreadsheetId, 'synthetic_sheet'); assert.equal(imported.googleSource.synthetic, true); assert.deepEqual(imported.googleSource.ranges, ["'Inputs'!A1:E2", "'Team''s notes'!A1:B2"]);
  assert.equal(Object.keys(f.pg.committed().jobs).length, 0);
});
test('two synthetic accounts enforce file ACLs; connection switch/disconnect invalidates immutable previews', async t => {
  const f = integrationFixture(t), b = await setup(f);
  const p = await f.exchange.previewSheet('owner', { ...b, spreadsheetId: 'synthetic_sheet', ranges });
  await f.exchange.connect('owner', { commandId: 'bob', account: 'bob', connectionGeneration: 1 });
  await assert.rejects(f.exchange.adoptSheet('owner', adopt(p)), /google_connection_changed/);
  await assert.rejects(f.exchange.previewSheet('owner', { ...b, connectionGeneration: 2, spreadsheetId: 'synthetic_sheet', ranges }), /google_forbidden/);
  const bob = await f.exchange.previewSheet('owner', { ...b, connectionGeneration: 2, spreadsheetId: 'synthetic_bob_sheet', ranges });
  assert.equal(bob.book.sheets.google_0.cellData[0][0].v, 'BOB-ONLY');
  await f.exchange.connect('owner', { commandId: 'disconnect', account: null, connectionGeneration: 2 });
  await assert.rejects(f.exchange.adoptSheet('owner', adopt(bob)), /google_connection_changed/);
  await f.exchange.connect('owner', { commandId: 'alice-again', account: 'alice', connectionGeneration: 3 });
  await assert.rejects(f.exchange.adoptSheet('owner', adopt(p)), /google_connection_changed/); assert.equal(f.writes().length, 0);
});
test('shared editor direct Google routes deny identity/account spoofing and have no effects', async t => {
  const f = integrationFixture(t), b = await setup(f), route = handler(f);
  await f.workspace.share('owner', b.workId, { commandId: 'share', peer: 'peer', role: 'editor', accessRevision: 0 });
  for (const action of ['state', 'connection', 'sheet-preview', 'sheet-adopt', 'doc-preview', 'doc-deliver']) {
    const result = await handlerRequest(route, `/api/exchange/google/${action}`, { bearer: peerToken, ...(action === 'state' ? {} : { input: { ...b, principal: 'owner', account: 'alice' } }) });
    assert.equal(result.status, 403);
  }
  assert.equal(f.sim.events.length, 0); assert.deepEqual(f.pg.committed().googleSimulation.operations, {});
});
test('Docs preview has no effects; explicit delivery uses exact t.0/revision/readback; restart and alternate command never duplicate', async t => {
  const f = integrationFixture(t), b = await setup(f), p = await preview(f, b), input = delivery(p), route = handler(f);
  assert.equal(f.sim.events.length, 0); assert.equal((await f.workspace.get('owner', b.workId)).document.title, 'Current native work');
  const result = await handlerRequest(route, '/api/exchange/google/doc-deliver', { input }); assert.equal(result.status, 200);
  assert.equal(result.value.outcome, 'verified'); assert.equal(result.value.tabId, 't.0'); assert.equal(result.value.verifiedText, p.plan.text); assert.equal(result.value.url, undefined);
  assert.equal(f.sim.files.get(result.value.documentId).text, p.plan.text);
  assert.deepEqual(await f.restart().deliverDoc('owner', input), result.value);
  assert.deepEqual(await f.restart().deliverDoc('owner', delivery(p, 'different-command')), result.value);
  assert.equal(f.writes().length, 2);
  assert.deepEqual(f.pg.committed().googleSimulation.operations.deliver.history.map(e => e.stage), ['create_dispatching', 'created', 'update_dispatching', 'verified']);
  assert.deepEqual((await f.restart().state('owner', b.workId)).receipts, [result.value]);
  assert.ok(!JSON.stringify(f.pg.committed()).includes('SIMULATED_ACCESS')); assert.ok(!JSON.stringify(result).includes('SIMULATED_'));
});
test('mismatched preview/source/digest, rich input and stale native work refuse before any write', async t => {
  const f = integrationFixture(t), b = await setup(f), p = await preview(f, b);
  for (const changed of [{ sourceHash: 'forged' }, { digest: 'forged' }, { previewId: 'missing' }, { principal: 'owner' }]) await assert.rejects(f.exchange.deliverDoc('owner', { ...delivery(p), ...changed }));
  const rich = blankDocument(b.workId, 'Rich', 'text'); rich.body.textRuns = [{ st: 0, ed: 4, ts: { bl: 1 } }];
  await assert.rejects(f.exchange.previewDoc('owner', { ...b, document: rich }), /google_plain_text_required/);
  await f.workspace.save('owner', b.workId, { commandId: 'save', document: blankDocument(b.workId, 'New saved title', 'changed'), contentRevision: 1, permissionRevision: 1 });
  await assert.rejects(f.exchange.deliverDoc('owner', delivery(p)), /google_work_changed/); assert.equal(f.writes().length, 0);
});
for (const stage of ['reserved', 'create_dispatching', 'created', 'update_dispatching', 'verified']) test(`durable journal failure at ${stage}: no replay across service restart`, async t => {
  const f = integrationFixture(t), b = await setup(f), p = await preview(f, b), input = delivery(p); let failed = false;
  f.pg.fail = s => { if (!failed && s.googleSimulation?.operations.deliver?.receipt.stage === stage) { failed = true; throw new Error('injected journal failure'); } };
  let result;
  if (stage === 'reserved') await assert.rejects(f.exchange.deliverDoc('owner', input), /journal failure/);
  else result = await f.exchange.deliverDoc('owner', input);
  assert.ok(failed); const count = f.writes().length;
  assert.equal(count, ['reserved', 'create_dispatching'].includes(stage) ? 0 : stage === 'verified' ? 2 : 1);
  if (result) { assert.notEqual(result.outcome, 'verified'); assert.deepEqual(await f.restart().deliverDoc('owner', input), result); assert.equal(f.writes().length, count); }
});
for (const target of ['create', 'update', 'final-journal']) test(`unknown ${target} effect retains intent/document/request IDs; exact retry never resends`, async t => {
  const f = integrationFixture(t), b = await setup(f), p = await preview(f, b), input = delivery(p);
  if (target === 'create') f.sim.faults.push({ path: '/v1/documents', disconnectAfter: true });
  else f.sim.faults.push({ path: '/v1/documents', after: (_state, file) => {
    if (target === 'update') f.sim.faults.push({ path: `/v1/documents/${file.id}:batchUpdate`, disconnectAfter: true });
    else f.pg.fail = s => { const stage = s.googleSimulation.operations.deliver.receipt.stage; if (['verified', 'readback'].includes(stage)) throw new Error('journal unavailable'); };
  } });
  const result = await f.exchange.deliverDoc('owner', input); assert.equal(result.outcome, 'unknown');
  assert.equal(result.requestIds.length, target === 'create' ? 1 : 2);
  if (target !== 'create') assert.match(result.documentId, /^synthetic_doc_/);
  const count = f.writes().length; f.pg.fail = undefined;
  assert.deepEqual(await f.restart().deliverDoc('owner', input), result); assert.equal(f.writes().length, count);
});
test('disconnect between create and insert preserves partial document and prevents second write', async t => {
  const f = integrationFixture(t), b = await setup(f), p = await preview(f, b);
  f.sim.faults.push({ path: '/v1/documents', after: () => { f.pg.fail = s => { if (s.googleSimulation.operations.deliver.receipt.stage === 'created') s.googleSimulation.connections.owner = { generation: 2, account: null }; }; } });
  const result = await f.exchange.deliverDoc('owner', delivery(p));
  assert.equal(result.outcome, 'unknown'); assert.match(result.documentId, /^synthetic_doc_/); assert.equal(f.writes().length, 1);
  assert.equal(f.sim.files.get(result.documentId).text, '');
});
test('definitive provider refusal is journaled and never repeated; concurrent duplicate confirmation dispatches once', async t => {
  const f = integrationFixture(t), b = await setup(f), p = await preview(f, b), input = delivery(p);
  f.sim.faults.push({ path: '/v1/documents', status: 403 });
  const result = await f.exchange.deliverDoc('owner', input); assert.equal(result.outcome, 'refused');
  assert.deepEqual(await f.restart().deliverDoc('owner', input), result); assert.equal(f.writes().length, 1);
  const p2 = await preview(f, b), command = delivery(p2, 'second');
  const responses = await Promise.all([f.exchange.deliverDoc('owner', command), f.restart().deliverDoc('owner', command)]);
  assert.ok(responses.some(r => r.outcome === 'verified')); assert.equal(f.writes().length, 3);
});

test('captured native export → HTTP preview → explicit simulated delivery retains source and reads back exact title/text',async t=>{
  const f=integrationFixture(t), b=await setup(f), route=handler(f), before=await f.workspace.get('owner',b.workId);
  const document=JSON.parse(readFileSync(new URL('./support/google-native-plain-1.4.0.json',import.meta.url),'utf8'));document.id=b.workId;
  const source=structuredClone(document);
  const previewed=await handlerRequest(route,'/api/exchange/google/doc-preview',{input:{...b,document}});
  assert.equal(previewed.status,200);assert.equal(f.writes().length,0);assert.equal(previewed.value.plan.title,document.title);
  assert.equal(previewed.value.plan.text,'Original saved paragraph.\nSynthetic Google-account simulation.');
  const sent=await handlerRequest(route,'/api/exchange/google/doc-deliver',{input:delivery(previewed.value,'native-export-delivery')});
  assert.equal(sent.status,200);assert.equal(sent.value.outcome,'verified');assert.equal(sent.value.tabId,'t.0');assert.equal(sent.value.verifiedText,previewed.value.plan.text);
  assert.equal(f.sim.files.get(sent.value.documentId).title,document.title);assert.equal(f.writes().length,2);
  assert.deepEqual(await f.workspace.get('owner',b.workId),before);assert.deepEqual(document,source);
});

test('receipt admission timestamps survive JSONB-style reordering, tied clocks and reservation journal failure',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-15T20:00:00.000Z')});
  const f=integrationFixture(t),b=await setup(f),reservedPreview=await preview(f,b),reservedInput=delivery(reservedPreview,'zz_reserved');
  f.pg.fail=s=>{const op=s.googleSimulation.operations.zz_reserved;if(op&&op.receipt.stage!=='reserved')throw new Error('journal unavailable before dispatch');};
  const reserved=await f.exchange.deliverDoc('owner',reservedInput);f.pg.fail=undefined;
  assert.equal(reserved.outcome,'not_started');assert.equal(reserved.stage,'reserved');assert.equal(reserved.recordedAt,undefined);assert.equal(reserved.createdAt,'2026-11-15T20:00:00.000Z');assert.equal(f.writes().length,0);
  f.sim.faults.push({path:'/v1/documents',disconnectAfter:true});
  const unknownPreview=await preview(f,b),unknownInput=delivery(unknownPreview,'aa_unknown'),unknown=await f.exchange.deliverDoc('owner',unknownInput);
  assert.equal(unknown.outcome,'unknown');assert.equal(unknown.createdAt,reserved.createdAt);assert.equal(unknown.recordedAt,reserved.createdAt);
  const before=f.pg.committed().googleSimulation.operations;
  await f.store.transaction(s=>{s.googleSimulation.operations=Object.fromEntries(Object.entries(s.googleSimulation.operations).reverse());});
  assert.deepEqual(Object.keys(f.pg.committed().googleSimulation.operations),['aa_unknown','zz_reserved']);
  assert.deepEqual(f.pg.committed().googleSimulation.operations,before,'serialized journal entries remain intact');
  const route=handler({...f,exchange:f.restart()}),response=await handlerRequest(route,`/api/exchange/google/state?workId=${b.workId}`);
  assert.equal(response.status,200);assert.deepEqual(Object.fromEntries(response.value.receipts.map(r=>[r.operationId,r])),{zz_reserved:reserved,aa_unknown:unknown});
  assert.deepEqual(await f.restart().deliverDoc('owner',reservedInput),reserved);assert.deepEqual(await f.restart().deliverDoc('owner',unknownInput),unknown);assert.equal(f.writes().length,1);
  // Legacy reservations retain their honest lack of a timestamp; no backfill or
  // synthetic chronology is inferred from object keys on a state read.
  await f.store.transaction(s=>{delete s.googleSimulation.operations.zz_reserved.createdAt;});
  const legacy=(await f.restart().state('owner',b.workId)).receipts.find(r=>r.operationId==='zz_reserved');assert.equal(legacy.createdAt,undefined);assert.equal(legacy.recordedAt,undefined);assert.equal(legacy.outcome,'not_started');
});
