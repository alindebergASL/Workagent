-- Product deployment configuration: only the migration identity may activate.
CREATE TABLE bundle_activations (
 id text PRIMARY KEY, previous_id text REFERENCES bundle_activations(id),
 rollback_of text REFERENCES bundle_activations(id), operator_name text NOT NULL DEFAULT current_user,
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_bundle_activation BEFORE UPDATE OR DELETE ON bundle_activations
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
INSERT INTO bundle_activations(id,data) VALUES ('approved-default-0.1.0',
 '{"version":"0.1.0","bundle_hash":"0509e977d65949c5bf7e531f43086c090671fc23f8d61c7b201603ad43d7d5e3","registry_hash":"b531fd4981d5f00922dc1fb53488fcfec98a6d669c4919c9b40736f69a64006f","skills_enabled":true}');
CREATE TABLE runtime_configuration (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), activation_id text NOT NULL REFERENCES bundle_activations(id)
);
INSERT INTO runtime_configuration(activation_id) VALUES ('approved-default-0.1.0');
-- Key-share permits a concurrent reader while serializing activation vs admission.
CREATE TABLE run_configurations (
 workspace_id text, run_id text, activation_id text NOT NULL REFERENCES bundle_activations(id),
 data jsonb NOT NULL, PRIMARY KEY(workspace_id,run_id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id)
);
CREATE TRIGGER immutable_run_configuration BEFORE UPDATE OR DELETE ON run_configurations
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TABLE run_contexts (
 workspace_id text, run_id text, data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,run_id), FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id)
);
CREATE TRIGGER immutable_run_context BEFORE UPDATE OR DELETE ON run_contexts
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
-- Each application run has one immutable admission. No queue-owned attempts/leases.
CREATE TABLE run_dispatches (
 cursor bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 workspace_id text, run_id text, outbox_id text NOT NULL REFERENCES outbox(id),
 acknowledged_at timestamptz, PRIMARY KEY(workspace_id,run_id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id)
);
CREATE INDEX dispatch_pending ON run_dispatches(cursor) WHERE acknowledged_at IS NULL;
CREATE FUNCTION protect_dispatch_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'acknowledged_at') IS DISTINCT FROM (to_jsonb(OLD)-'acknowledged_at')
 OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at)
 THEN RAISE EXCEPTION 'immutable dispatch admission'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_dispatch BEFORE UPDATE OR DELETE ON run_dispatches
 FOR EACH ROW EXECUTE FUNCTION protect_dispatch_admission();
CREATE TRIGGER protect_runtime_configuration BEFORE UPDATE OR DELETE ON runtime_configuration
 FOR EACH ROW EXECUTE FUNCTION protect_authority();
