-- Schema-visible legacy publication remains forbidden under a tool grant.
-- Admit only an exact, material-free rejected observation so adaptive execution
-- can select an authorized capability. No existing row or grant is changed.
CREATE FUNCTION gateway_publication_rejection(aid text, step text, d jsonb)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(
   d->>'status'='rejected'
   AND d->'diagnostic'->>'code'='gateway_operation_rejected'
   AND d->'decision'->>'kind'='publish_artifact'
   AND d->'body'='null'::jsonb AND d->'file'='null'::jsonb AND d->'output'='null'::jsonb
   AND NOT d ?| ARRAY['capability_result','mutation_result','followthrough_result']
   AND d->>'terminal_outcome' IN ('continue','step_limit')
   AND d->'verification'->'satisfied'='false'::jsonb
   AND d->'verification'->'model_tests_passed'='false'::jsonb
   AND d->'verification'->>'requested_goal_status'='needs_validation'
   AND EXISTS(SELECT 1 FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id
     JOIN run_configurations rc ON rc.workspace_id=a.workspace_id AND rc.run_id=a.run_id
     JOIN responses_steps s ON s.attempt_id=e.attempt_id AND s.phase=e.phase
     WHERE e.attempt_id=aid AND e.phase=step AND e.kind='result' AND e.data->>'state'='function_call'
       AND rc.data->'responses'->>'policy_version'='adaptive-local-v1'
       AND d->'decision'=e.data->'value'->'decision'
       AND d->'binding'->>'attempt_id'=aid
       AND d->'binding'->>'selection_request_sha256'=s.request_sha256
       AND d->'binding'->>'selection_response_id'=e.data->>'response_id'
       AND d->'binding'->>'decision_sha256'=
         encode(sha256(convert_to(acceptance_canonical_json(e.data->'value'),'UTF8')),'hex')),false)
$$;

-- Keep the original authority fence, all operation allowlists and exact adapter
-- observation checks. Add a single material-free rejection exception only.
DO $$ DECLARE definition text;
 old text=$q$IF bound AND NEW.kind='tool_result' AND (NEW.data->'decision'->>'kind' IS NULL$q$;
BEGIN
 definition=pg_get_functiondef('guard_tool_consumption()'::regprocedure);
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'gateway rejection predecessor drift'; END IF;
 EXECUTE replace(definition,old,
   $q$IF bound AND NEW.kind='tool_result'
    AND NOT gateway_publication_rejection(NEW.attempt_id,NEW.phase,NEW.data)
    AND (NEW.data->'decision'->>'kind' IS NULL$q$);
END $$;
