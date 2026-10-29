-- Evidence-backed procedures in the existing erasable revision store only.
-- Human commands are API-authenticated; these functions additionally constrain
-- the restricted SQL caller. No worker tool acquires human command authority.
CREATE FUNCTION memory_procedure_scope(ws text,owner text,scope text,sid text,cid text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT memory_scope_authorized(ws,owner,scope,sid)
 AND memory_scope_authorized(ws,owner,'task',cid)
 AND NOT EXISTS(SELECT 1 FROM conversations cv
   CROSS JOIN LATERAL jsonb_array_elements(cv.data->'selected_source_refs') source_ref
   WHERE cv.workspace_id=ws AND cv.id IN (sid,cid) AND NOT EXISTS(
     SELECT 1 FROM sources source WHERE source.workspace_id=ws AND source.id=source_ref->>'source_id'
       AND (source.data->>'observed_at')::timestamptz=(source_ref->>'observed_at')::timestamptz))
 AND (
   (scope='task' AND sid=cid) OR
   (scope='work_area' AND (sid=cid OR EXISTS(SELECT 1 FROM memory_scope_bindings
     WHERE workspace_id=ws AND owner_id=owner AND conversation_id=cid AND work_area_id=sid))) OR
   (scope='task' AND EXISTS(SELECT 1 FROM memory_scope_bindings selected
     WHERE selected.workspace_id=ws AND selected.owner_id=owner AND selected.conversation_id=sid
       AND memory_scope_authorized(ws,owner,'work_area',selected.work_area_id)
       AND (selected.work_area_id=cid OR EXISTS(SELECT 1 FROM memory_scope_bindings evidence
         WHERE evidence.workspace_id=ws AND evidence.owner_id=owner AND evidence.conversation_id=cid
           AND evidence.work_area_id=selected.work_area_id))))
 )
$$;

CREATE FUNCTION memory_procedure_evidence_authorized(ws text,owner text,scope text,sid text,ref jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE m jsonb; a tool_attempts; r runs; e jsonb; g tool_grants;
BEGIN
 IF jsonb_typeof(ref) IS DISTINCT FROM 'object'
 OR ref-ARRAY['kind','conversation_id','event_id','sha256']<>'{}'::jsonb
 OR NOT ref ?& ARRAY['kind','conversation_id','event_id','sha256']
 OR jsonb_typeof(ref->'kind') IS DISTINCT FROM 'string'
 OR jsonb_typeof(ref->'conversation_id') IS DISTINCT FROM 'string'
 OR jsonb_typeof(ref->'event_id') IS DISTINCT FROM 'string'
 OR jsonb_typeof(ref->'sha256') IS DISTINCT FROM 'string'
 OR length(ref->>'conversation_id') NOT BETWEEN 1 AND 128
 OR length(ref->>'event_id') NOT BETWEEN 1 AND 128
 OR ref->>'conversation_id' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
 OR ref->>'event_id' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
 OR coalesce(ref->>'sha256','') !~ '^[a-f0-9]{64}$'
 OR NOT memory_procedure_scope(ws,owner,scope,sid,ref->>'conversation_id')
 THEN RETURN false; END IF;
 IF ref->>'kind'='human_message' THEN
   SELECT data INTO m FROM conversation_messages WHERE workspace_id=ws
     AND conversation_id=ref->>'conversation_id' AND id=ref->>'event_id' AND author_kind='human';
   RETURN coalesce(m->>'author_kind'='human' AND m->>'author_id'=owner
     AND m->>'evidence_origin'='human' AND m->>'id'=ref->>'event_id'
     AND m->>'conversation_id'=ref->>'conversation_id' AND tool_json_hash(m)=ref->>'sha256',false);
 ELSIF ref->>'kind'<>'tool_observation' THEN RETURN false; END IF;
 SELECT * INTO a FROM tool_attempts WHERE workspace_id=ws AND id=ref->>'event_id';
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=a.run_id;
 SELECT * INTO g FROM tool_grants WHERE id=a.grant_id AND workspace_id=ws AND run_id=a.run_id;
 SELECT data INTO e FROM tool_attempt_events WHERE attempt_id=a.id AND kind='observation';
 RETURN coalesce(r.conversation_id=ref->>'conversation_id' AND r.data->>'principal_id'=owner
   AND r.data->>'state'<>'cancelled' AND e->>'status' IN ('observed','failed','cost_only','outcome_unknown')
   AND e->>'attempt_id'=a.id AND e->>'run_id'=r.id AND tool_json_hash(e)=ref->>'sha256'
   AND EXISTS(SELECT 1 FROM conversations cv WHERE cv.workspace_id=ws AND cv.id=r.conversation_id
     AND cv.data->>'state' NOT IN ('paused','cancelled'))
   AND g.active AND g.data->>'principal_id'=owner
   AND (g.data->>'expires_at')::timestamptz>clock_timestamp()
   AND tool_run_available(ws,a.run_id)
   AND tool_file_resources_authorized(ws,a.run_id,a.call)
   AND (g.data->'resource_selectors') @> (a.call->'input_refs')
   AND NOT EXISTS(SELECT 1 FROM tool_scope_reductions sr WHERE sr.grant_id=a.grant_id
     AND a.call->'input_refs' @> jsonb_build_array(sr.selector))
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(g.data->'capabilities') pin
     WHERE pin->>'id'=a.capability_id AND pin->>'version'=a.capability_version
       AND pin->>'schema_sha256'=a.descriptor->>'schema_sha256'
       AND pin->>'implementation_sha256'=a.descriptor->>'implementation_sha256')
   AND EXISTS(SELECT 1 FROM capability_installations i WHERE i.id=a.capability_id
     AND i.version=a.capability_version AND i.enabled AND i.descriptor=a.descriptor)
   AND (e->>'status'<>'observed' OR research_tool_dependencies_visible(ws,a.id)),false);
END $$;

CREATE FUNCTION memory_procedure_details_valid(details jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE name text; value jsonb; bound integer;
BEGIN
 IF details IS NULL OR details='null'::jsonb THEN RETURN true; END IF;
 IF details::text ~* '(-----BEGIN .*PRIVATE KEY-----|\m(sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{12,}|(password|api[_ -]?key|access[_ -]?token|secret)[[:space:]]*[:=][[:space:]]*[^[:space:]]+|Bearer[[:space:]]+[^[:space:]]+)'
 OR details::text ~* '\m(social security|ssn|sexual orientation|medical diagnosis|religious belief|biometric)\M'
 THEN RETURN false; END IF;
 IF jsonb_typeof(details) IS DISTINCT FROM 'object'
   OR details-ARRAY['retrieval_terms','excluded_terms','counterexamples','evidence','validation_notes']<>'{}'::jsonb
   OR NOT details ?& ARRAY['retrieval_terms','excluded_terms','counterexamples','evidence','validation_notes']
   OR jsonb_typeof(details->'validation_notes') IS DISTINCT FROM 'string'
   OR length(details->>'validation_notes')>1000 OR length(btrim(details->>'validation_notes'))=0 THEN RETURN false; END IF;
 FOREACH name IN ARRAY ARRAY['retrieval_terms','excluded_terms','counterexamples','evidence'] LOOP
   IF jsonb_typeof(details->name) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
   IF jsonb_array_length(details->name)>16 OR (name<>'excluded_terms' AND jsonb_array_length(details->name)=0)
   THEN RETURN false; END IF;
   IF name<>'evidence' THEN
     bound=CASE WHEN name='counterexamples' THEN 500 ELSE 200 END;
     FOR value IN SELECT v FROM jsonb_array_elements(details->name) AS x(v) LOOP
       IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR length(value#>>'{}')>bound OR length(btrim(value#>>'{}'))=0
       THEN RETURN false; END IF;
     END LOOP;
   END IF;
 END LOOP;
 IF (SELECT count(*) FROM jsonb_array_elements(details->'evidence')) <>
    (SELECT count(DISTINCT (v->>'kind',v->>'conversation_id',v->>'event_id')) FROM jsonb_array_elements(details->'evidence') x(v))
 THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE FUNCTION memory_procedure_sources_authorized(ws text,owner text,scope text,sid text,refs jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ref jsonb;
BEGIN
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
   IF ref->>'source_type'='file' THEN
     IF NOT EXISTS(SELECT 1 FROM workspace_files f WHERE f.workspace_id=ws AND f.id=ref->'ref'->>'workspace_file_id'
       AND f.owner_id=owner AND memory_procedure_scope(ws,owner,scope,sid,f.conversation_id)
       AND NOT EXISTS(SELECT 1 FROM source_snapshots snap WHERE snap.workspace_id=ws
         AND snap.workspace_file_id=f.id AND snap.id=ref->'ref'->>'version_id'
         AND NOT research_source_visible(ws,snap.id))) THEN RETURN false; END IF;
   ELSIF NOT EXISTS(SELECT 1 FROM conversations cv WHERE cv.workspace_id=ws
       AND memory_procedure_scope(ws,owner,scope,sid,cv.id)
       AND cv.data->'selected_source_refs' @> jsonb_build_array(ref->'ref')) THEN RETURN false;
   END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION write_procedure_memory_revision(ws text,owner text,operation text,expected text,payload jsonb,target_id text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old jsonb; mid text; rid text; generation bigint; ref jsonb; keyhash text; prior_status text; target jsonb; details jsonb; allowed text[];
BEGIN
 SELECT access_generation INTO generation FROM workspaces WHERE id=ws FOR UPDATE;
 mid=payload->>'memory_id'; rid=payload->>'revision_id';
 details=nullif(payload->'procedure','null'::jsonb);
 IF NOT memory_procedure_details_valid(details)
   OR payload->>'content_sha256' IS DISTINCT FROM encode(sha256(convert_to(payload->>'content','UTF8')),'hex')
   OR payload->>'kind' NOT IN ('fact','preference','project_convention','episode','procedure')
   OR (details IS NOT NULL AND (payload->>'kind'<>'procedure' OR coalesce(length(btrim(payload->>'applicability')),0)=0
      OR coalesce(length(btrim(payload->>'confidence_basis')),0)=0 OR payload->>'scope_kind'='user'))
 THEN RAISE EXCEPTION 'bounded procedure details and exact content hash required'; END IF;
 IF details IS NOT NULL AND operation<>'expire' THEN
   IF NOT memory_procedure_sources_authorized(ws,owner,payload->>'scope_kind',payload->>'scope_id',payload->'source_refs')
   THEN RAISE EXCEPTION 'procedure sources must remain inside selected scope'; END IF;
   FOR ref IN SELECT value FROM jsonb_array_elements(details->'evidence') LOOP
     IF NOT memory_procedure_evidence_authorized(ws,owner,payload->>'scope_kind',payload->>'scope_id',ref)
     THEN RAISE EXCEPTION 'exact current observed evidence authority required'; END IF;
   END LOOP;
 END IF;
 IF NOT memory_scope_authorized(ws,owner,payload->>'scope_kind',payload->>'scope_id')
   OR payload->>'workspace_id' IS DISTINCT FROM ws OR payload->>'owner_id' IS DISTINCT FROM owner
   OR (payload->>'access_generation')::bigint IS DISTINCT FROM generation
   OR payload->>'proposed_by_run_id' IS NOT NULL OR payload->'evidence_ids' IS DISTINCT FROM '[]'::jsonb
   OR payload->>'content' IS NULL OR length(payload->>'content') NOT BETWEEN 1 AND 4000
   OR payload->>'confidence_label' NOT IN ('explicit','inferred','uncertain')
   OR jsonb_typeof(payload->'source_refs') IS DISTINCT FROM 'array'
   OR jsonb_array_length(payload->'source_refs')>16
 THEN RAISE EXCEPTION 'human memory authority required'; END IF;
 IF NOT payload ?& ARRAY['memory_id','revision_id','workspace_id','owner_id','kind','scope_kind','scope_id',
   'subject_key','predicate_key','content','content_sha256','status','origin','source_refs','evidence_ids',
   'proposed_by_run_id','reviewed_by_principal_id','confidence_label','confidence_basis','valid_from','valid_until',
   'recorded_at','expires_at','supersedes_revision_id','exception_to_revision_id','contradiction_group_id','applicability','access_generation']
 THEN RAISE EXCEPTION 'complete memory revision required'; END IF;
 IF payload - ARRAY['memory_id','revision_id','workspace_id','owner_id','kind','scope_kind','scope_id',
   'subject_key','predicate_key','content','content_sha256','status','origin','source_refs','evidence_ids',
   'proposed_by_run_id','reviewed_by_principal_id','confidence_label','confidence_basis','valid_from','valid_until',
   'recorded_at','expires_at','supersedes_revision_id','exception_to_revision_id','contradiction_group_id','applicability','access_generation','procedure'] <> '{}'::jsonb
 THEN RAISE EXCEPTION 'closed memory revision required'; END IF;
 IF payload->>'content' ~* '(-----BEGIN .*PRIVATE KEY-----|\m(sk-|ghp_|github_pat_|AKIA)[A-Za-z0-9_-]{12,}|(password|api[_ -]?key|access[_ -]?token|secret)[[:space:]]*[:=][[:space:]]*[^[:space:]]+|Bearer[[:space:]]+[^[:space:]]+)'
 THEN RAISE EXCEPTION 'secret-like value prohibited'; END IF;
 IF payload->>'valid_until' IS NOT NULL AND (payload->>'valid_until')::timestamptz<=(payload->>'valid_from')::timestamptz
 THEN RAISE EXCEPTION 'invalid valid interval'; END IF;
 SELECT r.data INTO old FROM memory_items i JOIN memory_revisions r ON r.workspace_id=i.workspace_id AND r.id=i.current_revision_id
 WHERE i.workspace_id=ws AND i.id=mid AND i.owner_id=owner;
 IF operation IN ('remember','candidate') THEN
   IF old IS NOT NULL OR expected IS NOT NULL OR payload->>'supersedes_revision_id' IS NOT NULL
      OR payload->>'exception_to_revision_id' IS NOT NULL OR payload->>'reviewed_by_principal_id' IS NOT NULL
      OR payload->>'confidence_label' IS DISTINCT FROM (CASE WHEN operation='candidate' THEN 'inferred' ELSE 'explicit' END)
      OR payload->>'origin' IS DISTINCT FROM (CASE WHEN operation='candidate' THEN 'agent_inferred' ELSE 'human_explicit' END)
      OR payload->>'status' IS DISTINCT FROM (CASE WHEN operation='candidate' OR payload->>'kind'='procedure' THEN 'candidate' ELSE 'active' END)
   THEN RAISE EXCEPTION 'candidate cannot promote'; END IF;
   INSERT INTO memory_items VALUES(ws,mid,owner,NULL);
 ELSE
   IF old IS NULL OR old->>'revision_id' IS DISTINCT FROM expected OR old->>'status'='forgotten'
      OR payload->>'kind' IS DISTINCT FROM old->>'kind'
      OR payload->>'subject_key' IS DISTINCT FROM old->>'subject_key'
      OR payload->>'predicate_key' IS DISTINCT FROM old->>'predicate_key'
   THEN RAISE EXCEPTION 'memory CAS required'; END IF;
   -- Compare all fields outside the operation's explicit mutation set. A SQL
   -- caller cannot smuggle applicability, dates or provenance through review.
   old=old||jsonb_build_object('procedure',coalesce(old->'procedure','null'::jsonb));
   allowed=ARRAY['revision_id','recorded_at','supersedes_revision_id','exception_to_revision_id','access_generation'];
   IF operation='review' THEN allowed=allowed||ARRAY['status','origin','reviewed_by_principal_id','confidence_label'];
   ELSIF operation='correct' THEN allowed=allowed||ARRAY['content','content_sha256','source_refs','procedure',
     'status','origin','reviewed_by_principal_id','confidence_label','valid_from','valid_until','expires_at'];
   ELSIF operation='rollback' THEN allowed=allowed||ARRAY['content','content_sha256','source_refs','procedure',
     'status','origin','reviewed_by_principal_id','confidence_label','valid_from','valid_until','expires_at','applicability','confidence_basis'];
   ELSIF operation='narrow' THEN allowed=allowed||ARRAY['scope_kind','scope_id'];
   ELSIF operation='expire' THEN allowed=allowed||ARRAY['status','expires_at']; END IF;
   IF (payload||jsonb_build_object('procedure',coalesce(payload->'procedure','null'::jsonb)))-allowed <> old-allowed
   THEN RAISE EXCEPTION 'memory operation changed immutable details'; END IF;
   IF operation='review' AND payload->>'status'='active' AND payload->>'kind'='procedure'
      AND (details IS NULL OR coalesce(length(btrim(payload->>'applicability')),0)=0
        OR coalesce(length(btrim(payload->>'confidence_basis')),0)=0)
   THEN RAISE EXCEPTION 'legacy procedure requires evidenced correction before adoption'; END IF;
   IF operation IN ('correct','rollback') AND nullif(old->'procedure','null'::jsonb) IS NOT NULL
     AND (details IS NULL OR NOT ((details->'evidence') @> (old->'procedure'->'evidence')))
   THEN RAISE EXCEPTION 'procedure evidence dependencies cannot be removed'; END IF;
   IF operation='review' THEN
     IF old->>'status' NOT IN ('candidate','active','contested') OR payload->>'status' NOT IN ('active','contested','expired')
        OR payload->>'origin'<>'human_reviewed' OR payload->>'reviewed_by_principal_id' IS DISTINCT FROM owner
        OR payload->>'confidence_label' IS DISTINCT FROM (CASE WHEN payload->>'status'='contested' THEN 'uncertain' WHEN old->>'kind'='procedure' THEN 'inferred' ELSE 'explicit' END)
        OR payload->>'content' IS DISTINCT FROM old->>'content' OR payload->'source_refs' IS DISTINCT FROM old->'source_refs'
     THEN RAISE EXCEPTION 'human review required'; END IF;
     IF (payload->>'exception_to_revision_id') IS DISTINCT FROM (old->>'exception_to_revision_id') OR
        (payload->>'valid_from') IS DISTINCT FROM (old->>'valid_from') OR
        (payload->>'valid_until') IS DISTINCT FROM (old->>'valid_until') OR
        (payload->>'expires_at') IS DISTINCT FROM (old->>'expires_at') OR
        (old->>'exception_to_revision_id' IS NOT NULL AND payload->>'status'='expired') THEN
       RAISE EXCEPTION 'memory review exception interval';
     END IF;
   ELSIF operation='correct' THEN
     IF old->>'status' NOT IN ('active','contested','candidate')
       OR (old->>'status'='candidate' AND old->>'kind'<>'procedure')
       OR NOT ((payload->'source_refs') @> (old->'source_refs'))
       OR (payload->>'kind'='procedure' AND (details IS NULL
         OR coalesce(length(btrim(payload->>'applicability')),0)=0
         OR coalesce(length(btrim(payload->>'confidence_basis')),0)=0))
       OR (old->>'status'='candidate' AND (payload->>'status'<>'candidate'
         OR payload->>'origin' IS DISTINCT FROM old->>'origin'
         OR payload->>'reviewed_by_principal_id' IS DISTINCT FROM old->>'reviewed_by_principal_id'
         OR payload->>'confidence_label' IS DISTINCT FROM old->>'confidence_label'
         OR payload->>'exception_to_revision_id' IS NOT NULL))
       OR (old->>'status'<>'candidate' AND (payload->>'status'<>'active'
         OR payload->>'origin'<>'human_reviewed' OR payload->>'reviewed_by_principal_id' IS DISTINCT FROM owner
         OR payload->>'confidence_label' IS DISTINCT FROM (CASE WHEN old->>'kind'='procedure' THEN 'inferred' ELSE 'explicit' END)))
     THEN RAISE EXCEPTION 'human correction cannot promote an unreviewed candidate'; END IF;
   ELSIF operation='rollback' THEN
     SELECT data INTO target FROM memory_revisions WHERE workspace_id=ws AND memory_id=mid AND id=target_id;
     IF target IS NULL OR target->>'kind'<>'procedure' OR target->>'status'<>'active'
       OR target->>'origin'<>'human_reviewed' OR target->>'reviewed_by_principal_id' IS DISTINCT FROM owner
       OR nullif(target->'procedure','null'::jsonb) IS NULL
       OR target->>'exception_to_revision_id' IS NOT NULL OR old->>'exception_to_revision_id' IS NOT NULL
       OR payload->>'status'<>'active' OR payload->>'origin'<>'human_reviewed'
       OR payload->>'reviewed_by_principal_id' IS DISTINCT FROM owner OR payload->>'confidence_label'<>'inferred'
       OR (payload->'procedure')-'evidence' IS DISTINCT FROM (target->'procedure')-'evidence'
       OR NOT ((payload->'source_refs') @> (old->'source_refs') AND (payload->'source_refs') @> (target->'source_refs'))
       OR NOT ((details->'evidence') @> (target->'procedure'->'evidence'))
       OR NOT (((old->'source_refs') || (target->'source_refs')) @> (payload->'source_refs'))
       OR NOT ((coalesce(nullif(old->'procedure','null'::jsonb)->'evidence','[]'::jsonb) || (target->'procedure'->'evidence')) @> (details->'evidence'))
       OR payload->>'content' IS DISTINCT FROM target->>'content'
       OR payload->>'applicability' IS DISTINCT FROM target->>'applicability'
       OR payload->>'confidence_basis' IS DISTINCT FROM target->>'confidence_basis'
       OR payload->>'valid_from' IS DISTINCT FROM target->>'valid_from'
       OR payload->>'valid_until' IS DISTINCT FROM target->>'valid_until'
       OR payload->>'expires_at' IS DISTINCT FROM target->>'expires_at'
     THEN RAISE EXCEPTION 'eligible adopted target and union dependencies required'; END IF;
   ELSIF operation IN ('narrow','expire') THEN
     IF payload->>'content' IS DISTINCT FROM old->>'content' OR payload->'source_refs' IS DISTINCT FROM old->'source_refs'
       OR payload->>'origin' IS DISTINCT FROM old->>'origin'
       OR payload->>'reviewed_by_principal_id' IS DISTINCT FROM old->>'reviewed_by_principal_id'
       OR payload->>'status' IS DISTINCT FROM (CASE WHEN operation='expire' THEN 'expired' ELSE old->>'status' END)
     THEN RAISE EXCEPTION 'no implicit review or replacement'; END IF;
   ELSE RAISE EXCEPTION 'unknown memory operation'; END IF;
   IF operation='narrow' THEN
     IF old->>'exception_to_revision_id' IS NOT NULL OR NOT (
       (old->>'scope_kind'='user' AND payload->>'scope_kind' IN ('task','work_area')) OR
       (old->>'scope_kind'='work_area' AND payload->>'scope_kind'='task' AND
        (old->>'scope_id'=payload->>'scope_id' OR EXISTS(SELECT 1 FROM memory_scope_bindings
          WHERE workspace_id=ws AND owner_id=owner AND conversation_id=payload->>'scope_id' AND work_area_id=old->>'scope_id'))))
     THEN RAISE EXCEPTION 'explicit membership narrowing required'; END IF;
   ELSIF payload->>'scope_kind' IS DISTINCT FROM old->>'scope_kind' OR payload->>'scope_id' IS DISTINCT FROM old->>'scope_id'
   THEN RAISE EXCEPTION 'scope change requires narrow'; END IF;
   IF operation='review' THEN
     IF payload->>'supersedes_revision_id' IS DISTINCT FROM expected
     THEN RAISE EXCEPTION 'direct review supersession required'; END IF;
   ELSIF payload->>'exception_to_revision_id' IS NOT NULL THEN
     IF operation<>'correct' OR payload->>'exception_to_revision_id' IS DISTINCT FROM expected
       OR old->>'exception_to_revision_id' IS NOT NULL OR payload->>'supersedes_revision_id' IS NOT NULL
       OR payload->>'valid_until' IS NULL OR payload->>'valid_from' IS NULL
     THEN RAISE EXCEPTION 'finite direct exception required'; END IF;
   ELSIF payload->>'supersedes_revision_id' IS DISTINCT FROM expected
   THEN RAISE EXCEPTION 'direct supersession required'; END IF;
 END IF;
 IF details IS NOT NULL AND EXISTS(SELECT 1 FROM memory_tombstones WHERE workspace_id=ws AND owner_id=owner
   AND source_fingerprint IN (SELECT tool_json_hash(value) FROM jsonb_array_elements(details->'evidence')))
 THEN RAISE EXCEPTION 'forgotten observed evidence cannot be re-proposed in another scope'; END IF;
 keyhash=tool_json_hash(jsonb_build_array(payload->>'subject_key',payload->>'predicate_key'));
 IF EXISTS(SELECT 1 FROM memory_tombstones WHERE workspace_id=ws AND owner_id=owner
    AND scope_kind=payload->>'scope_kind' AND scope_id=payload->>'scope_id'
    AND (key_sha256=keyhash OR source_fingerprint IN (SELECT tool_json_hash(value) FROM jsonb_array_elements((payload->'source_refs') || coalesce(details->'evidence','[]'::jsonb)))))
 THEN RAISE EXCEPTION 'forgotten memory suppressed'; END IF;
 INSERT INTO memory_revisions VALUES(ws,mid,rid,(payload->>'recorded_at')::timestamptz,payload);
 FOR ref IN SELECT value FROM jsonb_array_elements(payload->'source_refs') LOOP
   IF ref->>'source_type'='source' THEN
     IF NOT EXISTS(SELECT 1 FROM sources s JOIN source_access a ON a.workspace_id=s.workspace_id AND a.source_id=s.id
       WHERE s.workspace_id=ws AND s.id=ref->'ref'->>'source_id' AND a.principal_id=owner AND a.active
       AND (s.data->>'available')::boolean AND s.data->>'external_version'=ref->'ref'->>'external_version'
       AND (s.data->>'observed_at')::timestamptz=(ref->'ref'->>'observed_at')::timestamptz)
     THEN RAISE EXCEPTION 'exact eligible source required'; END IF;
   ELSIF ref->>'source_type'='file' THEN
     IF NOT EXISTS(SELECT 1 FROM workspace_files f WHERE f.workspace_id=ws AND f.id=ref->'ref'->>'workspace_file_id'
       AND f.owner_id=owner AND memory_scope_authorized(ws,owner,'task',f.conversation_id)
       AND (EXISTS(SELECT 1 FROM revisions r WHERE r.workspace_id=ws AND r.artifact_id=f.artifact_id
         AND r.id=ref->'ref'->>'version_id' AND r.data->'body'->>'content_sha256'=ref->'ref'->>'sha256')
        OR EXISTS(SELECT 1 FROM source_snapshots s WHERE s.workspace_id=ws AND s.workspace_file_id=f.id
         AND s.id=ref->'ref'->>'version_id' AND s.data->>'extraction_sha256'=ref->'ref'->>'sha256')))
     THEN RAISE EXCEPTION 'exact eligible file required'; END IF;
   ELSE RAISE EXCEPTION 'discriminated source required'; END IF;
   INSERT INTO memory_evidence VALUES(ws,mid,rid,tool_json_hash(ref),ref) ON CONFLICT DO NOTHING;
 END LOOP;
 IF details IS NOT NULL THEN
   FOR ref IN SELECT value FROM jsonb_array_elements(details->'evidence') LOOP
     INSERT INTO memory_evidence VALUES(ws,mid,rid,tool_json_hash(ref),ref) ON CONFLICT DO NOTHING;
   END LOOP;
 END IF;
 UPDATE memory_items SET current_revision_id=rid WHERE workspace_id=ws AND id=mid;
END $$;

CREATE OR REPLACE FUNCTION forget_memory(ws text,owner text,mid text,expected text,rid text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old jsonb; tomb jsonb; row record;
BEGIN
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 SELECT r.data INTO old FROM memory_items i JOIN memory_revisions r ON r.workspace_id=i.workspace_id AND r.id=i.current_revision_id
 WHERE i.workspace_id=ws AND i.id=mid AND i.owner_id=owner;
 IF old IS NULL OR old->>'revision_id' IS DISTINCT FROM expected OR old->>'status'='forgotten'
    OR NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=ws AND principal_id=owner AND active AND role<>'viewer')
 THEN RAISE EXCEPTION 'human forget CAS required'; END IF;
 -- All historical scopes and source fingerprints are suppressed; no source docs are removed.
 FOR row IN SELECT data FROM memory_revisions WHERE workspace_id=ws AND memory_id=mid LOOP
   INSERT INTO memory_tombstones(workspace_id,owner_id,memory_id,scope_kind,scope_id,key_sha256,source_fingerprint)
   SELECT ws,owner,mid,row.data->>'scope_kind',row.data->>'scope_id',
     tool_json_hash(jsonb_build_array(row.data->>'subject_key',row.data->>'predicate_key')),fingerprint
   FROM (SELECT '' AS fingerprint UNION SELECT tool_json_hash(value) FROM jsonb_array_elements((row.data->'source_refs') || coalesce(nullif(row.data->'procedure','null'::jsonb)->'evidence','[]'::jsonb))) refs
   ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('workagent.memory_erasure','on',true);
 UPDATE memory_revisions SET data=data || jsonb_build_object('content',NULL,'content_sha256',NULL,
   'subject_key',NULL,'predicate_key',NULL,'source_refs','[]'::jsonb,'evidence_ids','[]'::jsonb,
   'procedure',NULL,'confidence_basis',NULL,'applicability',NULL,'status','forgotten','contradiction_group_id',NULL)
 WHERE workspace_id=ws AND memory_id=mid;
 DELETE FROM memory_evidence WHERE workspace_id=ws AND memory_id=mid;
 SELECT data INTO tomb FROM memory_revisions WHERE workspace_id=ws AND id=expected;
 tomb=tomb||jsonb_build_object('revision_id',rid,'recorded_at',now(),'supersedes_revision_id',expected,'exception_to_revision_id',NULL);
 INSERT INTO memory_revisions VALUES(ws,mid,rid,now(),tomb);
 UPDATE memory_items SET current_revision_id=rid WHERE workspace_id=ws AND id=mid;
 PERFORM set_config('workagent.memory_erasure','off',true);
 RETURN jsonb_build_object('memory_id',mid,'revision_id',rid,'status','forgotten');
END $$;

-- Private implementation cannot be called with forged rollback target context.
REVOKE ALL ON FUNCTION write_procedure_memory_revision(text,text,text,text,jsonb,text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION write_memory_revision(ws text,owner text,operation text,expected text,payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF operation NOT IN ('remember','candidate','review','correct','narrow','expire')
 THEN RAISE EXCEPTION 'unknown memory operation'; END IF;
 PERFORM write_procedure_memory_revision(ws,owner,operation,expected,payload,NULL);
END $$;
CREATE FUNCTION rollback_memory_revision(ws text,owner text,expected text,payload jsonb,target_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF target_id IS NULL THEN RAISE EXCEPTION 'explicit rollback target required'; END IF;
 PERFORM write_procedure_memory_revision(ws,owner,'rollback',expected,payload,target_id);
END $$;
REVOKE ALL ON FUNCTION rollback_memory_revision(text,text,text,jsonb,text) FROM PUBLIC;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_routine_grants
 WHERE routine_schema='public' AND routine_name='write_memory_revision'
 AND grantee<>current_user AND grantee<>'PUBLIC' LOOP
 EXECUTE format('GRANT EXECUTE ON FUNCTION rollback_memory_revision(text,text,text,jsonb,text) TO %I',r.grantee);
 EXECUTE format('REVOKE ALL ON FUNCTION write_procedure_memory_revision(text,text,text,text,jsonb,text) FROM %I',r.grantee);
 END LOOP;
END $$;
