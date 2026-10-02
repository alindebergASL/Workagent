-- Defense in depth for exact byte/count binding and closed event transitions.
ALTER TABLE responses_steps ADD CHECK (request_sha256=encode(sha256(convert_to(request_bytes,'UTF8')),'hex'));
ALTER TABLE responses_steps ADD CHECK (count_sha256=encode(sha256(convert_to(count_bytes,'UTF8')),'hex'));
ALTER TABLE responses_steps ADD CHECK (jsonb_typeof(metadata)='object' AND metadata ?& ARRAY['request_id','attempt_id','step_id']);
CREATE FUNCTION guard_responses_material() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s responses_steps; prior jsonb;
BEGIN
 SELECT * INTO s FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
 IF jsonb_typeof(NEW.data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'event object required'; END IF;
 IF NEW.kind IN ('count_result','identity','result') THEN
   IF NEW.data->>'request_sha256' IS DISTINCT FROM s.request_sha256 OR NEW.data->'metadata' IS DISTINCT FROM s.metadata
   THEN RAISE EXCEPTION 'receipt request binding mismatch'; END IF;
 END IF;
 IF NEW.kind='count_result' THEN
   IF NEW.data->>'count_sha256' IS DISTINCT FROM s.count_sha256 OR
      jsonb_typeof(NEW.data->'input_tokens') IS DISTINCT FROM 'number' OR
      (NEW.data->>'input_tokens')::numeric NOT BETWEEN 0 AND 20000 OR
      (NEW.data->>'input_tokens')::numeric<>trunc((NEW.data->>'input_tokens')::numeric)
   THEN RAISE EXCEPTION 'invalid exact count material'; END IF;
 END IF;
 IF NEW.kind='dispatch' AND (
   NEW.data->>'reserved_input_tokens' IS DISTINCT FROM '20000' OR
   NEW.data->>'reserved_output_tokens' IS DISTINCT FROM '8192' OR
   NEW.data->>'reserved_cost_usd' IS NULL OR
   (NEW.data->>'reserved_cost_usd')::numeric<>0.131920)
 THEN RAISE EXCEPTION 'complete full reservation required'; END IF;
 IF NEW.kind IN ('identity','result') THEN
   IF coalesce(NEW.data->>'response_id','') !~ '^resp_[A-Za-z0-9_-]{1,200}$'
   THEN RAISE EXCEPTION 'response identity required'; END IF;
   SELECT data INTO prior FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='identity';
   IF NEW.kind='result' AND (prior IS NULL OR NEW.data->>'response_id' IS DISTINCT FROM prior->>'response_id')
   THEN RAISE EXCEPTION 'recorded accepted identity required'; END IF;
 END IF;
 IF NEW.kind IN ('read','cancel') AND NOT EXISTS (
    SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='identity')
 THEN RAISE EXCEPTION 'known identity required'; END IF;
 IF NEW.kind='tool_result' AND (NEW.phase<>'selection' OR NOT EXISTS (
    SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase='selection' AND kind='result' AND data->>'state'='function_call'))
 THEN RAISE EXCEPTION 'successful selection required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_responses_material BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION guard_responses_material();
