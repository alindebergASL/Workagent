-- Native public GitHub only. Reuse shared snapshots, receipts and dependency ACLs.
CREATE FUNCTION github_public_endpoint(args jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE suffix text;
BEGIN
 IF args->>'repository' IS NULL OR args->>'repository' !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,38}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'
   OR coalesce(args->>'resource','') NOT IN ('readme','issues','releases') THEN RETURN NULL; END IF;
 IF args->>'kind'='github_discover' THEN
   IF args-ARRAY['kind','repository','resource','page','per_page']<>'{}'::jsonb
     OR jsonb_typeof(args->'page') IS DISTINCT FROM 'number'
     OR jsonb_typeof(args->'per_page') IS DISTINCT FROM 'number'
     OR args->>'page' !~ '^[1-5]$' OR args->>'per_page' !~ '^([1-9]|1[0-9]|20)$' THEN RETURN NULL; END IF;
   suffix=CASE args->>'resource' WHEN 'readme' THEN '/commits?per_page=1'
     WHEN 'issues' THEN '/issues?state=all&page='||(args->>'page')||'&per_page='||(args->>'per_page')
     ELSE '/releases?page='||(args->>'page')||'&per_page='||(args->>'per_page') END;
 ELSIF args->>'kind'='github_read' THEN
   IF args-ARRAY['kind','repository','resource','number','commit','expected_response_sha256']<>'{}'::jsonb
     OR NOT args ?& ARRAY['number','commit','expected_response_sha256']
     OR (args->>'expected_response_sha256' IS NOT NULL AND args->>'expected_response_sha256' !~ '^[a-f0-9]{64}$') THEN RETURN NULL; END IF;
   IF args->>'resource'='readme' THEN
     IF args->>'commit' IS NULL OR args->>'commit' !~ '^[a-f0-9]{40}$' OR args->>'number' IS NOT NULL THEN RETURN NULL; END IF;
     suffix='/readme?ref='||(args->>'commit');
   ELSE
     IF jsonb_typeof(args->'number') IS DISTINCT FROM 'number' OR args->>'number' !~ '^[1-9][0-9]{0,9}$'
       OR args->>'commit' IS NOT NULL THEN RETURN NULL; END IF;
     suffix='/'||(args->>'resource')||'/'||(args->>'number');
   END IF;
 ELSE RETURN NULL;
 END IF;
 RETURN 'https://api.github.com/repos/'||(args->>'repository')||suffix;
END $$;

ALTER FUNCTION tool_file_resources_authorized(text,text,jsonb) RENAME TO tool_pre_github_resources_authorized;
CREATE FUNCTION tool_file_resources_authorized(ws text,rid text,payload jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE args jsonb; expected jsonb; g tool_grants; r runs; target jsonb; cfg jsonb;
BEGIN
 IF payload->>'capability_id' NOT IN ('connectors.github.discover','connectors.github.read') THEN
   RETURN tool_pre_github_resources_authorized(ws,rid,payload);
 END IF;
 args=payload->'arguments';
 IF github_public_endpoint(args) IS NULL OR payload->>'capability_id' IS DISTINCT FROM
    (CASE args->>'kind' WHEN 'github_discover' THEN 'connectors.github.discover' WHEN 'github_read' THEN 'connectors.github.read' END)
 THEN RETURN false; END IF;
 SELECT * INTO g FROM tool_grants WHERE workspace_id=ws AND run_id=rid AND active;
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=rid;
 IF g.id IS NULL OR r.conversation_id IS NULL OR g.data->>'egress' IS DISTINCT FROM 'public_https' THEN RETURN false; END IF;
 SELECT data->'target' INTO target FROM conversation_messages WHERE workspace_id=ws AND conversation_id=r.conversation_id
   AND run_id=rid AND author_kind IN ('human','system') ORDER BY sequence LIMIT 1;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=ws AND run_id=rid;
 IF cfg ? 'responsibility' OR nullif(target,'null'::jsonb) IS NOT NULL THEN RETURN false; END IF;
 expected=jsonb_build_array(research_selector('github_repository',args->>'repository'),research_selector('processor','github-public-api-v1'));
 RETURN coalesce(payload->'input_refs'=expected AND g.data->'resource_selectors' @> expected,false);
END $$;

-- Exact GitHub endpoint replaces only the capture-specific parts of the existing
-- raw/extraction/scope/owner/publication guard; all original store checks remain.
DO $$ DECLARE definition text; old text;
BEGIN
 definition=pg_get_functiondef('guard_source_snapshot()'::regprocedure);
 old=$q$research_publication_authorized(NEW.workspace_id,NEW.id,f.owner_id,'research.capture')$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'github source guard predecessor drift'; END IF;
 definition=replace(definition,old,$q$(research_publication_authorized(NEW.workspace_id,NEW.id,f.owner_id,'research.capture')
   OR research_publication_authorized(NEW.workspace_id,NEW.id,f.owner_id,'connectors.github.discover')
   OR research_publication_authorized(NEW.workspace_id,NEW.id,f.owner_id,'connectors.github.read'))$q$);
 old=$q$a.call->'arguments'->>'url'=NEW.data->'locator'->>'url'$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'github endpoint guard predecessor drift'; END IF;
 definition=replace(definition,old,$q$(CASE WHEN a.capability_id IN ('connectors.github.discover','connectors.github.read')
   THEN github_public_endpoint(a.call->'arguments') ELSE a.call->'arguments'->>'url' END)=NEW.data->'locator'->>'url'$q$);
 EXECUTE definition;
END $$;

-- Current retained visibility includes exact selectors, expiry, capability pins,
-- effects, processor and generation, even when resource reduction has no bump.
ALTER FUNCTION research_attempt_visible(text,text) RENAME TO research_attempt_visible_pre_github;
CREATE FUNCTION research_attempt_visible(ws text,aid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT research_attempt_visible_pre_github(ws,aid) AND EXISTS(
 SELECT 1 FROM tool_attempts a JOIN tool_grants g ON g.id=a.grant_id
 WHERE a.workspace_id=ws AND a.id=aid AND
 (a.capability_id NOT IN ('connectors.github.discover','connectors.github.read') OR
   (tool_run_available(ws,a.run_id) AND tool_file_resources_authorized(ws,a.run_id,a.call)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.data->'capabilities') pin
      WHERE pin->>'id'=a.capability_id AND pin->>'version'=a.capability_version
      AND pin->>'schema_sha256'=a.descriptor->>'schema_sha256'
      AND pin->>'implementation_sha256'=a.descriptor->>'implementation_sha256'))))
$$;

ALTER FUNCTION research_tool_dependencies_visible(text,text) RENAME TO research_tool_dependencies_visible_pre_github;
CREATE FUNCTION research_tool_dependencies_visible(ws text,aid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT research_tool_dependencies_visible_pre_github(ws,aid) AND NOT EXISTS(
   SELECT 1 FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation'
   WHERE a.workspace_id=ws AND a.id=aid AND a.capability_id IN ('connectors.github.discover','connectors.github.read')
     AND e.data->>'status'='observed' AND NOT research_attempt_visible(ws,aid))
$$;

-- Do not let a direct restricted memory write detach copied evidence from ACLs.
DO $$ DECLARE definition text; old text;
BEGIN
 definition=pg_get_functiondef('write_memory_revision(text,text,text,text,jsonb)'::regprocedure);
 old=$q$s.id=ref->'ref'->>'version_id' AND s.data->>'extraction_sha256'=ref->'ref'->>'sha256'$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'github memory predecessor drift'; END IF;
 EXECUTE replace(definition,old,old||' AND research_source_visible(ws,s.id)');
END $$;

DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['guard_tool_consumption()','guard_alpha_stage()','guard_file_tool_stage()'] LOOP
   definition=pg_get_functiondef(name::regprocedure); old=$q$'research_capture'$q$;
   IF position(old in definition)=0 THEN RAISE EXCEPTION 'github operation predecessor drift'; END IF;
   EXECUTE replace(definition,old,old||$q$,'github_discover','github_read'$q$);
 END LOOP;
END $$;

DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['require_run_successor(runs,jsonb)','guard_retained_result_read()'] LOOP
   definition=pg_get_functiondef(name::regprocedure);
   old=$q$'37829a6d55e1b241a3eec67c51a928642fcff5597e51c6152432474beea95337'$q$;
   IF position(old in definition)=0 THEN RAISE EXCEPTION 'github schema predecessor drift'; END IF;
   EXECUTE replace(definition,old,old||$q$,'6902a690319c3df4c57a20ec025d3d125a70ac26777090b35fb9e0eeda09d689'$q$);
 END LOOP;
END $$;

-- Final output publication cannot race a revoke after model dispatch. Existing
-- immutable conclusions remain history; this only fences new publications.
ALTER FUNCTION require_general_publication_authority(runs) RENAME TO require_general_publication_authority_pre_github;
CREATE FUNCTION require_general_publication_authority(r runs) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM require_general_publication_authority_pre_github(r);
 IF NOT research_run_dependencies_visible(r.workspace_id,r.id)
 THEN RAISE EXCEPTION 'research dependency no longer visible'; END IF;
END $$;

-- Initial prompt metadata also carries source titles/versions, before a read tool
-- exists in the new run. Fence its retained content-free manifest transitively.
ALTER FUNCTION research_run_dependencies_visible(text,text) RENAME TO research_run_dependencies_visible_pre_github;
CREATE FUNCTION research_run_dependencies_visible(ws text,rid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE dependencies(run_id) AS (
   SELECT rid UNION
   SELECT rr.data->'decision'->>'run_id' FROM retained_result_reads rr JOIN dependencies d ON rr.run_id=d.run_id
    WHERE rr.workspace_id=ws AND rr.data->'decision'->>'kind'='read_result'
 )
 SELECT research_run_dependencies_visible_pre_github(ws,rid) AND NOT EXISTS(
   SELECT 1 FROM run_contexts rc JOIN dependencies d ON d.run_id=rc.run_id,
     LATERAL jsonb_array_elements_text(coalesce(rc.data->'research_source_ids','[]'::jsonb)) sid
   WHERE rc.workspace_id=ws AND NOT research_source_visible(ws,sid))
$$;

-- Immutable version links/counts themselves are provenance. Hide an entire
-- linked chain if an ancestor becomes unavailable; a fresh capture then starts
-- a separate file rather than revealing the inaccessible chain's count/IDs.
ALTER FUNCTION research_source_visible(text,text) RENAME TO research_source_visible_pre_github;
CREATE FUNCTION research_source_visible(ws text,sid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH RECURSIVE lineage(id,parent_snapshot_id) AS (
   SELECT id,parent_snapshot_id FROM source_snapshots WHERE workspace_id=ws AND id=sid
   UNION
   SELECT s.id,s.parent_snapshot_id FROM source_snapshots s JOIN lineage l ON s.id=l.parent_snapshot_id
    WHERE s.workspace_id=ws
 )
 SELECT EXISTS(SELECT 1 FROM lineage) AND NOT EXISTS(
   SELECT 1 FROM lineage WHERE NOT research_source_visible_pre_github(ws,id))
$$;
