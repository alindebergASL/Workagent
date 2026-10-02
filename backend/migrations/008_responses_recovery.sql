-- One owner-approved successor; immutable original grant remains the budget root.
CREATE TABLE provider_consumer_successors (
 grant_id text PRIMARY KEY REFERENCES provider_grants(id),
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_consumer_successor BEFORE UPDATE OR DELETE ON provider_consumer_successors
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE FUNCTION guard_consumer_successor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g provider_grants;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='provider_grants'::regclass))
 THEN RAISE EXCEPTION 'operator approval required'; END IF;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.grant_id;
 PERFORM id FROM workspaces WHERE id=g.workspace_id FOR UPDATE;
 IF NOT g.active OR g.data->>'profile'<>'openai-responses-v1'
 OR NEW.data->>'grant_id' IS DISTINCT FROM NEW.grant_id
 OR NEW.data->>'original_consumer_sha256' IS DISTINCT FROM g.data->>'consumer_sha256'
 OR coalesce(NEW.data->>'successor_consumer_sha256','') !~ '^[0-9a-f]{64}$'
 OR NEW.data->>'successor_consumer_sha256'=NEW.data->>'original_consumer_sha256'
 OR coalesce(NEW.data->>'original_grant_sha256','') !~ '^[0-9a-f]{64}$'
 OR NEW.data->>'expires_at' IS NULL
 OR (NEW.data->>'expires_at')::timestamptz<=now()
 OR (NEW.data->>'expires_at')::timestamptz>now()+interval '1 hour'
 THEN RAISE EXCEPTION 'invalid successor approval'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_consumer_successor BEFORE INSERT ON provider_consumer_successors
 FOR EACH ROW EXECUTE FUNCTION guard_consumer_successor();
CREATE TABLE responses_consumer_uses (
 attempt_id text PRIMARY KEY REFERENCES provider_attempts(id),
 grant_id text NOT NULL REFERENCES provider_consumer_successors(grant_id),
 original_consumer_sha256 text NOT NULL,
 actual_consumer_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_consumer_use BEFORE UPDATE OR DELETE ON responses_consumer_uses
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE FUNCTION guard_consumer_use() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM provider_consumer_successors s JOIN provider_grants g ON g.id=s.grant_id
   JOIN provider_attempts a ON a.grant_id=g.id WHERE a.id=NEW.attempt_id AND g.id=NEW.grant_id AND g.active
   AND a.data->>'consumer_sha256'=NEW.original_consumer_sha256
   AND s.data->>'original_consumer_sha256'=NEW.original_consumer_sha256
   AND s.data->>'successor_consumer_sha256'=NEW.actual_consumer_sha256
   AND (s.data->>'expires_at')::timestamptz>now())
 THEN RAISE EXCEPTION 'exact approved successor required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_consumer_use BEFORE INSERT ON responses_consumer_uses
 FOR EACH ROW EXECUTE FUNCTION guard_consumer_use();
ALTER TABLE responses_events DROP CONSTRAINT responses_events_kind_check;
ALTER TABLE responses_events ADD CHECK (kind IN ('count_send','count_result','dispatch','identity','result','read','cancel','tool_result','corrected_readback'));
-- Existing unique phase/kind index bounds corrected_readback to ONE, never rewrite.
CREATE FUNCTION guard_corrected_readback() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old responses_events; ident jsonb; s responses_steps;
BEGIN
 IF NEW.kind<>'corrected_readback' THEN RETURN NEW; END IF;
 SELECT * INTO s FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
 SELECT * INTO old FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 SELECT data INTO ident FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='identity';
 IF NEW.phase<>'final' OR old.id IS NULL OR ident IS NULL
 OR old.data->>'state' IS DISTINCT FROM 'malformed'
 OR old.data->>'issue' IS DISTINCT FROM 'invalid_reasoning_item'
 OR old.data->>'output_items' IS DISTINCT FROM '[]'
 OR old.data->'value' IS DISTINCT FROM 'null'::jsonb
 OR old.data->'usage' IS NULL OR old.data->'usage'='null'::jsonb
 OR NEW.data->>'original_event_id' IS DISTINCT FROM old.id
 OR NEW.data->>'original_issue' IS DISTINCT FROM old.data->>'issue'
 OR coalesce(NEW.data->>'original_result_sha256','') !~ '^[0-9a-f]{64}$'
 OR NEW.data->>'request_sha256' IS DISTINCT FROM s.request_sha256
 OR NEW.data->'metadata' IS DISTINCT FROM s.metadata
 OR NEW.data->>'response_id' IS DISTINCT FROM ident->>'response_id'
 OR NEW.data->>'response_id' IS DISTINCT FROM old.data->>'response_id'
 OR NEW.data->'usage' IS DISTINCT FROM old.data->'usage'
 OR NEW.data->'provenance' IS DISTINCT FROM old.data->'provenance'
 OR NEW.data->>'state' IS DISTINCT FROM 'completed'
 OR NEW.data->'issue' IS DISTINCT FROM 'null'::jsonb
 OR jsonb_typeof(NEW.data->'value') IS DISTINCT FROM 'object'
 OR NEW.data->>'model' IS DISTINCT FROM s.request_bytes::jsonb->>'model'
 THEN RAISE EXCEPTION 'invalid bounded correction'; END IF;
 IF NOT EXISTS (SELECT 1 FROM responses_events r WHERE r.id=NEW.data->>'read_event_id'
   AND r.attempt_id=NEW.attempt_id AND r.phase=NEW.phase AND r.kind='read' AND r.created_at>=old.created_at)
 OR NOT EXISTS (SELECT 1 FROM responses_consumer_uses u JOIN provider_grants g ON g.id=u.grant_id
   JOIN provider_consumer_successors a ON a.grant_id=u.grant_id
   WHERE u.attempt_id=NEW.attempt_id AND g.active AND (a.data->>'expires_at')::timestamptz>now()
   AND u.actual_consumer_sha256=NEW.data->>'actual_consumer_sha256'
   AND u.original_consumer_sha256=NEW.data->>'original_consumer_sha256')
 THEN RAISE EXCEPTION 'approved readback evidence required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_corrected_readback BEFORE INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION guard_corrected_readback();
-- Identical cumulative accounting, with one explicit operator local lease only.
CREATE OR REPLACE FUNCTION guard_responses_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid text; ws text; n integer; lim integer;
BEGIN
 SELECT s.grant_id,g.workspace_id INTO gid,ws FROM responses_steps s JOIN provider_grants g ON g.id=s.grant_id
 WHERE s.attempt_id=NEW.attempt_id AND s.phase=NEW.phase;
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 IF NEW.kind IN ('count_send','dispatch','read','cancel') THEN
   IF NOT EXISTS (SELECT 1 FROM provider_grants g WHERE id=gid AND active AND
      ((data->>'expires_at')::timestamptz>now() OR EXISTS (
        SELECT 1 FROM provider_consumer_successors a JOIN responses_consumer_uses u ON u.grant_id=a.grant_id
        WHERE a.grant_id=g.id AND u.attempt_id=NEW.attempt_id AND (a.data->>'expires_at')::timestamptz>now())))
   THEN RAISE EXCEPTION 'grant unavailable'; END IF;
   SELECT count(*) INTO n FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
    WHERE s.grant_id=gid AND e.kind=NEW.kind;
   lim=CASE WHEN NEW.kind='read' THEN 40 ELSE 4 END;
   IF n>=lim THEN RAISE EXCEPTION 'cumulative request limit'; END IF;
 END IF;
 IF NEW.kind='dispatch' THEN
   IF NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='count_result')
   THEN RAISE EXCEPTION 'durable count required'; END IF;
   IF NEW.data->>'reserved_input_tokens'<>'20000' OR NEW.data->>'reserved_output_tokens'<>'8192'
      OR (NEW.data->>'reserved_cost_usd')::numeric<>0.131920
   THEN RAISE EXCEPTION 'full worst-case reservation required'; END IF;
 END IF;
 IF NEW.kind='count_result' AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='count_send')
 THEN RAISE EXCEPTION 'count send required'; END IF;
 IF NEW.kind IN ('identity','result','read','cancel','corrected_readback') AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='dispatch')
 THEN RAISE EXCEPTION 'dispatch required'; END IF;
 RETURN NEW;
END;
$$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='provider_attempts' AND privilege_type='INSERT' AND grantee<>current_user
 LOOP
 EXECUTE format('GRANT SELECT ON provider_consumer_successors,responses_consumer_uses TO %I',r.grantee);
 EXECUTE format('GRANT INSERT ON responses_consumer_uses TO %I',r.grantee);
 END LOOP;
END $$;
