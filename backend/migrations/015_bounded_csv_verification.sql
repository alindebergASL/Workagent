-- Additive binding of trusted automatic evidence; no data rewrite or new authority.
-- Arithmetic remains in the consumer-pinned independent integer oracle. SQL
-- checks its immutable human/specification/result binding, never model examples.
CREATE FUNCTION bounded_goal_text(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN octet_length(convert_to(value,'UTF8'))=length(value)
 THEN lower(btrim(regexp_replace(value,E'[ \t\n\r\f\013]+',' ','g')) COLLATE "C") END;
$$;

CREATE FUNCTION bounded_csv_spec(human jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE parts text[];
BEGIN
 IF human->>'author_kind' IS DISTINCT FROM 'human'
    OR human->>'evidence_origin' IS DISTINCT FROM 'human'
    OR nullif(human->'acceptance_checks','null'::jsonb) IS NOT NULL
    OR nullif(human->'operation','null'::jsonb) IS NOT NULL THEN RETURN NULL; END IF;
 parts=regexp_match(bounded_goal_text(human->>'text'),
   '^(?:please )?(?:reconcile|recalculate) (?:every row|all rows) in (this|the attached|the saved) csv using quantity (?:times|\*) unit_price, rounded to (?:2|two) decimal places with (half-up|half-even) rounding[;.] (?:preserve|keep) (?:all )?original columns and notes[;.] (?:flag|list) discrepancies against reported_total[;.] (?:provide|create) a downloadable csv\.?$');
 IF parts IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('kind','all_rows_quantity_price',
   'source',CASE WHEN parts[1]='the saved' THEN 'saved_table' ELSE 'attachment' END,
   'rounding',CASE WHEN parts[2]='half-up' THEN 'ROUND_HALF_UP' ELSE 'ROUND_HALF_EVEN' END,
   'decimal_places',2,'preserve','original_columns_rows_source_and_notes','deliverable','table_discrepancies_csv');
END;
$$;

CREATE FUNCTION bounded_team_spec(human jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN human->>'author_kind'='human' AND human->>'evidence_origin'='human'
   AND nullif(human->'acceptance_checks','null'::jsonb) IS NULL
   AND nullif(human->'operation','null'::jsonb) IS NULL
   AND bounded_goal_text(human->>'text') ~
     '^(?:please )?(?:build|update|check) a reusable team-selection calculator for choosing k people from n candidates, for all integers 0 <= k <= n <= 60\. start with 60 candidates and 30 people\. keep my notes\.?$'
 THEN '{"kind":"team_selection","max_n":60,"default_arguments":[60,30],"preserve":"saved_title_and_notes"}'::jsonb END;
$$;

CREATE FUNCTION guard_automatic_verification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE human conversation_messages; evidence jsonb; spec jsonb; material jsonb; base jsonb; team boolean;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 evidence=nullif(NEW.data->'verification'->'automatic','null'::jsonb);
 IF evidence IS NULL THEN
   IF NEW.data->>'terminal_outcome'='completed' OR NEW.data->'verification'->>'satisfied'='true'
   THEN RAISE EXCEPTION 'new completion requires independent bounded evidence'; END IF;
   RETURN NEW; -- historical observations and legacy non-adaptive execution
 END IF;
 SELECT m.* INTO human FROM conversation_messages m JOIN provider_attempts p
   ON p.workspace_id=m.workspace_id AND p.run_id=m.run_id
   WHERE p.id=NEW.attempt_id AND m.author_kind='human';
 spec=coalesce(bounded_csv_spec(human.data),bounded_team_spec(human.data));
 team=coalesce(spec->>'kind'='team_selection',false);
 material=jsonb_build_object('status',NEW.data->'status','body',NEW.data->'body',
   'file',NEW.data->'file','output',NEW.data->'output','binding',NEW.data->'binding');
 IF evidence->>'checker_version' IS DISTINCT FROM (CASE WHEN team THEN 'team-selection-v1' ELSE 'csv-reconciliation-v1' END)
    OR evidence->>'scope' IS DISTINCT FROM (CASE WHEN team THEN 'bounded_team_goal_only' ELSE 'bounded_csv_goal_only' END)
    OR evidence->'request' IS DISTINCT FROM NEW.data->'verification'->'request'
    OR evidence->'request'->>'message_id' IS DISTINCT FROM human.id
    OR evidence->'request'->>'message_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(human.data),'UTF8')),'hex')
    OR evidence->>'staged_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(material),'UTF8')),'hex')
    OR evidence->'operation_hash' IS DISTINCT FROM NEW.data->'binding'->'operation_hash'
    OR evidence->'base_hash' IS DISTINCT FROM NEW.data->'binding'->'base_hash'
    OR nullif(evidence->'spec','null'::jsonb) IS DISTINCT FROM spec
    OR evidence->'recognized' IS DISTINCT FROM to_jsonb(spec IS NOT NULL)
    OR jsonb_typeof(evidence->'failures') IS DISTINCT FROM 'array'
    OR jsonb_typeof(evidence->'limitations') IS DISTINCT FROM 'array'
    OR jsonb_typeof(evidence->'passed') IS DISTINCT FROM 'boolean'
    OR evidence->'passed' IS DISTINCT FROM NEW.data->'verification'->'satisfied'
 THEN RAISE EXCEPTION 'automatic evidence must bind exact human specification and staged result'; END IF;
 IF evidence->>'passed'='true' THEN
   IF spec IS NULL OR evidence->'failures'<>'[]'::jsonb
      OR NEW.data->>'status' IS DISTINCT FROM 'observed'
      OR NEW.data->'verification'->>'basis' IS DISTINCT FROM 'independent_bounded'
      OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'satisfied'
      OR NEW.data->>'terminal_outcome' IS DISTINCT FROM 'completed'
      OR nullif(NEW.data->>'reason','') IS NULL
   THEN RAISE EXCEPTION 'automatic completion requires passing bounded evidence'; END IF;
   IF team THEN
     IF NEW.data->'decision'->>'kind' IS DISTINCT FROM 'run_wasm'
        OR evidence->'case_count' IS DISTINCT FROM '1891'::jsonb
        OR NEW.data->'body'->>'kind' IS DISTINCT FROM 'tool'
        OR NEW.data->'body'->'arguments' IS DISTINCT FROM '[60,30]'::jsonb
        OR NEW.data->'body'->'input_form'->0->>'name' IS DISTINCT FROM 'n'
        OR NEW.data->'body'->'input_form'->1->>'name' IS DISTINCT FROM 'k'
        OR jsonb_array_length(human.data->'attachments')<>0
        OR NEW.data->'output'->>'code_sha256' IS DISTINCT FROM encode(sha256(convert_to(NEW.data->'body'->>'code','UTF8')),'hex')
        OR NEW.data->'output'->'arguments' IS DISTINCT FROM NEW.data->'body'->'arguments'
        OR NEW.data->'output'->'entrypoint' IS DISTINCT FROM NEW.data->'body'->'entrypoint'
        OR NEW.data->'file'->'content' IS DISTINCT FROM NEW.data->'body'->'code'
     THEN RAISE EXCEPTION 'automatic evidence requires exact team coverage and code'; END IF;
   ELSIF NEW.data->'decision'->>'kind' IS DISTINCT FROM 'reconcile_csv'
      OR NEW.data->'decision'->'rounding' IS DISTINCT FROM spec->'rounding'
      OR NEW.data->'body'->'rounding' IS DISTINCT FROM spec->'rounding'
      OR NEW.data->'output'->'rounding' IS DISTINCT FROM spec->'rounding'
      OR evidence->'row_count' IS DISTINCT FROM to_jsonb(jsonb_array_length(NEW.data->'body'->'rows'))
      OR (evidence->>'row_count')::integer NOT BETWEEN 1 AND 500
      OR evidence->>'source_sha256' IS DISTINCT FROM NEW.data->'output'->>'input_sha256'
   THEN RAISE EXCEPTION 'automatic evidence requires exact CSV coverage'; END IF;
   IF team AND nullif(human.data->'target','null'::jsonb) IS NULL THEN
     IF evidence->>'base_hash' IS NOT NULL OR evidence->>'base_revision_id' IS NOT NULL
        OR NEW.data->'body'->'notes' IS DISTINCT FROM '[]'::jsonb
     THEN RAISE EXCEPTION 'automatic evidence requires unbound initial tool'; END IF;
   ELSIF spec->>'source'='attachment' THEN
     IF jsonb_array_length(human.data->'attachments')<>1 OR human.data->'target'<>'null'::jsonb
        OR evidence->>'base_hash' IS NOT NULL OR evidence->>'base_revision_id' IS NOT NULL
        OR evidence->>'source_sha256' IS DISTINCT FROM human.data->'attachments'->0->>'sha256'
        OR NEW.data->'body'->'source_csv' IS DISTINCT FROM human.data->'attachments'->0->'content'
     THEN RAISE EXCEPTION 'automatic completion requires every exact attachment'; END IF;
   ELSE
     SELECT rev.data INTO base FROM revisions rev JOIN artifacts art
       ON art.workspace_id=rev.workspace_id AND art.id=rev.artifact_id AND art.current_revision_id=rev.id
       WHERE rev.workspace_id=human.workspace_id AND art.conversation_id=human.conversation_id
       AND rev.id=human.data->'target'->>'revision_id' AND art.id=human.data->'target'->>'artifact_id';
     IF base IS NULL OR jsonb_array_length(human.data->'attachments')<>0
        OR evidence->'base_revision_id' IS DISTINCT FROM base->'id'
        OR evidence->'base_hash' IS DISTINCT FROM base->'body_hash'
        OR NEW.data->'body'->'notes' IS DISTINCT FROM base->'body'->'notes'
        OR (NOT team AND NEW.data->'body'->'source_csv' IS DISTINCT FROM base->'body'->'source_csv')
        OR (team AND (base->'body'->>'kind' IS DISTINCT FROM 'tool'
          OR NEW.data->'body'->'title' IS DISTINCT FROM base->'body'->'title'))
     THEN RAISE EXCEPTION 'automatic completion requires exact current saved base'; END IF;
   END IF;
 ELSIF NEW.data->>'terminal_outcome'='completed'
       OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'needs_validation' THEN
   RAISE EXCEPTION 'unsatisfied evidence cannot complete the human goal';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER automatic_verification_guard BEFORE INSERT ON responses_events
FOR EACH ROW EXECUTE FUNCTION guard_automatic_verification();

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
     AND rc.data->'responses'->>'policy_version'='adaptive-local-v1') AND
     NOT (coalesce(t->>'terminal_outcome'='completed' AND t->'verification'->>'satisfied'='true',false)
       OR coalesce(t->>'terminal_outcome'='needs_validation'
          AND t->'verification'->>'satisfied'='false'
          AND (t->'verification'->'acceptance'->>'passed'='true'
            OR (nullif(t->'verification'->'acceptance','null'::jsonb) IS NULL AND (t->'verification'->>'model_tests_passed'='true'
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

-- Preserve exact publication/receipt rules; verified completion uses retained trusted copy.
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
         AND e.data->>'state'='completed' AND NEW.data->>'text'=CASE
           WHEN rc.data->'responses'->>'policy_version'='adaptive-local-v1'
             AND (stage.data->>'terminal_outcome' IN ('needs_validation','blocked','waiting_for_user','step_limit')
               OR (stage.data->>'terminal_outcome'='completed' AND stage.data->'verification'->'automatic'->>'passed'='true'))
           THEN stage.data->>'reason' ELSE e.data->'value'->>'text' END)
   THEN RAISE EXCEPTION 'exact retained model explanation required'; END IF;
 END IF;
 RETURN NEW;
END; $$;

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
          AND m.data->>'text'=CASE WHEN rc.data->'responses'->>'policy_version'='adaptive-local-v1'
            AND (t.data->>'terminal_outcome' IN ('needs_validation','blocked','waiting_for_user','step_limit')
              OR (t.data->>'terminal_outcome'='completed' AND t.data->'verification'->'automatic'->>'passed'='true'))
            THEN t.data->>'reason' ELSE e.data->'value'->>'text' END)
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
