-- Public reads are retained observations, never independent verification.
-- Accept their exact receipts in a responsibility's follow-through alongside
-- prepared artifacts; keep original receipts and authority/revision checks.
CREATE OR REPLACE FUNCTION guard_followthrough_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg jsonb; selected jsonb; ref jsonb; observed jsonb; evidence jsonb := '[]'::jsonb;
        r runs; material jsonb; basis text;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT rc.data INTO cfg FROM provider_attempts a JOIN run_configurations rc
 ON rc.workspace_id=a.workspace_id AND rc.run_id=a.run_id WHERE a.id=NEW.attempt_id;
 SELECT run.* INTO r FROM provider_attempts a JOIN runs run
 ON run.workspace_id=a.workspace_id AND run.id=a.run_id WHERE a.id=NEW.attempt_id;
 SELECT data->'value'->'decision' INTO selected FROM responses_events
 WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF selected->>'kind' IS DISTINCT FROM 'advance_responsibility' THEN
   IF NEW.data ? 'followthrough_result' THEN RAISE EXCEPTION 'selected followthrough required'; END IF;
   RETURN NEW;
 END IF;
 IF cfg->'responses'->>'continuity_version' IS DISTINCT FROM 'sustained-v1'
    OR NOT cfg ? 'responsibility' OR selected IS DISTINCT FROM NEW.data->'decision'
    OR selected->'expected_work_version' IS DISTINCT FROM cfg->'responsibility'->'work_version'
    OR NEW.data->>'status' IS DISTINCT FROM 'reply'
    OR NEW.data->>'terminal_outcome' NOT IN ('continue','needs_validation')
    OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb OR NEW.data->'file' IS DISTINCT FROM 'null'::jsonb
    OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb
    OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
    OR NEW.data->'binding'->>'operation_hash' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected),'UTF8')),'hex')
    OR jsonb_array_length(selected->'evidence') NOT BETWEEN 1 AND 8
 THEN RAISE EXCEPTION 'exact scoped preparation plan required'; END IF;
 PERFORM require_general_publication_authority(r);
 IF selected->'plan'->'dependencies' IS DISTINCT FROM (
    SELECT coalesce(jsonb_agg(jsonb_build_object('kind',d->>'kind','object_id',d->>'object_id',
      'expected_version',d->>'observed_version')),'[]'::jsonb)
    FROM jsonb_array_elements(cfg->'responsibility'->'observations') d)
 THEN RAISE EXCEPTION 'followthrough cannot expand dependency access'; END IF;
 FOR ref IN SELECT jsonb_array_elements(selected->'evidence') LOOP
   SELECT data INTO observed FROM responses_events WHERE attempt_id=NEW.attempt_id
      AND phase=ref->>'phase' AND phase<NEW.phase AND kind='tool_result';
   IF observed IS NULL OR observed->'binding'->'operation_hash' IS DISTINCT FROM ref->'operation_hash'
   THEN RAISE EXCEPTION 'earlier bound observation required'; END IF;
   IF observed->>'status'='observed' AND nullif(observed->'body','null'::jsonb) IS NOT NULL THEN
     material=observed->'body'; basis='observed_preparation_not_goal_verification';
   ELSIF observed->>'status'='reply'
       AND observed->'decision'->>'kind'='fetch_public_url'
       AND observed->'capability_result'->>'capability'='fetch_public_url'
       AND observed->'capability_result'->'result'->>'status' IN ('ok','error')
       AND observed->'capability_result'->'result'->>'trust'='untrusted_external_content' THEN
     material=observed->'capability_result'->'result'; basis='public_read_not_goal_verification';
   ELSE RAISE EXCEPTION 'earlier preparation or public read required'; END IF;
   evidence=evidence || jsonb_build_array(jsonb_build_object('phase',ref->>'phase',
     'operation_hash',ref->>'operation_hash',
     'body_hash',encode(sha256(convert_to(acceptance_canonical_json(material),'UTF8')),'hex'),
     'basis',basis));
 END LOOP;
 IF NEW.data->'followthrough_result' IS DISTINCT FROM jsonb_build_object(
    'assignment_id',cfg->'responsibility'->>'assignment_id','work_version',cfg->'responsibility'->'work_version',
    'evidence',evidence,'status','staged_until_settlement')
 THEN RAISE EXCEPTION 'exact observed preparation evidence required'; END IF;
 RETURN NEW;
END; $$;
