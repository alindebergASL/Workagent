-- Proportionate alpha development ceilings. Historical grant JSON, run bindings,
-- journals and migrations001-026 remain unchanged. This migration grants nothing.
-- Every send still consumes the explicit cumulative binding; carried cost,
-- nonrefundable reservations, shared locking and the project $20 cap are unchanged.
-- Operator aggregate authority is separate, never inferred from these ceilings.
CREATE OR REPLACE FUNCTION require_alpha_budget_binding(b jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k text; ceiling numeric;
BEGIN
 IF jsonb_typeof(b) IS DISTINCT FROM 'object'
    OR b->'runtime_extension' IS DISTINCT FROM '"general-alpha-v1"'::jsonb
    OR b->'policy_version' IS DISTINCT FROM '"adaptive-local-v1"'::jsonb
    OR b->'cancel_limit' IS DISTINCT FROM '0'::jsonb
    OR b->'synthetic_data_only' IS DISTINCT FROM 'true'::jsonb
    OR b->'store_acknowledged' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(b->'max_steps') IS DISTINCT FROM 'number'
    OR coalesce(b->>'max_steps','') !~ '^[1-8]$'
    OR jsonb_typeof(b->'cost_limit_usd') IS DISTINCT FROM 'string'
    OR coalesce(b->>'cost_limit_usd','') !~ '^(0|[1-9][0-9]?)(\.[0-9]{1,6})?$'
    OR jsonb_typeof(b->'conversation_ids') IS DISTINCT FROM 'array'
    OR b - ARRAY['runtime_extension','project_id','secret_reference','transport_mode','instructions_sha256',
       'schema_sha256','scope_tool_sha256','policy_version','max_steps','generation_limit','count_limit',
       'read_limit','cancel_limit','input_limit','output_limit','cost_limit_usd','conversation_ids',
       'authorization_sha256','synthetic_data_only','store_acknowledged'] <> '{}'::jsonb
 THEN RAISE EXCEPTION 'exact typed alpha budget binding required'; END IF;
 IF (b->>'cost_limit_usd')::numeric>20.00
    OR jsonb_array_length(b->'conversation_ids') NOT BETWEEN 1 AND 10
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(b->'conversation_ids'))<>jsonb_array_length(b->'conversation_ids')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(b->'conversation_ids') v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string'
       OR length(v #>> '{}') NOT BETWEEN 1 AND 128 OR (v #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$')
 THEN RAISE EXCEPTION 'bounded unique alpha scope required'; END IF;
 FOREACH k IN ARRAY ARRAY['generation_limit','count_limit','read_limit','input_limit','output_limit'] LOOP
   ceiling=CASE k WHEN 'generation_limit' THEN 256 WHEN 'count_limit' THEN 256 WHEN 'read_limit' THEN 4096
       WHEN 'input_limit' THEN 5120000 ELSE 2097152 END;
   IF jsonb_typeof(b->k) IS DISTINCT FROM 'number' OR coalesce(b->>k,'') !~ '^(0|[1-9][0-9]*)$'
   THEN RAISE EXCEPTION 'exact typed alpha budget binding required'; END IF;
   IF (b->>k)::numeric>ceiling THEN RAISE EXCEPTION 'alpha budget may only tighten'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['instructions_sha256','schema_sha256','scope_tool_sha256','authorization_sha256'] LOOP
   IF jsonb_typeof(b->k) IS DISTINCT FROM 'string' OR coalesce(b->>k,'') !~ '^[0-9a-f]{64}$'
   THEN RAISE EXCEPTION 'exact alpha pins required'; END IF;
 END LOOP;
 IF jsonb_typeof(b->'project_id') IS DISTINCT FROM 'string' OR coalesce(b->>'project_id','') !~ '^proj_[A-Za-z0-9_-]{1,100}$'
    OR jsonb_typeof(b->'secret_reference') IS DISTINCT FROM 'string' OR coalesce(b->>'secret_reference','') !~ '^file:/[A-Za-z0-9_./-]+$'
    OR length(b->>'secret_reference') NOT BETWEEN 7 AND 406
    OR b->'transport_mode' NOT IN ('"synthetic"'::jsonb,'"official_api"'::jsonb) OR NOT b ? 'transport_mode'
 THEN RAISE EXCEPTION 'exact alpha route binding required'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION guard_general_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b jsonb; cid text; alpha boolean;
BEGIN
 IF NEW.data->>'profile'<>'general-responses-v1' THEN RETURN NEW; END IF;
 b=NEW.data->'responses';
 alpha=b ? 'runtime_extension';
 IF alpha THEN
   PERFORM require_alpha_budget_binding(b);
   IF jsonb_typeof(NEW.data->'max_runs') IS DISTINCT FROM 'number'
      OR coalesce(NEW.data->>'max_runs','') !~ '^([1-9]|10)$'
      OR NEW.data->'max_received_output_tokens' IS DISTINCT FROM '16384'::jsonb
   THEN RAISE EXCEPTION 'exact typed alpha run bounds required'; END IF;
 END IF;
 IF NEW.data->>'id' IS DISTINCT FROM NEW.id OR NEW.data->>'workspace_id' IS DISTINCT FROM NEW.workspace_id
 OR NEW.data->>'principal_id' IS DISTINCT FROM NEW.principal_id
 OR NEW.data->'expires_at' IS DISTINCT FROM 'null'::jsonb
 OR NEW.data->>'model' IS DISTINCT FROM 'gpt-6.1-sol'
 OR coalesce((NEW.data->>'max_runs')::integer,0) NOT BETWEEN 1 AND (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN 10 ELSE 4 END)
 OR NEW.data->>'max_received_output_tokens' IS DISTINCT FROM '16384'
 OR b->>'policy_version' NOT IN ('general-responses-v1','adaptive-local-v1')
 OR (b->>'policy_version'='adaptive-local-v1' AND coalesce((b->>'max_steps')::integer,0) NOT BETWEEN 1 AND (CASE WHEN alpha THEN 8 ELSE 4 END))
 OR (NOT alpha AND (b->>'generation_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '50' ELSE '8' END) OR b->>'count_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '50' ELSE '8' END)
 OR b->>'read_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '500' ELSE '80' END) OR b->>'cancel_limit' IS DISTINCT FROM '0'
 OR b->>'input_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '1000000' ELSE '160000' END) OR b->>'output_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '409600' ELSE '65536' END)
 OR b->>'cost_limit_usd' IS DISTINCT FROM '20.00'))
 OR b->>'synthetic_data_only' IS DISTINCT FROM 'true' OR b->>'store_acknowledged' IS DISTINCT FROM 'true'
 OR b->>'authorization_sha256' IS DISTINCT FROM 'd7f676d970ef2c6d56c39fe961114d00140279b99ba72649177c41de159093c9'
 OR jsonb_typeof(b->'conversation_ids') IS DISTINCT FROM 'array'
 OR jsonb_array_length(b->'conversation_ids') NOT BETWEEN 1 AND (CASE WHEN alpha THEN 10 ELSE 2 END)
 THEN RAISE EXCEPTION 'exact bounded general authorization required'; END IF;
 FOR cid IN SELECT jsonb_array_elements_text(b->'conversation_ids') LOOP
   IF NOT EXISTS (SELECT 1 FROM conversations cv WHERE cv.workspace_id=NEW.workspace_id AND cv.id=cid
      AND cv.data->>'owner_id'=NEW.principal_id AND cv.data->'selected_source_refs'='[]'::jsonb)
   THEN RAISE EXCEPTION 'explicit synthetic conversation scope required'; END IF;
   IF TG_OP='INSERT' AND EXISTS (SELECT 1 FROM provider_grants g WHERE g.workspace_id=NEW.workspace_id
      AND g.data->>'profile'='general-responses-v1' AND g.data->'responses'->'conversation_ids' ? cid)
   THEN RAISE EXCEPTION 'conversation authorization cannot reset'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;

ALTER TABLE responses_steps DROP CONSTRAINT responses_steps_phase_check;
ALTER TABLE responses_steps ADD CONSTRAINT responses_steps_phase_check CHECK
 (phase IN ('selection','selection_2','selection_3','selection_4','selection_5','selection_6','selection_7','selection_8','final'));
-- guard_responses_step still enforces EACH immutable grant's max_steps and the
-- immediately preceding retained observation. Legacy grants remain <=4.

CREATE OR REPLACE FUNCTION valid_responsibility_recording(effect jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(
   jsonb_typeof(effect)='object'
   AND effect ?& ARRAY['run_id','attempt_id','phase','binding','request','decision_sha256','conversation_work_version','result']
   AND effect - ARRAY['run_id','attempt_id','phase','binding','request','decision_sha256','conversation_work_version','result']='{}'::jsonb
   AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['run_id','attempt_id','phase','decision_sha256']) k
       WHERE jsonb_typeof(effect->k) IS DISTINCT FROM 'string' OR effect->>k='')
   AND effect->>'phase' IN ('selection','selection_2','selection_3','selection_4','selection_5','selection_6','selection_7','selection_8')
   AND effect->>'decision_sha256' ~ '^[0-9a-f]{64}$'
   AND jsonb_typeof(effect->'conversation_work_version')='number'
   AND effect->>'conversation_work_version' ~ '^[1-9][0-9]*$'
   AND jsonb_typeof(effect->'request')='object'
   AND effect->'request' ?& ARRAY['message_id','message_sha256']
   AND (effect->'request') - ARRAY['message_id','message_sha256']='{}'::jsonb
   AND jsonb_typeof(effect->'request'->'message_id')='string'
   AND jsonb_typeof(effect->'request'->'message_sha256')='string'
   AND effect->'request'->>'message_sha256' ~ '^[0-9a-f]{64}$'
   AND jsonb_typeof(effect->'binding')='object'
   AND effect->'binding' ?& ARRAY['attempt_id','selection_request_sha256','selection_response_id','decision_sha256','operation_hash','base_hash']
   AND (effect->'binding') - ARRAY['attempt_id','selection_request_sha256','selection_response_id','decision_sha256','operation_hash','base_hash']='{}'::jsonb
   AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['attempt_id','selection_request_sha256','selection_response_id','decision_sha256','operation_hash']) k
       WHERE jsonb_typeof(effect->'binding'->k) IS DISTINCT FROM 'string' OR effect->'binding'->>k='')
   AND (effect->'binding'->'base_hash'='null'::jsonb OR
        (jsonb_typeof(effect->'binding'->'base_hash')='string' AND effect->'binding'->>'base_hash' ~ '^[0-9a-f]{64}$'))
   AND jsonb_typeof(effect->'result')='object'
   AND effect->'result' ?& ARRAY['kind','version','assignment_id','conversation_id','owner_id','work_version','state','outcome_status','execution_status']
   AND (effect->'result') - ARRAY['kind','version','assignment_id','conversation_id','owner_id','work_version','state','outcome_status','execution_status']='{}'::jsonb
   AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['kind','version','assignment_id','conversation_id','owner_id','state','outcome_status','execution_status']) k
       WHERE jsonb_typeof(effect->'result'->k) IS DISTINCT FROM 'string')
   AND jsonb_typeof(effect->'result'->'work_version')='number'
   AND effect->'result'->>'work_version' ~ '^[1-9][0-9]*$',false);
$$;
