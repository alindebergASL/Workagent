-- One-off owner-authorized TEST accounting adjustment; not a product migration.
-- Original admission counters/caps are deliberately NOT reduced. All unspent
-- old authority stays encumbered; this cannot refill an old grant.
CREATE SCHEMA IF NOT EXISTS test_budget_correction;
REVOKE ALL ON SCHEMA test_budget_correction FROM PUBLIC;
CREATE TABLE IF NOT EXISTS test_budget_correction.releases (
 dispatch_id text PRIMARY KEY,
 result_id text UNIQUE NOT NULL,
 response_id text UNIQUE NOT NULL,
 grant_id text NOT NULL,
 dispatch_hash text NOT NULL,
 result_hash text NOT NULL,
 reserved_usd numeric NOT NULL CHECK(reserved_usd>=0),
 retained_usage_upper_usd numeric NOT NULL CHECK(retained_usage_upper_usd>=0),
 released_usd numeric NOT NULL CHECK(released_usd>=0),
 authority_sha256 text NOT NULL CHECK(authority_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(reserved_usd=retained_usage_upper_usd+released_usd)
);
-- Fixed certificate(s) are allocated centrally here, not independently by
-- recipient stores. Target binding is immutable; no cross-store transfer API.
CREATE TABLE IF NOT EXISTS test_budget_correction.certificates (
 id text PRIMARY KEY,
 target_database text NOT NULL,
 target_binding_sha256 text NOT NULL CHECK(target_binding_sha256 ~ '^[0-9a-f]{64}$'),
 amount_usd numeric NOT NULL CHECK(amount_usd>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON ALL TABLES IN SCHEMA test_budget_correction FROM PUBLIC;
CREATE OR REPLACE FUNCTION test_budget_correction.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'immutable_test_accounting_history'; END $$;
DROP TRIGGER IF EXISTS immutable_release ON test_budget_correction.releases;
CREATE TRIGGER immutable_release BEFORE UPDATE OR DELETE OR TRUNCATE ON test_budget_correction.releases
 FOR EACH STATEMENT EXECUTE FUNCTION test_budget_correction.immutable();
DROP TRIGGER IF EXISTS immutable_certificate ON test_budget_correction.certificates;
CREATE TRIGGER immutable_certificate BEFORE UPDATE OR DELETE OR TRUNCATE ON test_budget_correction.certificates
 FOR EACH STATEMENT EXECUTE FUNCTION test_budget_correction.immutable();

CREATE OR REPLACE FUNCTION test_budget_correction.release_exact(
 d_id text, r_id text, d_hash text, r_hash text, auth_hash text)
RETURNS numeric LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d public.responses_events; r public.responses_events; s public.responses_steps;
 g public.provider_grants; amount numeric; used numeric; i numeric; o numeric;
 old test_budget_correction.releases;
BEGIN
 IF current_database()<>'workagent_test_47b87fe3b82e' OR (SELECT oid FROM pg_database WHERE datname=current_database())<>7704275
 THEN RAISE EXCEPTION 'canonical_issuer_required'; END IF;
 IF current_user <> pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='test_budget_correction'))
 THEN RAISE EXCEPTION 'owner_only'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required'; END IF;
 PERFORM pg_advisory_xact_lock(721004120); -- existing per-send accounting lock
 IF auth_hash IS DISTINCT FROM '73d61b550c50d04caa83077ba0883536b2012ca9eabd430de5f05c2212496965'
 THEN RAISE EXCEPTION 'exact_owner_authority_required'; END IF;
 SELECT * INTO STRICT d FROM public.responses_events WHERE id=d_id;
 SELECT * INTO STRICT r FROM public.responses_events WHERE id=r_id;
 SELECT * INTO STRICT s FROM public.responses_steps WHERE attempt_id=d.attempt_id AND phase=d.phase;
 SELECT * INTO STRICT g FROM public.provider_grants WHERE id=s.grant_id;
 IF d.kind<>'dispatch' OR r.kind<>'result' OR d.attempt_id<>r.attempt_id OR d.phase<>r.phase
 OR md5(d.data::text)<>d_hash OR md5(r.data::text)<>r_hash
 OR (g.data->'responses'->>'transport_mode') IS DISTINCT FROM 'official_api'
 OR g.id NOT IN ('workagent-input-budget-20261021-09','workagent-continuation-20261021-10',
  'workagent-continuation-20261022-11','workagent-continuation-20261022-12',
  'workagent-continuation-20261022-13','workagent-continuation-20261022-14','workagent-continuation-20261022-15')
 OR r.data->'provenance'->>'mode' IS DISTINCT FROM 'official_api'
 OR r.data->'provenance'->>'origin' IS DISTINCT FROM 'https://api.openai.com'
 OR coalesce(r.data->>'state','') NOT IN ('function_call','completed')
 OR (s.request_bytes::jsonb->>'model') IS DISTINCT FROM 'gpt-6.1-sol'
 OR (s.request_bytes::jsonb->>'service_tier') IS DISTINCT FROM 'default'
 OR r.data->>'request_sha256' IS DISTINCT FROM s.request_sha256
 OR r.data->'metadata'->>'attempt_id' IS DISTINCT FROM d.attempt_id
 OR r.data->'metadata'->>'step_id' IS DISTINCT FROM d.phase
 OR NOT EXISTS(SELECT 1 FROM public.responses_events e WHERE e.attempt_id=d.attempt_id AND e.phase=d.phase AND e.kind='identity' AND e.data->>'response_id'=r.data->>'response_id')
 THEN RAISE EXCEPTION 'exact_terminal_receipt_required'; END IF;
 IF jsonb_typeof(r.data->'usage'->'input_tokens') IS DISTINCT FROM 'number'
 OR jsonb_typeof(r.data->'usage'->'output_tokens') IS DISTINCT FROM 'number'
 THEN RAISE EXCEPTION 'known_usage_required'; END IF;
 i=(r.data->'usage'->>'input_tokens')::numeric; o=(r.data->'usage'->>'output_tokens')::numeric;
 amount=(d.data->>'reserved_cost_usd')::numeric;
 IF i<0 OR o<0 OR i<>trunc(i) OR o<>trunc(o)
 OR i>(d.data->>'reserved_input_tokens')::numeric OR o>(d.data->>'reserved_output_tokens')::numeric
 OR amount IS DISTINCT FROM ((d.data->>'reserved_input_tokens')::numeric*2.5+(d.data->>'reserved_output_tokens')::numeric*10)/1000000
 THEN RAISE EXCEPTION 'invalid_usage_or_reservation'; END IF;
 used=(i*2.5+o*10)/1000000; -- no cached discount; reasoning included in output
 IF used IS NULL OR amount IS NULL OR used>amount THEN RAISE EXCEPTION 'invalid_usage_bound'; END IF;
 SELECT * INTO old FROM test_budget_correction.releases WHERE dispatch_id=d_id;
 IF FOUND THEN
  IF (old.result_id,old.dispatch_hash,old.result_hash,old.authority_sha256)
    IS DISTINCT FROM (r_id,d_hash,r_hash,auth_hash) THEN RAISE EXCEPTION 'replay_mismatch'; END IF;
  RETURN old.released_usd;
 END IF;
 INSERT INTO test_budget_correction.releases(dispatch_id,result_id,response_id,grant_id,dispatch_hash,result_hash,
  reserved_usd,retained_usage_upper_usd,released_usd,authority_sha256)
 VALUES(d_id,r_id,r.data->>'response_id',g.id,d_hash,r_hash,amount,used,amount-used,auth_hash);
 RETURN amount-used;
END $$;

CREATE OR REPLACE FUNCTION test_budget_correction.issue_exact(
 cert_id text, target_db text, target_hash text, amount numeric)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE old test_budget_correction.certificates; released numeric; allocated numeric;
BEGIN
 IF current_database()<>'workagent_test_47b87fe3b82e' OR (SELECT oid FROM pg_database WHERE datname=current_database())<>7704275
 THEN RAISE EXCEPTION 'canonical_issuer_required'; END IF;
 IF current_user <> pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='test_budget_correction'))
 THEN RAISE EXCEPTION 'owner_only'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'read_committed_required'; END IF;
 PERFORM pg_advisory_xact_lock(721004120);
 SELECT * INTO old FROM test_budget_correction.certificates WHERE id=cert_id;
 IF FOUND THEN
  IF (old.target_database,old.target_binding_sha256,old.amount_usd) IS DISTINCT FROM (target_db,target_hash,amount)
  THEN RAISE EXCEPTION 'certificate_replay_mismatch'; END IF;
  RETURN;
 END IF;
 IF target_db !~ '^workagent_test_[a-z0-9_]+$' OR target_db=current_database()
 OR amount IS NULL OR amount<=0 OR amount='NaN'::numeric OR amount='Infinity'::numeric
 THEN RAISE EXCEPTION 'invalid_fixed_target'; END IF;
 SELECT coalesce(sum(released_usd),0) INTO released FROM test_budget_correction.releases;
 SELECT coalesce(sum(amount_usd),0) INTO allocated FROM test_budget_correction.certificates;
 IF 99.605960-released+allocated+amount>100 THEN RAISE EXCEPTION 'cumulative_100_exceeded'; END IF;
 INSERT INTO test_budget_correction.certificates(id,target_database,target_binding_sha256,amount_usd)
 VALUES(cert_id,target_db,target_hash,amount);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA test_budget_correction FROM PUBLIC;
