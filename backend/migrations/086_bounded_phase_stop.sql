-- A deterministic exhausted-slice stop is not a model completion or a new
-- receipt. Preserve every provider/native/cost row; prove absence of ambiguity
-- before ordinary successor admission can reuse the existing checkpoint.
CREATE FUNCTION bounded_phase_stop_settled(aid text) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE pa provider_attempts; stopped runs; cfg jsonb; cp run_checkpoints;
 step responses_steps; ev jsonb; result_doc jsonb; identity_doc jsonb; count_doc jsonb;
 stage_doc jsonb; rejection_doc jsonb; ref jsonb; bound integer; ordinal integer;
BEGIN
 SELECT * INTO pa FROM provider_attempts WHERE id=aid;
 SELECT * INTO stopped FROM runs WHERE workspace_id=pa.workspace_id AND id=pa.run_id;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=pa.workspace_id AND run_id=pa.run_id;
 IF pa.id IS NULL OR pa.data->>'profile' IS DISTINCT FROM 'general-responses-v1'
   OR stopped.data->>'state' IS DISTINCT FROM 'partial'
   OR stopped.data->>'stop_reason' IS DISTINCT FROM 'step_limit'
   OR cfg->'responses'->>'policy_version' IS DISTINCT FROM 'adaptive-local-v1'
   OR cfg->>'grant_id' IS DISTINCT FROM pa.grant_id
 THEN RETURN false; END IF;
 bound=(cfg->'responses'->>'max_steps')::integer;
 IF bound NOT BETWEEN 1 AND 8 OR bound IS NULL
   OR file_input_tools_unresolved(pa.workspace_id,pa.run_id)
   OR EXISTS(SELECT 1 FROM tool_attempts t LEFT JOIN tool_attempt_events obs
       ON obs.attempt_id=t.id AND obs.kind='observation'
       WHERE t.workspace_id=pa.workspace_id AND t.run_id=pa.run_id AND obs.attempt_id IS NULL)
 THEN RETURN false; END IF;
 SELECT * INTO cp FROM run_checkpoints WHERE workspace_id=pa.workspace_id AND run_id=pa.run_id
   AND phase='final' AND checkpoint_kind='settlement';
 IF cp.checkpoint_id IS NULL OR cp.checkpoint_hash IS DISTINCT FROM tool_json_hash(cp.data)
   OR cp.data->>'waiting' IS DISTINCT FROM 'none'
   OR cp.data->>'next_safe_action' IS DISTINCT FROM 'continue_slice'
   OR cp.data->'run_fence' IS DISTINCT FROM stopped.data->'fence'
   OR cp.data->>'configuration_sha256' IS DISTINCT FROM tool_json_hash(cfg)
   OR jsonb_array_length(cp.data->'steps') IS DISTINCT FROM bound
   OR (SELECT count(*) FROM responses_steps WHERE attempt_id=aid)<>bound
 THEN RETURN false; END IF;
 FOR ordinal IN 1..bound LOOP
   SELECT * INTO step FROM responses_steps WHERE attempt_id=aid
     AND phase=CASE WHEN ordinal=1 THEN 'selection' ELSE 'selection_'||ordinal::text END;
   IF step.phase IS NULL OR step.grant_id IS DISTINCT FROM pa.grant_id
     OR step.metadata IS DISTINCT FROM jsonb_build_object('request_id',pa.run_id,'attempt_id',aid,'step_id',step.phase)
     OR step.request_sha256 IS DISTINCT FROM encode(sha256(convert_to(step.request_bytes,'UTF8')),'hex')
     OR step.count_sha256 IS DISTINCT FROM encode(sha256(convert_to(step.count_bytes,'UTF8')),'hex')
   THEN RETURN false; END IF;
   SELECT jsonb_object_agg(kind,data) INTO ev FROM responses_events WHERE attempt_id=aid AND phase=step.phase AND kind<>'read';
   IF ev IS NULL OR NOT ev ?& ARRAY['count_send','count_result','dispatch','identity','result']
     OR ev-ARRAY['count_send','count_result','dispatch','identity','result','tool_result','selection_rejection','file_input_rejection']<>'{}'::jsonb
   THEN RETURN false; END IF;
   result_doc=ev->'result';identity_doc=ev->'identity';count_doc=ev->'count_result';stage_doc=ev->'tool_result';
   IF result_doc->>'response_id' IS NULL OR result_doc->>'response_id' IS DISTINCT FROM identity_doc->>'response_id'
     OR result_doc->'metadata' IS DISTINCT FROM step.metadata OR identity_doc->'metadata' IS DISTINCT FROM step.metadata
     OR count_doc->'metadata' IS DISTINCT FROM step.metadata
     OR result_doc->>'request_sha256' IS DISTINCT FROM step.request_sha256
     OR identity_doc->>'request_sha256' IS DISTINCT FROM step.request_sha256
     OR count_doc->>'request_sha256' IS DISTINCT FROM step.request_sha256
     OR count_doc->>'count_sha256' IS DISTINCT FROM step.count_sha256
     OR jsonb_typeof(result_doc->'usage') IS DISTINCT FROM 'object'
   THEN RETURN false; END IF;
   SELECT item INTO ref FROM jsonb_array_elements(cp.data->'steps') item
     WHERE item->>'attempt_id'=aid AND item->>'phase'=step.phase;
   IF ref IS NULL OR ref->>'request_sha256' IS DISTINCT FROM step.request_sha256
     OR ref->>'response_id' IS DISTINCT FROM result_doc->>'response_id'
     OR ref->>'result_sha256' IS DISTINCT FROM tool_json_hash(result_doc)
     OR ref->>'tool_result_sha256' IS DISTINCT FROM (CASE WHEN stage_doc IS NULL THEN NULL ELSE tool_json_hash(stage_doc) END)
     OR ref->>'operation_hash' IS DISTINCT FROM stage_doc->'binding'->>'operation_hash'
   THEN RETURN false; END IF;
   IF stage_doc IS NOT NULL THEN
     IF result_doc->>'state' IS DISTINCT FROM 'function_call'
       OR stage_doc->>'terminal_outcome' IS DISTINCT FROM 'continue'
       OR ev ?| ARRAY['selection_rejection','file_input_rejection']
     THEN RETURN false; END IF;
   ELSIF ordinal=bound THEN RETURN false;
   ELSIF ev ? 'selection_rejection' THEN
     rejection_doc=ev->'selection_rejection';
     IF ev ? 'file_input_rejection' OR result_doc->>'state' IS DISTINCT FROM 'malformed'
       OR result_doc->>'issue' IS DISTINCT FROM 'schema_validation_failed'
       OR rejection_doc->>'terminal_outcome' IS DISTINCT FROM 'continue'
       OR rejection_doc->>'request_sha256' IS DISTINCT FROM step.request_sha256
       OR rejection_doc->>'result_sha256' IS DISTINCT FROM tool_json_hash(result_doc)
       OR rejection_doc->>'response_id' IS DISTINCT FROM result_doc->>'response_id'
     THEN RETURN false; END IF;
   ELSIF ev ? 'file_input_rejection' THEN
     IF (ev->'file_input_rejection'->>'terminal_outcome') IS DISTINCT FROM 'continue'
       OR NOT file_input_rejection_valid(aid,step.phase,ev->'file_input_rejection')
     THEN RETURN false; END IF;
   ELSE RETURN false;
   END IF;
 END LOOP;
 RETURN true;
END $$;

-- Preserve the complete current successor gate. Only an exact exhausted and
-- checkpointed settled history is exempt from its unresolved-attempt test.
DO $$ DECLARE definition text; needle text=$q$AND pa.data->>'state' NOT IN ('reconciled','failed'))$q$;
BEGIN
 definition=pg_get_functiondef('require_run_successor(runs,jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'bounded phase successor predecessor drift'; END IF;
 EXECUTE replace(definition,needle,$q$AND pa.data->>'state' NOT IN ('reconciled','failed')
       AND NOT bounded_phase_stop_settled(pa.id))$q$);
END $$;
