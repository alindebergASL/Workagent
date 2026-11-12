// Parent-only explicit initialization after applying 0001_workspace.sql in a fresh DB.
import pg from 'pg';
import { initialState } from './store.mjs';
if (process.env.WORKAGENT_DISPOSABLE_SCHEMA !== 'workagent_b01') throw new Error('explicit_disposable_schema_required');
if (!process.env.WORKAGENT_DATABASE_URL || !process.env.WORKAGENT_OWNER_ID) throw new Error('database_and_owner_required');
const pool = new pg.Pool({ connectionString: process.env.WORKAGENT_DATABASE_URL });
try { await pool.query('INSERT INTO workagent_b01.workspace (id, data) VALUES ($1, $2::jsonb)', [process.env.WORKAGENT_OWNER_ID, JSON.stringify(initialState(process.env.WORKAGENT_OWNER_ID))]); }
finally { await pool.end(); }
