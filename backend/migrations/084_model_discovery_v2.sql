-- Isolated target candidate: follows 083_source_cohorts_file_envelope.sql.
-- Canonical numbering/adoption belongs to the sole runtime writer.
-- No historical rows, grants, frozen manifests or material changed.
SET LOCAL search_path=pg_catalog,public,pg_temp;
-- Schema pin below must equal sha256(discovery_composition.SCHEMA.material);
-- export_contracts.py regenerates the matching JSON contract (not this SQL).
CREATE TABLE public.model_discovery_receipts_v2 (
 id uuid PRIMARY KEY, workspace_id text NOT NULL, run_id text NOT NULL, phase text NOT NULL,
 decision jsonb NOT NULL, binding jsonb NOT NULL, scope jsonb NOT NULL,
 position jsonb NOT NULL, result jsonb NOT NULL,
 UNIQUE(workspace_id,run_id,phase),
 FOREIGN KEY(workspace_id,run_id) REFERENCES public.runs(workspace_id,id)
);
REVOKE ALL ON public.model_discovery_receipts_v2 FROM PUBLIC;

CREATE FUNCTION public.model_discovery_scope_v2(ws text,rid text) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('workspace',ws,'run',rid,'principal',r.data->'principal_id',
   'generation',r.data->'access_generation','configuration',tool_json_hash(cfg.data),
   'context',coalesce((SELECT jsonb_agg(cid ORDER BY cid) FROM (
     SELECT jsonb_array_elements_text(cfg.data->'responses'->'conversation_ids') cid
     UNION SELECT jsonb_array_elements_text(s.conversation_ids) FROM public.general_context_scopes s
       WHERE s.grant_id=cfg.data->>'grant_id') ids),'[]'::jsonb),
   'reductions',coalesce((SELECT jsonb_agg(sr.selector ORDER BY sr.selector)
     FROM public.tool_scope_reductions sr JOIN public.tool_grants g ON g.id=sr.grant_id
     WHERE g.workspace_id=ws AND g.run_id=rid),'[]'::jsonb))
 FROM public.runs r JOIN public.run_configurations cfg ON cfg.workspace_id=r.workspace_id AND cfg.run_id=r.id
 WHERE r.workspace_id=ws AND r.id=rid
$$;

-- No source identity or position is encoded in the random public receipt ID.
CREATE FUNCTION public.model_discovery_candidates_v2(ws text,rid text,family text,pos jsonb,lim integer)
 RETURNS TABLE("position" jsonb,candidate jsonb) LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.runs; cfg jsonb;
BEGIN
 IF lim NOT BETWEEN 1 AND 65 THEN RAISE EXCEPTION 'bounded discovery scan required'; END IF;
 SELECT * INTO r FROM public.runs WHERE workspace_id=ws AND id=rid;
 SELECT data INTO cfg FROM public.run_configurations WHERE workspace_id=ws AND run_id=rid;
 IF family='discover_retained_references' THEN
   RETURN QUERY SELECT jsonb_build_array(cp.created_at,cp.checkpoint_id,refs.n),refs.ref
   FROM public.run_checkpoints cp CROSS JOIN LATERAL jsonb_array_elements(
     jsonb_build_array(jsonb_build_object('run_id',cp.run_id,'phase',cp.phase,'operation_hash',cp.checkpoint_hash)) ||
     coalesce((SELECT jsonb_agg(jsonb_build_object('run_id',cp.run_id,'phase',s->>'phase','operation_hash',s->>'operation_hash') ORDER BY ordinal)
       FROM jsonb_array_elements(cp.data->'steps') WITH ORDINALITY steps(s,ordinal)
       WHERE nullif(s->>'operation_hash','') IS NOT NULL),'[]'::jsonb)
   ) WITH ORDINALITY refs(ref,n)
   WHERE cp.workspace_id=ws AND cp.conversation_id=r.conversation_id
     AND (pos='null'::jsonb OR (cp.created_at,cp.checkpoint_id,refs.n)<((pos->>0)::timestamptz,pos->>1,(pos->>2)::bigint))
   ORDER BY cp.created_at DESC,cp.checkpoint_id DESC,refs.n DESC LIMIT lim;
 ELSIF family='search_work_context_page' AND NOT cfg ? 'responsibility' THEN
   RETURN QUERY WITH candidates AS (
     SELECT m.conversation_id,'human_message'::text kind,m.id record_id FROM public.conversation_messages m
       WHERE m.workspace_id=ws AND m.author_kind='human' AND m.conversation_id<>r.conversation_id
         AND general_context_scope_permits(cfg,m.conversation_id)
     UNION ALL SELECT a.conversation_id,'saved_revision',a.id FROM public.artifacts a
       WHERE a.workspace_id=ws AND a.conversation_id<>r.conversation_id
         AND general_context_scope_permits(cfg,a.conversation_id)
         AND NOT EXISTS(SELECT 1 FROM public.workspace_files f WHERE f.workspace_id=ws AND f.artifact_id=a.id
           AND f.owner_id<>r.data->>'principal_id'))
     SELECT jsonb_build_array(x.conversation_id,x.kind,x.record_id),
       jsonb_build_object('conversation_id',x.conversation_id,'kind',x.kind,'record_id',x.record_id)
     FROM candidates x WHERE pos='null'::jsonb OR (x.conversation_id,x.kind,x.record_id)>(pos->>0,pos->>1,pos->>2)
     ORDER BY x.conversation_id,x.kind,x.record_id LIMIT lim;
 ELSE RAISE EXCEPTION 'unsupported discovery family'; END IF;
END $$;

-- Identity/material leaf: MUST NOT call the run dependency graph.
CREATE FUNCTION public.model_discovery_work_item_current_v2(r public.runs,source jsonb,query text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cfg jsonb; cv jsonb; material jsonb; body text; rev text; author text;
 created text; expected jsonb; off integer; excerpt text; stamp timestamptz;
BEGIN
 SELECT data INTO cfg FROM public.run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 IF cfg ? 'responsibility' OR NOT public.general_context_scope_permits(cfg,source->>'conversation_id')
   OR source->>'conversation_id'=r.conversation_id THEN RETURN NULL; END IF;
 SELECT data INTO cv FROM public.conversations WHERE workspace_id=r.workspace_id AND id=source->>'conversation_id';
 IF cv IS NULL OR cv->>'owner_id' IS DISTINCT FROM r.data->>'principal_id'
   OR cv->>'state' IS DISTINCT FROM 'open' OR cv->'selected_source_refs' IS DISTINCT FROM '[]'::jsonb
 THEN RETURN NULL; END IF;
 IF source->>'kind'='human_message' THEN
   SELECT data INTO material FROM public.conversation_messages WHERE workspace_id=r.workspace_id
     AND conversation_id=source->>'conversation_id' AND id=source->>'record_id' AND author_kind='human';
   body=material->>'text'; author='human'; created=material->>'created_at';
 ELSIF source->>'kind'='saved_revision' THEN
   SELECT v.data INTO material FROM public.artifacts a JOIN public.revisions v
     ON v.workspace_id=a.workspace_id AND v.artifact_id=a.id AND v.id=a.current_revision_id
     WHERE a.workspace_id=r.workspace_id AND a.id=source->>'record_id' AND a.conversation_id=source->>'conversation_id'
       AND v.data->'body'->>'kind' IS DISTINCT FROM 'file'
       AND NOT EXISTS(SELECT 1 FROM public.workspace_files f WHERE f.workspace_id=a.workspace_id AND f.artifact_id=a.id
         AND f.owner_id<>r.data->>'principal_id');
   body=public.acceptance_canonical_json(material->'body'); rev=material->>'id';
   author=material->>'author_kind'; stamp=(material->>'created_at')::timestamptz;
   created=to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') ||
     CASE WHEN mod(extract(microseconds FROM stamp)::bigint,1000000)=0 THEN ''
       ELSE '.'||to_char(stamp AT TIME ZONE 'UTC','US') END || '+00:00';
 ELSE RETURN NULL; END IF;
 IF material IS NULL OR body IS NULL OR query IS NULL OR query='' OR strpos(body,query)=0 THEN RETURN NULL; END IF;
 off=greatest(0,strpos(body,query)-1-200); excerpt=substring(body FROM off+1 FOR 2000);
 expected=jsonb_build_object('conversation_id',source->>'conversation_id','conversation_work_version',cv->'work_version',
   'title',coalesce(cv->'work_area'->>'title',cv->>'title'),'kind',source->>'kind','record_id',source->>'record_id',
   'revision_id',rev,'content_sha256',encode(sha256(convert_to(body,'UTF8')),'hex'),
   'author_kind',author,'created_at',created);
 RETURN jsonb_build_object('source',expected,'excerpt',excerpt,'excerpt_start',off,
   'truncated',off>0 OR length(excerpt)<length(body));
END $$;

-- Top-level authorization only, never invoked by a graph leaf.
CREATE FUNCTION public.require_discovery_work_item_v2(r public.runs,hit jsonb,query text)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF hit IS DISTINCT FROM public.model_discovery_work_item_current_v2(r,hit->'source',query)
   OR (hit->'source'->>'kind'='saved_revision' AND NOT coalesce(public.memory_revision_visible(
     r.workspace_id,hit->'source'->>'record_id',hit->'source'->>'revision_id'),false))
 THEN RAISE EXCEPTION 'exact current authorized discovery excerpt required'; END IF;
END $$;

CREATE FUNCTION public.require_discovery_retained_item_v2(r public.runs,item jsonb) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE d jsonb; raw bytea; version text;
BEGIN
 d=jsonb_build_object('kind','read_result','run_id',item->>'run_id','phase',item->>'phase',
     'operation_hash',item->>'operation_hash','offset',0,'limit',8192);
 IF NOT coalesce(research_run_dependencies_visible(r.workspace_id,item->>'run_id'),false)
 THEN RAISE EXCEPTION 'retained discovery dependencies changed'; END IF;
 version=retained_projection_version(r,d);
 raw=retained_result_material_versioned(r,d,version);
 IF raw IS NULL OR item IS DISTINCT FROM jsonb_build_object('run_id',d->>'run_id','phase',d->>'phase',
     'operation_hash',d->>'operation_hash','projection_version',version,
     'body_sha256',encode(sha256(raw),'hex'),'body_bytes',octet_length(raw))
 THEN RAISE EXCEPTION 'exact current retained descriptor required'; END IF;
END $$;

-- Derive authorized items independently of caller-supplied receipt data.
CREATE FUNCTION public.model_discovery_project_v2(r public.runs,d jsonb,candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item jsonb; read_decision jsonb; version text; raw bytea;
BEGIN
 IF d->>'kind'='search_work_context_page' THEN
   item=public.model_discovery_work_item_current_v2(r,candidate,d->>'query');
   IF item IS NULL THEN RETURN NULL; END IF;
   IF candidate->>'kind'='saved_revision' AND NOT coalesce(public.memory_revision_visible(
       r.workspace_id,candidate->>'record_id',item->'source'->>'revision_id'),false) THEN RETURN NULL; END IF;
   RETURN item;
 END IF;
 IF NOT coalesce(public.research_run_dependencies_visible(r.workspace_id,candidate->>'run_id'),false) THEN RETURN NULL; END IF;
 read_decision=candidate||jsonb_build_object('kind','read_result','offset',0,'limit',8192);
 BEGIN
   version=public.retained_projection_version(r,read_decision);
   raw=public.retained_result_material_versioned(r,read_decision,version);
 EXCEPTION WHEN raise_exception THEN RETURN NULL; -- legacy material signals authorization denial with P0001
 END;
 IF raw IS NULL THEN RETURN NULL; END IF;
 RETURN candidate||jsonb_build_object('projection_version',version,'body_sha256',encode(sha256(raw),'hex'),'body_bytes',octet_length(raw));
END $$;

CREATE FUNCTION public.model_discovery_page_v2(ws text,rid text,d jsonb,pos jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.runs; rows jsonb; entry jsonb; item jsonb; items jsonb='[]'; ending jsonb='null'; consumed integer=0;
BEGIN
 SELECT * INTO r FROM public.runs WHERE workspace_id=ws AND id=rid;
 IF r.id IS NULL OR (d->>'limit')::integer NOT BETWEEN 1 AND
   (CASE WHEN d->>'kind'='search_work_context_page' THEN 6 ELSE 12 END) THEN RAISE EXCEPTION 'bounded page required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('position',x.position,'candidate',x.candidate) ORDER BY x.ordinal),'[]'::jsonb)
 INTO rows FROM public.model_discovery_candidates_v2(ws,rid,d->>'kind',pos,65) WITH ORDINALITY x(position,candidate,ordinal);
 FOR entry IN SELECT value FROM jsonb_array_elements(rows) WITH ORDINALITY x(value,n) WHERE n<=64 ORDER BY n LOOP
   consumed=consumed+1; ending=entry->'position';
   item=public.model_discovery_project_v2(r,d,entry->'candidate');
   IF item IS NOT NULL AND NOT items @> jsonb_build_array(item) THEN items=items||jsonb_build_array(item); END IF;
   EXIT WHEN jsonb_array_length(items)=(d->>'limit')::integer;
 END LOOP;
 RETURN jsonb_build_object('items',items,'position',ending,'has_more',consumed<jsonb_array_length(rows));
END $$;

CREATE FUNCTION public.guard_model_discovery_receipt_v2() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.runs; cfg jsonb; selected jsonb; step public.responses_steps; b jsonb; expected_binding jsonb;
        prior public.model_discovery_receipts_v2; pos jsonb='null'; candidates jsonb; item jsonb; candidate jsonb;
        n integer; max_items integer; ending integer; more boolean;
BEGIN
 SELECT * INTO r FROM public.runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 PERFORM id FROM public.workspaces WHERE id=r.workspace_id FOR UPDATE;
 PERFORM require_general_publication_authority(r);
 IF NOT coalesce(public.tool_run_available(r.workspace_id,r.id),false) THEN RAISE EXCEPTION 'current tool authority required'; END IF;
 SELECT data INTO cfg FROM public.run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 IF cfg->'responses'->>'scope_tool_sha256' IS DISTINCT FROM 'e662b6d28c9bd98bd3e0f9e9ed5f417081dd18d3f81f3c2eed71a56535a4c591'
   OR cfg->'responses'->>'continuity_version' IS DISTINCT FROM 'sustained-v1'
   OR cfg->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
 THEN RAISE EXCEPTION 'opted-in discovery v2 schema required'; END IF;
 SELECT e.data INTO selected FROM public.responses_events e JOIN public.provider_attempts a ON a.id=e.attempt_id
   WHERE a.workspace_id=r.workspace_id AND a.run_id=r.id AND e.attempt_id=NEW.binding->>'attempt_id'
     AND e.phase=NEW.phase AND e.kind='result';
 SELECT * INTO step FROM public.responses_steps WHERE attempt_id=NEW.binding->>'attempt_id' AND phase=NEW.phase;
 expected_binding=jsonb_build_object('attempt_id',step.attempt_id,'selection_request_sha256',step.request_sha256,
   'selection_response_id',selected->>'response_id','decision_sha256',tool_json_hash(selected->'value'),
   'operation_hash',tool_json_hash(NEW.decision),'base_hash',NULL);
 IF selected IS NULL OR step.attempt_id IS NULL OR selected->>'state' IS DISTINCT FROM 'function_call'
   OR selected->>'request_sha256' IS DISTINCT FROM step.request_sha256
   OR NOT EXISTS(SELECT 1 FROM public.provider_attempts a WHERE a.id=step.attempt_id AND a.workspace_id=r.workspace_id AND a.run_id=r.id)
   OR NEW.decision IS DISTINCT FROM selected->'value'->'decision' OR NEW.binding IS DISTINCT FROM expected_binding
   OR NEW.scope IS DISTINCT FROM public.model_discovery_scope_v2(r.workspace_id,r.id)
   OR (NEW.phase<>'selection' AND NEW.phase !~ '^selection_[2-8]$')
   OR (CASE WHEN NEW.phase='selection' THEN 1 ELSE substring(NEW.phase FROM 11)::integer END)>(cfg->'responses'->>'max_steps')::integer
 THEN RAISE EXCEPTION 'exact current discovery selection required'; END IF;
 IF NEW.decision->>'kind'='discover_retained_references' THEN
   max_items=12;
   IF NEW.decision-ARRAY['kind','cursor','limit']<>'{}'::jsonb THEN RAISE EXCEPTION 'unknown discovery fields'; END IF;
 ELSIF NEW.decision->>'kind'='search_work_context_page' AND NOT cfg ? 'responsibility' THEN
   max_items=6;
   IF jsonb_typeof(NEW.decision->'query') IS DISTINCT FROM 'string' OR length(NEW.decision->>'query') NOT BETWEEN 1 AND 240 OR NEW.decision->>'query' IS NULL
     OR NEW.decision-ARRAY['kind','cursor','limit','query']<>'{}'::jsonb THEN RAISE EXCEPTION 'bounded query required'; END IF;
 ELSE RAISE EXCEPTION 'unknown discovery operation'; END IF;
 IF jsonb_typeof(NEW.decision->'limit') IS DISTINCT FROM 'number'
   OR (NEW.decision->>'limit')::integer NOT BETWEEN 1 AND max_items
   OR NOT NEW.decision ? 'cursor' THEN RAISE EXCEPTION 'bounded page required'; END IF;
 IF NEW.decision->>'cursor' IS NOT NULL THEN
   SELECT * INTO prior FROM public.model_discovery_receipts_v2 WHERE id=(NEW.decision->>'cursor')::uuid
     AND workspace_id=r.workspace_id AND run_id=r.id;
   IF prior.id IS NULL OR prior.scope IS DISTINCT FROM NEW.scope
     OR prior.decision-'cursor' IS DISTINCT FROM NEW.decision-'cursor'
     OR prior.result->'has_more' IS DISTINCT FROM 'true'::jsonb
   THEN RAISE EXCEPTION 'cursor scope or query changed'; END IF;
   pos=prior.position;
 END IF;
 candidates=public.model_discovery_page_v2(r.workspace_id,r.id,NEW.decision,pos);
 IF NEW.position IS DISTINCT FROM candidates->'position'
   OR NEW.result IS DISTINCT FROM jsonb_build_object('items',candidates->'items','has_more',candidates->'has_more',
     'next_cursor',CASE WHEN (candidates->>'has_more')::boolean THEN NEW.id::text ELSE NULL END,
     'authority','Untrusted read-only context; not edit authority or evidence of completion.')
 THEN RAISE EXCEPTION 'exact independently derived discovery page required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER model_discovery_receipt_v2 BEFORE INSERT ON public.model_discovery_receipts_v2
 FOR EACH ROW EXECUTE FUNCTION public.guard_model_discovery_receipt_v2();
CREATE FUNCTION public.immutable_model_discovery_receipt_v2() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'discovery receipts are immutable'; END $$;
CREATE TRIGGER immutable_model_discovery_receipt_v2 BEFORE UPDATE OR DELETE ON public.model_discovery_receipts_v2
 FOR EACH ROW EXECUTE FUNCTION public.immutable_model_discovery_receipt_v2();

CREATE FUNCTION public.guard_model_discovery_stage_v2() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE chosen jsonb; receipt public.model_discovery_receipts_v2; r public.runs; item jsonb;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data->'value'->'decision' INTO chosen FROM public.responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF NOT (coalesce(chosen->>'kind','') IN ('discover_retained_references','search_work_context_page')
   OR coalesce(NEW.data->'decision'->>'kind','') IN ('discover_retained_references','search_work_context_page')
   OR coalesce(NEW.data->'capability_result'->>'capability','') IN ('discover_retained_references','search_work_context_page'))
 THEN RETURN NEW; END IF;
 SELECT rr.* INTO r FROM public.runs rr JOIN public.provider_attempts a ON a.workspace_id=rr.workspace_id AND a.run_id=rr.id WHERE a.id=NEW.attempt_id;
 PERFORM require_general_publication_authority(r);
 SELECT * INTO receipt FROM public.model_discovery_receipts_v2 WHERE workspace_id=r.workspace_id AND run_id=r.id AND phase=NEW.phase;
 IF receipt.id IS NULL OR receipt.scope IS DISTINCT FROM public.model_discovery_scope_v2(r.workspace_id,r.id)
   OR receipt.decision IS DISTINCT FROM chosen OR NEW.data->'decision' IS DISTINCT FROM chosen
   OR receipt.binding IS DISTINCT FROM NEW.data->'binding'
   OR NEW.data->'capability_result' IS DISTINCT FROM jsonb_build_object('capability',chosen->>'kind','version','2','result',receipt.result)
   OR NEW.data->>'status' IS DISTINCT FROM 'reply' OR coalesce(NEW.data->>'terminal_outcome','') NOT IN ('continue','step_limit')
   OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
   OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'needs_validation'
   OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb OR NEW.data->'file' IS DISTINCT FROM 'null'::jsonb
   OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'exact discovery receipt required before model consumption'; END IF;
 FOR item IN SELECT jsonb_array_elements(receipt.result->'items') LOOP
   IF chosen->>'kind'='search_work_context_page' THEN PERFORM public.require_discovery_work_item_v2(r,item,chosen->>'query');
   ELSE PERFORM public.require_discovery_retained_item_v2(r,item); END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER model_discovery_stage_v2 BEFORE INSERT ON public.responses_events FOR EACH ROW EXECUTE FUNCTION public.guard_model_discovery_stage_v2();

-- A nonrecursive leaf on the existing UNION dependency graph protects model
-- sends, retained copies and publication, including transitive copied evidence.
-- Do not touch 029's original frozen-index guard or its v1 receipt semantics.
CREATE FUNCTION public.model_discovery_work_material_current_v2(ws text,rid text) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public.runs; receipt public.model_discovery_receipts_v2; item jsonb;
BEGIN
 SELECT * INTO r FROM public.runs WHERE workspace_id=ws AND id=rid;
 FOR receipt IN SELECT * FROM public.model_discovery_receipts_v2 WHERE workspace_id=ws AND run_id=rid
   AND decision->>'kind'='search_work_context_page' LOOP
   IF receipt.scope IS DISTINCT FROM public.model_discovery_scope_v2(ws,rid) THEN RETURN false; END IF;
   FOR item IN SELECT jsonb_array_elements(receipt.result->'items') LOOP
     IF item IS DISTINCT FROM public.model_discovery_work_item_current_v2(r,item->'source',receipt.decision->>'query') THEN RETURN false; END IF;
   END LOOP;
 END LOOP;
 RETURN true;
 EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
-- Identity-only edges are traversed by the existing UNION graph (not UNION ALL).
CREATE FUNCTION public.model_discovery_work_producers_v2(ws text,rid text) RETURNS TABLE(run_id text)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT p.run_id FROM public.model_discovery_receipts_v2 receipt
 CROSS JOIN LATERAL jsonb_array_elements(receipt.result->'items') item
 CROSS JOIN LATERAL public.memory_revision_producers(ws,item->'source'->>'record_id',item->'source'->>'revision_id') p
 WHERE receipt.workspace_id=ws AND receipt.run_id=rid
   AND receipt.decision->>'kind'='search_work_context_page' AND item->'source'->>'kind'='saved_revision'
$$;
DO $$ DECLARE body text; old text; BEGIN
 body=pg_get_functiondef('public.research_run_dependencies_visible(text,text)'::regprocedure);
 old='  ) edge';
 IF (length(body)-length(replace(body,old,'')))<>length(old) THEN RAISE EXCEPTION '082 dependency edge predecessor drift'; END IF;
 body=replace(body,old,'    UNION SELECT p.run_id FROM public.model_discovery_work_producers_v2(ws,d.run_id) p
'||old);

 old='AND NOT EXISTS(SELECT 1 FROM dependencies d WHERE NOT native_retained_reads_current(ws,d.run_id))';
 IF (length(body)-length(replace(body,old,'')))<>length(old) THEN RAISE EXCEPTION '082 dependency graph predecessor drift'; END IF;
 EXECUTE replace(body,old,old||'
 AND NOT EXISTS(SELECT 1 FROM dependencies d WHERE NOT public.model_discovery_work_material_current_v2(ws,d.run_id))');
END $$;

-- Public check includes producers; the graph uses only the material leaf above.
CREATE FUNCTION public.model_discovery_work_current_v2(ws text,rid text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public.model_discovery_work_material_current_v2(ws,rid)
   AND public.research_run_dependencies_visible(ws,rid)
$$;

-- Extend 073 admission for new bindings only. Never mutate a grant/request.
DO $$ DECLARE body text; old text; BEGIN
 body=pg_get_functiondef('public.require_alpha_budget_binding(jsonb)'::regprocedure);
 old=$q$b->>'scope_tool_sha256' IS DISTINCT FROM '1073c3bc5d71a3de2126733c224ecd729605965f39917709d56934c868bc7f41'$q$;
 IF (length(body)-length(replace(body,old,'')))<>length(old) THEN RAISE EXCEPTION '073 treatment predecessor drift'; END IF;
 EXECUTE replace(body,old,$q$coalesce(b->>'scope_tool_sha256','') NOT IN ('1073c3bc5d71a3de2126733c224ecd729605965f39917709d56934c868bc7f41','e662b6d28c9bd98bd3e0f9e9ed5f417081dd18d3f81f3c2eed71a56535a4c591')$q$);
END $$;
ALTER FUNCTION public.require_alpha_budget_binding(jsonb) SET search_path=pg_catalog,public,pg_temp;

-- Extend existing classification only; keep all current tool authority checks.
DO $$ DECLARE body text; old text; name text;
BEGIN
 body=pg_get_functiondef('guard_tool_consumption()'::regprocedure);
 old=$q$'reply','stop','read_result'$q$;
 IF (length(body)-length(replace(body,old,'')))<>length(old) THEN RAISE EXCEPTION '080 classifier predecessor drift'; END IF;
 EXECUTE replace(body,old,$q$'reply','stop','discover_retained_references','search_work_context_page','read_result'$q$);
 body=pg_get_functiondef('guard_alpha_stage()'::regprocedure);
 old=$q$'discover_capabilities','load_skill','read_context','read_saved_work','discover_saved_work'$q$;
 IF (length(body)-length(replace(body,old,'')))<>length(old) THEN RAISE EXCEPTION 'alpha discovery predecessor drift'; END IF;
 body=replace(body,old,old||$q$,'discover_retained_references','search_work_context_page'$q$);
 old=$q$observation->>'version' IS DISTINCT FROM '1'$q$;
 IF (length(body)-length(replace(body,old,'')))<>length(old) THEN RAISE EXCEPTION 'alpha version predecessor drift'; END IF;
 EXECUTE replace(body,old,$q$observation->>'version' IS DISTINCT FROM (CASE WHEN selection->>'kind' IN ('discover_retained_references','search_work_context_page') THEN '2' ELSE '1' END)$q$);
 FOREACH name IN ARRAY ARRAY['require_run_successor(public.runs,jsonb)','guard_retained_result_read()'] LOOP
   body=pg_get_functiondef(name::regprocedure); old=$q$'1073c3bc5d71a3de2126733c224ecd729605965f39917709d56934c868bc7f41'$q$;
   IF (length(body)-length(replace(body,old,'')))<>length(old) THEN RAISE EXCEPTION 'delegation schema predecessor drift'; END IF;
   EXECUTE replace(body,old,old||$q$,'e662b6d28c9bd98bd3e0f9e9ed5f417081dd18d3f81f3c2eed71a56535a4c591'$q$);
 END LOOP;
END $$;
-- These predecessor guards are extended above; pin their execution context too.
ALTER FUNCTION public.guard_tool_consumption() SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.guard_alpha_stage() SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.require_run_successor(public.runs,jsonb) SET search_path=pg_catalog,public,pg_temp;
ALTER FUNCTION public.guard_retained_result_read() SET search_path=pg_catalog,public,pg_temp;
DO $$ DECLARE role_name text; BEGIN
 FOR role_name IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='responses_events' AND privilege_type='INSERT'
     AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP EXECUTE format('GRANT SELECT,INSERT ON public.model_discovery_receipts_v2 TO %I',role_name); END LOOP;
END $$;
