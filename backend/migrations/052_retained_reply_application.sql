-- Owner-local exact source-free reply application, NOT runtime execution authority.
-- This additive exception cannot send, observe, stage tools or revive grants.
CREATE FUNCTION owner_retained_reply_matches(ws text, rid text, message jsonb)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='provider_grants'::regclass)
 AND EXISTS (
 SELECT 1 FROM runs r
 JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id
 JOIN provider_attempts a ON a.workspace_id=r.workspace_id AND a.run_id=r.id
 JOIN provider_grants g ON g.id=a.grant_id
 JOIN workspaces w ON w.id=r.workspace_id
 JOIN memberships m ON m.workspace_id=w.id AND m.principal_id=r.data->>'principal_id'
 JOIN conversations cv ON cv.workspace_id=w.id AND cv.id=r.conversation_id
 JOIN responses_steps s ON s.attempt_id=a.id AND s.phase='selection'
 JOIN responses_events e ON e.attempt_id=a.id AND e.phase=s.phase AND e.kind='result'
 JOIN responses_events i ON i.attempt_id=a.id AND i.phase=s.phase AND i.kind='identity'
 WHERE r.workspace_id=ws AND r.id=rid AND r.data->>'profile'='general-responses-v1'
 AND r.data->>'access_generation'=w.access_generation::text
 AND m.active AND m.role IN ('owner','editor') AND cv.data->>'owner_id'=m.principal_id
 AND cv.data->>'state'='open' AND cv.data->'selected_source_refs'='[]'::jsonb
 AND NOT g.active AND g.workspace_id=ws AND g.principal_id=m.principal_id
 AND g.data->>'profile'='general-responses-v1'
 AND rc.data->>'grant_id'=g.id AND rc.data->'responses'=g.data->'responses'
 AND NOT rc.data ? 'responsibility' AND NOT rc.data ? 'continuation'
 AND message->>'run_id'=rid AND message->>'conversation_id'=cv.id
 AND message->>'author_kind'='assistant' AND message->>'author_id'='general-responses-worker'
 AND message->>'model_receipt'=a.id AND message->>'evidence_origin'=a.evidence_origin
 AND message->>'text'=e.data->'value'->'decision'->>'text'
 AND message->'result'=jsonb_build_object('results',jsonb_build_array(jsonb_build_object('kind','text','text',message->>'text')))
 AND message->'target'='null'::jsonb AND message->'operation'='null'::jsonb
 AND message->'attachments'='[]'::jsonb AND coalesce(message->'document_refs','[]'::jsonb)='[]'::jsonb
 AND message->>'acceptance_checks' IS NULL AND message->>'responsibility_origin' IS NULL
 AND e.data->>'state'='function_call' AND e.data->'value'->'decision'->>'kind'='reply'
 AND e.data->>'request_sha256'=s.request_sha256 AND i.data->>'request_sha256'=s.request_sha256
 AND e.data->>'response_id'=i.data->>'response_id' AND e.data->'metadata'=s.metadata AND i.data->'metadata'=s.metadata
 AND e.data->'provenance'=i.data->'provenance'
 AND e.data->'provenance'->>'mode'=g.data->'responses'->>'transport_mode'
 AND (e.data->'provenance'->>'mode'='synthetic' OR e.data->'provenance'->>'origin'='https://api.openai.com')
 AND (SELECT count(*) FROM responses_steps WHERE attempt_id=a.id)=1
 AND NOT EXISTS (SELECT 1 FROM responses_events x WHERE x.attempt_id=a.id AND x.kind IN ('tool_result','problem','cancel'))
 AND NOT EXISTS (SELECT 1 FROM artifacts WHERE workspace_id=ws AND conversation_id=cv.id)
 AND NOT EXISTS (SELECT 1 FROM runs WHERE workspace_id=ws AND conversation_id=cv.id AND id<>rid)
 AND (SELECT count(*) FROM conversation_messages WHERE workspace_id=ws AND conversation_id=cv.id AND author_kind<>'assistant')=1
 AND EXISTS (SELECT 1 FROM conversation_messages h WHERE h.workspace_id=ws AND h.conversation_id=cv.id
    AND h.run_id=rid AND h.author_kind='human' AND h.data->'target'='null'::jsonb
    AND h.data->'attachments'='[]'::jsonb AND coalesce(h.data->'document_refs','[]'::jsonb)='[]'::jsonb)
 )
$$;

DO $$
DECLARE d text; old text; replacement text;
BEGIN
 d=pg_get_functiondef('guard_general_message()'::regprocedure);
 old=' SELECT * INTO rc FROM run_configurations WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id;';
 replacement=$new$ IF NEW.author_kind='assistant' AND owner_retained_reply_matches(NEW.workspace_id,NEW.run_id,NEW.data) THEN
   IF r.data->>'state' NOT IN ('queued','running')
      OR (r.data->>'lease_expires_at')::timestamptz>clock_timestamp()
      OR (r.data->>'used_units')::int >= (r.data->>'budget_units')::int
      OR NEW.sequence<>2
      OR EXISTS (SELECT 1 FROM conversation_messages WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id AND author_kind='assistant')
   THEN RAISE EXCEPTION 'quiescent exact reply application required'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO rc FROM run_configurations WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id;$new$;
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'reply message predecessor drift'; END IF;
 EXECUTE replace(d,old,replacement);
 d=pg_get_functiondef('protect_provider_attempt()'::regprocedure);
 old='      NOT EXISTS (SELECT 1 FROM conversation_messages m JOIN responses_events e ON e.attempt_id=NEW.id AND e.phase=''final'' AND e.kind=''result''';
 replacement=$new$      NOT EXISTS (SELECT 1 FROM conversation_messages m JOIN runs r ON r.workspace_id=m.workspace_id AND r.id=m.run_id
          WHERE m.workspace_id=NEW.workspace_id AND m.run_id=NEW.run_id AND m.author_kind='assistant'
          AND r.data->>'state'='ready' AND r.lease_hash IS NULL
          AND owner_retained_reply_matches(NEW.workspace_id,NEW.run_id,m.data)) AND
      NOT EXISTS (SELECT 1 FROM conversation_messages m JOIN responses_events e ON e.attempt_id=NEW.id AND e.phase='final' AND e.kind='result'$new$;
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'reply settlement predecessor drift'; END IF;
 EXECUTE replace(d,old,replacement);
END $$;
