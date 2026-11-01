-- Identity/current-ref evaluation must not recurse through ordinary visibility.
-- This is074's exact calculation after081, with only producer visibility moved
-- into the existing UNION dependency traversal below. It is not an execution API.
DO $migration$ DECLARE definition text; old text; BEGIN
 definition=pg_get_functiondef('tool_run_output_resources(text,text)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'2a8985d3d9667317d65eb1cb5c8d426b2ae8c9d2f6a1e56281d2a1b30ce510e8'
 THEN RAISE EXCEPTION 'native current-output predecessor drift'; END IF;
 old='FUNCTION public.tool_run_output_resources(';
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'native current-output name drift'; END IF;
 definition=replace(definition,old,'FUNCTION public.native_retained_run_outputs_current(');
 old='AND memory_revision_visible(ws,f.artifact_id,v.id)';
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'native current-output visibility drift'; END IF;
 EXECUTE replace(definition,old,'');
END $migration$;

-- New range receipts explicitly select a projection. Existing rows without a
-- version keep the exact legacy projection (including unavailable bodies).
CREATE FUNCTION retained_projection_version(r runs,d jsonb) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN d->>'kind'='read_result'
   AND NOT EXISTS(SELECT 1 FROM run_checkpoints WHERE workspace_id=r.workspace_id AND run_id=d->>'run_id'
     AND phase=d->>'phase' AND checkpoint_hash=d->>'operation_hash')
   AND EXISTS(SELECT 1 FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id
     WHERE a.workspace_id=r.workspace_id AND a.run_id=d->>'run_id' AND e.phase=d->>'phase' AND e.kind='tool_result'
       AND e.data->'binding'->>'operation_hash'=d->>'operation_hash' AND e.data->'decision'->>'kind' IN
       ('files_list','files_read_range','files_create_draft','files_propose_patch','files_compare','artifacts_export'))
 THEN 'native-file-receipt-v1' ELSE 'legacy-v1' END
$$;

CREATE FUNCTION native_retained_ref_current(ws text,consumer_run text,source_run text,ref jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r runs; f workspace_files; a artifacts; revision jsonb; actual text; target jsonb; cfg jsonb; rid text;
BEGIN
 IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR NOT ref ?& ARRAY['kind','id','version','sha256']
   OR ref-ARRAY['kind','id','version','sha256']<>'{}'::jsonb OR ref->>'kind' NOT IN ('workspace_file','artifact_revision') THEN RETURN false; END IF;
 FOREACH rid IN ARRAY ARRAY[consumer_run,source_run] LOOP
   SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=rid;
   IF NOT coalesce(tool_run_available(ws,rid),false)
     OR NOT EXISTS(SELECT 1 FROM tool_grants WHERE workspace_id=ws AND run_id=rid AND data->'effects' @> '["read"]')
     OR NOT coalesce((coalesce((SELECT jsonb_agg(sel) FROM tool_grants tg CROSS JOIN LATERAL jsonb_array_elements(tg.data->'resource_selectors') sel
       WHERE tg.workspace_id=ws AND tg.run_id=rid AND NOT EXISTS(SELECT 1 FROM tool_scope_reductions sr WHERE sr.grant_id=tg.id AND sr.selector=sel)),'[]'::jsonb)
       || native_retained_run_outputs_current(ws,rid)) @> jsonb_build_array(ref),false) THEN RETURN false; END IF;
   SELECT data INTO cfg FROM run_configurations WHERE workspace_id=ws AND run_id=rid;
   SELECT data->'target' INTO target FROM conversation_messages WHERE workspace_id=ws AND run_id=rid AND author_kind IN ('human','system') ORDER BY sequence LIMIT 1;
   f=NULL; a=NULL; actual=NULL; revision=NULL;
   IF ref->>'kind'='workspace_file' THEN
     SELECT * INTO f FROM workspace_files WHERE workspace_id=ws AND id=ref->>'id'
       AND owner_id=r.data->>'principal_id' AND conversation_id=r.conversation_id;
     IF f.id IS NULL THEN RETURN false; END IF;
     IF f.artifact_id IS NOT NULL THEN
       SELECT * INTO a FROM artifacts WHERE workspace_id=ws AND id=f.artifact_id AND conversation_id=r.conversation_id;
       SELECT data INTO revision FROM revisions WHERE workspace_id=ws AND artifact_id=a.id AND id=ref->>'version'
         ;
       actual=revision->'body'->>'content_sha256';
       IF revision->'body'->>'kind' IS DISTINCT FROM 'file'
         OR actual IS DISTINCT FROM encode(sha256(convert_to(revision->'body'->>'content','UTF8')),'hex')
         OR revision->>'body_hash' IS DISTINCT FROM tool_json_hash(revision->'body') THEN RETURN false; END IF;
     ELSE
       SELECT data->>'extraction_sha256' INTO actual FROM source_snapshots WHERE workspace_id=ws
         AND workspace_file_id=f.id AND id=ref->>'version' AND research_source_visible(ws,id);
     END IF;
   ELSE
     SELECT * INTO a FROM artifacts WHERE workspace_id=ws AND id=ref->>'id' AND conversation_id=r.conversation_id;
     SELECT data INTO revision FROM revisions WHERE workspace_id=ws AND artifact_id=a.id AND id=ref->>'version'
       ;
     actual=revision->>'body_hash';
     IF actual IS DISTINCT FROM tool_json_hash(revision->'body') THEN RETURN false; END IF;
   END IF;
   IF actual IS NULL OR actual IS DISTINCT FROM ref->>'sha256' THEN RETURN false; END IF;
   IF nullif(target,'null'::jsonb) IS NOT NULL AND (a.id IS DISTINCT FROM target->>'artifact_id'
       OR ref->>'version' IS DISTINCT FROM target->>'revision_id' OR a.current_revision_id IS DISTINCT FROM target->>'revision_id'
       OR revision->>'body_hash' IS DISTINCT FROM target->>'body_hash') THEN RETURN false; END IF;
   IF nullif(cfg->'responsibility','null'::jsonb) IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cfg->'responsibility'->'observations') item
       WHERE item->>'kind'='artifact_revision' AND item->>'object_id'=a.id AND item->>'observed_version'=ref->>'version')
   THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION native_retained_file_current(ws text,consumer_run text,aid text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE a tool_attempts; r runs; source runs; obs jsonb; result jsonb; args jsonb; refs jsonb; expected jsonb;
 item jsonb; ref jsonb; native_kind text; keys text[]; proposal proposals; field text;
 file_keys text[]=ARRAY['workspace_file_id','workspace_id','conversation_id','filename','mime_type','storage','current','byte_length','editable','office_provenance'];
BEGIN
 SELECT * INTO a FROM tool_attempts WHERE workspace_id=ws AND id=aid;
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=consumer_run;
 SELECT * INTO source FROM runs WHERE workspace_id=ws AND id=a.run_id;
 SELECT e.data INTO obs FROM tool_attempt_events e WHERE e.attempt_id=aid AND e.kind='observation';
 args=a.call->'arguments'; native_kind=args->>'kind'; result=obs->'output'->'result'; refs=a.call->'input_refs';
 IF a.id IS NULL OR r.id IS NULL OR source.id IS NULL OR r.conversation_id IS DISTINCT FROM source.conversation_id
   OR r.data->>'principal_id' IS DISTINCT FROM source.data->>'principal_id'
   OR r.data->'access_generation' IS DISTINCT FROM source.data->'access_generation'
   OR NOT coalesce(tool_run_available(ws,consumer_run) AND tool_run_available(ws,source.id),false)
   OR NOT EXISTS(SELECT 1 FROM tool_grants WHERE workspace_id=ws AND run_id=consumer_run AND data->'effects' @> '["read"]')
   OR NOT EXISTS(SELECT 1 FROM tool_grants WHERE id=a.grant_id AND data->'effects' @> '["read"]')
   OR obs->>'status' IS DISTINCT FROM 'observed' OR jsonb_typeof(result) IS DISTINCT FROM 'object'
 THEN RETURN false; END IF;
 IF native_kind='files_list' THEN
   keys=ARRAY['items','next_after']; expected='[]'::jsonb;
   IF jsonb_typeof(result->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(result->'items')>(args->>'limit')::integer THEN RETURN false; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(result->'items') LOOP
     ref=jsonb_build_object('kind','workspace_file','id',item->'current'->>'workspace_file_id',
       'version',item->'current'->>'version_id','sha256',item->'current'->>'sha256');
     IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-file_keys<>'{}'::jsonb OR NOT item ?& file_keys
       OR jsonb_typeof(item->'current') IS DISTINCT FROM 'object'
       OR (item->'current')-ARRAY['workspace_file_id','version_id','sha256']<>'{}'::jsonb
       OR NOT item->'current' ?& ARRAY['workspace_file_id','version_id','sha256']
       OR (nullif(item->'office_provenance','null'::jsonb) IS NOT NULL AND
          (jsonb_typeof(item->'office_provenance') IS DISTINCT FROM 'object'
           OR (item->'office_provenance')-ARRAY['source_snapshot_id','original_sha256','extraction_sha256','parser_version','transformation_version']<>'{}'::jsonb
           OR NOT item->'office_provenance' ?& ARRAY['source_snapshot_id','original_sha256','extraction_sha256','parser_version','transformation_version']
           OR item->'office_provenance'->>'transformation_version' IS DISTINCT FROM 'office-v1'))
       OR NOT EXISTS(SELECT 1 FROM workspace_files f WHERE f.workspace_id=ws AND f.id=ref->>'id'
         AND f.filename=item->>'filename' AND f.mime_type=item->>'mime_type')
       OR item->>'workspace_id' IS DISTINCT FROM ws OR item->>'conversation_id' IS DISTINCT FROM r.conversation_id
       OR item->>'workspace_file_id' IS DISTINCT FROM ref->>'id'
       OR NOT native_retained_ref_current(ws,consumer_run,source.id,ref) THEN RETURN false; END IF;
   END LOOP;
 ELSIF native_kind IN ('files_read_range','files_propose_patch') THEN
   expected=jsonb_build_array(jsonb_build_object('kind','workspace_file','id',args->'ref'->>'workspace_file_id',
      'version',args->'ref'->>'version_id','sha256',args->'ref'->>'sha256'));
   IF native_kind='files_read_range' THEN
     keys=ARRAY['ref','text','offset','next_offset','byte_length','chunk_sha256','omitted_ranges','source_snapshot_id','has_utf8_bom','newline'];
     IF result->'ref' IS DISTINCT FROM args->'ref' OR result->'offset' IS DISTINCT FROM args->'offset'
       OR result->>'chunk_sha256' IS DISTINCT FROM encode(sha256(convert_to(result->>'text','UTF8')),'hex')
       OR (result->>'next_offset')::integer-(result->>'offset')::integer<>octet_length(convert_to(result->>'text','UTF8'))
       OR octet_length(convert_to(result->>'text','UTF8'))>(args->>'limit')::integer THEN RETURN false; END IF;
   ELSE
     keys=ARRAY['proposal_id','workspace_file_id','base','proposed_sha256','status'];
     SELECT * INTO proposal FROM proposals WHERE workspace_id=ws AND id=result->>'proposal_id';
     IF result->'base' IS DISTINCT FROM args->'ref' OR result->>'workspace_file_id' IS DISTINCT FROM args->'ref'->>'workspace_file_id'
       OR result->>'proposed_sha256' IS DISTINCT FROM args->>'sha256' OR result->>'status' IS DISTINCT FROM 'pending'
       OR proposal.id IS NULL OR proposal.artifact_id IS DISTINCT FROM result->>'workspace_file_id'
       OR proposal.data->>'status' IS DISTINCT FROM 'pending' OR proposal.data->>'base_revision_id' IS DISTINCT FROM args->'ref'->>'version_id'
       OR proposal.data->'body'->>'content_sha256' IS DISTINCT FROM args->>'sha256'
       OR NOT EXISTS(SELECT 1 FROM artifacts WHERE workspace_id=ws AND id=proposal.artifact_id AND current_revision_id=proposal.data->>'base_revision_id')
     THEN RETURN false; END IF;
   END IF;
 ELSIF native_kind='files_compare' THEN
   keys=ARRAY['left','right','identical','diff','diff_sha256','diff_bytes','omitted_diff_ranges','left_omitted_ranges','right_omitted_ranges'];
   expected=jsonb_build_array(jsonb_build_object('kind','workspace_file','id',args->'left'->>'workspace_file_id','version',args->'left'->>'version_id','sha256',args->'left'->>'sha256'),
       jsonb_build_object('kind','workspace_file','id',args->'right'->>'workspace_file_id','version',args->'right'->>'version_id','sha256',args->'right'->>'sha256'));
   IF result->'left' IS DISTINCT FROM args->'left' OR result->'right' IS DISTINCT FROM args->'right'
     OR args->'left'->>'workspace_file_id' IS DISTINCT FROM args->'right'->>'workspace_file_id'
     OR result->>'diff_sha256' IS DISTINCT FROM encode(sha256(convert_to(result->>'diff','UTF8')),'hex') THEN RETURN false; END IF;
 ELSIF native_kind='files_create_draft' THEN
   keys=file_keys;
   expected='[]'::jsonb;
   ref=jsonb_build_object('kind','workspace_file','id',result->'current'->>'workspace_file_id',
       'version',result->'current'->>'version_id','sha256',result->'current'->>'sha256');
   IF result->'office_provenance' IS DISTINCT FROM 'null'::jsonb
     OR (result->'current')-ARRAY['workspace_file_id','version_id','sha256']<>'{}'::jsonb
     OR result->>'filename' IS DISTINCT FROM args->'source'->>'filename'
     OR result->>'mime_type' IS DISTINCT FROM args->'source'->>'mime_type'
     OR result->>'workspace_id' IS DISTINCT FROM ws OR result->>'conversation_id' IS DISTINCT FROM r.conversation_id
     OR result->>'workspace_file_id' IS DISTINCT FROM aid OR ref->>'id' IS DISTINCT FROM aid
     OR result->'current'->>'sha256' IS DISTINCT FROM args->'source'->>'sha256'
     OR NOT native_retained_ref_current(ws,consumer_run,source.id,ref) THEN RETURN false; END IF;
 ELSIF native_kind='artifacts_export' THEN
   keys=ARRAY['export_id','workspace_id','conversation_id','artifact_id','revision_id','input_sha256','workspace_file_id','source_snapshot_id',
       'format','filename','blob','created_at','annotations','omissions','tool_attempt_id','exporter_version','fidelity','provenance','chart'];
   expected=jsonb_build_array(args->'input_ref');
   IF result->>'tool_attempt_id' IS DISTINCT FROM aid OR result->>'workspace_id' IS DISTINCT FROM ws
     OR result->>'conversation_id' IS DISTINCT FROM r.conversation_id
     OR NOT EXISTS(SELECT 1 FROM artifact_exports WHERE workspace_id=ws AND id=result->>'export_id' AND data=result)
   THEN RETURN false; END IF;
 ELSE RETURN false; END IF;
 IF result-keys<>'{}'::jsonb OR NOT result ?& keys OR refs IS DISTINCT FROM expected THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['omitted_ranges','omitted_diff_ranges','left_omitted_ranges','right_omitted_ranges'] LOOP
   IF result ? field THEN
     IF jsonb_typeof(result->field) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
     FOR item IN SELECT value FROM jsonb_array_elements(result->field) LOOP
       IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['start','end','sha256']<>'{}'::jsonb
         OR NOT item ?& ARRAY['start','end','sha256'] OR item->>'sha256' !~ '^[0-9a-f]{64}$'
         OR (item->>'start')::integer<0 OR (item->>'end')::integer<(item->>'start')::integer THEN RETURN false; END IF;
     END LOOP;
   END IF;
 END LOOP;
 FOR ref IN SELECT value FROM jsonb_array_elements(refs) LOOP
   IF NOT native_retained_ref_current(ws,consumer_run,source.id,ref) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

-- Producer identities only: these helpers never ask whether a producer is
-- visible. The existing output traversal owns that decision and deduplicates it.
CREATE FUNCTION native_retained_file_producers(ws text,aid text) RETURNS TABLE(run_id text)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH evidence AS (
   SELECT a.call AS call_json, e.data->'output'->'result' result FROM tool_attempts a
   JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation'
   WHERE a.workspace_id=ws AND a.id=aid
 ), refs(ref) AS (
   SELECT value FROM evidence,LATERAL jsonb_array_elements(call_json->'input_refs')
   UNION SELECT jsonb_build_object('kind','workspace_file','id',item->'current'->>'workspace_file_id','version',item->'current'->>'version_id')
     FROM evidence,LATERAL jsonb_array_elements(CASE WHEN call_json->'arguments'->>'kind'='files_list' THEN result->'items' ELSE '[]'::jsonb END) item
   UNION SELECT jsonb_build_object('kind','workspace_file','id',result->'current'->>'workspace_file_id','version',result->'current'->>'version_id')
     FROM evidence WHERE call_json->'arguments'->>'kind'='files_create_draft'
 ), artifacts(aid,revision) AS (
   SELECT CASE WHEN ref->>'kind'='artifact_revision' THEN ref->>'id' ELSE f.artifact_id END,ref->>'version'
   FROM refs LEFT JOIN workspace_files f ON f.workspace_id=ws AND f.id=ref->>'id' AND ref->>'kind'='workspace_file'
 )
 SELECT p.run_id FROM artifacts a,LATERAL memory_revision_producers(ws,a.aid,a.revision) p
 UNION SELECT p.producer_run_id FROM evidence JOIN proposals p ON p.workspace_id=ws AND p.id=evidence.result->>'proposal_id' WHERE p.producer_run_id IS NOT NULL
 UNION SELECT o.run_id FROM evidence JOIN product_observations o ON o.workspace_id=ws AND o.data->>'proposal_id'=evidence.result->>'proposal_id'
 UNION SELECT a.run_id FROM evidence JOIN tool_attempt_events e ON e.kind='observation' AND e.data->'output'->'result'->>'proposal_id'=evidence.result->>'proposal_id'
 JOIN tool_attempts a ON a.id=e.attempt_id AND a.workspace_id=ws AND a.capability_id='files.propose_patch'
$$;

CREATE FUNCTION native_retained_file_authorized(ws text,consumer_run text,aid text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT native_retained_file_current(ws,consumer_run,aid)
   AND research_run_dependencies_visible(ws,consumer_run)
   AND NOT EXISTS(SELECT 1 FROM tool_attempts a WHERE a.workspace_id=ws AND a.id=aid AND NOT research_run_dependencies_visible(ws,a.run_id))
   AND NOT EXISTS(SELECT 1 FROM native_retained_file_producers(ws,aid) p WHERE NOT research_run_dependencies_visible(ws,p.run_id))
$$;

CREATE FUNCTION native_retained_file_material(r runs,d jsonb) RETURNS bytea LANGUAGE plpgsql AS $$
DECLARE a tool_attempts; event jsonb; selected jsonb; receipt jsonb; obs jsonb; safe jsonb; descriptor jsonb;
BEGIN
 -- All legacy current/source/dependency/snapshot checks, without substituting
 -- a checkpoint or asking the old material branch to reinterpret this receipt.
 PERFORM retained_tool_result_material(r,jsonb_build_object('run_id',d->>'run_id'));
 SELECT e.data INTO event FROM responses_events e JOIN provider_attempts p ON p.id=e.attempt_id
   WHERE p.workspace_id=r.workspace_id AND p.run_id=d->>'run_id' AND e.phase=d->>'phase' AND e.kind='tool_result'
     AND e.data->'binding'->>'operation_hash'=d->>'operation_hash';
 SELECT e.data INTO receipt FROM responses_events e JOIN provider_attempts p ON p.id=e.attempt_id
   WHERE p.workspace_id=r.workspace_id AND p.run_id=d->>'run_id' AND e.phase=d->>'phase' AND e.kind='result';
 SELECT * INTO a FROM tool_attempts WHERE workspace_id=r.workspace_id AND run_id=d->>'run_id' AND call_id=d->>'phase';
 SELECT data INTO obs FROM tool_attempt_events WHERE attempt_id=a.id AND kind='observation';
 selected=event->'decision'; descriptor=tool_attempt_descriptor(a.id);
 IF a.id IS NULL OR descriptor IS DISTINCT FROM a.descriptor OR event->>'status' IS DISTINCT FROM 'reply'
   OR selected IS DISTINCT FROM receipt->'value'->'decision' OR receipt->>'state' IS DISTINCT FROM 'function_call'
   OR selected IS DISTINCT FROM a.call->'arguments' OR tool_json_hash(selected) IS DISTINCT FROM d->>'operation_hash'
   OR a.call_sha256 IS DISTINCT FROM tool_json_hash(a.call)
   OR obs->>'status' IS DISTINCT FROM 'observed' OR obs->>'attempt_id' IS DISTINCT FROM a.id
   OR obs->>'run_id' IS DISTINCT FROM a.run_id OR obs->>'call_id' IS DISTINCT FROM a.call_id
   OR obs->>'capability_id' IS DISTINCT FROM a.capability_id OR obs->>'capability_version' IS DISTINCT FROM a.capability_version
   OR obs->>'implementation_sha256' IS DISTINCT FROM a.descriptor->>'implementation_sha256'
   OR obs->>'execution_profile' IS DISTINCT FROM 'native-bounded-files-v1'
   OR a.capability_id IS DISTINCT FROM (CASE selected->>'kind'
     WHEN 'files_list' THEN 'files.list' WHEN 'files_read_range' THEN 'files.read_range'
     WHEN 'files_create_draft' THEN 'files.create_draft' WHEN 'files_propose_patch' THEN 'files.propose_patch'
     WHEN 'files_compare' THEN 'files.compare' WHEN 'artifacts_export' THEN 'artifacts.export' END)
   OR obs->'output' IS DISTINCT FROM event->'capability_result' OR obs->'output'->>'capability' IS DISTINCT FROM selected->>'kind'
   OR obs->'output'->>'version' IS DISTINCT FROM '1' OR (obs->'output')-ARRAY['capability','version','result']<>'{}'::jsonb
   OR obs->>'output_sha256' IS DISTINCT FROM tool_json_hash(obs->'output')
   OR NOT EXISTS(SELECT 1 FROM tool_attempt_events WHERE attempt_id=a.id AND kind='dispatch')
   OR NOT native_retained_file_authorized(r.workspace_id,r.id,a.id)
 THEN RAISE EXCEPTION 'exact currently authorized native file receipt required'; END IF;
 safe=jsonb_build_object('projection_version','native-file-receipt-v1','status_semantics','historical_receipt',
   'provenance',jsonb_build_object('attempt_id',a.id,'run_id',a.run_id,'phase',a.call_id,'capability_id',a.capability_id,
     'implementation_sha256',a.descriptor->>'implementation_sha256','output_sha256',obs->>'output_sha256','status','observed'),
   'receipt',obs->'output');
 RETURN convert_to(acceptance_canonical_json(retained_safe_value(safe)),'UTF8');
END $$;
CREATE FUNCTION retained_result_material_versioned(r runs,d jsonb,version text) RETURNS bytea LANGUAGE plpgsql AS $$
BEGIN
 IF version='legacy-v1' THEN RETURN retained_result_material(r,d); END IF;
 IF version='native-file-receipt-v1' AND d->>'kind'='read_result' THEN RETURN native_retained_file_material(r,d); END IF;
 RAISE EXCEPTION 'unknown retained projection version';
END $$;

-- Keep the complete original range/identity/budget/stage guards. New receipts
-- choose an explicit version; old missing-version rows are never rewritten.
DO $migration$ DECLARE definition text; old text;
BEGIN
 definition=pg_get_functiondef('guard_retained_result_read()'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'0a0a5b92ca4dbb2122eae2aea05791cd1af0aab0ef60095aa04014776ed4c94d' THEN RAISE EXCEPTION 'native retained read predecessor drift'; END IF;
 old='source=retained_result_material(r,selected);';
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'native retained read replacement drift'; END IF;
 EXECUTE replace(definition,old,$replacement$
 IF coalesce(NEW.data->>'projection_version','legacy-v1') IS DISTINCT FROM retained_projection_version(r,selected)
 THEN RAISE EXCEPTION 'exact new retained projection version required'; END IF;
 source=retained_result_material_versioned(r,selected,coalesce(NEW.data->>'projection_version','legacy-v1'));
 $replacement$);
END $migration$;

-- Current native checks are leaves. Producer visibility uses the existing
-- output graph; UNION visits each run once even for same-run reads/cycles.
CREATE FUNCTION native_retained_reads_current(ws text,rid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(
   SELECT 1 FROM retained_result_reads rr
   LEFT JOIN tool_attempts a ON a.workspace_id=rr.workspace_id AND a.run_id=rr.data->'decision'->>'run_id'
     AND a.call_id=rr.data->'decision'->>'phase'
     AND tool_json_hash(a.call->'arguments')=rr.data->'decision'->>'operation_hash'
   WHERE rr.workspace_id=ws AND rr.run_id=rid AND rr.data->>'projection_version'='native-file-receipt-v1'
     AND (a.id IS NULL OR tool_attempt_descriptor(a.id) IS NULL
       OR NOT coalesce(native_retained_file_current(ws,rr.run_id,a.id),false)))
$$;
DO $migration$ DECLARE definition text; old text; BEGIN
 definition=pg_get_functiondef('research_run_dependencies_visible(text,text)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'8d33aac210b46351ef2d3a8ae0af3f13f714b0dd926a661a4cb6297d945e1ad0'
 THEN RAISE EXCEPTION 'native output-visibility predecessor drift'; END IF;
 old=$needle$SELECT rr.data->'decision'->>'run_id'
   FROM retained_result_reads rr JOIN dependencies d ON rr.run_id=d.run_id
   WHERE rr.workspace_id=ws AND rr.data->'decision'->>'kind'='read_result'$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'native output edge drift'; END IF;
 definition=replace(definition,old,$replacement$SELECT edge.run_id
   FROM dependencies d CROSS JOIN LATERAL (
     SELECT rr.data->'decision'->>'run_id' AS run_id FROM retained_result_reads rr
       WHERE rr.workspace_id=ws AND rr.run_id=d.run_id AND rr.data->'decision'->>'kind'='read_result'
     UNION SELECT p.run_id FROM retained_result_reads rr
       JOIN tool_attempts a ON a.workspace_id=rr.workspace_id AND a.run_id=rr.data->'decision'->>'run_id'
         AND a.call_id=rr.data->'decision'->>'phase' AND tool_json_hash(a.call->'arguments')=rr.data->'decision'->>'operation_hash'
       CROSS JOIN LATERAL native_retained_file_producers(ws,a.id) p
       WHERE rr.workspace_id=ws AND rr.run_id=d.run_id AND rr.data->>'projection_version'='native-file-receipt-v1'
   ) edge$replacement$);
 old='SELECT NOT EXISTS(SELECT 1 FROM dependencies d WHERE NOT memory_run_visible(ws,d.run_id))';
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'native output predicate drift'; END IF;
 EXECUTE replace(definition,old,old||'
 AND NOT EXISTS(SELECT 1 FROM dependencies d WHERE NOT native_retained_reads_current(ws,d.run_id))');
END $migration$;
CREATE FUNCTION native_retained_reads_authorized(ws text,rid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT research_run_dependencies_visible(ws,rid)
$$;
DO $migration$ DECLARE definition text; old text; BEGIN
 definition=pg_get_functiondef('require_general_publication_authority(runs)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'ebbc2d624727d3a2983184defd330f8b230c6d31fe4dbe4539942adbf73fc0dc' THEN RAISE EXCEPTION 'native lifecycle predecessor drift: require_general_publication_authority(runs)'; END IF;
 old=$needle$ PERFORM require_general_publication_authority_pre_github(r);$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'native lifecycle replacement drift: require_general_publication_authority(runs)'; END IF;
 -- This exact predecessor already calls research_run_dependencies_visible,
 -- now extended above with native edges/current checks. Preserve it unchanged;
 -- the native_retained_reads_authorized alias would repeat the same graph.
 definition=pg_get_functiondef('guard_research_provider_egress()'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'2a89da157f7f5d1d1073f99317e0bdeb2da3716bbcf035f7c5a882b377322fce' THEN RAISE EXCEPTION 'native lifecycle predecessor drift: guard_research_provider_egress()'; END IF;
 old=$needle$   IF r.id IS NOT NULL AND NOT research_run_dependencies_visible(r.workspace_id,r.id)$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'native lifecycle replacement drift: guard_research_provider_egress()'; END IF;
 -- Preserve this independently guarded send boundary and its single current
 -- traversal. The native alias delegates to that exact same predicate.
 definition=pg_get_functiondef('guard_retained_result_stage()'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'75c85dfb0aa2c83323b5e9cab665c31fe166b6489cffe7edb6d6a95e90ad775f' THEN RAISE EXCEPTION 'native lifecycle predecessor drift: guard_retained_result_stage()'; END IF;
 old=$needle$ IF retained IS NULL OR retained->'decision' IS DISTINCT FROM receipt$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'native lifecycle replacement drift: guard_retained_result_stage()'; END IF;
 EXECUTE replace(definition,old,$replacement$ IF EXISTS(SELECT 1 FROM provider_attempts a WHERE a.id=NEW.attempt_id AND NOT native_retained_reads_authorized(a.workspace_id,a.run_id)) THEN RAISE EXCEPTION 'native retained read authority changed'; END IF;
 IF retained IS NULL OR retained->'decision' IS DISTINCT FROM receipt$replacement$);
END $migration$;
