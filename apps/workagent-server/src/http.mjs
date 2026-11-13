import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Fault } from '../../../packages/workagent-contract/index.mjs';
const equal = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export function identity({ token, origin, owner }) {
  if (!token || token.length < 32) throw new Error('WORKAGENT_AUTH_TOKEN_must_be_at_least_32_characters');
  const sign = x => createHmac('sha256', token).update(x).digest('base64url');
  return {
    login(value) { if (typeof value !== 'string' || !equal(value, token)) throw new Fault('access_denied', 401); const expiry = String(Date.now() + 8 * 3600_000); return `${expiry}.${sign(expiry)}`; },
    authenticate(req) {
      if (req.headers.authorization && equal(req.headers.authorization, `Bearer ${token}`)) return owner;
      const cookie = /(?:^|;\s*)workagent_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
      const [expiry, signature = ''] = cookie.split('.');
      if (!/^\d+$/.test(expiry ?? '') || +expiry < Date.now() || !equal(signature, sign(expiry))) throw new Fault('access_denied', 401);
      return owner;
    },
    origin(req) { if (req.method !== 'GET' && req.headers.origin !== origin) throw new Fault('origin_denied', 403); },
  };
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Fault('json_required', 415);
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 4_500_000) throw new Fault('request_too_large', 413); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new Fault('invalid_json', 400); }
}
export function createServer(options) { return http.createServer(createHandler(options)); }
export function createHandler({ workspace, maintenance, exchange, xlsx, owner, token, origin, clientRoot, accounting, onCommand = () => {} }) {
  const auth = identity({ token, origin, owner }), root = resolve(clientRoot);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'");
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url, origin).pathname;
      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET') throw new Fault('not_found', 404);
        const file = resolve(root, path === '/' ? 'index.html' : `.${path}`);
        if (!file.startsWith(root + sep)) throw new Fault('not_found', 404);
        const content = await readFile(file); const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(content); return;
      }
      auth.origin(req);
      if (path === '/api/session' && req.method === 'POST') {
        const value = await body(req), cookie = auth.login(value.token);
        res.setHeader('Set-Cookie', `workagent_session=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith('https:') ? '; Secure' : ''}`);
        return send(200, { authenticated: true });
      }
      const principal = auth.authenticate(req);
      if (path === '/api/accounting' && req.method === 'GET') {
        await workspace.list(principal); // Includes current access/revocation checks.
        return send(200, accounting?.status ? await accounting.status() : { mode: 'disabled' });
      }
      if (path === '/api/events' && req.method === 'GET') {
        const after = new URL(req.url, origin).searchParams.get('after');
        if (after !== null && !/^\d+$/.test(after)) throw new Fault('invalid_cursor', 400);
        return send(200, await workspace.events(principal, after === null ? undefined : Number(after)));
      }
      if (path === '/api/session' && req.method === 'DELETE') { res.setHeader('Set-Cookie', 'workagent_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return send(200, {}); }
      if (path === '/api/work' && req.method === 'GET') return send(200, await workspace.list(principal));
      if (path === '/api/work/blank' && req.method === 'POST') return send(200, await workspace.createBlank(principal, await body(req)));
      if (exchange && path === '/api/exchange/csv/preview' && req.method === 'POST') return send(200, await exchange.preview(principal, await body(req)));
      if (exchange && path === '/api/exchange/csv/import' && req.method === 'POST') return send(200, await exchange.import(principal, await body(req)));
      if (xlsx && path === '/api/exchange/xlsx/preview' && req.method === 'POST') return send(200, await xlsx.preview(principal, await body(req)));
      if (xlsx && path === '/api/exchange/xlsx/import' && req.method === 'POST') return send(200, await xlsx.import(principal, await body(req)));
      if (xlsx && path === '/api/exchange/xlsx/export' && req.method === 'POST') return send(200, await xlsx.export(principal, await body(req)));
      const original = /^\/api\/work\/([a-zA-Z0-9_-]+)\/original\/([a-zA-Z0-9_-]+)$/.exec(path);
      if (exchange && original && req.method === 'GET') {
        const result = await exchange.original(principal, original[1], original[2]);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="original.${result.original.format === 'xlsx' ? 'xlsx' : 'csv'}"; filename*=UTF-8''${encodeURIComponent(result.original.filename).replace(/'/g, '%27')}`, 'Content-Length': result.bytes.length });
        res.end(result.bytes); return;
      }
      if (path === '/api/sources' && req.method === 'POST') return send(200, await workspace.source(principal, await body(req)));
      if (maintenance && path === '/api/owned-sources' && req.method === 'GET') return send(200, await maintenance.sources(principal));
      if (maintenance && path === '/api/owned-sources' && req.method === 'POST') return send(200, await maintenance.publish(principal, await body(req)));
      const ownedSource = /^\/api\/owned-sources\/([a-zA-Z0-9_-]+)\/revoke$/.exec(path);
      if (maintenance && ownedSource && req.method === 'POST') return send(200, await maintenance.revokeSource(principal, ownedSource[1], await body(req)));
      const responsibility = /^\/api\/work\/([a-zA-Z0-9_-]+)\/responsibilities(?:\/([a-zA-Z0-9_-]+))?$/.exec(path);
      if (maintenance && responsibility && req.method === 'POST') {
        const input = await body(req);
        return send(200, responsibility[2] ? await maintenance.manage(principal, responsibility[1], responsibility[2], input) : await maintenance.create(principal, responsibility[1], input));
      }
      if (path === '/api/work/commands' && req.method === 'POST') {
        const input = await body(req), { result, admitted } = await workspace.admitCommand(principal, input);
        if (admitted) onCommand(result.workId, input.kind, result.intentRevision);
        return send(202, result);
      }
      const m = /^\/api\/work\/([a-zA-Z0-9_-]+)(?:\/(save|proposals)(?:\/([a-zA-Z0-9_-]+))?)?$/.exec(path);
      if (m && req.method === 'GET' && !m[2]) return send(200, await workspace.get(principal, m[1]));
      if (m && req.method === 'POST' && m[2] === 'save') return send(200, await workspace.save(principal, m[1], await body(req)));
      if (m && req.method === 'POST' && m[2] === 'proposals' && m[3]) return send(200, await workspace.decide(principal, m[1], m[3], await body(req)));
      throw new Fault('not_found', 404);
    } catch (e) { send(e instanceof Fault ? e.status : e.code === 'ENOENT' ? 404 : 500, { error: e instanceof Fault ? e.code : 'service_unavailable' }); }
  };
}
