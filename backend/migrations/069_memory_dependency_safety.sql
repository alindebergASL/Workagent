-- Exact, owner-private memory edges. No source/artifact deletion or backfill.
-- Fail closed at 16 edges / 256 visited nodes; forget is atomic up to 1024 items.
CREATE INDEX memory_evidence_parent ON memory_evidence
 (workspace_id,(source_ref->'ref'->>'memory_id')) WHERE source_ref->>'source_type'='memory';
CREATE INDEX memory_tombstone_source ON memory_tombstones(workspace_id,owner_id,source_fingerprint);

-- Equivalent timestamp spellings identify the same immutable source observation.
-- Keep legacy raw hashes as well; do not reinterpret historical tombstones.
CREATE FUNCTION memory_source_fingerprint(ref jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN ref->>'source_type'='source' THEN
   tool_json_hash(jsonb_build_array('memory-source-v1',ref->'ref'->>'source_id',
     ref->'ref'->>'external_version',extract(epoch FROM (ref->'ref'->>'observed_at')::timestamptz)))
 ELSE tool_json_hash(ref) END
$$;

CREATE FUNCTION memory_dependency_scope(ws text,owner text,child_scope text,child_id text,parent_scope text,parent_id text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(memory_scope_authorized(ws,owner,child_scope,child_id)
 AND memory_scope_authorized(ws,owner,parent_scope,parent_id) AND (
   (parent_scope='user' AND parent_id=owner) OR
   (child_scope=parent_scope AND child_id=parent_id) OR
   (parent_scope='work_area' AND child_scope='task' AND (child_id=parent_id OR EXISTS(
     SELECT 1 FROM memory_scope_bindings WHERE workspace_id=ws AND owner_id=owner
       AND conversation_id=child_id AND work_area_id=parent_id)))),false)
$$;

CREATE FUNCTION memory_dependencies_authorized(ws text,owner text,scope text,sid text,mid text,refs jsonb,at_time timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE queue jsonb; node jsonb; ref jsonb; parent jsonb; path jsonb; pos integer=0; n integer=0;
BEGIN
 IF scope IS NULL OR sid IS NULL OR at_time IS NULL THEN RETURN false; END IF;
 queue=jsonb_build_array(jsonb_build_object('scope',scope,'sid',sid,'refs',refs,
   'path',CASE WHEN mid IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(mid) END));
 WHILE pos<jsonb_array_length(queue) LOOP
   node=queue->pos; pos=pos+1; n=n+1;
   IF n>256 OR jsonb_array_length(node->'path')>17
      OR NOT memory_scope_authorized(ws,owner,node->>'scope',node->>'sid')
      OR jsonb_typeof(node->'refs') IS DISTINCT FROM 'array'
      OR jsonb_array_length(node->'refs')>16 THEN RETURN false; END IF;
   -- Include exact observed_at checks for the scope itself, not only direct refs.
   IF EXISTS(SELECT 1 FROM conversations cv CROSS JOIN LATERAL jsonb_array_elements(cv.data->'selected_source_refs') x
     WHERE cv.workspace_id=ws AND cv.id=node->>'sid' AND node->>'scope'<>'user'
       AND NOT EXISTS(SELECT 1 FROM sources s WHERE s.workspace_id=ws AND s.id=x->>'source_id'
         AND (s.data->>'observed_at')::timestamptz=(x->>'observed_at')::timestamptz)) THEN RETURN false; END IF;
   FOR ref IN SELECT value FROM jsonb_array_elements(node->'refs') LOOP
     IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref-ARRAY['source_type','ref']<>'{}'::jsonb
       OR jsonb_typeof(ref->'ref') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
     IF ref->>'source_type'='memory' THEN
       IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref-ARRAY['source_type','ref']<>'{}'::jsonb
         OR jsonb_typeof(ref->'ref') IS DISTINCT FROM 'object'
         OR (ref->'ref')-ARRAY['memory_id','revision_id','sha256']<>'{}'::jsonb
         OR NOT (ref->'ref') ?& ARRAY['memory_id','revision_id','sha256']
         OR jsonb_typeof(ref->'ref'->'memory_id') IS DISTINCT FROM 'string'
         OR jsonb_typeof(ref->'ref'->'revision_id') IS DISTINCT FROM 'string'
         OR jsonb_typeof(ref->'ref'->'sha256') IS DISTINCT FROM 'string'
         OR length(ref->'ref'->>'memory_id') NOT BETWEEN 1 AND 128
         OR length(ref->'ref'->>'revision_id') NOT BETWEEN 1 AND 128
         OR ref->'ref'->>'memory_id' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
         OR ref->'ref'->>'revision_id' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
         OR coalesce(ref->'ref'->>'sha256','') !~ '^[a-f0-9]{64}$'
         OR node->'path' ? (ref->'ref'->>'memory_id') THEN RETURN false; END IF;
       SELECT r.data INTO parent FROM memory_items i JOIN memory_revisions r
         ON r.workspace_id=i.workspace_id AND r.memory_id=i.id AND r.id=i.current_revision_id
         WHERE i.workspace_id=ws AND i.owner_id=owner AND i.id=ref->'ref'->>'memory_id'
           AND r.id=ref->'ref'->>'revision_id' AND r.data->>'content_sha256'=ref->'ref'->>'sha256';
       IF parent IS NULL OR parent->>'status'<>'active'
         OR NOT memory_dependency_scope(ws,owner,node->>'scope',node->>'sid',parent->>'scope_kind',parent->>'scope_id')
         OR (parent->>'valid_from')::timestamptz>at_time
         OR (parent->>'valid_until')::timestamptz<=at_time
         OR (parent->>'expires_at')::timestamptz<=at_time THEN RETURN false; END IF;
       IF nullif(parent->'procedure','null'::jsonb) IS NOT NULL THEN
         IF parent->>'origin'<>'human_reviewed' OR parent->>'reviewed_by_principal_id' IS DISTINCT FROM owner
           OR NOT memory_procedure_sources_authorized(ws,owner,parent->>'scope_kind',parent->>'scope_id',parent->'source_refs')
         THEN RETURN false; END IF;
         IF EXISTS(SELECT 1 FROM jsonb_array_elements(parent->'procedure'->'evidence') e
           WHERE NOT memory_procedure_evidence_authorized(ws,owner,parent->>'scope_kind',parent->>'scope_id',e))
         THEN RETURN false; END IF;
       END IF;
       path=(node->'path')||jsonb_build_array(parent->>'memory_id');
       IF jsonb_array_length(path)>17 OR jsonb_array_length(queue)>=256 THEN RETURN false; END IF;
       queue=queue||jsonb_build_array(jsonb_build_object('scope',parent->>'scope_kind','sid',parent->>'scope_id',
         'refs',parent->'source_refs','path',path));
     ELSIF ref->>'source_type'='source' THEN
       IF (ref->'ref')-ARRAY['source_id','external_version','observed_at']<>'{}'::jsonb THEN RETURN false; END IF;
       IF NOT EXISTS(SELECT 1 FROM sources s JOIN source_access a ON a.workspace_id=s.workspace_id AND a.source_id=s.id
         WHERE s.workspace_id=ws AND s.id=ref->'ref'->>'source_id' AND a.principal_id=owner AND a.active
           AND (s.data->>'available')::boolean AND s.data->>'external_version'=ref->'ref'->>'external_version'
           AND (s.data->>'observed_at')::timestamptz=(ref->'ref'->>'observed_at')::timestamptz)
       THEN RETURN false; END IF;
     ELSIF ref->>'source_type'='file' THEN
       IF (ref->'ref')-ARRAY['workspace_file_id','version_id','sha256']<>'{}'::jsonb THEN RETURN false; END IF;
       IF NOT EXISTS(SELECT 1 FROM workspace_files f WHERE f.workspace_id=ws AND f.id=ref->'ref'->>'workspace_file_id'
         AND f.owner_id=owner AND memory_scope_authorized(ws,owner,'task',f.conversation_id)
         AND (f.office_source_snapshot_id IS NULL OR research_source_visible(ws,f.office_source_snapshot_id))
         AND (EXISTS(SELECT 1 FROM revisions r WHERE r.workspace_id=ws AND r.artifact_id=f.artifact_id
           AND r.id=ref->'ref'->>'version_id' AND r.data->'body'->>'content_sha256'=ref->'ref'->>'sha256')
         OR EXISTS(SELECT 1 FROM source_snapshots s WHERE s.workspace_id=ws AND s.workspace_file_id=f.id
           AND s.id=ref->'ref'->>'version_id' AND s.data->>'extraction_sha256'=ref->'ref'->>'sha256'
           AND research_source_visible(ws,s.id)))) THEN RETURN false; END IF;
     ELSE RETURN false; END IF;
   END LOOP;
 END LOOP;
 RETURN true;
END $$;

-- Preserve 067's closed operation/CAS/evidence guards. Exact substitutions abort
-- on predecessor drift rather than silently leaving an old permissive writer.
DO $$ DECLARE definition text; before text; after text;
BEGIN
 definition=pg_get_functiondef('memory_procedure_sources_authorized(text,text,text,text,jsonb)'::regprocedure);
 before=$q$IF ref->>'source_type'='file' THEN$q$;
 after=$q$IF ref->>'source_type'='memory' THEN
     -- The bounded graph validator enforces the stricter memory scope intersection.
     CONTINUE;
   ELSIF ref->>'source_type'='file' THEN$q$;
 IF position(before in definition)=0 THEN RAISE EXCEPTION '069 procedure source predecessor drift'; END IF;
 EXECUTE replace(definition,before,after);
 definition=pg_get_functiondef('write_procedure_memory_revision(text,text,text,text,jsonb,text)'::regprocedure);
 before=$q$ELSIF operation='correct' THEN allowed=allowed||ARRAY['content','content_sha256','source_refs','procedure',$q$;
 after=$q$ELSIF operation='correct' THEN allowed=allowed||ARRAY['applicability','content','content_sha256','source_refs','procedure',$q$;
 IF position(before in definition)=0 THEN RAISE EXCEPTION '069 applicability predecessor drift'; END IF;
 definition=replace(definition,before,after);
 before=$q$ELSE RAISE EXCEPTION 'discriminated source required'; END IF;$q$;
 after=$q$ELSIF ref->>'source_type'='memory' THEN
     NULL; -- Validated as a complete graph under the workspace write lock below.
   ELSE RAISE EXCEPTION 'discriminated source required'; END IF;$q$;
 IF position(before in definition)=0 THEN RAISE EXCEPTION '069 memory source predecessor drift'; END IF;
 definition=replace(definition,before,after);
 before=$q$INSERT INTO memory_revisions VALUES(ws,mid,rid,(payload->>'recorded_at')::timestamptz,payload);$q$;
 after=$q$IF operation<>'expire' AND NOT memory_dependencies_authorized(ws,owner,payload->>'scope_kind',payload->>'scope_id',mid,payload->'source_refs',statement_timestamp())
 THEN RAISE EXCEPTION 'exact eligible acyclic memory dependencies required'; END IF;
 IF jsonb_typeof(payload->'applicability') IS DISTINCT FROM 'string' OR length(payload->>'applicability')>500
 THEN RAISE EXCEPTION 'bounded applicability required'; END IF;
 IF EXISTS(SELECT 1 FROM memory_tombstones WHERE workspace_id=ws AND owner_id=owner
   AND source_fingerprint IN (SELECT tool_json_hash(value) FROM jsonb_array_elements(payload->'source_refs')
     UNION SELECT memory_source_fingerprint(value) FROM jsonb_array_elements(payload->'source_refs')))
 THEN RAISE EXCEPTION 'forgotten source cannot be re-proposed in another scope'; END IF;
 INSERT INTO memory_revisions VALUES(ws,mid,rid,(payload->>'recorded_at')::timestamptz,payload);$q$;
 IF position(before in definition)=0 THEN RAISE EXCEPTION '069 graph predecessor drift'; END IF;
 EXECUTE replace(definition,before,after);
 -- Reuse the exact erasure implementation privately; public forget adds closure.
 definition=pg_get_functiondef('forget_memory(text,text,text,text,text)'::regprocedure);
 before=$q$SELECT '' AS fingerprint UNION SELECT tool_json_hash(value)$q$;
 after=$q$SELECT '' AS fingerprint UNION SELECT memory_source_fingerprint(value) FROM jsonb_array_elements(row.data->'source_refs') UNION SELECT tool_json_hash(value)$q$;
 IF position(before in definition)=0 THEN RAISE EXCEPTION '069 erasure fingerprint predecessor drift'; END IF;
 definition=replace(definition,before,after);
 EXECUTE replace(definition,'FUNCTION public.forget_memory(', 'FUNCTION public.erase_memory_payload(');
END $$;
REVOKE ALL ON FUNCTION erase_memory_payload(text,text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION forget_memory(ws text,owner text,mid text,expected text,rid text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ids text[]; item record; result jsonb;
BEGIN
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=ws AND principal_id=owner AND active AND role<>'viewer')
 OR NOT EXISTS(SELECT 1 FROM memory_items i JOIN memory_revisions r ON r.workspace_id=i.workspace_id AND r.id=i.current_revision_id
   WHERE i.workspace_id=ws AND i.id=mid AND i.owner_id=owner AND i.current_revision_id=expected AND r.data->>'status'<>'forgotten')
 THEN RAISE EXCEPTION 'human forget CAS required'; END IF;
 -- UNION deduplicates cycles and diamonds, including edges in historical revisions.
 WITH RECURSIVE descendants(id) AS (
   SELECT mid UNION SELECT e.memory_id FROM descendants d JOIN memory_evidence e
     ON e.workspace_id=ws AND e.source_ref->>'source_type'='memory' AND e.source_ref->'ref'->>'memory_id'=d.id
     JOIN memory_items i ON i.workspace_id=ws AND i.id=e.memory_id AND i.owner_id=owner
 ) SELECT array_agg(id) INTO ids FROM (SELECT id FROM descendants LIMIT 1025) bounded;
 IF cardinality(ids)>1024 THEN RAISE EXCEPTION 'memory erasure closure exceeds bounded transaction'; END IF;
 FOR item IN SELECT i.id,i.current_revision_id FROM memory_items i JOIN memory_revisions r
   ON r.workspace_id=i.workspace_id AND r.id=i.current_revision_id
   WHERE i.workspace_id=ws AND i.owner_id=owner AND i.id=ANY(ids) AND r.data->>'status'<>'forgotten'
   ORDER BY i.id LOOP
   IF item.id=mid THEN
     result=erase_memory_payload(ws,owner,item.id,item.current_revision_id,rid);
   ELSE
     PERFORM erase_memory_payload(ws,owner,item.id,item.current_revision_id,gen_random_uuid()::text);
   END IF;
 END LOOP;
 RETURN result;
END $$;
