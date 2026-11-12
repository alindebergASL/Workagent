-- Parent-only installation in a NEW dedicated target. Never install in alpha.
-- Deliberately not IF NOT EXISTS: a pre-existing schema requires investigation.
BEGIN;
CREATE SCHEMA workspace_accounting;
REVOKE ALL ON SCHEMA workspace_accounting FROM PUBLIC;
CREATE TABLE workspace_accounting.binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  document text NOT NULL,
  binding_sha256 text NOT NULL UNIQUE,
  policy_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE workspace_accounting.funding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  certificate jsonb NOT NULL,
  amount_usd numeric NOT NULL CHECK (amount_usd > 0 AND amount_usd <= 275),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE workspace_accounting.reservation (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  request jsonb NOT NULL,
  bound_usd numeric NOT NULL CHECK (bound_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(session_id, request_id), UNIQUE(session_id, request_hash)
);
CREATE TABLE workspace_accounting.dispatch (
  reservation_id text PRIMARY KEY REFERENCES workspace_accounting.reservation,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE workspace_accounting.receipt (
  reservation_id text NOT NULL REFERENCES workspace_accounting.reservation,
  outcome text NOT NULL CHECK (outcome IN ('received','unknown','not_dispatched','reconciled')),
  evidence jsonb NOT NULL,
  monetary_state text NOT NULL,
  reported_cost_usd numeric,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(reservation_id, outcome)
);
-- One irreversible finalization per request. It changes local liability only;
-- the certificate remains fully encumbered at the central issuer.
CREATE TABLE workspace_accounting.settlement (
  reservation_id text PRIMARY KEY REFERENCES workspace_accounting.reservation,
  receipt_outcome text NOT NULL,
  cost_usd numeric NOT NULL CHECK (cost_usd >= 0),
  reason text NOT NULL CHECK (reason IN ('provider_reported','not_dispatched')),
  response_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (reservation_id,receipt_outcome) REFERENCES workspace_accounting.receipt(reservation_id,outcome)
);
CREATE FUNCTION workspace_accounting.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'financial_records_are_append_only'; END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON workspace_accounting.binding
FOR EACH STATEMENT EXECUTE FUNCTION workspace_accounting.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON workspace_accounting.funding
FOR EACH STATEMENT EXECUTE FUNCTION workspace_accounting.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON workspace_accounting.reservation
FOR EACH STATEMENT EXECUTE FUNCTION workspace_accounting.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON workspace_accounting.dispatch
FOR EACH STATEMENT EXECUTE FUNCTION workspace_accounting.immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON workspace_accounting.receipt
FOR EACH STATEMENT EXECUTE FUNCTION workspace_accounting.immutable();

CREATE TRIGGER immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON workspace_accounting.settlement
FOR EACH STATEMENT EXECUTE FUNCTION workspace_accounting.immutable();

-- Bound to database name, OID AND cluster ID; copied/restored targets fail closed.
-- Owner must have permission to read pg_control_system(); runtime need not.
CREATE FUNCTION workspace_accounting.checked_binding() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b jsonb;
BEGIN
  SELECT document::jsonb INTO b FROM workspace_accounting.binding WHERE singleton;
  IF b IS NULL THEN RAISE EXCEPTION 'accounting_not_initialized'; END IF;
  IF b->>'target_database' <> current_database()
     OR b->>'database_oid' <> (SELECT oid::text FROM pg_database WHERE datname=current_database())
     OR b->>'system_identifier' <> (SELECT system_identifier::text FROM pg_control_system())
  THEN RAISE EXCEPTION 'target_identity_conflict'; END IF;
  RETURN b;
END $$;
CREATE FUNCTION workspace_accounting.initialize(document_text text, policy_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b jsonb := document_text::jsonb; h text;
BEGIN
  IF b->'policy' IS DISTINCT FROM policy_text::jsonb OR length(b->>'nonce') < 32
     OR b->>'target_database' IS DISTINCT FROM current_database()
     OR b->>'database_oid' IS DISTINCT FROM (SELECT oid::text FROM pg_database WHERE datname=current_database())
     OR b->>'system_identifier' IS DISTINCT FROM (SELECT system_identifier::text FROM pg_control_system())
     OR current_database() = 'workagent_test_47b87fe3b82e'
  THEN RAISE EXCEPTION 'invalid_target_binding'; END IF;
  h := encode(sha256(convert_to(document_text,'UTF8')),'hex');
  INSERT INTO workspace_accounting.binding(document,binding_sha256,policy_sha256)
  VALUES(document_text,h,encode(sha256(convert_to(policy_text,'UTF8')),'hex'));
  RETURN jsonb_build_object('target_database',current_database(),'binding_sha256',h);
END $$;
CREATE FUNCTION workspace_accounting.import_certificate(c jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b jsonb; old jsonb; h text; amount numeric;
BEGIN
  SELECT document::jsonb,binding_sha256 INTO b,h FROM workspace_accounting.binding WHERE singleton FOR UPDATE;
  PERFORM workspace_accounting.checked_binding();
  IF c->>'issuer_database' IS DISTINCT FROM 'workagent_test_47b87fe3b82e'
     OR c->>'issuer_schema' IS DISTINCT FROM 'test_budget_correction'
     OR c->>'target_database' IS DISTINCT FROM current_database()
     OR c->>'target_binding_sha256' IS DISTINCT FROM h
     OR coalesce(length(c->>'id'),0) NOT BETWEEN 1 AND 200
     OR (SELECT count(*) FROM jsonb_object_keys(c)) <> 6
  THEN RAISE EXCEPTION 'certificate_identity_conflict'; END IF;
  amount := (c->>'amount_usd')::numeric;
  IF amount IS NULL OR amount::text IN ('NaN','Infinity','-Infinity') OR amount<=0 OR amount>275 OR round(amount,6)<>amount
  THEN RAISE EXCEPTION 'invalid_certificate_amount'; END IF;
  SELECT certificate INTO old FROM workspace_accounting.funding WHERE singleton;
  IF old IS NOT NULL THEN
    IF old IS DISTINCT FROM c THEN RAISE EXCEPTION 'certificate_replay_conflict'; END IF;
    RETURN jsonb_build_object('imported',true,'duplicate',true);
  END IF;
  INSERT INTO workspace_accounting.funding(certificate,amount_usd) VALUES(c,amount);
  RETURN jsonb_build_object('imported',true,'duplicate',false);
END $$;
CREATE FUNCTION workspace_accounting.liability() RETURNS numeric
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce(sum(greatest(coalesce(s.cost_usd,r.bound_usd),coalesce(
    (SELECT max(x.reported_cost_usd) FROM workspace_accounting.receipt x WHERE x.reservation_id=r.id),0))),0)
  FROM workspace_accounting.reservation r LEFT JOIN workspace_accounting.settlement s ON s.reservation_id=r.id
$$;
CREATE FUNCTION workspace_accounting.frozen() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM workspace_accounting.receipt x WHERE
    x.monetary_state IN ('overrun','cost_conflict','unsupported_billing') OR
    (x.monetary_state='missing_or_invalid' AND NOT EXISTS
      (SELECT 1 FROM workspace_accounting.settlement s WHERE s.reservation_id=x.reservation_id)))
$$;
CREATE FUNCTION workspace_accounting.retained_result(rid text, duplicate boolean) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('retained',true,'duplicate',duplicate,
    'settled',s.reservation_id IS NOT NULL,'settledCostUsd',s.cost_usd::text,
    'monetaryState',coalesce((SELECT monetary_state FROM workspace_accounting.receipt x
      WHERE x.reservation_id=r.id AND monetary_state IN ('overrun','cost_conflict','unsupported_billing')
      ORDER BY created_at DESC LIMIT 1),s.reason,(SELECT monetary_state FROM workspace_accounting.receipt x
      WHERE x.reservation_id=r.id ORDER BY created_at DESC LIMIT 1)),
    'liabilityUsd',greatest(coalesce(s.cost_usd,r.bound_usd),coalesce(
      (SELECT max(reported_cost_usd) FROM workspace_accounting.receipt WHERE reservation_id=r.id),0))::text,
    'frozen',workspace_accounting.frozen(),'verifiedInvoiceUsd',NULL)
  FROM workspace_accounting.reservation r LEFT JOIN workspace_accounting.settlement s ON s.reservation_id=r.id
  WHERE r.id=rid
$$;
CREATE FUNCTION workspace_accounting.policy() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b jsonb;
BEGIN
  b := workspace_accounting.checked_binding();
  RETURN jsonb_build_object('policy',b->'policy','policyHash',
    (SELECT policy_sha256 FROM workspace_accounting.binding),'bindingHash',
    (SELECT binding_sha256 FROM workspace_accounting.binding));
END $$;
CREATE FUNCTION workspace_accounting.status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b jsonb; funded numeric; held numeric;
BEGIN
  b := workspace_accounting.checked_binding();
  -- Same lock as all financial writers gives a coherent snapshot.
  PERFORM 1 FROM workspace_accounting.binding WHERE singleton FOR UPDATE;
  SELECT amount_usd INTO funded FROM workspace_accounting.funding;
  held := workspace_accounting.liability();
  RETURN jsonb_build_object('targetDatabase',current_database(),'bindingHash',
    (SELECT binding_sha256 FROM workspace_accounting.binding),
    'fundedUsd',coalesce(funded,0)::text,'liabilityUsd',held::text,
    'availableUsd',greatest(coalesce(funded,0)-held,0)::text,
    'providerReportedUsd',(SELECT coalesce(sum(x.cost),0)::text FROM
      (SELECT max(reported_cost_usd) cost FROM workspace_accounting.receipt GROUP BY reservation_id) x),
    'settledUsd',(SELECT coalesce(sum(cost_usd),0)::text FROM workspace_accounting.settlement),
    'heldLiabilityUsd',(held-(SELECT coalesce(sum(cost_usd),0) FROM workspace_accounting.settlement))::text,
    'frozen',workspace_accounting.frozen(),
    'verifiedInvoiceUsd',NULL,'reservations',(SELECT count(*) FROM workspace_accounting.reservation),
    'dispatches',(SELECT count(*) FROM workspace_accounting.dispatch),
    'unknownDispatches',(SELECT count(*) FROM workspace_accounting.dispatch d WHERE NOT EXISTS
       (SELECT 1 FROM workspace_accounting.receipt x WHERE x.reservation_id=d.reservation_id AND x.outcome IN ('received','reconciled'))),
    'overruns',(SELECT count(*) FROM workspace_accounting.receipt WHERE monetary_state='overrun'),
    'unverifiedReceipts',(SELECT count(*) FROM workspace_accounting.receipt WHERE monetary_state IN ('missing_or_invalid','unknown')));
END $$;
CREATE FUNCTION workspace_accounting.reserve(q jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE b jsonb; p jsonb; body jsonb; raw text; h text; amount numeric; funded numeric;
        old workspace_accounting.reservation%ROWTYPE; rid text; logical_id text;
BEGIN
  PERFORM 1 FROM workspace_accounting.binding WHERE singleton FOR UPDATE;
  b := workspace_accounting.checked_binding(); p := b->'policy';
  IF p->>'version' IS DISTINCT FROM '2' OR p->>'pricingBasis' IS DISTINCT FROM 'openrouter-text-context-v1'
     OR (p->>'route'='typesafe/jev-router' AND least((p->>'inputTokenCeiling')::int,
         (p->>'completionTokenCeiling')::int)<1000000)
  THEN RAISE EXCEPTION 'invalid_context_envelope'; END IF;
  IF q->>'policyHash' IS DISTINCT FROM (SELECT policy_sha256 FROM workspace_accounting.binding)
     OR q->>'purpose' IS DISTINCT FROM 'conversation' THEN RAISE EXCEPTION 'policy_binding_conflict'; END IF;
  raw := q->>'requestBody'; body := raw::jsonb; h := encode(sha256(convert_to(raw,'UTF8')),'hex');
  IF raw IS NULL OR octet_length(raw)>least((p->>'maxRequestBytes')::int,1000000)
     OR q->>'requestHash' IS DISTINCT FROM h
     OR (q->>'requestBytes')::int IS DISTINCT FROM octet_length(raw)
     OR body->>'model' IS DISTINCT FROM p->>'route' OR q->>'route' IS DISTINCT FROM p->>'route'
     OR body->>'session_id' IS DISTINCT FROM q->>'sessionId'
     OR coalesce(length(q->>'sessionId'),0) NOT BETWEEN 1 AND 200
     OR body->'provider' IS DISTINCT FROM p->'provider'
     OR body->'prompt_cache_options' IS DISTINCT FROM '{"mode":"explicit"}'::jsonb
     OR body->'stream' IS DISTINCT FROM 'true'::jsonb
     OR body->'stream_options' IS DISTINCT FROM '{"include_usage":true}'::jsonb
     OR (body->>'max_tokens')::int IS DISTINCT FROM (q->>'maxOutputTokens')::int
     OR coalesce((body->>'max_tokens')::int,0) NOT BETWEEN 1 AND least((p->>'maxOutputTokens')::int,4096)
     OR body - ARRAY['model','messages','stream','stream_options','session_id','max_tokens','provider','prompt_cache_options','tools','reasoning'] <> '{}'::jsonb
     OR jsonb_typeof(body->'messages') IS DISTINCT FROM 'array'
     OR jsonb_array_length(body->'messages')=0
  THEN RAISE EXCEPTION 'request_identity_conflict'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(body->'messages') m
    WHERE jsonb_typeof(m->'content') IS DISTINCT FROM 'string'
      OR coalesce(m->>'role','') NOT IN ('system','user','assistant','tool')
      OR m - ARRAY['role','content','tool_call_id','tool_calls','reasoning_details'] <> '{}'::jsonb)
  THEN RAISE EXCEPTION 'unsupported_modality'; END IF;
  IF body ? 'tools' AND EXISTS (SELECT 1 FROM jsonb_array_elements(body->'tools') t
      WHERE t->>'type' IS DISTINCT FROM 'function' OR t - ARRAY['type','function'] <> '{}'::jsonb
      OR (t->'function') - ARRAY['name','description','parameters'] <> '{}'::jsonb)
  THEN RAISE EXCEPTION 'unsupported_tool'; END IF;
  IF body ? 'reasoning' AND (jsonb_typeof(body->'reasoning') IS DISTINCT FROM 'object'
      OR (body->'reasoning') - ARRAY['effort'] <> '{}'::jsonb
      OR coalesce(body#>>'{reasoning,effort}','') NOT IN ('none','minimal','low','medium','high','xhigh','max'))
  THEN RAISE EXCEPTION 'unsupported_reasoning'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(body->'messages') m,
      LATERAL jsonb_array_elements(coalesce(m->'tool_calls','[]'::jsonb)) t
      WHERE t->>'type' IS DISTINCT FROM 'function' OR t - ARRAY['id','type','function'] <> '{}'::jsonb
      OR jsonb_typeof(t#>'{function,arguments}') IS DISTINCT FROM 'string'
      OR (t->'function') - ARRAY['name','arguments'] <> '{}'::jsonb)
  THEN RAISE EXCEPTION 'invalid_tool_call'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(body->'messages') m,
      LATERAL jsonb_array_elements(coalesce(m->'reasoning_details','[]'::jsonb)) d
      WHERE coalesce(d->>'type','') NOT IN ('reasoning.text','reasoning.summary','reasoning.encrypted')
         OR d - ARRAY['type','text','summary','data','signature','id','format','index'] <> '{}'::jsonb)
  THEN RAISE EXCEPTION 'unsupported_replay'; END IF;
  logical_id := coalesce(q->>'requestId',h);
  IF length(logical_id) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_request_id'; END IF;
  SELECT * INTO old FROM workspace_accounting.reservation WHERE session_id=q->>'sessionId'
    AND (request_id=logical_id OR request_hash=h);
  IF FOUND THEN
    IF old.request IS DISTINCT FROM q THEN RAISE EXCEPTION 'request_identity_conflict'; END IF;
    rid := old.id; amount := old.bound_usd;
  ELSE
    amount := ceil((((p->>'inputTokenCeiling')::numeric*(p#>>'{provider,max_price,prompt}')::numeric
      +(p->>'completionTokenCeiling')::numeric*(p#>>'{provider,max_price,completion}')::numeric)/1000000
      +(p#>>'{provider,max_price,request}')::numeric+(p->>'extraChargeUsd')::numeric)*1000000)/1000000;
    SELECT amount_usd INTO funded FROM workspace_accounting.funding WHERE singleton;
    IF funded IS NULL THEN RAISE EXCEPTION 'certificate_required'; END IF;
    IF workspace_accounting.liability()+amount > funded OR workspace_accounting.frozen()
    THEN RAISE EXCEPTION 'budget_exhausted'; END IF;
    rid := gen_random_uuid()::text;
    INSERT INTO workspace_accounting.reservation(id,session_id,request_id,request_hash,request,bound_usd)
      VALUES(rid,q->>'sessionId',logical_id,h,q,amount);
  END IF;
  RETURN jsonb_build_object('durable',true,'reservationId',rid,'requestHash',h,'route',p->>'route',
    'boundUsd',amount::text,'policyHash',q->>'policyHash');
END $$;
CREATE FUNCTION workspace_accounting.dispatch(q jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r workspace_accounting.reservation%ROWTYPE;
BEGIN
  PERFORM 1 FROM workspace_accounting.binding WHERE singleton FOR UPDATE;
  PERFORM workspace_accounting.checked_binding();
  SELECT * INTO r FROM workspace_accounting.reservation WHERE id=q->>'reservationId' FOR UPDATE;
  IF NOT FOUND OR r.request_hash IS DISTINCT FROM q->>'requestHash' THEN RAISE EXCEPTION 'reservation_identity_conflict'; END IF;
  IF EXISTS(SELECT 1 FROM workspace_accounting.dispatch WHERE reservation_id=r.id)
     OR EXISTS(SELECT 1 FROM workspace_accounting.receipt WHERE reservation_id=r.id)
  THEN RAISE EXCEPTION 'uncertain_or_already_dispatched'; END IF;
  IF workspace_accounting.liability() > (SELECT amount_usd FROM workspace_accounting.funding)
     OR workspace_accounting.frozen()
  THEN RAISE EXCEPTION 'budget_exhausted'; END IF;
  INSERT INTO workspace_accounting.dispatch(reservation_id) VALUES(r.id);
  RETURN jsonb_build_object('dispatched',true,'reservationId',r.id,'requestHash',r.request_hash);
END $$;
CREATE FUNCTION workspace_accounting.retain(q jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE r workspace_accounting.reservation%ROWTYPE; old jsonb; cost numeric; charged numeric;
        state text; kind text:=q->>'outcome'; response_id text:=q->>'responseId'; known_id text;
        final workspace_accounting.settlement%ROWTYPE; terminal boolean; byok boolean;
BEGIN
  PERFORM 1 FROM workspace_accounting.binding WHERE singleton FOR UPDATE;
  PERFORM workspace_accounting.checked_binding();
  SELECT * INTO r FROM workspace_accounting.reservation WHERE id=q->>'reservationId' FOR UPDATE;
  IF NOT FOUND OR r.request_hash IS DISTINCT FROM q->>'requestHash' THEN RAISE EXCEPTION 'reservation_identity_conflict'; END IF;
  IF kind IS NULL OR kind NOT IN ('received','unknown','not_dispatched','reconciled') THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
  SELECT evidence INTO old FROM workspace_accounting.receipt WHERE reservation_id=r.id AND outcome=kind;
  IF old IS NOT NULL THEN
    IF old IS DISTINCT FROM q THEN RAISE EXCEPTION 'receipt_identity_conflict'; END IF;
    RETURN workspace_accounting.retained_result(r.id,true);
  END IF;
  SELECT * INTO final FROM workspace_accounting.settlement WHERE reservation_id=r.id;
  SELECT evidence->>'responseId' INTO known_id FROM workspace_accounting.receipt
    WHERE reservation_id=r.id AND evidence->>'responseId' IS NOT NULL LIMIT 1;
  IF (known_id IS NOT NULL AND response_id IS NOT NULL AND known_id<>response_id)
      OR (response_id IS NOT NULL AND EXISTS(SELECT 1 FROM workspace_accounting.receipt
          WHERE reservation_id<>r.id AND evidence->>'responseId'=response_id))
  THEN RAISE EXCEPTION 'response_identity_conflict'; END IF;
  IF kind IN ('received','reconciled') AND (NOT EXISTS(SELECT 1 FROM workspace_accounting.dispatch WHERE reservation_id=r.id)
      OR coalesce(length(response_id),0)=0 OR coalesce(length(q->>'resolvedModel'),0)=0)
  THEN RAISE EXCEPTION 'receipt_without_dispatch'; END IF;
  IF kind='not_dispatched' THEN
    -- Same lock as dispatch. No dispatcher can sneak in after this check:
    -- the receipt/finalization permanently prevent subsequent dispatch.
    IF EXISTS(SELECT 1 FROM workspace_accounting.dispatch WHERE reservation_id=r.id)
       OR EXISTS(SELECT 1 FROM workspace_accounting.receipt WHERE reservation_id=r.id)
    THEN RAISE EXCEPTION 'dispatch_may_have_happened'; END IF;
    INSERT INTO workspace_accounting.receipt(reservation_id,outcome,evidence,monetary_state)
      VALUES(r.id,kind,q,'not_dispatched');
    INSERT INTO workspace_accounting.settlement(reservation_id,receipt_outcome,cost_usd,reason)
      VALUES(r.id,kind,0,'not_dispatched');
    RETURN workspace_accounting.retained_result(r.id,false);
  END IF;
  IF final.reason='not_dispatched' THEN RAISE EXCEPTION 'request_already_finalized'; END IF;
  terminal := q->'terminal'='true'::jsonb;
  byok := coalesce(q#>'{usage,is_byok}'='true'::jsonb,false);
  IF kind='reconciled' THEN
    -- Only a lookup of an ALREADY retained generation ID may resolve uncertainty.
    -- It can never attach a cheap, unrelated generation to this reservation.
    IF known_id IS NULL OR response_id IS DISTINCT FROM known_id
       OR q#>>'{generation,id}' IS DISTINCT FROM known_id
       OR q#>>'{generation,model}' IS DISTINCT FROM q->>'resolvedModel'
       OR coalesce(length(q#>>'{generation,finish_reason}'),0)=0
       OR jsonb_typeof(q#>'{generation,total_cost}') IS DISTINCT FROM 'number'
    THEN RAISE EXCEPTION 'reconciliation_identity_conflict'; END IF;
    terminal := true;
    byok := coalesce(q#>'{generation,is_byok}'='true'::jsonb,false);
    cost:=(q#>>'{generation,total_cost}')::numeric;
    IF cost<0 THEN RAISE EXCEPTION 'invalid_generation_cost'; END IF;
  ELSE
    IF jsonb_typeof(q#>'{usage,cost}')='number' THEN cost:=(q#>>'{usage,cost}')::numeric; END IF;
  END IF;
  IF cost<0 OR cost::text IN ('NaN','Infinity','-Infinity') THEN cost:=NULL; END IF;
  state := CASE WHEN kind IN ('received','reconciled') OR terminal THEN 'missing_or_invalid' ELSE 'unknown' END;
  IF cost IS NOT NULL THEN
    charged := ceil(cost*1000000)/1000000;
    IF cost>r.bound_usd THEN state:='overrun';
    ELSIF kind IN ('received','reconciled') AND terminal THEN state:='provider_reported'; END IF;
  END IF;
  IF byok THEN state:='unsupported_billing'; END IF;
  IF final.reservation_id IS NOT NULL AND cost IS NOT NULL THEN
    IF cost < (SELECT reported_cost_usd FROM workspace_accounting.receipt
        WHERE reservation_id=r.id AND outcome=final.receipt_outcome)
    THEN RAISE EXCEPTION 'settled_cost_conflict'; END IF;
    IF cost > (SELECT reported_cost_usd FROM workspace_accounting.receipt
        WHERE reservation_id=r.id AND outcome=final.receipt_outcome)
    THEN state:=CASE WHEN cost>r.bound_usd THEN 'overrun' ELSE 'cost_conflict' END; END IF;
  END IF;
  IF state='provider_reported' AND EXISTS(SELECT 1 FROM workspace_accounting.receipt
      WHERE reservation_id=r.id AND reported_cost_usd>cost)
  THEN RAISE EXCEPTION 'reported_cost_conflict'; END IF;
  INSERT INTO workspace_accounting.receipt(reservation_id,outcome,evidence,monetary_state,reported_cost_usd)
    VALUES(r.id,kind,q,state,cost);
  IF state='provider_reported' AND final.reservation_id IS NULL THEN
    INSERT INTO workspace_accounting.settlement(reservation_id,receipt_outcome,cost_usd,reason,response_id)
      VALUES(r.id,kind,charged,'provider_reported',response_id);
  END IF;
  RETURN workspace_accounting.retained_result(r.id,false);
END $$;
-- No privileges, including function EXECUTE, are inherited from PUBLIC.
REVOKE ALL ON ALL TABLES IN SCHEMA workspace_accounting FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workspace_accounting FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA workspace_accounting REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
