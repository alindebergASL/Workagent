-- Explicit new-turn authority, never run/attempt rebinding or a budget reset.
-- Owner-only immutable lineage. Existing grants and all journal rows stay intact.
CREATE TABLE general_grant_continuations (
 successor_id text PRIMARY KEY REFERENCES provider_grants(id) DEFERRABLE INITIALLY DEFERRED,
 predecessor_id text NOT NULL UNIQUE REFERENCES provider_grants(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (successor_id<>predecessor_id)
);
REVOKE ALL ON general_grant_continuations FROM PUBLIC;

CREATE FUNCTION guard_general_grant_continuation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'grant continuation lineage is immutable'; END IF;
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='provider_grants'::regclass))
 THEN RAISE EXCEPTION 'migration identity required'; END IF;
 IF EXISTS (SELECT 1 FROM provider_grants WHERE id=NEW.successor_id)
 THEN RAISE EXCEPTION 'lineage must precede new grant installation'; END IF;
 -- No forward predecessor: uniqueness and existing predecessor prevent cycles/forks.
 PERFORM id FROM provider_grants WHERE id=NEW.predecessor_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'existing predecessor required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER general_grant_continuation_guard BEFORE INSERT OR UPDATE OR DELETE
 ON general_grant_continuations FOR EACH ROW EXECUTE FUNCTION guard_general_grant_continuation();

CREATE OR REPLACE FUNCTION guard_general_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b jsonb; cid text; alpha boolean; predecessor provider_grants; lineage text[];
BEGIN
 IF NEW.data->>'profile'<>'general-responses-v1' THEN
   IF EXISTS (SELECT 1 FROM general_grant_continuations WHERE successor_id=NEW.id)
   THEN RAISE EXCEPTION 'alpha successor required'; END IF;
   RETURN NEW;
 END IF;
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
 OR (b->>'policy_version'='adaptive-local-v1' AND coalesce((b->>'max_steps')::integer,0) NOT BETWEEN 1 AND (CASE WHEN alpha THEN 8 ELSE 4 END))
 OR (NOT alpha AND (b->>'generation_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '50' ELSE '8' END) OR b->>'count_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '50' ELSE '8' END)
 OR b->>'read_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '500' ELSE '80' END) OR b->>'cancel_limit' IS DISTINCT FROM '0'
 OR b->>'input_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '1000000' ELSE '160000' END) OR b->>'output_limit' IS DISTINCT FROM (CASE WHEN b->>'policy_version'='adaptive-local-v1' THEN '409600' ELSE '65536' END)
 OR b->>'cost_limit_usd' IS DISTINCT FROM '20.00'))
 OR b->>'synthetic_data_only' IS DISTINCT FROM 'true' OR b->>'store_acknowledged' IS DISTINCT FROM 'true'
 OR b->>'authorization_sha256' IS DISTINCT FROM 'd7f676d970ef2c6d56c39fe961114d00140279b99ba72649177c41de159093c9'
 OR jsonb_typeof(b->'conversation_ids') IS DISTINCT FROM 'array'
 OR jsonb_array_length(b->'conversation_ids') NOT BETWEEN 1 AND (CASE WHEN alpha THEN 10 ELSE 2 END)
 THEN RAISE EXCEPTION 'exact bounded general authorization required'; END IF;
 IF TG_OP='INSERT' THEN
   SELECT g.* INTO predecessor FROM general_grant_continuations l
     JOIN provider_grants g ON g.id=l.predecessor_id WHERE l.successor_id=NEW.id;
   IF FOUND THEN
     -- New immutable pins may change; scope/route cannot. This is a continuation
     -- grant, not an implicit request for additional accounts, data or effects.
     IF NOT alpha OR predecessor.active
        OR predecessor.workspace_id<>NEW.workspace_id OR predecessor.principal_id<>NEW.principal_id
        OR predecessor.data->>'profile' IS DISTINCT FROM 'general-responses-v1'
        OR predecessor.data->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
        OR predecessor.data->>'model' IS DISTINCT FROM NEW.data->>'model'
        OR predecessor.data->'responses'->'conversation_ids' IS DISTINCT FROM b->'conversation_ids'
        OR predecessor.data->'responses'->'project_id' IS DISTINCT FROM b->'project_id'
        OR predecessor.data->'responses'->'transport_mode' IS DISTINCT FROM b->'transport_mode'
        OR predecessor.data->'responses'->'secret_reference' IS DISTINCT FROM b->'secret_reference'
     THEN RAISE EXCEPTION 'inactive exact-scope same-route alpha predecessor required'; END IF;
     WITH RECURSIVE ancestors(id) AS (
       SELECT predecessor.id UNION ALL
       SELECT l.predecessor_id FROM general_grant_continuations l JOIN ancestors a ON l.successor_id=a.id
     ) SELECT array_agg(id) INTO lineage FROM ancestors;
   END IF;
 END IF;
 FOR cid IN SELECT jsonb_array_elements_text(b->'conversation_ids') LOOP
   IF NOT EXISTS (SELECT 1 FROM conversations cv WHERE cv.workspace_id=NEW.workspace_id AND cv.id=cid
      AND cv.data->>'owner_id'=NEW.principal_id AND cv.data->'selected_source_refs'='[]'::jsonb)
   THEN RAISE EXCEPTION 'explicit synthetic conversation scope required'; END IF;
   IF TG_OP='INSERT' AND EXISTS (SELECT 1 FROM provider_grants g WHERE g.workspace_id=NEW.workspace_id
      AND g.data->>'profile'='general-responses-v1' AND g.data->'responses'->'conversation_ids' ? cid
      AND (g.active OR NOT (g.id=ANY(coalesce(lineage,ARRAY[]::text[])))))
   THEN RAISE EXCEPTION 'conversation authorization requires explicit inactive lineage'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
