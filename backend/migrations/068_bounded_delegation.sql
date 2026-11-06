-- Optional local analysis children. No new ambient worker or paid processor.
ALTER FUNCTION tool_file_resources_authorized(text,text,jsonb) RENAME TO tool_resources_pre_delegation;
CREATE FUNCTION tool_file_resources_authorized(ws text,rid text,payload jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE args jsonb; launch jsonb; prior tool_attempts; obs jsonb; refs jsonb; processor jsonb; mapped jsonb;
BEGIN
 IF payload->>'capability_id' NOT IN ('delegation.analysis','delegation.verify') THEN
   IF EXISTS(SELECT 1 FROM capability_installations i WHERE i.id=payload->>'capability_id'
       AND i.version=payload->>'capability_version' AND i.descriptor->'effects' @> '["draft"]'::jsonb)
      AND NOT delegation_reviewed(ws,rid) THEN RETURN false; END IF;
   RETURN tool_resources_pre_delegation(ws,rid,payload);
 END IF;
 args=payload->'arguments'; launch=args;
 IF payload->>'capability_id'='delegation.verify' THEN
   IF args->>'kind' IS DISTINCT FROM 'verify_delegate'
     OR args-ARRAY['kind','child_attempt_id','proposal_sha256','inspection','code']<>'{}'::jsonb
     OR length(args->>'inspection') NOT BETWEEN 1 AND 2000 THEN RETURN false; END IF;
   SELECT * INTO prior FROM tool_attempts WHERE workspace_id=ws AND run_id=rid
     AND id=args->>'child_attempt_id' AND capability_id='delegation.analysis';
   SELECT data INTO obs FROM tool_attempt_events WHERE attempt_id=prior.id AND kind='observation';
   IF prior.id IS NULL OR obs->>'status' IS DISTINCT FROM 'observed'
     OR obs->'output'->'result'->>'proposal_sha256' IS DISTINCT FROM args->>'proposal_sha256'
     OR obs->'output'->'result'->>'state' IS DISTINCT FROM 'proposal'
     OR NOT tool_file_resources_authorized(ws,rid,prior.call) THEN RETURN false; END IF;
   launch=prior.call->'arguments';
 ELSE
   IF args->>'kind' IS DISTINCT FROM 'delegate_analysis'
     OR args-ARRAY['kind','task','independent_benefit','output_contract','code','inputs']<>'{}'::jsonb
     OR length(args->>'task') NOT BETWEEN 1 AND 2000
     OR length(args->>'output_contract') NOT BETWEEN 1 AND 2000
     OR length(args->>'independent_benefit') NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
 END IF;
 IF jsonb_typeof(args->'code') IS DISTINCT FROM 'string' OR octet_length(args->>'code') NOT BETWEEN 1 AND 65536
   OR jsonb_typeof(launch->'inputs') IS DISTINCT FROM 'array' OR jsonb_array_length(launch->'inputs')>6
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(launch->'inputs') i WHERE i->>'name' IN ('task.json','child.json'))
 THEN RETURN false; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind','workspace_file','id',i->'ref'->>'workspace_file_id',
   'version',i->'ref'->>'version_id','sha256',i->'ref'->>'sha256') ORDER BY n),'[]'::jsonb)
 INTO refs FROM jsonb_array_elements(launch->'inputs') WITH ORDINALITY AS x(i,n);
 processor=jsonb_build_array(jsonb_build_object('kind','processor','id','local-confined-analysis-v1',
   'version','1','sha256',tool_json_hash(to_jsonb('local-confined-analysis-v1'::text))));
 IF payload->'input_refs' IS DISTINCT FROM refs||processor THEN RETURN false; END IF;
 mapped=jsonb_build_object('capability_id','compute.python','arguments',jsonb_build_object(
   'kind','compute_python','code',launch->>'code','inputs',launch->'inputs'),'input_refs',refs);
 RETURN tool_resources_pre_delegation(ws,rid,mapped) AND NOT EXISTS(
   SELECT 1 FROM tool_scope_reductions sr JOIN tool_grants g ON g.id=sr.grant_id
   WHERE g.workspace_id=ws AND g.run_id=rid AND (refs||processor) @> jsonb_build_array(sr.selector));
END $$;

-- Existing reservation already holds workspace and cumulative-budget locks.
-- Idempotent replay returns before INSERT; novel IDs cannot manufacture capacity.
CREATE FUNCTION guard_delegation_bound() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.capability_id='delegation.analysis' AND EXISTS(
   SELECT 1 FROM tool_attempts a LEFT JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation'
   WHERE a.workspace_id=NEW.workspace_id AND a.run_id=NEW.run_id AND a.capability_id='delegation.analysis'
     AND (a.call->'arguments'=NEW.call->'arguments' OR e.data->>'status'='outcome_unknown'
       OR (e.data IS NULL AND a.run_fence<>NEW.run_fence AND EXISTS(SELECT 1 FROM tool_attempt_events d WHERE d.attempt_id=a.id AND d.kind='dispatch'))))
 THEN RAISE EXCEPTION 'duplicate or unresolved child launch'; END IF;
 IF NEW.capability_id='delegation.analysis' AND
   (SELECT count(*) FROM tool_attempts WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id
     AND capability_id='delegation.analysis')>=2 THEN RAISE EXCEPTION 'two child run bound exhausted'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bounded_delegation BEFORE INSERT ON tool_attempts FOR EACH ROW EXECUTE FUNCTION guard_delegation_bound();

-- Retained results and publication must recheck exact child source/processor ACLs.
ALTER FUNCTION research_tool_dependencies_visible(text,text) RENAME TO tool_dependencies_pre_delegation;
CREATE FUNCTION research_tool_dependencies_visible(ws text,aid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT tool_dependencies_pre_delegation(ws,aid) AND NOT EXISTS(
   SELECT 1 FROM tool_attempts a WHERE a.workspace_id=ws AND a.id=aid
     AND a.capability_id IN ('delegation.analysis','delegation.verify')
     AND NOT tool_file_resources_authorized(ws,a.run_id,a.call))
$$;

CREATE FUNCTION delegation_reviewed(ws text,rid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS(
   SELECT 1 FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation'
   WHERE a.workspace_id=ws AND a.run_id=rid AND a.capability_id='delegation.analysis'
     AND e.data->>'status'='observed' AND e.data->'output'->'result'->>'state'='proposal'
     AND NOT EXISTS(SELECT 1 FROM tool_attempts v JOIN tool_attempt_events ve ON ve.attempt_id=v.id AND ve.kind='observation'
       WHERE v.workspace_id=ws AND v.run_id=rid AND v.capability_id='delegation.verify'
         AND v.call->'arguments'->>'child_attempt_id'=a.id
         AND v.call->'arguments'->>'proposal_sha256'=e.data->'output'->'result'->>'proposal_sha256'
         AND ve.data->>'status'='observed' AND ve.data->'output'->'result'->>'state' IN ('checks_passed','discarded')
         AND tool_file_resources_authorized(ws,rid,v.call)))
$$;
CREATE FUNCTION guard_delegation_assimilation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs;
BEGIN
 IF NEW.kind='tool_result' AND NEW.data->'decision'->>'kind' IN
   ('reply','publish_artifact','run_wasm','reconcile_csv','compute_python','files_create_draft','files_propose_patch','artifacts_export','artifacts_export_office') THEN
   SELECT rr.* INTO r FROM runs rr JOIN provider_attempts a ON a.workspace_id=rr.workspace_id AND a.run_id=rr.id WHERE a.id=NEW.attempt_id;
   PERFORM id FROM workspaces WHERE id=r.workspace_id FOR UPDATE;
   IF NOT delegation_reviewed(r.workspace_id,r.id) THEN RAISE EXCEPTION 'parent inspection and executed verification required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delegation_assimilation BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION guard_delegation_assimilation();

-- Child evidence cannot silently become an adopted procedure. Even the separately
-- executed verifier is only evidence for the existing human-reviewed lifecycle.
ALTER FUNCTION memory_procedure_evidence_authorized(text,text,text,text,jsonb) RENAME TO memory_evidence_pre_delegation;
CREATE FUNCTION memory_procedure_evidence_authorized(ws text,owner text,sk text,sid text,evidence jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT memory_evidence_pre_delegation(ws,owner,sk,sid,evidence) AND NOT EXISTS(
   SELECT 1 FROM tool_attempts a WHERE a.workspace_id=ws AND a.id=evidence->>'event_id'
     AND evidence->>'kind'='tool_observation' AND a.capability_id='delegation.analysis')
$$;

DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['require_run_successor(runs,jsonb)','guard_retained_result_read()'] LOOP
   definition=pg_get_functiondef(name::regprocedure);
   old=$q$'6902a690319c3df4c57a20ec025d3d125a70ac26777090b35fb9e0eeda09d689'$q$;
   IF position(old in definition)=0 THEN RAISE EXCEPTION 'delegation schema predecessor drift'; END IF;
   EXECUTE replace(definition,old,old||$q$,'1073c3bc5d71a3de2126733c224ecd729605965f39917709d56934c868bc7f41'$q$);
 END LOOP;
END $$;

DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['guard_tool_consumption()','guard_alpha_stage()','guard_file_tool_stage()'] LOOP
   definition=pg_get_functiondef(name::regprocedure); old=$q$'mcp_read'$q$;
   IF position(old in definition)=0 THEN RAISE EXCEPTION 'delegation operation predecessor drift'; END IF;
   EXECUTE replace(definition,old,old||$q$,'delegate_analysis','verify_delegate'$q$);
 END LOOP;
END $$;
