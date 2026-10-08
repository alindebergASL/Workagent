-- Trusted operator carry-forward, not imported provider events or billing receipts.
-- Originals stay in their source DB; the operator must freeze/lock that binding.
CREATE TABLE responses_budget_carry (
 project_id text NOT NULL CHECK (length(project_id) BETWEEN 1 AND 200),
 transport_mode text NOT NULL CHECK (transport_mode IN ('official_api','synthetic')),
 source_database text NOT NULL CHECK (length(source_database) BETWEEN 1 AND 200),
 source_grant_id text NOT NULL CHECK (length(source_grant_id) BETWEEN 1 AND 200),
 source_manifest_sha256 text NOT NULL CHECK (source_manifest_sha256 ~ '^[0-9a-f]{64}$'),
 reserved_cost_usd numeric NOT NULL CHECK (reserved_cost_usd > 0 AND reserved_cost_usd <= 20 AND scale(reserved_cost_usd)<=6),
 created_at timestamptz NOT NULL DEFAULT now(),
 -- A changed database, mode, digest or amount cannot re-import/reset a source grant.
 PRIMARY KEY (source_grant_id)
);
REVOKE ALL ON responses_budget_carry FROM PUBLIC;
-- Existing restricted runtimes need read-only accounting after an additive upgrade.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='responses_events'
   AND privilege_type='INSERT' AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP
   EXECUTE format('GRANT SELECT ON responses_budget_carry TO %I',r.grantee);
 END LOOP;
END $$;
CREATE TRIGGER immutable_responses_budget_carry BEFORE UPDATE OR DELETE ON responses_budget_carry
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_responses_budget_carry_truncate BEFORE TRUNCATE ON responses_budget_carry
 FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION guard_budget_carry_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='responses_budget_carry'::regclass))
 THEN RAISE EXCEPTION 'operator carry import required'; END IF;
 IF current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'shared budget authority requires read committed isolation'; END IF;
 PERFORM pg_advisory_xact_lock(721004120);
 IF NEW.source_database=current_database()
 THEN RAISE EXCEPTION 'carry must originate in a different database'; END IF;
 IF EXISTS (SELECT 1 FROM provider_grants WHERE id=NEW.source_grant_id)
 THEN RAISE EXCEPTION 'source grant already installed locally'; END IF;
 IF EXISTS (SELECT 1 FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
    JOIN provider_grants g ON g.id=s.grant_id
    WHERE g.data->'responses'->>'project_id'=NEW.project_id
      AND g.data->'responses'->>'transport_mode'=NEW.transport_mode
      AND e.kind IN ('count_send','dispatch','read','cancel'))
 THEN RAISE EXCEPTION 'carry import required before local provider I/O'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER guard_budget_carry_import BEFORE INSERT ON responses_budget_carry
 FOR EACH ROW EXECUTE FUNCTION guard_budget_carry_import();

CREATE FUNCTION guard_carried_grant_install() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'shared budget authority requires read committed isolation'; END IF;
 PERFORM pg_advisory_xact_lock(721004120);
 IF EXISTS (SELECT 1 FROM responses_budget_carry WHERE source_grant_id=NEW.id)
 THEN RAISE EXCEPTION 'source grant already carried'; END IF;
 RETURN NEW;
END;
$$;
-- Run after existing grant authority checks, which may lock the workspace first.
CREATE TRIGGER z_guard_carried_grant_install BEFORE INSERT ON provider_grants
 FOR EACH ROW EXECUTE FUNCTION guard_carried_grant_install();

CREATE FUNCTION responses_carried_cost(gid text) RETURNS numeric LANGUAGE sql STABLE AS $$
 SELECT coalesce(sum(c.reserved_cost_usd),0) FROM responses_budget_carry c
 JOIN provider_grants g ON g.id=gid
 WHERE c.project_id=g.data->'responses'->>'project_id'
   AND c.transport_mode=g.data->'responses'->>'transport_mode'
$$;

CREATE FUNCTION guard_carried_budget_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid text; local_cost numeric;
BEGIN
 IF NEW.kind NOT IN ('count_send','dispatch','read','cancel') THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'shared budget authority requires read committed isolation'; END IF;
 -- Existing guards take workspace locks first. Serialize imports and every send,
 -- including a count before the first dispatch. READ COMMITTED refreshes after wait.
 PERFORM pg_advisory_xact_lock(721004120);
 IF NEW.kind='dispatch' THEN
   SELECT grant_id INTO gid FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
   SELECT coalesce(sum((e.data->>'reserved_cost_usd')::numeric),0) INTO local_cost
     FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
     WHERE s.grant_id IN (SELECT responses_budget_grants(gid)) AND e.kind='dispatch';
   IF local_cost+responses_carried_cost(gid)+0.131920>20.00
   THEN RAISE EXCEPTION 'shared cumulative project budget exhausted'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER z_guard_carried_budget_event BEFORE INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION guard_carried_budget_event();
