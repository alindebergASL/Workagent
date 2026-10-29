-- Narrow current resource authority without rewriting grants or historical receipts.
-- Restrictions are owner-installed, append-only, and cannot expand original scope.
CREATE TABLE tool_scope_reductions (
 grant_id text NOT NULL REFERENCES tool_grants(id),
 selector jsonb NOT NULL CHECK(jsonb_typeof(selector)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(grant_id,selector)
);
CREATE FUNCTION guard_tool_scope_reduction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws text;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
   OR TG_OP<>'INSERT' THEN RAISE EXCEPTION 'owner append-only scope restriction required'; END IF;
 SELECT workspace_id INTO ws FROM tool_grants WHERE id=NEW.grant_id;
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM tool_grants WHERE id=NEW.grant_id
   AND data->'resource_selectors' @> jsonb_build_array(NEW.selector))
 THEN RAISE EXCEPTION 'original selector required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tool_scope_reduction_owner BEFORE INSERT OR UPDATE OR DELETE ON tool_scope_reductions
 FOR EACH ROW EXECUTE FUNCTION guard_tool_scope_reduction();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='tool_grants' AND privilege_type='SELECT'
   AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP EXECUTE format('GRANT SELECT ON tool_scope_reductions TO %I',r.grantee); END LOOP;
END $$;

ALTER FUNCTION tool_file_resources_authorized(text,text,jsonb) RENAME TO tool_resources_before_reductions;
CREATE FUNCTION tool_file_resources_authorized(ws text,rid text,payload jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT tool_resources_before_reductions(ws,rid,payload) AND NOT EXISTS(
   SELECT 1 FROM tool_scope_reductions sr JOIN tool_grants g ON g.id=sr.grant_id
   WHERE g.workspace_id=ws AND g.run_id=rid
     AND payload->'input_refs' @> jsonb_build_array(sr.selector))
$$;
