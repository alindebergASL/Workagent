// Parent-only executable: isolated PG metadata + retained native SQLite content.
// Never imported by the installed application. No providers or legacy routes.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import pg from 'pg';
import { SQLiteDatabaseAdapter } from '@univerjs-pro/collaboration-database-sqlite';
import { ErrorCode } from '@univerjs/protocol';
import { Workspace } from './workspace.mjs';
import { PostgresStore } from './store.mjs';
import { NATIVE_UNIT, allowedNativeAction, validateNativeOrigin } from './native-collaboration.mjs';
import { nativeQualificationConfig, nativeDatabaseIdentity, openNativeStorage } from './native-qualification-storage.mjs';
// Validate every required setting before connecting or writing either store.
const config = nativeQualificationConfig(process.env);
const { owner, origin, accounts, auth } = config;
const pool = new pg.Pool({ connectionString: config.databaseURL, max: 4 });
let leadership, workspace, native;
try {
  leadership = await pool.connect();
  if (!(await leadership.query('SELECT pg_try_advisory_lock(721013001) AS acquired')).rows[0].acquired) throw new Error('workspace_already_active');
  const databaseID = await nativeDatabaseIdentity(pool, config);
  workspace = new Workspace(new PostgresStore(pool, owner), { peers: accounts });
  native = await openNativeStorage({ config, workspace, databaseID, makeAdapter: options => new SQLiteDatabaseAdapter(options) });
} catch (e) {
  leadership?.release(); await pool.end();
  throw new Error(e.nativeCode ?? 'native_startup_failed');
}
const root = resolve('apps/workagent-client/dist-native');
async function body(req) { let text = ''; for await (const c of req) { text += c; if (text.length > 100000) throw new Error('request_too_large'); } return JSON.parse(text); }
const server = http.createServer(async (req, res) => {
  const send = (status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'");
  try {
    validateNativeOrigin(req, origin);
    const path = new URL(req.url, origin).pathname;
    if (path === '/api/session' && req.method === 'POST') {
      const cookie = auth.login((await body(req)).token);
      res.setHeader('Set-Cookie', `workagent_session=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith('https:') ? '; Secure' : ''}`);
      return send(200, { authenticated: true });
    }
    if (path.startsWith('/api/') || path.startsWith('/universer-api/')) {
      const principal = auth.authenticate(req);
      if (path === '/api/native/session' && req.method === 'GET') {
        return await native.authority.fence(principal, NATIVE_UNIT, false, access => send(200, { ...auth.profile(principal), unitID: NATIVE_UNIT, access, peer: principal === owner ? accounts[0].id : undefined }));
      }
      if (path === '/api/native/sharing' && req.method === 'POST') {
        const result = await workspace.share(principal, NATIVE_UNIT, await body(req));
        await native.endpoint.invalidateUnitSessions({ unitID: NATIVE_UNIT });
        return send(200, result);
      }
      if (path === '/universer-api/authz/-/object/-/batch_allowed' && req.method === 'POST') {
        const input = await body(req);
        if (!Array.isArray(input.requests) || input.requests.length > 100) return send(400, { error: 'invalid_permissions' });
        return await native.authority.fence(principal, NATIVE_UNIT, false, access => send(200, { error: { code: ErrorCode.OK, message: '' }, objectActions: input.requests.map(r => ({ unitID: r.unitID, objectID: r.objectID, actions: (Array.isArray(r.actions) ? r.actions : []).map(action => ({ action, allowed: r.unitID === NATIVE_UNIT && allowedNativeAction(access.role, action) })) })) }));
      }
      if (path.startsWith('/universer-api/')) return native.transport.handleRequest(req, res);
      return send(409, { error: 'native_only_legacy_paths_disabled' });
    }
    if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
    const file = path === '/' ? resolve(root, 'native.html') : resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) return send(404, {});
    const data = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream'); res.end(data);
  } catch (e) { if (!res.writableEnded) send(e.status ?? (e.code === 'PERMISSION_DENIED' ? 403 : 400), { error: e.code ?? e.message }); }
});
server.on('upgrade', (req, socket, head) => native.transport.handleUpgrade(req, socket, head));
server.listen(config.port, '127.0.0.1', () => console.log('Synthetic native qualification listening on loopback'));
let closing;
const close = () => closing ??= (async () => { const stopped = new Promise(resolve => server.close(resolve)); await native.close(); await stopped; leadership.release(); await pool.end(); })();
leadership.on('error', () => void close());
process.on('SIGINT', () => void close()); process.on('SIGTERM', () => void close());
