-- Receipt-bound recording extends canonical Assignments, not a second task store.
-- SQL001-022 remain immutable; 023 is reserved for independent accounting work.
ALTER TABLE assignments ADD COLUMN responsibility_recording jsonb;
CREATE UNIQUE INDEX one_responsibility_recording_per_run ON assignments
 (workspace_id,(responsibility_recording->>'run_id')) WHERE responsibility_recording IS NOT NULL;

-- A closed, JSON-typed envelope; casts must never normalize persisted authority.
CREATE FUNCTION valid_responsibility_recording(effect jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(
   jsonb_typeof(effect)='object'
   AND effect ?& ARRAY['run_id','attempt_id','phase','binding','request','decision_sha256','conversation_work_version','result']
   AND effect - ARRAY['run_id','attempt_id','phase','binding','request','decision_sha256','conversation_work_version','result']='{}'::jsonb
   AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['run_id','attempt_id','phase','decision_sha256']) k
       WHERE jsonb_typeof(effect->k) IS DISTINCT FROM 'string' OR effect->>k='')
   AND effect->>'phase' IN ('selection','selection_2','selection_3','selection_4')
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

CREATE FUNCTION guard_responsibility_recording() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE effect jsonb; r runs; cv conversations; cfg jsonb; selected jsonb; msg jsonb; b jsonb; result jsonb; dep jsonb;
BEGIN
 IF NEW.responsibility_recording IS NOT NULL THEN
   IF current_setting('transaction_isolation')<>'read committed'
   THEN RAISE EXCEPTION 'responsibility recording requires read committed isolation'; END IF;
   IF NOT valid_responsibility_recording(NEW.responsibility_recording)
   THEN RAISE EXCEPTION 'closed typed responsibility recording required'; END IF;
   IF NEW.id IS DISTINCT FROM NEW.responsibility_recording->'result'->>'assignment_id'
      OR NEW.conversation_id IS DISTINCT FROM NEW.responsibility_recording->'result'->>'conversation_id'
      OR NEW.data->>'id' IS DISTINCT FROM NEW.id
      OR NEW.data->>'workspace_id' IS DISTINCT FROM NEW.workspace_id
      OR NEW.data->>'conversation_id' IS DISTINCT FROM NEW.conversation_id
      OR NEW.data->>'owner_id' IS DISTINCT FROM NEW.responsibility_recording->'result'->>'owner_id'
      OR NEW.responsibility_lifecycle IS NULL
   THEN RAISE EXCEPTION 'canonical responsibility recording identity and lifecycle required'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.responsibility_recording IS NOT NULL THEN
   IF NEW.responsibility_recording IS DISTINCT FROM OLD.responsibility_recording
      OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.id IS DISTINCT FROM OLD.id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
   THEN RAISE EXCEPTION 'immutable responsibility recording'; END IF;
   -- Human goal/version/lifecycle edits remain legal; only the binding is fixed.
   RETURN NEW;
 END IF;
 effect=NEW.responsibility_recording;
 IF effect IS NULL THEN RETURN NEW; END IF;
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'activate before recording'; END IF;
 SELECT run.* INTO r FROM runs run JOIN provider_attempts a ON a.workspace_id=run.workspace_id AND a.run_id=run.id
 WHERE a.id=effect->>'attempt_id' AND run.id=effect->>'run_id' AND run.workspace_id=NEW.workspace_id;
 SELECT * INTO cv FROM conversations WHERE workspace_id=r.workspace_id AND id=r.conversation_id;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT data INTO selected FROM responses_events WHERE attempt_id=effect->>'attempt_id'
 AND phase=effect->>'phase' AND kind='result';
 SELECT data INTO msg FROM conversation_messages WHERE workspace_id=r.workspace_id AND run_id=r.id
 AND author_kind='human' AND id=effect->'request'->>'message_id';
 IF r.id IS NULL OR r.data->>'profile' IS DISTINCT FROM 'general-responses-v1'
    OR cfg->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
    OR cfg ? 'responsibility' OR msg IS NULL OR msg->>'author_id' IS DISTINCT FROM r.data->>'principal_id'
    OR cv.data->>'owner_id' IS DISTINCT FROM r.data->>'principal_id' OR cv.data->>'state' IS DISTINCT FROM 'open'
    OR r.data->>'state' IS DISTINCT FROM 'running' OR (r.data->>'lease_expires_at')::timestamptz<=now()
    OR cv.id IS DISTINCT FROM NEW.conversation_id
    OR NEW.data->>'owner_id' IS DISTINCT FROM r.data->>'principal_id'
    OR NEW.data->>'work_version' IS DISTINCT FROM '2' OR NEW.data->'run_ids' IS DISTINCT FROM '[]'::jsonb
    OR NEW.data->>'state' IS DISTINCT FROM 'paused'
    OR (cv.data->>'work_version')::integer IS DISTINCT FROM (effect->>'conversation_work_version')::integer+1
    OR selected->>'state' IS DISTINCT FROM 'function_call'
    OR selected->'value'->'decision'->>'kind' IS DISTINCT FROM 'record_responsibility'
    OR NEW.data->'goal' IS DISTINCT FROM selected->'value'->'decision'->'goal'
    OR NEW.data->'completion_criteria' IS DISTINCT FROM selected->'value'->'decision'->'completion_criteria'
    OR effect->>'decision_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected->'value'->'decision'),'UTF8')),'hex')
    OR effect->'request'->>'message_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(
        CASE WHEN msg->'acceptance_checks'='null'::jsonb THEN msg-'acceptance_checks' ELSE msg END),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'exact human alpha recording authority required'; END IF;
 PERFORM require_general_publication_authority(r);
 b=effect->'binding';
 IF b->>'attempt_id' IS DISTINCT FROM effect->>'attempt_id'
    OR b->>'selection_request_sha256' IS DISTINCT FROM selected->>'request_sha256'
    OR b->>'selection_response_id' IS DISTINCT FROM selected->>'response_id'
    OR b->>'decision_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected->'value'),'UTF8')),'hex')
    OR b->>'operation_hash' IS DISTINCT FROM effect->>'decision_sha256'
 THEN RAISE EXCEPTION 'exact recording receipt binding required'; END IF;
 IF (NEW.responsibility_lifecycle->'current_outcome') IS DISTINCT FROM selected->'value'->'decision'->'plan'->'current_outcome'
    OR (NEW.responsibility_lifecycle->'next_action') IS DISTINCT FROM selected->'value'->'decision'->'plan'->'next_action'
    OR (NEW.responsibility_lifecycle->'dependencies') IS DISTINCT FROM selected->'value'->'decision'->'plan'->'dependencies'
    OR (NEW.responsibility_lifecycle->'wait') IS DISTINCT FROM selected->'value'->'decision'->'plan'->'wait'
    OR (NEW.responsibility_lifecycle->'next_check_in_at') IS DISTINCT FROM selected->'value'->'decision'->'plan'->'next_check_in_at'
    OR NEW.responsibility_lifecycle->>'outcome_status' IS DISTINCT FROM 'unverified'
    OR NEW.responsibility_lifecycle->>'execution_status' IS DISTINCT FROM 'not_admitted'
 THEN RAISE EXCEPTION 'exact selected unverified plan required'; END IF;
 FOR dep IN SELECT jsonb_array_elements(NEW.responsibility_lifecycle->'dependencies') LOOP
   IF dep->>'kind'='source_version' THEN
     IF NOT EXISTS (SELECT 1 FROM conversation_sources cs JOIN sources s ON s.workspace_id=cs.workspace_id AND s.id=cs.source_id
       WHERE cs.workspace_id=r.workspace_id AND cs.conversation_id=cv.id AND s.id=dep->>'object_id'
       AND s.data->>'external_version'=dep->>'expected_version') THEN RAISE EXCEPTION 'exact scoped source required'; END IF;
   ELSIF dep->>'kind'='artifact_revision' THEN
     IF NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.workspace_id=r.workspace_id AND a.conversation_id=cv.id
       AND a.id=dep->>'object_id' AND a.current_revision_id=dep->>'expected_version') THEN RAISE EXCEPTION 'exact scoped artifact required'; END IF;
   ELSE RAISE EXCEPTION 'local dependency kind required'; END IF;
 END LOOP;
 result=jsonb_build_object('kind','record_responsibility','version','1','assignment_id',NEW.id,
   'conversation_id',cv.id,'owner_id',r.data->>'principal_id','work_version',2,
   'state',NEW.responsibility_lifecycle->>'state','outcome_status','unverified','execution_status','not_admitted');
 IF effect->'result' IS DISTINCT FROM result THEN RAISE EXCEPTION 'exact typed mutation result required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER responsibility_recording_guard BEFORE INSERT OR UPDATE ON assignments
 FOR EACH ROW EXECUTE FUNCTION guard_responsibility_recording();

CREATE FUNCTION require_responsibility_recording_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.responsibility_recording IS NOT NULL AND NOT EXISTS (
   -- Read the current canonical row, not only two historical JSON envelopes.
   SELECT 1 FROM assignments a JOIN responses_events e
     ON e.attempt_id=a.responsibility_recording->>'attempt_id'
     AND e.phase=a.responsibility_recording->>'phase' AND e.kind='tool_result'
   WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.id
   AND a.responsibility_recording=NEW.responsibility_recording
   AND a.id=e.data->'mutation_result'->>'assignment_id'
   AND a.conversation_id=e.data->'mutation_result'->>'conversation_id'
   AND a.data->>'owner_id'=e.data->'mutation_result'->>'owner_id'
   AND a.responsibility_lifecycle IS NOT NULL
   AND e.data->'binding'=a.responsibility_recording->'binding'
   AND e.data->'mutation_result'=a.responsibility_recording->'result')
 THEN RAISE EXCEPTION 'atomic responsibility effect receipt required'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER responsibility_recording_receipt AFTER INSERT OR UPDATE ON assignments
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_responsibility_recording_receipt();

-- Separate typed mutation semantics. SQL017's read-only capability_result guard
-- remains intact and is never used for mutations.
CREATE FUNCTION guard_alpha_responsibility_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE effect jsonb; cfg jsonb; selected jsonb; r runs; a assignments;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT run.* INTO r FROM runs run JOIN provider_attempts pa ON pa.workspace_id=run.workspace_id AND pa.run_id=run.id WHERE pa.id=NEW.attempt_id;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT * INTO a FROM assignments WHERE workspace_id=r.workspace_id AND responsibility_recording->>'run_id'=r.id;
 effect=a.responsibility_recording;
 SELECT data INTO selected FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF selected->'value'->'decision'->>'kind'='record_responsibility' OR NEW.data ? 'mutation_result'
    OR effect IS NOT NULL OR NEW.data ? 'responsibility_recording' THEN
   IF current_setting('transaction_isolation')<>'read committed'
   THEN RAISE EXCEPTION 'responsibility receipt requires read committed isolation'; END IF;
 END IF;
 IF selected->'value'->'decision'->>'kind'='record_responsibility' OR NEW.data ? 'mutation_result' THEN
   IF cfg->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1' OR effect IS NULL
      OR effect->>'attempt_id' IS DISTINCT FROM NEW.attempt_id
      OR selected->'value'->'decision'->>'kind' IS DISTINCT FROM 'record_responsibility'
      OR effect->>'decision_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected->'value'->'decision'),'UTF8')),'hex')
      OR NEW.data->'mutation_result' IS DISTINCT FROM effect->'result'
      OR NEW.data->>'status' IS DISTINCT FROM 'reply'
      OR coalesce(NEW.data->>'terminal_outcome','') NOT IN ('continue','needs_validation')
      OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
      OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'needs_validation'
      OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb OR NEW.data->'file' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb OR NEW.data ? 'capability_result'
      OR a.data->'work_version' IS DISTINCT FROM effect->'result'->'work_version'
      OR a.responsibility_lifecycle->'state' IS DISTINCT FROM effect->'result'->'state'
      OR NEW.data->'binding'->>'attempt_id' IS DISTINCT FROM NEW.attempt_id
      OR NEW.data->'binding'->>'selection_request_sha256' IS DISTINCT FROM selected->>'request_sha256'
      OR NEW.data->'binding'->>'selection_response_id' IS DISTINCT FROM selected->>'response_id'
      OR NEW.data->'binding'->>'decision_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected->'value'),'UTF8')),'hex')
      OR NEW.data->'binding'->>'operation_hash' IS DISTINCT FROM effect->>'decision_sha256'
   THEN RAISE EXCEPTION 'exact receipt-bound local mutation required'; END IF;
 END IF;
 IF effect IS NOT NULL OR NEW.data ? 'responsibility_recording' THEN
   IF effect IS NULL OR NEW.data->'responsibility_recording' IS DISTINCT FROM effect->'result'
      OR coalesce(NEW.data->>'terminal_outcome','') NOT IN ('continue','completed','needs_validation','blocked','waiting_for_user','step_limit','budget_limit')
      -- completed describes independently verified local work only. SQL020 still
      -- enforces the full bounded evidence; ownership remains exactly unverified.
      OR (NEW.data->>'terminal_outcome'='completed' AND (
          NEW.data->>'status' IS DISTINCT FROM 'observed'
          OR NEW.data->'verification'->'satisfied' IS DISTINCT FROM 'true'::jsonb
          OR NEW.data->'verification'->'automatic'->'passed' IS DISTINCT FROM 'true'::jsonb))
      OR coalesce(NEW.data->>'reason','') NOT LIKE 'Local responsibility recorded; the outcome still needs validation.%'
   THEN RAISE EXCEPTION 'retained local ownership is not verified goal completion'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER alpha_responsibility_stage_guard BEFORE INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION guard_alpha_responsibility_stage();
