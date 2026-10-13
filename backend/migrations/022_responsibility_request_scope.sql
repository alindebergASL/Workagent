-- Exact run/message scope, not merely membership in a multi-conversation grant.
-- Retain all historical origin/publication/receipt guards from 001--021.
ALTER TABLE runs ADD CONSTRAINT runs_exact_conversation_key
 UNIQUE (workspace_id,id,conversation_id);
ALTER TABLE conversation_messages ADD CONSTRAINT message_exact_run_conversation
 FOREIGN KEY (workspace_id,run_id,conversation_id)
 REFERENCES runs(workspace_id,id,conversation_id);

-- The deferred binding witness must be the request in the bound conversation.
CREATE OR REPLACE FUNCTION guard_responsibility_request_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs;
BEGIN
 IF NOT (NEW.data ? 'responsibility') THEN RETURN NEW; END IF;
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 PERFORM require_responsibility_binding(r,NEW.data->'responsibility',false);
 IF NOT EXISTS (SELECT 1 FROM conversation_messages m
                WHERE m.workspace_id=r.workspace_id AND m.run_id=r.id
                AND m.conversation_id=r.conversation_id AND m.author_kind='system')
 THEN RAISE EXCEPTION 'truthful exact-conversation runtime request required'; END IF;
 RETURN NEW;
END; $$;
