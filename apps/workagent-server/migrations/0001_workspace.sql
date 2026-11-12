-- Parent only: run against explicitly disposable product PostgreSQL, never alpha.
CREATE SCHEMA IF NOT EXISTS workagent_b01;
CREATE TABLE IF NOT EXISTS workagent_b01.workspace (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object')
);
-- Initialization is a separate explicit command; no startup migration or reset.
