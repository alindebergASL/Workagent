-- Additive draft publication. Historical migrations/receipts stay untouched.
-- Same authority and byte-binding gates; only exact shape-only drafts gain
-- needs_validation publication without claiming passing execution/goal tests.
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

CREATE FUNCTION guard_flexible_stage() RETURNS trigger LANGUAGE plpgsql AS $$
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
          OR NEW.data->>'terminal_outcome' IS DISTINCT FROM 'needs_validation'))
   THEN RAISE EXCEPTION 'draft is exact unverified data, never executed evidence'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER flexible_stage_guard BEFORE INSERT ON responses_events
FOR EACH ROW EXECUTE FUNCTION guard_flexible_stage();

-- Scope/binding checks also run under the restricted SQL writer. Source remains
-- inert text; this is NOT a sanitizer or a claim about browser containment.
CREATE FUNCTION guard_flexible_material() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb; ref jsonb; action jsonb; owner_id text; generation integer; bytes integer := 2;
BEGIN
 body=NEW.data->'body';
 IF body->>'kind' IS DISTINCT FROM 'custom_view' THEN RETURN NEW; END IF;
 SELECT access_generation INTO generation FROM workspaces WHERE id=NEW.workspace_id FOR SHARE;
 SELECT conversation_id INTO owner_id FROM artifacts WHERE workspace_id=NEW.workspace_id AND id=NEW.artifact_id;
 IF owner_id IS NULL OR body->>'version' IS DISTINCT FROM 'custom-view/v1'
    OR body->>'access_generation' IS DISTINCT FROM generation::text
    OR nullif(btrim(body->>'fallback'),'') IS NULL
    OR octet_length(convert_to(coalesce(body->'source'->>'html',''),'UTF8'))=0
    OR octet_length(convert_to(coalesce(body->'source'->>'html','')||coalesce(body->'source'->>'css','')||coalesce(body->'source'->>'js',''),'UTF8'))>48000
    OR octet_length(convert_to(acceptance_canonical_json(body),'UTF8'))>96000
    OR jsonb_typeof(body->'bindings') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'bindings')>4
    OR jsonb_typeof(body->'actions') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'actions')>8
 THEN RAISE EXCEPTION 'bounded scoped custom view required'; END IF;
 FOR ref IN SELECT jsonb_array_elements(body->'bindings') LOOP
   IF NOT EXISTS (SELECT 1 FROM artifacts art JOIN revisions rev ON rev.workspace_id=art.workspace_id
      AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
      WHERE art.workspace_id=NEW.workspace_id AND art.conversation_id=owner_id
      AND art.id=ref->>'artifact_id' AND rev.id=ref->>'revision_id' AND rev.data->>'body_hash'=ref->>'body_hash'
      AND (rev.data->'body'->>'kind'='structured_table' OR rev.data->'body' ? 'blocks'))
   THEN RAISE EXCEPTION 'exact current same-conversation data binding required'; END IF;
 END LOOP;
 FOR action IN SELECT jsonb_array_elements(body->'actions') LOOP
   IF action->>'kind' IS DISTINCT FROM 'read_binding'
      OR coalesce(action->>'name','') !~ '^[a-z][a-z0-9_.-]{0,63}$'
      OR action->'payload_schema' IS DISTINCT FROM '{"type":"object","properties":{},"additionalProperties":false}'::jsonb
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(body->'bindings') AS declared(value) WHERE declared.value->>'name'=action->>'binding')
   THEN RAISE EXCEPTION 'closed read binding action required'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER flexible_revision_guard BEFORE INSERT ON revisions FOR EACH ROW EXECUTE FUNCTION guard_flexible_material();
CREATE TRIGGER flexible_proposal_guard BEFORE INSERT ON proposals FOR EACH ROW EXECUTE FUNCTION guard_flexible_material();

-- Nonadaptive draft explanation uses the same retained reason on reconciliation.
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
          AND m.data->>'text'=CASE WHEN (t.data->'output'->>'kind'='artifact_draft') OR
            (rc.data->'responses'->>'policy_version'='adaptive-local-v1'
            AND (t.data->>'terminal_outcome' IN ('needs_validation','blocked','waiting_for_user','step_limit')
              OR (t.data->>'terminal_outcome'='completed' AND t.data->'verification'->'automatic'->>'passed'='true')))
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

-- Keep all prior message authority/receipt gates. For the new draft only,
-- publish its retained trusted limitation instead of provider success prose.
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
           WHEN (stage.data->'output'->>'kind'='artifact_draft') OR
             (rc.data->'responses'->>'policy_version'='adaptive-local-v1'
             AND (stage.data->>'terminal_outcome' IN ('needs_validation','blocked','waiting_for_user','step_limit')
               OR (stage.data->>'terminal_outcome'='completed' AND stage.data->'verification'->'automatic'->>'passed'='true')))
           THEN stage.data->>'reason' ELSE e.data->'value'->>'text' END)
   THEN RAISE EXCEPTION 'exact retained model explanation required'; END IF;
 END IF;
 RETURN NEW;
END; $$;
