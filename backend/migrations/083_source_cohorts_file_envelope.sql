DO $catalog$ BEGIN
 IF encode(sha256(convert_to(pg_get_functiondef('public.tool_implementation_descriptor(text,text,text,text)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '8e5d6d9f540f807ebede73f0861cedd9dea049f1169c7cbce4ab55b351f025aa' THEN RAISE EXCEPTION '083 predecessor drift: tool_implementation_descriptor(text,text,text,text)'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.tool_attempt_implementation_authorized(text,text,text)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM 'b402a635b8155ede689725a4064143fef6e988b8f2b23c8de64cc221df45d373' THEN RAISE EXCEPTION '083 predecessor drift: tool_attempt_implementation_authorized(text,text,text)'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.tool_run_available_pre_mcp(text,text)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM 'c751d316fdcf6b35f14f18fd66c73420de41bd325eec0382ad0d4541857920ca' THEN RAISE EXCEPTION '083 predecessor drift: tool_run_available_pre_mcp(text,text)'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.guard_file_input_rejection()'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM 'eb2703aeaa735150ed746b63706058a05861b97a61e24fc08274725dcbbacb15' THEN RAISE EXCEPTION '083 predecessor drift: guard_file_input_rejection()'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.target_create_rejection_authorized(text,text,integer)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '9c3bfbefa2c49e69db1b3151cc7504401590ce7b78326962b5e1e624a0f15ad9' THEN RAISE EXCEPTION '083 predecessor drift: target_create_rejection_authorized(text,text,integer)'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.reserve_tool_call(text,text,integer,text,jsonb,text)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '085db616db1bb6a1d25ac6b1eb5cdcd2233103f7cf7c987684ad8506a2d3263f' THEN RAISE EXCEPTION '083 predecessor drift: reserve_tool_call(text,text,integer,text,jsonb,text)'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.reserve_tool_call_v2(text,text,integer,text,jsonb,text,text,text)'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '6b63aa82babb1aa0c41b4cddceda7fc24f07f77e96af66b7a3f614e6ffbdbd58' THEN RAISE EXCEPTION '083 predecessor drift: reserve_tool_call_v2(text,text,integer,text,jsonb,text,text,text)'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.guard_tool_authority()'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM 'f1d0c0d75c72df30c313e96b31c107a9fb6ea812a5d5f389a3036b642416adaa' THEN RAISE EXCEPTION '083 predecessor drift: guard_tool_authority()'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.guard_implementation_release()'::regprocedure),'UTF8')),'hex') IS DISTINCT FROM '082cfb5ca85f629a340b47033005ad8c1ca267b2a1055a96ef71ae3939a9d1b7' THEN RAISE EXCEPTION '083 predecessor drift: guard_implementation_release()'; END IF;
END $catalog$;

-- Exact compatible source cohorts and declared file-envelope accounting.
-- Apply atomically using the existing migration runner, never edit 081/053.
-- No INSERT/UPDATE/DELETE of grants, releases, attempts, receipts or costs.
DO $preflight$ DECLARE body text; BEGIN
 SELECT prosrc INTO body FROM pg_proc WHERE oid='public.tool_implementation_descriptor(text,text,text,text)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'9371ea006d5ea0922d317622084bca7c2502043093613e27a41a603f0901aeda' THEN RAISE EXCEPTION 'repair predecessor drift: tool_implementation_descriptor'; END IF;
 SELECT prosrc INTO body FROM pg_proc WHERE oid='public.tool_attempt_implementation_authorized(text,text,text)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'364c0dc3fde9fd7aab06a67208dbe23c500fdb298682c78c5fdcf758fd5194d9' THEN RAISE EXCEPTION 'repair predecessor drift: tool_attempt_implementation_authorized'; END IF;
END $preflight$;


-- Explicit source is already the cohort identity: UNIQUE(grant, capability, source).
-- No table, pointer, authority version, alias, or newest-wins selector is added.
CREATE OR REPLACE FUNCTION tool_implementation_descriptor(gid text,cid text,source text DEFAULT NULL,consumer text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE g tool_grants; pin jsonb; old_descriptor jsonb; rel capability_implementation_releases;
 b tool_grant_implementation_bindings; selected_source text=source; answer jsonb; n integer;
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
 -- Source-less implementation selection must remain unambiguous, including disabled
 -- and partial historical cohorts. Policy-only callers use the separate helper.
 IF selected_source IS NULL THEN
   SELECT count(DISTINCT source_sha256),min(source_sha256) INTO n,selected_source
     FROM tool_grant_implementation_bindings WHERE grant_id=gid;
   IF n<>1 THEN RETURN NULL; END IF;
 END IF;
 IF (SELECT count(DISTINCT consumer_sha256) FROM tool_grant_implementation_bindings
       WHERE grant_id=gid AND source_sha256=selected_source)<>1
    OR (SELECT count(DISTINCT amendment_sha256) FROM tool_grant_implementation_bindings
       WHERE grant_id=gid AND source_sha256=selected_source)<>1
    OR (SELECT count(DISTINCT coalesce(predecessor_source_sha256,'initial')) FROM tool_grant_implementation_bindings
       WHERE grant_id=gid AND source_sha256=selected_source)<>1
    OR EXISTS(SELECT 1 FROM tool_grant_implementation_bindings bb
       WHERE bb.grant_id=gid AND bb.source_sha256=selected_source
         AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(g.data->'capabilities') p WHERE p->>'id'=bb.capability_id))
 THEN RETURN NULL; END IF;
 -- Predecessor installation hash is validated on binding INSERT by081. The
-- installation descriptor, grant pins and binding are immutable under053/081.
-- Reuse that invariant on READ; all current enabled/source/policy checks remain.
 -- Validate EVERY frozen pin in this exact source, not merely the requested pin.
 FOR pin IN SELECT value FROM jsonb_array_elements(g.data->'capabilities') LOOP
   SELECT count(*) INTO n FROM tool_grant_implementation_bindings
     WHERE grant_id=gid AND capability_id=pin->>'id' AND source_sha256=selected_source;
   IF n<>1 THEN RETURN NULL; END IF;
   SELECT * INTO b FROM tool_grant_implementation_bindings
     WHERE grant_id=gid AND capability_id=pin->>'id' AND source_sha256=selected_source;
   SELECT * INTO rel FROM capability_implementation_releases WHERE release_sha256=b.release_sha256 AND enabled;
   SELECT descriptor INTO old_descriptor FROM capability_installations
     WHERE id=pin->>'id' AND version=pin->>'version' AND enabled;
   IF rel.release_sha256 IS NULL OR old_descriptor IS NULL OR b.predecessor_pin IS DISTINCT FROM pin
      OR b.source_sha256 IS DISTINCT FROM rel.source_sha256 OR b.consumer_sha256 IS DISTINCT FROM rel.consumer_sha256
      OR (old_descriptor-'implementation_sha256') IS DISTINCT FROM (rel.descriptor-'implementation_sha256')
      OR pin->>'id' IS DISTINCT FROM rel.descriptor->>'id'
      OR pin->>'version' IS DISTINCT FROM rel.descriptor->>'version'
      OR pin->>'schema_sha256' IS DISTINCT FROM rel.descriptor->>'schema_sha256'
      OR (consumer IS NOT NULL AND consumer IS DISTINCT FROM rel.consumer_sha256)
   THEN RETURN NULL; END IF;
   IF pin->>'id'=cid THEN answer=rel.descriptor; END IF;
 END LOOP;
 RETURN answer;
END $$;

-- A grant born on an intermediate compatible release retains that exact pin.
-- Permit its successor only through the declared, complete predecessor cohort;
-- the original installed/new-pin cases and every other INSERT guard stay exact.
DO $successor$ DECLARE definition text; old text=$needle$OR pin->>'implementation_sha256' NOT IN (old_descriptor->>'implementation_sha256',rel.descriptor->>'implementation_sha256')$needle$; BEGIN
 definition=pg_get_functiondef('public.guard_implementation_release()'::regprocedure);
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION '083 exact successor guard splice drift'; END IF;
 EXECUTE replace(definition,old,$replacement$OR (pin->>'implementation_sha256' NOT IN (old_descriptor->>'implementation_sha256',rel.descriptor->>'implementation_sha256')
       AND NOT EXISTS(SELECT 1 FROM tool_grant_implementation_bindings prior_binding
         JOIN capability_implementation_releases prior_release ON prior_release.release_sha256=prior_binding.release_sha256
         WHERE prior_binding.grant_id=NEW.grant_id AND prior_binding.capability_id=NEW.capability_id
           AND prior_binding.source_sha256=NEW.predecessor_source_sha256
           AND prior_binding.predecessor_pin=pin
           AND prior_binding.predecessor_installation_sha256=NEW.predecessor_installation_sha256
           AND prior_release.enabled AND prior_release.source_sha256=prior_binding.source_sha256
           AND prior_release.consumer_sha256=prior_binding.consumer_sha256
           AND (prior_release.descriptor-'implementation_sha256')=(rel.descriptor-'implementation_sha256')
           AND public.tool_implementation_descriptor(NEW.grant_id,NEW.capability_id,
                 NEW.predecessor_source_sha256,prior_binding.consumer_sha256)=prior_release.descriptor))$replacement$);
END $successor$;

-- Authority-only checks must not select executable bytes. Return the frozen
-- installed policy only when one exact COMPLETE enabled source proves compatibility.
-- The resolver above never calls availability; this helper cannot recurse into it.
CREATE FUNCTION tool_implementation_policy_descriptor(gid text,cid text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE s text; d jsonb; pin jsonb; installed jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tool_grant_implementation_bindings WHERE grant_id=gid) THEN
   RETURN tool_implementation_descriptor(gid,cid);
 END IF;
 SELECT p.value INTO pin FROM tool_grants g CROSS JOIN LATERAL jsonb_array_elements(g.data->'capabilities') p
   WHERE g.id=gid AND p.value->>'id'=cid;
 SELECT descriptor INTO installed FROM capability_installations WHERE id=cid AND version=pin->>'version' AND enabled;
 IF installed IS NULL THEN RETURN NULL; END IF;
 FOR s IN SELECT DISTINCT source_sha256 FROM tool_grant_implementation_bindings WHERE grant_id=gid LOOP
   d=tool_implementation_descriptor(gid,cid,s,NULL);
   IF d IS NOT NULL AND (d-'implementation_sha256')=(installed-'implementation_sha256') THEN RETURN installed; END IF;
 END LOOP;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION tool_attempt_implementation_authorized(aid text,source text DEFAULT NULL,consumer text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE a tool_attempts; b tool_attempt_implementation_bindings; rel capability_implementation_releases;
BEGIN
 SELECT * INTO a FROM tool_attempts WHERE id=aid;
 SELECT * INTO b FROM tool_attempt_implementation_bindings WHERE attempt_id=aid;
 IF b.attempt_id IS NULL THEN
   IF EXISTS(SELECT 1 FROM tool_grant_implementation_bindings WHERE grant_id=a.grant_id) THEN RETURN false; END IF;
   RETURN coalesce(a.descriptor=tool_attempt_descriptor(aid)
     AND a.descriptor=tool_implementation_descriptor(a.grant_id,a.capability_id,source,consumer),false);
 END IF;
 SELECT * INTO rel FROM capability_implementation_releases WHERE release_sha256=b.release_sha256 AND enabled;
 -- SQL dispatch's source-less call uses the immutable attempt binding. A loaded
 -- Python caller must match THAT source/consumer, even if descriptors are equal.
 IF rel.release_sha256 IS NULL OR (source IS NOT NULL AND source IS DISTINCT FROM b.source_sha256)
    OR (consumer IS NOT NULL AND consumer IS DISTINCT FROM rel.consumer_sha256) THEN RETURN false; END IF;
 RETURN coalesce(a.descriptor=tool_attempt_descriptor(aid)
   AND a.descriptor=tool_implementation_descriptor(a.grant_id,a.capability_id,b.source_sha256,rel.consumer_sha256),false);
END $$;

-- Transport accounting, not a schema validator or resource/permission grant.
-- Keep the original allowance for all calls. For the two existing file v1 DTOs,
-- separately account for the declared long string fields, retaining the original
-- cap for ALL remaining metadata (including unexpected fields and input_refs).
-- JSONB renders a Unicode scalar in at most max(4 UTF8 bytes, 6 escape bytes).
-- Thus maxima are 262144 + 6*200000 (+ 6*10000 for a patch), not 524288.
-- Work-version is unbounded in the Python DTO (SQL casts bigint); retaining the
-- metadata cap avoids inventing a schema limit or asserting a finite DTO bound.
CREATE FUNCTION tool_call_payload_size_allowed(payload jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE metadata jsonb=payload; content jsonb; reason jsonb;
BEGIN
 IF octet_length(payload::text)<=262144 THEN RETURN true; END IF;
 IF payload->>'capability_version' IS DISTINCT FROM '1' THEN RETURN false; END IF;
 IF payload->>'capability_id'='files.create_draft'
    AND payload->'arguments'->>'kind'='files_create_draft' THEN
   content=payload#>'{arguments,source,content}';
   IF jsonb_typeof(content) IS DISTINCT FROM 'string'
      OR length(content#>>'{}') NOT BETWEEN 1 AND 200000 THEN RETURN false; END IF;
   metadata=jsonb_set(metadata,'{arguments,source,content}','""'::jsonb,false);
 ELSIF payload->>'capability_id'='files.propose_patch'
    AND payload->'arguments'->>'kind'='files_propose_patch' THEN
   content=payload#>'{arguments,content}'; reason=payload#>'{arguments,reason}';
   IF jsonb_typeof(content) IS DISTINCT FROM 'string'
      OR length(content#>>'{}') NOT BETWEEN 1 AND 200000
      OR jsonb_typeof(reason) IS DISTINCT FROM 'string'
      OR length(reason#>>'{}') NOT BETWEEN 1 AND 10000 THEN RETURN false; END IF;
   metadata=jsonb_set(metadata,'{arguments,content}','""'::jsonb,false);
   metadata=jsonb_set(metadata,'{arguments,reason}','""'::jsonb,false);
 ELSE RETURN false;
 END IF;
 RETURN octet_length(metadata::text)<=262144;
END $$;


-- Assert one exact splice; preserve every other authority/accounting/receipt term.
DO $repair$ DECLARE definition text; old text=$needle$d=tool_implementation_descriptor(g.id,pin->>'id');$needle$; BEGIN
 definition=pg_get_functiondef('public.tool_run_available_pre_mcp(text,text)'::regprocedure);
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'repair exact splice drift: tool_run_available_pre_mcp(text,text)'; END IF;
 EXECUTE replace(definition,old,$replacement$d=tool_implementation_policy_descriptor(g.id,pin->>'id');$replacement$);
END $repair$;


-- Assert one exact splice; preserve every other authority/accounting/receipt term.
DO $repair$ DECLARE definition text; old text=$needle$descriptor=tool_implementation_descriptor(g.id,CASE d->>'kind' WHEN 'files_create_draft' THEN 'files.create_draft' WHEN 'files_propose_patch' THEN 'files.propose_patch' END);$needle$; BEGIN
 definition=pg_get_functiondef('public.guard_file_input_rejection()'::regprocedure);
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'repair exact splice drift: guard_file_input_rejection()'; END IF;
 EXECUTE replace(definition,old,$replacement$descriptor=tool_implementation_policy_descriptor(g.id,CASE d->>'kind' WHEN 'files_create_draft' THEN 'files.create_draft' WHEN 'files_propose_patch' THEN 'files.propose_patch' END);$replacement$);
END $repair$;


-- Assert one exact splice; preserve every other authority/accounting/receipt term.
DO $repair$ DECLARE definition text; old text=$needle$NOT tool_pin_matches(g.id,pin,descriptor)$needle$; BEGIN
 definition=pg_get_functiondef('public.guard_file_input_rejection()'::regprocedure);
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'repair exact splice drift: guard_file_input_rejection()'; END IF;
 EXECUTE replace(definition,old,$replacement$descriptor IS DISTINCT FROM tool_implementation_policy_descriptor(g.id,pin->>'id')$replacement$);
END $repair$;


-- Assert one exact splice; preserve every other authority/accounting/receipt term.
DO $repair$ DECLARE definition text; old text=$needle$descriptor=tool_implementation_descriptor(g.id,'files.create_draft');$needle$; BEGIN
 definition=pg_get_functiondef('public.target_create_rejection_authorized(text,text,integer)'::regprocedure);
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'repair exact splice drift: target_create_rejection_authorized(text,text,integer)'; END IF;
 EXECUTE replace(definition,old,$replacement$descriptor=tool_implementation_policy_descriptor(g.id,'files.create_draft');$replacement$);
END $repair$;


-- Assert one exact splice; preserve every other authority/accounting/receipt term.
DO $repair$ DECLARE definition text; old text=$needle$NOT tool_pin_matches(g.id,pin,descriptor)$needle$; BEGIN
 definition=pg_get_functiondef('public.target_create_rejection_authorized(text,text,integer)'::regprocedure);
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'repair exact splice drift: target_create_rejection_authorized(text,text,integer)'; END IF;
 EXECUTE replace(definition,old,$replacement$descriptor IS DISTINCT FROM tool_implementation_policy_descriptor(g.id,pin->>'id')$replacement$);
END $repair$;


-- Assert one exact splice; preserve every other authority/accounting/receipt term.
DO $repair$ DECLARE definition text; old text=$needle$octet_length(payload::text)>262144$needle$; BEGIN
 definition=pg_get_functiondef('public.reserve_tool_call(text,text,integer,text,jsonb,text)'::regprocedure);
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'repair exact splice drift: reserve_tool_call(text,text,integer,text,jsonb,text)'; END IF;
 EXECUTE replace(definition,old,$replacement$NOT public.tool_call_payload_size_allowed(payload)$replacement$);
END $repair$;


-- Assert one exact splice; preserve every other authority/accounting/receipt term.
DO $repair$ DECLARE definition text; old text=$needle$octet_length(payload::text)>262144$needle$; BEGIN
 definition=pg_get_functiondef('public.reserve_tool_call_v2(text,text,integer,text,jsonb,text,text,text)'::regprocedure);
 IF (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'repair exact splice drift: reserve_tool_call_v2(text,text,integer,text,jsonb,text,text,text)'; END IF;
 EXECUTE replace(definition,old,$replacement$NOT public.tool_call_payload_size_allowed(payload)$replacement$);
END $repair$;
