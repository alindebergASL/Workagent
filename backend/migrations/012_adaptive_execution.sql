-- Additive adaptive capability. Historical migrations/grants/request bytes stay immutable.
-- Code-only successor approvals retain every original prompt/schema/grant/counter.
CREATE OR REPLACE FUNCTION guard_consumer_successor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g provider_grants;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='provider_grants'::regclass))
 THEN RAISE EXCEPTION 'operator approval required'; END IF;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.grant_id;
 PERFORM id FROM workspaces WHERE id=g.workspace_id FOR UPDATE;
 IF NOT g.active OR g.data->>'profile' NOT IN ('openai-responses-v1','general-responses-v1')
 OR NEW.data->>'grant_id' IS DISTINCT FROM NEW.grant_id
 OR NEW.data->>'original_consumer_sha256' IS DISTINCT FROM g.data->>'consumer_sha256'
 OR coalesce(NEW.data->>'successor_consumer_sha256','') !~ '^[0-9a-f]{64}$'
 OR NEW.data->>'successor_consumer_sha256'=NEW.data->>'original_consumer_sha256'
 OR coalesce(NEW.data->>'original_grant_sha256','') !~ '^[0-9a-f]{64}$'
 OR NEW.data->>'expires_at' IS NULL
 OR (NEW.data->>'expires_at')::timestamptz<=now()
 OR (NEW.data->>'expires_at')::timestamptz>now()+interval '1 hour'
 THEN RAISE EXCEPTION 'invalid successor approval'; END IF;
 RETURN NEW;
END;
$$;

ALTER TABLE responses_steps DROP CONSTRAINT responses_steps_phase_check;
ALTER TABLE responses_steps ADD CONSTRAINT responses_steps_phase_check CHECK (phase IN ('selection','selection_2','selection_3','selection_4','final'));
-- Preserve the original authorization uniqueness for historical grants, allow bounded
-- opt-in successors only; cumulative reservations below include every predecessor.
DROP INDEX general_authorization_once;
CREATE UNIQUE INDEX general_authorization_once ON provider_grants((data->'responses'->>'authorization_sha256'))
 WHERE data->>'profile'='general-responses-v1' AND data->'responses'->>'transport_mode'='official_api'
 AND data->'responses'->>'policy_version'='general-responses-v1';

CREATE FUNCTION responses_budget_grants(gid text) RETURNS SETOF text LANGUAGE sql STABLE AS $$
 SELECT g.id FROM provider_grants g JOIN provider_grants original ON original.id=gid
 WHERE g.data->'responses'->>'transport_mode'=original.data->'responses'->>'transport_mode'
 AND (g.data->'responses'->>'project_id'=original.data->'responses'->>'project_id'
   OR (original.data->'responses'->>'authorization_sha256' IS NOT NULL
       AND g.data->'responses'->>'authorization_sha256'=original.data->'responses'->>'authorization_sha256'
       AND original.data->'responses'->>'transport_mode'='official_api'))
$$;
CREATE OR REPLACE FUNCTION guard_general_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b jsonb; cid text;
BEGIN
 IF NEW.data->>'profile'<>'general-responses-v1' THEN RETURN NEW; END IF;
 b=NEW.data->'responses';
 IF NEW.data->>'id' IS DISTINCT FROM NEW.id OR NEW.data->>'workspace_id' IS DISTINCT FROM NEW.workspace_id
 OR NEW.data->>'principal_id' IS DISTINCT FROM NEW.principal_id
 OR NEW.data->'expires_at' IS DISTINCT FROM 'null'::jsonb
 OR NEW.data->>'model' IS DISTINCT FROM 'gpt-6.1-sol'
 OR coalesce((NEW.data->>'max_runs')::integer,0) NOT BETWEEN 1 AND (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN 10 ELSE 4 END)
 OR NEW.data->>'max_received_output_tokens' IS DISTINCT FROM '16384'
 OR b->>'policy_version' NOT IN ('general-responses-v1','adaptive-local-v1')
 OR (b->>'policy_version'='adaptive-local-v1' AND coalesce((b->>'max_steps')::integer,0) NOT BETWEEN 1 AND 4)
 OR b->>'generation_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '50' ELSE '8' END) OR b->>'count_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '50' ELSE '8' END)
 OR b->>'read_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '500' ELSE '80' END) OR b->>'cancel_limit' IS DISTINCT FROM '0'
 OR b->>'input_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '1000000' ELSE '160000' END) OR b->>'output_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '409600' ELSE '65536' END)
 OR b->>'cost_limit_usd' IS DISTINCT FROM '20.00'
 OR b->>'synthetic_data_only' IS DISTINCT FROM 'true' OR b->>'store_acknowledged' IS DISTINCT FROM 'true'
 OR b->>'authorization_sha256' IS DISTINCT FROM 'd7f676d970ef2c6d56c39fe961114d00140279b99ba72649177c41de159093c9'
 OR jsonb_typeof(b->'conversation_ids') IS DISTINCT FROM 'array'
 OR jsonb_array_length(b->'conversation_ids') NOT BETWEEN 1 AND 2
 THEN RAISE EXCEPTION 'exact bounded general authorization required'; END IF;
 FOR cid IN SELECT jsonb_array_elements_text(b->'conversation_ids') LOOP
   IF NOT EXISTS (SELECT 1 FROM conversations cv WHERE cv.workspace_id=NEW.workspace_id AND cv.id=cid
      AND cv.data->>'owner_id'=NEW.principal_id AND cv.data->'selected_source_refs'='[]'::jsonb)
   THEN RAISE EXCEPTION 'explicit synthetic conversation scope required'; END IF;
   IF TG_OP='INSERT' AND EXISTS (SELECT 1 FROM provider_grants g WHERE g.workspace_id=NEW.workspace_id
      AND g.data->>'profile'='general-responses-v1' AND g.data->'responses'->'conversation_ids' ? cid)
   THEN RAISE EXCEPTION 'conversation authorization cannot reset'; END IF;
 END LOOP;
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
       AND data->>'terminal_outcome' IN ('completed','blocked','waiting_for_user','step_limit','budget_limit','needs_validation'))
   THEN RAISE EXCEPTION 'adaptive terminal observation required'; END IF;
 ELSIF NEW.phase NOT IN ('selection','final') THEN RAISE EXCEPTION 'adaptive capability required'; END IF;
 IF NEW.phase='final' AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase='selection' AND kind='tool_result')
 THEN RAISE EXCEPTION 'authorized selection tool result required'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_responses_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid text; ws text; n integer; lim integer; grantrow provider_grants; current_run runs; total_input bigint; total_output bigint; total_cost numeric; shared_cost numeric;
BEGIN
 SELECT s.grant_id,g.workspace_id INTO gid,ws FROM responses_steps s JOIN provider_grants g ON g.id=s.grant_id
 WHERE s.attempt_id=NEW.attempt_id AND s.phase=NEW.phase;
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 SELECT * INTO grantrow FROM provider_grants WHERE id=gid;
 IF NEW.kind IN ('count_send','dispatch','read','cancel') THEN
   -- Every dispatch participates in shared-budget accounting, including legacy
   -- profiles in other workspaces. Advisory locks do not refresh RR snapshots.
   IF (NEW.kind='dispatch' OR grantrow.data->>'profile'='general-responses-v1')
      AND current_setting('transaction_isolation')<>'read committed'
   THEN RAISE EXCEPTION 'shared budget authority requires read committed isolation'; END IF;
   IF NOT EXISTS (SELECT 1 FROM provider_grants g WHERE id=gid AND active AND
      ((grantrow.data->>'profile'='general-responses-v1' AND grantrow.data->'expires_at'='null'::jsonb) OR (data->>'expires_at')::timestamptz>now() OR EXISTS (
        SELECT 1 FROM provider_consumer_successors a JOIN responses_consumer_uses u ON u.grant_id=a.grant_id
        WHERE a.grant_id=g.id AND u.attempt_id=NEW.attempt_id AND (a.data->>'expires_at')::timestamptz>now())))
   THEN RAISE EXCEPTION 'grant unavailable'; END IF;
   SELECT count(*) INTO n FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
    WHERE s.grant_id=gid AND e.kind=NEW.kind;
   lim=CASE WHEN grantrow.data->>'profile'='general-responses-v1' THEN
       (grantrow.data->'responses'->>(CASE NEW.kind WHEN 'read' THEN 'read_limit' WHEN 'cancel' THEN 'cancel_limit' WHEN 'dispatch' THEN 'generation_limit' ELSE 'count_limit' END))::integer
       ELSE CASE WHEN NEW.kind='read' THEN 40 ELSE 4 END END;
   IF n>=lim THEN RAISE EXCEPTION 'cumulative request limit'; END IF;
 END IF;
 IF grantrow.data->>'profile'='general-responses-v1' AND NEW.kind IN ('count_send','dispatch','read','cancel','tool_result') THEN
   IF NOT EXISTS (SELECT 1 FROM provider_attempts a JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
       JOIN conversations cv ON cv.workspace_id=r.workspace_id AND cv.id=r.conversation_id
       JOIN memberships m ON m.workspace_id=r.workspace_id AND m.principal_id=r.data->>'principal_id'
       JOIN workspaces w ON w.id=r.workspace_id
       WHERE a.id=NEW.attempt_id AND r.data->>'state'='running' AND cv.data->>'state'='open'
       AND m.active AND grantrow.active AND r.data->>'access_generation'=w.access_generation::text
       AND (r.data->>'lease_expires_at')::timestamptz>now()
       AND grantrow.data->'responses'->'conversation_ids' ? r.conversation_id)
   THEN RAISE EXCEPTION 'current general execution authority required'; END IF;
   SELECT run.* INTO current_run FROM runs run JOIN provider_attempts a ON a.workspace_id=run.workspace_id AND a.run_id=run.id
      WHERE a.id=NEW.attempt_id;
   PERFORM require_general_publication_authority(current_run);
 END IF;
 IF NEW.kind='dispatch' THEN
   -- Serialize reservations across all workspaces, profiles and successor grants.
   -- No refund for cancellation, revocation, unknown usage or smaller receipts.
   PERFORM pg_advisory_xact_lock(721004120);
   SELECT coalesce(sum((e.data->>'reserved_cost_usd')::numeric),0) INTO shared_cost
     FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
     WHERE s.grant_id IN (SELECT responses_budget_grants(gid)) AND e.kind='dispatch';
   IF shared_cost+0.131920>20.00 THEN RAISE EXCEPTION 'shared cumulative project budget exhausted'; END IF;
   SELECT coalesce(sum((e.data->>'reserved_input_tokens')::bigint),0),
          coalesce(sum((e.data->>'reserved_output_tokens')::bigint),0),
          coalesce(sum((e.data->>'reserved_cost_usd')::numeric),0)
     INTO total_input,total_output,total_cost FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
     WHERE s.grant_id=gid AND e.kind='dispatch';
   IF total_input+20000>(CASE WHEN grantrow.data->>'profile'='general-responses-v1' THEN (grantrow.data->'responses'->>'input_limit')::bigint ELSE 80000 END)
      OR total_output+8192>(CASE WHEN grantrow.data->>'profile'='general-responses-v1' THEN (grantrow.data->'responses'->>'output_limit')::bigint ELSE 32768 END)
      OR total_cost+0.131920>20.00 THEN RAISE EXCEPTION 'cumulative reservation limit'; END IF;
   IF NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='count_result')
   THEN RAISE EXCEPTION 'durable count required'; END IF;
   IF NEW.data->>'reserved_input_tokens'<>'20000' OR NEW.data->>'reserved_output_tokens'<>'8192'
      OR (NEW.data->>'reserved_cost_usd')::numeric<>0.131920
   THEN RAISE EXCEPTION 'full worst-case reservation required'; END IF;
 END IF;
 IF NEW.kind='count_result' AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='count_send')
 THEN RAISE EXCEPTION 'count send required'; END IF;
 IF NEW.kind IN ('identity','result','read','cancel','corrected_readback') AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='dispatch')
 THEN RAISE EXCEPTION 'dispatch required'; END IF;
 RETURN NEW;
END;
$$;

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
          AND t->'verification'->>'model_tests_passed'='true'
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


CREATE OR REPLACE FUNCTION guard_responses_material() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s responses_steps; prior jsonb;
BEGIN
 SELECT * INTO s FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
 IF jsonb_typeof(NEW.data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'event object required'; END IF;
 IF NEW.kind IN ('count_result','identity','result') THEN
   IF NEW.data->>'request_sha256' IS DISTINCT FROM s.request_sha256 OR NEW.data->'metadata' IS DISTINCT FROM s.metadata
   THEN RAISE EXCEPTION 'receipt request binding mismatch'; END IF;
 END IF;
 IF NEW.kind='count_result' THEN
   IF NEW.data->>'count_sha256' IS DISTINCT FROM s.count_sha256 OR
      jsonb_typeof(NEW.data->'input_tokens') IS DISTINCT FROM 'number' OR
      (NEW.data->>'input_tokens')::numeric NOT BETWEEN 0 AND 20000 OR
      (NEW.data->>'input_tokens')::numeric<>trunc((NEW.data->>'input_tokens')::numeric)
   THEN RAISE EXCEPTION 'invalid exact count material'; END IF;
 END IF;
 IF NEW.kind='dispatch' AND (
   NEW.data->>'reserved_input_tokens' IS DISTINCT FROM '20000' OR
   NEW.data->>'reserved_output_tokens' IS DISTINCT FROM '8192' OR
   NEW.data->>'reserved_cost_usd' IS NULL OR
   (NEW.data->>'reserved_cost_usd')::numeric<>0.131920)
 THEN RAISE EXCEPTION 'complete full reservation required'; END IF;
 IF NEW.kind IN ('identity','result') THEN
   IF coalesce(NEW.data->>'response_id','') !~ '^resp_[A-Za-z0-9_-]{1,200}$'
   THEN RAISE EXCEPTION 'response identity required'; END IF;
   SELECT data INTO prior FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='identity';
   IF NEW.kind='result' AND (prior IS NULL OR NEW.data->>'response_id' IS DISTINCT FROM prior->>'response_id')
   THEN RAISE EXCEPTION 'recorded accepted identity required'; END IF;
 END IF;
 IF NEW.kind IN ('read','cancel') AND NOT EXISTS (
    SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='identity')
 THEN RAISE EXCEPTION 'known identity required'; END IF;
 IF NEW.kind='tool_result' AND (NEW.phase='final' OR NOT EXISTS (
    SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result' AND data->>'state'='function_call'))
 THEN RAISE EXCEPTION 'successful selection required'; END IF;
 RETURN NEW;
END;
$$;

-- Adaptive status copy comes from retained kernel observations, not success prose.
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
             AND stage.data->>'terminal_outcome' IN ('needs_validation','blocked','waiting_for_user','step_limit')
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
            AND t.data->>'terminal_outcome' IN ('needs_validation','blocked','waiting_for_user','step_limit')
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
