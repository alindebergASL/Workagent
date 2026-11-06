-- Fresh study stores only. Install atomically as trusted non-runtime owner.
BEGIN;
CREATE SCHEMA study_funding;
REVOKE ALL ON SCHEMA study_funding FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.responses_events WHERE kind='dispatch')
 THEN RAISE EXCEPTION 'fresh_store_required'; END IF;
END $$;
CREATE TABLE study_funding.binding (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 database_name text NOT NULL, database_oid oid NOT NULL,
 plan_sha256 text NOT NULL CHECK(plan_sha256 ~ '^[0-9a-f]{64}$'),
 project_id text NOT NULL CHECK(project_id ~ '^proj_[A-Za-z0-9_-]{1,100}$'),
 grants jsonb NOT NULL CHECK(jsonb_typeof(grants)='object'),
 binding_sha256 text NOT NULL UNIQUE CHECK(binding_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE TABLE study_funding.certificates (
 id text PRIMARY KEY CHECK(length(id)>0),
 issuer_database text NOT NULL CHECK(issuer_database='workagent_test_47b87fe3b82e'),
 issuer_oid oid NOT NULL CHECK(issuer_oid=7704275),
 target_database text NOT NULL, target_binding_sha256 text NOT NULL
   REFERENCES study_funding.binding(binding_sha256),
 amount_usd numeric NOT NULL CHECK(amount_usd>0 AND amount_usd<'Infinity'::numeric),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION study_funding.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'immutable_funding_evidence'; END $$;
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE OR TRUNCATE ON study_funding.binding
 FOR EACH STATEMENT EXECUTE FUNCTION study_funding.immutable();
CREATE TRIGGER immutable_certificate BEFORE UPDATE OR DELETE OR TRUNCATE ON study_funding.certificates
 FOR EACH STATEMENT EXECUTE FUNCTION study_funding.immutable();
-- Also prevent truncate from removing a commitment or its immutable attribution.
CREATE TRIGGER funding_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.responses_events
 FOR EACH STATEMENT EXECUTE FUNCTION study_funding.immutable();
CREATE TRIGGER funding_steps_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.responses_steps
 FOR EACH STATEMENT EXECUTE FUNCTION study_funding.immutable();
CREATE FUNCTION study_funding.bind_exact(plan text, project text, grant_hashes jsonb)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE db_oid oid; h text; old study_funding.binding;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='study_funding'))
 THEN RAISE EXCEPTION 'owner_only'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required'; END IF;
 PERFORM pg_advisory_xact_lock(721004120);
 SELECT oid INTO db_oid FROM pg_database WHERE datname=current_database();
 IF current_database() !~ '^workagent_test_[a-z0-9_]+$' OR current_database()='workagent_test_47b87fe3b82e'
 OR jsonb_typeof(grant_hashes) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'fresh_study_binding_required'; END IF;
 IF (SELECT count(*) FROM jsonb_each(grant_hashes))<>2 OR
 (SELECT count(DISTINCT g.workspace_id) FROM public.provider_grants g
   WHERE grant_hashes->>g.id=md5(g.data::text) AND g.data->'responses'->>'project_id'=project
   AND g.data->'responses'->>'transport_mode'='official_api'
   AND (g.data->'responses'->>'cost_limit_usd')::numeric=12)<>2 OR
 EXISTS (SELECT 1 FROM public.provider_grants g WHERE g.data->'responses'->>'transport_mode'='official_api'
   AND NOT grant_hashes ? g.id)
 THEN RAISE EXCEPTION 'exact_two_grants_required'; END IF;
 h=encode(sha256(convert_to(jsonb_build_object('database',current_database(),'oid',db_oid::text,
   'plan_sha256',plan,'project_id',project,'grants',grant_hashes)::text,'UTF8')),'hex');
 SELECT * INTO old FROM study_funding.binding;
 IF FOUND THEN
   IF old.binding_sha256 IS DISTINCT FROM h THEN RAISE EXCEPTION 'binding_replay_mismatch'; END IF;
   RETURN h;
 END IF;
 INSERT INTO study_funding.binding VALUES(true,current_database(),db_oid,plan,project,grant_hashes,h);
 RETURN h;
END $$;
CREATE FUNCTION study_funding.check_certificate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM study_funding.binding b WHERE b.database_name=current_database()
   AND b.database_oid=(SELECT oid FROM pg_database WHERE datname=current_database())
   AND NEW.target_database=b.database_name AND NEW.target_binding_sha256=b.binding_sha256)
 THEN RAISE EXCEPTION 'certificate_target_mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_certificate BEFORE INSERT ON study_funding.certificates
 FOR EACH ROW EXECUTE FUNCTION study_funding.check_certificate();
CREATE FUNCTION study_funding.install_certificate(cert text, issuer text, issuer_oid oid,
 target text, target_hash text, amount numeric) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE old study_funding.certificates;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='study_funding'))
 THEN RAISE EXCEPTION 'owner_only'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required'; END IF;
 PERFORM pg_advisory_xact_lock(721004120);
 SELECT * INTO old FROM study_funding.certificates WHERE id=cert;
 IF FOUND THEN
   IF (old.issuer_database,old.issuer_oid,old.target_database,old.target_binding_sha256,old.amount_usd)
     IS DISTINCT FROM (issuer,issuer_oid,target,target_hash,amount)
   THEN RAISE EXCEPTION 'certificate_replay_mismatch'; END IF;
   RETURN;
 END IF;
 INSERT INTO study_funding.certificates(id,issuer_database,issuer_oid,target_database,target_binding_sha256,amount_usd)
 VALUES(cert,issuer,issuer_oid,target,target_hash,amount);
END $$;
-- Conservative projection only; no settlement, ledger rewrite, or cached rebate.
CREATE FUNCTION study_funding.retained_cost(d public.responses_events) RETURNS numeric
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s public.responses_steps; r public.responses_events; ident public.responses_events;
 req jsonb; u jsonb; k text; v numeric; i numeric; o numeric; amount numeric;
BEGIN
 amount=(d.data->>'reserved_cost_usd')::numeric;
 IF amount IS NULL OR amount<0 OR amount>='Infinity'::numeric THEN RAISE EXCEPTION 'invalid_reservation'; END IF;
 -- All reservations inserted after this package are exact. Defense for corrupt imports.
 IF d.data->>'reserved_input_tokens' IS DISTINCT FROM '50000'
 OR d.data->>'reserved_output_tokens' IS DISTINCT FROM '8192' OR amount<>0.206920
 THEN RAISE EXCEPTION 'invalid_reservation'; END IF;
 SELECT * INTO STRICT s FROM public.responses_steps WHERE attempt_id=d.attempt_id AND phase=d.phase;
 BEGIN
   IF NOT EXISTS (SELECT 1 FROM public.provider_grants g CROSS JOIN study_funding.binding b
     WHERE g.id=s.grant_id AND b.grants->>g.id=md5(g.data::text)
     AND g.data->'responses'->>'project_id'=b.project_id
     AND g.data->'responses'->>'transport_mode'='official_api') THEN RETURN amount; END IF;
   req=s.request_bytes::jsonb;
   IF req->>'model' IS DISTINCT FROM 'gpt-6.1-sol' OR req->>'service_tier' IS DISTINCT FROM 'default'
   OR encode(sha256(convert_to(s.request_bytes,'UTF8')),'hex') IS DISTINCT FROM s.request_sha256
   OR req->'metadata' IS DISTINCT FROM s.metadata
   OR s.metadata->>'attempt_id' IS DISTINCT FROM d.attempt_id OR s.metadata->>'step_id' IS DISTINCT FROM d.phase
   THEN RETURN amount; END IF;
   IF (SELECT count(*) FROM public.responses_events WHERE attempt_id=d.attempt_id AND phase=d.phase
       AND kind='dispatch')<>1 THEN RETURN amount; END IF;
   SELECT * INTO STRICT r FROM public.responses_events WHERE attempt_id=d.attempt_id AND phase=d.phase AND kind='result';
   SELECT * INTO STRICT ident FROM public.responses_events WHERE attempt_id=d.attempt_id AND phase=d.phase AND kind='identity';
   IF coalesce(r.data->>'state','') NOT IN ('completed','function_call')
   OR coalesce(r.data->>'response_id','') !~ '^resp_[A-Za-z0-9_-]{1,200}$'
   OR r.data->>'request_sha256' IS DISTINCT FROM s.request_sha256 OR r.data->'metadata' IS DISTINCT FROM s.metadata
   OR r.data->'provenance'->>'mode' IS DISTINCT FROM 'official_api'
   OR r.data->'provenance'->>'origin' IS DISTINCT FROM 'https://api.openai.com'
   OR ident.data->>'response_id' IS DISTINCT FROM r.data->>'response_id'
   OR ident.data->>'request_sha256' IS DISTINCT FROM s.request_sha256 OR ident.data->'metadata' IS DISTINCT FROM s.metadata
   OR ident.data->'provenance'->>'mode' IS DISTINCT FROM 'official_api'
   OR ident.data->'provenance'->>'origin' IS DISTINCT FROM 'https://api.openai.com'
   OR (SELECT count(*) FROM public.responses_events WHERE kind='result' AND data->>'response_id'=r.data->>'response_id')<>1
   OR EXISTS (SELECT 1 FROM public.responses_events e WHERE e.kind='identity' AND e.data->>'response_id'=r.data->>'response_id'
       AND (e.attempt_id,e.phase) IS DISTINCT FROM (d.attempt_id,d.phase))
   THEN RETURN amount; END IF;
   u=r.data->'usage';
   FOREACH k IN ARRAY ARRAY['input_tokens','output_tokens','total_tokens','cached_input_tokens','reasoning_tokens'] LOOP
     IF jsonb_typeof(u->k) IS DISTINCT FROM 'number' THEN RETURN amount; END IF;
     v=(u->>k)::numeric;
     IF v<0 OR v>='Infinity'::numeric OR v<>trunc(v) THEN RETURN amount; END IF;
   END LOOP;
   i=(u->>'input_tokens')::numeric; o=(u->>'output_tokens')::numeric;
   IF i>50000 OR o>8192 OR (u->>'total_tokens')::numeric<>i+o
   OR (u->>'cached_input_tokens')::numeric>i OR (u->>'reasoning_tokens')::numeric>o THEN RETURN amount; END IF;
   RETURN (i*2.5+o*10)/1000000;
 EXCEPTION WHEN no_data_found OR too_many_rows OR data_exception THEN RETURN amount;
 END;
END $$;
CREATE FUNCTION study_funding.guard_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b study_funding.binding; s public.responses_steps; g public.provider_grants;
 funded numeric; retained numeric;
BEGIN
 IF NEW.kind NOT IN ('count_send','dispatch','read','cancel','identity','result') THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required'; END IF;
 -- Runs after existing workspace-locking guards (zz name); no table locks.
 PERFORM pg_advisory_xact_lock(721004120);
 -- Duplicate receipt identities cannot later invalidate already consumed releases.
 IF NEW.kind IN ('identity','result') THEN
   IF EXISTS (SELECT 1 FROM public.responses_events e WHERE
      (e.attempt_id=NEW.attempt_id AND e.phase=NEW.phase AND e.kind=NEW.kind) OR
      (e.kind IN ('identity','result') AND e.data->>'response_id'=NEW.data->>'response_id'
       AND (e.attempt_id,e.phase) IS DISTINCT FROM (NEW.attempt_id,NEW.phase)))
   THEN RAISE EXCEPTION 'duplicate_funding_receipt'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO STRICT b FROM study_funding.binding;
 SELECT * INTO STRICT s FROM public.responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
 SELECT * INTO STRICT g FROM public.provider_grants WHERE id=s.grant_id;
 IF b.database_name<>current_database() OR b.database_oid<>(SELECT oid FROM pg_database WHERE datname=current_database())
 OR b.grants->>g.id IS DISTINCT FROM md5(g.data::text)
 OR g.data->'responses'->>'project_id' IS DISTINCT FROM b.project_id
 OR g.data->'responses'->>'transport_mode' IS DISTINCT FROM 'official_api'
 THEN RAISE EXCEPTION 'funding_scope_mismatch'; END IF;
 SELECT coalesce(sum(amount_usd),0) INTO funded FROM study_funding.certificates;
 IF funded<=0 THEN RAISE EXCEPTION 'funding_inactive'; END IF;
 IF NEW.kind='dispatch' THEN
   IF NEW.data->>'reserved_input_tokens' IS DISTINCT FROM '50000'
   OR NEW.data->>'reserved_output_tokens' IS DISTINCT FROM '8192'
   OR (NEW.data->>'reserved_cost_usd')::numeric IS DISTINCT FROM 0.206920::numeric
   THEN RAISE EXCEPTION 'exact_reservation_required'; END IF;
   IF EXISTS (SELECT 1 FROM public.responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='dispatch')
   THEN RAISE EXCEPTION 'duplicate_dispatch'; END IF;
   SELECT coalesce(sum(study_funding.retained_cost(e)),0) INTO retained
     FROM public.responses_events e WHERE e.kind='dispatch'; -- EVERY grant, no filtering
   IF retained+0.206920>funded THEN RAISE EXCEPTION 'recipient_funding_exhausted'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_study_funding BEFORE INSERT ON public.responses_events
 FOR EACH ROW EXECUTE FUNCTION study_funding.guard_event();
ALTER TABLE public.responses_events ENABLE ALWAYS TRIGGER zz_study_funding;
REVOKE ALL ON ALL TABLES IN SCHEMA study_funding FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA study_funding FROM PUBLIC;
-- Installer default ACLs must not accidentally confer runtime authority.
DO $$ DECLARE r record; BEGIN
 FOR r IN
   SELECT DISTINCT pg_get_userbyid(a.grantee) AS role_name FROM (
     SELECT x.grantee FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) x WHERE n.nspname='study_funding'
     UNION SELECT x.grantee FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       CROSS JOIN LATERAL aclexplode(c.relacl) x WHERE n.nspname='study_funding'
     UNION SELECT x.grantee FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       CROSS JOIN LATERAL aclexplode(p.proacl) x WHERE n.nspname='study_funding'
   ) a WHERE a.grantee<>0 AND pg_get_userbyid(a.grantee)<>current_user
 LOOP
   EXECUTE format('REVOKE ALL ON SCHEMA study_funding FROM %I CASCADE',r.role_name);
   EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA study_funding FROM %I CASCADE',r.role_name);
   EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA study_funding FROM %I CASCADE',r.role_name);
 END LOOP;
END $$;
COMMIT;
