-- Material-free feedback for an exact valid create choice in an explicitly
-- targeted run. No file resource permission, tool receipt or historical event
-- changes. In particular, this is NOT a resolution of any dispatched call.
CREATE FUNCTION target_create_rejection_authorized(aid text, step text, fence integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE a provider_attempts; r runs; g tool_grants; s responses_steps; cfg jsonb;
 e jsonb; identity jsonb; chosen jsonb; source jsonb; target jsonb; descriptor jsonb;
 pin jsonb; work bigint; n integer; bound integer; first_value jsonb;
BEGIN
 SELECT * INTO a FROM provider_attempts WHERE id=aid;
 IF a.id IS NULL OR step!~'^selection(_[2-8])?$' THEN RETURN false; END IF;
 PERFORM id FROM workspaces WHERE id=a.workspace_id FOR UPDATE;
 SELECT * INTO r FROM runs WHERE workspace_id=a.workspace_id AND id=a.run_id;
 SELECT * INTO g FROM tool_grants WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT * INTO s FROM responses_steps WHERE attempt_id=aid AND phase=step;
 SELECT data INTO e FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='result';
 SELECT data INTO identity FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='identity';
 SELECT data->'value' INTO first_value FROM responses_events WHERE attempt_id=aid AND kind='result'
   AND data->>'state'='function_call'
   ORDER BY CASE WHEN phase='selection' THEN 1 ELSE substring(phase from 11)::integer END LIMIT 1;
 chosen=e->'value'->'decision'; source=chosen->'source';
 n=CASE WHEN step='selection' THEN 1 ELSE substring(step from 11)::integer END;
 bound=(cfg->'responses'->>'max_steps')::integer;
 IF r.id IS NULL OR r.conversation_id IS NULL OR g.id IS NULL OR s.attempt_id IS NULL
   OR cfg->'responses'->>'policy_version' IS DISTINCT FROM 'adaptive-local-v1'
   OR cfg->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
   OR cfg->'responses'->>'continuity_version' IS DISTINCT FROM 'sustained-v1'
   OR cfg ? 'responsibility' -- This exception is only for an explicit human target.
   OR bound IS NULL OR n>bound
   OR e->>'state' IS DISTINCT FROM 'function_call'
   OR nullif(e->>'call_id','') IS NULL
   OR chosen->>'kind' IS DISTINCT FROM 'files_create_draft'
   OR chosen-ARRAY['kind','source'] IS DISTINCT FROM '{}'::jsonb
   OR source->>'kind' IS DISTINCT FROM 'text'
   OR source-ARRAY['kind','filename','mime_type','content','sha256'] IS DISTINCT FROM '{}'::jsonb
   OR jsonb_typeof(source->'content') IS DISTINCT FROM 'string'
   OR NOT coalesce(octet_length(convert_to(source->>'content','UTF8')) BETWEEN 1 AND 200000,false)
   OR source->>'sha256' IS DISTINCT FROM encode(sha256(convert_to(source->>'content','UTF8')),'hex')
   OR NOT coalesce(source->>'filename' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(txt|md|markdown|csv|json)$',false)
   OR source->>'mime_type' IS DISTINCT FROM (CASE substring(source->>'filename' from '\.([^.]+)$')
     WHEN 'txt' THEN 'text/plain' WHEN 'md' THEN 'text/markdown' WHEN 'markdown' THEN 'text/markdown'
     WHEN 'csv' THEN 'text/csv' WHEN 'json' THEN 'application/json' END)
   OR e->>'request_sha256' IS DISTINCT FROM s.request_sha256
   OR e->'metadata' IS DISTINCT FROM s.metadata
   OR identity->>'response_id' IS NULL OR e->>'response_id' IS DISTINCT FROM identity->>'response_id'
   OR e->'value'->'goal' IS DISTINCT FROM first_value->'goal'
   OR e->'value'->'success_criteria' IS DISTINCT FROM first_value->'success_criteria'
   OR NOT EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='dispatch')
   OR NOT EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='count_result')
   OR EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=aid AND phase=step
     AND kind IN ('selection_rejection','file_input_rejection','cancel','cancelled_unapplied','corrected_readback'))
   OR EXISTS(SELECT 1 FROM tool_attempts WHERE workspace_id=r.workspace_id AND run_id=r.id AND call_id=step)
   OR file_input_tools_unresolved(r.workspace_id,r.id)
 THEN RETURN false; END IF;
 SELECT data->'target' INTO target FROM conversation_messages WHERE workspace_id=r.workspace_id
   AND conversation_id=r.conversation_id AND run_id=r.id AND author_kind='human' ORDER BY sequence LIMIT 1;
 IF NOT EXISTS(SELECT 1 FROM artifacts art JOIN revisions rev
     ON rev.workspace_id=art.workspace_id AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
     WHERE art.workspace_id=r.workspace_id AND art.conversation_id=r.conversation_id
       AND art.id=target->>'artifact_id' AND rev.id=target->>'revision_id'
       AND rev.data->>'body_hash'=target->>'body_hash')
 THEN RETURN false; END IF;
 SELECT (data->>'work_version')::bigint INTO work FROM conversations WHERE workspace_id=r.workspace_id AND id=r.conversation_id;
 SELECT ci.descriptor INTO descriptor FROM capability_installations ci
   WHERE id='files.create_draft' AND version='1' AND enabled;
 SELECT value INTO pin FROM jsonb_array_elements(g.data->'capabilities')
   WHERE value->>'id'='files.create_draft' AND value->>'version'='1';
 IF NOT coalesce(tool_authorized(r.workspace_id,r.id,fence,r.lease_hash,g.id,work),false)
   OR NOT coalesce(tool_run_available(r.workspace_id,r.id),false)
   OR descriptor IS NULL OR pin IS NULL
   OR descriptor->>'execution_profile' IS DISTINCT FROM 'native-bounded-files-v1'
   OR pin->>'schema_sha256' IS DISTINCT FROM descriptor->>'schema_sha256'
   OR pin->>'implementation_sha256' IS DISTINCT FROM descriptor->>'implementation_sha256'
   OR NOT coalesce((g.data->'effects') @> (descriptor->'effects'),false)
   OR NOT coalesce((g.data->'privacy_classes') @> (descriptor->'privacy_classes'),false)
 THEN RETURN false; END IF;
 -- No input refs exist for this exact create DTO. The ONLY excluded resource
 -- check is its known target prohibition, which is the reason for this feedback.
 PERFORM require_general_publication_authority(r);
 RETURN true;
END $$;

CREATE FUNCTION target_create_rejection(aid text, step text, d jsonb)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE e jsonb; s responses_steps; r runs; cfg jsonb; n integer; bound integer; diagnostic jsonb;
BEGIN
 IF step!~'^selection(_[2-8])?$' THEN RETURN false; END IF;
 SELECT rr.* INTO r FROM runs rr JOIN provider_attempts a ON a.workspace_id=rr.workspace_id AND a.run_id=rr.id WHERE a.id=aid;
 SELECT data INTO e FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='result';
 SELECT * INTO s FROM responses_steps WHERE attempt_id=aid AND phase=step;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 n=CASE WHEN step='selection' THEN 1 ELSE substring(step from 11)::integer END;
 bound=(cfg->'responses'->>'max_steps')::integer;
 diagnostic=jsonb_build_object('code','target_create_rejected','worker_fence',d->'diagnostic'->'worker_fence','detail',
   'This run is limited to its existing target. files_create_draft would create an unrelated object. No tool call was reserved or dispatched and no file was created. Choose a NEW authorized action on the target, or explain the remaining limitation.');
 IF NOT coalesce(
   d-ARRAY['status','body','file','output','binding','diagnostic','reason','goal','success_criteria','decision','verification','terminal_outcome']='{}'::jsonb
   AND d->>'status'='rejected' AND d->'diagnostic'=diagnostic
   AND (d->'diagnostic'->'worker_fence'=r.data->'fence' OR EXISTS(
     SELECT 1 FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='tool_result' AND data=d))
   AND d->'body'='null'::jsonb AND d->'file'='null'::jsonb AND d->'output'='null'::jsonb
   AND d->'decision'=e->'value'->'decision' AND d->'goal'=e->'value'->'goal'
   AND d->'success_criteria'=e->'value'->'success_criteria'
   AND d->'binding'=jsonb_build_object('attempt_id',aid,'selection_request_sha256',s.request_sha256,
     'selection_response_id',e->>'response_id','decision_sha256',tool_json_hash(e->'value'),
     'operation_hash',tool_json_hash(e->'value'->'decision'),'base_hash',NULL)
   AND d->>'terminal_outcome'=CASE WHEN n=bound THEN 'step_limit' ELSE 'continue' END
   AND d->'verification'->'satisfied'='false'::jsonb
   AND d->'verification'->'model_tests_passed'='false'::jsonb
   AND d->'verification'->>'requested_goal_status'='needs_validation'
   AND d->'verification'->'checks'='[]'::jsonb,false)
 THEN RETURN false; END IF;
 RETURN target_create_rejection_authorized(aid,step,(r.data->>'fence')::integer);
END $$;

-- Preserve every other byte of both predecessor functions. The consumption
-- allowlist and file-resource authorizer are unchanged. Only the two guards
-- which require observed output can admit this independently authenticated
-- no-effect rejection instead. Drift/reapplication fails transactionally.
DO $$ DECLARE definition text; name text; expected text;
 needle text=$q$ IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;$q$;
BEGIN
 FOREACH name IN ARRAY ARRAY['guard_alpha_stage()','guard_file_tool_stage()'] LOOP
   expected=CASE name
     WHEN 'guard_alpha_stage()' THEN '7038cc3e418b065e3cd0b021beb725ec8347db8ded421f34963921484e69b7d3'
     ELSE '6dea55aec456abc10e3e5939e0460d256a7906c62997e90b11885094f7406a57' END;
   definition=pg_get_functiondef(name::regprocedure);
   IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>expected
      OR (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
   THEN RAISE EXCEPTION 'target create rejection predecessor drift: %',name; END IF;
   EXECUTE replace(definition,needle,needle||E'\n IF target_create_rejection(NEW.attempt_id,NEW.phase,NEW.data) THEN RETURN NEW; END IF;');
 END LOOP;
END $$;
