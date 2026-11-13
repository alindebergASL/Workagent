import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterAccounting, journalStatus, keyBudget } from '../src/provider-accounting.mjs';
import { requestBody, requestHash, streamOpenRouter, reconcileOpenRouterReceipt } from '../src/wire.mjs';
import { claudeDetails, openaiDetails, history, freeze } from './support/replay-fixture.mjs';
const key = { limit: 100, limit_remaining: 40, limit_reset: null, usage: 60, budgets: [], effective_budget: null };
const options = { model: 'typesafe/jev-router', sessionId: 'synthetic-session', requestId: 'synthetic-step', maxTokens: 32768, reasoningEffort: 'high', messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic fixture' }] }] };
// A serial, rollback-capable journal fixture; PostgreSQL constraints/roles are Parent qualification.
class Journal {
  rows = []; tail = Promise.resolve();
  transaction(id, fn) {
    const task = this.tail.then(async () => {
      const pending = [];
      const result = await fn(structuredClone(this.rows.filter(r => r.id === id)), async (kind, data) => pending.push({ id, kind, data: structuredClone(data) }));
      this.rows.push(...pending); return result;
    });
    this.tail = task.catch(() => {}); return task;
  }
  async status() { return journalStatus(this.rows); }
}
function setup({ denial, missingCost = false, complete = true, limit = key, finish = 'stop', brokenTool = false, frameOverrides = {} } = {}) {
  const journal = new Journal(), requests = [];
  const fetchImpl = async (url, request) => {
    requests.push({ url, request });
    if (url.endsWith('/key')) return Response.json({ data: limit });
    if (denial) return Response.json({ error: { message: 'Synthetic denial', metadata: { limit_source: denial === 429 ? 'rate' : 'openrouter_key_limit' } } }, { status: denial });
    const frame = { id: 'synthetic-generation', model: 'synthetic/resolved', choices: [{ index: 0, delta: brokenTool ? { tool_calls: [{ index: 0, id: 'partial', function: { name: 'edit_sheet', arguments: '{' } }] } : { content: 'Synthetic visible result' }, finish_reason: finish }], usage: { prompt_tokens: 20, completion_tokens: 8, ...(missingCost ? {} : { cost: 0.001 }) } };
    Object.assign(frame, frameOverrides);
    return new Response(`data: ${JSON.stringify(frame)}\n\n` + (complete ? 'data: [DONE]\n\n' : ''));
  };
  const accounting = new OpenRouterAccounting({ journal, apiKey: 'synthetic', fetchImpl });
  return { journal, accounting, fetchImpl, apiKey: 'synthetic', requests };
}
async function collect(f, opts = options) { const events = []; for await (const e of streamOpenRouter(opts, f)) events.push(e); return events; }
async function prepared(f) {
  const { policy, policyHash } = await f.accounting.policy(), body = requestBody(options, policy);
  return { sessionId: options.sessionId, requestId: options.requestId, requestHash: requestHash(body), route: body.model, maxOutputTokens: body.max_tokens, requestBytes: Buffer.byteLength(JSON.stringify(body)), purpose: 'conversation', requestBody: JSON.stringify(body), policyHash };
}
test('provider budget mode sends 32768 reasoning allowance through exact bound wire and exposes separate costs', async () => {
  const f = setup(), events = await collect(f);
  assert.equal(events.at(-1).reason.kind, 'stop');
  assert.deepEqual(f.requests.map(r => r.request.method), ['GET', 'POST']);
  const sent = f.requests[1].request.body, prep = f.journal.rows[0].data, body = JSON.parse(sent);
  assert.equal(sent, prep.requestBody); assert.equal(requestHash(body), prep.requestHash);
  assert.equal(body.max_tokens, 32768); assert.deepEqual(body.reasoning, { effort: 'high' }); assert.equal(body.provider.max_price, undefined);
  assert.deepEqual(f.journal.rows.map(r => r.kind), ['prepared', 'dispatched', 'received']);
  const status = await f.accounting.status(); assert.equal(status.providerReportedCostUsd, 0.001); assert.equal(status.unresolvedRequests, 0);
  assert.equal(status.latestKeySnapshot.usage, 60); assert.equal(status.latestKeySnapshot.limit_remaining, 40); assert.equal(status.keySnapshotReservesFunds, false); assert.equal(status.verifiedInvoiceCostUsd, null);
  await assert.rejects(collect(f), /no_replay/); assert.equal(f.requests.filter(r => r.request.method === 'POST').length, 1);
});
test('configurable output is honored without modifying legacy policies; invalid binds never dispatch', async () => {
  const f = setup(); f.accounting = new OpenRouterAccounting({ journal: f.journal, apiKey: 'synthetic', fetchImpl: f.fetchImpl, maxOutputTokens: 65536 });
  await collect(f, { ...options, maxTokens: 65536 }); assert.equal(JSON.parse(f.requests[1].request.body).max_tokens, 65536);
  const g = setup(), r = await prepared(g); r.requestBody += ' ';
  await assert.rejects(g.accounting.reserve(r), /binding_invalid/); assert.equal(g.requests.length, 0);
});
test('one-use concurrent dispatch and immutable receipt retries preserve exact known cost', async () => {
  const f = setup(), r = await prepared(f), p = await f.accounting.reserve(r);
  const attempts = await Promise.allSettled([f.accounting.dispatch(p), f.accounting.dispatch(p)]);
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
  const receipt = { reservationId: p.reservationId, requestHash: p.requestHash, outcome: 'received', terminal: true, responseId: 'synthetic-generation', resolvedModel: 'synthetic/model', usage: { cost: 0.01 } };
  await f.accounting.retain(receipt); await f.accounting.retain(receipt);
  await assert.rejects(f.accounting.retain({ ...receipt, usage: { cost: 0.02 } }), /cost_conflict/);
  assert.equal(f.journal.rows.filter(r => r.kind === 'received').length, 1); assert.equal((await f.accounting.status()).providerReportedCostUsd, 0.01);
});
for (const denial of [400, 402, 403, 429]) test(`HTTP ${denial} retained without retry or invented charge`, async () => {
  const f = setup({ denial }); await assert.rejects(collect(f), new RegExp(`provider_http_${denial}`));
  assert.equal(f.requests.length, 2); assert.equal(f.journal.rows.at(-1).kind, 'unknown');
  assert.equal(f.journal.rows.at(-1).data.replayState.response.frames[0].http_status, denial);
  assert.equal((await f.accounting.status()).providerReportedCostUsd, 0); assert.equal((await f.accounting.status()).unresolvedRequests, 1);
});
test('portable selection precedes exact journal reservation while original response frames and unknown denials remain immutable', async () => {
  const details = [...claudeDetails, ...openaiDetails];
  const frame = { id: 'synthetic-mixed-response', model: 'openai/synthetic', choices: [{ index: 0, delta: { content: 'Normal final answer', reasoning_details: details }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 8, cost: 0.001 } };
  const f = setup({ frameOverrides: frame }), input = freeze({ ...structuredClone(options), messages: history() }), before = JSON.stringify(input);
  const events = await collect(f, input), prepared = f.journal.rows[0].data;
  const sent = f.requests.find(r => r.request.method === 'POST').request.body;
  assert.ok(JSON.parse(sent).messages.every(m => !Object.hasOwn(m, 'reasoning_details')));
  assert.equal(sent, prepared.requestBody); assert.equal(requestHash(JSON.parse(sent)), prepared.requestHash);
  assert.equal(Buffer.byteLength(sent), prepared.requestBytes); assert.equal(JSON.stringify(input), before);
  assert.deepEqual(events.at(-1).replayState.response.reasoning_details, details);
  assert.deepEqual(f.journal.rows.at(-1).data.replayState.response.frames, [frame]);
  assert.deepEqual(f.journal.rows.at(-1).data.replayState.response.reasoning_details, details);
  const retained = structuredClone(f.journal.rows);
  const denial = { error: { message: 'Synthetic mixed-provider denial', metadata: { distinct_provider_slugs: 'claude-on-aws,openai' } } };
  const fetchImpl = f.fetchImpl;
  f.fetchImpl = async (url, request) => {
    if (request.method !== 'POST') return fetchImpl(url, request);
    f.requests.push({ url, request }); return Response.json(denial, { status: 400 });
  };
  const next = { ...input, requestId: 'synthetic-denied-step' };
  await assert.rejects(collect(f, next), /provider_http_400/);
  const unknown = f.journal.rows.at(-1).data;
  assert.equal(unknown.outcome, 'unknown'); assert.equal(unknown.responseId, undefined); assert.equal(unknown.usage, undefined);
  assert.deepEqual(JSON.parse(unknown.replayState.response.frames[0].error), denial);
  assert.deepEqual(f.journal.rows.slice(0, retained.length), retained);
  assert.equal((await f.accounting.status()).unresolvedRequests, 1);
  await assert.rejects(collect(f, next), /no_replay/);
  assert.equal(f.requests.filter(r => r.request.method === 'POST').length, 2);
});
test('actual key or effective budget denial stops POST; key snapshot is never atomic headroom', async () => {
  for (const limit of [{ ...key, limit_remaining: 0 }, { ...key, effective_budget: { limit_usd: 10, spend_usd: 10, remaining_usd: 0 } }]) {
    const f = setup({ limit }); await assert.rejects(collect(f), /provider_budget_exhausted/); assert.equal(f.requests.length, 1);
  }
  assert.throws(() => keyBudget({ ...key, usage: NaN }), /metadata_invalid/);
});
test('unknown costs stay unresolved; exact generation reconciliation never sends inference', async () => {
  const f = setup({ complete: false }); await assert.rejects(collect(f), /outcome_unknown/);
  const prior = f.journal.rows.at(-1).data;
  assert.equal((await f.accounting.status()).unresolvedRequests, 1);
  const r = { reservationId: prior.reservationId, requestHash: prior.requestHash, responseId: prior.responseId, resolvedModel: prior.resolvedModel, outcome: 'reconciled', terminal: true, generation: { id: prior.responseId, model: prior.resolvedModel, finish_reason: 'stop', total_cost: 0.001 } };
  await f.accounting.retain(r); assert.equal((await f.accounting.status()).unresolvedRequests, 0); assert.equal(f.requests.length, 2);
  await assert.rejects(f.accounting.retain({ ...r, responseId: 'another' }), /identity_conflict/);
});
test('length-truncated tool JSON retains terminal charge and is not exposed for execution', async () => {
  const f = setup({ finish: 'length', brokenTool: true }), events = await collect(f);
  assert.equal(events.at(-1).reason.kind, 'max-tokens'); assert.equal(events.some(e => e.blockType === 'tool-call'), false);
  assert.equal((await f.accounting.status()).providerReportedCostUsd, 0.001);
});
test('receipt acknowledgement loss cannot resend; known settlement survives unknown evidence', async () => {
  const f = setup(), retain = f.accounting.retain.bind(f.accounting); let lost = false;
  f.accounting.retain = async r => { const result = await retain(r); if (!lost) { lost = true; throw new Error('synthetic_ack_loss'); } return result; };
  await assert.rejects(collect(f), /synthetic_ack_loss/);
  assert.equal((await f.accounting.status()).providerReportedCostUsd, 0.001); assert.equal((await f.accounting.status()).unresolvedRequests, 0);
  assert.equal(f.journal.rows.at(-1).kind, 'unknown'); assert.equal(f.requests.length, 2);
});

test('PostgreSQL journal commits before acknowledging and rolls back failed lifecycle changes', async () => {
  const { PostgresProviderJournal } = await import('../src/provider-accounting.mjs');
  const statements = []; let released = 0;
  const c = { async query(sql, args) { statements.push({ sql, args }); return { rows: [] }; }, release() { released++; } };
  const journal = new PostgresProviderJournal({ async connect() { return c; } });
  assert.equal(await journal.transaction('synthetic', async (rows, append) => { assert.deepEqual(rows, []); await append('prepared', { fixture: true }); return 'committed'; }), 'committed');
  assert.equal(statements[0].sql, 'BEGIN'); assert.match(statements[1].sql, /pg_advisory_xact_lock/); assert.match(statements[3].sql, /INSERT INTO workagent_provider.journal/); assert.equal(statements.at(-1).sql, 'COMMIT'); assert.equal(released, 1);
  await assert.rejects(journal.transaction('synthetic', async () => { throw new Error('synthetic_transaction_failure'); }), /transaction_failure/);
  assert.equal(statements.at(-1).sql, 'ROLLBACK'); assert.equal(released, 2);
});
test('timing and metadata bounds reject invalid configuration without provider work', async () => {
  const { requestTimeout, outputAllowance, providerText } = await import('../src/wire.mjs');
  assert.equal(requestTimeout(), 300000); assert.equal(outputAllowance(), 32768);
  assert.equal(requestTimeout('600000'), 600000); assert.throws(() => requestTimeout(0), /invalid_request_timeout/);
  assert.throws(() => outputAllowance(NaN), /invalid_output_bound/);
  await assert.rejects(providerText(new Response('too large'), 2), /metadata_too_large/);
});

// Synthetic protocol-shaped evidence. Catalog aliases are exact provider metadata,
// not suffix normalization; another variant may share the same canonical slug.
const observedModel = 'synthetic/flash-0314', canonicalModel = 'synthetic/flash-20310314';
const catalogEntry = { id: observedModel, canonical_slug: canonicalModel };
async function interrupted(frameOverrides = {}, opts = options) {
  const f = setup({ complete: false, finish: null, frameOverrides: { model: observedModel, usage: null, ...frameOverrides } });
  await assert.rejects(collect(f, opts), /outcome_unknown/);
  const prior = structuredClone(f.journal.rows.at(-1).data);
  const binding = { reservationId: prior.reservationId, requestHash: prior.requestHash, responseId: prior.responseId };
  const generation = { id: prior.responseId, model: canonicalModel, cancelled: true, finish_reason: null, native_finish_reason: null,
    streamed: true, total_cost: 0.000123, tokens_prompt: 20, tokens_completion: 8 };
  const catalog = { data: [{ id: `${observedModel}:batch`, canonical_slug: canonicalModel }, catalogEntry] };
  const lookups = [];
  const dependencies = { accounting: f.accounting, apiKey: 'synthetic', fetchImpl: async (url, request) => {
    lookups.push({ url, request });
    assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'error');
    if (url === 'https://openrouter.ai/api/v1/models') return Response.json(catalog);
    assert.equal(url, `https://openrouter.ai/api/v1/generation?id=${prior.responseId}`);
    return Response.json({ data: generation });
  } };
  return { ...f, prior, binding, generation, catalog, lookups, dependencies };
}
test('cancelled generation with catalog association appends evidence through wire and accounting without replay', async () => {
  const f = await interrupted(), before = structuredClone(f.journal.rows);
  const result = await reconcileOpenRouterReceipt(f.binding, f.dependencies);
  assert.equal(result.settled, true); assert.equal(result.reportedCostUsd, f.generation.total_cost);
  assert.deepEqual(f.journal.rows.slice(0, before.length), before);
  const receipt = f.journal.rows.at(-1).data;
  assert.equal(receipt.resolvedModel, observedModel); assert.deepEqual(receipt.generation, f.generation);
  assert.deepEqual(receipt.modelMapping, { source: 'https://openrouter.ai/api/v1/models', ...catalogEntry });
  assert.equal(receipt.monetaryState, 'provider_reported');
  assert.equal((await f.accounting.status()).unresolvedRequests, 0);
  assert.equal((await f.accounting.status()).verifiedInvoiceCostUsd, null);
  assert.equal(f.lookups.length, 2); assert.equal(f.requests.length, 2);
  await reconcileOpenRouterReceipt(f.binding, f.dependencies);
  assert.equal(f.journal.rows.length, before.length + 1);
  await assert.rejects(f.accounting.dispatch(f.binding), /no_replay/);
  await assert.rejects(collect(f), /no_replay/);
  assert.equal(f.requests.filter(r => r.request.method === 'POST').length, 1);
});
test('provider reconciliation accepts exact models and zero cost without a catalog lookup', async () => {
  for (const finish_reason of [null, '', undefined]) {
    const f = await interrupted(); Object.assign(f.generation, { model: observedModel, total_cost: 0, finish_reason });
    assert.equal((await reconcileOpenRouterReceipt(f.binding, f.dependencies)).settled, true);
    assert.equal(f.lookups.length, 1); assert.equal(f.journal.rows.at(-1).data.modelMapping, undefined);
  }
});
test('normal finished generations can use the same exact catalog association', async () => {
  const f = await interrupted(); delete f.generation.cancelled; f.generation.finish_reason = 'stop';
  assert.equal((await reconcileOpenRouterReceipt(f.binding, f.dependencies)).settled, true);
});
test('empty finish requires boolean true cancellation; incomplete or unrelated generations append nothing', async () => {
  for (const change of [
    ...[null, '', undefined].flatMap(finish_reason => [undefined, false, 'true', 1].map(cancelled => ({ finish_reason, cancelled }))),
    { finish_reason: false }, { id: 'gen-unrelated' }, { model: '' }, { total_cost: undefined }, { total_cost: null }, { total_cost: '0.01' }, { total_cost: -1 }]) {
    const f = await interrupted(); Object.assign(f.generation, change);
    await assert.rejects(reconcileOpenRouterReceipt(f.binding, f.dependencies), /incomplete_or_conflicting/);
    assert.equal(f.journal.rows.length, 3); assert.equal(f.lookups.length, 1);
    assert.equal((await f.accounting.status()).unresolvedRequests, 1);
  }
});
test('only a unique exact observed ID mapping is accepted, never a related variant or caller hint', async () => {
  for (const data of [[], [{ id: `${observedModel}:batch`, canonical_slug: canonicalModel }],
    [{ id: observedModel, canonical_slug: 'synthetic/unrelated' }], [{ id: observedModel }],
    [{ id: observedModel, canonical_slug: [canonicalModel] }], [catalogEntry, catalogEntry],
    [catalogEntry, { id: observedModel, canonical_slug: 'synthetic/conflict' }], null, {}]) {
    const f = await interrupted(); f.catalog.data = data;
    await assert.rejects(reconcileOpenRouterReceipt({ ...f.binding, resolvedModel: canonicalModel, modelMapping: catalogEntry }, f.dependencies), /model_mapping/);
    assert.equal(f.journal.rows.length, 3); assert.equal((await f.accounting.status()).unresolvedRequests, 1);
  }
});
test('provider reconciliation derives identity from retained request before any lookup', async () => {
  for (const change of [{ reservationId: 'unknown' }, { requestHash: 'f'.repeat(64) }, { responseId: 'gen-unrelated' }, { responseId: undefined }]) {
    const f = await interrupted();
    await assert.rejects(reconcileOpenRouterReceipt({ ...f.binding, ...change }, f.dependencies), /identity|binding/);
    assert.equal(f.lookups.length, 0); assert.equal(f.journal.rows.length, 3);
  }
  const f = await interrupted({ id: undefined });
  await assert.rejects(reconcileOpenRouterReceipt({ ...f.binding, responseId: 'gen-invented' }, f.dependencies), /identity/);
  assert.equal(f.lookups.length, 0);
});
test('a generation retained by another request cannot be grafted onto this request', async () => {
  const f = await interrupted(), g = await interrupted({ id: 'synthetic-other-generation' }, { ...options, sessionId: 'synthetic-other-session' });
  f.journal.rows.push(...g.journal.rows);
  const before = structuredClone(f.journal.rows);
  await assert.rejects(reconcileOpenRouterReceipt({ ...f.binding, responseId: g.binding.responseId }, f.dependencies), /identity/);
  await assert.rejects(reconcileOpenRouterReceipt({ ...f.binding, reservationId: g.binding.reservationId }, f.dependencies), /binding/);
  await assert.rejects(f.accounting.retain({ ...f.binding, responseId: g.binding.responseId, resolvedModel: observedModel,
    outcome: 'reconciled', terminal: true, generation: g.generation,
    modelMapping: { source: 'https://openrouter.ai/api/v1/models', ...catalogEntry } }), /identity_conflict/);
  assert.equal(f.lookups.length, 0); assert.deepEqual(f.journal.rows, before);
  assert.equal((await f.accounting.status()).unresolvedRequests, 2);
});
test('accounting independently rejects forged mapping, terminal, cost and identity evidence', async () => {
  const f = await interrupted();
  const receipt = { ...f.binding, resolvedModel: observedModel, outcome: 'reconciled', terminal: true, generation: f.generation,
    modelMapping: { source: 'https://openrouter.ai/api/v1/models', ...catalogEntry } };
  for (const change of [{ modelMapping: undefined }, { modelMapping: { ...receipt.modelMapping, source: 'caller' } },
    { modelMapping: { ...receipt.modelMapping, id: `${observedModel}:batch` } },
    { modelMapping: { ...receipt.modelMapping, canonical_slug: 'synthetic/unrelated' } },
    { resolvedModel: canonicalModel }, { terminal: false }, { terminal: 'true' },
    { generation: { ...f.generation, id: undefined } }, { generation: { ...f.generation, cancelled: 'true' } },
    ...[undefined, null, '0.01', -1, NaN, Infinity].map(total_cost => ({ generation: { ...f.generation, total_cost } }))]) {
    await assert.rejects(f.accounting.retain({ ...receipt, ...change }), /identity|mapping|incomplete/);
    assert.equal(f.journal.rows.length, 3);
  }
  await f.accounting.retain(receipt);
  await assert.rejects(f.accounting.retain({ ...receipt, generation: { ...f.generation, total_cost: 0.1 } }), /cost_conflict/);
  assert.equal(f.journal.rows.length, 4);
});
test('catalog failures and bounded response rejection preserve unknown receipts', async () => {
  for (const response of [new Response('', { status: 503 }), Response.json({ data: null }), new Response(' '.repeat(8_000_001))]) {
    const f = await interrupted(), fetchImpl = f.dependencies.fetchImpl;
    f.dependencies.fetchImpl = (url, request) => url.endsWith('/models') ? response : fetchImpl(url, request);
    await assert.rejects(reconcileOpenRouterReceipt(f.binding, f.dependencies), /model_mapping|metadata_too_large/);
    assert.equal(f.journal.rows.length, 3); assert.equal((await f.accounting.status()).unresolvedRequests, 1);
  }
});
