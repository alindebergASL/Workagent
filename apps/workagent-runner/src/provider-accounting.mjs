import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { DEFAULT_MODEL, DEFAULT_MAX_OUTPUT_TOKENS, outputAllowance, providerText } from './wire.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const amount = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function keyBudget(data) {
  if (!data || !amount(data.usage) || !(data.limit === null || amount(data.limit))
      || !(data.limit_remaining === null || typeof data.limit_remaining === 'number' && Number.isFinite(data.limit_remaining))
      || !(data.limit_reset === null || typeof data.limit_reset === 'string')) fail('provider_budget_metadata_invalid');
  const budgets = data.budgets ?? [], effective = data.effective_budget ?? null;
  if (effective !== null && (typeof effective !== 'object' || Array.isArray(effective))) fail('provider_budget_metadata_invalid');
  if (!Array.isArray(budgets) || [...budgets, ...(effective ? [effective] : [])].some(b => !amount(b.limit_usd) || !amount(b.spend_usd) || typeof b.remaining_usd !== 'number' || !Number.isFinite(b.remaining_usd))) fail('provider_budget_metadata_invalid');
  // This is an observation of shared-key spend, never a reservation or project spend.
  return { observedAt: new Date().toISOString(), limit: data.limit, limit_remaining: data.limit_remaining, limit_reset: data.limit_reset, usage: data.usage, budgets, effective_budget: effective };
}
export class PostgresProviderJournal {
  constructor(pool) { this.pool = pool; }
  async transaction(id, fn) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 721013002))', [id]);
      const { rows } = await c.query('SELECT kind, data FROM workagent_provider.journal WHERE request_key=$1 ORDER BY sequence', [id]);
      const result = await fn(rows, async (kind, data) => {
        await c.query('INSERT INTO workagent_provider.journal(request_key,kind,data) VALUES($1,$2,$3::jsonb)', [id, kind, JSON.stringify(data)]);
      });
      await c.query('COMMIT'); return result;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async status() {
    const { rows } = await this.pool.query(`SELECT kind, CASE WHEN kind='prepared' THEN jsonb_build_object('reservationId',data->'reservationId','keySnapshot',data->'keySnapshot') ELSE data - 'replayState' - 'generation' END AS data FROM workagent_provider.journal ORDER BY sequence`);
    return journalStatus(rows);
  }
}
export function journalStatus(rows) {
  const prepared = rows.filter(r => r.kind === 'prepared');
  const finals = rows.filter(r => ['received', 'reconciled'].includes(r.kind) && r.data.monetaryState === 'provider_reported');
  const costs = new Map(); for (const r of finals) costs.set(r.data.reservationId, r.data.reportedCostUsd);
  const closed = new Set([...costs.keys(), ...rows.filter(r => r.kind === 'not_dispatched').map(r => r.data.reservationId)]);
  return { mode: 'openrouter', providerReportedCostUsd: [...costs.values()].reduce((a, b) => a + b, 0), verifiedInvoiceCostUsd: null,
    unresolvedRequests: prepared.filter(r => !closed.has(r.data.reservationId)).length,
    baselineKeySnapshot: prepared[0]?.data.keySnapshot ?? null, latestKeySnapshot: prepared.at(-1)?.data.keySnapshot ?? null,
    keySnapshotReservesFunds: false };
}
// Uses the same reserve/dispatch/retain seam, but reserve means durable request
// preparation ONLY. OpenRouter enforces its own limits; no local dollar ceiling.
export class OpenRouterAccounting {
  constructor({ journal, apiKey, fetchImpl = fetch, model = DEFAULT_MODEL, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS }) {
    this.journal = journal; this.apiKey = apiKey; this.fetchImpl = fetchImpl;
    this.document = { version: 3, pricingBasis: 'openrouter-key-budget-v1', route: model, maxOutputTokens: outputAllowance(maxOutputTokens), maxRequestBytes: 1_000_000,
      provider: { allow_fallbacks: false, require_parameters: true } };
    this.policyHash = sha(JSON.stringify(this.document));
  }
  async policy() { return { policy: structuredClone(this.document), policyHash: this.policyHash }; }
  status() { return this.journal.status(); }
  async reserve(r) {
    const body = JSON.parse(r.requestBody);
    if (r.policyHash !== this.policyHash || sha(r.requestBody) !== r.requestHash || Buffer.byteLength(r.requestBody) !== r.requestBytes
        || r.requestBytes > this.document.maxRequestBytes || r.route !== this.document.route || body.model !== r.route
        || body.session_id !== r.sessionId || !r.sessionId || !r.requestId || r.purpose !== 'conversation'
        || body.max_tokens !== r.maxOutputTokens || !Number.isSafeInteger(r.maxOutputTokens) || r.maxOutputTokens < 1 || r.maxOutputTokens > this.document.maxOutputTokens
        || JSON.stringify(body.provider) !== JSON.stringify(this.document.provider)) fail('provider_request_binding_invalid');
    const reservationId = sha(JSON.stringify([r.sessionId, r.requestId]));
    if (!this.apiKey) fail('openrouter_not_configured');
    const response = await this.fetchImpl('https://openrouter.ai/api/v1/key', { method: 'GET', headers: { Authorization: `Bearer ${this.apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) fail(`provider_http_${response.status}`);
    const keySnapshot = keyBudget(JSON.parse(await providerText(response)).data);
    if (keySnapshot.limit_remaining !== null && keySnapshot.limit_remaining <= 0
        || [...keySnapshot.budgets, ...(keySnapshot.effective_budget ? [keySnapshot.effective_budget] : [])].some(b => b.remaining_usd <= 0)) fail('provider_budget_exhausted');
    return this.journal.transaction(reservationId, async (events, append) => {
      if (events.length) fail('request_already_prepared_no_replay');
      await append('prepared', { ...r, reservationId, policy: this.document, keySnapshot });
      return { durable: true, reservationId, requestHash: r.requestHash, route: r.route, policyHash: r.policyHash };
    });
  }
  dispatch({ reservationId, requestHash }) {
    return this.journal.transaction(reservationId, async (events, append) => {
      const prepared = events.find(e => e.kind === 'prepared');
      if (!prepared || prepared.data.requestHash !== requestHash || events.length !== 1) fail('dispatch_refused_no_replay');
      await append('dispatched', { reservationId, requestHash }); return { dispatched: true };
    });
  }
  retain(r) {
    return this.journal.transaction(r.reservationId, async (events, append) => {
      const prepared = events.find(e => e.kind === 'prepared');
      if (!prepared || prepared.data.requestHash !== r.requestHash || !['received', 'unknown', 'not_dispatched', 'reconciled'].includes(r.outcome)) fail('receipt_binding_invalid');
      const dispatched = events.some(e => e.kind === 'dispatched');
      if (r.outcome === 'not_dispatched' ? dispatched || events.some(e => e.kind === 'unknown') : !dispatched) fail('receipt_lifecycle_conflict');
      const previous = events.filter(e => ['received', 'unknown', 'reconciled'].includes(e.kind));
      if (previous.some(e => e.data.responseId && r.responseId && e.data.responseId !== r.responseId
          || e.data.resolvedModel && r.resolvedModel && e.data.resolvedModel !== r.resolvedModel)) fail('receipt_identity_conflict');
      if (r.outcome === 'reconciled' && (!previous.some(e => e.data.responseId === r.responseId) || r.generation?.id !== r.responseId || r.generation?.model !== r.resolvedModel || !r.generation?.finish_reason)) fail('reconciliation_identity_required');
      const cost = r.outcome === 'reconciled' ? r.generation?.total_cost : r.usage?.cost;
      const monetary = ['received', 'reconciled'].includes(r.outcome) && r.terminal && r.responseId && r.resolvedModel && amount(cost);
      if (previous.some(e => e.data.monetaryState === 'provider_reported' && monetary && e.data.reportedCostUsd !== cost)) fail('receipt_cost_conflict');
      const data = { ...r, monetaryState: monetary ? 'provider_reported' : r.outcome === 'not_dispatched' ? 'not_dispatched' : 'unknown', reportedCostUsd: monetary ? cost : null };
      const prior = events.find(e => e.kind === r.outcome);
      if (prior) { if (!isDeepStrictEqual(prior.data, data)) fail('receipt_conflict'); }
      else await append(r.outcome, data);
      return { retained: true, settled: Boolean(monetary), monetaryState: data.monetaryState, reportedCostUsd: data.reportedCostUsd };
    });
  }
}
