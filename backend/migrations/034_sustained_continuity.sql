-- Opt-in sustained preparation. Historical bundles and observations stay unchanged.
-- A retained observed result is publishable preparation, not proof of completion.
ALTER FUNCTION require_alpha_budget_binding(jsonb) RENAME TO require_alpha_budget_binding_pre_continuity;
CREATE FUNCTION require_alpha_budget_binding(b jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF b ? 'continuity_version' AND b->'continuity_version' IS DISTINCT FROM '"sustained-v1"'::jsonb
 THEN RAISE EXCEPTION 'known explicit continuity version required'; END IF;
 PERFORM require_alpha_budget_binding_pre_continuity(b-'continuity_version');
END; $$;

CREATE OR REPLACE FUNCTION guard_general_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; t jsonb; b jsonb; result_body jsonb;
BEGIN
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 IF r.data->>'profile'<>'general-responses-v1' THEN
   IF NEW.data->>'evidence_origin'<>'controlled_transport' OR NEW.data->>'model_selection' IS NOT NULL
   THEN RAISE EXCEPTION 'controlled observation cannot claim model selection'; END IF;
   RETURN NEW;
 END IF;
 b=NEW.data->'model_selection';
 PERFORM require_general_publication_authority(r);
 SELECT e.data INTO t FROM responses_events e JOIN provider_attempts pa ON pa.id=e.attempt_id
   WHERE pa.run_id=NEW.run_id AND pa.workspace_id=NEW.workspace_id AND pa.id=b->>'attempt_id'
   AND e.kind='tool_result' AND e.data->'binding'=b;
 IF EXISTS (SELECT 1 FROM run_configurations rc WHERE rc.workspace_id=r.workspace_id AND rc.run_id=r.id
     AND rc.data->'responses'->>'policy_version'='adaptive-local-v1'
     AND rc.data->'responses'->>'continuity_version' IS DISTINCT FROM 'sustained-v1') AND
     NOT (coalesce(t->>'terminal_outcome'='completed' AND t->'verification'->>'satisfied'='true',false)
       OR coalesce(t->>'terminal_outcome'='needs_validation'
          AND t->'verification'->>'satisfied'='false'
          AND (t->'verification'->'acceptance'->>'passed'='true'
            OR (nullif(t->'verification'->'acceptance','null'::jsonb) IS NULL AND (t->'verification'->>'model_tests_passed'='true'
              OR (t->'decision'->>'kind'='publish_artifact'
                  AND t->'output'='{"kind":"artifact_draft","validation":"shape_only","goal_status":"needs_validation","generated_code_executed":false}'::jsonb)
              OR (t->'verification'->'automatic'->>'checker_version'='csv-reconciliation-v1'
                  AND t->'verification'->'automatic'->>'recognized'='false'
                  AND t->'decision'->>'kind' IN ('reconcile_csv','run_wasm')))))
          AND t->'verification'->>'requested_goal_status'='needs_validation',false))
 THEN RAISE EXCEPTION 'passing local tests or independent verification required'; END IF;
 IF t IS NULL OR t->>'status'<>'observed' OR NEW.data->>'evidence_origin'<>'local_tool'
    OR t->'binding' IS DISTINCT FROM b OR t->'output' IS DISTINCT FROM NEW.data->'output'
    OR NEW.data->>'operation_hash' IS DISTINCT FROM b->>'operation_hash'
 THEN RAISE EXCEPTION 'retained local observation and model receipt binding required'; END IF;
 IF NEW.data->>'proposal_id' IS NOT NULL THEN
   SELECT data->'body' INTO result_body FROM proposals WHERE workspace_id=NEW.workspace_id AND id=NEW.data->>'proposal_id';
 ELSE
   SELECT data->'body' INTO result_body FROM revisions WHERE workspace_id=NEW.workspace_id AND id=NEW.data->>'revision_id';
 END IF;
 IF result_body IS DISTINCT FROM t->'body' AND result_body IS DISTINCT FROM t->'file'
 THEN RAISE EXCEPTION 'publication must use retained local body'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION guard_flexible_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selection jsonb;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data->'value'->'decision' INTO selection FROM responses_events
 WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF selection->>'kind' IS DISTINCT FROM 'publish_artifact' THEN
   IF NEW.data->'output'->>'kind'='artifact_draft' THEN RAISE EXCEPTION 'draft selection required'; END IF;
   RETURN NEW;
 END IF;
 IF NEW.data->>'status'='observed' THEN
   IF NEW.data->'body' IS DISTINCT FROM selection->'body'
      OR NEW.data->'file' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'output' IS DISTINCT FROM '{"kind":"artifact_draft","validation":"shape_only","goal_status":"needs_validation","generated_code_executed":false}'::jsonb
      OR (NOT NEW.data ? 'verification' AND NEW.data->>'reason' IS DISTINCT FROM 'Draft retained; data shape only was checked. The requested goal needs validation.')
      OR (NEW.data ? 'verification' AND (
          NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
          OR NEW.data->'verification'->>'model_tests_passed' IS DISTINCT FROM 'false'
          OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'needs_validation'
          OR (NEW.data->>'terminal_outcome' IS DISTINCT FROM 'needs_validation' AND NOT (
              NEW.data->>'terminal_outcome' IN ('continue','step_limit') AND EXISTS (
                SELECT 1 FROM provider_attempts a JOIN run_configurations rc
                  ON rc.workspace_id=a.workspace_id AND rc.run_id=a.run_id
                WHERE a.id=NEW.attempt_id AND rc.data->'responses'->>'continuity_version'='sustained-v1')))))
   THEN RAISE EXCEPTION 'draft is exact unverified data, never executed evidence'; END IF;
 END IF;
 RETURN NEW;
END; $$;

-- Each immutable selection can propose a different revision to the same target.
ALTER TABLE product_observations DROP CONSTRAINT product_observations_workspace_id_run_id_artifact_id_key;
CREATE UNIQUE INDEX product_observation_selection_once ON product_observations
 (workspace_id,run_id,artifact_id,(coalesce(data->'model_selection'->>'selection_request_sha256','controlled')));

CREATE FUNCTION guard_followthrough_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg jsonb; selected jsonb; ref jsonb; observed jsonb; evidence jsonb := '[]'::jsonb; r runs;
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
   IF observed IS NULL OR observed->>'status' IS DISTINCT FROM 'observed'
      OR nullif(observed->'body','null'::jsonb) IS NULL
      OR observed->'binding'->'operation_hash' IS DISTINCT FROM ref->'operation_hash'
   THEN RAISE EXCEPTION 'earlier observed preparation required'; END IF;
   evidence=evidence || jsonb_build_array(jsonb_build_object('phase',ref->>'phase',
     'operation_hash',ref->>'operation_hash',
     'body_hash',encode(sha256(convert_to(acceptance_canonical_json(observed->'body'),'UTF8')),'hex'),
     'basis','observed_preparation_not_goal_verification'));
 END LOOP;
 IF NEW.data->'followthrough_result' IS DISTINCT FROM jsonb_build_object(
    'assignment_id',cfg->'responsibility'->>'assignment_id','work_version',cfg->'responsibility'->'work_version',
    'evidence',evidence,'status','staged_until_settlement')
 THEN RAISE EXCEPTION 'exact observed preparation evidence required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER followthrough_stage_guard BEFORE INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION guard_followthrough_stage();

CREATE FUNCTION guard_followthrough_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg jsonb; stage jsonb; plan jsonb; r runs; evidence jsonb;
BEGIN
 evidence=nullif(NEW.responsibility_lifecycle->'outcome_evidence','null'::jsonb);
 IF evidence IS NULL OR evidence IS NOT DISTINCT FROM OLD.responsibility_lifecycle->'outcome_evidence'
 THEN RETURN NEW; END IF;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=NEW.workspace_id AND run_id=evidence->>'run_id';
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=evidence->>'run_id';
 SELECT e.data INTO stage FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id
 WHERE a.id=evidence->>'attempt_id' AND a.workspace_id=NEW.workspace_id AND a.run_id=r.id
   AND a.data->>'state'='reconciled' AND e.kind='tool_result' AND e.data ? 'followthrough_result'
 ORDER BY e.phase DESC LIMIT 1;
 IF cfg->'responses'->>'continuity_version' IS DISTINCT FROM 'sustained-v1' OR stage IS NULL
    OR cfg->'responsibility'->>'assignment_id' IS DISTINCT FROM NEW.id
    OR r.data->>'state' IS DISTINCT FROM 'running'
    OR r.data->>'stop_reason' IN ('budget_limit','blocked','waiting_for_user','step_limit')
    OR NEW.responsibility_fence IS DISTINCT FROM OLD.responsibility_fence+1
    OR (NEW.data->>'work_version')::bigint IS DISTINCT FROM (OLD.data->>'work_version')::bigint+1
    OR NEW.data-ARRAY['work_version','unresolved','observed_at'] IS DISTINCT FROM OLD.data-ARRAY['work_version','unresolved','observed_at']
    OR NEW.responsibility_lifecycle->>'outcome_status' IS DISTINCT FROM 'evidenced_preparation'
    OR evidence->'evidence' IS DISTINCT FROM stage->'followthrough_result'->'evidence'
 THEN RAISE EXCEPTION 'settled exact followthrough receipt required'; END IF;
 -- BEFORE UPDATE sees the old assignment: rejects stale human plans and fences.
 PERFORM require_general_publication_authority(r);
 plan=stage->'decision'->'plan';
 IF NEW.responsibility_lifecycle->'current_outcome' IS DISTINCT FROM plan->'current_outcome'
    OR NEW.responsibility_lifecycle->'next_action' IS DISTINCT FROM plan->'next_action'
    OR NEW.responsibility_lifecycle->'dependencies' IS DISTINCT FROM plan->'dependencies'
    OR NEW.responsibility_lifecycle->'wait' IS DISTINCT FROM plan->'wait'
    OR NEW.responsibility_lifecycle->'next_check_in_at' IS DISTINCT FROM plan->'next_check_in_at'
    OR NEW.responsibility_lifecycle->>'execution_status' IS DISTINCT FROM 'not_admitted'
    OR NEW.responsibility_lifecycle->>'run_id' IS NOT NULL
 THEN RAISE EXCEPTION 'exact selected followthrough plan required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER followthrough_application_guard BEFORE UPDATE ON assignments
 FOR EACH ROW EXECUTE FUNCTION guard_followthrough_application();
