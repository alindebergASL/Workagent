-- Explicit-target companion creation is not replacement authority. Preserve all
-- prior stage/publication guards and enforce the narrow exception in PostgreSQL.
CREATE FUNCTION guard_companion_view_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb; target jsonb; config jsonb; author text; ref jsonb;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data->'value'->'decision' INTO selected FROM responses_events
   WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF selected->>'kind' IS DISTINCT FROM 'publish_artifact'
    OR selected->'body'->>'kind' IS DISTINCT FROM 'custom_view'
    OR nullif(selected->'target','null'::jsonb) IS NOT NULL
 THEN RETURN NEW; END IF;
 SELECT m.data->'target',m.author_kind,rc.data INTO target,author,config
   FROM provider_attempts a JOIN run_configurations rc ON rc.workspace_id=a.workspace_id AND rc.run_id=a.run_id
   JOIN conversation_messages m ON m.workspace_id=a.workspace_id AND m.run_id=a.run_id
   WHERE a.id=NEW.attempt_id AND m.author_kind IN ('human','system');
 IF nullif(target,'null'::jsonb) IS NULL THEN RETURN NEW; END IF;
 -- This reviewed policy introduces the exception. Legacy alpha does not imply
 -- authority for it. New policy pins require an additive reviewed migration.
 IF config->'responses'->>'instructions_sha256' IS DISTINCT FROM
    'd9e01384a363919be4c4436b1ddcd1db6d4b69d4ee42b27e85f85030051c1a47'
 THEN RAISE EXCEPTION 'companion policy not authorized'; END IF;
 IF author IS DISTINCT FROM 'human' OR config ? 'responsibility'
    OR config->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
    OR selected->'body'->>'version' IS DISTINCT FROM 'custom-view/v1'
    OR jsonb_typeof(selected->'body'->'bindings') IS DISTINCT FROM 'array'
    OR jsonb_array_length(selected->'body'->'bindings')=0
    OR NEW.data->'binding'->'base_hash' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'companion requires exact human source without mutation base'; END IF;
 FOR ref IN SELECT jsonb_array_elements(selected->'body'->'bindings') LOOP
   IF (ref-'name') IS DISTINCT FROM target
   THEN RAISE EXCEPTION 'companion may bind only its exact explicit source'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER companion_view_scope_guard BEFORE INSERT ON responses_events
FOR EACH ROW EXECUTE FUNCTION guard_companion_view_scope();
