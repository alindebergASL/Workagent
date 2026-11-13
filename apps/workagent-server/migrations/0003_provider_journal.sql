-- Parent applies additively to the existing product DB, never alpha. No legacy writes.
BEGIN;
CREATE SCHEMA workagent_provider;
REVOKE ALL ON SCHEMA workagent_provider FROM PUBLIC;
CREATE TABLE workagent_provider.journal (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_key text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('prepared','dispatched','received','unknown','not_dispatched','reconciled')),
  data jsonb NOT NULL CHECK(jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(request_key, kind)
);
CREATE UNIQUE INDEX provider_request_body_once ON workagent_provider.journal
  ((data->>'sessionId'), (data->>'requestHash')) WHERE kind='prepared';
CREATE UNIQUE INDEX provider_generation_once ON workagent_provider.journal
  ((data->>'responseId')) WHERE kind='received' AND data->>'responseId' IS NOT NULL;
-- Serialize exact generation ownership across receipt kinds and requests.
CREATE FUNCTION workagent_provider.bind_generation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE response_id text := NEW.data->>'responseId';
BEGIN
  IF response_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(response_id, 721013003));
    IF EXISTS(SELECT 1 FROM workagent_provider.journal WHERE data->>'responseId'=response_id AND request_key<>NEW.request_key)
    THEN RAISE EXCEPTION 'provider_generation_identity_conflict'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bind_generation BEFORE INSERT ON workagent_provider.journal
FOR EACH ROW EXECUTE FUNCTION workagent_provider.bind_generation();
CREATE FUNCTION workagent_provider.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'provider_journal_is_append_only'; END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON workagent_provider.journal
FOR EACH STATEMENT EXECUTE FUNCTION workagent_provider.immutable();
REVOKE ALL ON ALL TABLES IN SCHEMA workagent_provider FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA workagent_provider FROM PUBLIC;
COMMIT;
-- Parent grants the existing application role USAGE on this schema and sequence,
-- and SELECT, INSERT on journal only. Keep DDL ownership in the installer role.
