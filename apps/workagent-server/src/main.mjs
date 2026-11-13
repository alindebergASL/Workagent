import pg from 'pg';
import { resolve } from 'node:path';
import { PostgresStore } from './store.mjs';
import { Workspace } from './workspace.mjs';
import { createServer } from './http.mjs';
import { bootHost } from '../../workagent-runner/src/host.mjs';
import { createDispatcher } from '../../workagent-runner/src/dispatch.mjs';
import { DisabledAccounting, IssuerSocketAccounting } from '../../workagent-runner/src/accounting.mjs';
import { OpenRouterAccounting, PostgresProviderJournal } from '../../workagent-runner/src/provider-accounting.mjs';
import { outputAllowance, requestTimeout } from '../../workagent-runner/src/wire.mjs';
// Parent supplies these variables on the dedicated server. No dotenv/ambient files.
const required = name => { if (!process.env[name]) throw new Error(`${name}_required`); return process.env[name]; };
const owner = required('WORKAGENT_OWNER_ID'), token = required('WORKAGENT_AUTH_TOKEN'), origin = required('WORKAGENT_ORIGIN');
const hostname = process.env.WORKAGENT_BIND ?? '127.0.0.1';
if (hostname !== '127.0.0.1' && hostname !== '10.0.14.244') throw new Error('private_bind_required');
if (!origin.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) throw new Error('encrypted_remote_origin_required');
const pool = new pg.Pool({ connectionString: required('WORKAGENT_DATABASE_URL'), max: 3 });
// One writer across processes, independently of HTTP clients. Never steal a lock.
const leadership = await pool.connect();
if (!(await leadership.query('SELECT pg_try_advisory_lock(721013001) AS acquired')).rows[0].acquired) throw new Error('runner_already_active');
const workspace = new Workspace(new PostgresStore(pool, owner));
const mode = process.env.WORKAGENT_ACCOUNTING_MODE ?? 'certificate';
if (!['certificate', 'openrouter'].includes(mode)) throw new Error('invalid_accounting_mode');
const maxOutputTokens = outputAllowance(process.env.WORKAGENT_MAX_OUTPUT_TOKENS);
const accounting = mode === 'openrouter'
  ? new OpenRouterAccounting({ journal: new PostgresProviderJournal(pool), apiKey: process.env.OPENROUTER_API_KEY, model: process.env.WORKAGENT_MODEL, maxOutputTokens })
  : process.env.WORKAGENT_ISSUER_SOCKET ? new IssuerSocketAccounting(process.env.WORKAGENT_ISSUER_SOCKET) : new DisabledAccounting();
const host = await bootHost({ stateRoot: resolve(required('WORKAGENT_STATE_DIR')), workspace, principal: owner,
  accounting, maxOutputTokens, requestTimeoutMs: requestTimeout(process.env.WORKAGENT_REQUEST_TIMEOUT_MS), reasoningEffort: process.env.WORKAGENT_REASONING_EFFORT,
  apiKey: process.env.OPENROUTER_API_KEY, model: process.env.WORKAGENT_MODEL });
await workspace.recover(owner, host.inspect);
const dispatcher = createDispatcher({ workspace, principal: owner, host, capacity: 2, onError() { console.error('workspace_dispatch_failed'); } });
const server = createServer({ workspace, owner, token, origin, accounting, clientRoot: resolve('apps/workagent-client/dist'), onCommand(workId, kind, intentRevision) {
  if (kind !== 'start') host.cancel(workId, intentRevision);
  dispatcher.wake();
} });
const timer = setInterval(() => dispatcher.wake(), 1500);
server.listen(Number(process.env.WORKAGENT_PORT ?? 8310), hostname, () => console.log('Workagent private service listening'));
dispatcher.wake();
let shutdown;
function close() { return shutdown ??= (async () => { clearInterval(timer); server.close(); await dispatcher.close(); await host.close(); leadership.release(); await pool.end(); })(); }
leadership.on('error', () => { console.error('workspace_leadership_lost'); void close().catch(() => { console.error('workspace_shutdown_failed'); }); });
process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
