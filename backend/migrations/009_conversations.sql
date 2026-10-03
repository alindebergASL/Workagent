-- B1 adds chat ownership without converting each message into an assignment.
CREATE TABLE conversations (
 workspace_id text REFERENCES workspaces(id), id text NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE conversation_sources (
 workspace_id text, conversation_id text, source_id text,
 PRIMARY KEY(workspace_id,conversation_id,source_id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id)
);
CREATE TRIGGER immutable_conversation_sources BEFORE UPDATE OR DELETE ON conversation_sources
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
ALTER TABLE assignments ADD COLUMN conversation_id text;
ALTER TABLE assignments ADD CONSTRAINT assignment_conversation_fk
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id);
ALTER TABLE runs ALTER COLUMN assignment_id DROP NOT NULL;
ALTER TABLE runs ADD COLUMN conversation_id text;
ALTER TABLE runs ADD CONSTRAINT run_conversation_fk
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id);
ALTER TABLE runs ADD CONSTRAINT run_exactly_one_owner CHECK
 ((assignment_id IS NOT NULL)::integer + (conversation_id IS NOT NULL)::integer = 1);
ALTER TABLE runs ADD CONSTRAINT run_owner_data_binding CHECK
 ((data->>'assignment_id') IS NOT DISTINCT FROM assignment_id AND
  (data->>'conversation_id') IS NOT DISTINCT FROM conversation_id AND
  (conversation_id IS NOT NULL) = (data->>'kind' = 'conversation_turn') AND
  (conversation_id IS NOT NULL) = (data->>'profile' = 'general-controlled-v1'));
CREATE INDEX runs_conversation ON runs(workspace_id,conversation_id);
CREATE TABLE conversation_messages (
 workspace_id text, conversation_id text, id text NOT NULL, run_id text NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0), author_kind text NOT NULL CHECK(author_kind IN ('human','assistant')),
 data jsonb NOT NULL, PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,conversation_id,sequence), UNIQUE(workspace_id,run_id,author_kind),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id),
 CHECK(data->>'id'=id AND data->>'conversation_id'=conversation_id AND data->>'run_id'=run_id
       AND data->>'author_kind'=author_kind AND (data->>'sequence')::integer=sequence),
 CHECK((author_kind='human' AND data->>'evidence_origin'='human' AND data->'result'='null'::jsonb)
    OR (author_kind='assistant' AND data->>'evidence_origin'='controlled_transport' AND data->'result'<>'null'::jsonb))
);
CREATE TRIGGER immutable_conversation_messages BEFORE UPDATE OR DELETE ON conversation_messages
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE FUNCTION protect_run_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.workspace_id,NEW.id,NEW.assignment_id,NEW.conversation_id) IS DISTINCT FROM
    (OLD.workspace_id,OLD.id,OLD.assignment_id,OLD.conversation_id)
 THEN RAISE EXCEPTION 'immutable run owner'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_run_owner BEFORE UPDATE ON runs
 FOR EACH ROW EXECUTE FUNCTION protect_run_owner();
-- Separate versioned, no-inference capability. Does not activate/mutate intake.
INSERT INTO bundle_activations(id,data) VALUES ('general-controlled-v1',
 '{"profile":"general-controlled-v1","version":"1","bundle_hash":"dcd90d3d65afb2e1259f0badf7212b7bea8b1b647be1da540fb97967071e2eb4"}');
