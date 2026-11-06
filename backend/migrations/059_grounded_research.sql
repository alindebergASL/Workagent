-- B3.2a: immutable public sources on existing file/blob stores; attribution only.
-- Successful empty public bodies are evidence of empty coverage, not fetch errors.
ALTER TABLE generated_blobs DROP CONSTRAINT generated_blobs_bytes_check;
ALTER TABLE generated_blobs ADD CHECK(octet_length(bytes) BETWEEN 0 AND 1048576);

CREATE FUNCTION research_selector(kind text,value text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('kind',kind,'id',encode(sha256(convert_to(value,'UTF8')),'hex'),
   'version','1','sha256',encode(sha256(convert_to(value,'UTF8')),'hex'))
$$;

CREATE FUNCTION research_attempt_visible(ws text,aid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation'
 JOIN tool_grants g ON g.id=a.grant_id JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
 JOIN workspaces w ON w.id=a.workspace_id JOIN conversations cv ON cv.workspace_id=r.workspace_id AND cv.id=r.conversation_id
 JOIN memberships m ON m.workspace_id=w.id AND m.principal_id=r.data->>'principal_id'
 WHERE a.workspace_id=ws AND a.id=aid AND e.data->>'status'='observed' AND g.active
 AND (g.data->>'access_generation')::bigint=w.access_generation
 AND m.active AND r.data->>'state'<>'cancelled' AND cv.data->>'state' NOT IN ('paused','cancelled'))
$$;

CREATE FUNCTION research_source_visible(ws text,sid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT CASE WHEN s.data->'locator'->>'kind'<>'public_source' THEN true ELSE
 research_attempt_visible(ws,s.data->'locator'->>'tool_attempt_id') AND EXISTS(
 SELECT 1 FROM tool_attempt_events e WHERE e.attempt_id=s.data->'locator'->>'tool_attempt_id'
 AND e.kind='observation' AND e.data->'output'->'result'->'snapshot'=s.data) END
 FROM source_snapshots s WHERE s.workspace_id=ws AND s.id=sid),false)
$$;

ALTER FUNCTION tool_file_resources_authorized(text,text,jsonb) RENAME TO tool_pre_research_resources_authorized;
CREATE FUNCTION tool_file_resources_authorized(ws text,rid text,payload jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE args jsonb; expected jsonb; kind text; g tool_grants; r runs; q jsonb; s source_snapshots;
 target jsonb; cfg jsonb; actual text;
BEGIN
 kind=payload->>'capability_id'; args=payload->'arguments';
 IF kind NOT IN ('research.search','research.capture','research.cite') THEN
   RETURN tool_pre_research_resources_authorized(ws,rid,payload);
 END IF;
 SELECT * INTO g FROM tool_grants WHERE workspace_id=ws AND run_id=rid AND active;
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=rid;
 IF g.id IS NULL OR r.conversation_id IS NULL THEN RETURN false; END IF;
 IF args->>'kind' IS DISTINCT FROM replace(kind,'.','_') THEN RETURN false; END IF;
 SELECT data->'target' INTO target FROM conversation_messages WHERE workspace_id=ws AND conversation_id=r.conversation_id
   AND run_id=rid AND author_kind IN ('human','system') ORDER BY sequence LIMIT 1;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=ws AND run_id=rid;
 IF kind IN ('research.search','research.capture') THEN
   IF g.data->>'egress' IS DISTINCT FROM 'public_https' OR cfg ? 'responsibility'
      OR nullif(target,'null'::jsonb) IS NOT NULL THEN RETURN false; END IF;
   IF kind='research.search' THEN
     IF octet_length(args->>'query') NOT BETWEEN 1 AND 16000 THEN RETURN false; END IF;
     expected=jsonb_build_array(research_selector('search_query',args->>'query'),
       research_selector('processor','deterministic-http-search-fixture-v1'));
   ELSE
     IF args->>'url' !~ '^https://[^/@[:space:]]+/' OR length(args->>'url')>2048 THEN RETURN false; END IF;
     expected=jsonb_build_array(research_selector('public_url',args->>'url'),
       research_selector('processor','public-https-static-v1'||CASE WHEN (args->>'allow_browser')::boolean THEN '-browser' ELSE '' END));
   END IF;
 ELSE
   IF jsonb_typeof(args->'evidence') IS DISTINCT FROM 'array' OR jsonb_array_length(args->'evidence')>20 THEN RETURN false; END IF;
   SELECT vr.data->>'body_hash' INTO actual FROM revisions vr JOIN artifacts a
      ON a.workspace_id=vr.workspace_id AND a.id=vr.artifact_id
      WHERE vr.workspace_id=ws AND vr.id=args->>'revision_id' AND a.id=args->>'artifact_id'
      AND a.current_revision_id=vr.id AND a.conversation_id=r.conversation_id;
   IF actual IS NULL OR actual IS DISTINCT FROM args->>'body_hash' THEN RETURN false; END IF;
   IF nullif(target,'null'::jsonb) IS NOT NULL AND target->>'artifact_id' IS DISTINCT FROM args->>'artifact_id' THEN RETURN false; END IF;
   IF cfg ? 'responsibility' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cfg->'responsibility'->'observations') d
       WHERE d->>'kind'='artifact_revision' AND d->>'object_id'=args->>'artifact_id') THEN RETURN false; END IF;
   expected=jsonb_build_array(jsonb_build_object('kind','artifact_revision','id',args->>'artifact_id',
      'version',args->>'revision_id','sha256',args->>'body_hash'));
   FOR q IN SELECT value FROM jsonb_array_elements(args->'evidence') LOOP
     SELECT ss.* INTO s FROM source_snapshots ss JOIN workspace_files f ON f.workspace_id=ss.workspace_id AND f.id=ss.workspace_file_id
       WHERE ss.workspace_id=ws AND ss.id=q->>'snapshot_id' AND f.id=q->>'workspace_file_id'
       AND f.owner_id=r.data->>'principal_id' AND f.conversation_id=r.conversation_id;
     -- Initial cite capability uses public captured text. Original attachment
     -- originals are not copied; attachment citations remain a later extension.
     IF s.id IS NULL OR s.data->'locator'->>'kind' IS DISTINCT FROM 'public_source'
       OR NOT research_source_visible(ws,s.id)
       OR s.data->>'extraction_sha256' IS DISTINCT FROM q->>'text_sha256'
       OR (q->>'start')::integer<0 OR (q->>'end')::integer<=(q->>'start')::integer
       OR length(q->>'quote')<>(q->>'end')::integer-(q->>'start')::integer
       OR substring(s.data->'locator'->>'text' FROM (q->>'start')::integer+1 FOR (q->>'end')::integer-(q->>'start')::integer) IS DISTINCT FROM q->>'quote'
       OR q->>'relation' NOT IN ('supports','contradicts','context') THEN RETURN false; END IF;
     expected=expected||jsonb_build_array(jsonb_build_object('kind','workspace_file','id',q->>'workspace_file_id',
        'version',q->>'snapshot_id','sha256',q->>'text_sha256'));
   END LOOP;
 END IF;
 RETURN coalesce(payload->'input_refs'=expected AND (g.data->'resource_selectors') @> expected,false);
END $$;

CREATE FUNCTION research_publication_authorized(ws text,aid text,owner text,kind text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE a tool_attempts; r runs; d jsonb;
BEGIN
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 SELECT * INTO a FROM tool_attempts WHERE workspace_id=ws AND id=aid AND capability_id=kind;
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=a.run_id;
 SELECT descriptor INTO d FROM capability_installations WHERE id=a.capability_id AND version=a.capability_version AND enabled;
 RETURN coalesce(a.id IS NOT NULL AND r.data->>'principal_id'=owner
   AND tool_authorized(ws,a.run_id,a.run_fence,a.lease_hash,a.grant_id,(a.call->>'expected_work_version')::bigint)
   AND tool_file_resources_authorized(ws,a.run_id,a.call) AND a.scope_sha256=tool_scope_hash(ws,a.run_id)
   AND a.descriptor=d AND EXISTS(SELECT 1 FROM tool_attempt_events ev WHERE ev.attempt_id=aid AND ev.kind='dispatch')
   AND NOT EXISTS(SELECT 1 FROM tool_attempt_events ev WHERE ev.attempt_id=aid AND ev.kind='observation'),false);
END $$;

-- Extend existing source guard without changing original attachment/document rules.
DO $$ DECLARE definition text; old text;
BEGIN
 definition=pg_get_functiondef('guard_source_snapshot()'::regprocedure);
 old=$q$ IF NEW.data->'locator'->>'kind'='document' THEN$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'source guard predecessor drift'; END IF;
 EXECUTE replace(definition,old,$q$
 IF NEW.data->'locator'->>'kind'='public_source' THEN
   IF NEW.id IS DISTINCT FROM NEW.data->'locator'->>'tool_attempt_id'
     OR NOT research_publication_authorized(NEW.workspace_id,NEW.id,f.owner_id,'research.capture')
     OR NOT EXISTS(SELECT 1 FROM tool_attempts a JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
       WHERE a.id=NEW.id AND a.workspace_id=NEW.workspace_id AND a.run_id=NEW.data->'locator'->>'run_id'
       AND r.conversation_id=f.conversation_id AND a.call->'arguments'->>'url'=NEW.data->'locator'->>'url')
     OR NEW.data->>'parser_version' IS DISTINCT FROM NEW.data->'locator'->>'extractor_version'
     OR NEW.data->'coverage' IS DISTINCT FROM NEW.data->'locator'->'coverage'
     OR NEW.data->'omissions' IS DISTINCT FROM NEW.data->'locator'->'coverage'->'omissions'
     OR NEW.data->>'extraction_status' IS DISTINCT FROM NEW.data->'locator'->>'extraction_status'
   THEN RAISE EXCEPTION 'exact authorized public capture required'; END IF;
   IF previous.id IS NOT NULL AND previous.data->'locator'->>'url' IS DISTINCT FROM NEW.data->'locator'->>'url'
   THEN RAISE EXCEPTION 'same source URL required'; END IF;
   SELECT b.bytes INTO original FROM generated_blobs b WHERE b.workspace_id=NEW.workspace_id
     AND b.owner_id=f.owner_id AND b.id=NEW.data->'locator'->>'blob_id'
     AND b.mime_type=NEW.data->'locator'->>'mime_type';
   extraction=convert_to(NEW.data->'locator'->>'text','UTF8');
   IF NEW.data->'locator'->>'text_sha256' IS DISTINCT FROM encode(sha256(extraction),'hex')
   THEN RAISE EXCEPTION 'exact extraction hash required'; END IF;
 ELSIF NEW.data->'locator'->>'kind'='document' THEN$q$);
END $$;

CREATE TABLE research_claims (
 workspace_id text NOT NULL, id text NOT NULL, artifact_id text NOT NULL, revision_id text NOT NULL,
 owner_id text NOT NULL, tool_attempt_id text NOT NULL UNIQUE REFERENCES tool_attempts(id), data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_id,revision_id) REFERENCES revisions(workspace_id,artifact_id,id),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,principal_id)
);
CREATE FUNCTION guard_research_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a tool_attempts; r runs; semantic text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'immutable research claim'; END IF;
 SELECT * INTO a FROM tool_attempts WHERE id=NEW.tool_attempt_id;
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=a.run_id;
 semantic=CASE WHEN jsonb_array_length(a.call->'arguments'->'evidence')=0 THEN 'unsupported'
  WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(a.call->'arguments'->'evidence') q WHERE q->>'relation'='supports')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.call->'arguments'->'evidence') q WHERE q->>'relation'='contradicts') THEN 'conflict'
  ELSE 'not_assessed' END;
 IF NOT research_publication_authorized(NEW.workspace_id,NEW.tool_attempt_id,NEW.owner_id,'research.cite')
   OR NEW.id IS DISTINCT FROM a.id OR NEW.data->>'claim_id' IS DISTINCT FROM NEW.id
   OR NEW.data->>'workspace_id' IS DISTINCT FROM NEW.workspace_id OR NEW.data->>'run_id' IS DISTINCT FROM a.run_id
   OR NEW.data->>'tool_attempt_id' IS DISTINCT FROM a.id OR NEW.data->>'conversation_id' IS DISTINCT FROM r.conversation_id
   OR NEW.data->>'artifact_id' IS DISTINCT FROM NEW.artifact_id OR NEW.data->>'revision_id' IS DISTINCT FROM NEW.revision_id
   OR NEW.data->>'semantic_status' IS DISTINCT FROM semantic OR NEW.data->>'attribution' IS DISTINCT FROM 'exact_quotes_only'
   OR NEW.data-ARRAY['claim_id','workspace_id','conversation_id','run_id','tool_attempt_id','created_at','attribution','semantic_status']
      IS DISTINCT FROM (a.call->'arguments')-'kind'
 THEN RAISE EXCEPTION 'exact pinned claim required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_research_claim BEFORE INSERT OR UPDATE OR DELETE ON research_claims FOR EACH ROW EXECUTE FUNCTION guard_research_claim();
CREATE FUNCTION research_claim_visible(ws text,cid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM research_claims c JOIN tool_attempt_events e ON e.attempt_id=c.tool_attempt_id AND e.kind='observation'
 WHERE c.workspace_id=ws AND c.id=cid AND research_attempt_visible(ws,c.tool_attempt_id) AND e.data->'output'->'result'=c.data)
$$;
REVOKE ALL ON research_claims FROM PUBLIC;
DO $$ DECLARE r record;
BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants WHERE table_schema='public'
 AND table_name='source_snapshots' AND privilege_type='INSERT' AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP EXECUTE format('GRANT SELECT,INSERT ON research_claims TO %I',r.grantee); END LOOP;
END $$;

DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['guard_tool_consumption()','guard_alpha_stage()','guard_file_tool_stage()'] LOOP
  definition=pg_get_functiondef(name::regprocedure); old=$q$'compute_python'$q$;
  IF position(old in definition)=0 THEN RAISE EXCEPTION 'research operation predecessor drift'; END IF;
  EXECUTE replace(definition,old,old||$q$,'research_search','research_capture','research_cite'$q$);
 END LOOP;
END $$;

DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['require_run_successor(runs,jsonb)','guard_retained_result_read()'] LOOP
  definition=pg_get_functiondef(name::regprocedure);
  old=$q$'b9f18beb013a8cd3f102959bf15a9fa290fbee43281077edc6e71abc547e5d61'$q$;
  IF position(old in definition)=0 THEN RAISE EXCEPTION 'research schema predecessor drift'; END IF;
  EXECUTE replace(definition,old,old||$q$,'0151c7907a62b707652f014ae0883bf8f9934670d3c7819651e2feb4b91fd432'$q$);
 END LOOP;
END $$;
