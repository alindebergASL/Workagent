-- Add a read-only search capability without changing historical guard functions.
-- The old trigger still handles every non-search selection, including unknowns.
DROP TRIGGER alpha_stage_guard ON responses_events;
CREATE TRIGGER alpha_stage_guard BEFORE INSERT ON responses_events
FOR EACH ROW WHEN (
  coalesce(NEW.data->'decision'->>'kind','') <> 'search_work_context' AND
  coalesce(NEW.data->'capability_result'->>'capability','') <> 'search_work_context'
) EXECUTE FUNCTION guard_alpha_stage();

CREATE FUNCTION guard_work_context_search() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb; decision jsonb; config jsonb; snapshot jsonb; binding jsonb;
        observation jsonb; result jsonb; hit jsonb; source jsonb; cv jsonb;
        material jsonb; text_value text; revision_id text; author_kind text;
        created_at timestamptz; r runs; attempt provider_attempts; step responses_steps;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data INTO selected FROM responses_events
   WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 decision=selected->'value'->'decision';
 IF coalesce(decision->>'kind','')<>'search_work_context'
    AND coalesce(NEW.data->'decision'->>'kind','')<>'search_work_context'
    AND coalesce(NEW.data->'capability_result'->>'capability','')<>'search_work_context'
 THEN RETURN NEW; END IF;
 SELECT * INTO attempt FROM provider_attempts WHERE id=NEW.attempt_id;
 SELECT * INTO r FROM runs WHERE workspace_id=attempt.workspace_id AND id=attempt.run_id;
 SELECT data INTO config FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 PERFORM require_general_publication_authority(r);
 SELECT data->'work_context_index' INTO snapshot FROM run_contexts WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT * INTO step FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
 binding=NEW.data->'binding'; observation=NEW.data->'capability_result'; result=observation->'result';
 IF config->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
    OR config ? 'responsibility' OR snapshot IS NULL
    OR decision->>'kind' IS DISTINCT FROM 'search_work_context'
    OR NEW.data->'decision' IS DISTINCT FROM decision
    OR selected->>'state' IS DISTINCT FROM 'function_call'
    OR observation->>'capability' IS DISTINCT FROM 'search_work_context'
    OR observation->>'version' IS DISTINCT FROM '1'
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
    OR result->>'scope' IS DISTINCT FROM 'grant_conversations_read_only'
    OR result->>'query' IS DISTINCT FROM decision->>'query'
    OR length(decision->>'query') NOT BETWEEN 1 AND 240
    OR (decision->>'limit')::integer NOT BETWEEN 1 AND 6
    OR jsonb_typeof(result->'matches') IS DISTINCT FROM 'array'
    OR jsonb_array_length(result->'matches')>(decision->>'limit')::integer
 THEN RAISE EXCEPTION 'exact bounded search selection required'; END IF;
 FOR hit IN SELECT jsonb_array_elements(result->'matches') LOOP
   source=hit->'source';
   IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'items') item WHERE item=source)
      OR NOT (config->'responses'->'conversation_ids' ? (source->>'conversation_id'))
      OR source->>'conversation_id'=r.conversation_id
   THEN RAISE EXCEPTION 'search source outside frozen grant scope'; END IF;
   SELECT data INTO cv FROM conversations WHERE workspace_id=r.workspace_id AND id=source->>'conversation_id';
   IF cv IS NULL OR cv->>'owner_id' IS DISTINCT FROM r.data->>'principal_id'
      OR cv->>'state' IS DISTINCT FROM 'open' OR cv->'selected_source_refs' IS DISTINCT FROM '[]'::jsonb
      OR cv->'work_version' IS DISTINCT FROM source->'conversation_work_version'
      OR coalesce(cv->'work_area'->>'title',cv->>'title') IS DISTINCT FROM source->>'title'
   THEN RAISE EXCEPTION 'search conversation authority changed'; END IF;
   IF source->>'kind'='human_message' THEN
     SELECT m.data INTO material FROM conversation_messages m WHERE m.workspace_id=r.workspace_id
       AND m.conversation_id=source->>'conversation_id' AND m.id=source->>'record_id' AND m.author_kind='human';
     text_value=material->>'text'; revision_id=NULL; author_kind='human'; created_at=(material->>'created_at')::timestamptz;
   ELSIF source->>'kind'='saved_revision' THEN
     SELECT rev.data INTO material FROM artifacts a JOIN revisions rev
       ON rev.workspace_id=a.workspace_id AND rev.artifact_id=a.id AND rev.id=a.current_revision_id
       WHERE a.workspace_id=r.workspace_id AND a.conversation_id=source->>'conversation_id' AND a.id=source->>'record_id'
       AND rev.data->'body'->>'kind' IS DISTINCT FROM 'file';
     text_value=acceptance_canonical_json(material->'body'); revision_id=material->>'id';
     author_kind=material->>'author_kind'; created_at=(material->>'created_at')::timestamptz;
   ELSE RAISE EXCEPTION 'unknown search source'; END IF;
   IF material IS NULL OR source->>'revision_id' IS DISTINCT FROM revision_id
      OR source->>'author_kind' IS DISTINCT FROM author_kind
      OR (source->>'created_at')::timestamptz IS DISTINCT FROM created_at
      OR source->>'content_sha256' IS DISTINCT FROM encode(sha256(convert_to(text_value,'UTF8')),'hex')
      OR jsonb_typeof(hit->'excerpt_start') IS DISTINCT FROM 'number'
      OR (hit->>'excerpt_start')::integer<0
      OR length(hit->>'excerpt') NOT BETWEEN 1 AND 2000
      OR hit->>'excerpt' IS DISTINCT FROM substring(text_value FROM (hit->>'excerpt_start')::integer+1 FOR 2000)
      OR hit->'truncated' IS DISTINCT FROM to_jsonb((hit->>'excerpt_start')::integer>0 OR length(hit->>'excerpt')<length(text_value))
   THEN RAISE EXCEPTION 'search excerpt must match exact current canonical content'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER work_context_search_guard BEFORE INSERT ON responses_events
FOR EACH ROW EXECUTE FUNCTION guard_work_context_search();

-- Retrieval dependencies survive until every publication boundary, not merely
-- insertion of the observation. Reuse the existing message/revision/proposal
-- guards' central authority call; do not introduce a second publication path.
CREATE FUNCTION require_work_context_sources(r runs) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source jsonb; config jsonb; cv jsonb; material jsonb; text_value text;
BEGIN
 SELECT data INTO config FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 FOR source IN
   SELECT hit->'source' FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id,
     LATERAL jsonb_array_elements(e.data->'capability_result'->'result'->'matches') hit
   WHERE a.workspace_id=r.workspace_id AND a.run_id=r.id AND e.kind='tool_result'
     AND e.data->'capability_result'->>'capability'='search_work_context'
 LOOP
   IF config ? 'responsibility' OR NOT (config->'responses'->'conversation_ids' ? (source->>'conversation_id'))
   THEN RAISE EXCEPTION 'retained search scope changed'; END IF;
   SELECT data INTO cv FROM conversations WHERE workspace_id=r.workspace_id AND id=source->>'conversation_id';
   IF cv IS NULL OR cv->>'owner_id' IS DISTINCT FROM r.data->>'principal_id'
      OR cv->>'state' IS DISTINCT FROM 'open' OR cv->'selected_source_refs' IS DISTINCT FROM '[]'::jsonb
      OR cv->'work_version' IS DISTINCT FROM source->'conversation_work_version'
   THEN RAISE EXCEPTION 'retained search conversation changed'; END IF;
   IF source->>'kind'='human_message' THEN
     SELECT m.data INTO material FROM conversation_messages m WHERE m.workspace_id=r.workspace_id
       AND m.conversation_id=source->>'conversation_id' AND m.id=source->>'record_id' AND m.author_kind='human';
     text_value=material->>'text';
   ELSIF source->>'kind'='saved_revision' THEN
     SELECT rev.data INTO material FROM artifacts a JOIN revisions rev
       ON rev.workspace_id=a.workspace_id AND rev.artifact_id=a.id AND rev.id=a.current_revision_id
       WHERE a.workspace_id=r.workspace_id AND a.conversation_id=source->>'conversation_id'
       AND a.id=source->>'record_id' AND rev.id=source->>'revision_id';
     text_value=acceptance_canonical_json(material->'body');
   ELSE RAISE EXCEPTION 'unknown retained search source'; END IF;
   IF material IS NULL OR source->>'content_sha256' IS DISTINCT FROM encode(sha256(convert_to(text_value,'UTF8')),'hex')
   THEN RAISE EXCEPTION 'retained search content changed'; END IF;
 END LOOP;
END; $$;

ALTER FUNCTION require_general_publication_authority(runs) RENAME TO require_general_publication_authority_pre_context;
CREATE FUNCTION require_general_publication_authority(r runs) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM require_general_publication_authority_pre_context(r);
 PERFORM require_work_context_sources(r);
END; $$;
