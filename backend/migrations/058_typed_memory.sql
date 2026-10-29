-- B3.1b owner-private typed memory. No history extraction or existing-row backfill.
CREATE TABLE memory_items (
 workspace_id text NOT NULL, id text NOT NULL, owner_id text NOT NULL, current_revision_id text,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,principal_id)
);
CREATE TABLE memory_revisions (
 workspace_id text NOT NULL, memory_id text NOT NULL, id text NOT NULL,
 recorded_at timestamptz NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,memory_id,id),
 FOREIGN KEY(workspace_id,memory_id) REFERENCES memory_items(workspace_id,id),
 CHECK((data->>'workspace_id'=workspace_id AND data->>'memory_id'=memory_id AND data->>'revision_id'=id
   AND data->>'kind' IN ('fact','preference','project_convention','episode','procedure')
   AND data->>'scope_kind' IN ('task','work_area','user')
   AND data->>'status' IN ('candidate','active','contested','superseded','expired','forgotten')
   AND data->>'origin' IN ('human_explicit','human_reviewed','agent_inferred','external_source','tool_observed')
   AND data->>'confidence_label' IN ('explicit','observed','inferred','uncertain')
   AND (data->>'access_generation')::bigint>0) IS TRUE),
 CHECK(data->>'status'='forgotten' OR (data->>'content_sha256'=encode(sha256(convert_to(data->>'content','UTF8')),'hex')) IS TRUE)
);
ALTER TABLE memory_items ADD FOREIGN KEY(workspace_id,id,current_revision_id)
 REFERENCES memory_revisions(workspace_id,memory_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX memory_owner ON memory_items(workspace_id,owner_id,id);
CREATE TABLE memory_evidence (
 workspace_id text NOT NULL, memory_id text NOT NULL, revision_id text NOT NULL,
 source_fingerprint text NOT NULL, source_ref jsonb NOT NULL,
 PRIMARY KEY(workspace_id,revision_id,source_fingerprint),
 FOREIGN KEY(workspace_id,memory_id,revision_id) REFERENCES memory_revisions(workspace_id,memory_id,id)
);
CREATE TABLE memory_tombstones (
 workspace_id text NOT NULL, owner_id text NOT NULL, memory_id text NOT NULL,
 scope_kind text NOT NULL, scope_id text NOT NULL, key_sha256 text NOT NULL,
 source_fingerprint text NOT NULL, forgotten_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,owner_id,scope_kind,scope_id,key_sha256,source_fingerprint,memory_id)
);
CREATE TABLE memory_scope_bindings (
 workspace_id text NOT NULL, owner_id text NOT NULL, conversation_id text NOT NULL,
 work_area_id text NOT NULL, work_version bigint NOT NULL,
 PRIMARY KEY(workspace_id,conversation_id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id),
 FOREIGN KEY(workspace_id,work_area_id) REFERENCES conversations(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,principal_id)
);
CREATE TABLE memory_usage (
 workspace_id text NOT NULL, run_id text NOT NULL, request_id text NOT NULL,
 attempt_id text NOT NULL, phase text NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,run_id,attempt_id,phase),
 FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id)
);
CREATE TRIGGER immutable_memory_usage BEFORE UPDATE OR DELETE ON memory_usage FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_memory_tombstones BEFORE UPDATE OR DELETE ON memory_tombstones FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_memory_bindings BEFORE UPDATE OR DELETE ON memory_scope_bindings FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Only table-owner functions can erase payload. A caller-set GUC is not authority.
CREATE FUNCTION guard_memory_revision_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='memory_revisions'::regclass))
    OR current_setting('workagent.memory_erasure',true) IS DISTINCT FROM 'on' OR TG_OP<>'UPDATE'
    OR NEW.data->>'status'<>'forgotten' OR NEW.id<>OLD.id OR NEW.memory_id<>OLD.memory_id
    OR NEW.workspace_id<>OLD.workspace_id OR NEW.recorded_at<>OLD.recorded_at
 THEN RAISE EXCEPTION 'immutable memory revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_memory_revisions BEFORE UPDATE OR DELETE ON memory_revisions FOR EACH ROW EXECUTE FUNCTION guard_memory_revision_change();

CREATE FUNCTION memory_scope_authorized(ws text,owner text,scope text,sid text) RETURNS boolean
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cv jsonb; ref jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=ws AND principal_id=owner AND active AND role<>'viewer') THEN RETURN false; END IF;
 IF scope='user' THEN RETURN sid=owner; END IF;
 IF scope NOT IN ('task','work_area') THEN RETURN false; END IF;
 SELECT data INTO cv FROM conversations WHERE workspace_id=ws AND id=sid AND data->>'owner_id'=owner;
 IF cv IS NULL OR (scope='work_area' AND (cv->'work_area' IS NULL OR cv->'work_area'='null'::jsonb)) THEN RETURN false; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(cv->'selected_source_refs') LOOP
   IF NOT EXISTS(SELECT 1 FROM sources s JOIN source_access a ON a.workspace_id=s.workspace_id AND a.source_id=s.id
      WHERE s.workspace_id=ws AND s.id=ref->>'source_id' AND a.principal_id=owner AND a.active
       AND (s.data->>'available')::boolean AND s.data->>'external_version'=ref->>'external_version') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION write_memory_revision(ws text,owner text,operation text,expected text,payload jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old jsonb; mid text; rid text; generation bigint; ref jsonb; keyhash text; prior_status text;
BEGIN
 SELECT access_generation INTO generation FROM workspaces WHERE id=ws FOR UPDATE;
 mid=payload->>'memory_id'; rid=payload->>'revision_id';
 IF NOT memory_scope_authorized(ws,owner,payload->>'scope_kind',payload->>'scope_id')
   OR payload->>'workspace_id' IS DISTINCT FROM ws OR payload->>'owner_id' IS DISTINCT FROM owner
   OR (payload->>'access_generation')::bigint IS DISTINCT FROM generation
   OR payload->>'proposed_by_run_id' IS NOT NULL OR payload->'evidence_ids' IS DISTINCT FROM '[]'::jsonb
   OR payload->>'content' IS NULL OR length(payload->>'content') NOT BETWEEN 1 AND 4000
   OR payload->>'confidence_label' NOT IN ('explicit','inferred','uncertain')
   OR jsonb_typeof(payload->'source_refs') IS DISTINCT FROM 'array'
   OR jsonb_array_length(payload->'source_refs')>16
 THEN RAISE EXCEPTION 'human memory authority required'; END IF;
 IF payload - ARRAY['memory_id','revision_id','workspace_id','owner_id','kind','scope_kind','scope_id',
   'subject_key','predicate_key','content','content_sha256','status','origin','source_refs','evidence_ids',
   'proposed_by_run_id','reviewed_by_principal_id','confidence_label','confidence_basis','valid_from','valid_until',
   'recorded_at','expires_at','supersedes_revision_id','exception_to_revision_id','contradiction_group_id','applicability','access_generation'] <> '{}'::jsonb
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
   IF operation='review' THEN
     IF old->>'status' NOT IN ('candidate','active','contested') OR payload->>'status' NOT IN ('active','contested','expired')
        OR payload->>'origin'<>'human_reviewed' OR payload->>'reviewed_by_principal_id' IS DISTINCT FROM owner
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
     IF old->>'status' NOT IN ('active','contested') OR payload->>'status'<>'active'
       OR payload->>'origin'<>'human_reviewed' OR payload->>'reviewed_by_principal_id' IS DISTINCT FROM owner
       OR NOT ((payload->'source_refs') @> (old->'source_refs'))
     THEN RAISE EXCEPTION 'active human correction required'; END IF;
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
 keyhash=tool_json_hash(jsonb_build_array(payload->>'subject_key',payload->>'predicate_key'));
 IF EXISTS(SELECT 1 FROM memory_tombstones WHERE workspace_id=ws AND owner_id=owner
    AND scope_kind=payload->>'scope_kind' AND scope_id=payload->>'scope_id'
    AND (key_sha256=keyhash OR source_fingerprint IN (SELECT tool_json_hash(value) FROM jsonb_array_elements(payload->'source_refs'))))
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
 UPDATE memory_items SET current_revision_id=rid WHERE workspace_id=ws AND id=mid;
END $$;

CREATE FUNCTION forget_memory(ws text,owner text,mid text,expected text,rid text) RETURNS jsonb
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
   FROM (SELECT '' AS fingerprint UNION SELECT tool_json_hash(value) FROM jsonb_array_elements(row.data->'source_refs')) refs
   ON CONFLICT DO NOTHING;
 END LOOP;
 PERFORM set_config('workagent.memory_erasure','on',true);
 UPDATE memory_revisions SET data=data || jsonb_build_object('content',NULL,'content_sha256',NULL,
   'subject_key',NULL,'predicate_key',NULL,'source_refs','[]'::jsonb,'evidence_ids','[]'::jsonb,
   'confidence_basis',NULL,'applicability',NULL,'status','forgotten','contradiction_group_id',NULL)
 WHERE workspace_id=ws AND memory_id=mid;
 DELETE FROM memory_evidence WHERE workspace_id=ws AND memory_id=mid;
 SELECT data INTO tomb FROM memory_revisions WHERE workspace_id=ws AND id=expected;
 tomb=tomb||jsonb_build_object('revision_id',rid,'recorded_at',now(),'supersedes_revision_id',expected,'exception_to_revision_id',NULL);
 INSERT INTO memory_revisions VALUES(ws,mid,rid,now(),tomb);
 UPDATE memory_items SET current_revision_id=rid WHERE workspace_id=ws AND id=mid;
 PERFORM set_config('workagent.memory_erasure','off',true);
 RETURN jsonb_build_object('memory_id',mid,'revision_id',rid,'status','forgotten');
END $$;

CREATE FUNCTION bind_memory_scope(ws text,owner text,cid text,area text,expected bigint) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 IF NOT memory_scope_authorized(ws,owner,'task',cid) OR NOT memory_scope_authorized(ws,owner,'work_area',area)
   OR NOT EXISTS(SELECT 1 FROM conversations WHERE workspace_id=ws AND id=cid AND (data->>'work_version')::bigint=expected AND data->>'state'='open')
 THEN RAISE EXCEPTION 'human scope binding CAS required'; END IF;
 INSERT INTO memory_scope_bindings VALUES(ws,owner,cid,area,expected+1);
 UPDATE conversations SET data=jsonb_set(data,'{work_version}',to_jsonb(expected+1)) WHERE workspace_id=ws AND id=cid;
 RETURN expected+1;
END $$;

CREATE FUNCTION record_memory_usage(ws text,rid text,qid text,attempt text,step text,request_hash text,manifest jsonb) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE entry jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM responses_steps s JOIN provider_attempts a ON a.id=s.attempt_id
   WHERE a.workspace_id=ws AND a.run_id=rid AND s.metadata->>'request_id'=qid
     AND s.attempt_id=attempt AND s.phase=step AND s.request_sha256=request_hash)
 THEN RAISE EXCEPTION 'exact prepared request/run binding required'; END IF;
 IF jsonb_typeof(manifest) IS DISTINCT FROM 'array' OR jsonb_array_length(manifest)>12
 THEN RAISE EXCEPTION 'bounded content-free manifest required'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(manifest) LOOP
   IF entry - ARRAY['memory_id','revision_id','content_sha256','scope_kind','scope_id','why','unresolved_conflict'] <> '{}'::jsonb
      OR NOT EXISTS(SELECT 1 FROM memory_revisions m JOIN runs r ON r.workspace_id=m.workspace_id
       WHERE r.workspace_id=ws AND r.id=rid AND m.memory_id=entry->>'memory_id' AND m.id=entry->>'revision_id'
       AND m.data->>'owner_id'=r.data->>'principal_id' AND m.data->>'content_sha256'=entry->>'content_sha256')
   THEN RAISE EXCEPTION 'exact content-free memory identities required'; END IF;
 END LOOP;
 INSERT INTO memory_usage VALUES(ws,rid,qid,attempt,step,jsonb_build_object('run_id',rid,'request_id',qid,
   'attempt_id',attempt,'phase',step,'request_sha256',request_hash,'entries',manifest)) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM memory_usage WHERE workspace_id=ws AND run_id=rid AND attempt_id=attempt
   AND phase=step AND data->'entries'=manifest AND data->>'request_sha256'=request_hash)
 THEN RAISE EXCEPTION 'immutable per-request manifest'; END IF;
END $$;

REVOKE ALL ON memory_items,memory_revisions,memory_evidence,memory_tombstones,memory_scope_bindings,memory_usage FROM PUBLIC;
REVOKE ALL ON FUNCTION write_memory_revision(text,text,text,text,jsonb),forget_memory(text,text,text,text,text),
 bind_memory_scope(text,text,text,text,bigint),record_memory_usage(text,text,text,text,text,text,jsonb) FROM PUBLIC;
DO $$ DECLARE r record;
BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='conversation_messages' AND privilege_type='INSERT'
   AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP
   EXECUTE format('REVOKE ALL ON memory_items,memory_revisions,memory_evidence,memory_tombstones,memory_scope_bindings,memory_usage FROM %I',r.grantee);
   EXECUTE format('GRANT SELECT ON memory_items,memory_revisions,memory_evidence,memory_tombstones,memory_scope_bindings,memory_usage TO %I',r.grantee);
   EXECUTE format('GRANT EXECUTE ON FUNCTION write_memory_revision(text,text,text,text,jsonb),forget_memory(text,text,text,text,text),bind_memory_scope(text,text,text,text,bigint),record_memory_usage(text,text,text,text,text,text,jsonb) TO %I',r.grantee);
 END LOOP;
END $$;

-- Deny direct app-role writes even if a fixture grants broad table privileges later.
CREATE FUNCTION memory_function_writes_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
 THEN RAISE EXCEPTION 'memory writes require guarded human command functions'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['memory_items','memory_revisions','memory_evidence','memory_scope_bindings','memory_tombstones','memory_usage'] LOOP
 EXECUTE format('CREATE TRIGGER memory_function_writes_only BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION memory_function_writes_only()',name);
 END LOOP;
END $$;

-- New schema opt-in; historical pins stay byte-identical and readable.
DO $$ DECLARE definition text; name text; old text;
BEGIN
 FOREACH name IN ARRAY ARRAY['require_run_successor(runs,jsonb)','guard_retained_result_read()'] LOOP
   definition=pg_get_functiondef(name::regprocedure);
   old=$q$'b9f18beb013a8cd3f102959bf15a9fa290fbee43281077edc6e71abc547e5d61'$q$;
   IF position(old in definition)=0 THEN RAISE EXCEPTION 'memory predecessor drift'; END IF;
   EXECUTE replace(definition,old,old||$q$,'ad79c1ca0c45a8bd793747d3ca2c4ff0306766f07a7627d835ecf1899642bc7f'$q$);
 END LOOP;
END $$;
