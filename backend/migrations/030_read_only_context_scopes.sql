-- Read-only prior context is separate from eligibility to execute new turns.
-- Owner-installed, immutable, fixed before the new grant admits any run. Existing
-- grants, attempts, responses and serialized binding models are not rewritten.
CREATE TABLE general_context_scopes (
 grant_id text PRIMARY KEY REFERENCES provider_grants(id),
 conversation_ids jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON general_context_scopes FROM PUBLIC;
CREATE FUNCTION guard_general_context_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g provider_grants; cid text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'context scope is immutable'; END IF;
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='provider_grants'::regclass))
 THEN RAISE EXCEPTION 'migration identity required'; END IF;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.grant_id;
 -- Same lock order as admission: an owner cannot race new context authority
 -- into a run that already captured its permission boundary.
 PERFORM id FROM workspaces WHERE id=g.workspace_id FOR UPDATE;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.grant_id FOR UPDATE;
 IF g.id IS NULL OR NOT g.active OR g.data->>'profile' IS DISTINCT FROM 'general-responses-v1'
    OR g.data->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
    OR jsonb_typeof(NEW.conversation_ids) IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.conversation_ids) NOT BETWEEN 1 AND 10
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.conversation_ids) item
       WHERE jsonb_typeof(item)<>'string' OR length(item#>>'{}')>128
          OR (item#>>'{}') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$')
    OR EXISTS (SELECT 1 FROM run_configurations WHERE data->>'grant_id'=NEW.grant_id)
 THEN RAISE EXCEPTION 'new unused active alpha grant required'; END IF;
 IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(NEW.conversation_ids))<>jsonb_array_length(NEW.conversation_ids)
 THEN RAISE EXCEPTION 'unique context scope required'; END IF;
 FOR cid IN SELECT jsonb_array_elements_text(NEW.conversation_ids) LOOP
   IF NOT EXISTS (SELECT 1 FROM conversations cv WHERE cv.workspace_id=g.workspace_id AND cv.id=cid
      AND cv.data->>'owner_id'=g.principal_id AND cv.data->'selected_source_refs'='[]'::jsonb
      AND cv.data->>'state'='open')
   THEN RAISE EXCEPTION 'explicit same-owner source-free context required'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER general_context_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON general_context_scopes
FOR EACH ROW EXECUTE FUNCTION guard_general_context_scope();
DO $$ DECLARE r record;
BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='responses_events' AND privilege_type='INSERT'
   AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP EXECUTE format('GRANT SELECT ON general_context_scopes TO %I',r.grantee); END LOOP;
END $$;

CREATE FUNCTION general_context_scope_permits(config jsonb,cid text) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT coalesce(config->'responses'->'conversation_ids' ? cid,false)
   OR EXISTS (SELECT 1 FROM general_context_scopes s WHERE s.grant_id=config->>'grant_id' AND s.conversation_ids ? cid)
$$;

-- Both exact 029 guards retain all authority/content/receipt/publication checks.
-- Replace ONLY their one explicit context-membership predicate. The preceding
-- migration checksum is verified by the runner; reject unexpected function shapes
-- rather than silently replacing an unknown SQL implementation.
DO $$ DECLARE name text; body text;
 old_clause text := 'config->''responses''->''conversation_ids'' ? (source->>''conversation_id'')';
 new_clause text := 'general_context_scope_permits(config,source->>''conversation_id'')';
BEGIN
 FOREACH name IN ARRAY ARRAY['guard_work_context_search()','require_work_context_sources(runs)'] LOOP
   SELECT pg_get_functiondef(name::regprocedure) INTO body;
   IF (length(body)-length(replace(body,old_clause,'')))/length(old_clause)<>1
   THEN RAISE EXCEPTION 'exact 029 context membership predicate required'; END IF;
   EXECUTE replace(body,old_clause,new_clause);
 END LOOP;
END $$;
