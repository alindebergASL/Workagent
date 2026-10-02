-- Additive two-phase consumer journal. No legacy records/pins are rewritten.
ALTER TABLE provider_attempts DROP CONSTRAINT provider_attempts_evidence_origin_check;
ALTER TABLE provider_attempts ADD CHECK (evidence_origin IN ('unverified','synthetic_provider_receipt','live_provider_receipt'));
CREATE TABLE responses_steps (
 attempt_id text NOT NULL REFERENCES provider_attempts(id),
 phase text NOT NULL CHECK (phase IN ('selection','final')),
 grant_id text NOT NULL REFERENCES provider_grants(id),
 request_bytes text NOT NULL, request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
 count_bytes text NOT NULL, count_sha256 text NOT NULL CHECK (count_sha256 ~ '^[0-9a-f]{64}$'),
 metadata jsonb NOT NULL, PRIMARY KEY(attempt_id,phase)
);
CREATE TRIGGER immutable_responses_steps BEFORE UPDATE OR DELETE ON responses_steps
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TABLE responses_events (
 id text PRIMARY KEY, attempt_id text NOT NULL, phase text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('count_send','count_result','dispatch','identity','result','read','cancel','tool_result')),
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(attempt_id,phase) REFERENCES responses_steps(attempt_id,phase)
);
CREATE UNIQUE INDEX responses_one_event ON responses_events(attempt_id,phase,kind)
 WHERE kind NOT IN ('read','cancel');
CREATE TRIGGER immutable_responses_events BEFORE UPDATE OR DELETE ON responses_events
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE FUNCTION guard_responses_step() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a provider_attempts; g provider_grants;
BEGIN
 SELECT * INTO a FROM provider_attempts WHERE id=NEW.attempt_id;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.grant_id;
 IF a.grant_id<>NEW.grant_id OR a.data->>'profile'<>'openai-responses-v1'
 OR NEW.metadata->>'attempt_id'<>NEW.attempt_id OR NEW.metadata->>'step_id'<>NEW.phase
 OR g.data->>'profile'<>'openai-responses-v1' THEN RAISE EXCEPTION 'invalid step binding'; END IF;
 IF NEW.phase='final' AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase='selection' AND kind='tool_result')
 THEN RAISE EXCEPTION 'authorized selection tool result required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_responses_steps BEFORE INSERT ON responses_steps FOR EACH ROW EXECUTE FUNCTION guard_responses_step();
CREATE FUNCTION guard_responses_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid text; ws text; n integer; lim integer;
BEGIN
 SELECT s.grant_id,g.workspace_id INTO gid,ws FROM responses_steps s JOIN provider_grants g ON g.id=s.grant_id
 WHERE s.attempt_id=NEW.attempt_id AND s.phase=NEW.phase;
 -- Same workspace lock order as domain authority. Serializes independent processes.
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 IF NEW.kind IN ('count_send','dispatch','read','cancel') THEN
   IF NOT EXISTS (SELECT 1 FROM provider_grants WHERE id=gid AND active AND (data->>'expires_at')::timestamptz>now())
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
 IF NEW.kind IN ('identity','result','read','cancel') AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='dispatch')
 THEN RAISE EXCEPTION 'dispatch required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_responses_events BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION guard_responses_event();
-- Upgrade ACLs for every previously installed runtime role; no owner bypass.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='provider_attempts' AND privilege_type='INSERT' AND grantee<>current_user
 LOOP
 EXECUTE format('GRANT SELECT,INSERT ON responses_steps,responses_events TO %I',r.grantee);
 END LOOP;
END $$;
