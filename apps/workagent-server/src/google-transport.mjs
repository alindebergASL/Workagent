import { randomUUID } from 'node:crypto';

export const GOOGLE_SCOPES = Object.freeze({ sheets: 'https://www.googleapis.com/auth/spreadsheets.readonly', docs: 'https://www.googleapis.com/auth/documents' });
export class GoogleAdapterError extends Error {
  constructor(code, details = {}) { super(code); this.name = 'GoogleAdapterError'; this.code = code; Object.assign(this, { outcome: 'not_started', ...details }); }
}
export const googleFail = (code, details) => { throw new GoogleAdapterError(code, details); };
const official = Object.freeze({ sheets: 'https://sheets.googleapis.com', docs: 'https://docs.googleapis.com', oauth: 'https://oauth2.googleapis.com' });
const synthetic = value => typeof value === 'string' && /^SIMULATED_[A-Za-z0-9_-]+$/.test(value);

// Only trusted server construction can choose simulation. No per-request URL,
// redirect following, ambient environment credentials, or injected live fetch.
export function googleTransport({ credentials = {}, simulationOrigin, timeoutMs = 5000, maxResponseBytes = 4_000_000 } = {}) {
  const simulation = simulationOrigin !== undefined;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 4_000_000) googleFail('invalid_transport_bounds');
  let origins = official;
  if (simulation) {
    let u; try { u = new URL(simulationOrigin); } catch { googleFail('invalid_simulation_origin'); }
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.username || u.password || u.pathname !== '/' || u.search || u.hash) googleFail('invalid_simulation_origin');
    origins = { sheets: u.origin, docs: u.origin, oauth: u.origin };
  }
  let tokens = structuredClone(credentials);
  function checkTokens() {
    for (const field of ['accessToken', 'refreshToken', 'clientId', 'clientSecret']) {
      const value = tokens[field];
      if (value !== undefined && (typeof value !== 'string' || !value || /[\r\n]/.test(value) || value.length > 8192 || (simulation ? !synthetic(value) : value.startsWith('SIMULATED_')))) googleFail('invalid_credential_kind');
    }
    if (tokens.expiresAt !== undefined && !Number.isFinite(tokens.expiresAt)) googleFail('invalid_token_expiry');
  }
  checkTokens();
  async function wire(service, path, { method = 'GET', body, token, form, requestId = randomUUID(), documentId, effect = false } = {}) {
    if (!Object.hasOwn(origins, service) || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) googleFail('invalid_google_path');
    const url = new URL(path, origins[service]);
    if (url.origin !== origins[service] || url.username || url.password || url.hash) googleFail('invalid_google_path');
    const details = { requestId, ...(documentId ? { documentId } : {}) };
    let response, raw;
    try {
      response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}) },
        ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}) });
      if (response.status >= 300 && response.status < 400 || response.url !== url.href) { await response.body?.cancel(); googleFail('google_redirect_refused', { ...details, outcome: effect ? 'unknown' : 'refused' }); }
      const limit = Number(response.headers.get('content-length'));
      if (limit > maxResponseBytes) { await response.body?.cancel(); googleFail('google_response_too_large', { ...details, outcome: effect ? 'unknown' : 'refused' }); }
      let length = 0; const chunks = [];
      if (!response.body) throw new Error('missing body');
      for await (const chunk of response.body) { length += chunk.length; if (length > maxResponseBytes) googleFail('google_response_too_large', { ...details, outcome: effect ? 'unknown' : 'refused' }); chunks.push(chunk); }
      raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } catch (e) {
      if (e instanceof GoogleAdapterError) throw e;
      // Never expose fetch causes/URLs, bearer tokens, or provider response text.
      googleFail('google_transport_failed', { ...details, outcome: effect ? 'unknown' : 'transient' });
    }
    let data; try { data = JSON.parse(raw); } catch { googleFail('google_invalid_response', { ...details, status: response.status, outcome: effect ? 'unknown' : 'refused' }); }
    if (!response.ok) {
      const code = ({ 400: service === 'oauth' && data.error === 'invalid_grant' ? 'google_invalid_grant' : 'google_invalid_argument', 401: 'google_unauthenticated', 403: 'google_forbidden', 404: 'google_not_found', 429: 'google_rate_limited' })[response.status] ?? 'google_service_error';
      googleFail(code, { ...details, status: response.status, outcome: response.status >= 500 ? (effect ? 'unknown' : 'transient') : 'refused' });
    }
    return { data, requestId };
  }
  async function refresh() {
    if (!tokens.refreshToken || !tokens.clientId || !tokens.clientSecret) googleFail('google_refresh_unavailable', { outcome: 'refused' });
    // OAuth reference: https://developers.google.com/identity/protocols/oauth2/web-server
    const { data } = await wire('oauth', '/token', { method: 'POST', form: true, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: tokens.clientId, client_secret: tokens.clientSecret }).toString() });
    if (!data || typeof data.access_token !== 'string' || data.token_type !== 'Bearer' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) googleFail('google_invalid_token_response');
    tokens = { ...tokens, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }; checkTokens();
  }
  return Object.freeze({
    provenance: Object.freeze({ provider: 'google', mode: simulation ? 'simulation' : 'live', synthetic: simulation, connectionVerified: false, ...(simulation ? { actualGoogleAccount: false } : {}) }),
    // One refresh budget across an entire import/delivery, including readback.
    session() {
      let refreshed = false;
      return async (service, path, options = {}) => {
        if (!tokens.accessToken) googleFail('google_token_missing', { dispatched: false });
        const once = async () => {
          if (refreshed) googleFail('google_unauthenticated', { outcome: 'refused', dispatched: false });
          refreshed = true;
          try { await refresh(); } catch (e) { e.dispatched = false; throw e; }
        };
        if (tokens.expiresAt !== undefined && tokens.expiresAt <= Date.now()) await once();
        try { return await wire(service, path, { ...options, token: tokens.accessToken }); }
        catch (e) { if (e.status !== 401 || refreshed) throw e; await once(); return wire(service, path, { ...options, token: tokens.accessToken }); }
      };
    },
  });
}
