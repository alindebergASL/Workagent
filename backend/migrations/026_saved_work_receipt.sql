-- Bind saved reads to immutable selected receipts, independently of caller hashes.
CREATE FUNCTION guard_saved_work_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb; step responses_steps%ROWTYPE; binding jsonb;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data INTO selected FROM responses_events
   WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF selected->'value'->'decision'->>'kind'='read_saved_work'
    OR NEW.data->'capability_result'->>'capability'='read_saved_work' THEN
   SELECT * INTO step FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
   binding=NEW.data->'binding';
   IF selected->'value'->'decision'->>'kind' IS DISTINCT FROM 'read_saved_work'
      OR coalesce(NEW.data->>'terminal_outcome','') NOT IN ('continue','step_limit')
      OR binding->>'attempt_id' IS DISTINCT FROM NEW.attempt_id
      OR binding->>'selection_request_sha256' IS DISTINCT FROM selected->>'request_sha256'
      OR binding->>'selection_request_sha256' IS DISTINCT FROM step.request_sha256
      OR binding->>'selection_response_id' IS DISTINCT FROM selected->>'response_id'
      OR binding->>'decision_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected->'value'),'UTF8')),'hex')
      OR binding->>'operation_hash' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected->'value'->'decision'),'UTF8')),'hex')
   THEN RAISE EXCEPTION 'saved read requires exact retained selection receipt'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER saved_work_receipt_guard BEFORE INSERT ON responses_events
FOR EACH ROW EXECUTE FUNCTION guard_saved_work_receipt();
