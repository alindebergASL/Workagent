-- B2.4 additive retained boundaries/intent. Apply after sibling migration047.
-- No grant, historical request, receipt, reservation or migration is rewritten.
CREATE TABLE run_checkpoints (
 workspace_id text NOT NULL, checkpoint_id text NOT NULL, run_id text NOT NULL,
 conversation_id text NOT NULL, assignment_id text, phase text NOT NULL,
 checkpoint_kind text NOT NULL CHECK (checkpoint_kind IN ('stage','publication','settlement','responsibility','stop')),
 created_at timestamptz NOT NULL DEFAULT now(), checkpoint_hash text NOT NULL,
 data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,checkpoint_id), UNIQUE(workspace_id,run_id,phase,checkpoint_kind),
 FOREIGN KEY(workspace_id,run_id,conversation_id) REFERENCES runs(workspace_id,id,conversation_id),
 FOREIGN KEY(workspace_id,assignment_id) REFERENCES assignments(workspace_id,id),
 CHECK (phase IN ('selection','selection_2','selection_3','selection_4','selection_5','selection_6','selection_7','selection_8','final','stop')),
 CHECK (coalesce(jsonb_typeof(data)='object' AND data->>'schema_version'='run-checkpoint/v1'
   AND octet_length(data::text)<=65536 AND checkpoint_hash ~ '^[0-9a-f]{64}$'
   AND data->>'last_observed_phase'=phase AND jsonb_typeof(data->'steps')='array'
   AND jsonb_array_length(data->'steps')<=9 AND jsonb_typeof(data->'pending_proposal_ids')='array'
   AND jsonb_array_length(data->'pending_proposal_ids')<=100
   AND data->>'waiting' IN ('none','person','event','blocked','unknown','stopped')
   AND data->>'next_safe_action' IN ('resume_phase','continue_slice','await_person','await_event','reconcile','stopped','settled')
   AND data-ARRAY['schema_version','principal_id','access_generation','run_fence','conversation_work_version',
     'assignment_work_version','assignment_fence','configuration_sha256','runtime_sha256','scope_fingerprint','context_sha256',
     'intent_message_id','intent_sha256','latest_human_intent_id','last_observed_phase','steps','pending_proposal_ids','waiting','next_safe_action']='{}'::jsonb,false))
);
CREATE INDEX run_checkpoints_conversation ON run_checkpoints(workspace_id,conversation_id,created_at,checkpoint_id);
CREATE TRIGGER immutable_run_checkpoints BEFORE UPDATE OR DELETE ON run_checkpoints
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TABLE run_successors (
 workspace_id text NOT NULL, predecessor_run_id text NOT NULL, successor_run_id text NOT NULL,
 checkpoint_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,predecessor_run_id), UNIQUE(workspace_id,successor_run_id), UNIQUE(workspace_id,checkpoint_id),
 FOREIGN KEY(workspace_id,predecessor_run_id) REFERENCES runs(workspace_id,id),
 FOREIGN KEY(workspace_id,successor_run_id) REFERENCES runs(workspace_id,id),
 FOREIGN KEY(workspace_id,checkpoint_id) REFERENCES run_checkpoints(workspace_id,checkpoint_id),
 CHECK (predecessor_run_id<>successor_run_id)
);
CREATE TRIGGER immutable_run_successors BEFORE UPDATE OR DELETE ON run_successors
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TABLE conversation_intents (
 workspace_id text NOT NULL, id text NOT NULL, conversation_id text NOT NULL, owner_id text NOT NULL,
 command_id text NOT NULL, position bigint NOT NULL CHECK(position>0), data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,owner_id,command_id), UNIQUE(workspace_id,conversation_id,position),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id),
 CHECK (coalesce(jsonb_typeof(data)='object' AND octet_length(data::text)<=1600000
   AND data->>'id'=id AND data->>'conversation_id'=conversation_id AND data->>'owner_id'=owner_id
   AND data->'position'=to_jsonb(position) AND data->'intent'->>'command_id'=command_id
   AND data->>'state' IN ('pending','held','admitted','cancelled')
   AND (data->>'queue_version')::bigint>0 AND (data->>'admission_work_version')::bigint>0
   AND (data->>'access_generation')::bigint>0 AND data->>'dependency_fingerprint' ~ '^[0-9a-f]{64}$'
   AND ((data->>'state'='admitted')=(data->>'run_id' IS NOT NULL)),false))
);
CREATE FUNCTION guard_conversation_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'retained queue intent'; END IF;
 PERFORM id FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-'data') IS DISTINCT FROM (to_jsonb(OLD)-'data')
     OR NEW.data-ARRAY['state','reason','run_id','queue_version'] IS DISTINCT FROM OLD.data-ARRAY['state','reason','run_id','queue_version']
     OR OLD.data->>'state' NOT IN ('pending','held')
     OR NEW.data->>'state' NOT IN ('held','admitted','cancelled')
     OR (NEW.data->>'queue_version')::bigint<>(OLD.data->>'queue_version')::bigint+1
     OR (OLD.data->>'state'='held' AND NEW.data->>'state'<>'cancelled')
   THEN RAISE EXCEPTION 'immutable queue intent or invalid transition'; END IF;
 ELSE
   IF NEW.data->>'state'<>'pending' OR NEW.data->'queue_version'<>'1'::jsonb
     OR NOT EXISTS(SELECT 1 FROM conversations cv JOIN memberships m ON m.workspace_id=cv.workspace_id
       JOIN workspaces w ON w.id=cv.workspace_id WHERE cv.workspace_id=NEW.workspace_id AND cv.id=NEW.conversation_id
       AND cv.data->>'owner_id'=NEW.owner_id AND m.principal_id=NEW.owner_id AND m.active AND m.role<>'viewer'
       AND cv.data->>'state'='open' AND cv.data->'work_version'=NEW.data->'admission_work_version'
       AND cv.data->'work_version'=NEW.data->'intent'->'expected_work_version'
       AND to_jsonb(w.access_generation)=NEW.data->'access_generation')
   THEN RAISE EXCEPTION 'current exact queue admission required'; END IF;
 END IF;
 IF NEW.data->>'state'='admitted' AND NOT EXISTS (
   SELECT 1 FROM runs r JOIN run_configurations rc ON rc.workspace_id=r.workspace_id AND rc.run_id=r.id
   JOIN conversation_messages m ON m.workspace_id=r.workspace_id AND m.run_id=r.id
   WHERE r.workspace_id=NEW.workspace_id AND r.id=NEW.data->>'run_id' AND r.conversation_id=NEW.conversation_id
   AND r.data->>'principal_id'=NEW.owner_id AND rc.data->'queued_intent'=jsonb_build_object('id',NEW.id,'command_id',NEW.command_id)
   AND m.author_kind='human' AND m.data->'text'=NEW.data->'intent'->'text'
   AND m.data->'target'=NEW.data->'intent'->'target')
 THEN RAISE EXCEPTION 'queue admission requires canonical exact run'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER conversation_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON conversation_intents
 FOR EACH ROW EXECUTE FUNCTION guard_conversation_intent();

CREATE TABLE retained_result_reads (
 workspace_id text NOT NULL, run_id text NOT NULL, phase text NOT NULL, byte_length integer NOT NULL,
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,run_id,phase), FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id),
 CHECK (byte_length BETWEEN 0 AND 8192), CHECK (octet_length(data::text)<=65536),
 CHECK (phase IN ('selection','selection_2','selection_3','selection_4','selection_5','selection_6','selection_7','selection_8'))
);
CREATE TRIGGER immutable_retained_result_reads BEFORE UPDATE OR DELETE ON retained_result_reads
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION checkpoint_scope_fingerprint(r runs,cfg jsonb) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(acceptance_canonical_json(jsonb_build_object(
   'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('id',ref->>'source_id','data',src.data) ORDER BY ord)
     FROM conversations cv, LATERAL jsonb_array_elements(cv.data->'selected_source_refs') WITH ORDINALITY a(ref,ord)
     JOIN sources src ON src.workspace_id=r.workspace_id AND src.id=ref->>'source_id'
     WHERE cv.workspace_id=r.workspace_id AND cv.id=r.conversation_id),'[]'::jsonb),
   'artifacts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',art.id,'current_revision_id',art.current_revision_id) ORDER BY art.id)
     FROM artifacts art WHERE art.workspace_id=r.workspace_id AND art.conversation_id=r.conversation_id
     AND (NOT cfg ? 'responsibility' OR EXISTS (SELECT 1 FROM jsonb_array_elements(cfg->'responsibility'->'observations') dep
       WHERE dep->>'kind'='artifact_revision' AND dep->>'object_id'=art.id))),'[]'::jsonb),
   'responsibility',cfg->'responsibility')),'UTF8')),'hex')
$$;

CREATE FUNCTION guard_run_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; cfg jsonb; cv jsonb; step jsonb; event jsonb; request responses_steps; a assignments;
BEGIN
 PERFORM id FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id;
 SELECT data INTO cv FROM conversations WHERE workspace_id=NEW.workspace_id AND id=NEW.conversation_id;
 SELECT * INTO a FROM assignments WHERE workspace_id=NEW.workspace_id AND id=NEW.assignment_id;
 IF NEW.checkpoint_hash IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(NEW.data),'UTF8')),'hex')
   OR NEW.data->>'principal_id' IS DISTINCT FROM r.data->>'principal_id'
   OR NEW.data->'run_fence' IS DISTINCT FROM r.data->'fence'
   OR NEW.data->'access_generation' IS DISTINCT FROM r.data->'access_generation'
   OR NEW.data->'conversation_work_version' IS DISTINCT FROM cv->'work_version'
   OR NEW.data->>'configuration_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(cfg),'UTF8')),'hex')
   OR NEW.data->>'scope_fingerprint' IS DISTINCT FROM checkpoint_scope_fingerprint(r,cfg)
   OR NEW.data->>'latest_human_intent_id' IS DISTINCT FROM (SELECT m.id FROM conversation_messages m
       JOIN run_configurations rc ON rc.workspace_id=m.workspace_id AND rc.run_id=m.run_id
       WHERE m.workspace_id=r.workspace_id AND m.conversation_id=r.conversation_id AND m.author_kind='human'
       AND NOT rc.data ? 'continuation' ORDER BY m.sequence DESC LIMIT 1)
   OR NEW.data->>'runtime_sha256' !~ '^[0-9a-f]{64}$'
   OR NEW.data->>'context_sha256' IS DISTINCT FROM (SELECT encode(sha256(convert_to(acceptance_canonical_json(data),'UTF8')),'hex')
       FROM run_contexts WHERE workspace_id=r.workspace_id AND run_id=r.id)
   OR NEW.assignment_id IS DISTINCT FROM cfg->'responsibility'->>'assignment_id'
   OR (NEW.assignment_id IS NOT NULL AND (NEW.data->'assignment_work_version' IS DISTINCT FROM a.data->'work_version'
       OR NEW.data->'assignment_fence' IS DISTINCT FROM to_jsonb(a.responsibility_fence)))
   OR NOT EXISTS (SELECT 1 FROM conversation_messages m WHERE m.workspace_id=NEW.workspace_id
     AND m.conversation_id=NEW.conversation_id AND m.id=NEW.data->>'intent_message_id'
     AND m.author_kind IN ('human','system')
     AND encode(sha256(convert_to(acceptance_canonical_json(m.data),'UTF8')),'hex')=NEW.data->>'intent_sha256')
 THEN RAISE EXCEPTION 'checkpoint requires exact canonical references'; END IF;
 FOR step IN SELECT jsonb_array_elements(NEW.data->'steps') LOOP
   SELECT s.* INTO request FROM responses_steps s JOIN provider_attempts pa ON pa.id=s.attempt_id
     WHERE s.attempt_id=step->>'attempt_id' AND s.phase=step->>'phase' AND pa.workspace_id=r.workspace_id AND pa.run_id=r.id;
   IF request.attempt_id IS NULL OR request.request_sha256 IS DISTINCT FROM step->>'request_sha256'
   THEN RAISE EXCEPTION 'checkpoint request identity mismatch'; END IF;
   IF step-ARRAY['attempt_id','phase','request_sha256','response_id','result_sha256','operation_hash','tool_result_sha256']<>'{}'::jsonb
   THEN RAISE EXCEPTION 'checkpoint references cannot contain raw evidence'; END IF;
   SELECT data INTO event FROM responses_events WHERE attempt_id=request.attempt_id AND phase=request.phase AND kind='identity';
   IF step->>'response_id' IS DISTINCT FROM event->>'response_id' THEN RAISE EXCEPTION 'checkpoint response identity mismatch'; END IF;
   SELECT data INTO event FROM responses_events WHERE attempt_id=request.attempt_id AND phase=request.phase AND kind='result';
   IF step->>'result_sha256' IS DISTINCT FROM (CASE WHEN event IS NULL THEN NULL ELSE encode(sha256(convert_to(acceptance_canonical_json(event),'UTF8')),'hex') END)
   THEN RAISE EXCEPTION 'checkpoint result identity mismatch'; END IF;
   SELECT data INTO event FROM responses_events WHERE attempt_id=request.attempt_id AND phase=request.phase AND kind='tool_result';
   IF step->>'tool_result_sha256' IS DISTINCT FROM (CASE WHEN event IS NULL THEN NULL ELSE encode(sha256(convert_to(acceptance_canonical_json(event),'UTF8')),'hex') END)
      OR step->>'operation_hash' IS DISTINCT FROM event->'binding'->>'operation_hash'
   THEN RAISE EXCEPTION 'checkpoint operation identity mismatch'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER run_checkpoint_guard BEFORE INSERT ON run_checkpoints FOR EACH ROW EXECUTE FUNCTION guard_run_checkpoint();

-- Exactly one initial run per wake; bounded successors have a separately unique
-- predecessor boundary and retain the identical immutable responsibility binding.
DROP INDEX responsibility_one_run_per_wake;
CREATE UNIQUE INDEX responsibility_one_run_per_wake ON run_configurations
 (workspace_id,(data->'responsibility'->>'wake_id')) WHERE data ? 'responsibility' AND NOT data ? 'continuation';
CREATE FUNCTION require_run_successor(r runs,cfg jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cp run_checkpoints; previous runs; old_cfg jsonb; life jsonb; intent jsonb;
BEGIN
 PERFORM id FROM workspaces WHERE id=r.workspace_id FOR UPDATE;
 SELECT * INTO cp FROM run_checkpoints WHERE workspace_id=r.workspace_id AND checkpoint_id=cfg->'continuation'->>'checkpoint_id';
 SELECT * INTO previous FROM runs WHERE workspace_id=r.workspace_id AND id=cfg->'continuation'->>'predecessor_run_id';
 SELECT data INTO old_cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=previous.id;
 SELECT data INTO intent FROM conversation_messages WHERE workspace_id=r.workspace_id AND id=cfg->'continuation'->>'intent_message_id';
 IF cp.checkpoint_id IS NULL OR previous.id IS NULL OR cp.run_id<>previous.id OR cp.conversation_id<>r.conversation_id
   OR cp.checkpoint_kind<>'settlement' OR cp.checkpoint_hash IS DISTINCT FROM cfg->'continuation'->>'checkpoint_hash'
   OR cp.data->>'waiting'<>'none' OR cp.data->>'next_safe_action'<>'continue_slice'
   OR previous.data->>'state'<>'partial' OR previous.data->>'stop_reason'<>'step_limit'
   OR cp.data->'run_fence' IS DISTINCT FROM previous.data->'fence'
   OR cp.data->>'scope_fingerprint' IS DISTINCT FROM checkpoint_scope_fingerprint(previous,old_cfg)
   OR cp.data->'access_generation' IS DISTINCT FROM r.data->'access_generation'
   OR cp.data->>'latest_human_intent_id' IS DISTINCT FROM (SELECT m.id FROM conversation_messages m
       JOIN run_configurations rc ON rc.workspace_id=m.workspace_id AND rc.run_id=m.run_id
       WHERE m.workspace_id=r.workspace_id AND m.conversation_id=r.conversation_id AND m.author_kind='human'
       AND NOT rc.data ? 'continuation' ORDER BY m.sequence DESC LIMIT 1)
   OR r.data->'principal_id' IS DISTINCT FROM previous.data->'principal_id'
   OR cfg->'responses'->>'continuity_version' IS DISTINCT FROM 'sustained-v1'
   OR cfg->'responses'->>'scope_tool_sha256' IS DISTINCT FROM '0b6664002a3c49a5a9c415ab8bc676d528309920d2eb1320b7d59f10268fe177'
   OR cfg-ARRAY['continuation','queued_intent'] IS DISTINCT FROM old_cfg-ARRAY['continuation','queued_intent']
   OR cp.data->>'intent_message_id' IS DISTINCT FROM cfg->'continuation'->>'intent_message_id'
   OR cp.data->>'intent_sha256' IS DISTINCT FROM cfg->'continuation'->>'intent_sha256'
   OR cp.data->>'intent_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(intent),'UTF8')),'hex')
   OR NOT EXISTS (SELECT 1 FROM conversations cv JOIN workspaces w ON w.id=cv.workspace_id
       JOIN memberships m ON m.workspace_id=w.id AND m.principal_id=r.data->>'principal_id'
       WHERE cv.workspace_id=r.workspace_id AND cv.id=r.conversation_id AND cv.data->>'state'='open'
       AND cv.data->'work_version'=cp.data->'conversation_work_version'
       AND to_jsonb(w.access_generation)=r.data->'access_generation' AND m.active AND m.role<>'viewer')
   OR NOT EXISTS (SELECT 1 FROM provider_grants g WHERE g.id=cfg->>'grant_id' AND g.active
       AND (g.data->'expires_at'='null'::jsonb OR (g.data->>'expires_at')::timestamptz>now()))
   OR EXISTS (SELECT 1 FROM provider_attempts pa JOIN runs liability ON liability.workspace_id=pa.workspace_id AND liability.id=pa.run_id
       WHERE liability.workspace_id=r.workspace_id AND liability.conversation_id=r.conversation_id
       AND pa.data->>'state' NOT IN ('reconciled','failed'))
   OR EXISTS (SELECT 1 FROM runs busy WHERE busy.workspace_id=r.workspace_id AND busy.conversation_id=r.conversation_id
       AND busy.id<>r.id AND busy.data->>'state' IN ('queued','running'))
 THEN RAISE EXCEPTION 'exact settled unchanged successor boundary required'; END IF;
 IF cfg ? 'responsibility' THEN
   PERFORM require_responsibility_binding(previous,old_cfg->'responsibility',false);
   SELECT responsibility_lifecycle INTO life FROM assignments WHERE workspace_id=r.workspace_id AND id=cp.assignment_id;
   IF life->>'state'<>'active' OR life->>'blocker' IS NOT NULL OR nullif(life->'wait','null'::jsonb) IS NOT NULL
      OR life->'next_action' IS DISTINCT FROM old_cfg->'responsibility'->'next_action'
      OR life->'current_outcome' IS DISTINCT FROM old_cfg->'responsibility'->'current_outcome'
   THEN RAISE EXCEPTION 'unchanged active responsibility required'; END IF;
 END IF;
END $$;

-- Admission is an explicit terminal-boundary check, not renewal of an expired
-- review lease. Normal dispatch/publication still requires its fresh run lease.
DO $$ DECLARE definition text; old text; BEGIN
 definition=pg_get_functiondef('guard_responsibility_admission()'::regprocedure);
 old=' PERFORM require_responsibility_binding(r,NEW.data->''responsibility'',true);';
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'successor admission predecessor drift'; END IF;
 EXECUTE replace(definition,old,' IF NEW.data ? ''continuation'' THEN PERFORM require_run_successor(r,NEW.data); ELSE'||old||' END IF;');
 definition=pg_get_functiondef('guard_general_message()'::regprocedure);
 old='   PERFORM require_responsibility_binding(r,rc.data->''responsibility'',true);';
 IF position(old in definition)=0 THEN RAISE EXCEPTION 'successor message predecessor drift'; END IF;
 EXECUTE replace(definition,old,'   IF rc.data ? ''continuation'' THEN PERFORM require_run_successor(r,rc.data); ELSE'||old||' END IF;');
END $$;
CREATE FUNCTION guard_run_successor_config() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs;
BEGIN
 IF NEW.data ? 'continuation' THEN
   SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
   PERFORM require_run_successor(r,NEW.data);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER run_successor_config_guard BEFORE INSERT ON run_configurations FOR EACH ROW EXECUTE FUNCTION guard_run_successor_config();
CREATE FUNCTION guard_run_successor_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM run_configurations rc JOIN run_checkpoints cp ON cp.workspace_id=rc.workspace_id
     AND cp.checkpoint_id=rc.data->'continuation'->>'checkpoint_id'
     WHERE rc.workspace_id=NEW.workspace_id AND rc.run_id=NEW.successor_run_id AND cp.checkpoint_id=NEW.checkpoint_id
       AND cp.run_id=NEW.predecessor_run_id AND rc.data->'continuation'->>'predecessor_run_id'=NEW.predecessor_run_id)
 THEN RAISE EXCEPTION 'exact successor link required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER run_successor_link_guard BEFORE INSERT ON run_successors FOR EACH ROW EXECUTE FUNCTION guard_run_successor_link();
CREATE FUNCTION guard_run_successor_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original jsonb; admitted jsonb;
BEGIN
 IF NEW.data ? 'continuation' AND NOT EXISTS (SELECT 1 FROM run_successors s WHERE s.workspace_id=NEW.workspace_id
    AND s.successor_run_id=NEW.run_id AND s.predecessor_run_id=NEW.data->'continuation'->>'predecessor_run_id'
    AND s.checkpoint_id=NEW.data->'continuation'->>'checkpoint_id')
 THEN RAISE EXCEPTION 'successor admission and link must commit together'; END IF;
 IF NEW.data ? 'continuation' THEN
   SELECT data INTO original FROM conversation_messages WHERE workspace_id=NEW.workspace_id AND id=NEW.data->'continuation'->>'intent_message_id';
   SELECT data INTO admitted FROM conversation_messages WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id AND author_kind IN ('human','system');
   IF admitted IS NULL OR original IS NULL OR admitted-ARRAY['id','run_id','sequence','created_at'] IS DISTINCT FROM original-ARRAY['id','run_id','sequence','created_at']
   THEN RAISE EXCEPTION 'successor must retain the exact original intent'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER run_successor_commit AFTER INSERT ON run_configurations DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION guard_run_successor_commit();

-- Fixed canonical safe output. No provider event/hidden reasoning dump.
CREATE FUNCTION retained_safe_value(v jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb; pair record;
BEGIN
 IF jsonb_typeof(v)='object' THEN
   result='{}'::jsonb;
   FOR pair IN SELECT key,value FROM jsonb_each(v) LOOP
     result=result||jsonb_build_object(pair.key,CASE WHEN lower(replace(pair.key,'-','_')) ~
       '(password|secret|credential|authorization|api_key|apikey|token|private_key|reasoning|chain_of_thought)'
       THEN '"[redacted]"'::jsonb ELSE retained_safe_value(pair.value) END);
   END LOOP;
   RETURN result;
 ELSIF jsonb_typeof(v)='array' THEN
   SELECT coalesce(jsonb_agg(retained_safe_value(value) ORDER BY ord),'[]'::jsonb) INTO result
     FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord);
   RETURN result;
 END IF;
 RETURN v;
END $$;
CREATE FUNCTION retained_result_material(r runs,d jsonb) RETURNS bytea LANGUAGE plpgsql AS $$
DECLARE original runs; cfg jsonb; old_cfg jsonb; message jsonb; old_message jsonb; cp jsonb;
        event jsonb; selected jsonb; safe jsonb; target jsonb; snapshot jsonb;
BEGIN
 PERFORM require_general_publication_authority(r);
 SELECT * INTO original FROM runs WHERE workspace_id=r.workspace_id AND id=d->>'run_id';
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT data INTO old_cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=original.id;
 SELECT data INTO message FROM conversation_messages WHERE workspace_id=r.workspace_id AND run_id=r.id AND author_kind IN ('human','system');
 SELECT data INTO old_message FROM conversation_messages WHERE workspace_id=r.workspace_id AND run_id=original.id AND author_kind IN ('human','system');
 IF original.id IS NULL OR original.conversation_id IS DISTINCT FROM r.conversation_id
    OR original.data->'principal_id' IS DISTINCT FROM r.data->'principal_id'
    OR original.data->'access_generation' IS DISTINCT FROM r.data->'access_generation'
    OR message->'target' IS DISTINCT FROM old_message->'target'
    OR cfg->'responsibility'->>'assignment_id' IS DISTINCT FROM old_cfg->'responsibility'->>'assignment_id'
    OR cfg->'responsibility'->'observations' IS DISTINCT FROM old_cfg->'responsibility'->'observations'
 THEN RAISE EXCEPTION 'current same-scope retained result required'; END IF;
 SELECT data INTO snapshot FROM run_contexts WHERE workspace_id=r.workspace_id AND run_id=original.id;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'work_area_context'->'artifacts') item
    WHERE (NOT cfg ? 'responsibility' OR EXISTS (SELECT 1 FROM jsonb_array_elements(cfg->'responsibility'->'observations') dep
       WHERE dep->>'kind'='artifact_revision' AND dep->>'object_id'=item->>'artifact_id'))
    AND (nullif(old_message->'target','null'::jsonb) IS NULL OR old_message->'target'->>'artifact_id'=item->>'artifact_id')
    AND NOT EXISTS (SELECT 1 FROM artifacts art JOIN revisions rev ON rev.workspace_id=art.workspace_id AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
      WHERE art.workspace_id=r.workspace_id AND art.conversation_id=r.conversation_id AND art.id=item->>'artifact_id'
        AND rev.id=item->>'revision_id' AND rev.data->>'body_hash'=item->>'body_hash'))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(snapshot->'evidence_context'->'work_area'->'proposals') item
      WHERE NOT EXISTS (SELECT 1 FROM proposals pr JOIN artifacts art ON art.workspace_id=pr.workspace_id AND art.id=pr.artifact_id
        WHERE pr.workspace_id=r.workspace_id AND pr.id=item->>'proposal_id' AND pr.data->>'status'='pending'
          AND pr.data->>'base_revision_id'=art.current_revision_id))
 THEN RAISE EXCEPTION 'retained source no longer current'; END IF;
 SELECT data INTO cp FROM run_checkpoints WHERE workspace_id=r.workspace_id AND run_id=original.id
   AND phase=d->>'phase' AND checkpoint_hash=d->>'operation_hash';
 IF cp IS NOT NULL THEN RETURN convert_to(acceptance_canonical_json(cp),'UTF8'); END IF;
 SELECT e.data INTO event FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id
   WHERE a.workspace_id=r.workspace_id AND a.run_id=original.id AND e.phase=d->>'phase' AND e.kind='tool_result'
   AND e.data->'binding'->>'operation_hash'=d->>'operation_hash';
 IF event IS NULL THEN RETURN NULL; END IF;
 selected=event->'decision'; target=nullif(old_message->'target','null'::jsonb);
 IF nullif(selected->'target','null'::jsonb) IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM artifacts art JOIN revisions rev ON rev.workspace_id=art.workspace_id AND rev.artifact_id=art.id AND rev.id=art.current_revision_id
   WHERE art.workspace_id=r.workspace_id AND art.conversation_id=r.conversation_id AND art.id=selected->'target'->>'artifact_id'
     AND rev.id=selected->'target'->>'revision_id' AND rev.data->>'body_hash'=selected->'target'->>'body_hash')
 THEN RAISE EXCEPTION 'retained selected revision changed'; END IF;
 IF target IS NOT NULL AND NOT coalesce(selected->'target'=target OR selected->>'kind'='fetch_public_url' OR selected->>'section'='target',false)
 THEN RAISE EXCEPTION 'retained result outside current target'; END IF;
 IF event->'capability_result'->>'capability' IN ('read_saved_work','inspect_json','fetch_public_url')
    OR (event->'capability_result'->>'capability'='read_context' AND selected->>'section' IN ('attachments','target','work_area'))
 THEN safe=event->'capability_result'->'result';
 ELSIF event->>'status'='observed' THEN safe=jsonb_build_object('body',event->'body','output',event->'output');
 ELSE RETURN NULL;
 END IF;
 IF event->'capability_result'->>'capability'='read_saved_work' AND nullif(safe->'body','null'::jsonb) IS NULL THEN RETURN NULL; END IF;
 IF event->'capability_result'->>'capability'='read_context' AND nullif(safe->'value','null'::jsonb) IS NULL THEN RETURN NULL; END IF;
 IF safe IS NULL OR safe='null'::jsonb THEN RETURN NULL; END IF;
 RETURN convert_to(acceptance_canonical_json(retained_safe_value(safe)),'UTF8');
END $$;
CREATE FUNCTION guard_retained_result_read() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs; cfg jsonb; selected jsonb; source bytea; expected jsonb; result jsonb; b jsonb;
        used bigint; pages bigint; off integer; ending integer; lim integer; receipt jsonb;
BEGIN
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 PERFORM require_general_publication_authority(r);
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT e.data INTO receipt FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id
   WHERE a.workspace_id=r.workspace_id AND a.run_id=r.id AND e.phase=NEW.phase AND e.kind='result';
 selected=receipt->'value'->'decision'; b=NEW.data->'binding'; result=NEW.data->'result';
 IF cfg->'responses'->>'continuity_version' IS DISTINCT FROM 'sustained-v1'
   OR cfg->'responses'->>'scope_tool_sha256' IS DISTINCT FROM '0b6664002a3c49a5a9c415ab8bc676d528309920d2eb1320b7d59f10268fe177'
   OR selected->>'kind' IS DISTINCT FROM 'read_result' OR NEW.data->'decision' IS DISTINCT FROM selected
   OR selected-ARRAY['kind','run_id','phase','operation_hash','offset','limit']<>'{}'::jsonb
   OR receipt->>'state' IS DISTINCT FROM 'function_call'
   OR b->>'selection_request_sha256' IS DISTINCT FROM receipt->>'request_sha256'
   OR b->>'selection_response_id' IS DISTINCT FROM receipt->>'response_id'
   OR b->>'decision_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(receipt->'value'),'UTF8')),'hex')
   OR b->>'operation_hash' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected),'UTF8')),'hex')
   OR b->'base_hash' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'exact newly authorized retained read selection required'; END IF;
 source=retained_result_material(r,selected);
 off=(selected->>'offset')::integer; lim=(selected->>'limit')::integer;
 IF off IS NULL OR off<0 OR lim IS NULL OR lim NOT BETWEEN 1 AND 8192 THEN RAISE EXCEPTION 'bounded byte range required'; END IF;
 IF source IS NULL THEN expected='{"status":"unavailable"}'::jsonb;
 ELSE
   IF off>octet_length(source) THEN RAISE EXCEPTION 'invalid byte offset'; END IF;
   -- Explicitly reject a start in the middle of UTF-8. End is the largest safe
   -- boundary <= limit, identical to the broker's returned next_offset.
   PERFORM convert_from(substring(source FROM 1 FOR off),'UTF8');
   ending=least(off+lim,octet_length(source));
   LOOP
     BEGIN
       PERFORM convert_from(substring(source FROM off+1 FOR ending-off),'UTF8');
       EXIT;
     EXCEPTION WHEN character_not_in_repertoire THEN ending=ending-1;
     END;
   END LOOP;
   IF ending=off AND off<octet_length(source) THEN RAISE EXCEPTION 'page too small for UTF8 character'; END IF;
   expected=jsonb_build_object('status','available','text',convert_from(substring(source FROM off+1 FOR ending-off),'UTF8'),
     'offset',off,'next_offset',ending,'body_bytes',octet_length(source),'body_sha256',encode(sha256(source),'hex'),
     'complete',ending=octet_length(source));
 END IF;
 SELECT count(*),coalesce(sum(byte_length),0) INTO pages,used FROM retained_result_reads WHERE workspace_id=r.workspace_id AND run_id=r.id;
 IF result IS DISTINCT FROM expected OR NEW.byte_length<>coalesce(octet_length(convert_to(result->>'text','UTF8')),0)
    OR pages>=8 OR used+NEW.byte_length>32768
 THEN RAISE EXCEPTION 'exact bounded retained page required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retained_result_read_guard BEFORE INSERT ON retained_result_reads FOR EACH ROW EXECUTE FUNCTION guard_retained_result_read();

DROP TRIGGER alpha_stage_guard ON responses_events;
CREATE TRIGGER alpha_stage_guard BEFORE INSERT ON responses_events FOR EACH ROW WHEN (
 coalesce(NEW.data->'decision'->>'kind','') NOT IN ('search_work_context','inspect_json','fetch_public_url','read_result') AND
 coalesce(NEW.data->'capability_result'->>'capability','') NOT IN ('search_work_context','inspect_json','fetch_public_url','read_result')
) EXECUTE FUNCTION guard_alpha_stage();
CREATE FUNCTION guard_retained_result_stage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt jsonb; retained jsonb;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data->'value'->'decision' INTO receipt FROM responses_events WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF coalesce(receipt->>'kind','')<>'read_result' AND coalesce(NEW.data->'decision'->>'kind','')<>'read_result'
    AND coalesce(NEW.data->'capability_result'->>'capability','')<>'read_result' THEN RETURN NEW; END IF;
 SELECT rr.data INTO retained FROM retained_result_reads rr JOIN provider_attempts a ON a.workspace_id=rr.workspace_id AND a.run_id=rr.run_id
   WHERE a.id=NEW.attempt_id AND rr.phase=NEW.phase;
 IF retained IS NULL OR retained->'decision' IS DISTINCT FROM receipt OR NEW.data->'decision' IS DISTINCT FROM receipt
    OR NEW.data->'binding' IS DISTINCT FROM retained->'binding'
    OR NEW.data->'capability_result' IS DISTINCT FROM jsonb_build_object('capability','read_result','version','1','result',retained->'result')
    OR NEW.data->>'status' IS DISTINCT FROM 'reply' OR NEW.data->>'terminal_outcome' NOT IN ('continue','step_limit')
    OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
    OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb OR NEW.data->'file' IS DISTINCT FROM 'null'::jsonb OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'retained page receipt required before model context'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retained_result_stage_guard BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION guard_retained_result_stage();

REVOKE ALL ON run_checkpoints,run_successors,conversation_intents,retained_result_reads FROM PUBLIC;
-- Only give existing runtime roles access to these NEW domain records. No
-- provider authority, owner capability or existing relation grant changes.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='responses_events' AND privilege_type='INSERT'
   AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP
   EXECUTE format('GRANT SELECT,INSERT ON run_checkpoints,run_successors,conversation_intents,retained_result_reads TO %I',r.grantee);
   EXECUTE format('GRANT UPDATE ON conversation_intents TO %I',r.grantee);
 END LOOP;
END $$;

-- A queue record is not another task authority. Both ends of its one canonical
-- admission must agree on the exact original input and unchanged human version.
CREATE FUNCTION guard_queued_run_config() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q conversation_intents; r runs; cv conversations;
BEGIN
 IF NOT NEW.data ? 'queued_intent' THEN RETURN NEW; END IF;
 PERFORM id FROM workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 SELECT * INTO cv FROM conversations WHERE workspace_id=r.workspace_id AND id=r.conversation_id;
 SELECT * INTO q FROM conversation_intents WHERE workspace_id=NEW.workspace_id AND id=NEW.data->'queued_intent'->>'id';
 IF q.id IS NULL OR q.data->>'state'<>'pending' OR q.conversation_id IS DISTINCT FROM r.conversation_id
    OR q.owner_id IS DISTINCT FROM r.data->>'principal_id'
    OR q.command_id IS DISTINCT FROM NEW.data->'queued_intent'->>'command_id'
    OR q.data->'admission_work_version' IS DISTINCT FROM cv.data->'work_version'
    OR q.data->'access_generation' IS DISTINCT FROM r.data->'access_generation'
    OR EXISTS (SELECT 1 FROM conversation_intents earlier WHERE earlier.workspace_id=q.workspace_id
      AND earlier.conversation_id=q.conversation_id AND earlier.position<q.position AND earlier.data->>'state' IN ('pending','held'))
    OR NEW.data ? 'continuation' OR NEW.data ? 'responsibility'
 THEN RAISE EXCEPTION 'unchanged FIFO human queue intent required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER queued_run_config_guard BEFORE INSERT ON run_configurations FOR EACH ROW EXECUTE FUNCTION guard_queued_run_config();
CREATE FUNCTION guard_queued_run_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q jsonb; m jsonb; attachments jsonb;
BEGIN
 IF NOT NEW.data ? 'queued_intent' THEN RETURN NEW; END IF;
 SELECT data INTO q FROM conversation_intents WHERE workspace_id=NEW.workspace_id AND id=NEW.data->'queued_intent'->>'id';
 SELECT data INTO m FROM conversation_messages WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id AND author_kind='human';
 SELECT coalesce(jsonb_agg(value-ARRAY['ref','sha256','byte_length'] ORDER BY ord),'[]'::jsonb) INTO attachments
   FROM jsonb_array_elements(m->'attachments') WITH ORDINALITY a(value,ord);
 IF q->>'state' IS DISTINCT FROM 'admitted' OR q->>'run_id' IS DISTINCT FROM NEW.run_id OR m IS NULL
    OR m->'text' IS DISTINCT FROM q->'intent'->'text' OR m->'target' IS DISTINCT FROM q->'intent'->'target'
    OR nullif(m->'acceptance_checks','null'::jsonb) IS DISTINCT FROM nullif(q->'intent'->'acceptance_checks','null'::jsonb)
    OR m->'operation' IS DISTINCT FROM q->'intent'->'operation' OR attachments IS DISTINCT FROM q->'intent'->'attachments'
 THEN RAISE EXCEPTION 'queued original message and run must commit together'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER queued_run_commit AFTER INSERT ON run_configurations DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION guard_queued_run_commit();
