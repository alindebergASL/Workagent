CREATE TABLE workspaces (
 id text PRIMARY KEY, data jsonb NOT NULL, access_generation bigint NOT NULL DEFAULT 1 CHECK(access_generation > 0)
);
CREATE TABLE memberships (
 workspace_id text REFERENCES workspaces(id), principal_id text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','editor','viewer')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(workspace_id,principal_id)
);
CREATE TABLE sources (
 workspace_id text REFERENCES workspaces(id), id text NOT NULL, data jsonb NOT NULL,
 content jsonb NOT NULL, PRIMARY KEY(workspace_id,id)
);
CREATE TABLE source_access (
 workspace_id text, source_id text, principal_id text NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(workspace_id,source_id,principal_id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id),
 FOREIGN KEY(workspace_id,principal_id) REFERENCES memberships(workspace_id,principal_id)
);
CREATE TABLE assignments (
 workspace_id text REFERENCES workspaces(id), id text NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE assignment_sources (
 workspace_id text, assignment_id text, source_id text,
 PRIMARY KEY(workspace_id,assignment_id,source_id),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES assignments(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id)
);
CREATE TABLE artifacts (
 workspace_id text, id text NOT NULL, assignment_id text NOT NULL, current_revision_id text,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES assignments(workspace_id,id)
);
CREATE TABLE revisions (
 workspace_id text, artifact_id text, id text NOT NULL, revision_number bigint NOT NULL CHECK(revision_number > 0),
 parent_revision_id text, data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,artifact_id,id), UNIQUE(workspace_id,artifact_id,revision_number),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_id,parent_revision_id) REFERENCES revisions(workspace_id,artifact_id,id)
);
ALTER TABLE artifacts ADD CONSTRAINT current_revision_fk FOREIGN KEY(workspace_id,id,current_revision_id)
 REFERENCES revisions(workspace_id,artifact_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE proposals (
 workspace_id text, id text NOT NULL, artifact_id text NOT NULL, base_revision_id text NOT NULL,
 data jsonb NOT NULL, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_id,base_revision_id) REFERENCES revisions(workspace_id,artifact_id,id)
);
CREATE TABLE tasks (
 workspace_id text, id text NOT NULL, assignment_id text NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id), FOREIGN KEY(workspace_id,assignment_id) REFERENCES assignments(workspace_id,id)
);
CREATE TABLE task_inspections (
 id text PRIMARY KEY, workspace_id text, task_id text, principal_id text NOT NULL,
 data jsonb NOT NULL, FOREIGN KEY(workspace_id,task_id) REFERENCES tasks(workspace_id,id)
);
CREATE TABLE commands (
 principal_id text NOT NULL, workspace_id text REFERENCES workspaces(id), command_id text NOT NULL,
 payload_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(principal_id,workspace_id,command_id)
);
CREATE TABLE audit (
 id text PRIMARY KEY, workspace_id text REFERENCES workspaces(id), principal_id text NOT NULL,
 operation text NOT NULL, object_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox (
 id text PRIMARY KEY REFERENCES audit(id), workspace_id text REFERENCES workspaces(id),
 operation text NOT NULL, object_id text NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending ON outbox(created_at,id) WHERE consumed_at IS NULL;
CREATE TABLE runs (
 workspace_id text, id text NOT NULL, assignment_id text NOT NULL, data jsonb NOT NULL,
 lease_hash text, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES assignments(workspace_id,id)
);
CREATE INDEX runs_assignment ON runs(workspace_id,assignment_id);
CREATE INDEX artifacts_assignment ON artifacts(workspace_id,assignment_id);
CREATE INDEX tasks_assignment ON tasks(workspace_id,assignment_id);
CREATE INDEX proposals_artifact ON proposals(workspace_id,artifact_id,id);
CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'immutable record'; END;
$$;
CREATE TRIGGER immutable_revisions BEFORE UPDATE OR DELETE ON revisions
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_commands BEFORE UPDATE OR DELETE ON commands
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_inspections BEFORE UPDATE OR DELETE ON task_inspections
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE FUNCTION protect_proposal_body() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'immutable proposal'; END IF;
 IF (NEW.data - 'status' - 'accepted_revision_id') IS DISTINCT FROM (OLD.data - 'status' - 'accepted_revision_id')
 OR NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.artifact_id <> OLD.artifact_id
 OR NEW.base_revision_id <> OLD.base_revision_id THEN RAISE EXCEPTION 'immutable proposal body'; END IF;
 RETURN NEW;
 END;
$$;
CREATE TRIGGER immutable_proposal_body BEFORE UPDATE OR DELETE ON proposals
 FOR EACH ROW EXECUTE FUNCTION protect_proposal_body();
