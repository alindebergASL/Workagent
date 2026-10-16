-- New read-only local inspection. Existing stage guards retain their original
-- definitions; all non-inspection paths, including search, stay governed as before.
DROP TRIGGER alpha_stage_guard ON responses_events;
CREATE TRIGGER alpha_stage_guard BEFORE INSERT ON responses_events
FOR EACH ROW WHEN (
  coalesce(NEW.data->'decision'->>'kind','') NOT IN ('search_work_context','inspect_json') AND
  coalesce(NEW.data->'capability_result'->>'capability','') NOT IN ('search_work_context','inspect_json')
) EXECUTE FUNCTION guard_alpha_stage();

CREATE FUNCTION guard_json_inspection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb; decision jsonb; config jsonb; message jsonb; attachment jsonb;
        observation jsonb; result jsonb; binding jsonb; chosen jsonb; path_item jsonb;
        key text; source_text text; canonical text; size bigint; r runs; attempt provider_attempts;
        step responses_steps;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data INTO selected FROM responses_events
   WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 decision=selected->'value'->'decision';
 IF coalesce(decision->>'kind','')<>'inspect_json'
    AND coalesce(NEW.data->'decision'->>'kind','')<>'inspect_json'
    AND coalesce(NEW.data->'capability_result'->>'capability','')<>'inspect_json'
 THEN RETURN NEW; END IF;
 SELECT * INTO attempt FROM provider_attempts WHERE id=NEW.attempt_id;
 SELECT * INTO r FROM runs WHERE workspace_id=attempt.workspace_id AND id=attempt.run_id;
 SELECT data INTO config FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 PERFORM require_general_publication_authority(r);
 SELECT data INTO message FROM conversation_messages WHERE workspace_id=r.workspace_id
   AND run_id=r.id AND author_kind='human';
 SELECT * INTO step FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
 binding=NEW.data->'binding'; observation=NEW.data->'capability_result'; result=observation->'result';
 IF config->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
    OR config ? 'responsibility' OR message IS NULL
    OR message->'target' IS DISTINCT FROM 'null'::jsonb
    OR decision->>'kind' IS DISTINCT FROM 'inspect_json'
    OR NEW.data->'decision' IS DISTINCT FROM decision
    OR selected->>'state' IS DISTINCT FROM 'function_call'
    OR observation->>'capability' IS DISTINCT FROM 'inspect_json'
    OR observation->>'version' IS DISTINCT FROM '1'
    OR (observation - ARRAY['capability','version','result']) IS DISTINCT FROM '{}'::jsonb
    OR NEW.data->>'status' IS DISTINCT FROM 'reply'
    OR coalesce(NEW.data->>'terminal_outcome','') NOT IN ('continue','step_limit')
    OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
    OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'needs_validation'
    OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb
    OR NEW.data->'file' IS DISTINCT FROM 'null'::jsonb
    OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb
    OR binding->>'attempt_id' IS DISTINCT FROM NEW.attempt_id
    OR binding->>'selection_request_sha256' IS DISTINCT FROM selected->>'request_sha256'
    OR binding->>'selection_request_sha256' IS DISTINCT FROM step.request_sha256
    OR binding->>'selection_response_id' IS DISTINCT FROM selected->>'response_id'
    OR binding->>'decision_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected->'value'),'UTF8')),'hex')
    OR binding->>'operation_hash' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(decision),'UTF8')),'hex')
    OR binding->'base_hash' IS DISTINCT FROM 'null'::jsonb
    OR result->'attachment' IS DISTINCT FROM decision->'attachment'
    OR result->'path' IS DISTINCT FROM decision->'path'
    OR result->'limit_bytes' IS DISTINCT FROM '16384'::jsonb
    OR jsonb_typeof(decision->'path') IS DISTINCT FROM 'array'
    OR jsonb_array_length(decision->'path')>12
    OR (result - ARRAY['attachment','path','status','reason','selected_json','value_bytes','limit_bytes']) IS DISTINCT FROM '{}'::jsonb
 THEN RAISE EXCEPTION 'exact bounded inspection selection required'; END IF;
 SELECT item INTO attachment FROM jsonb_array_elements(message->'attachments') item
   WHERE item->>'ref'=decision->'attachment'->>'ref' AND item->>'sha256'=decision->'attachment'->>'sha256'
     AND item->>'mime_type'='text/plain' AND right(item->>'filename',5)='.json';
 IF attachment IS NULL OR attachment->>'sha256' IS DISTINCT FROM
    encode(sha256(convert_to(attachment->>'content','UTF8')),'hex')
 THEN RAISE EXCEPTION 'inspection requires exact current human JSON attachment'; END IF;
 FOR path_item IN SELECT jsonb_array_elements(decision->'path') LOOP
   IF jsonb_typeof(path_item)<>'string' OR length(path_item#>>'{}')>128
   THEN RAISE EXCEPTION 'bounded literal path required'; END IF;
 END LOOP;
 -- Invalid input never yields partial content or a completion claim. Error
 -- reasons are closed; neither raw text nor parser/SQL exception messages appear.
 IF result->>'status'='invalid_input' THEN
   IF coalesce(result->>'reason','') NOT IN ('invalid_json','input_limit','structure_limit','number_limit')
      OR result->'selected_json' IS DISTINCT FROM 'null'::jsonb
      OR result->'value_bytes' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'bounded inspection error required'; END IF;
   RETURN NEW;
 END IF;
 source_text=attachment->>'content';
 IF NOT (source_text IS JSON WITH UNIQUE KEYS) OR octet_length(convert_to(source_text,'UTF8'))>200000
 THEN RAISE EXCEPTION 'inspection source must be valid bounded unique JSON'; END IF;
 chosen=source_text::jsonb;
 FOR path_item IN SELECT jsonb_array_elements(decision->'path') LOOP
   key=path_item#>>'{}';
   IF jsonb_typeof(chosen)='object' THEN chosen=chosen->key;
   ELSIF jsonb_typeof(chosen)='array' AND key ~ '^(0|[1-9][0-9]*)$' AND length(key)<=9
   THEN chosen=chosen->(key::integer);
   ELSE chosen=NULL; END IF;
 END LOOP;
 IF result->'reason' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'inspection reason mismatch'; END IF;
 IF chosen IS NULL THEN
   IF result->>'status' IS DISTINCT FROM 'not_found'
      OR result->'selected_json' IS DISTINCT FROM 'null'::jsonb
      OR result->'value_bytes' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'missing path must not fabricate a value'; END IF;
 ELSE
   canonical=acceptance_canonical_json(chosen); size=octet_length(convert_to(canonical,'UTF8'));
   IF result->'value_bytes' IS DISTINCT FROM to_jsonb(size)
      OR result->>'status' IS DISTINCT FROM (CASE WHEN size<=16384 THEN 'complete' ELSE 'size_limit' END)
      OR result->'selected_json' IS DISTINCT FROM (CASE WHEN size<=16384 THEN to_jsonb(canonical) ELSE 'null'::jsonb END)
   THEN RAISE EXCEPTION 'inspection value must match exact selected source'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER json_inspection_guard BEFORE INSERT ON responses_events
FOR EACH ROW EXECUTE FUNCTION guard_json_inspection();
