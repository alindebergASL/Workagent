-- Exact owner-approved implementation identities. No historical authority or
-- attempt is updated; logical schemas/effects/budgets are not versioned here.
CREATE TABLE capability_implementation_releases (
 release_sha256 text PRIMARY KEY CHECK(release_sha256 ~ '^[0-9a-f]{64}$'),
 descriptor_sha256 text NOT NULL CHECK(descriptor_sha256 ~ '^[0-9a-f]{64}$'),
 descriptor jsonb NOT NULL, dependency_inventory jsonb NOT NULL,
 capability_id text NOT NULL, capability_version text NOT NULL,
 schema_sha256 text NOT NULL CHECK(schema_sha256 ~ '^[0-9a-f]{64}$'),
 implementation_sha256 text NOT NULL CHECK(implementation_sha256 ~ '^[0-9a-f]{64}$'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 consumer_sha256 text NOT NULL CHECK(consumer_sha256 ~ '^[0-9a-f]{64}$'),
 enabled boolean NOT NULL DEFAULT true,
 CHECK(descriptor_sha256=tool_json_hash(descriptor)),
 CHECK(release_sha256=tool_json_hash(jsonb_build_object(
   'descriptor_sha256',descriptor_sha256,'descriptor',descriptor,'dependency_inventory',dependency_inventory,
   'source_sha256',source_sha256,'consumer_sha256',consumer_sha256))),
 CHECK(capability_id IS NOT DISTINCT FROM descriptor->>'id' AND capability_version IS NOT DISTINCT FROM descriptor->>'version'
   AND schema_sha256 IS NOT DISTINCT FROM descriptor->>'schema_sha256' AND implementation_sha256 IS NOT DISTINCT FROM descriptor->>'implementation_sha256'),
 CHECK(source_sha256=tool_json_hash(dependency_inventory->'product'))
);
CREATE TABLE tool_grant_implementation_bindings (
 binding_id text PRIMARY KEY CHECK(binding_id ~ '^[0-9a-f]{64}$'),
 grant_id text NOT NULL REFERENCES tool_grants(id), capability_id text NOT NULL,
 predecessor_pin jsonb NOT NULL,
 predecessor_installation_sha256 text NOT NULL CHECK(predecessor_installation_sha256 ~ '^[0-9a-f]{64}$'),
 predecessor_source_sha256 text CHECK(predecessor_source_sha256 ~ '^[0-9a-f]{64}$'),
 release_sha256 text NOT NULL REFERENCES capability_implementation_releases(release_sha256),
 source_sha256 text NOT NULL, consumer_sha256 text NOT NULL,
 amendment_sha256 text NOT NULL CHECK(amendment_sha256 ~ '^[0-9a-f]{64}$'),
 UNIQUE(grant_id,capability_id,source_sha256)
);
CREATE TABLE tool_attempt_implementation_bindings (
 attempt_id text PRIMARY KEY REFERENCES tool_attempts(id),
 binding_id text NOT NULL REFERENCES tool_grant_implementation_bindings(binding_id),
 release_sha256 text NOT NULL REFERENCES capability_implementation_releases(release_sha256),
 source_sha256 text NOT NULL
);

CREATE FUNCTION guard_implementation_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g tool_grants; b tool_grant_implementation_bindings; rel capability_implementation_releases; old_descriptor jsonb; pin jsonb;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
 THEN RAISE EXCEPTION 'owner implementation binding required'; END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (TG_TABLE_NAME<>'capability_implementation_releases'
     OR (to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled')))
 THEN RAISE EXCEPTION 'immutable implementation identity'; END IF;
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='capability_implementation_releases' THEN
   IF jsonb_typeof(NEW.descriptor) IS DISTINCT FROM 'object'
     OR NEW.descriptor->>'schema_version' IS DISTINCT FROM 'capability-descriptor/v2'
     OR NEW.descriptor->>'id' NOT IN ('context.read','files.inspect_json','capabilities.discover_legacy',
     'procedures.load_legacy','files.list','files.read_range','files.create_draft','files.propose_patch',
     'files.compare','artifacts.export','research.capture','research.cite')
     OR jsonb_typeof(NEW.dependency_inventory->'product') IS DISTINCT FROM 'object'
     OR jsonb_typeof(NEW.dependency_inventory->'migrations') IS DISTINCT FROM 'object'
   THEN RAISE EXCEPTION 'closed implementation release required'; END IF;
 ELSIF TG_TABLE_NAME='tool_grant_implementation_bindings' THEN
   SELECT * INTO g FROM tool_grants WHERE id=NEW.grant_id;
   PERFORM id FROM workspaces WHERE id=g.workspace_id FOR UPDATE;
   SELECT * INTO rel FROM capability_implementation_releases WHERE release_sha256=NEW.release_sha256 AND enabled;
   SELECT value INTO pin FROM jsonb_array_elements(g.data->'capabilities') WHERE value->>'id'=NEW.capability_id;
   SELECT descriptor INTO old_descriptor FROM capability_installations
     WHERE id=NEW.capability_id AND version=pin->>'version' AND enabled;
   IF NOT g.active OR rel.release_sha256 IS NULL OR pin IS NULL OR old_descriptor IS NULL
     OR NEW.predecessor_pin IS DISTINCT FROM pin
     OR NEW.predecessor_installation_sha256 IS DISTINCT FROM tool_json_hash(old_descriptor)
     OR rel.source_sha256 IS DISTINCT FROM NEW.source_sha256 OR rel.consumer_sha256 IS DISTINCT FROM NEW.consumer_sha256
     OR (old_descriptor-'implementation_sha256') IS DISTINCT FROM (rel.descriptor-'implementation_sha256')
     OR pin->>'id' IS DISTINCT FROM rel.descriptor->>'id'
     OR pin->>'version' IS DISTINCT FROM rel.descriptor->>'version'
     OR pin->>'schema_sha256' IS DISTINCT FROM rel.descriptor->>'schema_sha256'
     OR pin->>'implementation_sha256' NOT IN (old_descriptor->>'implementation_sha256',rel.descriptor->>'implementation_sha256')
     OR (NEW.predecessor_source_sha256 IS NULL AND pin->>'implementation_sha256' IS DISTINCT FROM rel.descriptor->>'implementation_sha256')
     OR NEW.binding_id IS DISTINCT FROM tool_json_hash(to_jsonb(NEW)-'binding_id')
   THEN RAISE EXCEPTION 'exact schema-preserving implementation binding required'; END IF;
 ELSE
   SELECT * INTO b FROM tool_grant_implementation_bindings WHERE binding_id=NEW.binding_id;
   IF b.release_sha256 IS DISTINCT FROM NEW.release_sha256 OR b.source_sha256 IS DISTINCT FROM NEW.source_sha256
     OR NOT EXISTS(SELECT 1 FROM tool_attempts a JOIN capability_implementation_releases r ON r.release_sha256=b.release_sha256
       WHERE a.id=NEW.attempt_id AND a.grant_id=b.grant_id AND a.capability_id=b.capability_id AND a.descriptor=r.descriptor)
     OR EXISTS(SELECT 1 FROM tool_attempt_events WHERE attempt_id=NEW.attempt_id)
   THEN RAISE EXCEPTION 'new exact reserved attempt binding required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER implementation_release_owner BEFORE INSERT OR UPDATE OR DELETE ON capability_implementation_releases
 FOR EACH ROW EXECUTE FUNCTION guard_implementation_release();
CREATE TRIGGER grant_implementation_owner BEFORE INSERT OR UPDATE OR DELETE ON tool_grant_implementation_bindings
 FOR EACH ROW EXECUTE FUNCTION guard_implementation_release();
CREATE TRIGGER attempt_implementation_owner BEFORE INSERT OR UPDATE OR DELETE ON tool_attempt_implementation_bindings
 FOR EACH ROW EXECUTE FUNCTION guard_implementation_release();

CREATE FUNCTION tool_implementation_descriptor(gid text,cid text,source text DEFAULT NULL,consumer text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE g tool_grants; pin jsonb; old_descriptor jsonb; rel capability_implementation_releases; b tool_grant_implementation_bindings; n integer;
BEGIN
 SELECT * INTO g FROM tool_grants WHERE id=gid;
 SELECT value INTO pin FROM jsonb_array_elements(g.data->'capabilities') WHERE value->>'id'=cid;
 SELECT descriptor INTO old_descriptor FROM capability_installations WHERE id=cid AND version=pin->>'version' AND enabled;
 IF NOT coalesce(g.active,false) OR old_descriptor IS NULL OR pin IS NULL
    OR (g.data->>'expires_at')::timestamptz<=clock_timestamp() THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM tool_grant_implementation_bindings WHERE grant_id=gid) THEN
   IF pin->>'schema_sha256'=old_descriptor->>'schema_sha256'
      AND pin->>'implementation_sha256'=old_descriptor->>'implementation_sha256' THEN RETURN old_descriptor; END IF;
   RETURN NULL;
 END IF;
 -- Exactly one complete source transition per grant. Disabled/missing/partial
 -- mappings cannot fall back to historical equality, nor chain through aliases.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(g.data->'capabilities') p WHERE
     (SELECT count(*) FROM tool_grant_implementation_bindings bb JOIN capability_implementation_releases rr
       ON rr.release_sha256=bb.release_sha256 WHERE bb.grant_id=gid AND bb.capability_id=p->>'id' AND rr.enabled)<>1)
    OR (SELECT count(DISTINCT source_sha256) FROM tool_grant_implementation_bindings WHERE grant_id=gid)<>1
    OR (SELECT count(DISTINCT consumer_sha256) FROM tool_grant_implementation_bindings WHERE grant_id=gid)<>1
    OR (SELECT count(DISTINCT amendment_sha256) FROM tool_grant_implementation_bindings WHERE grant_id=gid)<>1
    OR (SELECT count(DISTINCT coalesce(predecessor_source_sha256,'initial')) FROM tool_grant_implementation_bindings WHERE grant_id=gid)<>1
 THEN RETURN NULL; END IF;
 SELECT count(*) INTO n FROM tool_grant_implementation_bindings WHERE grant_id=gid AND capability_id=cid;
 IF n<>1 THEN RETURN NULL; END IF;
 SELECT * INTO b FROM tool_grant_implementation_bindings WHERE grant_id=gid AND capability_id=cid;
 SELECT * INTO rel FROM capability_implementation_releases WHERE release_sha256=b.release_sha256 AND enabled;
 IF rel.release_sha256 IS NULL OR b.predecessor_pin IS DISTINCT FROM pin
    OR b.predecessor_installation_sha256 IS DISTINCT FROM tool_json_hash(old_descriptor)
    OR b.source_sha256 IS DISTINCT FROM rel.source_sha256 OR b.consumer_sha256 IS DISTINCT FROM rel.consumer_sha256
    OR (old_descriptor-'implementation_sha256') IS DISTINCT FROM (rel.descriptor-'implementation_sha256')
    OR (source IS NOT NULL AND source IS DISTINCT FROM rel.source_sha256)
    OR (consumer IS NOT NULL AND consumer IS DISTINCT FROM rel.consumer_sha256)
 THEN RETURN NULL; END IF;
 RETURN rel.descriptor;
END $$;
CREATE FUNCTION tool_pin_matches(gid text,pin jsonb,d jsonb,source text DEFAULT NULL,consumer text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT d IS NOT NULL AND d=tool_implementation_descriptor(gid,pin->>'id',source,consumer)
$$;

CREATE FUNCTION tool_attempt_descriptor(aid text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE a tool_attempts; b tool_attempt_implementation_bindings; rel capability_implementation_releases; installed jsonb;
BEGIN
 SELECT * INTO a FROM tool_attempts WHERE id=aid;
 SELECT * INTO b FROM tool_attempt_implementation_bindings WHERE attempt_id=aid;
 SELECT descriptor INTO installed FROM capability_installations WHERE id=a.capability_id AND version=a.capability_version AND enabled;
 IF installed IS NULL OR NOT tool_run_available(a.workspace_id,a.run_id) THEN RETURN NULL; END IF;
 IF b.attempt_id IS NULL THEN
   IF installed=a.descriptor THEN RETURN installed; END IF;
 ELSE
   SELECT * INTO rel FROM capability_implementation_releases WHERE release_sha256=b.release_sha256 AND enabled;
   IF rel.descriptor=a.descriptor AND rel.descriptor=tool_implementation_descriptor(a.grant_id,a.capability_id,b.source_sha256,rel.consumer_sha256)
     AND EXISTS(SELECT 1 FROM tool_grant_implementation_bindings gb WHERE gb.binding_id=b.binding_id
       AND gb.grant_id=a.grant_id AND gb.capability_id=a.capability_id AND gb.release_sha256=b.release_sha256)
   THEN RETURN rel.descriptor; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION tool_attempt_implementation_authorized(aid text,source text DEFAULT NULL,consumer text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE a tool_attempts; b tool_attempt_implementation_bindings;
BEGIN
 SELECT * INTO a FROM tool_attempts WHERE id=aid;
 SELECT * INTO b FROM tool_attempt_implementation_bindings WHERE attempt_id=aid;
 IF b.attempt_id IS NULL AND EXISTS(SELECT 1 FROM tool_grant_implementation_bindings WHERE grant_id=a.grant_id)
 THEN RETURN false; END IF; -- old reserved/unknown calls cannot execute new bytes
 RETURN coalesce(a.descriptor=tool_attempt_descriptor(aid)
   AND a.descriptor=tool_implementation_descriptor(a.grant_id,a.capability_id,source,consumer),false);
END $$;

-- Current079 predecessor bytes are pinned before modifying the existing guards.
-- Exact replacements preserve every resource, budget, observation and lease term.
DO $migration$ DECLARE definition text; old text; BEGIN
 definition=pg_get_functiondef('tool_run_available_pre_mcp(text,text)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'1245ab475360a3ded88fbe3ae1277eb9112247d4e68072f8eb5f1530f0436f3d' THEN RAISE EXCEPTION 'release predecessor drift: tool_run_available_pre_mcp(text,text)'; END IF;
 old=$needle$SELECT descriptor INTO d FROM capability_installations WHERE id=pin->>'id' AND version=pin->>'version' AND enabled;$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: tool_run_available_pre_mcp(text,text)'; END IF;
 definition=replace(definition,old,$replacement$d=tool_implementation_descriptor(g.id,pin->>'id');$replacement$);
 -- d is the exact current resolver result above. Keep its NULL/schema/effect/
 -- privacy checks; do not resolve this same pin a second time through the helper.
 old=$needle$     OR d->>'implementation_sha256' IS DISTINCT FROM pin->>'implementation_sha256'
$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: tool_run_available_pre_mcp(text,text)'; END IF;
 definition=replace(definition,old,$replacement$$replacement$);
 EXECUTE definition;
 definition=pg_get_functiondef('dispatch_tool_call(text,integer,text,text)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'6f063a5bc6bb7942c3f01c968531848c50727bd3942a0b65a3b2850918eb6050' THEN RAISE EXCEPTION 'release predecessor drift: dispatch_tool_call(text,integer,text,text)'; END IF;
 old=$needle$SELECT descriptor INTO current_descriptor FROM public.capability_installations
 WHERE id=a.capability_id AND version=a.capability_version AND enabled;$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: dispatch_tool_call(text,integer,text,text)'; END IF;
 definition=replace(definition,old,$replacement$current_descriptor=public.tool_attempt_descriptor(aid);
 IF NOT public.tool_attempt_implementation_authorized(aid) THEN RAISE EXCEPTION 'old or unbound implementation dispatch denied'; END IF;$replacement$);
 EXECUTE definition;
 definition=pg_get_functiondef('settle_tool_call(text,text,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'a0e20126115e923a1cd61a74114132976903771dbf3a44670c9563072c339393' THEN RAISE EXCEPTION 'release predecessor drift: settle_tool_call(text,text,jsonb)'; END IF;
 old=$needle$SELECT descriptor INTO d FROM public.capability_installations WHERE id=a.capability_id AND version=a.capability_version AND enabled;$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: settle_tool_call(text,text,jsonb)'; END IF;
 definition=replace(definition,old,$replacement$d=public.tool_attempt_descriptor(aid);$replacement$);
 EXECUTE definition;
 definition=pg_get_functiondef('research_publication_authorized(text,text,text,text)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'51cf3dfe45c81000cd945bd59a0d4746817c7030c1df58f0fa4deea52d07ca1d' THEN RAISE EXCEPTION 'release predecessor drift: research_publication_authorized(text,text,text,text)'; END IF;
 old=$needle$SELECT descriptor INTO d FROM capability_installations WHERE id=a.capability_id AND version=a.capability_version AND enabled;$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: research_publication_authorized(text,text,text,text)'; END IF;
 definition=replace(definition,old,$replacement$d=tool_attempt_descriptor(a.id);$replacement$);
 EXECUTE definition;
 definition=pg_get_functiondef('authorize_compute_export(text,text,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'1eb6c564b54691b098e1c0570633c60e9515ea8dbaf28fd09e08f51f2c9a162d' THEN RAISE EXCEPTION 'release predecessor drift: authorize_compute_export(text,text,jsonb)'; END IF;
 old=$needle$SELECT descriptor INTO d FROM capability_installations WHERE id=a.capability_id AND version=a.capability_version AND enabled;$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: authorize_compute_export(text,text,jsonb)'; END IF;
 definition=replace(definition,old,$replacement$d=tool_attempt_descriptor(a.id);$replacement$);
 EXECUTE definition;
 definition=pg_get_functiondef('guard_file_input_rejection()'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'3b00a76d57985c02ffdb3be69112e70457e1727864e35df4a86bead1e5ec99b9' THEN RAISE EXCEPTION 'release predecessor drift: guard_file_input_rejection()'; END IF;
 old=$needle$SELECT ci.descriptor INTO descriptor FROM capability_installations ci WHERE id=CASE d->>'kind'
   WHEN 'files_create_draft' THEN 'files.create_draft' WHEN 'files_propose_patch' THEN 'files.propose_patch' END AND version='1' AND enabled;$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: guard_file_input_rejection()'; END IF;
 definition=replace(definition,old,$replacement$descriptor=tool_implementation_descriptor(g.id,CASE d->>'kind' WHEN 'files_create_draft' THEN 'files.create_draft' WHEN 'files_propose_patch' THEN 'files.propose_patch' END);$replacement$);
 old=$needle$pin->>'implementation_sha256' IS DISTINCT FROM descriptor->>'implementation_sha256'$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: guard_file_input_rejection()'; END IF;
 definition=replace(definition,old,$replacement$NOT tool_pin_matches(g.id,pin,descriptor)$replacement$);
 EXECUTE definition;
 definition=pg_get_functiondef('target_create_rejection_authorized(text,text,integer)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'98a2305d9b0aaa59e435b2f33b661046bae29a0d4330606680f83c6181806048' THEN RAISE EXCEPTION 'release predecessor drift: target_create_rejection_authorized(text,text,integer)'; END IF;
 old=$needle$SELECT ci.descriptor INTO descriptor FROM capability_installations ci
   WHERE id='files.create_draft' AND version='1' AND enabled;$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: target_create_rejection_authorized(text,text,integer)'; END IF;
 definition=replace(definition,old,$replacement$descriptor=tool_implementation_descriptor(g.id,'files.create_draft');$replacement$);
 old=$needle$pin->>'implementation_sha256' IS DISTINCT FROM descriptor->>'implementation_sha256'$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'release replacement drift: target_create_rejection_authorized(text,text,integer)'; END IF;
 definition=replace(definition,old,$replacement$NOT tool_pin_matches(g.id,pin,descriptor)$replacement$);
 EXECUTE definition;
END $migration$;

-- The v2 reservation is the complete current reservation body with only exact
-- descriptor lookup and atomic NEW-attempt release retention added. No budget,
-- resources, work-version, fence, receipt, prior-call or cost checks are removed.
DO $migration$ DECLARE definition text; old text; legacy text;
BEGIN
 definition=pg_get_functiondef('reserve_tool_call(text,text,integer,text,jsonb,text)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'24fb0474113e2ffb6954d0e2a0712f9036f40b6ef473f358fbeead94e5386b07' THEN RAISE EXCEPTION 'release reservation predecessor drift'; END IF;
 legacy=definition;
 definition=replace(definition,'FUNCTION public.reserve_tool_call(', 'FUNCTION public.reserve_tool_call_v2(');
 definition=replace(definition,'receipt text)', 'receipt text, source text, consumer text)');
 old=$needle$SELECT descriptor INTO d FROM public.capability_installations WHERE id=payload->>'capability_id'
   AND version=payload->>'capability_version' AND enabled;$needle$;
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'release reservation lookup drift'; END IF;
 definition=replace(definition,old,$replacement$d=public.tool_implementation_descriptor(g.id,payload->>'capability_id',source,consumer);$replacement$);
 definition=replace(definition,$needle$OR pin->>'implementation_sha256' IS DISTINCT FROM d->>'implementation_sha256'$needle$,
   $replacement$OR NOT public.tool_pin_matches(g.id,pin,d,source,consumer)$replacement$);
 definition=replace(definition,' RETURN aid;', $replacement$
 INSERT INTO public.tool_attempt_implementation_bindings(attempt_id,binding_id,release_sha256,source_sha256)
 SELECT aid,bb.binding_id,bb.release_sha256,bb.source_sha256 FROM public.tool_grant_implementation_bindings bb
 WHERE bb.grant_id=g.id AND bb.capability_id=d->>'id' AND bb.source_sha256=source AND bb.consumer_sha256=consumer;
 IF NOT FOUND THEN RAISE EXCEPTION 'exact new implementation binding required'; END IF;
 RETURN aid;$replacement$);
 EXECUTE definition;
 -- A mapped grant cannot evade release retention through the old entrypoint.
 EXECUTE replace(legacy,E'BEGIN\n',E'BEGIN\n IF EXISTS(SELECT 1 FROM public.tool_grants gg JOIN public.tool_grant_implementation_bindings bb ON bb.grant_id=gg.id WHERE gg.workspace_id=ws AND gg.run_id=rid) THEN RAISE EXCEPTION ''implementation-bound reservation required''; END IF;\n');
END $migration$;

REVOKE ALL ON capability_implementation_releases,tool_grant_implementation_bindings,tool_attempt_implementation_bindings FROM PUBLIC;
REVOKE ALL ON FUNCTION reserve_tool_call_v2(text,text,integer,text,jsonb,text,text,text) FROM PUBLIC;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='tool_grants' AND privilege_type='SELECT'
   AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP
   EXECUTE format('GRANT SELECT ON capability_implementation_releases,tool_grant_implementation_bindings,tool_attempt_implementation_bindings TO %I',r.grantee);
   EXECUTE format('GRANT EXECUTE ON FUNCTION reserve_tool_call_v2(text,text,integer,text,jsonb,text,text,text) TO %I',r.grantee);
 END LOOP;
END $$;

-- Procedure evidence consumes native observations too. Retain all existing
-- principal, scope, status, selector and dependency checks; replace only the
-- legacy implementation equality with the exact attempt provenance resolver.
DO $migration$ DECLARE definition text; old text;
BEGIN
 definition=pg_get_functiondef('memory_procedure_evidence_authorized(text,text,text,text,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'d61f473248482f1297895e1cb474561b11d21beb09950ab2dc7eed981768c6e3'
 THEN RAISE EXCEPTION 'procedure evidence implementation predecessor drift'; END IF;
 --068 retained the delegation exclusion in the wrapper above and renamed the
 --underlying pin/resource predicate. Preserve the wrapper byte-for-byte.
 definition=pg_get_functiondef('memory_evidence_pre_delegation(text,text,text,text,jsonb)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'573f74a70af8552badead7e8c9a014d17abe25bbf309c12afeebff1b9748b053'
 THEN RAISE EXCEPTION 'procedure underlying evidence predecessor drift'; END IF;
 old=$needle$AND pin->>'implementation_sha256'=a.descriptor->>'implementation_sha256'$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'procedure pin replacement drift'; END IF;
 definition=replace(definition,old,$replacement$AND a.descriptor=tool_attempt_descriptor(a.id)$replacement$);
 old=$needle$AND EXISTS(SELECT 1 FROM capability_installations i WHERE i.id=a.capability_id
     AND i.version=a.capability_version AND i.enabled AND i.descriptor=a.descriptor)$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old) THEN RAISE EXCEPTION 'procedure installation replacement drift'; END IF;
 EXECUTE replace(definition,old,$replacement$AND a.descriptor=tool_attempt_descriptor(a.id)$replacement$);
END $migration$;

--074 output reuse must also retain an authorized implementation identity. The
--resolver above never calls effective resources; this cannot recurse into itself.
DO $migration$ DECLARE definition text; old text; BEGIN
 definition=pg_get_functiondef('tool_run_output_resources(text,text)'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>'e34de2fd744b165586a12bf4a9b3b0bb5790833ddc9e6fc7c01662dcae28ffeb'
 THEN RAISE EXCEPTION 'release predecessor drift: tool_run_output_resources(text,text)'; END IF;
 old=$needle$IF obs->>'status' IS DISTINCT FROM 'observed'$needle$;
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'release replacement drift: tool_run_output_resources(text,text)'; END IF;
 EXECUTE replace(definition,old,$replacement$IF tool_attempt_descriptor(a.id) IS DISTINCT FROM a.descriptor
      OR obs->>'status' IS DISTINCT FROM 'observed'$replacement$);
END $migration$;
