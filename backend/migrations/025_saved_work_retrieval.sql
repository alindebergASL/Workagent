-- Add bounded saved-work retrieval; historical SQL001–024 remain immutable.
-- Existing answer/guidance guards are preserved, with one new read decision.
CREATE OR REPLACE FUNCTION guard_alpha_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE config jsonb; selection jsonb; observation jsonb; result jsonb;
        attempt provider_attempts%ROWTYPE; revision jsonb; snapshot jsonb;
        message jsonb; body_size bigint; used_bytes bigint;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT rc.data INTO config FROM provider_attempts a JOIN run_configurations rc
 ON rc.workspace_id=a.workspace_id AND rc.run_id=a.run_id WHERE a.id=NEW.attempt_id;
 IF config->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1' THEN
   IF NEW.data->>'terminal_outcome'='answered' OR NEW.data ? 'capability_result'
   THEN RAISE EXCEPTION 'reviewed alpha extension required'; END IF;
   RETURN NEW;
 END IF;
 SELECT data->'value'->'decision' INTO selection FROM responses_events
 WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF NEW.data->'decision' IS DISTINCT FROM selection THEN RAISE EXCEPTION 'exact selected decision required'; END IF;
 IF NEW.data->>'terminal_outcome'='answered' THEN
   IF selection->>'kind' IS DISTINCT FROM 'reply'
      OR NEW.data->>'status' IS DISTINCT FROM 'reply'
      OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
      OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'needs_validation'
      OR NEW.data->'binding'->'operation_hash' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'answer is not operational completion'; END IF;
 END IF;
 observation=NEW.data->'capability_result';
 IF selection->>'kind' IN ('discover_capabilities','load_skill','read_context','read_saved_work') THEN
   IF observation IS NULL OR observation->>'capability' IS DISTINCT FROM selection->>'kind'
      OR observation->>'version' IS DISTINCT FROM '1'
      OR NEW.data->>'status' IS DISTINCT FROM 'reply'
      OR NEW.data->>'terminal_outcome' NOT IN ('continue','step_limit')
      OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
      OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'file' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'guidance/read is not product or completion'; END IF;
   IF selection->>'kind'='load_skill' AND (
       observation->'result'->>'skill_id' IS DISTINCT FROM selection->>'skill_id'
       OR observation->'result'->>'version' IS DISTINCT FROM selection->>'version'
       OR observation->'result'->>'sha256' IS DISTINCT FROM selection->>'sha256'
       OR observation->'result'->>'sha256' IS DISTINCT FROM
          encode(sha256(convert_to(acceptance_canonical_json(observation->'result'->'guidance'),'UTF8')),'hex')
       OR observation->'result'->'guidance'->>'authority' IS DISTINCT FROM 'guidance_only')
   THEN RAISE EXCEPTION 'exact immutable guidance selection required'; END IF;
   IF selection->>'kind'='read_saved_work' THEN
     SELECT * INTO attempt FROM provider_attempts WHERE id=NEW.attempt_id;
     SELECT data INTO message FROM conversation_messages
       WHERE workspace_id=attempt.workspace_id AND data->>'run_id'=attempt.run_id AND author_kind='human';
     SELECT data->'work_area_context' INTO snapshot FROM run_contexts
       WHERE workspace_id=attempt.workspace_id AND run_id=attempt.run_id;
     IF message IS NULL OR snapshot IS NULL OR
        (message->'target' IS DISTINCT FROM 'null'::jsonb AND message->'target' IS DISTINCT FROM selection->'target') OR
        NOT EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'artifacts') item
          WHERE item->>'artifact_id'=selection->'target'->>'artifact_id'
            AND item->>'revision_id'=selection->'target'->>'revision_id'
            AND item->>'body_hash'=selection->'target'->>'body_hash')
     THEN RAISE EXCEPTION 'saved read requires human snapshot scope'; END IF;
     SELECT r.data INTO revision FROM artifacts a JOIN revisions r
       ON r.workspace_id=a.workspace_id AND r.artifact_id=a.id AND r.id=a.current_revision_id
       WHERE a.workspace_id=attempt.workspace_id AND a.conversation_id=snapshot->>'conversation_id'
         AND a.id=selection->'target'->>'artifact_id' AND r.id=selection->'target'->>'revision_id'
         AND r.data->>'body_hash'=selection->'target'->>'body_hash';
     IF revision IS NULL THEN RAISE EXCEPTION 'saved read requires exact current revision'; END IF;
     body_size=octet_length(convert_to(acceptance_canonical_json(revision->'body'),'UTF8'));
     SELECT COALESCE(sum((data->'capability_result'->'result'->>'body_bytes')::bigint),0) INTO used_bytes
       FROM responses_events WHERE attempt_id=NEW.attempt_id AND kind='tool_result'
         AND data->'capability_result'->>'capability'='read_saved_work'
         AND data->'capability_result'->'result'->>'status'='complete';
     result=observation->'result';
     IF result->'target' IS DISTINCT FROM selection->'target'
        OR result->>'provenance' IS DISTINCT FROM 'canonical_current_revision'
        OR result->>'author_kind' IS DISTINCT FROM revision->>'author_kind'
        OR result->'body_bytes' IS DISTINCT FROM to_jsonb(body_size)
        OR result->'limit_bytes' IS DISTINCT FROM '32768'::jsonb
        OR result->>'status' IS DISTINCT FROM (CASE WHEN body_size+used_bytes<=32768 THEN 'complete' ELSE 'size_limit' END)
        OR result->'body' IS DISTINCT FROM (CASE WHEN body_size+used_bytes<=32768 THEN revision->'body' ELSE 'null'::jsonb END)
        OR result->'remaining_bytes' IS DISTINCT FROM to_jsonb(CASE WHEN body_size+used_bytes<=32768 THEN 32768-used_bytes-body_size ELSE 32768-used_bytes END)
        OR NEW.data->'binding'->>'base_hash' IS DISTINCT FROM revision->>'body_hash'
     THEN RAISE EXCEPTION 'saved read must be exact and bounded'; END IF;
   END IF;
 ELSIF observation IS NOT NULL THEN RAISE EXCEPTION 'read selection required'; END IF;
 RETURN NEW;
END; $$;
