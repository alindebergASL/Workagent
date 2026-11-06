-- Versioned native file adapters, exact resource resolution and opt-in selection.
-- Historical installed descriptors/grants and frozen legacy catalogs are untouched.
CREATE FUNCTION tool_file_resources_authorized(ws text,rid text,payload jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r runs; g tool_grants; cfg jsonb; args jsonb; refs jsonb; ref jsonb; f workspace_files;
 target jsonb; actual text; art artifacts; expected jsonb; kind text;
BEGIN
 kind=payload->>'capability_id';
 IF kind NOT IN ('files.list','files.read_range','files.create_draft','files.propose_patch','files.compare','artifacts.export') THEN RETURN true; END IF;
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=rid;
 SELECT * INTO g FROM tool_grants WHERE workspace_id=ws AND run_id=rid;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=ws AND run_id=rid;
 IF r.conversation_id IS NULL OR g.id IS NULL THEN RETURN false; END IF;
 SELECT data->'target' INTO target FROM conversation_messages WHERE workspace_id=ws AND conversation_id=r.conversation_id AND run_id=rid
   AND author_kind IN ('human','system') ORDER BY sequence LIMIT 1;
 args=payload->'arguments'; refs=payload->'input_refs';
 IF kind IN ('files.list','files.create_draft') THEN expected='[]'::jsonb;
 ELSIF kind IN ('files.read_range','files.propose_patch') THEN
   expected=jsonb_build_array(jsonb_build_object('kind','workspace_file','id',args->'ref'->>'workspace_file_id',
      'version',args->'ref'->>'version_id','sha256',args->'ref'->>'sha256'));
 ELSIF kind='files.compare' THEN
   expected=jsonb_build_array(jsonb_build_object('kind','workspace_file','id',args->'left'->>'workspace_file_id',
      'version',args->'left'->>'version_id','sha256',args->'left'->>'sha256'),
      jsonb_build_object('kind','workspace_file','id',args->'right'->>'workspace_file_id',
      'version',args->'right'->>'version_id','sha256',args->'right'->>'sha256'));
   IF args->'left'->>'workspace_file_id' IS DISTINCT FROM args->'right'->>'workspace_file_id' THEN RETURN false; END IF;
 ELSE expected=jsonb_build_array(args->'input_ref'); END IF;
 IF refs IS DISTINCT FROM expected OR NOT coalesce((g.data->'resource_selectors') @> refs,false) THEN RETURN false; END IF;
 IF kind='files.create_draft' AND (cfg ? 'responsibility' OR nullif(target,'null'::jsonb) IS NOT NULL) THEN RETURN false; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
   actual=NULL; art=NULL;
   IF ref->>'kind'='workspace_file' THEN
     SELECT * INTO f FROM workspace_files WHERE workspace_id=ws AND id=ref->>'id'
       AND conversation_id=r.conversation_id AND owner_id=r.data->>'principal_id';
     IF f.id IS NULL THEN RETURN false; END IF;
     IF f.artifact_id IS NOT NULL THEN
       SELECT * INTO art FROM artifacts WHERE workspace_id=ws AND id=f.artifact_id;
       SELECT data->'body'->>'content_sha256' INTO actual FROM revisions WHERE workspace_id=ws
         AND artifact_id=f.artifact_id AND id=ref->>'version';
       IF kind='files.propose_patch' AND art.current_revision_id IS DISTINCT FROM ref->>'version' THEN RETURN false; END IF;
     ELSE
       IF kind='files.propose_patch' THEN RETURN false; END IF;
       SELECT data->>'extraction_sha256' INTO actual FROM source_snapshots WHERE workspace_id=ws
         AND workspace_file_id=f.id AND id=ref->>'version';
     END IF;
   ELSIF ref->>'kind'='artifact_revision' AND kind='artifacts.export' THEN
     SELECT * INTO art FROM artifacts WHERE workspace_id=ws AND id=ref->>'id' AND conversation_id=r.conversation_id;
     IF art.id IS NULL THEN RETURN false; END IF;
     SELECT data->>'body_hash' INTO actual FROM revisions WHERE workspace_id=ws AND artifact_id=art.id AND id=ref->>'version';
   ELSE RETURN false; END IF;
   IF actual IS NULL OR actual IS DISTINCT FROM ref->>'sha256' THEN RETURN false; END IF;
   IF nullif(target,'null'::jsonb) IS NOT NULL AND art.id IS DISTINCT FROM target->>'artifact_id' THEN RETURN false; END IF;
   IF cfg ? 'responsibility' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cfg->'responsibility'->'observations') d
        WHERE d->>'kind'='artifact_revision' AND d->>'object_id'=art.id) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

DO $$ DECLARE definition text;
BEGIN
 definition=pg_get_functiondef('reserve_tool_call(text,text,integer,text,jsonb,text)'::regprocedure);
 definition=replace(definition,' SELECT * INTO prior FROM public.tool_attempts',
   ' IF NOT public.tool_file_resources_authorized(ws,rid,payload) THEN RAISE EXCEPTION ''exact tool resources required''; END IF; SELECT * INTO prior FROM public.tool_attempts');
 EXECUTE definition;
 definition=pg_get_functiondef('dispatch_tool_call(text,integer,text,text)'::regprocedure);
 definition=replace(definition,' IF NOT public.tool_authorized(',
   ' IF NOT public.tool_file_resources_authorized(a.workspace_id,a.run_id,a.call) OR NOT public.tool_authorized(');
 EXECUTE definition;
 definition=pg_get_functiondef('settle_tool_call(text,text,jsonb)'::regprocedure);
 definition=replace(definition,'live=public.tool_authorized(',
   'live=public.tool_file_resources_authorized(a.workspace_id,a.run_id,a.call) AND public.tool_authorized(');
 EXECUTE definition;
END $$;

-- A newly created draft is an attributable output, not a change to frozen inputs.
-- Only this run's exact attempt-ID artifact at its untouched first worker revision
-- is excluded. A later human edit re-enters the fingerprint and fences the run.
DO $$ DECLARE definition text; predicate text;
BEGIN
 definition=pg_get_functiondef('checkpoint_scope_fingerprint(runs,jsonb)'::regprocedure);
 definition=replace(definition,'checkpoint_scope_fingerprint','file_tool_scope_fingerprint');
 predicate=$fragment$AND NOT EXISTS (
   SELECT 1 FROM tool_attempts ta JOIN revisions vr ON vr.workspace_id=ta.workspace_id AND vr.artifact_id=ta.id
   JOIN workspace_files wf ON wf.workspace_id=ta.workspace_id AND wf.artifact_id=ta.id
   WHERE ta.workspace_id=r.workspace_id AND ta.run_id=r.id AND ta.capability_id='files.create_draft'
     AND ta.id=art.id AND vr.id=art.current_revision_id AND vr.revision_number=1
     AND vr.data->>'author_kind'='worker' AND wf.owner_id=r.data->>'principal_id'
     AND vr.data->'body'->>'content'=ta.call->'arguments'->'source'->>'content'
     AND vr.data->'body'->>'content_sha256'=ta.call->'arguments'->'source'->>'sha256'
     AND wf.filename=ta.call->'arguments'->'source'->>'filename'
     AND wf.mime_type=ta.call->'arguments'->'source'->>'mime_type')
 $fragment$;
 definition=replace(definition,$q$AND (NOT cfg ? 'responsibility'$q$,predicate||$q$AND (NOT cfg ? 'responsibility'$q$);
 EXECUTE definition;
 definition=pg_get_functiondef('tool_scope_hash(text,text)'::regprocedure);
 EXECUTE replace(definition,'checkpoint_scope_fingerprint','file_tool_scope_fingerprint');
END $$;

-- Extend the opted-in consumption allowlist and its exact observation requirement
-- together. The legacy selection schemas/catalogs have not gained these tools.
DO $$ DECLARE definition text; old text; extended text;
BEGIN
 old=$x$'read_context','inspect_json','fetch_public_url','discover_capabilities','load_skill'$x$;
 extended=old||$x$,'files_list','files_read_range','files_create_draft','files_propose_patch','files_compare','artifacts_export'$x$;
 definition=pg_get_functiondef('guard_tool_consumption()'::regprocedure);
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'gateway predecessor drift'; END IF;
 EXECUTE replace(definition,old,extended);
 definition=pg_get_functiondef('guard_alpha_stage()'::regprocedure);
 old=$x$'discover_capabilities','load_skill','read_context','read_saved_work','discover_saved_work'$x$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'composition predecessor drift'; END IF;
 EXECUTE replace(definition,old,old||$x$,'files_list','files_read_range','files_create_draft','files_propose_patch','files_compare','artifacts_export'$x$);
END $$;

-- File decisions are never stageable outside the installed gateway, including a
-- caller that supplies the new decision shape to an otherwise legacy run.
CREATE FUNCTION guard_file_tool_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; a tool_attempts; obs jsonb; selected jsonb;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 IF coalesce(NEW.data->'decision'->>'kind','') NOT IN
   ('files_list','files_read_range','files_create_draft','files_propose_patch','files_compare','artifacts_export')
   AND coalesce(NEW.data->'capability_result'->>'capability','') NOT IN
   ('files_list','files_read_range','files_create_draft','files_propose_patch','files_compare','artifacts_export')
 THEN RETURN NEW; END IF;
 SELECT rr.* INTO r FROM runs rr JOIN provider_attempts pa ON pa.workspace_id=rr.workspace_id AND pa.run_id=rr.id WHERE pa.id=NEW.attempt_id;
 PERFORM id FROM workspaces WHERE id=r.workspace_id FOR UPDATE;
 SELECT * INTO a FROM tool_attempts WHERE workspace_id=r.workspace_id AND run_id=r.id AND call_id=NEW.phase;
 SELECT data INTO obs FROM tool_attempt_events WHERE attempt_id=a.id AND kind='observation';
 SELECT data->'value'->'decision' INTO selected FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF a.id IS NULL OR NOT tool_run_available(r.workspace_id,r.id)
   OR NOT tool_file_resources_authorized(r.workspace_id,r.id,a.call)
   OR a.call->'arguments' IS DISTINCT FROM selected OR NEW.data->'decision' IS DISTINCT FROM selected
   OR obs->>'status' IS DISTINCT FROM 'observed' OR obs->'output' IS DISTINCT FROM NEW.data->'capability_result'
 THEN RAISE EXCEPTION 'exact scoped file tool observation required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_file_tool_stage BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION guard_file_tool_stage();

-- Explicit additional sustained schema, preserving predecessor semantics.
DO $$ DECLARE definition text; name text; old text; replacement text;
BEGIN
 old=$q$cfg->'responses'->>'scope_tool_sha256' IS DISTINCT FROM '291bff85aa0ab207c3a148c94430ee49dcf5b164af9121032f859d481cdf0a4e'$q$;
 replacement=$q$coalesce(cfg->'responses'->>'scope_tool_sha256','') NOT IN ('291bff85aa0ab207c3a148c94430ee49dcf5b164af9121032f859d481cdf0a4e','367cd20e751544b98b18717718f63f37b5221e551afdc7537dfbb239e2ff896f')$q$;
 FOREACH name IN ARRAY ARRAY['require_run_successor(runs,jsonb)','guard_retained_result_read()'] LOOP
  definition=pg_get_functiondef(name::regprocedure);
  IF position(old in definition)=0 THEN RAISE EXCEPTION 'sustained schema predecessor drift'; END IF;
  EXECUTE replace(definition,old,replacement);
 END LOOP;
END $$;
