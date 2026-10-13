-- Add append-only, bounded count diagnostics; no retry or counter reset.
ALTER TABLE responses_events DROP CONSTRAINT responses_events_kind_check;
ALTER TABLE responses_events ADD CONSTRAINT responses_events_kind_check CHECK
 (kind IN ('count_send','count_result','dispatch','identity','result','read','cancel','tool_result','corrected_readback','problem'));

CREATE FUNCTION guard_count_problem() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws text; code text;
BEGIN
 IF NEW.kind NOT IN ('problem','count_result','dispatch') THEN RETURN NEW; END IF;
 -- The workspace lock serializes writers, but cannot refresh a snapshot taken
 -- under repeatable read or serializable. Match guard_responses_event's policy.
 IF current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'shared budget authority requires read committed isolation'; END IF;
 SELECT a.workspace_id INTO ws FROM provider_attempts a WHERE a.id=NEW.attempt_id;
 -- Match existing event authority's workspace-first lock order. Diagnostics are
 -- arrival retention, not fresh send authority, and may survive grant revocation.
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 IF NEW.kind IN ('count_result','dispatch') THEN
   IF EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='problem')
   THEN RAISE EXCEPTION 'count diagnostic is terminal; no retry or replacement receipt'; END IF;
   RETURN NEW;
 END IF;
 code=NEW.data->>'code';
 IF jsonb_typeof(NEW.data)<>'object' OR NOT (NEW.data ?& ARRAY['operation','code','received'])
    OR NEW.data->'operation'<>'"count"'::jsonb
    OR code NOT IN ('observation_unavailable','http_error','malformed_response','invalid_or_excessive_input_count','input_count_exceeds_limit','count_observation_unavailable')
    OR jsonb_typeof(NEW.data->'code')<>'string'
    OR jsonb_typeof(NEW.data->'received')<>'boolean'
    OR (NEW.data - ARRAY['operation','code','received','http_status','input_tokens','limit'])<>'{}'::jsonb
 THEN RAISE EXCEPTION 'invalid count diagnostic'; END IF;
 IF NEW.data ? 'http_status' THEN
   IF code<>'http_error' OR jsonb_typeof(NEW.data->'http_status')<>'number'
      OR (NEW.data->>'http_status') !~ '^[1-5][0-9]{2}$'
   THEN RAISE EXCEPTION 'invalid count diagnostic HTTP status'; END IF;
 END IF;
 IF code='input_count_exceeds_limit' THEN
   IF NOT (NEW.data ?& ARRAY['input_tokens','limit']) OR NEW.data->'received'<>'true'::jsonb
      OR NEW.data->'limit'<>'20000'::jsonb
      OR jsonb_typeof(NEW.data->'input_tokens')<>'number'
      OR (NEW.data->>'input_tokens') !~ '^[0-9]+$'
      OR (NEW.data->>'input_tokens')::numeric<=20000
   THEN RAISE EXCEPTION 'invalid excessive count diagnostic'; END IF;
 ELSE
   IF NEW.data->'received'<>'false'::jsonb OR NEW.data ?| ARRAY['input_tokens','limit']
   THEN RAISE EXCEPTION 'unknown count must remain unknown'; END IF;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='count_send')
    OR EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind IN ('count_result','dispatch'))
 THEN RAISE EXCEPTION 'count diagnostic requires unresolved count slot'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_count_problem BEFORE INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION guard_count_problem();
