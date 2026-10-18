-- Bounded discovery is not bounded authority: page only the already authorized
-- conversation (human) or exact responsibility dependencies (system). No new grant.
CREATE FUNCTION saved_work_page(r runs, after_id text, page_limit integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE cfg jsonb; message jsonb; items jsonb; more boolean; cursor_id text;
BEGIN
 PERFORM require_general_publication_authority(r);
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT data INTO message FROM conversation_messages WHERE workspace_id=r.workspace_id AND run_id=r.id AND author_kind IN ('human','system');
 IF cfg->'responses'->>'continuity_version' IS DISTINCT FROM 'sustained-v1'
    OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 12
    OR (after_id IS NOT NULL AND length(after_id) NOT BETWEEN 1 AND 128)
 THEN RAISE EXCEPTION 'bounded sustained discovery required'; END IF;
 WITH candidates AS (
  SELECT a.id,rev.data,
    octet_length(convert_to(acceptance_canonical_json(rev.data->'body'),'UTF8')) AS size
  FROM artifacts a JOIN revisions rev ON rev.workspace_id=a.workspace_id AND rev.artifact_id=a.id AND rev.id=a.current_revision_id
  WHERE a.workspace_id=r.workspace_id AND a.conversation_id=r.conversation_id
    AND rev.data->'body'->>'kind' IS DISTINCT FROM 'file'
    AND (after_id IS NULL OR a.id>after_id)
    AND (nullif(message->'target','null'::jsonb) IS NULL OR message->'target'=jsonb_build_object('artifact_id',a.id,'revision_id',rev.id,'body_hash',rev.data->>'body_hash'))
    AND (NOT cfg ? 'responsibility' OR EXISTS (SELECT 1 FROM jsonb_array_elements(cfg->'responsibility'->'observations') d
      WHERE d->>'kind'='artifact_revision' AND d->>'object_id'=a.id AND d->>'observed_version'=rev.id AND d->>'content_hash'=rev.data->>'body_hash'))
  ORDER BY a.id LIMIT page_limit+1
 ), numbered AS (SELECT *,row_number() OVER (ORDER BY id) n FROM candidates)
 SELECT coalesce(jsonb_agg(jsonb_build_object('target',jsonb_build_object('artifact_id',id,'revision_id',data->>'id','body_hash',data->>'body_hash'),
     'title',data->'body'->>'title','kind',coalesce(data->'body'->>'kind','document'),'body_bytes',size,
     'readable',size<=32768,'author_kind',data->>'author_kind') ORDER BY id) FILTER (WHERE n<=page_limit),'[]'::jsonb),
     count(*)>page_limit,max(id) FILTER (WHERE n<=page_limit)
 INTO items,more,cursor_id FROM numbered;
 RETURN jsonb_build_object('scope',CASE WHEN cfg ? 'responsibility' THEN 'responsibility_dependencies' ELSE 'current_conversation' END,
   'items',items,'has_more',more,'next_after_artifact_id',CASE WHEN more THEN cursor_id ELSE NULL END,'read_limit_bytes',32768);
END; $$;

CREATE FUNCTION saved_work_target_permitted(attempt_id text, phase_name text, target jsonb, mutation boolean)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r runs; cfg jsonb; message jsonb; snapshot jsonb;
BEGIN
 SELECT run.* INTO r FROM provider_attempts a JOIN runs run ON run.workspace_id=a.workspace_id AND run.id=a.run_id WHERE a.id=attempt_id;
 IF r.id IS NULL THEN RETURN false; END IF;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT data INTO message FROM conversation_messages WHERE workspace_id=r.workspace_id AND run_id=r.id AND author_kind IN ('human','system');
 SELECT data->'work_area_context' INTO snapshot FROM run_contexts WHERE workspace_id=r.workspace_id AND run_id=r.id;
 IF message IS NULL OR NOT EXISTS (SELECT 1 FROM artifacts a JOIN revisions rev
   ON rev.workspace_id=a.workspace_id AND rev.artifact_id=a.id AND rev.id=a.current_revision_id
   WHERE a.workspace_id=r.workspace_id AND a.conversation_id=r.conversation_id
     AND a.id=target->>'artifact_id' AND rev.id=target->>'revision_id' AND rev.data->>'body_hash'=target->>'body_hash'
     AND rev.data->'body'->>'kind' IS DISTINCT FROM 'file') THEN RETURN false; END IF;
 IF cfg ? 'responsibility' THEN
   RETURN cfg->'responses'->>'continuity_version'='sustained-v1' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(cfg->'responsibility'->'observations') d
    WHERE d->>'kind'='artifact_revision' AND d->>'object_id'=target->>'artifact_id'
      AND d->>'observed_version'=target->>'revision_id' AND d->>'content_hash'=target->>'body_hash');
 END IF;
 IF message->>'author_kind'<>'human' THEN RETURN false; END IF;
 IF nullif(message->'target','null'::jsonb) IS NOT NULL THEN RETURN message->'target'=target; END IF;
 IF mutation THEN
   RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'offered_targets') t WHERE t=target)
    OR EXISTS (SELECT 1 FROM responses_events e WHERE e.attempt_id=saved_work_target_permitted.attempt_id
      AND e.phase<phase_name AND e.kind='tool_result' AND e.data->'capability_result'->>'capability'='read_saved_work'
      AND e.data->'capability_result'->'result'->>'status'='complete' AND e.data->'capability_result'->'result'->'target'=target);
 END IF;
 RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'artifacts') item
   WHERE item->>'artifact_id'=target->>'artifact_id' AND item->>'revision_id'=target->>'revision_id' AND item->>'body_hash'=target->>'body_hash')
 OR (cfg->'responses'->>'continuity_version'='sustained-v1' AND EXISTS (
   SELECT 1 FROM responses_events e, LATERAL jsonb_array_elements(e.data->'capability_result'->'result'->'items') item
   WHERE e.attempt_id=saved_work_target_permitted.attempt_id AND e.phase<phase_name AND e.kind='tool_result'
     AND e.data->'capability_result'->>'capability'='discover_saved_work' AND item->'target'=target));
END; $$;

-- Keep the exact body/size budget and historical human snapshot read protections.
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
   IF selection->>'kind' IS DISTINCT FROM 'reply' OR NEW.data->>'status' IS DISTINCT FROM 'reply'
      OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
      OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'needs_validation'
      OR NEW.data->'binding'->'operation_hash' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'answer is not operational completion'; END IF;
 END IF;
 observation=NEW.data->'capability_result';
 IF selection->>'kind' IN ('discover_capabilities','load_skill','read_context','read_saved_work','discover_saved_work') THEN
   IF observation IS NULL OR observation->>'capability' IS DISTINCT FROM selection->>'kind'
      OR observation->>'version' IS DISTINCT FROM '1' OR NEW.data->>'status' IS DISTINCT FROM 'reply'
      OR coalesce(NEW.data->>'terminal_outcome','') NOT IN ('continue','step_limit')
      OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
      OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb OR NEW.data->'file' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb
   THEN RAISE EXCEPTION 'guidance/read is not product or completion'; END IF;
   IF selection->>'kind'='load_skill' AND (
       observation->'result'->>'skill_id' IS DISTINCT FROM selection->>'skill_id'
       OR observation->'result'->>'version' IS DISTINCT FROM selection->>'version'
       OR observation->'result'->>'sha256' IS DISTINCT FROM selection->>'sha256'
       OR observation->'result'->>'sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(observation->'result'->'guidance'),'UTF8')),'hex')
       OR observation->'result'->'guidance'->>'authority' IS DISTINCT FROM 'guidance_only')
   THEN RAISE EXCEPTION 'exact immutable guidance selection required'; END IF;
   IF selection->>'kind'='read_saved_work' THEN
     SELECT * INTO attempt FROM provider_attempts WHERE id=NEW.attempt_id;
     IF NOT coalesce(saved_work_target_permitted(NEW.attempt_id,NEW.phase,selection->'target',false),false)
     THEN RAISE EXCEPTION 'saved read requires scoped discovery or dependency'; END IF;
     SELECT rev.data INTO revision FROM revisions rev WHERE rev.workspace_id=attempt.workspace_id
       AND rev.artifact_id=selection->'target'->>'artifact_id' AND rev.id=selection->'target'->>'revision_id';
     body_size=octet_length(convert_to(acceptance_canonical_json(revision->'body'),'UTF8'));
     SELECT COALESCE(sum((data->'capability_result'->'result'->>'body_bytes')::bigint),0) INTO used_bytes
       FROM responses_events WHERE attempt_id=NEW.attempt_id AND kind='tool_result'
         AND data->'capability_result'->>'capability'='read_saved_work' AND data->'capability_result'->'result'->>'status'='complete';
     result=observation->'result';
     IF result->'target' IS DISTINCT FROM selection->'target'
        OR result->>'provenance' IS DISTINCT FROM 'canonical_current_revision' OR result->>'author_kind' IS DISTINCT FROM revision->>'author_kind'
        OR result->'body_bytes' IS DISTINCT FROM to_jsonb(body_size) OR result->'limit_bytes' IS DISTINCT FROM '32768'::jsonb
        OR result->>'status' IS DISTINCT FROM (CASE WHEN body_size+used_bytes<=32768 THEN 'complete' ELSE 'size_limit' END)
        OR result->'body' IS DISTINCT FROM (CASE WHEN body_size+used_bytes<=32768 THEN revision->'body' ELSE 'null'::jsonb END)
        OR result->'remaining_bytes' IS DISTINCT FROM to_jsonb(CASE WHEN body_size+used_bytes<=32768 THEN 32768-used_bytes-body_size ELSE 32768-used_bytes END)
        OR NEW.data->'binding'->>'base_hash' IS DISTINCT FROM revision->>'body_hash'
     THEN RAISE EXCEPTION 'saved read must be exact and bounded'; END IF;
   END IF;
 ELSIF observation IS NOT NULL THEN RAISE EXCEPTION 'read selection required'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION guard_saved_discovery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb; decision jsonb; binding jsonb; r runs; step responses_steps; cfg jsonb;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data INTO selected FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 decision=selected->'value'->'decision';
 SELECT run.* INTO r FROM provider_attempts a JOIN runs run ON run.workspace_id=a.workspace_id AND run.id=a.run_id WHERE a.id=NEW.attempt_id;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 IF decision->>'kind'='discover_saved_work' OR NEW.data->'capability_result'->>'capability'='discover_saved_work' THEN
   SELECT * INTO step FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
   binding=NEW.data->'binding';
   IF decision->>'kind' IS DISTINCT FROM 'discover_saved_work' OR NEW.data->'decision' IS DISTINCT FROM decision
      OR selected->>'state' IS DISTINCT FROM 'function_call'
      OR binding->>'attempt_id' IS DISTINCT FROM NEW.attempt_id
      OR binding->>'selection_request_sha256' IS DISTINCT FROM selected->>'request_sha256'
      OR binding->>'selection_request_sha256' IS DISTINCT FROM step.request_sha256
      OR binding->>'selection_response_id' IS DISTINCT FROM selected->>'response_id'
      OR binding->>'decision_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected->'value'),'UTF8')),'hex')
      OR binding->>'operation_hash' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(decision),'UTF8')),'hex')
      OR binding->'base_hash' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'capability_result' IS DISTINCT FROM jsonb_build_object('capability','discover_saved_work','version','1',
           'result',saved_work_page(r,decision->>'after_artifact_id',(decision->>'limit')::integer))
   THEN RAISE EXCEPTION 'exact bounded saved discovery receipt required'; END IF;
 END IF;
 IF cfg->'responses'->>'continuity_version'='sustained-v1'
    AND decision->>'kind' IN ('publish_artifact','reconcile_csv','run_wasm')
    AND nullif(decision->'target','null'::jsonb) IS NOT NULL
    AND NOT coalesce(saved_work_target_permitted(NEW.attempt_id,NEW.phase,decision->'target',true),false)
 THEN RAISE EXCEPTION 'revision requires scoped offered or completely read target'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER saved_discovery_guard BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION guard_saved_discovery();

-- Recheck consumed saved revisions even if a later action only replies or makes
-- a new artifact. Discovery alone does not unnecessarily fence unrelated work.
CREATE FUNCTION require_saved_read_sources(r runs) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target jsonb;
BEGIN
 FOR target IN SELECT e.data->'capability_result'->'result'->'target'
   FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id
   WHERE a.workspace_id=r.workspace_id AND a.run_id=r.id AND e.kind='tool_result'
     AND e.data->'capability_result'->>'capability'='read_saved_work'
 LOOP
   IF NOT EXISTS (SELECT 1 FROM artifacts a JOIN revisions rev ON rev.workspace_id=a.workspace_id AND rev.artifact_id=a.id AND rev.id=a.current_revision_id
     WHERE a.workspace_id=r.workspace_id AND a.conversation_id=r.conversation_id
       AND a.id=target->>'artifact_id' AND rev.id=target->>'revision_id' AND rev.data->>'body_hash'=target->>'body_hash')
   THEN RAISE EXCEPTION 'retained saved read changed'; END IF;
 END LOOP;
END; $$;
ALTER FUNCTION require_general_publication_authority(runs) RENAME TO require_general_publication_authority_pre_saved_discovery;
CREATE FUNCTION require_general_publication_authority(r runs) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM require_general_publication_authority_pre_saved_discovery(r);
 PERFORM require_saved_read_sources(r);
END; $$;
