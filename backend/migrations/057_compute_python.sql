-- B3.1a: additive confined computation; old file/model schemas stay frozen.
ALTER FUNCTION tool_file_resources_authorized(text,text,jsonb) RENAME TO tool_native_file_resources_authorized;
CREATE FUNCTION tool_file_resources_authorized(ws text,rid text,payload jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE expected jsonb; item jsonb; args jsonb; mapped jsonb;
BEGIN
 IF payload->>'capability_id' IS DISTINCT FROM 'compute.python' THEN
   RETURN tool_native_file_resources_authorized(ws,rid,payload);
 END IF;
 args=payload->'arguments';
 IF args->>'kind' IS DISTINCT FROM 'compute_python' OR jsonb_typeof(args->'inputs') IS DISTINCT FROM 'array'
    OR jsonb_typeof(args->'code') IS DISTINCT FROM 'string'
    OR octet_length(args->>'code') NOT BETWEEN 1 AND 65536 OR jsonb_array_length(args->'inputs')>8
 THEN RETURN false; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind','workspace_file','id',i->'ref'->>'workspace_file_id',
   'version',i->'ref'->>'version_id','sha256',i->'ref'->>'sha256') ORDER BY n),'[]'::jsonb)
 INTO expected FROM jsonb_array_elements(args->'inputs') WITH ORDINALITY AS x(i,n);
 IF payload->'input_refs' IS DISTINCT FROM expected THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(args->'inputs') LOOP
   mapped=jsonb_build_object('capability_id','files.read_range','arguments',jsonb_build_object('ref',item->'ref'),
     'input_refs',jsonb_build_array(jsonb_build_object('kind','workspace_file','id',item->'ref'->>'workspace_file_id',
       'version',item->'ref'->>'version_id','sha256',item->'ref'->>'sha256')));
   IF NOT tool_native_file_resources_authorized(ws,rid,mapped) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION authorize_compute_export(ws text,owner text,manifest jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE a tool_attempts; d jsonb; r runs;
BEGIN
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 SELECT * INTO a FROM tool_attempts WHERE workspace_id=ws AND id=manifest->>'tool_attempt_id'
   AND run_id=manifest->>'run_id' AND capability_id='compute.python';
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=a.run_id;
 SELECT descriptor INTO d FROM capability_installations WHERE id=a.capability_id AND version=a.capability_version AND enabled;
 RETURN coalesce(a.id IS NOT NULL AND r.data->>'principal_id'=owner AND r.conversation_id=manifest->>'conversation_id'
   AND tool_authorized(ws,a.run_id,a.run_fence,a.lease_hash,a.grant_id,(a.call->>'expected_work_version')::bigint)
   AND tool_file_resources_authorized(ws,a.run_id,a.call)
   AND a.scope_sha256=tool_scope_hash(ws,a.run_id) AND d=a.descriptor
   AND a.call->'input_refs'=manifest->'input_refs'
   AND manifest->>'code_sha256'=encode(sha256(convert_to(a.call->'arguments'->>'code','UTF8')),'hex')
   AND EXISTS(SELECT 1 FROM tool_attempt_events WHERE attempt_id=a.id AND kind='dispatch')
   AND NOT EXISTS(SELECT 1 FROM tool_attempt_events WHERE attempt_id=a.id AND kind='observation'),false);
END $$;

DO $$ DECLARE definition text; old text;
BEGIN
 definition=pg_get_functiondef('guard_artifact_export()'::regprocedure);
 old=$q$ IF NEW.data->>'workspace_file_id' IS NOT NULL THEN$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'export predecessor drift'; END IF;
 EXECUTE replace(definition,old,$q$
  IF NEW.data->>'exporter_version'='compute-python-v1' THEN
    IF NOT authorize_compute_export(NEW.workspace_id,NEW.owner_id,NEW.data) THEN
      RAISE EXCEPTION 'current confined compute authority required';
    END IF;
    RETURN NEW;
  END IF;
$q$||old);
 definition=pg_get_functiondef('settle_tool_call(text,text,jsonb)'::regprocedure);
 old=$q$'kind','run_scope','id',a.run_id,'version',a.call->>'expected_work_version','sha256',a.scope_sha256))$q$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'observation predecessor drift'; END IF;
 EXECUTE replace(definition,old,old||$q$ || (CASE WHEN a.capability_id='compute.python' AND observation->>'status'='observed'
   THEN a.call->'input_refs' ELSE '[]'::jsonb END)$q$);
END $$;

-- Opt-in consumption, stage and successor checks admit the new exact schema only.
DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['guard_tool_consumption()','guard_alpha_stage()','guard_file_tool_stage()'] LOOP
   definition=pg_get_functiondef(name::regprocedure);
   old=$q$'files_compare','artifacts_export'$q$;
   IF position(old in definition)=0 THEN RAISE EXCEPTION 'composition predecessor drift'; END IF;
   EXECUTE replace(definition,old,old||$q$,'compute_python'$q$);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['require_run_successor(runs,jsonb)','guard_retained_result_read()'] LOOP
   definition=pg_get_functiondef(name::regprocedure);
   old=$q$'367cd20e751544b98b18717718f63f37b5221e551afdc7537dfbb239e2ff896f'$q$;
   IF position(old in definition)=0 THEN RAISE EXCEPTION 'sustained predecessor drift'; END IF;
   EXECUTE replace(definition,old,old||$q$,'b9f18beb013a8cd3f102959bf15a9fa290fbee43281077edc6e71abc547e5d61'$q$);
 END LOOP;
END $$;
