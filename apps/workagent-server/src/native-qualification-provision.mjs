// PARENT ONLY: explicitly create a new dedicated qualification storage pair.
import pg from 'pg';
import { Workspace } from './workspace.mjs';
import { PostgresStore } from './store.mjs';
import { nativeQualificationConfig, nativeDatabaseIdentity, provisionNativeStorage } from './native-qualification-storage.mjs';
let pool, leadership;
try {
  const config = nativeQualificationConfig(process.env);
  if (process.env.WORKAGENT_NATIVE_PROVISION !== 'new-owned-pair') throw new Error('explicit_provision_required');
  pool = new pg.Pool({ connectionString: config.databaseURL, max: 2 });
  leadership = await pool.connect();
  if (!(await leadership.query('SELECT pg_try_advisory_lock(721013001) AS acquired')).rows[0].acquired) throw new Error('workspace_already_active');
  const databaseID = await nativeDatabaseIdentity(pool, config);
  const workspace = new Workspace(new PostgresStore(pool, config.owner), { peers: config.accounts });
  await provisionNativeStorage({ config, workspace, databaseID });
  console.log('Fresh native qualification storage pair provisioned');
} catch (e) { console.error(e.nativeCode ?? 'native_provision_failed'); process.exitCode = 1; }
finally { leadership?.release(); await pool?.end(); }
