import pg from 'pg';
import { resolve } from 'node:path';
import { PostgresStore } from './store.mjs';
import { Workspace } from './workspace.mjs';
import { createServer } from './http.mjs';
import { bootHost } from '../../workagent-runner/src/host.mjs';
import { DisabledAccounting, IssuerSocketAccounting } from '../../workagent-runner/src/accounting.mjs';
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
await workspace.recover(owner);
const host = await bootHost({ stateRoot: resolve(required('WORKAGENT_STATE_DIR')), workspace, principal: owner,
  accounting: process.env.WORKAGENT_ISSUER_SOCKET ? new IssuerSocketAccounting(process.env.WORKAGENT_ISSUER_SOCKET) : new DisabledAccounting(),
  apiKey: process.env.OPENROUTER_API_KEY, model: process.env.WORKAGENT_MODEL });
let running = false, closing = false;
async function pump() {
  if (running || closing) return; running = true;
  try {
    let job;
    while (!closing && (job = await workspace.claim(owner))) {
      try { const messages = await host.run(job); await workspace.finish(owner, job, messages, 'ready'); }
      catch (e) {
        const known = ['accounting_bridge_not_connected', 'openrouter_not_configured', 'work_superseded', 'turn_call_limit'];
        const code = known.includes(e.message) ? e.message : 'execution_interrupted_check_receipt';
        await workspace.finish(owner, job, [], 'blocked', code);
      }
    }
  } catch { console.error('workspace_dispatch_failed'); } finally { running = false; }
}
const server = createServer({ workspace, owner, token, origin, clientRoot: resolve('apps/workagent-client/dist'), onCommand(workId, kind, intentRevision) {
  if (kind !== 'start') host.cancel(workId, intentRevision);
  void pump();
} });
const timer = setInterval(() => void pump(), 1500);
server.listen(Number(process.env.WORKAGENT_PORT ?? 8310), hostname, () => console.log('Workagent private service listening'));
void pump();
async function close() { closing = true; clearInterval(timer); server.close(); await host.close(); leadership.release(); await pool.end(); }
process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
