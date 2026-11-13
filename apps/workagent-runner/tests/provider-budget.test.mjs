import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenRouterAccounting, journalStatus, keyBudget } from '../src/provider-accounting.mjs';
import { requestBody, requestHash, streamOpenRouter } from '../src/wire.mjs';
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
function setup({ denial, missingCost = false, complete = true, limit = key, finish = 'stop', brokenTool = false } = {}) {
  const journal = new Journal(), requests = [];
  const fetchImpl = async (url, request) => {
    requests.push({ url, request });
    if (url.endsWith('/key')) return Response.json({ data: limit });
    if (denial) return Response.json({ error: { message: 'Synthetic denial', metadata: { limit_source: denial === 429 ? 'rate' : 'openrouter_key_limit' } } }, { status: denial });
    const frame = { id: 'synthetic-generation', model: 'synthetic/resolved', choices: [{ index: 0, delta: brokenTool ? { tool_calls: [{ index: 0, id: 'partial', function: { name: 'edit_sheet', arguments: '{' } }] } : { content: 'Synthetic visible result' }, finish_reason: finish }], usage: { prompt_tokens: 20, completion_tokens: 8, ...(missingCost ? {} : { cost: 0.001 }) } };
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
for (const denial of [402, 403, 429]) test(`HTTP ${denial} retained without retry or invented charge`, async () => {
  const f = setup({ denial }); await assert.rejects(collect(f), new RegExp(`provider_http_${denial}`));
  assert.equal(f.requests.length, 2); assert.equal(f.journal.rows.at(-1).kind, 'unknown');
  assert.equal(f.journal.rows.at(-1).data.replayState.response.frames[0].http_status, denial);
  assert.equal((await f.accounting.status()).providerReportedCostUsd, 0); assert.equal((await f.accounting.status()).unresolvedRequests, 1);
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
