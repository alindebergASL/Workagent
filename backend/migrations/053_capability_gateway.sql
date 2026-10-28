-- Additive opt-in. No existing catalog, grant, receipt, or money is reset.
CREATE TABLE capability_installations (
 id text NOT NULL, version text NOT NULL, descriptor jsonb NOT NULL,
 enabled boolean NOT NULL DEFAULT true, PRIMARY KEY(id,version)
);
CREATE TABLE tool_budget_accounts (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id),
 principal_id text NOT NULL, provider_grant_id text REFERENCES provider_grants(id),
 limits jsonb NOT NULL CHECK(jsonb_typeof(limits)='object'),
 FOREIGN KEY(workspace_id,principal_id) REFERENCES memberships(workspace_id,principal_id)
);
CREATE TABLE tool_grants (
 id text PRIMARY KEY, workspace_id text NOT NULL, run_id text NOT NULL,
 data jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
 UNIQUE(workspace_id,run_id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id)
);
CREATE TABLE tool_attempts (
 id text PRIMARY KEY, workspace_id text NOT NULL, run_id text NOT NULL,
 call_id text NOT NULL, grant_id text NOT NULL REFERENCES tool_grants(id),
 account_id text NOT NULL REFERENCES tool_budget_accounts(id),
 capability_id text NOT NULL, capability_version text NOT NULL,
 call jsonb NOT NULL, call_sha256 text NOT NULL, descriptor jsonb NOT NULL,
 run_fence integer NOT NULL, lease_hash text NOT NULL, receipt_hash text NOT NULL,
 scope_sha256 text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,run_id,call_id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id)
);
CREATE TABLE tool_attempt_events (
 attempt_id text NOT NULL REFERENCES tool_attempts(id),
 kind text NOT NULL CHECK(kind IN ('dispatch','observation')),
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(attempt_id,kind)
);
CREATE TABLE tool_cost_entries (
 attempt_id text NOT NULL REFERENCES tool_attempts(id),
 kind text NOT NULL CHECK(kind IN ('reserved','settled')),
 category text NOT NULL CHECK(category IN ('local_compute','search','extraction','rendering','connector','child')),
 units bigint NOT NULL CHECK(units>=0), cost_usd numeric(12,6) NOT NULL CHECK(cost_usd>=0),
 basis text NOT NULL CHECK(basis IN ('reserved','provider_reported','estimated','unknown','reconciled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(attempt_id,kind)
);
CREATE FUNCTION guard_tool_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
 THEN RAISE EXCEPTION 'owner-installed tool authority required'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'retained authority'; END IF;
 IF TG_OP='UPDATE' AND ((TG_TABLE_NAME='capability_installations' AND
       (to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled')) OR
       (TG_TABLE_NAME='tool_grants' AND (to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active')) OR
       TG_TABLE_NAME='tool_budget_accounts')
 THEN RAISE EXCEPTION 'immutable authority binding'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tool_install_owner BEFORE INSERT OR UPDATE OR DELETE ON capability_installations FOR EACH ROW EXECUTE FUNCTION guard_tool_authority();
CREATE TRIGGER tool_grant_owner BEFORE INSERT OR UPDATE OR DELETE ON tool_grants FOR EACH ROW EXECUTE FUNCTION guard_tool_authority();
CREATE TRIGGER tool_account_owner BEFORE INSERT OR UPDATE OR DELETE ON tool_budget_accounts FOR EACH ROW EXECUTE FUNCTION guard_tool_authority();
CREATE TRIGGER tool_attempt_immutable BEFORE UPDATE OR DELETE ON tool_attempts FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER tool_event_immutable BEFORE UPDATE OR DELETE ON tool_attempt_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER tool_cost_immutable BEFORE UPDATE OR DELETE ON tool_cost_entries FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION tool_json_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(sha256(convert_to(acceptance_canonical_json(value),'UTF8')),'hex')
$$;

-- Same workspace lock and canonical run/lease/generation as every existing worker.
-- Caller acquires workspace BEFORE the shared accounting lock; no locks cross IO.
CREATE FUNCTION tool_authorized(ws text, rid text, fence integer, lease text, gid text, work_version bigint)
 RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r runs; g tool_grants; a tool_budget_accounts; cfg jsonb; ok boolean;
BEGIN
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=rid;
 SELECT * INTO g FROM tool_grants WHERE id=gid AND workspace_id=ws AND run_id=rid;
 SELECT * INTO a FROM tool_budget_accounts WHERE id=g.data->>'budget_account_id';
 IF r.id IS NULL OR g.id IS NULL OR a.id IS NULL THEN RETURN false; END IF;
 SELECT EXISTS(SELECT 1 FROM workspaces w JOIN memberships m ON m.workspace_id=w.id
   WHERE w.id=ws AND m.principal_id=r.data->>'principal_id' AND m.active AND m.role<>'viewer'
   AND r.data->'access_generation'=to_jsonb(w.access_generation)
   AND g.data->'access_generation'=to_jsonb(w.access_generation)) INTO ok;
 IF NOT ok OR NOT g.active OR g.data->>'principal_id' IS DISTINCT FROM r.data->>'principal_id'
   OR a.workspace_id<>ws OR a.principal_id IS DISTINCT FROM r.data->>'principal_id'
   OR g.data->>'scope_id' IS DISTINCT FROM coalesce(r.conversation_id,r.assignment_id)
   OR (g.data->>'expires_at')::timestamptz<=clock_timestamp()
   OR r.data->>'state'<>'running' OR r.data->'fence'<>to_jsonb(fence)
   OR r.lease_hash IS DISTINCT FROM lease OR (r.data->>'lease_expires_at')::timestamptz<=clock_timestamp()
 THEN RETURN false; END IF;
 IF r.conversation_id IS NOT NULL THEN
   SELECT EXISTS(SELECT 1 FROM conversations cv WHERE cv.workspace_id=ws AND cv.id=r.conversation_id
     AND cv.data->>'owner_id'=r.data->>'principal_id' AND cv.data->>'state'='open'
     AND cv.data->'work_version'=to_jsonb(work_version)
     AND work_refs_visible(ws,r.data->>'principal_id',cv.data->'selected_source_refs')) INTO ok;
 ELSE
   SELECT EXISTS(SELECT 1 FROM assignments x WHERE x.workspace_id=ws AND x.id=r.assignment_id
     AND x.data->>'state' NOT IN ('paused','cancelled') AND x.data->'work_version'=to_jsonb(work_version)
     AND work_refs_visible(ws,r.data->>'principal_id',x.data->'selected_source_refs')) INTO ok;
 END IF;
 IF NOT coalesce(ok,false) THEN RETURN false; END IF;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=ws AND run_id=rid;
 IF cfg->>'grant_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM provider_grants pg
     WHERE pg.id=cfg->>'grant_id' AND pg.active) THEN RETURN false; END IF;
 IF a.provider_grant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM provider_grants pg
     WHERE pg.id=a.provider_grant_id AND pg.active AND pg.workspace_id=ws
       AND pg.principal_id=r.data->>'principal_id') THEN RETURN false; END IF;
 RETURN true;
END $$;

CREATE FUNCTION tool_shared_reserved(gid text) RETURNS numeric LANGUAGE sql STABLE AS $$
 SELECT coalesce(sum(e.cost_usd),0) FROM tool_cost_entries e
 JOIN tool_attempts a ON a.id=e.attempt_id JOIN tool_budget_accounts b ON b.id=a.account_id
 WHERE e.kind='reserved' AND b.provider_grant_id IN (SELECT responses_budget_grants(gid))
$$;
CREATE FUNCTION tool_assert_money(gid text, addition numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE total numeric; cap numeric;
BEGIN
 IF gid IS NULL THEN
   IF addition<>0 THEN RAISE EXCEPTION 'paid authority required'; END IF;
   RETURN;
 END IF;
 SELECT (data->'responses'->>'cost_limit_usd')::numeric INTO cap FROM provider_grants WHERE id=gid;
 SELECT coalesce(sum((e.data->>'reserved_cost_usd')::numeric),0) INTO total
 FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
 WHERE e.kind='dispatch' AND s.grant_id IN (SELECT responses_budget_grants(gid));
 IF cap IS NULL OR total+responses_carried_cost(gid)+tool_shared_reserved(gid)+addition>cap
 THEN RAISE EXCEPTION 'shared cumulative project budget exhausted'; END IF;
END $$;
-- Existing model reservations and tool reservations serialize on the SAME lock.
CREATE FUNCTION guard_tool_shared_model_cost() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid text;
BEGIN
 IF NEW.kind='dispatch' THEN
   IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read committed required'; END IF;
   SELECT grant_id INTO gid FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
   PERFORM pg_advisory_xact_lock(721004120);
   PERFORM tool_assert_money(gid,(NEW.data->>'reserved_cost_usd')::numeric);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_tool_shared_model_cost BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION guard_tool_shared_model_cost();

CREATE FUNCTION reserve_tool_call(ws text, rid text, fence integer, lease text, payload jsonb, receipt text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE g public.tool_grants; d jsonb; b public.tool_budget_accounts; prior public.tool_attempts;
 aid text; pin jsonb; reserved_units bigint; used bigint; cost_category text; price numeric;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read committed required'; END IF;
 PERFORM id FROM public.workspaces WHERE id=ws FOR UPDATE;
 SELECT * INTO g FROM public.tool_grants WHERE workspace_id=ws AND run_id=rid;
 IF NOT public.tool_authorized(ws,rid,fence,lease,g.id,(payload->>'expected_work_version')::bigint)
 THEN RAISE EXCEPTION 'tool authority denied'; END IF;
 IF payload-ARRAY['schema_version','call_id','capability_id','capability_version','arguments','input_refs','expected_work_version']<>'{}'::jsonb
   OR payload->>'schema_version' IS DISTINCT FROM 'tool-call/v1'
   OR jsonb_typeof(payload->'arguments') IS DISTINCT FROM 'object'
   OR jsonb_typeof(payload->'input_refs') IS DISTINCT FROM 'array'
   OR octet_length(payload::text)>262144 OR receipt !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'closed tool call required'; END IF;
 SELECT descriptor INTO d FROM public.capability_installations WHERE id=payload->>'capability_id'
   AND version=payload->>'capability_version' AND enabled;
 SELECT value INTO pin FROM jsonb_array_elements(g.data->'capabilities') WHERE value->>'id'=payload->>'capability_id';
 IF d IS NULL OR pin IS NULL OR d->>'installation_state'<>'installed'
   OR pin->>'version' IS DISTINCT FROM d->>'version'
   OR pin->>'schema_sha256' IS DISTINCT FROM d->>'schema_sha256'
   OR pin->>'implementation_sha256' IS DISTINCT FROM d->>'implementation_sha256'
   OR NOT ((g.data->'effects') @> (d->'effects')) OR NOT ((g.data->'privacy_classes') @> (d->'privacy_classes'))
   OR NOT ((g.data->'resource_selectors') @> (payload->'input_refs'))
   OR (d->>'required_permission_template'='public_https' AND g.data->>'egress'<>'public_https')
 THEN RAISE EXCEPTION 'descriptor is not permission'; END IF;
 SELECT * INTO prior FROM public.tool_attempts WHERE workspace_id=ws AND run_id=rid AND call_id=payload->>'call_id';
 IF prior.id IS NOT NULL THEN
   IF prior.call IS DISTINCT FROM payload OR prior.scope_sha256 IS DISTINCT FROM public.tool_scope_hash(ws,rid)
   THEN RAISE EXCEPTION 'call or immutable input conflict'; END IF;
   RETURN prior.id;
 END IF;
 SELECT * INTO b FROM public.tool_budget_accounts WHERE id=g.data->>'budget_account_id';
 PERFORM pg_advisory_xact_lock(721004120);
 cost_category=d->'cost_profile'->>'category'; reserved_units=(d->'cost_profile'->>'reserved_units')::bigint;
 price=(d->'cost_profile'->>'reserved_cost_usd')::numeric;
 SELECT coalesce(sum(e.units),0) INTO used FROM public.tool_cost_entries e JOIN public.tool_attempts a ON a.id=e.attempt_id
 WHERE a.account_id=b.id AND e.kind='reserved' AND e.category=cost_category;
 IF b.limits->>cost_category IS NULL OR used+reserved_units>(b.limits->>cost_category)::bigint THEN RAISE EXCEPTION 'tool capacity exhausted'; END IF;
 PERFORM public.tool_assert_money(b.provider_grant_id,price);
 aid=gen_random_uuid()::text;
 INSERT INTO public.tool_attempts VALUES(aid,ws,rid,payload->>'call_id',g.id,b.id,d->>'id',d->>'version',
   payload,public.tool_json_hash(payload),d,fence,lease,receipt,public.tool_scope_hash(ws,rid),clock_timestamp());
 INSERT INTO public.tool_cost_entries(attempt_id,kind,category,units,cost_usd,basis) VALUES(aid,'reserved',cost_category,reserved_units,price,'reserved');
 RETURN aid;
END $$;

CREATE FUNCTION dispatch_tool_call(aid text, fence integer, lease text, receipt_secret text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.tool_attempts; current_descriptor jsonb;
BEGIN
 SELECT * INTO a FROM public.tool_attempts WHERE id=aid;
 PERFORM id FROM public.workspaces WHERE id=a.workspace_id FOR UPDATE;
 IF NOT public.tool_authorized(a.workspace_id,a.run_id,fence,lease,a.grant_id,(a.call->>'expected_work_version')::bigint)
   OR a.run_fence<>fence OR a.lease_hash IS DISTINCT FROM lease THEN RAISE EXCEPTION 'tool authority denied'; END IF;
 SELECT descriptor INTO current_descriptor FROM public.capability_installations
 WHERE id=a.capability_id AND version=a.capability_version AND enabled;
 IF current_descriptor IS DISTINCT FROM a.descriptor
   OR a.scope_sha256 IS DISTINCT FROM public.tool_scope_hash(a.workspace_id,a.run_id)
 THEN RAISE EXCEPTION 'schema or input drift'; END IF;
 IF EXISTS(SELECT 1 FROM public.tool_attempt_events WHERE attempt_id=aid)
   OR a.receipt_hash IS DISTINCT FROM public.tool_json_hash(to_jsonb(receipt_secret)) THEN RETURN false; END IF;
 INSERT INTO public.tool_attempt_events(attempt_id,kind,data) VALUES(aid,'dispatch','{}');
 RETURN true;
END $$;

CREATE FUNCTION settle_tool_call(aid text, receipt_secret text, observation jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.tool_attempts; existing jsonb; live boolean; result jsonb; d jsonb;
BEGIN
 SELECT * INTO a FROM public.tool_attempts WHERE id=aid;
 IF a.id IS NULL OR a.receipt_hash IS DISTINCT FROM public.tool_json_hash(to_jsonb(receipt_secret))
 THEN RAISE EXCEPTION 'receipt authority denied'; END IF;
 PERFORM id FROM public.workspaces WHERE id=a.workspace_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.tool_attempt_events WHERE attempt_id=aid AND kind='dispatch') THEN RAISE EXCEPTION 'dispatch required'; END IF;
 SELECT descriptor INTO d FROM public.capability_installations WHERE id=a.capability_id AND version=a.capability_version AND enabled;
 live=public.tool_authorized(a.workspace_id,a.run_id,a.run_fence,a.lease_hash,a.grant_id,(a.call->>'expected_work_version')::bigint)
   AND d IS NOT DISTINCT FROM a.descriptor
   AND a.scope_sha256 IS NOT DISTINCT FROM public.tool_scope_hash(a.workspace_id,a.run_id);
 SELECT data INTO existing FROM public.tool_attempt_events WHERE attempt_id=aid AND kind='observation';
 IF existing IS NOT NULL THEN
   IF coalesce(live,false) THEN RETURN existing; END IF;
   RETURN existing || jsonb_build_object('status','cost_only','output',NULL,'output_sha256',NULL,
      'output_refs','[]'::jsonb,'source_refs','[]'::jsonb,'input_refs','[]'::jsonb,'omissions','[]'::jsonb,
      'error',jsonb_build_object('code','authority_changed','retryable',false));
 END IF;
 IF observation->>'attempt_id' IS DISTINCT FROM aid OR observation->>'run_id' IS DISTINCT FROM a.run_id
   OR observation->>'call_id' IS DISTINCT FROM a.call_id OR observation->>'capability_id' IS DISTINCT FROM a.capability_id
   OR observation->>'capability_version' IS DISTINCT FROM a.capability_version
   OR observation->>'implementation_sha256' IS DISTINCT FROM a.descriptor->>'implementation_sha256'
   OR observation->'input_refs' IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
      'kind','run_scope','id',a.run_id,'version',a.call->>'expected_work_version','sha256',a.scope_sha256))
   OR observation->'cost'->>'reserved_cost_usd' IS DISTINCT FROM a.descriptor->'cost_profile'->>'reserved_cost_usd'
   OR observation->'cost'->'reserved_units' IS DISTINCT FROM a.descriptor->'cost_profile'->'reserved_units'
   OR observation->>'execution_profile' IS DISTINCT FROM a.descriptor->>'execution_profile'
   OR observation->'cost'->>'category' IS DISTINCT FROM a.descriptor->'cost_profile'->>'category'
   OR observation->'cost'->>'unit' IS DISTINCT FROM a.descriptor->'cost_profile'->>'unit'
   OR observation->>'schema_version' IS DISTINCT FROM 'tool-observation/v1'
   OR observation->>'status' NOT IN ('observed','failed','cost_only','outcome_unknown')
   OR (observation->>'status'='observed' AND (observation->>'output_sha256' IS DISTINCT FROM public.tool_json_hash(observation->'output')
       OR jsonb_typeof(observation->'output') IS DISTINCT FROM 'object'))
   OR (observation->>'status'<>'observed' AND observation->'output'<>'null'::jsonb)
   OR octet_length(public.acceptance_canonical_json(observation->'output'))>(a.descriptor->>'result_byte_limit')::integer
 THEN RAISE EXCEPTION 'exact observation binding required'; END IF;
 result=observation;
 IF NOT coalesce(live,false) THEN
   result=result || jsonb_build_object('status','cost_only','output',NULL,'output_sha256',NULL,
     'output_refs','[]'::jsonb,'source_refs','[]'::jsonb,'input_refs','[]'::jsonb,'omissions','[]'::jsonb,
     'error',jsonb_build_object('code','authority_changed','retryable',false));
 END IF;
 INSERT INTO public.tool_attempt_events(attempt_id,kind,data) VALUES(aid,'observation',result);
 INSERT INTO public.tool_cost_entries(attempt_id,kind,category,units,cost_usd,basis)
 VALUES(aid,'settled',a.descriptor->'cost_profile'->>'category',
   coalesce((result->'cost'->>'observed_units')::bigint,0),
   coalesce((result->'cost'->>'observed_cost_usd')::numeric,0),result->'cost'->>'basis');
 -- Metadata-only existing event path. No stale output can publish from this receipt.
 INSERT INTO public.audit(id,workspace_id,principal_id,operation,object_id)
 SELECT gen_random_uuid()::text,a.workspace_id,r.data->>'principal_id','tool_observation',a.run_id
 FROM public.runs r WHERE r.workspace_id=a.workspace_id AND r.id=a.run_id;
 RETURN result;
END $$;

CREATE FUNCTION tool_scope_hash(ws text,rid text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT tool_json_hash(jsonb_build_object('configuration',cfg.data,
   'scope',coalesce(cv.data,a.data),'resources',checkpoint_scope_fingerprint(r,cfg.data)))
 FROM runs r JOIN run_configurations cfg ON cfg.workspace_id=r.workspace_id AND cfg.run_id=r.id
 LEFT JOIN conversations cv ON cv.workspace_id=r.workspace_id AND cv.id=r.conversation_id
 LEFT JOIN assignments a ON a.workspace_id=r.workspace_id AND a.id=r.assignment_id
 WHERE r.workspace_id=ws AND r.id=rid
$$;

-- Consumption authority deliberately does not require an old worker's lease:
-- a current reclaimed worker may reuse an observed result, but never resend it.
CREATE FUNCTION tool_run_available(ws text,rid text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE g tool_grants; r runs; pin jsonb; d jsonb; b tool_budget_accounts; cfg jsonb;
BEGIN
 SELECT * INTO g FROM tool_grants WHERE workspace_id=ws AND run_id=rid;
 IF g.id IS NULL THEN RETURN true; END IF;
 SELECT * INTO r FROM runs WHERE workspace_id=ws AND id=rid;
 SELECT * INTO b FROM tool_budget_accounts WHERE id=g.data->>'budget_account_id';
 IF NOT g.active OR (g.data->>'expires_at')::timestamptz<=clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM workspaces w JOIN memberships m ON m.workspace_id=w.id
     WHERE w.id=ws AND m.active AND m.role<>'viewer' AND m.principal_id=r.data->>'principal_id'
       AND g.data->>'principal_id'=m.principal_id AND g.data->'access_generation'=to_jsonb(w.access_generation))
 THEN RETURN false; END IF;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=ws AND run_id=rid;
 IF cfg->>'grant_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM provider_grants pg WHERE pg.id=cfg->>'grant_id' AND pg.active)
 THEN RETURN false; END IF;
 IF b.provider_grant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM provider_grants pg WHERE pg.id=b.provider_grant_id AND pg.active)
 THEN RETURN false; END IF;
 FOR pin IN SELECT value FROM jsonb_array_elements(g.data->'capabilities') LOOP
   SELECT descriptor INTO d FROM capability_installations WHERE id=pin->>'id' AND version=pin->>'version' AND enabled;
   IF d IS NULL OR d->>'schema_sha256' IS DISTINCT FROM pin->>'schema_sha256'
     OR d->>'implementation_sha256' IS DISTINCT FROM pin->>'implementation_sha256'
     OR NOT ((g.data->'effects') @> (d->'effects')) OR NOT ((g.data->'privacy_classes') @> (d->'privacy_classes'))
   THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION guard_tool_consumption() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; bound boolean; obs jsonb;
BEGIN
 IF NEW.kind NOT IN ('count_send','dispatch','tool_result') THEN RETURN NEW; END IF;
 SELECT rr.* INTO r FROM runs rr JOIN provider_attempts a ON a.workspace_id=rr.workspace_id AND a.run_id=rr.id
 WHERE a.id=NEW.attempt_id;
 PERFORM id FROM workspaces WHERE id=r.workspace_id FOR UPDATE;
 IF NOT tool_run_available(r.workspace_id,r.id) THEN RAISE EXCEPTION 'tool consumption authority revoked'; END IF;
 SELECT EXISTS(SELECT 1 FROM tool_grants WHERE workspace_id=r.workspace_id AND run_id=r.id) INTO bound;
 IF bound AND NEW.kind='tool_result' AND (NEW.data->'decision'->>'kind' IS NULL
    OR NEW.data->'decision'->>'kind' NOT IN ('reply','stop','read_context','inspect_json','fetch_public_url','discover_capabilities','load_skill'))
 THEN RAISE EXCEPTION 'operation not installed in capability gateway'; END IF;
 IF bound AND NEW.kind='tool_result' AND NEW.data->'capability_result'->>'capability'
     IN ('read_context','inspect_json','fetch_public_url','discover_capabilities','load_skill') THEN
   SELECT e.data INTO obs FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation'
   WHERE a.workspace_id=r.workspace_id AND a.run_id=r.id AND a.call_id=NEW.phase;
   IF obs IS NULL OR obs->>'status'<>'observed' OR obs->'output' IS DISTINCT FROM NEW.data->'capability_result'
   THEN RAISE EXCEPTION 'exact authorized tool observation required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_tool_consumption BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION guard_tool_consumption();
ALTER FUNCTION require_general_publication_authority(runs) RENAME TO require_general_publication_authority_pre_tools;
CREATE FUNCTION require_general_publication_authority(r runs) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT tool_run_available(r.workspace_id,r.id) THEN RAISE EXCEPTION 'tool publication authority revoked'; END IF;
 PERFORM require_general_publication_authority_pre_tools(r);
END $$;

REVOKE ALL ON capability_installations,tool_budget_accounts,tool_grants,tool_attempts,tool_attempt_events,tool_cost_entries FROM PUBLIC;
-- Upgrade existing runtime readers, not only freshly provisioned test roles.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='responses_events' AND privilege_type='INSERT'
     AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP
   EXECUTE format('GRANT SELECT ON capability_installations,tool_budget_accounts,tool_grants,tool_attempts,tool_attempt_events,tool_cost_entries TO %I',r.grantee);
 END LOOP;
END $$;
