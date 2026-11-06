-- Opt-in reuse of exact settled outputs in the producing run. No grant/receipt
-- rewrite, ambient conversation access, URL discovery authority or budget change.
-- Source reduction must also hide previously captured copies, not just prevent
-- another fetch. Compare original selectors directly to avoid recursive output
-- authorization when a later tool consumes the capture.
ALTER FUNCTION research_attempt_visible(text,text) RENAME TO research_attempt_visible_pre_run_outputs;
CREATE FUNCTION research_attempt_visible(ws text,aid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT research_attempt_visible_pre_run_outputs(ws,aid) AND NOT EXISTS(
   SELECT 1 FROM tool_attempts a JOIN tool_grants g ON g.id=a.grant_id
   WHERE a.workspace_id=ws AND a.id=aid AND a.capability_id='research.capture'
     AND (NOT tool_run_available(ws,a.run_id)
       OR NOT (g.data->'resource_selectors' @> (a.call->'input_refs'))
       OR EXISTS(SELECT 1 FROM tool_scope_reductions sr WHERE sr.grant_id=g.id
          AND a.call->'input_refs' @> jsonb_build_array(sr.selector))))
$$;

CREATE FUNCTION tool_run_output_resources(ws text,rid text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE g tool_grants; r runs; a tool_attempts; obs jsonb; f workspace_files;
 v revisions; s source_snapshots; refs jsonb='[]'::jsonb;
BEGIN
 SELECT * INTO g FROM tool_grants WHERE workspace_id=ws AND run_id=rid;
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=rid;
 IF g.data->'allow_run_outputs' IS DISTINCT FROM 'true'::jsonb OR NOT g.active
    OR NOT tool_run_available(ws,rid) OR r.data->>'state'='cancelled' THEN RETURN refs; END IF;
 -- No laundering a revoked source through another output of the same run.
 IF EXISTS(SELECT 1 FROM tool_attempts ta JOIN tool_attempt_events e ON e.attempt_id=ta.id AND e.kind='observation'
     WHERE ta.workspace_id=ws AND ta.run_id=rid AND ta.capability_id='research.capture'
       AND e.data->>'status'='observed' AND nullif(e.data->'output'->'result'->'snapshot','null'::jsonb) IS NOT NULL
       AND NOT research_source_visible(ws,ta.id)) THEN RETURN refs; END IF;
 FOR a IN SELECT * FROM tool_attempts WHERE workspace_id=ws AND run_id=rid AND grant_id=g.id
     AND capability_id IN ('files.create_draft','research.capture') ORDER BY id LOOP
   SELECT data INTO obs FROM tool_attempt_events WHERE attempt_id=a.id AND kind='observation';
   IF obs->>'status' IS DISTINCT FROM 'observed'
      OR NOT (g.data->'resource_selectors' @> (a.call->'input_refs'))
      OR EXISTS(SELECT 1 FROM tool_scope_reductions sr WHERE sr.grant_id=g.id
         AND a.call->'input_refs' @> jsonb_build_array(sr.selector)) THEN CONTINUE; END IF;
   IF a.capability_id='files.create_draft' THEN
     SELECT * INTO f FROM workspace_files WHERE workspace_id=ws AND id=a.id AND artifact_id=a.id
       AND owner_id=r.data->>'principal_id' AND conversation_id=r.conversation_id;
     SELECT vr.* INTO v FROM revisions vr JOIN artifacts art ON art.workspace_id=vr.workspace_id
       AND art.id=vr.artifact_id AND art.current_revision_id=vr.id
       WHERE vr.workspace_id=ws AND vr.artifact_id=f.artifact_id AND vr.revision_number=1
       AND vr.data->>'author_kind'='worker';
     IF f.id IS NOT NULL AND v.id IS NOT NULL
        AND obs->'output'->'result'->>'workspace_file_id'=f.id
        AND obs->'output'->'result'->'current'->>'version_id'=v.id
        AND obs->'output'->'result'->'current'->>'sha256'=v.data->'body'->>'content_sha256'
        AND v.data->'body'->>'content'=a.call->'arguments'->'source'->>'content'
        AND v.data->'body'->>'content_sha256'=a.call->'arguments'->'source'->>'sha256'
        AND memory_revision_visible(ws,f.artifact_id,v.id) THEN
       refs=refs||jsonb_build_array(
         jsonb_build_object('kind','workspace_file','id',f.id,'version',v.id,'sha256',v.data->'body'->>'content_sha256'),
         jsonb_build_object('kind','artifact_revision','id',f.artifact_id,'version',v.id,'sha256',v.data->>'body_hash'));
     END IF;
   ELSE
     SELECT ss.* INTO s FROM source_snapshots ss JOIN workspace_files wf
       ON wf.workspace_id=ss.workspace_id AND wf.id=ss.workspace_file_id
       WHERE ss.workspace_id=ws AND ss.id=a.id AND wf.owner_id=r.data->>'principal_id'
       AND wf.conversation_id=r.conversation_id AND ss.data->'locator'->>'kind'='public_source'
       AND ss.data->'locator'->>'run_id'=rid;
     IF s.id IS NOT NULL AND obs->'output'->'result'->'snapshot'=s.data
        AND research_source_visible(ws,s.id) THEN
       refs=refs||jsonb_build_array(jsonb_build_object('kind','workspace_file','id',s.workspace_file_id,
         'version',s.id,'sha256',s.data->>'extraction_sha256'));
     END IF;
   END IF;
 END LOOP;
 RETURN refs;
END $$;

CREATE FUNCTION tool_effective_resources(ws text,rid text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT jsonb_agg(ref) FROM tool_grants g
   CROSS JOIN LATERAL jsonb_array_elements(g.data->'resource_selectors') ref
   WHERE g.workspace_id=ws AND g.run_id=rid AND NOT EXISTS(
     SELECT 1 FROM tool_scope_reductions sr WHERE sr.grant_id=g.id AND sr.selector=ref)), '[]'::jsonb)
   || tool_run_output_resources(ws,rid)
$$;

-- Preserve all existing exact-reference/scope/lease/descriptor/price guards.
-- Only the selector-membership term changes, in reserve and file/research checks.
DO $$ DECLARE name text; definition text; old text=$q$(g.data->'resource_selectors')$q$;
BEGIN
 FOREACH name IN ARRAY ARRAY['reserve_tool_call(text,text,integer,text,jsonb,text)',
     'tool_native_file_resources_authorized(text,text,jsonb)',
     'tool_pre_office_resources_authorized(text,text,jsonb)'] LOOP
   definition=pg_get_functiondef(name::regprocedure);
   IF position(old in definition)=0 THEN RAISE EXCEPTION 'run-output predecessor drift: %',name; END IF;
   EXECUTE replace(definition,old,'public.tool_effective_resources(ws,rid)');
 END LOOP;
END $$;

-- Closed opt-in type even for an owner-installed SQL payload; legacy omission is
-- false. Existing rows are untouched and stay exact-selector-only.
CREATE FUNCTION guard_run_output_option() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.data ? 'allow_run_outputs' AND jsonb_typeof(NEW.data->'allow_run_outputs') IS DISTINCT FROM 'boolean'
 THEN RAISE EXCEPTION 'boolean run-output option required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER run_output_option BEFORE INSERT ON tool_grants FOR EACH ROW EXECUTE FUNCTION guard_run_output_option();
