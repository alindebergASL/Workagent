import { createHash } from 'node:crypto';
export const DEFAULT_MODEL = 'typesafe/jev-router';
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export function requestBody(options, policy) {
  if (!policy || policy.version !== 2 || policy.pricingBasis !== 'openrouter-text-context-v1') throw new Error('accounting_policy_required');
  const prices = policy.provider?.max_price;
  if (!prices || Object.keys(prices).sort().join(',') !== 'completion,image,prompt,request'
      || Object.values(prices).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)
      || prices.image !== 0 || policy.provider.allow_fallbacks !== false || policy.provider.require_parameters !== true
      || !Number.isSafeInteger(policy.maxOutputTokens) || policy.maxOutputTokens < 1 || policy.maxOutputTokens > 4096
      || !Number.isSafeInteger(policy.maxRequestBytes) || policy.maxRequestBytes < 1 || policy.maxRequestBytes > 1_000_000) throw new Error('invalid_accounting_policy');
  if (policy.route === DEFAULT_MODEL && (policy.inputTokenCeiling < 1_000_000 || policy.completionTokenCeiling < 1_000_000)) throw new Error('context_envelope_too_small');
  if (options.model === 'typesafe/jev-1.14') throw new Error('decisions_model_is_not_chat');
  if ((options.model || DEFAULT_MODEL) !== policy.route) throw new Error('route_not_authorized');
  if (options.maxTokens !== undefined && (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1)) throw new Error('invalid_output_bound');
  if (options.purpose) throw new Error('auxiliary_inference_disabled');
  if (!options.sessionId) throw new Error('session_identity_required');
  const messages = (options.system ? [{ role: 'system', content: options.system }] : []).concat(options.messages.map(m => {
    if (m.content.some(c => !['text', 'reasoning', 'tool-call', 'tool-addition', 'tool-removal'].includes(c.type))) throw new Error('unsupported_modality');
    const content = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (m.role === 'tool') return { role: 'tool', content, tool_call_id: m.toolCallId ?? m.source?.callId };
    const wire = { role: m.role === 'developer' ? 'system' : m.role, content };
    if (m.role === 'assistant') {
      const calls = m.content.filter(c => c.type === 'tool-call');
      if (calls.length) wire.tool_calls = calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }));
      const replay = m.source?.replayState?.response;
      if (replay?.reasoning_details) {
        if (!Array.isArray(replay.reasoning_details) || replay.reasoning_details.some(d =>
          !['reasoning.text', 'reasoning.summary', 'reasoning.encrypted'].includes(d?.type)
          || Object.keys(d).some(k => !['type', 'text', 'summary', 'data', 'signature', 'id', 'format', 'index'].includes(k)))) throw new Error('unsupported_replay');
        wire.reasoning_details = replay.reasoning_details;
      }
    }
    return wire;
  }));
  const body = { model: options.model || DEFAULT_MODEL, messages, stream: true, stream_options: { include_usage: true }, session_id: options.sessionId, max_tokens: Math.min(options.maxTokens ?? 4096, policy.maxOutputTokens) };
  body.provider = structuredClone(policy.provider);
  body.prompt_cache_options = { mode: 'explicit' };
  if (options.tools?.length) body.tools = options.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  if (options.reasoningEffort) body.reasoning = { effort: options.reasoningEffort };
  return body;
}
export const requestHash = body => createHash('sha256').update(JSON.stringify(body)).digest('hex');
// Decodes split UTF-8/SSE frames, comments and CRLF. EOF without [DONE] is ambiguous.
export async function* sse(body) {
  if (!body) throw new Error('missing_stream');
  const decoder = new TextDecoder(); let buffer = '', done = false;
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 2_000_000) throw new Error('stream_frame_too_large');
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
      const data = frame.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      if (data === '[DONE]') { done = true; return; }
      yield JSON.parse(data);
    }
  }
  if (!done) throw new Error('provider_outcome_unknown');
}
export function normalizedUsage(u) {
  if (!u || !Number.isSafeInteger(u.prompt_tokens) || u.prompt_tokens < 0 || !Number.isSafeInteger(u.completion_tokens) || u.completion_tokens < 0) throw new Error('usage_missing');
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  if (!Number.isSafeInteger(cached) || cached < 0 || cached > u.prompt_tokens) throw new Error('usage_invalid');
  return { inputTokens: u.prompt_tokens - cached, outputTokens: u.completion_tokens, cacheReadTokens: cached, ...(u.total_tokens === u.prompt_tokens + u.completion_tokens ? { totalTokens: u.total_tokens } : {}), ...(Number.isSafeInteger(u.completion_tokens_details?.reasoning_tokens) ? { reasoningTokens: u.completion_tokens_details.reasoning_tokens } : {}) };
}
// Transport has no retries. The issuer durably reserves BEFORE any network call.
export async function* streamOpenRouter(options, { accounting, apiKey, fetchImpl = fetch, attribution = {}, beforeDispatch = async () => {} }) {
  const signal = AbortSignal.any([AbortSignal.timeout(120000), ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  if (!apiKey) throw new Error('openrouter_not_configured');
  const negotiation = await accounting.policy();
  if (!/^[a-f0-9]{64}$/.test(negotiation?.policyHash)) throw new Error('accounting_policy_invalid');
  const body = requestBody(options, negotiation.policy);
  // Serialize ONCE before awaiting reservation. Caller mutations cannot change
  // the body, tools, reasoning, route or limits after a permit is obtained.
  const rawBody = JSON.stringify(body), hash = createHash('sha256').update(rawBody).digest('hex');
  if (Buffer.byteLength(rawBody) > negotiation.policy.maxRequestBytes) throw new Error('request_too_large');
  signal.throwIfAborted();
  const permit = await accounting.reserve({ sessionId: options.sessionId, requestHash: hash, route: body.model, maxOutputTokens: body.max_tokens, requestBytes: Buffer.byteLength(rawBody), purpose: 'conversation', requestId: options.requestId ?? hash, requestBody: rawBody, policyHash: negotiation.policyHash });
  if (!permit?.durable || !permit.reservationId || permit.requestHash !== hash || permit.route !== body.model || permit.policyHash !== negotiation.policyHash) throw new Error('accounting_reservation_invalid');
  let dispatched = false, settled = false, terminal = false, usage, responseId, resolvedModel, finish, text = '', reasoning = '';
  const calls = new Map(), reasoningDetails = [], routing = [], frames = [];
  let receivedBytes = 0;
  try {
    await beforeDispatch(); signal.throwIfAborted();
    // The authority checks current grant and binds a one-use dispatch identity.
    dispatched = true; // An issuer acknowledgement can itself be lost. Retain unknown.
    const dispatch = await accounting.dispatch({ reservationId: permit.reservationId, requestHash: hash });
    if (dispatch?.dispatched !== true) throw new Error('issuer_dispatch_refused');
    const response = await fetchImpl(OPENROUTER_URL, { method: 'POST', headers: { ...Object.fromEntries(Object.entries(attribution).filter(([k]) => ['HTTP-Referer', 'X-OpenRouter-Title'].includes(k))), 'X-OpenRouter-Metadata': 'enabled', Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: rawBody, signal, redirect: 'error' });
    if (!response.ok) throw new Error(`provider_http_${response.status}`);
    for await (const frame of sse(response.body)) {
      signal.throwIfAborted();
      receivedBytes += Buffer.byteLength(JSON.stringify(frame));
      if (receivedBytes > 2_000_000) throw new Error('response_too_large');
      frames.push(frame);
      if (frame.error) throw new Error('provider_stream_error');
      if (frame.id) { if (responseId && responseId !== frame.id) throw new Error('provider_identity_changed'); responseId = frame.id; }
      if (frame.model) resolvedModel = frame.model;
      if (frame.usage) usage = frame.usage;
      for (const k of ['provider', 'routing', 'router_metadata', 'openrouter_metadata']) if (frame[k] !== undefined) routing.push({ [k]: frame[k] });
      for (const choice of frame.choices ?? []) {
        if (choice.index !== undefined && choice.index !== 0) throw new Error('multiple_choices_unsupported');
        if (choice.finish_reason) finish = choice.finish_reason;
        const d = choice.delta ?? {};
        if (d.reasoning_details) reasoningDetails.push(...d.reasoning_details);
        if (d.content) { if (!text) yield { type: 'block-start', index: 0, blockType: 'text' }; text += d.content; yield { type: 'text-delta', index: 0, text: d.content }; }
        if (d.reasoning) { if (!reasoning) yield { type: 'block-start', index: 1, blockType: 'reasoning' }; reasoning += d.reasoning; yield { type: 'reasoning-delta', index: 1, text: d.reasoning }; }
        for (const c of d.tool_calls ?? []) {
          if (!Number.isSafeInteger(c.index) || c.index < 0 || c.index > 32) throw new Error('invalid_tool_index');
          let call = calls.get(c.index);
          if (!call) { call = { type: 'tool-call', id: '', name: '', arguments: '' }; calls.set(c.index, call); }
          if (c.id) { if (call.id && call.id !== c.id) throw new Error('tool_identity_changed'); call.id = c.id; }
          if (c.function?.name) call.name += c.function.name;
          call.arguments += c.function?.arguments ?? '';
          // Tool execution is exposed only after complete parsing and receipt retention.
        }
      }
      if (text.length + reasoning.length + [...calls.values()].reduce((n, c) => n + c.arguments.length, 0) > 1_000_000) throw new Error('response_too_large');
    }
    terminal = true;
    const normalized = normalizedUsage(usage);
    if (!responseId || !resolvedModel || !finish) throw new Error('incomplete_provider_identity');
    for (const c of calls.values()) { if (!c.id || !c.name) throw new Error('incomplete_tool_call'); JSON.parse(c.arguments); }
    const replayState = { response: { id: responseId, model: resolvedModel, usage, reasoning_details: reasoningDetails, routing, session_id: body.session_id, finish_reason: finish, frames } };
    const retained = await accounting.retain({ reservationId: permit.reservationId, requestHash: hash, outcome: 'received', terminal: true, responseId, resolvedModel, usage, replayState });
    if (retained?.retained !== true) throw new Error('issuer_retention_unconfirmed');
    settled = true;
    if (text) yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    if (reasoning) yield { type: 'block-end', index: 1, block: { type: 'reasoning', text: reasoning } };
    for (const [index, c] of calls) {
      yield { type: 'block-start', index: index + 2, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: index + 2, id: c.id, name: c.name, argumentsDelta: c.arguments };
      yield { type: 'block-end', index: index + 2, block: c };
    }
    yield { type: 'usage', usage: normalized };
    yield { type: 'finish', reason: { kind: finish === 'tool_calls' ? 'tool-calls' : finish === 'length' ? 'max-tokens' : finish === 'stop' ? 'stop' : 'error', ...(!['tool_calls', 'length', 'stop'].includes(finish) ? { failure: { code: 'provider_finish', message: 'Provider did not complete the response.' } } : {}) }, replayState };
  } finally {
    // Async-iterator return() skips catch when a consumer closes at a yield.
    // Keep observed evidence on every unsettled exit; never replay dispatch.
    if (!settled) {
      try { const retained = await accounting.retain({ reservationId: permit.reservationId, requestHash: hash, outcome: dispatched ? 'unknown' : 'not_dispatched', terminal, ...(responseId ? { responseId } : {}), ...(usage ? { usage } : {}), ...(resolvedModel ? { resolvedModel } : {}), replayState: { response: { frames, reasoning_details: reasoningDetails, routing } } }); if (retained?.retained !== true) throw new Error('issuer_retention_unconfirmed'); }
      catch { throw new Error('accounting_retention_failed_unknown_liability'); }
    }
  }
}

// Explicit recovery only: one read-only GET for an ID retained on this attempt.
// There is no inference fallback, retry loop, key lookup, or automatic scheduling.
export async function reconcileOpenRouterReceipt({ reservationId, requestHash, responseId },
  { accounting, apiKey, fetchImpl = fetch, signal }) {
  if (!reservationId || !/^[a-f0-9]{64}$/.test(requestHash) || typeof responseId !== 'string' || !responseId || responseId.length > 200) throw new Error('reconciliation_identity_required');
  if (!apiKey) throw new Error('openrouter_not_configured');
  const url = new URL('https://openrouter.ai/api/v1/generation');
  url.searchParams.set('id', responseId);
  const response = await fetchImpl(url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) });
  if (!response.ok) throw new Error('generation_lookup_unavailable');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength;
    if (bytes > 1_000_000) throw new Error('generation_lookup_too_large');
    chunks.push(Buffer.from(chunk));
  }
  const generation = JSON.parse(Buffer.concat(chunks).toString('utf8')).data;
  if (generation?.id !== responseId || typeof generation.model !== 'string' || !generation.model
      || typeof generation.finish_reason !== 'string' || !generation.finish_reason
      || typeof generation.total_cost !== 'number' || !Number.isFinite(generation.total_cost) || generation.total_cost < 0)
    throw new Error('generation_lookup_incomplete_or_conflicting');
  const retained = await accounting.retain({ reservationId, requestHash, responseId, resolvedModel: generation.model,
    outcome: 'reconciled', terminal: true, generation });
  if (retained?.retained !== true) throw new Error('issuer_retention_unconfirmed');
  return retained;
}
