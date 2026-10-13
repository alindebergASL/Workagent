-- Canonical continuation: immutable run configuration + existing fenced lifecycle.
-- Human/assistant historical messages remain unchanged; no second work ledger.
ALTER TABLE assignments DROP CONSTRAINT responsibility_lifecycle_shape;
ALTER TABLE assignments ADD CONSTRAINT responsibility_lifecycle_shape CHECK (
 responsibility_lifecycle IS NULL OR coalesce((conversation_id IS NOT NULL
 AND jsonb_typeof(responsibility_lifecycle)='object'
 AND responsibility_lifecycle->>'schema_version'='responsibility/v1'
 AND responsibility_lifecycle->>'state' IN ('active','waiting_person','waiting_event','blocked','paused','cancelled','taken_over')
 AND responsibility_lifecycle->>'execution_status' IN ('not_admitted','queued','running','settled','blocked')),false));
ALTER TABLE conversation_messages DROP CONSTRAINT conversation_messages_author_kind_check;
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_author_kind_check
 CHECK (author_kind IN ('human','assistant','system'));
ALTER TABLE conversation_messages DROP CONSTRAINT message_origin;
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_message_evidence CHECK (coalesce(
 (author_kind='human' AND data->>'evidence_origin'='human' AND data->'result'='null'::jsonb AND data->>'responsibility_origin' IS NULL)
 OR (author_kind='system' AND data->>'evidence_origin'='runtime' AND data->'result'='null'::jsonb AND jsonb_typeof(data->'responsibility_origin')='object')
 OR (author_kind='assistant' AND data->>'evidence_origin' IN ('controlled_transport','synthetic_provider_receipt','live_provider_receipt')
 AND data->'result'<>'null'::jsonb AND data->>'responsibility_origin' IS NULL),false));
CREATE UNIQUE INDEX responsibility_one_run_per_wake ON run_configurations
 (workspace_id,(data->'responsibility'->>'wake_id')) WHERE data ? 'responsibility';
CREATE UNIQUE INDEX conversation_one_request_per_run ON conversation_messages(workspace_id,run_id)
 WHERE author_kind IN ('human','system');

CREATE FUNCTION require_responsibility_binding(r runs,b jsonb,admitting boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a assignments; cv conversations; dep jsonb; life jsonb;
BEGIN
 PERFORM id FROM workspaces WHERE id=r.workspace_id FOR UPDATE;
 SELECT * INTO a FROM assignments WHERE workspace_id=r.workspace_id AND id=b->>'assignment_id';
 SELECT * INTO cv FROM conversations WHERE workspace_id=r.workspace_id AND id=r.conversation_id;
 life=a.responsibility_lifecycle;
 IF b IS NULL OR jsonb_typeof(b) IS DISTINCT FROM 'object'
    OR b - ARRAY['schema_version','review_fence','workspace_id','assignment_id','conversation_id','owner_id',
                  'wake_id','work_version','conversation_work_version','observations','goal','completion_criteria',
                  'current_outcome','next_action'] <> '{}'::jsonb
    OR NOT EXISTS (SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
        WHERE m.workspace_id=r.workspace_id AND m.principal_id=r.data->>'principal_id'
        AND m.active AND m.role<>'viewer' AND w.access_generation=(r.data->>'access_generation')::bigint)
    OR b->>'schema_version' IS DISTINCT FROM 'responsibility-run/v1'
    OR b->>'workspace_id' IS DISTINCT FROM r.workspace_id
    OR b->>'conversation_id' IS DISTINCT FROM r.conversation_id
    OR b->>'owner_id' IS DISTINCT FROM r.data->>'principal_id'
    OR a.id IS NULL OR cv.id IS NULL OR life IS NULL
    OR a.conversation_id IS DISTINCT FROM r.conversation_id
    OR a.data->>'owner_id' IS DISTINCT FROM b->>'owner_id'
    OR a.data->'work_version' IS DISTINCT FROM b->'work_version'
    OR to_jsonb(a.responsibility_fence) IS DISTINCT FROM b->'review_fence'
    OR cv.data->'work_version' IS DISTINCT FROM b->'conversation_work_version'
    OR cv.data->>'state' IS DISTINCT FROM 'open'
    OR life->>'state' IN ('paused','cancelled','taken_over')
    OR life->>'wake_id' IS DISTINCT FROM b->>'wake_id'
    OR (NOT admitting AND life->>'run_id' IS DISTINCT FROM r.id)
    OR jsonb_typeof(b->'observations') IS DISTINCT FROM 'array'
    OR NOT EXISTS (SELECT 1 FROM outbox o WHERE o.workspace_id=r.workspace_id AND o.id=b->>'wake_id'
                   AND o.object_id=a.id AND o.operation='responsibility_wake')
 THEN RAISE EXCEPTION 'current exact responsibility binding required'; END IF;
 IF admitting AND (life->>'state' IS DISTINCT FROM 'active' OR life->>'blocker' IS NOT NULL
    OR life->>'wake_status' NOT IN ('queued','reviewed')
    OR life->'observations' IS DISTINCT FROM b->'observations'
    OR life->'next_action' IS DISTINCT FROM b->'next_action'
    OR life->'current_outcome' IS DISTINCT FROM b->'current_outcome'
    OR a.data->'goal' IS DISTINCT FROM b->'goal'
    OR a.data->'completion_criteria' IS DISTINCT FROM b->'completion_criteria'
    OR (a.responsibility_lease->>'expires_at')::timestamptz <= now()
    OR a.responsibility_lease IS NULL
    OR a.responsibility_lease->>'wake_id' IS DISTINCT FROM b->>'wake_id'
    OR a.responsibility_lease->'work_version' IS DISTINCT FROM b->'work_version'
    OR b->'next_action'->>'kind' NOT IN ('continue_work','review_dependency'))
 THEN RAISE EXCEPTION 'current reviewed responsibility plan required'; END IF;
 FOR dep IN SELECT jsonb_array_elements(b->'observations') LOOP
   IF dep->>'kind'='artifact_revision' THEN
     IF NOT EXISTS (SELECT 1 FROM artifacts ar JOIN revisions rev ON rev.workspace_id=ar.workspace_id
         AND rev.artifact_id=ar.id AND rev.id=ar.current_revision_id
         WHERE ar.workspace_id=r.workspace_id AND ar.id=dep->>'object_id'
         AND (ar.conversation_id=r.conversation_id OR ar.assignment_id=a.id)
         AND ar.current_revision_id=dep->>'observed_version' AND rev.data->>'body_hash'=dep->>'content_hash')
     THEN RAISE EXCEPTION 'current exact responsibility artifact required'; END IF;
   ELSIF dep->>'kind'='source_version' THEN
     IF NOT EXISTS (SELECT 1 FROM sources s JOIN source_access sa ON sa.workspace_id=s.workspace_id AND sa.source_id=s.id
         JOIN assignment_sources src ON src.workspace_id=s.workspace_id AND src.source_id=s.id
         WHERE s.workspace_id=r.workspace_id AND s.id=dep->>'object_id' AND src.assignment_id=a.id
         AND sa.principal_id=b->>'owner_id' AND sa.active AND s.data->>'available'='true'
         AND s.data->>'external_version'=dep->>'observed_version'
         AND encode(sha256(convert_to(acceptance_canonical_json(s.content),'UTF8')),'hex')=dep->>'content_hash')
     THEN RAISE EXCEPTION 'current exact responsibility source required'; END IF;
   ELSE RAISE EXCEPTION 'known responsibility dependency required'; END IF;
 END LOOP;
END; $$;

CREATE FUNCTION guard_responsibility_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; g provider_grants; counts bigint; sends bigint; input_used bigint; output_used bigint; cost numeric;
BEGIN
 IF NOT (NEW.data ? 'responsibility') THEN RETURN NEW; END IF;
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.data->>'grant_id';
 IF r.data->>'profile' IS DISTINCT FROM 'general-responses-v1' OR g.id IS NULL OR NOT g.active
    OR g.workspace_id IS DISTINCT FROM r.workspace_id OR g.principal_id IS DISTINCT FROM r.data->>'principal_id'
    OR NEW.data->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
    OR NEW.data->'responses' IS DISTINCT FROM g.data->'responses'
    OR NOT (g.data->'responses'->'conversation_ids' ? r.conversation_id)
 THEN RAISE EXCEPTION 'active exact alpha grant required'; END IF;
 PERFORM require_responsibility_binding(r,NEW.data->'responsibility',true);
 PERFORM pg_advisory_xact_lock(721004120);
 SELECT count(*) FILTER (WHERE e.kind='count_send'), count(*) FILTER (WHERE e.kind='dispatch'),
   coalesce(sum((e.data->>'reserved_input_tokens')::bigint) FILTER (WHERE e.kind='dispatch'),0),
   coalesce(sum((e.data->>'reserved_output_tokens')::bigint) FILTER (WHERE e.kind='dispatch'),0),
   coalesce(sum((e.data->>'reserved_cost_usd')::numeric) FILTER (WHERE e.kind='dispatch'),0)
 INTO counts,sends,input_used,output_used,cost FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
 WHERE s.grant_id IN (SELECT responses_budget_grants(g.id));
 IF counts >= (g.data->'responses'->>'count_limit')::bigint
    OR sends >= (g.data->'responses'->>'generation_limit')::bigint
    OR input_used+20000 > (g.data->'responses'->>'input_limit')::bigint
    OR output_used+8192 > (g.data->'responses'->>'output_limit')::bigint
    OR cost+responses_carried_cost(g.id)+0.131920 > (g.data->'responses'->>'cost_limit_usd')::numeric
 THEN RAISE EXCEPTION 'responsibility admission budget exhausted'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_responsibility_admissions BEFORE INSERT ON run_configurations
 FOR EACH ROW EXECUTE FUNCTION guard_responsibility_admission();

-- SQL callers cannot commit a binding without its truthful request and lifecycle.
CREATE FUNCTION guard_responsibility_request_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs;
BEGIN
 IF NOT (NEW.data ? 'responsibility') THEN RETURN NEW; END IF;
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 PERFORM require_responsibility_binding(r,NEW.data->'responsibility',false);
 IF NOT EXISTS (SELECT 1 FROM conversation_messages m WHERE m.workspace_id=NEW.workspace_id AND m.run_id=NEW.run_id
                AND m.author_kind='system')
 THEN RAISE EXCEPTION 'truthful runtime request required'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER responsibility_request_commit AFTER INSERT ON run_configurations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_responsibility_request_commit();

CREATE OR REPLACE FUNCTION require_general_publication_authority(r runs) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t jsonb; b jsonb;
BEGIN
 PERFORM id FROM workspaces WHERE id=r.workspace_id FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM workspaces w JOIN memberships m ON m.workspace_id=w.id
     JOIN conversations cv ON cv.workspace_id=w.id AND cv.id=r.conversation_id
     JOIN run_configurations rc ON rc.workspace_id=w.id AND rc.run_id=r.id
     JOIN provider_grants g ON g.id=rc.data->>'grant_id'
     WHERE w.id=r.workspace_id AND m.principal_id=r.data->>'principal_id' AND m.active
     AND r.data->>'access_generation'=w.access_generation::text AND r.data->>'state'='running'
     AND (r.data->>'lease_expires_at')::timestamptz>now() AND cv.data->>'state'='open'
     AND g.active AND g.workspace_id=w.id AND g.principal_id=m.principal_id
     AND g.data->>'profile'='general-responses-v1' AND g.data->'responses'=rc.data->'responses'
     AND g.data->'responses'->'conversation_ids' ? cv.id)
 THEN RAISE EXCEPTION 'current general publication authority required'; END IF;
 SELECT data->'responsibility' INTO b FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 IF b IS NOT NULL THEN PERFORM require_responsibility_binding(r,b,false); END IF;
 SELECT data->'target' INTO t FROM conversation_messages
 WHERE workspace_id=r.workspace_id AND run_id=r.id AND author_kind IN ('human','system');
 IF NOT FOUND THEN RAISE EXCEPTION 'admitted general request required'; END IF;
 IF t<>'null'::jsonb AND NOT EXISTS (SELECT 1 FROM artifacts art JOIN revisions rev
     ON rev.workspace_id=art.workspace_id AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
     WHERE art.workspace_id=r.workspace_id AND art.conversation_id=r.conversation_id
     AND art.id=t->>'artifact_id' AND rev.id=t->>'revision_id' AND rev.data->>'body_hash'=t->>'body_hash')
 THEN RAISE EXCEPTION 'exact current scoped publication target required'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION guard_general_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; rc run_configurations; g provider_grants; a jsonb; t jsonb; n integer;
BEGIN
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 IF r.data->>'profile'<>'general-responses-v1' THEN
   IF NEW.author_kind='system' OR NEW.data->>'responsibility_origin' IS NOT NULL OR NEW.data->>'model_receipt' IS NOT NULL OR NEW.data->>'evidence_origin' IN ('synthetic_provider_receipt','live_provider_receipt')
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
 IF NEW.author_kind='system' THEN
   PERFORM require_responsibility_binding(r,rc.data->'responsibility',true);
   IF NEW.data->>'evidence_origin' IS DISTINCT FROM 'runtime'
      OR NEW.data->>'author_id' IS DISTINCT FROM 'responsibility-runtime'
      OR NEW.data->'result' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'operation' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'target' IS DISTINCT FROM 'null'::jsonb
      OR NEW.data->'attachments' IS DISTINCT FROM '[]'::jsonb
      OR NEW.data->>'model_receipt' IS NOT NULL OR NEW.data->>'acceptance_checks' IS NOT NULL
      OR NEW.data->'responsibility_origin' IS DISTINCT FROM jsonb_build_object(
          'kind','responsibility_wake','assignment_id',rc.data->'responsibility'->>'assignment_id',
          'wake_id',rc.data->'responsibility'->>'wake_id','work_version',rc.data->'responsibility'->'work_version')
   THEN RAISE EXCEPTION 'exact runtime request provenance required'; END IF;
 ELSIF NEW.author_kind='human' THEN
   IF rc.data ? 'responsibility' THEN RAISE EXCEPTION 'responsibility request is not human'; END IF;
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


CREATE OR REPLACE FUNCTION guard_automatic_verification() RETURNS trigger LANGUAGE plpgsql AS $$
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
   WHERE p.id=NEW.attempt_id AND m.author_kind IN ('human','system');
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


-- Receipt retention is deliberately allowed after revocation; new effects are not.
CREATE FUNCTION guard_responsibility_phase() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; aid text; b jsonb; ref jsonb;
BEGIN
 IF TG_TABLE_NAME='responses_events' THEN
   IF NEW.kind NOT IN ('count_send','dispatch','read','tool_result') THEN RETURN NEW; END IF;
 END IF;
 aid=NEW.attempt_id;
 SELECT run.* INTO r FROM runs run JOIN provider_attempts pa ON pa.workspace_id=run.workspace_id AND pa.run_id=run.id WHERE pa.id=aid;
 SELECT data->'responsibility' INTO b FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 IF b IS NOT NULL THEN
   PERFORM require_general_publication_authority(r);
   IF TG_TABLE_NAME='responses_events' THEN
     IF NEW.kind='tool_result' THEN
       FOR ref IN SELECT jsonb_array_elements(coalesce(NEW.data->'body'->'bindings','[]'::jsonb)) LOOP
         IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(b->'observations') dep
            WHERE dep->>'kind'='artifact_revision' AND dep->>'object_id'=ref->>'artifact_id'
            AND dep->>'observed_version'=ref->>'revision_id' AND dep->>'content_hash'=ref->>'body_hash')
         THEN RAISE EXCEPTION 'artifact reference outside responsibility binding'; END IF;
       END LOOP;
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER responsibility_steps BEFORE INSERT ON responses_steps
 FOR EACH ROW EXECUTE FUNCTION guard_responsibility_phase();
CREATE TRIGGER responsibility_effects BEFORE INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION guard_responsibility_phase();
