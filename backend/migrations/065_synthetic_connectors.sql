-- Synthetic consent is separate from immutable task grants. No credentials here.
CREATE TABLE connector_accounts (
 workspace_id text NOT NULL REFERENCES workspaces(id), id text NOT NULL,
 principal_id text NOT NULL, state text NOT NULL CHECK(state IN ('connected','revoked','unavailable')),
 access_generation integer NOT NULL DEFAULT 1 CHECK(access_generation>0),
 expires_at timestamptz NOT NULL, credential_ref text,
 provider_revocation text NOT NULL DEFAULT 'not_requested' CHECK(provider_revocation IN ('not_requested','pending','failed','revoked')),
 reason text, PRIMARY KEY(workspace_id,id),
 CHECK((state='connected')=(credential_ref IS NOT NULL))
);
CREATE TABLE connector_auth_flows (
 workspace_id text NOT NULL, id text NOT NULL, principal_id text NOT NULL,
 idempotency_key text NOT NULL, secret_ref text, expires_at timestamptz NOT NULL,
 consumed boolean NOT NULL DEFAULT false, complete_key text,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,principal_id,idempotency_key),
 FOREIGN KEY(workspace_id,id) REFERENCES connector_accounts(workspace_id,id)
);
CREATE TABLE connector_revocations (
 workspace_id text NOT NULL, connector_id text NOT NULL, principal_id text NOT NULL,
 idempotency_key text NOT NULL, expected_generation integer NOT NULL,
 local_blocked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 provider_result text NOT NULL DEFAULT 'pending' CHECK(provider_result IN ('pending','failed','revoked')),
 PRIMARY KEY(workspace_id,principal_id,idempotency_key),
 FOREIGN KEY(workspace_id,connector_id) REFERENCES connector_accounts(workspace_id,id)
);
CREATE FUNCTION connector_member(ws text,p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=ws AND principal_id=p AND active AND role<>'viewer')
 THEN RAISE EXCEPTION 'connector unavailable'; END IF;
END $$;
CREATE FUNCTION connector_start(ws text,p text,fid text,k text,ref text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE previous text;
BEGIN
 PERFORM connector_member(ws,p);
 SELECT id INTO previous FROM connector_auth_flows WHERE workspace_id=ws AND principal_id=p AND idempotency_key=k;
 IF previous IS NOT NULL THEN RETURN previous; END IF;
 IF (SELECT count(*) FROM connector_accounts WHERE workspace_id=ws AND principal_id=p)>=100
 THEN RAISE EXCEPTION 'connector limit'; END IF;
 INSERT INTO connector_accounts(workspace_id,id,principal_id,state,expires_at,reason)
 VALUES(ws,fid,p,'unavailable',clock_timestamp()+interval '5 minutes','awaiting_synthetic_consent');
 INSERT INTO connector_auth_flows VALUES(ws,fid,p,k,ref,clock_timestamp()+interval '5 minutes',false,NULL);
 RETURN fid;
END $$;
CREATE FUNCTION connector_claim(ws text,p text,fid text,k text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f connector_auth_flows; a connector_accounts;
BEGIN
 PERFORM connector_member(ws,p);
 SELECT * INTO f FROM connector_auth_flows WHERE workspace_id=ws AND id=fid AND principal_id=p FOR UPDATE;
 SELECT * INTO a FROM connector_accounts WHERE workspace_id=ws AND id=fid AND principal_id=p FOR UPDATE;
 IF f.id IS NULL THEN RAISE EXCEPTION 'connector unavailable'; END IF;
 IF f.consumed THEN
   IF f.complete_key IS DISTINCT FROM k THEN RAISE EXCEPTION 'callback consumed'; END IF;
   RETURN NULL;
 END IF;
 IF f.expires_at<=clock_timestamp() OR a.state='revoked' THEN RAISE EXCEPTION 'flow unavailable'; END IF;
 UPDATE connector_auth_flows SET consumed=true,complete_key=k,secret_ref=NULL WHERE workspace_id=ws AND id=fid;
 UPDATE connector_accounts SET reason='synthetic_exchange_pending' WHERE workspace_id=ws AND id=fid;
 RETURN f.secret_ref;
END $$;
CREATE FUNCTION connector_finish(ws text,p text,fid text,k text,ref text,expiry timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM connector_member(ws,p);
 IF NOT EXISTS(SELECT 1 FROM connector_auth_flows WHERE workspace_id=ws AND id=fid AND principal_id=p AND consumed AND complete_key=k)
 THEN RAISE EXCEPTION 'flow unavailable'; END IF;
 UPDATE connector_accounts SET state='connected',credential_ref=ref,expires_at=expiry,reason=NULL
 WHERE workspace_id=ws AND id=fid AND principal_id=p AND access_generation=1 AND state='unavailable'
 AND reason='synthetic_exchange_pending' AND expiry>clock_timestamp() AND expiry<=clock_timestamp()+interval '1 hour';
 RETURN FOUND;
END $$;
CREATE FUNCTION connector_revoke(ws text,p text,cid text,g integer,k text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a connector_accounts; prior connector_revocations;
BEGIN
 PERFORM connector_member(ws,p);
 SELECT * INTO a FROM connector_accounts WHERE workspace_id=ws AND id=cid AND principal_id=p FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'connector unavailable'; END IF;
 SELECT * INTO prior FROM connector_revocations WHERE workspace_id=ws AND principal_id=p AND idempotency_key=k;
 IF prior.connector_id IS NOT NULL THEN
   IF prior.connector_id<>cid OR prior.expected_generation<>g THEN RAISE EXCEPTION 'command conflict'; END IF;
   RETURN NULL;
 END IF;
 IF a.access_generation<>g THEN RAISE EXCEPTION 'generation conflict'; END IF;
 INSERT INTO connector_revocations(workspace_id,connector_id,principal_id,idempotency_key,expected_generation)
 VALUES(ws,cid,p,k,g);
 UPDATE connector_accounts SET state='revoked',access_generation=access_generation+1,credential_ref=NULL,
 provider_revocation='pending',reason='locally_revoked' WHERE workspace_id=ws AND id=cid;
 RETURN a.credential_ref;
END $$;
CREATE FUNCTION connector_revoke_result(ws text,p text,cid text,k text,result text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM connector_member(ws,p);
 IF result NOT IN ('failed','revoked') THEN RAISE EXCEPTION 'invalid provider outcome'; END IF;
 UPDATE connector_revocations SET provider_result=result WHERE workspace_id=ws AND connector_id=cid AND principal_id=p AND idempotency_key=k AND provider_result='pending';
 IF FOUND THEN UPDATE connector_accounts SET provider_revocation=result WHERE workspace_id=ws AND id=cid AND principal_id=p AND state='revoked'; END IF;
END $$;
REVOKE ALL ON connector_accounts,connector_auth_flows,connector_revocations FROM PUBLIC;
REVOKE ALL ON FUNCTION connector_member(text,text),connector_start(text,text,text,text,text),connector_claim(text,text,text,text),connector_finish(text,text,text,text,text,timestamptz),connector_revoke(text,text,text,integer,text),connector_revoke_result(text,text,text,text,text) FROM PUBLIC;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='tool_grants' AND privilege_type='SELECT' AND grantee<>current_user AND grantee<>'PUBLIC' LOOP
 EXECUTE format('REVOKE ALL ON connector_accounts,connector_auth_flows,connector_revocations FROM %I',r.grantee);
 EXECUTE format('GRANT SELECT ON connector_accounts,connector_auth_flows,connector_revocations TO %I',r.grantee);
 EXECUTE format('GRANT EXECUTE ON FUNCTION connector_start(text,text,text,text,text),connector_claim(text,text,text,text),connector_finish(text,text,text,text,text,timestamptz),connector_revoke(text,text,text,integer,text),connector_revoke_result(text,text,text,text,text) TO %I',r.grantee);
 END LOOP;
END $$;

-- Add only the synthetic read adapter to existing resource and provenance fences.
CREATE FUNCTION connector_read_authorized(ws text,rid text,payload jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM connector_accounts a JOIN runs r ON r.workspace_id=a.workspace_id
 JOIN tool_grants g ON g.workspace_id=r.workspace_id AND g.run_id=r.id
 WHERE r.workspace_id=ws AND r.id=rid AND r.conversation_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM run_configurations cfg WHERE cfg.workspace_id=ws AND cfg.run_id=rid AND cfg.data ? 'responsibility')
 AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.workspace_id=ws AND m.run_id=rid AND m.author_kind IN ('human','system') AND nullif(m.data->'target','null'::jsonb) IS NOT NULL)
 AND a.id=payload->'arguments'->>'connector_id' AND a.principal_id=r.data->>'principal_id'
 AND a.state='connected' AND a.expires_at>clock_timestamp()
 AND to_jsonb(a.access_generation)=payload->'arguments'->'access_generation'
 AND payload->'arguments'->>'kind'='mcp_read'
 AND payload->'arguments'->>'page' ~ '^[1-3]$'
 AND (payload->'arguments')-ARRAY['kind','connector_id','access_generation','page']='{}'::jsonb
 AND payload->'input_refs'=jsonb_build_array(research_selector('connector',a.id||':'||a.access_generation::text),research_selector('processor','local-synthetic-mcp'))
 AND (g.data->'resource_selectors') @> (payload->'input_refs')
 AND NOT EXISTS(SELECT 1 FROM tool_scope_reductions sr WHERE sr.grant_id=g.id AND payload->'input_refs' @> jsonb_build_array(sr.selector)))
$$;
ALTER FUNCTION tool_file_resources_authorized(text,text,jsonb) RENAME TO tool_resources_pre_mcp;
CREATE FUNCTION tool_file_resources_authorized(ws text,rid text,payload jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN payload->>'capability_id'='connectors.mcp.read' THEN connector_read_authorized(ws,rid,payload)
 ELSE tool_resources_pre_mcp(ws,rid,payload) END
$$;
ALTER FUNCTION research_attempt_visible(text,text) RENAME TO research_attempt_visible_pre_mcp;
CREATE FUNCTION research_attempt_visible(ws text,aid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT research_attempt_visible_pre_mcp(ws,aid) AND NOT EXISTS(SELECT 1 FROM tool_attempts a
 WHERE a.workspace_id=ws AND a.id=aid AND a.capability_id='connectors.mcp.read'
 AND NOT connector_read_authorized(ws,a.run_id,a.call))
$$;
ALTER FUNCTION research_tool_dependencies_visible(text,text) RENAME TO research_tool_dependencies_visible_pre_mcp;
CREATE FUNCTION research_tool_dependencies_visible(ws text,aid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT research_tool_dependencies_visible_pre_mcp(ws,aid) AND NOT EXISTS(SELECT 1 FROM tool_attempts a
 WHERE a.workspace_id=ws AND a.id=aid AND a.capability_id='connectors.mcp.read' AND NOT research_attempt_visible(ws,aid))
$$;
-- Current run context/queued attempts also depend on exact connector generation.
ALTER FUNCTION tool_run_available(text,text) RENAME TO tool_run_available_pre_mcp;
CREATE FUNCTION tool_run_available(ws text,rid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT tool_run_available_pre_mcp(ws,rid) AND NOT EXISTS(
 SELECT 1 FROM tool_grants g CROSS JOIN LATERAL jsonb_array_elements(g.data->'resource_selectors') ref
 WHERE g.workspace_id=ws AND g.run_id=rid AND ref->>'kind'='connector' AND NOT EXISTS(
 SELECT 1 FROM connector_accounts a WHERE a.workspace_id=ws AND a.principal_id=g.data->>'principal_id'
 AND a.state='connected' AND a.expires_at>clock_timestamp()
 AND ref=research_selector('connector',a.id||':'||a.access_generation::text)))
$$;
DO $$ DECLARE definition text; old text; name text;
BEGIN
 definition=pg_get_functiondef('guard_source_snapshot()'::regprocedure);
 old=$q$research_publication_authorized(NEW.workspace_id,NEW.id,f.owner_id,'connectors.github.read')$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'MCP source predecessor drift'; END IF;
 definition=replace(definition,old,old||$q$ OR research_publication_authorized(NEW.workspace_id,NEW.id,f.owner_id,'connectors.mcp.read')$q$);
 old=$q$CASE WHEN a.capability_id IN ('connectors.github.discover','connectors.github.read')$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'MCP locator predecessor drift'; END IF;
 definition=replace(definition,old,$q$CASE WHEN a.capability_id='connectors.mcp.read' THEN 'https://synthetic.invalid/catalog/'||(a.call->'arguments'->>'connector_id')||'/'||(a.call->'arguments'->>'page') WHEN a.capability_id IN ('connectors.github.discover','connectors.github.read')$q$);
 EXECUTE definition;
 FOREACH name IN ARRAY ARRAY['guard_tool_consumption()','guard_alpha_stage()','guard_file_tool_stage()'] LOOP
 definition=pg_get_functiondef(name::regprocedure);old=$q$'github_read'$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'MCP operation predecessor drift'; END IF;
 EXECUTE replace(definition,old,old||$q$,'mcp_read'$q$);
 END LOOP;
END $$;

DO $$ DECLARE definition text; name text; old text; BEGIN
 FOREACH name IN ARRAY ARRAY['require_run_successor(runs,jsonb)','guard_retained_result_read()'] LOOP
 definition=pg_get_functiondef(name::regprocedure);
 old=$q$'6902a690319c3df4c57a20ec025d3d125a70ac26777090b35fb9e0eeda09d689'$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'MCP schema predecessor drift'; END IF;
 EXECUTE replace(definition,old,old||$q$,'56118e2f15afaf374e7d8863e3a12f2c4c08659faf1e9ac1f34f55ef0c0efd63'$q$);
 END LOOP;
END $$;
