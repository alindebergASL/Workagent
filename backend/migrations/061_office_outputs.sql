-- B3.2b: no duplicate originals. Immutable file metadata binds editable revisions.
ALTER TABLE workspace_files ADD COLUMN office_source_snapshot_id text;
ALTER TABLE workspace_files ADD CONSTRAINT office_source_ref
 FOREIGN KEY(workspace_id,office_source_snapshot_id) REFERENCES source_snapshots(workspace_id,id);
ALTER TABLE workspace_files ADD CONSTRAINT office_source_working_file
 CHECK(office_source_snapshot_id IS NULL OR (artifact_id IS NOT NULL AND mime_type='application/json'));

CREATE FUNCTION guard_office_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_snapshots; f workspace_files;
BEGIN
 IF NEW.office_source_snapshot_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO s FROM source_snapshots WHERE workspace_id=NEW.workspace_id AND id=NEW.office_source_snapshot_id;
 SELECT * INTO f FROM workspace_files WHERE workspace_id=NEW.workspace_id AND id=s.workspace_file_id;
 IF s.id IS NULL OR f.artifact_id IS NOT NULL OR f.owner_id IS DISTINCT FROM NEW.owner_id
    OR f.conversation_id IS DISTINCT FROM NEW.conversation_id
    OR s.data->'locator'->>'kind' IS DISTINCT FROM 'document'
 THEN RAISE EXCEPTION 'same-owner original office snapshot required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_office_source BEFORE INSERT ON workspace_files FOR EACH ROW EXECUTE FUNCTION guard_office_source();

-- Original owner/scope/source authorization also applies through artifact aliases.
CREATE FUNCTION office_source_visible(ws text,who text,sid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM source_snapshots s
 JOIN workspace_files f ON f.workspace_id=s.workspace_id AND f.id=s.workspace_file_id
 JOIN conversations cv ON cv.workspace_id=f.workspace_id AND cv.id=f.conversation_id
 JOIN memberships m ON m.workspace_id=f.workspace_id AND m.principal_id=who AND m.active
 JOIN conversation_documents d ON d.workspace_id=s.workspace_id AND d.id=s.data->'locator'->>'document_id'
 WHERE s.workspace_id=ws AND s.id=sid AND f.owner_id=who AND d.owner_id=who
 AND d.conversation_id=f.conversation_id AND cv.data->>'owner_id'=who
 AND d.data->>'sha256'=s.data->>'original_sha256'
 AND work_refs_visible(ws,who,cv.data->'selected_source_refs'))
$$;
ALTER FUNCTION work_artifact_visible(text,text,text,text) RENAME TO work_artifact_visible_pre_office;
CREATE FUNCTION work_artifact_visible(ws text,who text,cid text,aid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT work_artifact_visible_pre_office(ws,who,cid,aid) AND NOT EXISTS(
 SELECT 1 FROM workspace_files f WHERE f.workspace_id=ws AND f.artifact_id=aid
 AND f.office_source_snapshot_id IS NOT NULL AND NOT office_source_visible(ws,who,f.office_source_snapshot_id))
$$;

-- Extend only the existing format constraint, preserving compute/history guards.
DO $$ DECLARE r record;
BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='artifact_exports'::regclass
 AND contype='c' AND pg_get_constraintdef(oid) LIKE '%format%' LOOP
 EXECUTE format('ALTER TABLE artifact_exports DROP CONSTRAINT %I',r.conname);
 END LOOP;
END $$;
ALTER TABLE artifact_exports ADD CONSTRAINT artifact_export_manifest CHECK(
 (data->>'export_id'=id AND data->>'workspace_id'=workspace_id
 AND data->'blob'->>'blob_id'=blob_id AND data->'blob'->>'kind'='generated_blob'
 AND data->>'format' IN ('txt','markdown','csv','json','docx','xlsx','pdf','png')) IS TRUE);

ALTER FUNCTION tool_file_resources_authorized(text,text,jsonb) RENAME TO tool_pre_office_resources_authorized;
CREATE FUNCTION tool_file_resources_authorized(ws text,rid text,payload jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE mapped jsonb; ref jsonb; f workspace_files; who text;
BEGIN
 mapped=payload;
 IF payload->>'capability_id'='artifacts.export.office' THEN
   IF payload->'arguments'->>'kind' IS DISTINCT FROM 'artifacts_export_office' THEN RETURN false; END IF;
   mapped=jsonb_set(payload,'{capability_id}','"artifacts.export"');
 END IF;
 IF NOT tool_pre_office_resources_authorized(ws,rid,mapped) THEN RETURN false; END IF;
 SELECT data->>'principal_id' INTO who FROM runs WHERE workspace_id=ws AND id=rid;
 FOR ref IN SELECT value FROM jsonb_array_elements(payload->'input_refs') LOOP
   SELECT * INTO f FROM workspace_files WHERE workspace_id=ws
    AND ((ref->>'kind'='workspace_file' AND id=ref->>'id') OR
         (ref->>'kind'='artifact_revision' AND artifact_id=ref->>'id'));
   IF f.office_source_snapshot_id IS NOT NULL AND NOT office_source_visible(ws,who,f.office_source_snapshot_id)
   THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['guard_tool_consumption()','guard_alpha_stage()','guard_file_tool_stage()'] LOOP
  definition=pg_get_functiondef(name::regprocedure); old=$q$'artifacts_export'$q$;
  IF position(old in definition)=0 THEN RAISE EXCEPTION 'office operation predecessor drift'; END IF;
  EXECUTE replace(definition,old,old||$q$,'artifacts_export_office'$q$);
 END LOOP;
END $$;

DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['require_run_successor(runs,jsonb)','guard_retained_result_read()'] LOOP
  definition=pg_get_functiondef(name::regprocedure);
  old=$q$'0151c7907a62b707652f014ae0883bf8f9934670d3c7819651e2feb4b91fd432'$q$;
  IF position(old in definition)=0 THEN RAISE EXCEPTION 'office schema predecessor drift'; END IF;
  EXECUTE replace(definition,old,old||$q$,'37829a6d55e1b241a3eec67c51a928642fcff5597e51c6152432474beea95337'$q$);
 END LOOP;
END $$;

CREATE FUNCTION guard_office_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f workspace_files; v jsonb;
BEGIN
 SELECT * INTO f FROM workspace_files WHERE workspace_id=NEW.workspace_id AND artifact_id=NEW.artifact_id;
 IF f.office_source_snapshot_id IS NULL THEN RETURN NEW; END IF;
 v=(NEW.data->'body'->>'content')::jsonb;
 IF v->>'office_version' IS DISTINCT FROM 'office-v1' OR coalesce(v->>'kind','') NOT IN ('document','workbook')
 OR jsonb_typeof(v->'annotations') IS DISTINCT FROM 'array'
 OR (v->>'kind'='document' AND jsonb_typeof(v->'paragraphs') IS DISTINCT FROM 'array')
 OR (v->>'kind'='workbook' AND jsonb_typeof(v->'sheets') IS DISTINCT FROM 'array')
 THEN RAISE EXCEPTION 'editable office values required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_office_revision BEFORE INSERT ON revisions FOR EACH ROW EXECUTE FUNCTION guard_office_revision();
CREATE TRIGGER guard_office_proposal BEFORE INSERT ON proposals FOR EACH ROW EXECUTE FUNCTION guard_office_revision();

CREATE FUNCTION guard_office_export() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f workspace_files; s source_snapshots; expected text; a tool_attempts;
BEGIN
 IF NEW.data->>'exporter_version' IS DISTINCT FROM 'office-exports-v1' THEN RETURN NEW; END IF;
 expected=CASE NEW.data->>'format'
 WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
 WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
 WHEN 'pdf' THEN 'application/pdf' WHEN 'png' THEN 'image/png' ELSE NULL END;
 IF expected IS NULL OR NEW.data->'blob'->>'mime_type' IS DISTINCT FROM expected
 OR NEW.data->>'filename' IS DISTINCT FROM 'export.'||(NEW.data->>'format')
 THEN RAISE EXCEPTION 'fixed office output manifest required'; END IF;
 SELECT * INTO f FROM workspace_files WHERE workspace_id=NEW.workspace_id
 AND (id=NEW.data->>'workspace_file_id' OR artifact_id=NEW.data->>'artifact_id');
 SELECT * INTO s FROM source_snapshots WHERE workspace_id=NEW.workspace_id
 AND id=coalesce(f.office_source_snapshot_id,NEW.data->>'source_snapshot_id');
 IF s.id IS NOT NULL AND (NEW.data->'provenance'->>'source_snapshot_id' IS DISTINCT FROM s.id
 OR NEW.data->'provenance'->>'original_sha256' IS DISTINCT FROM s.data->>'original_sha256'
 OR NEW.data->'provenance'->>'extraction_sha256' IS DISTINCT FROM s.data->>'extraction_sha256'
 OR NEW.data->'provenance'->>'parser_version' IS DISTINCT FROM s.data->>'parser_version')
 THEN RAISE EXCEPTION 'exact office provenance required'; END IF;
 IF NEW.data->>'tool_attempt_id' IS NOT NULL THEN
 SELECT * INTO a FROM tool_attempts WHERE workspace_id=NEW.workspace_id AND id=NEW.data->>'tool_attempt_id';
 IF a.id IS NULL OR a.capability_id<>'artifacts.export.office'
 OR NOT tool_authorized(a.workspace_id,a.run_id,a.run_fence,a.lease_hash,a.grant_id,(a.call->>'expected_work_version')::bigint)
 OR NOT tool_file_resources_authorized(a.workspace_id,a.run_id,a.call)
 OR a.scope_sha256 IS DISTINCT FROM tool_scope_hash(a.workspace_id,a.run_id)
 OR NEW.data->>'revision_id' IS DISTINCT FROM a.call->'arguments'->'input_ref'->>'version'
 OR NEW.data->>'input_sha256' IS DISTINCT FROM a.call->'arguments'->'input_ref'->>'sha256'
 OR coalesce(NEW.data->>'workspace_file_id',NEW.data->>'artifact_id') IS DISTINCT FROM a.call->'arguments'->'input_ref'->>'id'
 OR NEW.data->>'format' IS DISTINCT FROM a.call->'arguments'->>'format'
 OR (NEW.data->>'format'='png' AND NEW.data->'chart'->'spec' IS DISTINCT FROM a.call->'arguments'->'chart_spec')
 OR NOT EXISTS(SELECT 1 FROM runs r WHERE r.workspace_id=a.workspace_id AND r.id=a.run_id
    AND r.data->>'principal_id'=NEW.owner_id AND r.conversation_id=NEW.data->>'conversation_id')
 OR NOT EXISTS(SELECT 1 FROM tool_attempt_events WHERE attempt_id=a.id AND kind='dispatch')
 OR EXISTS(SELECT 1 FROM tool_attempt_events WHERE attempt_id=a.id AND kind='observation')
 THEN RAISE EXCEPTION 'current office export tool authority required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_office_export BEFORE INSERT ON artifact_exports FOR EACH ROW EXECUTE FUNCTION guard_office_export();

-- Copied chart/value observations remain dependent on the original artifact ACL
-- through retained reads and provider egress, using the existing transitive guard.
ALTER FUNCTION research_tool_dependencies_visible(text,text) RENAME TO research_tool_dependencies_visible_pre_office;
CREATE FUNCTION research_tool_dependencies_visible(ws text,aid text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE a tool_attempts; ref jsonb; f workspace_files; who text;
BEGIN
 IF NOT research_tool_dependencies_visible_pre_office(ws,aid) THEN RETURN false; END IF;
 SELECT * INTO a FROM tool_attempts WHERE workspace_id=ws AND id=aid;
 SELECT data->>'principal_id' INTO who FROM runs WHERE workspace_id=ws AND id=a.run_id;
 FOR ref IN SELECT value FROM jsonb_array_elements(a.call->'input_refs') LOOP
   SELECT * INTO f FROM workspace_files WHERE workspace_id=ws
     AND ((ref->>'kind'='workspace_file' AND id=ref->>'id') OR
          (ref->>'kind'='artifact_revision' AND artifact_id=ref->>'id'));
   IF f.office_source_snapshot_id IS NOT NULL AND
      (NOT office_source_visible(ws,who,f.office_source_snapshot_id)
       OR NOT work_artifact_visible(ws,who,f.conversation_id,f.artifact_id))
   THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
