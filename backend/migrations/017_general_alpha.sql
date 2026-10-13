-- Additive opt-in answer/composition semantics. Historical receipts are not rewritten.
-- No authority, acceptance, verification, budget or material guard is relaxed.
CREATE FUNCTION alpha_explanation_text(explanation text, reason text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN length(explanation)+length(suffix)>10000
   THEN left(explanation,10000-length(suffix)-length(marker)) || marker || suffix
   ELSE explanation || suffix END
 FROM (SELECT CASE WHEN reason IS NOT NULL THEN E'\n\nExecution status: ' || reason ELSE '' END AS suffix,
       E'\n[Explanation shortened; full retained explanation is available in turn details.]' AS marker) bounds;
$$;

CREATE FUNCTION general_publication_text(stage jsonb, final jsonb, config jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN config->'responses'->>'runtime_extension'='general-alpha-v1' THEN
   CASE WHEN stage->>'terminal_outcome'='answered' THEN stage->'decision'->>'text'
        WHEN stage->>'terminal_outcome' IN ('blocked','waiting_for_user','step_limit','budget_limit') THEN stage->>'reason'
        ELSE alpha_explanation_text(final->'value'->>'text',stage->>'reason') END
 ELSE CASE WHEN stage->'output'->>'kind'='artifact_draft' OR
   (config->'responses'->>'policy_version'='adaptive-local-v1' AND
    (stage->>'terminal_outcome' IN ('needs_validation','blocked','waiting_for_user','step_limit') OR
     (stage->>'terminal_outcome'='completed' AND stage->'verification'->'automatic'->>'passed'='true')))
   THEN stage->>'reason' ELSE final->'value'->>'text' END END;
$$;



CREATE OR REPLACE FUNCTION protect_provider_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_state text; new_state text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable attempt admission'; END IF;
 old_state=OLD.data->>'state'; new_state=NEW.data->>'state';
 IF OLD.data->>'profile'='general-responses-v1' AND new_state='reconciled' THEN
   IF old_state NOT IN ('dispatched','outcome_unknown') OR
      (NEW.data-'state') IS DISTINCT FROM (OLD.data-'state') OR
      (to_jsonb(NEW)-'data') IS DISTINCT FROM (to_jsonb(OLD)-'data') OR
      NOT EXISTS (SELECT 1 FROM conversation_messages m JOIN responses_events e ON e.attempt_id=NEW.id AND e.phase='final' AND e.kind='result'
          JOIN run_configurations rc ON rc.workspace_id=NEW.workspace_id AND rc.run_id=NEW.run_id
          JOIN responses_events t ON t.attempt_id=NEW.id AND t.kind='tool_result'
             AND (rc.data->'responses'->>'policy_version'='adaptive-local-v1' OR t.phase='selection')
          WHERE m.workspace_id=NEW.workspace_id AND m.run_id=NEW.run_id AND m.author_kind='assistant'
          AND m.data->>'model_receipt'=NEW.id AND e.data->>'state'='completed'
          AND m.data->>'text'=general_publication_text(t.data,e.data,rc.data))
   THEN RAISE EXCEPTION 'exact general publication receipts required'; END IF;
   RETURN NEW;
 END IF;

 IF NEW.workspace_id<>OLD.workspace_id OR NEW.run_id<>OLD.run_id OR NEW.id<>OLD.id OR NEW.grant_id<>OLD.grant_id
 OR (NEW.data - ARRAY['state','provider_session_id','provider_turn_id','result','result_hash'])
 IS DISTINCT FROM (OLD.data - ARRAY['state','provider_session_id','provider_turn_id','result','result_hash'])
 THEN RAISE EXCEPTION 'immutable attempt binding'; END IF;
 IF NOT ((old_state='prepared' AND new_state IN ('dispatched','failed'))
 OR (old_state='dispatched' AND new_state IN ('outcome_unknown','responded','failed'))
 OR (old_state='outcome_unknown' AND new_state IN ('responded','failed'))
 OR (old_state='responded' AND new_state='reconciled'))
 AND NOT (old_state IN ('dispatched','outcome_unknown') AND new_state=old_state
          AND (NEW.data - ARRAY['provider_session_id','provider_turn_id']) = (OLD.data - ARRAY['provider_session_id','provider_turn_id'])
          AND NEW.data IS DISTINCT FROM OLD.data)
 THEN RAISE EXCEPTION 'invalid attempt transition'; END IF;
 IF (OLD.data->>'provider_session_id' IS NOT NULL AND NEW.data->>'provider_session_id' IS DISTINCT FROM OLD.data->>'provider_session_id')
 OR (OLD.data->>'provider_turn_id' IS NOT NULL AND NEW.data->>'provider_turn_id' IS DISTINCT FROM OLD.data->>'provider_turn_id')
 OR (OLD.data->>'result_hash' IS NOT NULL AND
     (NEW.data->'result' IS DISTINCT FROM OLD.data->'result' OR NEW.data->>'result_hash' IS DISTINCT FROM OLD.data->>'result_hash'))
 THEN RAISE EXCEPTION 'immutable provider receipt'; END IF;
 IF new_state IN ('responded','reconciled') AND
   (NEW.data->>'result_hash' IS NULL OR NEW.data->>'provider_session_id' IS NULL OR NEW.data->>'provider_turn_id' IS NULL OR NEW.data->>'result' IS NULL)
 THEN RAISE EXCEPTION 'provider receipt required'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_general_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; rc run_configurations; g provider_grants; a jsonb; t jsonb; n integer;
BEGIN
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 IF r.data->>'profile'<>'general-responses-v1' THEN
   IF NEW.data->>'model_receipt' IS NOT NULL OR NEW.data->>'evidence_origin' IN ('synthetic_provider_receipt','live_provider_receipt')
   THEN RAISE EXCEPTION 'model evidence requires general profile'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO rc FROM run_configurations WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id;
 SELECT * INTO g FROM provider_grants WHERE id=rc.data->>'grant_id';
 IF g.id IS NULL OR NOT g.active OR g.workspace_id<>NEW.workspace_id
    OR g.principal_id IS DISTINCT FROM r.data->>'principal_id'
    OR g.data->>'profile'<>'general-responses-v1'
    OR rc.data->'responses' IS DISTINCT FROM g.data->'responses'
    OR NOT(g.data->'responses'->'conversation_ids' ? NEW.conversation_id)
 THEN RAISE EXCEPTION 'active exact conversation authority required'; END IF;
 IF NEW.author_kind='human' THEN
   IF NEW.data->'operation' IS DISTINCT FROM 'null'::jsonb OR NEW.data->>'model_receipt' IS NOT NULL
      OR jsonb_typeof(NEW.data->'attachments') IS DISTINCT FROM 'array'
      OR jsonb_array_length(NEW.data->'attachments')>2
   THEN RAISE EXCEPTION 'bounded general message inputs required'; END IF;
   n=0;
   FOR a IN SELECT jsonb_array_elements(NEW.data->'attachments') LOOP
     n=n+octet_length(a->>'content');
     IF a->>'sha256' IS DISTINCT FROM encode(sha256(convert_to(a->>'content','UTF8')),'hex')
        OR (a->>'byte_length')::integer IS DISTINCT FROM octet_length(a->>'content')
        OR octet_length(a->>'content') NOT BETWEEN 1 AND 200000
        OR a->>'ref' IS NULL OR a->>'mime_type' NOT IN ('text/csv','text/plain')
     THEN RAISE EXCEPTION 'immutable attachment bytes/hash required'; END IF;
   END LOOP;
   IF n>200000 THEN RAISE EXCEPTION 'aggregate attachment bound'; END IF;
   t=NEW.data->'target';
   IF t<>'null'::jsonb AND NOT EXISTS (SELECT 1 FROM artifacts art JOIN revisions rev ON rev.workspace_id=art.workspace_id
      AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
      WHERE art.workspace_id=NEW.workspace_id AND art.conversation_id=NEW.conversation_id
      AND art.id=t->>'artifact_id' AND rev.id=t->>'revision_id' AND rev.data->>'body_hash'=t->>'body_hash')
   THEN RAISE EXCEPTION 'exact current scoped target required'; END IF;
 ELSE
   PERFORM require_general_publication_authority(r);
   IF r.data->>'state'<>'running' OR (r.data->>'lease_expires_at')::timestamptz<=now()
      OR NOT EXISTS (SELECT 1 FROM provider_attempts pa JOIN responses_events e ON e.attempt_id=pa.id
         JOIN responses_events stage ON stage.attempt_id=pa.id AND stage.kind='tool_result' AND (rc.data->'responses'->>'policy_version'='adaptive-local-v1' OR stage.phase='selection')
         WHERE pa.id=NEW.data->>'model_receipt' AND pa.run_id=NEW.run_id AND pa.workspace_id=NEW.workspace_id
         AND pa.evidence_origin=NEW.data->>'evidence_origin' AND e.phase='final' AND e.kind='result'
         AND e.data->>'state'='completed' AND NEW.data->>'text'=general_publication_text(stage.data,e.data,rc.data))
   THEN RAISE EXCEPTION 'exact retained model explanation required'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION guard_responses_step() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a provider_attempts; g provider_grants; i integer; previous text;
BEGIN
 SELECT * INTO a FROM provider_attempts WHERE id=NEW.attempt_id;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.grant_id;
 IF a.grant_id<>NEW.grant_id OR a.data->>'profile' NOT IN ('openai-responses-v1','general-responses-v1')
 OR NEW.metadata->>'attempt_id'<>NEW.attempt_id OR NEW.metadata->>'step_id'<>NEW.phase
 OR g.data->>'profile' IS DISTINCT FROM a.data->>'profile' THEN RAISE EXCEPTION 'invalid step binding'; END IF;
 IF g.data->'responses'->>'policy_version'='adaptive-local-v1' THEN
   i=CASE WHEN NEW.phase='selection' THEN 1 WHEN NEW.phase='final' THEN 0 ELSE substring(NEW.phase from 11)::integer END;
   IF i>coalesce((g.data->'responses'->>'max_steps')::integer,0) THEN RAISE EXCEPTION 'adaptive step limit'; END IF;
   IF i>1 THEN
     previous=CASE WHEN i=2 THEN 'selection' ELSE 'selection_'||(i-1)::text END;
     IF NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=previous AND kind='tool_result'
         AND data->>'terminal_outcome'='continue') THEN RAISE EXCEPTION 'retained unsatisfied observation required'; END IF;
   END IF;
   IF NEW.phase='final' AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND kind='tool_result'
       AND (data->>'terminal_outcome' IN ('completed','blocked','waiting_for_user','step_limit','budget_limit','needs_validation')
          OR (g.data->'responses'->>'runtime_extension'='general-alpha-v1' AND data->>'terminal_outcome'='answered')))
   THEN RAISE EXCEPTION 'adaptive terminal observation required'; END IF;
 ELSIF NEW.phase NOT IN ('selection','final') THEN RAISE EXCEPTION 'adaptive capability required'; END IF;
 IF NEW.phase='final' AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase='selection' AND kind='tool_result')
 THEN RAISE EXCEPTION 'authorized selection tool result required'; END IF;
 RETURN NEW;
END;
$$;


CREATE FUNCTION guard_alpha_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE config jsonb; selection jsonb; observation jsonb;
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
 IF selection->>'kind' IN ('discover_capabilities','load_skill','read_context') THEN
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
 ELSIF observation IS NOT NULL THEN RAISE EXCEPTION 'read selection required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER alpha_stage_guard BEFORE INSERT ON responses_events
FOR EACH ROW EXECUTE FUNCTION guard_alpha_stage();

CREATE FUNCTION guard_alpha_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.data->'responses' ? 'runtime_extension' AND
    (NEW.data->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
     OR NEW.data->'responses'->>'policy_version' IS DISTINCT FROM 'adaptive-local-v1'
     OR NEW.data->>'profile' IS DISTINCT FROM 'general-responses-v1')
 THEN RAISE EXCEPTION 'unknown composition extension'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER alpha_grant_guard BEFORE INSERT OR UPDATE ON provider_grants
FOR EACH ROW EXECUTE FUNCTION guard_alpha_grant();
