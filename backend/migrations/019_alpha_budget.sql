-- Additive alpha authority; no historical rows, pins or counters are rewritten.
-- These ceilings are configuration, not a named approval or a fresh allowance.
CREATE FUNCTION require_alpha_budget_binding(b jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k text; ceiling numeric;
BEGIN
 IF jsonb_typeof(b) IS DISTINCT FROM 'object'
    OR b->'runtime_extension' IS DISTINCT FROM '"general-alpha-v1"'::jsonb
    OR b->'policy_version' IS DISTINCT FROM '"adaptive-local-v1"'::jsonb
    OR b->'cancel_limit' IS DISTINCT FROM '0'::jsonb
    OR b->'synthetic_data_only' IS DISTINCT FROM 'true'::jsonb
    OR b->'store_acknowledged' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(b->'max_steps') IS DISTINCT FROM 'number'
    OR coalesce(b->>'max_steps','') !~ '^[1-4]$'
    OR jsonb_typeof(b->'cost_limit_usd') IS DISTINCT FROM 'string'
    OR coalesce(b->>'cost_limit_usd','') !~ '^(0|[1-9][0-9]?)(\.[0-9]{1,6})?$'
    OR jsonb_typeof(b->'conversation_ids') IS DISTINCT FROM 'array'
    OR b - ARRAY['runtime_extension','project_id','secret_reference','transport_mode','instructions_sha256',
       'schema_sha256','scope_tool_sha256','policy_version','max_steps','generation_limit','count_limit',
       'read_limit','cancel_limit','input_limit','output_limit','cost_limit_usd','conversation_ids',
       'authorization_sha256','synthetic_data_only','store_acknowledged'] <> '{}'::jsonb
 THEN RAISE EXCEPTION 'exact typed alpha budget binding required'; END IF;
 IF (b->>'cost_limit_usd')::numeric>20.00
    OR jsonb_array_length(b->'conversation_ids') NOT BETWEEN 1 AND 10
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(b->'conversation_ids'))<>jsonb_array_length(b->'conversation_ids')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(b->'conversation_ids') v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string'
       OR length(v #>> '{}') NOT BETWEEN 1 AND 128 OR (v #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$')
 THEN RAISE EXCEPTION 'bounded unique alpha scope required'; END IF;
 FOREACH k IN ARRAY ARRAY['generation_limit','count_limit','read_limit','input_limit','output_limit'] LOOP
   ceiling=CASE k WHEN 'generation_limit' THEN 50 WHEN 'count_limit' THEN 50 WHEN 'read_limit' THEN 500
       WHEN 'input_limit' THEN 1000000 ELSE 409600 END;
   IF jsonb_typeof(b->k) IS DISTINCT FROM 'number' OR coalesce(b->>k,'') !~ '^(0|[1-9][0-9]*)$'
   THEN RAISE EXCEPTION 'exact typed alpha budget binding required'; END IF;
   IF (b->>k)::numeric>ceiling THEN RAISE EXCEPTION 'alpha budget may only tighten'; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['instructions_sha256','schema_sha256','scope_tool_sha256','authorization_sha256'] LOOP
   IF jsonb_typeof(b->k) IS DISTINCT FROM 'string' OR coalesce(b->>k,'') !~ '^[0-9a-f]{64}$'
   THEN RAISE EXCEPTION 'exact alpha pins required'; END IF;
 END LOOP;
 IF jsonb_typeof(b->'project_id') IS DISTINCT FROM 'string' OR coalesce(b->>'project_id','') !~ '^proj_[A-Za-z0-9_-]{1,100}$'
    OR jsonb_typeof(b->'secret_reference') IS DISTINCT FROM 'string' OR coalesce(b->>'secret_reference','') !~ '^file:/[A-Za-z0-9_./-]+$'
    OR length(b->>'secret_reference') NOT BETWEEN 7 AND 406
    OR b->'transport_mode' NOT IN ('"synthetic"'::jsonb,'"official_api"'::jsonb) OR NOT b ? 'transport_mode'
 THEN RAISE EXCEPTION 'exact alpha route binding required'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION guard_general_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b jsonb; cid text; alpha boolean;
BEGIN
 IF NEW.data->>'profile'<>'general-responses-v1' THEN RETURN NEW; END IF;
 b=NEW.data->'responses';
 alpha=b ? 'runtime_extension';
 IF alpha THEN
   PERFORM require_alpha_budget_binding(b);
   IF jsonb_typeof(NEW.data->'max_runs') IS DISTINCT FROM 'number'
      OR coalesce(NEW.data->>'max_runs','') !~ '^([1-9]|10)$'
      OR NEW.data->'max_received_output_tokens' IS DISTINCT FROM '16384'::jsonb
   THEN RAISE EXCEPTION 'exact typed alpha run bounds required'; END IF;
 END IF;
 IF NEW.data->>'id' IS DISTINCT FROM NEW.id OR NEW.data->>'workspace_id' IS DISTINCT FROM NEW.workspace_id
 OR NEW.data->>'principal_id' IS DISTINCT FROM NEW.principal_id
 OR NEW.data->'expires_at' IS DISTINCT FROM 'null'::jsonb
 OR NEW.data->>'model' IS DISTINCT FROM 'gpt-6.1-sol'
 OR coalesce((NEW.data->>'max_runs')::integer,0) NOT BETWEEN 1 AND (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN 10 ELSE 4 END)
 OR NEW.data->>'max_received_output_tokens' IS DISTINCT FROM '16384'
 OR b->>'policy_version' NOT IN ('general-responses-v1','adaptive-local-v1')
 OR (b->>'policy_version'='adaptive-local-v1' AND coalesce((b->>'max_steps')::integer,0) NOT BETWEEN 1 AND 4)
 OR (NOT alpha AND (b->>'generation_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '50' ELSE '8' END) OR b->>'count_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '50' ELSE '8' END)
 OR b->>'read_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '500' ELSE '80' END) OR b->>'cancel_limit' IS DISTINCT FROM '0'
 OR b->>'input_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '1000000' ELSE '160000' END) OR b->>'output_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '409600' ELSE '65536' END)
 OR b->>'cost_limit_usd' IS DISTINCT FROM '20.00'))
 OR b->>'synthetic_data_only' IS DISTINCT FROM 'true' OR b->>'store_acknowledged' IS DISTINCT FROM 'true'
 OR b->>'authorization_sha256' IS DISTINCT FROM 'd7f676d970ef2c6d56c39fe961114d00140279b99ba72649177c41de159093c9'
 OR jsonb_typeof(b->'conversation_ids') IS DISTINCT FROM 'array'
 OR jsonb_array_length(b->'conversation_ids') NOT BETWEEN 1 AND (CASE WHEN alpha THEN 10 ELSE 2 END)
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
 IF g.data->'responses'->>'runtime_extension'='general-alpha-v1'
 THEN PERFORM require_alpha_budget_binding(g.data->'responses'); END IF;
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


CREATE OR REPLACE FUNCTION guard_responses_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid text; ws text; n integer; lim integer; grantrow provider_grants; current_run runs; total_input bigint; total_output bigint; total_cost numeric; shared_cost numeric; alpha boolean;
BEGIN
 SELECT s.grant_id,g.workspace_id INTO gid,ws FROM responses_steps s JOIN provider_grants g ON g.id=s.grant_id
 WHERE s.attempt_id=NEW.attempt_id AND s.phase=NEW.phase;
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 SELECT * INTO grantrow FROM provider_grants WHERE id=gid;
 alpha=coalesce(grantrow.data->'responses'->>'runtime_extension'='general-alpha-v1',false);
 IF alpha THEN PERFORM require_alpha_budget_binding(grantrow.data->'responses'); END IF;
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
   -- All alpha counters, not just cost, serialize across shared projects.
   IF alpha THEN PERFORM pg_advisory_xact_lock(721004120); END IF;
   SELECT count(*) INTO n FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
    WHERE (s.grant_id=gid OR (alpha AND s.grant_id IN (SELECT responses_budget_grants(gid)))) AND e.kind=NEW.kind;
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
   IF shared_cost+(CASE WHEN alpha THEN responses_carried_cost(gid) ELSE 0 END)+0.131920
      >(CASE WHEN alpha THEN (grantrow.data->'responses'->>'cost_limit_usd')::numeric ELSE 20.00 END) THEN RAISE EXCEPTION 'shared cumulative project budget exhausted'; END IF;
   SELECT coalesce(sum((e.data->>'reserved_input_tokens')::bigint),0),
          coalesce(sum((e.data->>'reserved_output_tokens')::bigint),0),
          coalesce(sum((e.data->>'reserved_cost_usd')::numeric),0)
     INTO total_input,total_output,total_cost FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
     WHERE (s.grant_id=gid OR (alpha AND s.grant_id IN (SELECT responses_budget_grants(gid)))) AND e.kind='dispatch';
   IF total_input+20000>(CASE WHEN grantrow.data->>'profile'='general-responses-v1' THEN (grantrow.data->'responses'->>'input_limit')::bigint ELSE 80000 END)
      OR total_output+8192>(CASE WHEN grantrow.data->>'profile'='general-responses-v1' THEN (grantrow.data->'responses'->>'output_limit')::bigint ELSE 32768 END)
      OR total_cost+0.131920>(CASE WHEN alpha THEN (grantrow.data->'responses'->>'cost_limit_usd')::numeric ELSE 20.00 END) THEN RAISE EXCEPTION 'cumulative reservation limit'; END IF;
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
