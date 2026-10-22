-- Observation of an existing identity is separate from execution/publication.
-- Changed dependency versions may invalidate execution without revoking reads.
CREATE FUNCTION cancelled_response_observation_permits(aid text) RETURNS boolean
LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
 SELECT 1 FROM provider_attempts a
 JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
 JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id
 JOIN provider_grants g ON g.id=a.grant_id
 JOIN workspaces w ON w.id=r.workspace_id
 JOIN memberships m ON m.workspace_id=w.id AND m.principal_id=r.data->>'principal_id'
 JOIN conversations cv ON cv.workspace_id=w.id AND cv.id=r.conversation_id
 JOIN assignments job ON job.workspace_id=w.id AND job.id=rc.data->'responsibility'->>'assignment_id'
 WHERE a.id=aid AND r.data->>'state'='cancelled' AND r.data->>'profile'='general-responses-v1'
 AND m.active AND m.role IN ('owner','editor') AND r.data->>'access_generation'=w.access_generation::text
 AND cv.data->>'state'='open' AND cv.data->>'owner_id'=m.principal_id
 AND cv.data->'selected_source_refs'='[]'::jsonb
 AND job.conversation_id=cv.id AND job.data->>'owner_id'=m.principal_id
 AND job.responsibility_lifecycle->>'state' NOT IN ('paused','cancelled','taken_over')
 AND g.active AND g.workspace_id=w.id AND g.principal_id=m.principal_id
 AND g.data->>'profile'='general-responses-v1' AND rc.data->>'grant_id'=g.id
 AND rc.data->'responses'=g.data->'responses'
 AND (g.data->'expires_at'='null'::jsonb OR (g.data->>'expires_at')::timestamptz>now())
 AND general_execution_scope_permits(g.id,cv.id)
 AND NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements(rc.data->'responsibility'->'observations') dep
   WHERE CASE WHEN dep->>'kind'='artifact_revision' THEN NOT EXISTS (
     SELECT 1 FROM artifacts art WHERE art.workspace_id=w.id AND art.id=dep->>'object_id'
       AND (art.conversation_id=cv.id OR art.assignment_id=job.id))
   WHEN dep->>'kind'='source_version' THEN NOT EXISTS (
     SELECT 1 FROM sources src JOIN source_access access ON access.workspace_id=src.workspace_id AND access.source_id=src.id
     JOIN assignment_sources bound ON bound.workspace_id=src.workspace_id AND bound.source_id=src.id
     WHERE src.workspace_id=w.id AND src.id=dep->>'object_id' AND access.principal_id=m.principal_id
       AND access.active AND src.data->'available'='true'::jsonb AND bound.assignment_id=job.id)
   ELSE true END)
 )
$$;

-- Validate the exact predecessor block; retain every other guard and counter.
DO $$
DECLARE definition text; old_block text; new_block text;
BEGIN
 definition=pg_get_functiondef('guard_responses_event()'::regprocedure);
 old_block=$old$ IF grantrow.data->>'profile'='general-responses-v1' AND NEW.kind IN ('count_send','dispatch','read','cancel','tool_result') THEN
   IF NOT EXISTS (SELECT 1 FROM provider_attempts a JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
       JOIN conversations cv ON cv.workspace_id=r.workspace_id AND cv.id=r.conversation_id
       JOIN memberships m ON m.workspace_id=r.workspace_id AND m.principal_id=r.data->>'principal_id'
       JOIN workspaces w ON w.id=r.workspace_id
       WHERE a.id=NEW.attempt_id AND r.data->>'state'='running' AND cv.data->>'state'='open'
       AND m.active AND grantrow.active AND r.data->>'access_generation'=w.access_generation::text
       AND (r.data->>'lease_expires_at')::timestamptz>now()
       AND general_execution_scope_permits(grantrow.id,r.conversation_id))
   THEN RAISE EXCEPTION 'current general execution authority required'; END IF;
   SELECT run.* INTO current_run FROM runs run JOIN provider_attempts a ON a.workspace_id=run.workspace_id AND a.run_id=run.id
      WHERE a.id=NEW.attempt_id;
   PERFORM require_general_publication_authority(current_run);
 END IF;$old$;
 IF (length(definition)-length(replace(definition,old_block,'')))/length(old_block)<>1
 THEN RAISE EXCEPTION 'cancelled observation predecessor guard drift'; END IF;
 new_block=$new$ IF NEW.data ? 'cancelled_observation' THEN
   IF NEW.kind<>'read' OR NEW.data<>'{"cancelled_observation":true}'::jsonb
      OR NOT cancelled_response_observation_permits(NEW.attempt_id)
      OR NOT EXISTS (SELECT 1 FROM responses_events e JOIN responses_steps s USING(attempt_id,phase)
        WHERE e.attempt_id=NEW.attempt_id AND e.phase=NEW.phase AND e.kind='identity'
          AND e.data->>'request_sha256'=s.request_sha256 AND e.data->'metadata'=s.metadata
          AND e.data->'provenance'->>'mode'=grantrow.data->'responses'->>'transport_mode'
          AND (e.data->'provenance'->>'mode'='synthetic'
            OR e.data->'provenance'->>'origin'='https://api.openai.com'))
      OR EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result')
   THEN RAISE EXCEPTION 'current cancelled observation authority required'; END IF;
 ELSE
$new$ || old_block || E'\n END IF;';
 EXECUTE replace(definition,old_block,new_block);
END $$;

-- The independent responsibility trigger guards the same read reservation.
-- Keep staging/publication checks intact; exempt only current exact observation.
DO $$
DECLARE definition text; old_block text; new_block text;
BEGIN
 definition=pg_get_functiondef('guard_responsibility_phase()'::regprocedure);
 old_block=$old$ IF TG_TABLE_NAME='responses_events' THEN
   IF NEW.kind NOT IN ('count_send','dispatch','read','tool_result') THEN RETURN NEW; END IF;
 END IF;$old$;
 IF (length(definition)-length(replace(definition,old_block,'')))/length(old_block)<>1
 THEN RAISE EXCEPTION 'cancelled observation responsibility guard drift'; END IF;
 new_block=$new$ IF TG_TABLE_NAME='responses_events' THEN
   IF NEW.data ? 'cancelled_observation' THEN
     IF NEW.kind<>'read' OR NEW.data<>'{"cancelled_observation":true}'::jsonb
        OR NOT cancelled_response_observation_permits(NEW.attempt_id)
     THEN RAISE EXCEPTION 'current cancelled observation authority required'; END IF;
     RETURN NEW;
   END IF;
   IF NEW.kind NOT IN ('count_send','dispatch','read','tool_result') THEN RETURN NEW; END IF;
 END IF;$new$;
 EXECUTE replace(definition,old_block,new_block);
END $$;

-- A distinct disposition, never a tool result. Only the nested receipt trigger
-- can insert it. No backfill: a result retained before cancellation stays held.
ALTER TABLE responses_events DROP CONSTRAINT responses_events_kind_check;
ALTER TABLE responses_events ADD CONSTRAINT responses_events_kind_check CHECK
 (kind IN ('count_send','count_result','dispatch','identity','result','read','cancel','tool_result',
           'corrected_readback','problem','cancelled_unapplied'));
CREATE FUNCTION guard_cancelled_unapplied() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='cancelled_unapplied' AND (
   current_user IS DISTINCT FROM (SELECT pg_catalog.pg_get_userbyid(relowner)
     FROM pg_catalog.pg_class WHERE oid='public.responses_events'::regclass)
   OR pg_trigger_depth()<>2 OR NOT EXISTS (
     SELECT 1 FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id
       JOIN runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
     WHERE e.attempt_id=NEW.attempt_id AND e.phase=NEW.phase AND e.kind='result'
       AND e.id=NEW.data->>'result_event_id' AND r.data->>'state'='cancelled'
       AND r.data->>'profile'='general-responses-v1'
       AND e.data->>'state'='function_call' AND jsonb_typeof(e.data->'usage')='object')
   OR EXISTS (SELECT 1 FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='tool_result'))
 THEN RAISE EXCEPTION 'transactional cancelled receipt proof required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_cancelled_unapplied BEFORE INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION guard_cancelled_unapplied();
-- Only this owner-controlled trigger may mint the disposition. Runtime callers
-- can create temporary triggers/functions, so nesting depth alone is not proof.
CREATE FUNCTION retain_cancelled_unapplied() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF TG_RELID<>'public.responses_events'::regclass OR TG_OP<>'INSERT'
    OR TG_WHEN<>'AFTER' OR TG_LEVEL<>'ROW' OR TG_NAME<>'retain_cancelled_unapplied'
 THEN RAISE EXCEPTION 'trusted response receipt trigger required'; END IF;
 -- guard_responses_event already holds the workspace write lock. Every action
 -- requires a committed selection result and current execution authority. If
 -- this first INSERT observes cancellation, no action could have consumed it.
 IF NEW.kind='result' AND NEW.data->>'state'='function_call'
    AND jsonb_typeof(NEW.data->'usage')='object'
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['input_tokens','output_tokens','total_tokens',
        'cached_input_tokens','reasoning_tokens']) k
      WHERE jsonb_typeof(NEW.data->'usage'->k) IS DISTINCT FROM 'number'
        OR coalesce(NEW.data->'usage'->>k,'') !~ '^(0|[1-9][0-9]*)$')
    AND (NEW.data->'usage'->>'total_tokens')::numeric =
        (NEW.data->'usage'->>'input_tokens')::numeric + (NEW.data->'usage'->>'output_tokens')::numeric
    AND EXISTS (SELECT 1 FROM public.provider_attempts a JOIN public.runs r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
      WHERE a.id=NEW.attempt_id AND r.data->>'state'='cancelled' AND r.data->>'profile'='general-responses-v1')
 THEN
   INSERT INTO public.responses_events(id,attempt_id,phase,kind,data)
   VALUES (NEW.id||':unapplied',NEW.attempt_id,NEW.phase,'cancelled_unapplied',
           pg_catalog.jsonb_build_object('result_event_id',NEW.id,'reason','first_retained_after_cancellation'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retain_cancelled_unapplied AFTER INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION retain_cancelled_unapplied();
