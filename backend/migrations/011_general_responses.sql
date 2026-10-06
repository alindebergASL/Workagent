-- New general profile only. Accepted 001-010, historical request bytes and grants are untouched.
ALTER TABLE runs DROP CONSTRAINT run_owner_data_binding;
ALTER TABLE runs ADD CONSTRAINT run_owner_data_binding CHECK
 ((data->>'assignment_id') IS NOT DISTINCT FROM assignment_id AND
  (data->>'conversation_id') IS NOT DISTINCT FROM conversation_id AND
  (conversation_id IS NOT NULL) = (data->>'kind'='conversation_turn') AND
  (conversation_id IS NOT NULL) = (data->>'profile' IN ('general-controlled-v1','general-products-controlled-v1','general-responses-v1')));
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='conversation_messages'::regclass
   AND contype='c' AND pg_get_constraintdef(oid) LIKE '%evidence_origin%'
 LOOP EXECUTE format('ALTER TABLE conversation_messages DROP CONSTRAINT %I',r.conname); END LOOP;
END $$;
ALTER TABLE conversation_messages ADD CONSTRAINT message_origin CHECK
 ((author_kind='human' AND data->>'evidence_origin'='human' AND data->'result'='null'::jsonb)
 OR (author_kind='assistant' AND data->>'evidence_origin' IN ('controlled_transport','synthetic_provider_receipt','live_provider_receipt')
     AND data->'result'<>'null'::jsonb));
INSERT INTO bundle_activations(id,data) VALUES ('general-responses-v1','{"profile":"general-responses-v1","version":1,"activation":"explicit_scoped_grant_only"}');
-- One durable cumulative authorization cannot be reset by revoke/restart/new ID.
CREATE UNIQUE INDEX general_authorization_once ON provider_grants((data->'responses'->>'authorization_sha256'))
 WHERE data->>'profile'='general-responses-v1' AND data->'responses'->>'transport_mode'='official_api';
CREATE FUNCTION guard_general_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b jsonb; cid text;
BEGIN
 IF NEW.data->>'profile'<>'general-responses-v1' THEN RETURN NEW; END IF;
 b=NEW.data->'responses';
 IF NEW.data->>'id' IS DISTINCT FROM NEW.id OR NEW.data->>'workspace_id' IS DISTINCT FROM NEW.workspace_id
 OR NEW.data->>'principal_id' IS DISTINCT FROM NEW.principal_id
 OR NEW.data->'expires_at' IS DISTINCT FROM 'null'::jsonb
 OR NEW.data->>'model' IS DISTINCT FROM 'gpt-6.1-sol'
 OR coalesce((NEW.data->>'max_runs')::integer,0) NOT BETWEEN 1 AND 4
 OR NEW.data->>'max_received_output_tokens' IS DISTINCT FROM '16384'
 OR b->>'policy_version' IS DISTINCT FROM 'general-responses-v1'
 OR b->>'generation_limit' IS DISTINCT FROM '8' OR b->>'count_limit' IS DISTINCT FROM '8'
 OR b->>'read_limit' IS DISTINCT FROM '80' OR b->>'cancel_limit' IS DISTINCT FROM '0'
 OR b->>'input_limit' IS DISTINCT FROM '160000' OR b->>'output_limit' IS DISTINCT FROM '65536'
 OR b->>'cost_limit_usd' IS DISTINCT FROM '20.00'
 OR b->>'synthetic_data_only' IS DISTINCT FROM 'true' OR b->>'store_acknowledged' IS DISTINCT FROM 'true'
 OR b->>'authorization_sha256' IS DISTINCT FROM 'd7f676d970ef2c6d56c39fe961114d00140279b99ba72649177c41de159093c9'
 OR jsonb_typeof(b->'conversation_ids') IS DISTINCT FROM 'array'
 OR jsonb_array_length(b->'conversation_ids') NOT BETWEEN 1 AND 2
 THEN RAISE EXCEPTION 'exact bounded general authorization required'; END IF;
 FOR cid IN SELECT jsonb_array_elements_text(b->'conversation_ids') LOOP
   IF NOT EXISTS (SELECT 1 FROM conversations cv WHERE cv.workspace_id=NEW.workspace_id AND cv.id=cid
      AND cv.data->>'owner_id'=NEW.principal_id AND cv.data->'selected_source_refs'='[]'::jsonb)
   THEN RAISE EXCEPTION 'explicit synthetic conversation scope required'; END IF;
   IF TG_OP='INSERT' AND EXISTS (SELECT 1 FROM provider_grants g WHERE g.workspace_id=NEW.workspace_id
      AND g.data->>'profile'='general-responses-v1' AND g.data->'responses'->'conversation_ids' ? cid)
   THEN RAISE EXCEPTION 'conversation authorization cannot reset'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_general_grants BEFORE INSERT OR UPDATE ON provider_grants FOR EACH ROW EXECUTE FUNCTION guard_general_grant();

-- Immutable configurations are cumulative admissions, including cancelled runs.
-- Use the same workspace lock as API admission/revocation; raw runtime inserts
-- must serialize too, even across the two conversations in one grant.
CREATE FUNCTION guard_general_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; g provider_grants; n integer;
BEGIN
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.data->>'grant_id';
 IF r.data->>'profile'<>'general-responses-v1' AND NEW.data->>'profile' IS DISTINCT FROM 'general-responses-v1'
    AND g.data->>'profile' IS DISTINCT FROM 'general-responses-v1' THEN RETURN NEW; END IF;
 -- A row lock does not refresh a REPEATABLE READ snapshot. Fail closed
 -- outside the READ COMMITTED isolation used by this runtime.
 IF current_setting('transaction_isolation')<>'read committed'
 THEN RAISE EXCEPTION 'general authority requires read committed isolation'; END IF;
 PERFORM id FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.data->>'grant_id';
 IF g.id IS NULL OR NOT g.active OR g.workspace_id IS DISTINCT FROM NEW.workspace_id
    OR g.principal_id IS DISTINCT FROM r.data->>'principal_id'
    OR r.data->>'profile' IS DISTINCT FROM 'general-responses-v1'
    OR NEW.activation_id IS DISTINCT FROM 'general-responses-v1'
    OR NEW.data->>'profile' IS DISTINCT FROM 'general-responses-v1'
    OR g.data->>'profile' IS DISTINCT FROM 'general-responses-v1'
    OR NEW.data->'responses' IS DISTINCT FROM g.data->'responses'
    OR NOT(g.data->'responses'->'conversation_ids' ? r.conversation_id)
 THEN RAISE EXCEPTION 'exact general admission authority required'; END IF;
 SELECT count(*) INTO n FROM run_configurations WHERE data->>'grant_id'=g.id;
 IF n>=(g.data->>'max_runs')::integer THEN RAISE EXCEPTION 'cumulative general admission limit'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_general_admissions BEFORE INSERT ON run_configurations FOR EACH ROW EXECUTE FUNCTION guard_general_admission();

CREATE OR REPLACE FUNCTION guard_responses_step() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a provider_attempts; g provider_grants;
BEGIN
 SELECT * INTO a FROM provider_attempts WHERE id=NEW.attempt_id;
 SELECT * INTO g FROM provider_grants WHERE id=NEW.grant_id;
 IF a.grant_id<>NEW.grant_id OR a.data->>'profile' NOT IN ('openai-responses-v1','general-responses-v1')
 OR NEW.metadata->>'attempt_id'<>NEW.attempt_id OR NEW.metadata->>'step_id'<>NEW.phase
 OR g.data->>'profile' IS DISTINCT FROM a.data->>'profile' THEN RAISE EXCEPTION 'invalid step binding'; END IF;
 IF NEW.phase='final' AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase='selection' AND kind='tool_result')
 THEN RAISE EXCEPTION 'authorized selection tool result required'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_responses_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid text; ws text; n integer; lim integer; grantrow provider_grants; current_run runs; total_input bigint; total_output bigint; total_cost numeric;
BEGIN
 SELECT s.grant_id,g.workspace_id INTO gid,ws FROM responses_steps s JOIN provider_grants g ON g.id=s.grant_id
 WHERE s.attempt_id=NEW.attempt_id AND s.phase=NEW.phase;
 PERFORM id FROM workspaces WHERE id=ws FOR UPDATE;
 SELECT * INTO grantrow FROM provider_grants WHERE id=gid;
 IF NEW.kind IN ('count_send','dispatch','read','cancel') THEN
   IF grantrow.data->>'profile'='general-responses-v1'
      AND current_setting('transaction_isolation')<>'read committed'
   THEN RAISE EXCEPTION 'general authority requires read committed isolation'; END IF;
   IF NOT EXISTS (SELECT 1 FROM provider_grants g WHERE id=gid AND active AND
      ((grantrow.data->>'profile'='general-responses-v1' AND grantrow.data->'expires_at'='null'::jsonb) OR (data->>'expires_at')::timestamptz>now() OR EXISTS (
        SELECT 1 FROM provider_consumer_successors a JOIN responses_consumer_uses u ON u.grant_id=a.grant_id
        WHERE a.grant_id=g.id AND u.attempt_id=NEW.attempt_id AND (a.data->>'expires_at')::timestamptz>now())))
   THEN RAISE EXCEPTION 'grant unavailable'; END IF;
   SELECT count(*) INTO n FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
    WHERE s.grant_id=gid AND e.kind=NEW.kind;
   lim=CASE WHEN grantrow.data->>'profile'='general-responses-v1' THEN
       CASE NEW.kind WHEN 'read' THEN 80 WHEN 'cancel' THEN 0 ELSE 8 END
       ELSE CASE WHEN NEW.kind='read' THEN 40 ELSE 4 END END;
   IF n>=lim THEN RAISE EXCEPTION 'cumulative request limit'; END IF;
 END IF;
 IF grantrow.data->>'profile'='general-responses-v1' AND NEW.kind IN ('count_send','dispatch','read','cancel','tool_result') THEN
   IF NOT EXISTS (SELECT 1 FROM provider_attempts a JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
       JOIN conversations cv ON cv.workspace_id=r.workspace_id AND cv.id=r.conversation_id
       JOIN memberships m ON m.workspace_id=r.workspace_id AND m.principal_id=r.data->>'principal_id'
       JOIN workspaces w ON w.id=r.workspace_id
       WHERE a.id=NEW.attempt_id AND r.data->>'state'='running' AND cv.data->>'state'='open'
       AND m.active AND grantrow.active AND r.data->>'access_generation'=w.access_generation::text
       AND (r.data->>'lease_expires_at')::timestamptz>now()
       AND grantrow.data->'responses'->'conversation_ids' ? r.conversation_id)
   THEN RAISE EXCEPTION 'current general execution authority required'; END IF;
   SELECT run.* INTO current_run FROM runs run JOIN provider_attempts a ON a.workspace_id=run.workspace_id AND a.run_id=run.id
      WHERE a.id=NEW.attempt_id;
   PERFORM require_general_publication_authority(current_run);
 END IF;
 IF NEW.kind='dispatch' THEN
   SELECT coalesce(sum((e.data->>'reserved_input_tokens')::bigint),0),
          coalesce(sum((e.data->>'reserved_output_tokens')::bigint),0),
          coalesce(sum((e.data->>'reserved_cost_usd')::numeric),0)
     INTO total_input,total_output,total_cost FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
     WHERE s.grant_id=gid AND e.kind='dispatch';
   IF total_input+20000>(CASE WHEN grantrow.data->>'profile'='general-responses-v1' THEN 160000 ELSE 80000 END)
      OR total_output+8192>(CASE WHEN grantrow.data->>'profile'='general-responses-v1' THEN 65536 ELSE 32768 END)
      OR total_cost+0.131920>20.00 THEN RAISE EXCEPTION 'cumulative reservation limit'; END IF;
   IF NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='count_result')
   THEN RAISE EXCEPTION 'durable count required'; END IF;
   IF NEW.data->>'reserved_input_tokens'<>'20000' OR NEW.data->>'reserved_output_tokens'<>'8192'
      OR (NEW.data->>'reserved_cost_usd')::numeric<>0.131920
   THEN RAISE EXCEPTION 'full worst-case reservation required'; END IF;
 END IF;
 IF NEW.kind='count_result' AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='count_send')
 THEN RAISE EXCEPTION 'count send required'; END IF;
 IF NEW.kind IN ('identity','result','read','cancel','corrected_readback') AND NOT EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='dispatch')
 THEN RAISE EXCEPTION 'dispatch required'; END IF;
 RETURN NEW;
END;
$$;



-- General admission/receipt publication is a distinct policy over the SAME tables.
CREATE FUNCTION require_general_publication_authority(r runs) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t jsonb;
BEGIN
 PERFORM id FROM workspaces WHERE id=r.workspace_id FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM workspaces w JOIN memberships m ON m.workspace_id=w.id
     JOIN conversations cv ON cv.workspace_id=w.id AND cv.id=r.conversation_id
     JOIN run_configurations rc ON rc.workspace_id=w.id AND rc.run_id=r.id
     JOIN provider_grants g ON g.id=rc.data->>'grant_id'
     WHERE w.id=r.workspace_id AND m.principal_id=r.data->>'principal_id' AND m.active
     AND r.data->>'access_generation'=w.access_generation::text AND r.data->>'state'='running'
     AND (r.data->>'lease_expires_at')::timestamptz>now() AND cv.data->>'state'='open'
     AND g.active AND g.workspace_id=w.id AND g.principal_id=m.principal_id
     AND g.data->>'profile'='general-responses-v1' AND g.data->'responses'=rc.data->'responses'
     AND g.data->'responses'->'conversation_ids' ? cv.id)
 THEN RAISE EXCEPTION 'current general publication authority required'; END IF;
 SELECT data->'target' INTO t FROM conversation_messages
 WHERE workspace_id=r.workspace_id AND run_id=r.id AND author_kind='human';
 IF NOT FOUND THEN RAISE EXCEPTION 'admitted general human message required'; END IF;
 IF t<>'null'::jsonb AND NOT EXISTS (SELECT 1 FROM artifacts art JOIN revisions rev
     ON rev.workspace_id=art.workspace_id AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
     WHERE art.workspace_id=r.workspace_id AND art.conversation_id=r.conversation_id
     AND art.id=t->>'artifact_id' AND rev.id=t->>'revision_id' AND rev.data->>'body_hash'=t->>'body_hash')
 THEN RAISE EXCEPTION 'exact current scoped publication target required'; END IF;
END; $$;
CREATE FUNCTION guard_general_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; rc run_configurations; g provider_grants; a jsonb; t jsonb; n integer;
BEGIN
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 IF r.data->>'profile'<>'general-responses-v1' THEN
   IF NEW.data->>'model_receipt' IS NOT NULL OR NEW.data->>'evidence_origin' IN ('synthetic_provider_receipt','live_provider_receipt')
   THEN RAISE EXCEPTION 'model evidence requires general profile'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO rc FROM run_configurations WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id;
 SELECT * INTO g FROM provider_grants WHERE id=rc.data->>'grant_id';
 IF g.id IS NULL OR NOT g.active OR g.workspace_id<>NEW.workspace_id
    OR g.principal_id IS DISTINCT FROM r.data->>'principal_id'
    OR g.data->>'profile'<>'general-responses-v1'
    OR rc.data->'responses' IS DISTINCT FROM g.data->'responses'
    OR NOT(g.data->'responses'->'conversation_ids' ? NEW.conversation_id)
 THEN RAISE EXCEPTION 'active exact conversation authority required'; END IF;
 IF NEW.author_kind='human' THEN
   IF NEW.data->'operation' IS DISTINCT FROM 'null'::jsonb OR NEW.data->>'model_receipt' IS NOT NULL
      OR jsonb_typeof(NEW.data->'attachments') IS DISTINCT FROM 'array'
      OR jsonb_array_length(NEW.data->'attachments')>2
   THEN RAISE EXCEPTION 'bounded general message inputs required'; END IF;
   n=0;
   FOR a IN SELECT jsonb_array_elements(NEW.data->'attachments') LOOP
     n=n+octet_length(a->>'content');
     IF a->>'sha256' IS DISTINCT FROM encode(sha256(convert_to(a->>'content','UTF8')),'hex')
        OR (a->>'byte_length')::integer IS DISTINCT FROM octet_length(a->>'content')
        OR octet_length(a->>'content') NOT BETWEEN 1 AND 200000
        OR a->>'ref' IS NULL OR a->>'mime_type' NOT IN ('text/csv','text/plain')
     THEN RAISE EXCEPTION 'immutable attachment bytes/hash required'; END IF;
   END LOOP;
   IF n>200000 THEN RAISE EXCEPTION 'aggregate attachment bound'; END IF;
   t=NEW.data->'target';
   IF t<>'null'::jsonb AND NOT EXISTS (SELECT 1 FROM artifacts art JOIN revisions rev ON rev.workspace_id=art.workspace_id
      AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
      WHERE art.workspace_id=NEW.workspace_id AND art.conversation_id=NEW.conversation_id
      AND art.id=t->>'artifact_id' AND rev.id=t->>'revision_id' AND rev.data->>'body_hash'=t->>'body_hash')
   THEN RAISE EXCEPTION 'exact current scoped target required'; END IF;
 ELSE
   PERFORM require_general_publication_authority(r);
   IF r.data->>'state'<>'running' OR (r.data->>'lease_expires_at')::timestamptz<=now()
      OR NOT EXISTS (SELECT 1 FROM provider_attempts pa JOIN responses_events e ON e.attempt_id=pa.id
         JOIN responses_events stage ON stage.attempt_id=pa.id AND stage.phase='selection' AND stage.kind='tool_result'
         WHERE pa.id=NEW.data->>'model_receipt' AND pa.run_id=NEW.run_id AND pa.workspace_id=NEW.workspace_id
         AND pa.evidence_origin=NEW.data->>'evidence_origin' AND e.phase='final' AND e.kind='result'
         AND e.data->>'state'='completed' AND e.data->'value'->>'text'=NEW.data->>'text')
   THEN RAISE EXCEPTION 'exact retained model explanation required'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_general_messages BEFORE INSERT ON conversation_messages FOR EACH ROW EXECUTE FUNCTION guard_general_message();

CREATE FUNCTION guard_general_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; t jsonb; b jsonb; result_body jsonb;
BEGIN
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 IF r.data->>'profile'<>'general-responses-v1' THEN
   IF NEW.data->>'evidence_origin'<>'controlled_transport' OR NEW.data->>'model_selection' IS NOT NULL
   THEN RAISE EXCEPTION 'controlled observation cannot claim model selection'; END IF;
   RETURN NEW;
 END IF;
 b=NEW.data->'model_selection';
 PERFORM require_general_publication_authority(r);
 SELECT e.data INTO t FROM responses_events e JOIN provider_attempts pa ON pa.id=e.attempt_id
   WHERE pa.run_id=NEW.run_id AND pa.workspace_id=NEW.workspace_id AND pa.id=b->>'attempt_id'
   AND e.phase='selection' AND e.kind='tool_result';
 IF t IS NULL OR t->>'status'<>'observed' OR NEW.data->>'evidence_origin'<>'local_tool'
    OR t->'binding' IS DISTINCT FROM b OR t->'output' IS DISTINCT FROM NEW.data->'output'
    OR NEW.data->>'operation_hash' IS DISTINCT FROM b->>'operation_hash'
 THEN RAISE EXCEPTION 'retained local observation and model receipt binding required'; END IF;
 IF NEW.data->>'proposal_id' IS NOT NULL THEN
   SELECT data->'body' INTO result_body FROM proposals WHERE workspace_id=NEW.workspace_id AND id=NEW.data->>'proposal_id';
 ELSE
   SELECT data->'body' INTO result_body FROM revisions WHERE workspace_id=NEW.workspace_id AND id=NEW.data->>'revision_id';
 END IF;
 IF result_body IS DISTINCT FROM t->'body' AND result_body IS DISTINCT FROM t->'file'
 THEN RAISE EXCEPTION 'publication must use retained local body'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_general_observations BEFORE INSERT ON product_observations FOR EACH ROW EXECUTE FUNCTION guard_general_observation();

CREATE OR REPLACE FUNCTION protect_provider_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_state text; new_state text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable attempt admission'; END IF;
 old_state=OLD.data->>'state'; new_state=NEW.data->>'state';
 IF OLD.data->>'profile'='general-responses-v1' AND new_state='reconciled' THEN
   IF old_state NOT IN ('dispatched','outcome_unknown') OR
      (NEW.data-'state') IS DISTINCT FROM (OLD.data-'state') OR
      (to_jsonb(NEW)-'data') IS DISTINCT FROM (to_jsonb(OLD)-'data') OR
      NOT EXISTS (SELECT 1 FROM conversation_messages m JOIN responses_events e ON e.attempt_id=NEW.id AND e.phase='final' AND e.kind='result'
          JOIN responses_events t ON t.attempt_id=NEW.id AND t.phase='selection' AND t.kind='tool_result'
          WHERE m.workspace_id=NEW.workspace_id AND m.run_id=NEW.run_id AND m.author_kind='assistant'
          AND m.data->>'model_receipt'=NEW.id AND e.data->>'state'='completed'
          AND m.data->>'text'=e.data->'value'->>'text')
   THEN RAISE EXCEPTION 'exact general publication receipts required'; END IF;
   RETURN NEW;
 END IF;

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
