-- A known schema failure is a distinct immutable observation, not tool material.
ALTER TABLE responses_events DROP CONSTRAINT responses_events_kind_check;
ALTER TABLE responses_events ADD CONSTRAINT responses_events_kind_check CHECK
 (kind IN ('count_send','count_result','dispatch','identity','result','read','cancel','tool_result',
          'corrected_readback','problem','cancelled_unapplied','selection_rejection'));

-- Only the migration owner can bind an older diagnostic which predates parser
-- retention. Runtime is SELECT-only. Existing result/read/history never changes.
CREATE TABLE selection_rejection_diagnostics (
 result_event_id text PRIMARY KEY REFERENCES responses_events(id),
 read_event_id text NOT NULL UNIQUE REFERENCES responses_events(id),
 diagnostic_bytes text NOT NULL,
 diagnostic_sha256 text NOT NULL CHECK (diagnostic_sha256=encode(sha256(convert_to(diagnostic_bytes,'UTF8')),'hex'))
);
REVOKE ALL ON selection_rejection_diagnostics FROM PUBLIC;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT grantee FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='responses_events' AND privilege_type='SELECT'
   AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP
   EXECUTE format('REVOKE ALL ON selection_rejection_diagnostics FROM %I',r.grantee);
   EXECUTE format('GRANT SELECT ON selection_rejection_diagnostics TO %I',r.grantee);
 END LOOP;
END $$;
CREATE TRIGGER immutable_selection_rejection_diagnostics BEFORE UPDATE OR DELETE ON selection_rejection_diagnostics
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE FUNCTION guard_selection_diagnostic() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e responses_events; rd responses_events; s responses_steps; doc jsonb;
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
 THEN RAISE EXCEPTION 'owner-only exact diagnostic binding'; END IF;
 SELECT * INTO e FROM responses_events WHERE id=NEW.result_event_id;
 SELECT * INTO rd FROM responses_events WHERE id=NEW.read_event_id;
 SELECT * INTO s FROM responses_steps WHERE attempt_id=e.attempt_id AND phase=e.phase;
 doc=NEW.diagnostic_bytes::jsonb;
 IF e.kind IS DISTINCT FROM 'result' OR e.data->>'state' IS DISTINCT FROM 'malformed'
 OR e.data->>'issue' IS DISTINCT FROM 'schema_validation_failed' OR e.data ? 'rejection_diagnostic'
 OR jsonb_typeof(e.data->'usage') IS DISTINCT FROM 'object'
 OR rd.kind IS DISTINCT FROM 'read' OR rd.attempt_id IS DISTINCT FROM e.attempt_id OR rd.phase IS DISTINCT FROM e.phase
 OR doc->>'id' IS DISTINCT FROM e.data->>'response_id' OR doc->'metadata' IS DISTINCT FROM s.metadata
 OR doc->>'status' IS DISTINCT FROM 'completed' OR doc->'error' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'exact historical diagnostic required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_selection_diagnostic BEFORE INSERT ON selection_rejection_diagnostics
 FOR EACH ROW EXECUTE FUNCTION guard_selection_diagnostic();

CREATE FUNCTION guard_selection_rejection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e responses_events; s responses_steps; a provider_attempts; rc jsonb; identity jsonb;
 raw text; doc jsonb; choice jsonb; calls jsonb; generated jsonb='null'::jsonb; expected jsonb; n integer; bound integer; fence integer;
BEGIN
 IF NEW.kind<>'selection_rejection' THEN RETURN NEW; END IF;
 SELECT * INTO s FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
 SELECT * INTO a FROM provider_attempts WHERE id=NEW.attempt_id;
 SELECT (data->>'fence')::integer INTO fence FROM runs WHERE workspace_id=a.workspace_id AND id=a.run_id;
 SELECT data INTO rc FROM run_configurations WHERE workspace_id=a.workspace_id AND run_id=a.run_id;
 SELECT * INTO e FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 SELECT data INTO identity FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='identity';
 IF rc->'responses'->>'policy_version' IS DISTINCT FROM 'adaptive-local-v1'
 OR NEW.phase!~'^selection(_([2-9]|[1-9][0-9]+))?$'
 OR NEW.data->'worker_fence' IS DISTINCT FROM to_jsonb(fence)
 OR e.id IS NULL OR e.data->>'state' IS DISTINCT FROM 'malformed'
 OR e.data->>'issue' IS DISTINCT FROM 'schema_validation_failed'
 OR jsonb_typeof(e.data->'usage') IS DISTINCT FROM 'object'
 OR e.data->'value' IS DISTINCT FROM 'null'::jsonb OR e.data->'call_id' IS DISTINCT FROM 'null'::jsonb
 OR e.data->>'output_items' IS DISTINCT FROM '[]'
 OR e.data->>'request_sha256' IS DISTINCT FROM s.request_sha256
 OR e.data->'metadata' IS DISTINCT FROM s.metadata
 OR identity->>'response_id' IS NULL OR e.data->>'response_id' IS DISTINCT FROM identity->>'response_id'
 OR NOT EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='dispatch')
 OR NOT EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='count_result' AND data->>'input_tokens' IS NOT NULL)
 OR EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind IN ('tool_result','corrected_readback','cancelled_unapplied','cancel'))
 OR EXISTS(SELECT 1 FROM tool_attempts WHERE workspace_id=a.workspace_id AND run_id=a.run_id AND call_id=NEW.phase)
 THEN RAISE EXCEPTION 'known unexecuted terminal schema rejection required'; END IF;
 n=CASE WHEN NEW.phase='selection' THEN 1 ELSE substring(NEW.phase from 11)::integer END;
 bound=(rc->'responses'->>'max_steps')::integer;
 IF n>bound OR bound IS NULL THEN RAISE EXCEPTION 'schema rejection phase bound'; END IF;
 raw=e.data->>'rejection_diagnostic';
 IF raw IS NULL THEN SELECT diagnostic_bytes INTO raw FROM selection_rejection_diagnostics WHERE result_event_id=e.id; END IF;
 IF raw IS NULL THEN RAISE EXCEPTION 'exact diagnostic binding required'; END IF;
 doc=raw::jsonb;
 IF doc->>'id' IS DISTINCT FROM e.data->>'response_id' OR doc->'metadata' IS DISTINCT FROM s.metadata
 OR doc->>'status' IS DISTINCT FROM 'completed' OR doc->'error' IS DISTINCT FROM 'null'::jsonb
 OR doc->'usage'->'input_tokens' IS DISTINCT FROM e.data->'usage'->'input_tokens'
 OR doc->'usage'->'output_tokens' IS DISTINCT FROM e.data->'usage'->'output_tokens'
 OR doc->'usage'->'total_tokens' IS DISTINCT FROM e.data->'usage'->'total_tokens'
 OR doc->'usage'->'input_tokens_details'->'cached_tokens' IS DISTINCT FROM e.data->'usage'->'cached_input_tokens'
 OR doc->'usage'->'output_tokens_details'->'reasoning_tokens' IS DISTINCT FROM e.data->'usage'->'reasoning_tokens'
 THEN RAISE EXCEPTION 'diagnostic result binding mismatch'; END IF;
 SELECT jsonb_agg(x) INTO calls FROM jsonb_array_elements(doc->'output') x WHERE x->>'type'='function_call';
 IF jsonb_array_length(calls) IS DISTINCT FROM 1 OR calls->0->>'name' IS DISTINCT FROM 'choose_general_action'
 THEN RAISE EXCEPTION 'single rejected selection required'; END IF;
 choice=(calls->0->>'arguments')::jsonb->'decision';
 IF choice->>'kind'='files_create_draft' AND choice->'source'->>'kind'='text'
 AND jsonb_typeof(choice->'source'->'content')='string' THEN
   generated=jsonb_build_object('content',choice->'source'->'content',
     'utf8_bytes',octet_length(convert_to(choice->'source'->>'content','UTF8')),
     'sha256',encode(sha256(convert_to(choice->'source'->>'content','UTF8')),'hex'));
 END IF;
 expected=jsonb_build_object('version','selection-rejection/v1','worker_fence',fence,'result_event_id',e.id,
   'result_sha256',encode(sha256(convert_to(acceptance_canonical_json(e.data),'UTF8')),'hex'),
   'request_sha256',s.request_sha256,'response_id',e.data->>'response_id','attempt_id',NEW.attempt_id,'phase',NEW.phase,
   'diagnostic_sha256',encode(sha256(convert_to(raw,'UTF8')),'hex'),
   'terminal_outcome',CASE WHEN n=bound THEN 'step_limit' ELSE 'continue' END,
   'feedback',jsonb_build_object('code','schema_validation_failed','generated_text',generated,'detail',
     'This selection failed the unchanged strict schema and was NOT executed. Choose a NEW valid action. generated_text, when present, describes only the exact rejected UTF-8 bytes; its digest is computed by trusted code, not by the model. Reuse it only with those identical bytes. Changing Unicode or newlines changes the digest. This is not a file/reference hash or execution receipt.'));
 IF NEW.data IS DISTINCT FROM expected THEN RAISE EXCEPTION 'exact rejection observation required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_selection_rejection BEFORE INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION guard_selection_rejection();

-- Extend the existing general authority fence, never bypass its checks.
DO $$ DECLARE definition text; old text=$q$NEW.kind IN ('count_send','dispatch','read','cancel','tool_result')$q$;
BEGIN
 definition=pg_get_functiondef('guard_responses_event()'::regprocedure);
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'selection rejection authority predecessor drift'; END IF;
 EXECUTE replace(definition,old,$q$NEW.kind IN ('count_send','dispatch','read','cancel','tool_result','selection_rejection')$q$);
END $$;
DO $$ DECLARE definition text;
 old text=$q$phase=previous AND kind='tool_result'
         AND data->>'terminal_outcome'='continue'$q$;
 final_old text=$q$phase='selection' AND kind='tool_result'$q$;
BEGIN
 definition=pg_get_functiondef('guard_responses_step()'::regprocedure);
 IF position(old in definition)=0 OR position(final_old in definition)=0
 THEN RAISE EXCEPTION 'selection rejection step predecessor drift'; END IF;
 definition=replace(definition,old,$q$phase=previous AND kind IN ('tool_result','selection_rejection')
         AND data->>'terminal_outcome'='continue'$q$);
 -- A first schema rejection need not be turned into tool material to finalize
 -- a later, independently validated action. Final still needs terminal tool_result.
 definition=replace(definition,final_old,$q$phase='selection' AND kind IN ('tool_result','selection_rejection')$q$);
 EXECUTE definition;
END $$;
