import test from 'node:test';
import assert from 'node:assert/strict';
import { streamOpenRouter, requestBody, requestHash, reconcileOpenRouterReceipt } from '../src/wire.mjs';
const options = { provider: 'workagent-openrouter', model: 'typesafe/jev-router', sessionId: 'opaque-session', messages: [{ role: 'user', content: [{ type: 'text', text: 'Synthetic comparison' }] }], tools: [{ name: 'read_sheet', description: 'Read', parameters: { type: 'object' } }] };
// Real v2 Jev policy shape; transport remains deterministic, with no live spend.
const policy = { version: 2, pricingBasis: 'openrouter-text-context-v1', extraChargeUsd: '0', inputTokenCeiling: 1_000_000, completionTokenCeiling: 1_000_000, route: 'typesafe/jev-router', maxRequestBytes: 1_000_000, maxOutputTokens: 4096,
  provider: { max_price: { prompt: 1, completion: 5, request: 0, image: 0 }, allow_fallbacks: false, require_parameters: true } };
const policyHash = 'a'.repeat(64);
const usage = { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28, prompt_tokens_details: { cached_tokens: 4 }, cost: 0.001 };
const chunks = [ { id: 'native-response', model: 'resolved/model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'native-call', function: { name: 'read_sheet', arguments: '{' } }], reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque' }] } }] }, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] }, { choices: [], usage } ];
function fixture(frames = chunks, complete = true) {
  const receipts = [], order = []; let calls = 0;
  const accounting = { async policy() { return { policy: structuredClone(policy), policyHash }; }, async reserve(r) { order.push('reserve'); return { durable: true, reservationId: 'issuer-reservation', requestHash: r.requestHash, route: r.route, policyHash }; }, async dispatch() { order.push('dispatch'); return { dispatched: true }; }, async retain(r) { receipts.push(r); order.push('retain'); return { retained: true }; } };
  const fetchImpl = async (_url, request) => {
    calls++; order.push('fetch'); assert.equal(JSON.parse(request.body).session_id, 'opaque-session');
    const bytes = new TextEncoder().encode(': heartbeat\r\n\r\n' + frames.map(x => `data: ${JSON.stringify(x)}\r\n\r\n`).join('') + (complete ? 'data: [DONE]\n\n' : ''));
    return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { status: 200 });
  };
  return { accounting, fetchImpl, apiKey: 'fixture-not-a-credential', receipts, order, calls: () => calls };
}
async function collect(opts, fixture) { const events = []; for await (const c of streamOpenRouter(opts, fixture)) events.push(c); return events; }
const partialFrame = kind => ({ id: 'partial-generation', model: 'resolved/model', routing: { route: 'retained' },
  choices: [{ index: 0, delta: { [kind]: 'partial evidence', reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque-partial' }] } }] });
function assertPartial(f, frame) {
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.order, ['reserve', 'dispatch', 'fetch', 'retain']);
  assert.equal(f.receipts.length, 1);
  assert.equal(f.receipts[0].outcome, 'unknown');
  assert.equal(f.receipts[0].terminal, false);
  assert.equal(f.receipts[0].responseId, frame.id);
  assert.equal(f.receipts[0].resolvedModel, frame.model);
  assert.deepEqual(f.receipts[0].replayState.response.frames, [frame]);
  assert.deepEqual(f.receipts[0].replayState.response.reasoning_details, frame.choices[0].delta.reasoning_details);
  assert.deepEqual(f.receipts[0].replayState.response.routing, [{ routing: frame.routing }]);
}
for (const kind of ['content', 'reasoning']) for (const yields of [1, 2]) {
  test(`wire closure: return at ${kind} yield ${yields} retains observed identity and partial evidence`, async () => {
    const frame = partialFrame(kind), f = fixture([frame]), iterator = streamOpenRouter(options, f);
    for (let i = 0; i < yields; i++) assert.equal((await iterator.next()).done, false);
    assert.equal((await iterator.return()).done, true);
    await iterator.return();
    assertPartial(f, frame);
  });
}
for (const abort of [false, true]) test(`wire closure: consumer ${abort ? 'abort' : 'exception'} after yielded chunk retains receipt`, async () => {
  const frame = partialFrame('content'), f = fixture([frame]), controller = new AbortController();
  const failure = new Error(abort ? 'consumer_aborted' : 'consumer_failed');
  await assert.rejects(async () => {
    for await (const event of streamOpenRouter({ ...options, signal: controller.signal }, f)) {
      if (event.type !== 'text-delta') continue;
      if (abort) { controller.abort(failure); controller.signal.throwIfAborted(); }
      throw failure;
    }
  }, error => error === failure);
  assertPartial(f, frame);
});
test('wire closure: settled completion and return after terminal retention never retain twice', async () => {
  for (const closeEarly of [false, true]) {
    const f = fixture();
    const iterator = streamOpenRouter(options, f);
    if (closeEarly) { await iterator.next(); await iterator.return(); }
    else for await (const _ of iterator) {}
    assert.deepEqual(f.order, ['reserve', 'dispatch', 'fetch', 'retain']);
    assert.equal(f.receipts[0].outcome, 'received');
    assert.equal(f.receipts[0].terminal, true);
  }
});
for (const throws of [true, false]) test(`wire closure: ${throws ? 'failed' : 'unacknowledged'} retain rejects return without replay`, async () => {
  const f = fixture([partialFrame('reasoning')]); let attempts = 0;
  f.accounting.retain = async r => { attempts++; f.receipts.push(r); if (throws) throw new Error('issuer_down'); return {}; };
  const iterator = streamOpenRouter(options, f); await iterator.next();
  await assert.rejects(iterator.return(), /accounting_retention_failed_unknown_liability/);
  assert.equal(attempts, 1); assert.equal(f.calls(), 1);
  assert.equal(f.receipts[0].responseId, 'partial-generation');
});
test('wire fixture: streaming tools preserve native IDs, split frames, cached usage, resolved route and replay', async () => {
  const f = fixture(), result = await collect(options, f);
  assert.deepEqual(f.order, ['reserve', 'dispatch', 'fetch', 'retain']);
  assert.deepEqual(result.find(x => x.type === 'block-end').block, { type: 'tool-call', id: 'native-call', name: 'read_sheet', arguments: '{}' });
  assert.equal(result.find(x => x.type === 'usage').usage.inputTokens, 16);
  const replay = result.at(-1).replayState; assert.equal(replay.response.model, 'resolved/model'); assert.equal(replay.response.reasoning_details[0].data, 'opaque');
  assert.equal(f.receipts[0].usage.cost, 0.001);
  const body = requestBody({ ...options, messages: [{ role: 'assistant', source: { replayState: replay }, content: [{ type: 'tool-call', id: 'native-call', name: 'read_sheet', arguments: '{}' }] }, { role: 'tool', toolCallId: 'native-call', content: [{ type: 'text', text: 'result' }] }] }, policy);
  assert.equal(body.messages[0].tool_calls[0].id, body.messages[1].tool_call_id); assert.deepEqual(body.messages[0].reasoning_details, replay.response.reasoning_details);
});
test('wire fixture: dropped connection retains unknown and never retries', async () => {
  const f = fixture(chunks.slice(0, 1), false); await assert.rejects(collect(options, f), /provider_outcome_unknown/); assert.equal(f.calls(), 1); assert.equal(f.receipts[0].outcome, 'unknown');
});
test('wire fixture: issuer refusal, auxiliary paths and decision model cannot dispatch', async () => {
  const f = fixture(); f.accounting.reserve = async () => { throw new Error('budget_exhausted'); };
  await assert.rejects(collect(options, f), /budget_exhausted/); assert.equal(f.calls(), 0);
  await assert.rejects(collect({ ...options, purpose: 'compaction' }, f), /auxiliary_inference_disabled/);
  await assert.rejects(collect({ ...options, model: 'typesafe/jev-1.14' }, f), /decisions_model_is_not_chat/);
});
test('wire fixture: cancellation after reservation prevents dispatch; malformed usage retains liability', async () => {
  const f = fixture(); f.beforeDispatch = async () => { throw new Error('work_superseded'); };
  await assert.rejects(collect(options, f), /work_superseded/); assert.equal(f.calls(), 0); assert.equal(f.receipts[0].outcome, 'not_dispatched');
  const g = fixture(chunks.slice(0, 2)); await assert.rejects(collect(options, g), /usage_missing/); assert.equal(g.receipts[0].outcome, 'unknown');
});
test('wire fixture: received result is not released to tools before durable retention', async () => {
  const f = fixture(); f.accounting.retain = async () => { throw new Error('issuer_down'); };
  const result = []; await assert.rejects(async () => { for await (const c of streamOpenRouter(options, f)) result.push(c); }, /accounting_retention_failed/);
  assert.equal(result.some(c => c.type === 'block-end'), false);
});

test('wire fixture: lost dispatch acknowledgement remains unknown and no provider request is made', async () => {
  const f = fixture(); f.accounting.dispatch = async () => { throw new Error('issuer_ack_lost'); };
  await assert.rejects(collect(options, f), /issuer_ack_lost/);
  assert.equal(f.calls(), 0); assert.equal(f.receipts[0].outcome, 'unknown');
});
test('wire fixture: no durable receipt acknowledgement means no tool execution', async () => {
  const f = fixture(); f.accounting.retain = async () => ({});
  const result = []; await assert.rejects(async () => { for await (const c of streamOpenRouter(options, f)) result.push(c); }, /accounting_retention_failed/);
  assert.equal(result.some(c => c.type === 'block-end'), false);
});

test('final actual wire has hard price constraints and exact reservation bytes/hash', async () => {
  const f = fixture(); let reserved;
  const original = f.accounting.reserve;
  f.accounting.reserve = async r => { reserved = r; return original(r); };
  const fetchOriginal = f.fetchImpl;
  f.fetchImpl = async (url, request) => {
    assert.equal(request.body, reserved.requestBody);
    const body = JSON.parse(request.body);
    assert.equal(requestHash(body), reserved.requestHash);
    assert.equal(Buffer.byteLength(request.body), reserved.requestBytes);
    assert.deepEqual(body.provider, policy.provider);
    assert.deepEqual(body.prompt_cache_options, { mode: 'explicit' });
    assert.equal(request.headers['x-anthropic-beta'], undefined);
    return fetchOriginal(url, request);
  };
  f.attribution = { 'x-anthropic-beta': 'unaccounted-feature' };
  await collect(options, f);
});
test('caller mutations after reservation cannot mutate tool schemas or the wire', async () => {
  const f = fixture(), local = structuredClone(options); let raw;
  const original = f.accounting.reserve;
  f.accounting.reserve = async r => { raw = r.requestBody; return original(r); };
  f.beforeDispatch = async () => { local.tools[0].parameters.secret = 'mutated'; local.model = 'different'; };
  const fetchOriginal = f.fetchImpl;
  f.fetchImpl = async (url, request) => { assert.equal(request.body, raw); assert.equal(request.body.includes('mutated'), false); return fetchOriginal(url, request); };
  await collect(local, f);
});
test('underfunded context bounds, missing negotiation and mismatched policy permits fail before fetch', async () => {
  const f = fixture();
  f.accounting.policy = async () => ({ policy: { ...policy, completionTokenCeiling: 4096 }, policyHash });
  await assert.rejects(collect(options, f), /context_envelope_too_small/);
  assert.equal(f.calls(), 0);
  const g = fixture(); g.accounting.reserve = async r => ({ durable: true, reservationId: 'x', requestHash: r.requestHash, route: r.route, policyHash: 'b'.repeat(64) });
  await assert.rejects(collect(options, g), /accounting_reservation_invalid/);
  assert.equal(g.calls(), 0);
  assert.throws(() => requestBody(options), /accounting_policy_required/);
  assert.throws(() => requestBody({ ...options, maxTokens: -1 }, policy), /invalid_output_bound/);
});
test('lost receipt ack preserves raw unknown evidence without another send', async () => {
  const f = fixture(); let count = 0;
  f.accounting.retain = async r => { f.receipts.push(r); if (++count === 1) throw new Error('receipt_ack_lost'); return { retained: true }; };
  await assert.rejects(collect(options, f), /receipt_ack_lost/);
  assert.equal(f.calls(), 1);
  assert.equal(f.receipts[1].outcome, 'unknown');
  assert.equal(f.receipts[1].resolvedModel, 'resolved/model');
  assert.equal(f.receipts[1].replayState.response.frames.length, 3);
});

test('authorized Jev route negotiates unrestricted provider selection and terminal monetary receipt', async () => {
  const f = fixture(); await collect(options, f);
  assert.equal(f.calls(), 1);
  assert.equal(f.receipts[0].terminal, true);
  assert.equal(f.receipts[0].usage.cost, usage.cost);
  assert.equal(requestBody(options, policy).provider.only, undefined);
  assert.equal(requestBody(options, policy).model, 'typesafe/jev-router');
});
test('generation reconciliation is exact-ID GET only and retains original metadata', async () => {
  const receipts = [], requests = [];
  const generation = { id: 'gen-known', model: 'resolved/model', finish_reason: 'stop', total_cost: 0.001, is_byok: false };
  const binding = { reservationId: 'r', requestHash: 'c'.repeat(64), responseId: generation.id };
  const dependencies = { apiKey: 'fixture-not-a-credential', accounting: { async retain(r) { receipts.push(r); return { retained: true, settled: true }; } },
    fetchImpl: async (url, request) => { requests.push([url, request]); return Response.json({ data: generation }); } };
  assert.equal((await reconcileOpenRouterReceipt(binding, dependencies)).settled, true);
  assert.equal(requests[0][1].method, 'GET');
  assert.equal(requests[0][0], 'https://openrouter.ai/api/v1/generation?id=gen-known');
  assert.equal(receipts[0].outcome, 'reconciled'); assert.deepEqual(receipts[0].generation, generation);
  generation.id = 'other-generation';
  await assert.rejects(reconcileOpenRouterReceipt(binding, dependencies), /incomplete_or_conflicting/);
  assert.equal(receipts.length, 1);
  dependencies.fetchImpl = async () => new Response('', { status: 404 });
  await assert.rejects(reconcileOpenRouterReceipt(binding, dependencies), /lookup_unavailable/);
});
test('media, Decisions and extra paid endpoint features cannot enter the accounted body', () => {
  assert.throws(() => requestBody({ ...options, model: 'typesafe/jev-1.13' }, policy), /route_not_authorized/);
  assert.throws(() => requestBody({ ...options, messages: [{ role: 'user', content: [{ type: 'image', url: 'https://example.test/image' }] }] }, policy), /unsupported_modality/);
  const body = requestBody({ ...options, plugins: [{ id: 'web' }], models: ['other/model'], service_tier: 'priority' }, policy);
  assert.equal(body.plugins, undefined); assert.equal(body.models, undefined); assert.equal(body.service_tier, undefined);
});

test('partial monetary usage remains unknown until a terminal response or exact reconciliation', async () => {
  const f = fixture(chunks, false);
  await assert.rejects(collect(options, f), /provider_outcome_unknown/);
  assert.equal(f.receipts[0].outcome, 'unknown');
  assert.equal(f.receipts[0].terminal, false);
  assert.equal(f.receipts[0].usage.cost, usage.cost);
  assert.equal(f.calls(), 1);
});
test('response-ID changes cannot be settled and paid media cannot hide in reasoning replay', async () => {
  const f = fixture([chunks[0], { ...chunks[1], id: 'different-generation' }, chunks[2]]);
  await assert.rejects(collect(options, f), /provider_identity_changed/);
  assert.equal(f.receipts[0].outcome, 'unknown');
  assert.equal(f.receipts[0].responseId, 'native-response');
  assert.equal(f.calls(), 1);
  assert.throws(() => requestBody({ ...options, messages: [{ role: 'assistant', content: [],
    source: { replayState: { response: { reasoning_details: [{ type: 'image_url', url: 'https://example.test' }] } } } }] }, policy), /unsupported_replay/);
});
