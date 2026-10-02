-- Local durable admission is NOT provider exactly-once. No credentials or transport.
CREATE TABLE provider_grants (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id),
 principal_id text NOT NULL, active boolean NOT NULL DEFAULT true, data jsonb NOT NULL,
 FOREIGN KEY(workspace_id,principal_id) REFERENCES memberships(workspace_id,principal_id)
);
CREATE UNIQUE INDEX one_active_provider_grant ON provider_grants(workspace_id,principal_id) WHERE active;
CREATE FUNCTION protect_provider_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
 THEN RAISE EXCEPTION 'operator identity required'; END IF;
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND
   ((to_jsonb(NEW)-'active') IS DISTINCT FROM (to_jsonb(OLD)-'active') OR NOT OLD.active OR NEW.active))
 THEN RAISE EXCEPTION 'immutable grant; only revocation allowed'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER protect_provider_grants BEFORE INSERT OR UPDATE OR DELETE ON provider_grants
 FOR EACH ROW EXECUTE FUNCTION protect_provider_grant();

CREATE TABLE provider_attempts (
 workspace_id text NOT NULL, run_id text NOT NULL, id text NOT NULL UNIQUE,
 grant_id text NOT NULL REFERENCES provider_grants(id), data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,run_id), FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id),
 CHECK (data->>'state' IN ('prepared','dispatched','outcome_unknown','responded','reconciled','failed')),
 CHECK (data->>'id'=id AND data->>'run_id'=run_id AND data->>'workspace_id'=workspace_id AND data->>'grant_id'=grant_id)
);
CREATE FUNCTION protect_provider_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_state text; new_state text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable attempt admission'; END IF;
 old_state=OLD.data->>'state'; new_state=NEW.data->>'state';
 IF NEW.workspace_id<>OLD.workspace_id OR NEW.run_id<>OLD.run_id OR NEW.id<>OLD.id OR NEW.grant_id<>OLD.grant_id
 OR (NEW.data - ARRAY['state','provider_session_id','provider_turn_id','result','result_hash'])
 IS DISTINCT FROM (OLD.data - ARRAY['state','provider_session_id','provider_turn_id','result','result_hash'])
 THEN RAISE EXCEPTION 'immutable attempt binding'; END IF;
 IF NOT ((old_state='prepared' AND new_state IN ('dispatched','failed'))
 OR (old_state='dispatched' AND new_state IN ('outcome_unknown','responded','failed'))
 OR (old_state='outcome_unknown' AND new_state IN ('responded','failed'))
 OR (old_state='responded' AND new_state='reconciled'))
 AND NOT (old_state IN ('dispatched','outcome_unknown') AND new_state=old_state
          AND (NEW.data - ARRAY['provider_session_id','provider_turn_id']) = (OLD.data - ARRAY['provider_session_id','provider_turn_id'])
          AND NEW.data IS DISTINCT FROM OLD.data)
 THEN RAISE EXCEPTION 'invalid attempt transition'; END IF;
 IF (OLD.data->>'provider_session_id' IS NOT NULL AND NEW.data->>'provider_session_id' IS DISTINCT FROM OLD.data->>'provider_session_id')
 OR (OLD.data->>'provider_turn_id' IS NOT NULL AND NEW.data->>'provider_turn_id' IS DISTINCT FROM OLD.data->>'provider_turn_id')
 OR (OLD.data->>'result_hash' IS NOT NULL AND
     (NEW.data->'result' IS DISTINCT FROM OLD.data->'result' OR NEW.data->>'result_hash' IS DISTINCT FROM OLD.data->>'result_hash'))
 THEN RAISE EXCEPTION 'immutable provider receipt'; END IF;
 IF new_state IN ('responded','reconciled') AND
   (NEW.data->>'result_hash' IS NULL OR NEW.data->>'provider_session_id' IS NULL OR NEW.data->>'provider_turn_id' IS NULL OR NEW.data->>'result' IS NULL)
 THEN RAISE EXCEPTION 'provider receipt required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER protect_provider_attempts BEFORE UPDATE OR DELETE ON provider_attempts
 FOR EACH ROW EXECUTE FUNCTION protect_provider_attempt();

-- Domain commit receipt; authoritative saved/proposal records are still read back.
CREATE TABLE run_publications (
 workspace_id text NOT NULL, run_id text NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,run_id), FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id)
);
CREATE TRIGGER immutable_run_publication BEFORE UPDATE OR DELETE ON run_publications
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
