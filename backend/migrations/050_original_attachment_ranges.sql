-- A05 additive capability. Historical migrations/receipts stay byte-identical.
-- Only new sustained schemas authorize original attachment reads. Old checkpoints
-- remain incompatible through runtime/config pins; no historical grants rewritten.
ALTER FUNCTION retained_result_material(runs,jsonb) RENAME TO retained_tool_result_material;
CREATE FUNCTION retained_result_material(r runs,d jsonb) RETURNS bytea LANGUAGE plpgsql AS $$
DECLARE message jsonb; attachment jsonb; source bytea; snapshot jsonb;
BEGIN
 IF d->>'kind' IS DISTINCT FROM 'read_attachment' THEN
   RETURN retained_tool_result_material(r,d);
 END IF;
 PERFORM require_general_publication_authority(r);
 SELECT data INTO snapshot FROM run_contexts WHERE workspace_id=r.workspace_id AND run_id=r.id;
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'evidence_context'->'attachments'->'items') item
   WHERE item->>'message_id'=d->>'message_id' AND item->>'ref'=d->>'ref' AND item->>'sha256'=d->>'sha256')
 THEN RAISE EXCEPTION 'attachment must be offered in frozen run context'; END IF;
 SELECT data INTO message FROM conversation_messages WHERE workspace_id=r.workspace_id
   AND conversation_id=r.conversation_id AND id=d->>'message_id' AND author_kind='human';
 IF message IS NULL OR message->>'evidence_origin' IS DISTINCT FROM 'human'
 THEN RAISE EXCEPTION 'original human attachment required'; END IF;
 -- Reuse the same current/source principal, generation, exact target,
 -- responsibility dependencies and historical snapshot revalidation.
 PERFORM retained_tool_result_material(r,jsonb_build_object('run_id',message->>'run_id'));
 IF nullif(message->'target','null'::jsonb) IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM artifacts art JOIN revisions rev ON rev.workspace_id=art.workspace_id AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
   WHERE art.workspace_id=r.workspace_id AND art.conversation_id=r.conversation_id
     AND art.id=message->'target'->>'artifact_id' AND rev.id=message->'target'->>'revision_id'
     AND rev.data->>'body_hash'=message->'target'->>'body_hash')
 THEN RAISE EXCEPTION 'original attachment target changed'; END IF;
 SELECT item INTO attachment FROM jsonb_array_elements(message->'attachments') item
   WHERE item->>'ref'=d->>'ref' AND item->>'sha256'=d->>'sha256';
 IF attachment IS NULL THEN RAISE EXCEPTION 'exact attachment identity required'; END IF;
 source=convert_to(attachment->>'content','UTF8');
 IF encode(sha256(source),'hex') IS DISTINCT FROM d->>'sha256'
   OR octet_length(source) IS DISTINCT FROM (attachment->>'byte_length')::integer
 THEN RAISE EXCEPTION 'original attachment bytes changed'; END IF;
 RETURN source;
END $$;

DO $$ DECLARE definition text; old text;
BEGIN
 definition=pg_get_functiondef('guard_retained_result_read()'::regprocedure);
 old='0b6664002a3c49a5a9c415ab8bc676d528309920d2eb1320b7d59f10268fe177';
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'retained schema predecessor drift'; END IF;
 definition=replace(definition,old,'291bff85aa0ab207c3a148c94430ee49dcf5b164af9121032f859d481cdf0a4e');
 definition=replace(definition,'selected->>''kind'' IS DISTINCT FROM ''read_result''',
   'coalesce(selected->>''kind'','''') NOT IN (''read_result'',''read_attachment'')');
 definition=replace(definition,'selected-ARRAY[''kind'',''run_id'',''phase'',''operation_hash'',''offset'',''limit'']<>''{}''::jsonb',
   '(CASE WHEN selected->>''kind''=''read_attachment'' THEN selected-ARRAY[''kind'',''message_id'',''ref'',''sha256'',''offset'',''limit''] ELSE selected-ARRAY[''kind'',''run_id'',''phase'',''operation_hash'',''offset'',''limit''] END)<>''{}''::jsonb');
 old=' SELECT count(*),coalesce(sum(byte_length),0) INTO pages,used FROM retained_result_reads';
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'retained range predecessor drift'; END IF;
 definition=replace(definition,old,$fragment$
 IF selected->>'kind'='read_attachment' THEN
   expected=expected||jsonb_build_object('message_id',selected->>'message_id','ref',selected->>'ref','sha256',selected->>'sha256',
      'chunk_sha256',encode(sha256(substring(source FROM off+1 FOR ending-off)),'hex'));
 END IF;
$fragment$||old);
 EXECUTE definition;
 definition=pg_get_functiondef('require_run_successor(runs,jsonb)'::regprocedure);
 IF position('0b6664002a3c49a5a9c415ab8bc676d528309920d2eb1320b7d59f10268fe177' in definition)=0
 THEN RAISE EXCEPTION 'successor schema predecessor drift'; END IF;
 EXECUTE replace(definition,'0b6664002a3c49a5a9c415ab8bc676d528309920d2eb1320b7d59f10268fe177',
                           '291bff85aa0ab207c3a148c94430ee49dcf5b164af9121032f859d481cdf0a4e');
 definition=pg_get_functiondef('guard_retained_result_stage()'::regprocedure);
 definition=replace(definition,'<>''read_result''','NOT IN (''read_result'',''read_attachment'')');
 definition=replace(definition,'''capability'',''read_result'',''version''','''capability'',receipt->>''kind'',''version''');
 EXECUTE definition;
END $$;
DROP TRIGGER alpha_stage_guard ON responses_events;
CREATE TRIGGER alpha_stage_guard BEFORE INSERT ON responses_events FOR EACH ROW WHEN (
 coalesce(NEW.data->'decision'->>'kind','') NOT IN ('search_work_context','inspect_json','fetch_public_url','read_result','read_attachment') AND
 coalesce(NEW.data->'capability_result'->>'capability','') NOT IN ('search_work_context','inspect_json','fetch_public_url','read_result','read_attachment')
) EXECUTE FUNCTION guard_alpha_stage();
