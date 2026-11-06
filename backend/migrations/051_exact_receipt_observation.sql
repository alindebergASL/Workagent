-- Explicit operator-installed observation authority. Never execution authority.
CREATE TABLE exact_receipt_observers (
 id text PRIMARY KEY,
 attempt_id text NOT NULL,
 phase text NOT NULL,
 workspace_id text NOT NULL,
 principal_id text NOT NULL,
 access_generation bigint NOT NULL,
 response_id text NOT NULL,
 request_sha256 text NOT NULL,
 route_binding jsonb NOT NULL,
 observer_sha256 text NOT NULL,
 expires_at timestamptz NOT NULL,
 read_limit integer NOT NULL CHECK(read_limit BETWEEN 1 AND 10),
 active boolean NOT NULL DEFAULT true,
 FOREIGN KEY(attempt_id,phase) REFERENCES responses_steps(attempt_id,phase)
);
REVOKE ALL ON exact_receipt_observers FROM PUBLIC;
-- Runtime roles may read this table, never mint, renew or mutate authority.
CREATE FUNCTION guard_exact_receipt_observer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class
     WHERE oid='exact_receipt_observers'::regclass)
 THEN RAISE EXCEPTION 'observer installation requires database owner'; END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND
    (NOT OLD.active OR NEW.active OR (to_jsonb(NEW)-'active')<>(to_jsonb(OLD)-'active')))
 THEN RAISE EXCEPTION 'immutable observer; only revocation allowed'; END IF;
 IF TG_OP='INSERT' AND (NOT NEW.active OR NEW.expires_at<=clock_timestamp()
    OR NEW.expires_at>clock_timestamp()+interval '30 minutes')
 THEN RAISE EXCEPTION 'finite observer window required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_exact_receipt_observer BEFORE INSERT OR UPDATE OR DELETE ON exact_receipt_observers
 FOR EACH ROW EXECUTE FUNCTION guard_exact_receipt_observer();

CREATE FUNCTION exact_receipt_observation_permits(oid text, aid text, ph text) RETURNS boolean
LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS (
 SELECT 1 FROM exact_receipt_observers o
 JOIN responses_steps s ON s.attempt_id=o.attempt_id AND s.phase=o.phase
 JOIN provider_attempts a ON a.id=s.attempt_id AND a.grant_id=s.grant_id
 JOIN provider_grants g ON g.id=a.grant_id
 JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
 JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id
 JOIN workspaces w ON w.id=r.workspace_id
 JOIN memberships m ON m.workspace_id=w.id AND m.principal_id=o.principal_id
 JOIN conversations cv ON cv.workspace_id=w.id AND cv.id=r.conversation_id
 JOIN responses_events e ON e.attempt_id=s.attempt_id AND e.phase=s.phase AND e.kind='identity'
 WHERE o.id=oid AND o.attempt_id=aid AND o.phase=ph AND o.active AND clock_timestamp()<o.expires_at
 AND o.workspace_id=w.id AND o.principal_id=r.data->>'principal_id'
 AND m.active AND m.role IN ('owner','editor') AND cv.data->>'owner_id'=o.principal_id
 AND cv.data->>'state'='open' AND cv.data->'selected_source_refs'='[]'::jsonb
 AND o.access_generation=w.access_generation AND r.data->>'access_generation'=w.access_generation::text
 AND NOT g.active AND g.workspace_id=w.id AND g.principal_id=o.principal_id
 AND g.data->>'profile'='general-responses-v1' AND r.data->>'profile'='general-responses-v1'
 AND rc.data->>'grant_id'=g.id AND rc.data->'responses'=g.data->'responses'
 AND o.route_binding=jsonb_build_object('transport_mode',g.data->'responses'->>'transport_mode',
       'project_id',g.data->'responses'->>'project_id','secret_reference',g.data->'responses'->>'secret_reference')
 AND o.request_sha256=s.request_sha256 AND e.data->>'request_sha256'=s.request_sha256
 AND e.data->'metadata'=s.metadata AND e.data->>'response_id'=o.response_id
 AND e.data->'provenance'->>'mode'=o.route_binding->>'transport_mode'
 AND (o.route_binding->>'transport_mode'='synthetic' OR e.data->'provenance'->>'origin'='https://api.openai.com')
 AND NOT EXISTS (SELECT 1 FROM responses_events x WHERE x.attempt_id=aid AND x.phase=ph AND x.kind='tool_result')
 )
$$;

-- Preserve all original shared counters, cost guards and execution fences.
DO $$
DECLARE d text; old text; replacement text;
BEGIN
 d=pg_get_functiondef('guard_responses_event()'::regprocedure);
 old='   IF NOT EXISTS (SELECT 1 FROM provider_grants g WHERE id=gid AND active AND';
 replacement='   IF NOT (NEW.kind=''read'' AND NEW.data ? ''receipt_observer'' AND exact_receipt_observation_permits(NEW.data->>''receipt_observer'',NEW.attempt_id,NEW.phase)) AND NOT EXISTS (SELECT 1 FROM provider_grants g WHERE id=gid AND active AND';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'observer grant guard predecessor drift'; END IF;
 d=replace(d,old,replacement);
 old=' IF NEW.data ? ''cancelled_observation'' THEN';
 replacement=$new$ IF NEW.data ? 'receipt_observer' THEN
   IF NEW.kind<>'read' OR NEW.data<>jsonb_build_object('receipt_observer',NEW.data->>'receipt_observer')
      OR NOT exact_receipt_observation_permits(NEW.data->>'receipt_observer',NEW.attempt_id,NEW.phase)
      OR EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result')
      OR (SELECT count(*) FROM responses_events WHERE kind='read' AND data->>'receipt_observer'=NEW.data->>'receipt_observer')
          >=(SELECT read_limit FROM exact_receipt_observers WHERE id=NEW.data->>'receipt_observer')
   THEN RAISE EXCEPTION 'exact receipt observation authority required'; END IF;
 ELSIF NEW.data ? 'cancelled_observation' THEN$new$;
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'observer execution guard predecessor drift'; END IF;
 EXECUTE replace(d,old,replacement);
 d=pg_get_functiondef('guard_responsibility_phase()'::regprocedure);
 old='   IF NEW.data ? ''cancelled_observation'' THEN';
 replacement=$new$   IF NEW.data ? 'receipt_observer' THEN
     IF NEW.kind<>'read' OR NEW.data<>jsonb_build_object('receipt_observer',NEW.data->>'receipt_observer')
        OR NOT exact_receipt_observation_permits(NEW.data->>'receipt_observer',NEW.attempt_id,NEW.phase)
     THEN RAISE EXCEPTION 'exact receipt observation authority required'; END IF;
     RETURN NEW;
   END IF;
   IF NEW.data ? 'cancelled_observation' THEN$new$;
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'observer responsibility guard predecessor drift'; END IF;
 EXECUTE replace(d,old,replacement);
END $$;
