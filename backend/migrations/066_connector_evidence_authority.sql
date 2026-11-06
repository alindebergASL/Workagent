-- Additive security repair; never reinterpret historical receipts or rewrite 065.
CREATE OR REPLACE FUNCTION research_attempt_visible(ws text,aid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT research_attempt_visible_pre_mcp(ws,aid) AND NOT EXISTS(
 SELECT 1 FROM tool_attempts a WHERE a.workspace_id=ws AND a.id=aid
 AND a.capability_id='connectors.mcp.read' AND NOT (
   connector_read_authorized(ws,a.run_id,a.call) AND tool_run_available(ws,a.run_id)
   AND EXISTS(SELECT 1 FROM tool_grants g WHERE g.id=a.grant_id AND g.active
     AND (g.data->>'expires_at')::timestamptz>clock_timestamp()
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.data->'capabilities') pin
       WHERE pin->>'id'=a.capability_id AND pin->>'version'=a.capability_version
       AND pin->>'schema_sha256'=a.descriptor->>'schema_sha256'
       AND pin->>'implementation_sha256'=a.descriptor->>'implementation_sha256'))
   AND EXISTS(SELECT 1 FROM capability_installations i WHERE i.id=a.capability_id
     AND i.version=a.capability_version AND i.enabled AND i.descriptor=a.descriptor)))
$$;

-- Provider assertions are not claims the general runtime SQL role can make.
-- A separate private executor gets ONLY these two guarded functions. Creating
-- that role and its credential is explicit operator fixture setup, not migration.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_routine_grants
 WHERE routine_schema='public' AND routine_name IN ('connector_finish','connector_revoke_result')
 AND grantee<>current_user AND grantee<>'PUBLIC' LOOP
 EXECUTE format('REVOKE EXECUTE ON FUNCTION connector_finish(text,text,text,text,text,timestamptz),connector_revoke_result(text,text,text,text,text) FROM %I',r.grantee);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION connector_finish(text,text,text,text,text,timestamptz),connector_revoke_result(text,text,text,text,text) FROM PUBLIC;
