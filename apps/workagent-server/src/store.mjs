import { Fault } from '../../../packages/workagent-contract/index.mjs';
export function initialState(owner) { return { owner, permissionRevision: 1, enabled: true, sequence: 0, works: {}, commands: {}, sources: {}, ownedSources: {}, observations: {}, jobs: {}, events: [] }; }
// Only this production store is wired into main. The parent provisions a fresh schema.
export class PostgresStore {
  constructor(pool, owner) { this.pool = pool; this.owner = owner; }
  async read(fn) {
    const { rows } = await this.pool.query('SELECT data FROM workagent_b01.workspace WHERE id = $1', [this.owner]);
    if (!rows.length) throw new Fault('workspace_not_provisioned', 503);
    return structuredClone(await fn(rows[0].data));
  }
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT data FROM workagent_b01.workspace WHERE id = $1 FOR UPDATE', [this.owner]);
      if (!rows.length) throw new Fault('workspace_not_provisioned', 503);
      const state = rows[0].data;
      const result = await fn(state);
      await client.query('UPDATE workagent_b01.workspace SET data = $2::jsonb WHERE id = $1', [this.owner, JSON.stringify(state)]);
      await client.query('COMMIT'); return structuredClone(result);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
}
