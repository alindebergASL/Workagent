-- Exact semantic rejection; never rewrite an unknown effect or execute a repaired call.
CREATE FUNCTION file_input_source_proof() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT '{"descriptor_sha256":"50a9753983e434f229cf2cf756c089dd51e3d30f2014c4821f0f56243200a56b","implementation_sha256":"8616d4f602f9810cbfa3367328a3da4587d95403c5fc7074bf98638e60ad4b31","implementation_sources":{"../migrations/053_capability_gateway.sql":"f82b8fe693d1b93c48dfd9d98a886b12f151e315a10fb9d0e703d16bc4527858","../migrations/054_workspace_files.sql":"8add07f2a7542636526901d2a4d4447584a2d94260dcde21b39d42ab957748e0","../migrations/055_file_gateway.sql":"3037abc2d40c6f9da955e399040f3156fc4c3e59364a6d8c28654af18c79ba99","../migrations/074_run_output_resources.sql":"75b434a3f013b3e2cf0b3e2d4d96341c1d2dfb6b85d90ba3601b102ce40e13ad","artifact_exports.py":"d021494f2c7c2326c4555692def410340c6274662c55af772f160b8c2f4fb600","capabilities/broker.py":"f1ebb1e16283535ae1ad5d6e9353a7f22f4603f5da3d64e29096bf315d066eb1","capabilities/file_adapters.py":"89a2dc4f23b57adeb620f8108f279d804aed56b8f15acc1ee274bf4097b20e95","capabilities/models.py":"4f2082032e6793aa149d30208cba166f338b6cc85b9560888b1033ab02db63ec","capabilities/observations.py":"4455b64aa5d167dc5d8399eea67c73419fcfcdff323d57dc7ce22c5d6fbcedd9","capabilities/policy.py":"715899073f4ed736f8a84253aa5e96c9bf0b733be52c5a5553bd5b568c6acb8e","capabilities/registry.py":"9f071080dcdf48049f69f656d82cd1983414a5480926a3fabc52a4167dfd60f5","model_base.py":"212fc1bbddca67a8b06f18346a9907e54feee08e9b9eb75cccca461b6f75174a","service.py":"0b61a428308b726f3b4bc0340165d684340cfea51900f05ae75387f27e8f1869","source_snapshots.py":"1f339de2e443df78decf7099f3002327bd5903d7a3151ad699d27babf90a0330","workspace_file_models.py":"08ef3ea540ff1d7862444c080b29e8e4a15aefc3126b1f7fcea758fa618360ce","workspace_files.py":"5384ab867584910916ecc4f5fe4722ded7c12c11b49ced0c0c7cfd064d056b27"},"support_sources":{"db.py":"92b9ae73124534b1564faa254a61660baaa8c533f9a5670191817d14e6482fc7","errors.py":"77f2b77e8eb7c5b58df32fddcc42f0ceefcfcf24ef08682473f8f8596137ffc6","office_content.py":"3a43436026bfeac67e13f73d220af3aadc4ffcef924cb443539f3b3c5fdc4639","product_models.py":"eb21d883ce5ed7d604595f721c7c4594616314826e2a5a00e106cfeefe17ff80"},"version":"native-file-patch-preinsert/v1"}'::jsonb
$$;

CREATE TABLE file_input_no_effect_resolutions (
 tool_attempt_id text PRIMARY KEY REFERENCES tool_attempts(id),
 data jsonb NOT NULL
);
REVOKE ALL ON file_input_no_effect_resolutions FROM PUBLIC;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT grantee FROM information_schema.role_table_grants WHERE table_schema='public'
   AND table_name='responses_events' AND privilege_type='SELECT' AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP EXECUTE format('GRANT SELECT ON file_input_no_effect_resolutions TO %I',r.grantee); END LOOP;
END $$;
CREATE TRIGGER immutable_file_no_effect BEFORE UPDATE OR DELETE ON file_input_no_effect_resolutions
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

-- Only exact wrong NEW text hashes. No base/reference hash inference.
CREATE FUNCTION file_input_wrong_hash(d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(CASE d->>'kind'
 WHEN 'files_propose_patch' THEN
   d ?& ARRAY['kind','ref','content','sha256','reason']
   AND d-ARRAY['kind','ref','content','sha256','reason']='{}'::jsonb
   AND jsonb_typeof(d->'content')='string' AND octet_length(convert_to(d->>'content','UTF8')) BETWEEN 1 AND 200000
   AND d->>'sha256' ~ '^[0-9a-f]{64}$'
   AND d->>'sha256'<>encode(sha256(convert_to(d->>'content','UTF8')),'hex')
   AND jsonb_typeof(d->'reason')='string' AND length(d->>'reason') BETWEEN 1 AND 10000
   AND d->'ref' ?& ARRAY['workspace_file_id','version_id','sha256']
   AND (d->'ref')-ARRAY['workspace_file_id','version_id','sha256']='{}'::jsonb
   AND d->'ref'->>'sha256' ~ '^[0-9a-f]{64}$'
 WHEN 'files_create_draft' THEN
   d ?& ARRAY['kind','source'] AND d-ARRAY['kind','source']='{}'::jsonb
   AND d->'source' ?& ARRAY['kind','filename','mime_type','content','sha256']
   AND (d->'source')-ARRAY['kind','filename','mime_type','content','sha256']='{}'::jsonb
   AND d->'source'->>'kind'='text' AND jsonb_typeof(d->'source'->'content')='string'
   AND octet_length(convert_to(d->'source'->>'content','UTF8')) BETWEEN 1 AND 200000
   AND d->'source'->>'sha256' ~ '^[0-9a-f]{64}$'
   AND d->'source'->>'sha256'<>encode(sha256(convert_to(d->'source'->>'content','UTF8')),'hex')
   AND d->'source'->>'filename' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(txt|md|markdown|csv|json)$'
   AND d->'source'->>'mime_type' IN ('text/plain','text/markdown','text/csv','application/json')
 ELSE false END,false)
$$;

-- This preserves original result/diagnostic bytes. A create-draft validator can
-- reject hash equality although the closed JSON shape is valid. It stays malformed
-- historically; semantic rejection is a separate event, never a repaired result.
CREATE FUNCTION file_input_decision(aid text, step text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE e jsonb; s responses_steps; identity jsonb; doc jsonb; calls jsonb;
BEGIN
 SELECT data INTO e FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='result';
 SELECT * INTO s FROM responses_steps WHERE attempt_id=aid AND phase=step;
 SELECT data INTO identity FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='identity';
 IF e IS NULL OR s.attempt_id IS NULL OR e->>'response_id' IS DISTINCT FROM identity->>'response_id'
   OR e->>'request_sha256' IS DISTINCT FROM s.request_sha256 OR e->'metadata' IS DISTINCT FROM s.metadata
   OR identity->>'request_sha256' IS DISTINCT FROM s.request_sha256 OR identity->'metadata' IS DISTINCT FROM s.metadata
   OR jsonb_typeof(e->'usage') IS DISTINCT FROM 'object'
   OR NOT EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='dispatch')
   OR NOT EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='count_result'
       AND data->>'request_sha256'=s.request_sha256 AND data->'metadata'=s.metadata)
 THEN RETURN NULL; END IF;
 IF e->>'state'='function_call' THEN RETURN e->'value'->'decision'; END IF;
 IF e->>'state' IS DISTINCT FROM 'malformed' OR e->>'issue' IS DISTINCT FROM 'schema_validation_failed'
    OR e->'value' IS DISTINCT FROM 'null'::jsonb OR e->>'rejection_diagnostic' IS NULL THEN RETURN NULL; END IF;
 doc=(e->>'rejection_diagnostic')::jsonb;
 IF doc->>'id' IS DISTINCT FROM e->>'response_id' OR doc->'metadata' IS DISTINCT FROM s.metadata
   OR doc->>'status' IS DISTINCT FROM 'completed' OR doc->'error' IS DISTINCT FROM 'null'::jsonb
   OR doc->'usage'->'input_tokens' IS DISTINCT FROM e->'usage'->'input_tokens'
   OR doc->'usage'->'output_tokens' IS DISTINCT FROM e->'usage'->'output_tokens'
   OR doc->'usage'->'total_tokens' IS DISTINCT FROM e->'usage'->'total_tokens'
   OR doc->'usage'->'input_tokens_details'->'cached_tokens' IS DISTINCT FROM e->'usage'->'cached_input_tokens'
   OR doc->'usage'->'output_tokens_details'->'reasoning_tokens' IS DISTINCT FROM e->'usage'->'reasoning_tokens'
 THEN RETURN NULL; END IF;
 SELECT jsonb_agg(x) INTO calls FROM jsonb_array_elements(doc->'output') x WHERE x->>'type'='function_call';
 IF jsonb_array_length(calls) IS DISTINCT FROM 1 OR calls->0->>'name' IS DISTINCT FROM 'choose_general_action'
 THEN RETURN NULL; END IF;
 RETURN (calls->0->>'arguments')::jsonb->'decision';
END $$;

-- Pure immutable identity proof. Effect absence is checked under the workspace
-- lock by the owner INSERT trigger, not inferred later from an unknown status.
CREATE FUNCTION file_input_no_effect_evidence(tid text, aid text, step text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE t tool_attempts; a provider_attempts; s responses_steps; e responses_events;
 obs jsonb; sent jsonb; d jsonb; proof jsonb=file_input_source_proof(); costs jsonb;
BEGIN
 SELECT * INTO t FROM tool_attempts WHERE id=tid;
 SELECT * INTO a FROM provider_attempts WHERE id=aid;
 SELECT * INTO s FROM responses_steps WHERE attempt_id=aid AND phase=step;
 SELECT * INTO e FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='result';
 SELECT data INTO obs FROM tool_attempt_events WHERE attempt_id=tid AND kind='observation';
 SELECT data INTO sent FROM tool_attempt_events WHERE attempt_id=tid AND kind='dispatch';
 d=file_input_decision(aid,step);
 IF t.id IS NULL OR a.id IS NULL OR e.id IS NULL OR e.data->>'state' IS DISTINCT FROM 'function_call'
   OR t.workspace_id<>a.workspace_id OR t.run_id<>a.run_id OR t.call_id<>step
   OR t.capability_id<>'files.propose_patch' OR t.call->>'capability_id'<>t.capability_id
   OR t.call->>'call_id'<>step OR t.call->'arguments' IS DISTINCT FROM d
   OR t.call_sha256 IS DISTINCT FROM tool_json_hash(t.call)
   OR NOT file_input_wrong_hash(d)
   OR t.descriptor->>'transport' IS DISTINCT FROM 'native'
   OR t.descriptor->>'execution_profile' IS DISTINCT FROM 'native-bounded-files-v1'
   OR t.descriptor->>'implementation_sha256' IS DISTINCT FROM proof->>'implementation_sha256'
   OR tool_json_hash(t.descriptor) IS DISTINCT FROM proof->>'descriptor_sha256'
   OR sent IS DISTINCT FROM '{}'::jsonb OR obs->>'status' IS DISTINCT FROM 'outcome_unknown'
   OR obs->>'attempt_id' IS DISTINCT FROM tid OR obs->>'run_id' IS DISTINCT FROM a.run_id
   OR obs->>'call_id' IS DISTINCT FROM step OR obs->>'capability_id' IS DISTINCT FROM t.capability_id
   OR obs->>'implementation_sha256' IS DISTINCT FROM t.descriptor->>'implementation_sha256'
   OR obs->>'execution_profile' IS DISTINCT FROM 'native-bounded-files-v1'
   OR obs->'output' IS DISTINCT FROM 'null'::jsonb OR obs->'output_sha256' IS DISTINCT FROM 'null'::jsonb
   OR obs->'output_refs' IS DISTINCT FROM '[]'::jsonb OR obs->'error'->>'code' IS DISTINCT FROM 'outcome_unknown'
   OR EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=aid AND phase=step AND kind IN ('tool_result','selection_rejection','cancelled_unapplied','cancel'))
 THEN RETURN NULL; END IF;
 SELECT jsonb_agg(to_jsonb(c)-'created_at' ORDER BY kind) INTO costs FROM tool_cost_entries c WHERE attempt_id=tid;
 IF jsonb_array_length(costs) IS DISTINCT FROM 2 OR NOT EXISTS(SELECT 1 FROM tool_cost_entries
    WHERE attempt_id=tid AND kind='settled' AND basis='unknown') THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version','file-input-no-effect/v1','tool_attempt_id',tid,
   'provider_attempt_id',aid,'phase',step,'call_sha256',t.call_sha256,'descriptor_sha256',tool_json_hash(t.descriptor),
   'dispatch_sha256',tool_json_hash(sent),'observation_sha256',tool_json_hash(obs),'costs_sha256',tool_json_hash(costs),
   'result_event_id',e.id,'result_sha256',tool_json_hash(e.data),'request_sha256',s.request_sha256,
   'response_id',e.data->>'response_id','source_proof',proof);
END $$;

CREATE FUNCTION guard_file_input_no_effect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t tool_attempts; expected jsonb;
BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)
 THEN RAISE EXCEPTION 'owner-only no-effect resolution'; END IF;
 SELECT * INTO t FROM tool_attempts WHERE id=NEW.tool_attempt_id;
 PERFORM id FROM workspaces WHERE id=t.workspace_id FOR UPDATE;
 expected=file_input_no_effect_evidence(t.id,NEW.data->>'provider_attempt_id',NEW.data->>'phase');
 IF expected IS NULL OR NEW.data IS DISTINCT FROM expected
   OR NOT tool_file_resources_authorized(t.workspace_id,t.run_id,t.call)
   OR EXISTS(SELECT 1 FROM proposals WHERE workspace_id=t.workspace_id AND producer_run_id=t.run_id)
   OR EXISTS(SELECT 1 FROM revisions WHERE workspace_id=t.workspace_id AND producer_run_id=t.run_id)
   OR EXISTS(SELECT 1 FROM workspace_files WHERE workspace_id=t.workspace_id AND id=t.id)
   OR EXISTS(SELECT 1 FROM artifact_exports WHERE workspace_id=t.workspace_id AND data->>'tool_attempt_id'=t.id)
 THEN RAISE EXCEPTION 'exact proven native pre-insert failure required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER file_input_no_effect_guard BEFORE INSERT ON file_input_no_effect_resolutions
 FOR EACH ROW EXECUTE FUNCTION guard_file_input_no_effect();

ALTER TABLE responses_events DROP CONSTRAINT responses_events_kind_check;
ALTER TABLE responses_events ADD CONSTRAINT responses_events_kind_check CHECK
 (kind IN ('count_send','count_result','dispatch','identity','result','read','cancel','tool_result',
          'corrected_readback','problem','cancelled_unapplied','selection_rejection','file_input_rejection'));

CREATE FUNCTION file_input_rejection_expected(aid text, step text, fence integer) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE a provider_attempts; e responses_events; s responses_steps; cfg jsonb; d jsonb; t tool_attempts;
 resolution jsonb; generated text; supplied text; n integer; bound integer;
BEGIN
 SELECT * INTO a FROM provider_attempts WHERE id=aid;
 SELECT * INTO e FROM responses_events WHERE attempt_id=aid AND phase=step AND kind='result';
 SELECT * INTO s FROM responses_steps WHERE attempt_id=aid AND phase=step;
 SELECT data INTO cfg FROM run_configurations WHERE workspace_id=a.workspace_id AND run_id=a.run_id;
 d=file_input_decision(aid,step);
 IF a.id IS NULL OR e.id IS NULL OR step!~'^selection(_[2-8])?$'
   OR cfg->'responses'->>'policy_version' IS DISTINCT FROM 'adaptive-local-v1' OR NOT file_input_wrong_hash(d)
   OR EXISTS(SELECT 1 FROM responses_events WHERE attempt_id=aid AND phase=step AND kind IN ('tool_result','selection_rejection','cancelled_unapplied','cancel'))
 THEN RETURN NULL; END IF;
 n=CASE WHEN step='selection' THEN 1 ELSE substring(step from 11)::integer END;
 bound=(cfg->'responses'->>'max_steps')::integer;
 IF bound IS NULL OR n>bound THEN RETURN NULL; END IF;
 SELECT * INTO t FROM tool_attempts WHERE workspace_id=a.workspace_id AND run_id=a.run_id AND call_id=step;
 IF t.id IS NOT NULL THEN
   SELECT data INTO resolution FROM file_input_no_effect_resolutions WHERE tool_attempt_id=t.id;
   IF resolution IS NULL OR resolution IS DISTINCT FROM file_input_no_effect_evidence(t.id,aid,step) THEN RETURN NULL; END IF;
 END IF;
 generated=CASE WHEN d->>'kind'='files_create_draft' THEN d->'source'->>'content' ELSE d->>'content' END;
 supplied=CASE WHEN d->>'kind'='files_create_draft' THEN d->'source'->>'sha256' ELSE d->>'sha256' END;
 RETURN jsonb_build_object('version','file-input-rejection/v1','worker_fence',fence,
   'attempt_id',aid,'phase',step,'result_event_id',e.id,'result_sha256',tool_json_hash(e.data),
   'request_sha256',s.request_sha256,'response_id',e.data->>'response_id','decision_sha256',tool_json_hash(d),
   'resolution_sha256',CASE WHEN resolution IS NULL THEN NULL ELSE tool_json_hash(resolution) END,
   'terminal_outcome',CASE WHEN n=bound THEN 'step_limit' ELSE 'continue' END,
   'feedback',jsonb_build_object('code','file_content_hash_mismatch','effect',CASE WHEN resolution IS NULL THEN 'not_dispatched' ELSE 'historical_unknown_resolved_no_effect' END,
     'detail','The submitted NEW UTF-8 text hash does not match its bytes. No effect was applied. Choose a NEW authorized action; this feedback never executes corrected arguments. The computed hash is for this new text only, never a base/reference hash.',
     'supplied_sha256',supplied,'generated_text',jsonb_build_object('content',generated,'utf8_bytes',octet_length(convert_to(generated,'UTF8')),
       'sha256',encode(sha256(convert_to(generated,'UTF8')),'hex'))));
END $$;

CREATE FUNCTION file_input_rejection_valid(aid text, step text, d jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(d=file_input_rejection_expected(aid,step,(d->>'worker_fence')::integer),false)
$$;

CREATE FUNCTION guard_file_input_rejection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a provider_attempts; r runs; g tool_grants; cfg jsonb; d jsonb; descriptor jsonb; pin jsonb; payload jsonb; refs jsonb; work bigint;
BEGIN
 IF NEW.kind<>'file_input_rejection' THEN RETURN NEW; END IF;
 SELECT * INTO a FROM provider_attempts WHERE id=NEW.attempt_id;
 SELECT * INTO r FROM runs WHERE workspace_id=a.workspace_id AND id=a.run_id;
 PERFORM id FROM workspaces WHERE id=r.workspace_id FOR UPDATE;
 SELECT * INTO g FROM tool_grants WHERE workspace_id=r.workspace_id AND run_id=r.id;
 SELECT (data->>'work_version')::bigint INTO work FROM conversations WHERE workspace_id=r.workspace_id AND id=r.conversation_id;
 d=file_input_decision(NEW.attempt_id,NEW.phase);
 SELECT ci.descriptor INTO descriptor FROM capability_installations ci WHERE id=CASE d->>'kind'
   WHEN 'files_create_draft' THEN 'files.create_draft' WHEN 'files_propose_patch' THEN 'files.propose_patch' END AND version='1' AND enabled;
 SELECT value INTO pin FROM jsonb_array_elements(g.data->'capabilities') WHERE value->>'id'=descriptor->>'id';
 refs=CASE WHEN d->>'kind'='files_propose_patch' THEN jsonb_build_array(jsonb_build_object('kind','workspace_file',
   'id',d->'ref'->>'workspace_file_id','version',d->'ref'->>'version_id','sha256',d->'ref'->>'sha256')) ELSE '[]'::jsonb END;
 payload=jsonb_build_object('capability_id',descriptor->>'id','arguments',d,'input_refs',refs);
 IF NOT file_input_rejection_valid(NEW.attempt_id,NEW.phase,NEW.data)
   OR NEW.data->'worker_fence' IS DISTINCT FROM r.data->'fence'
   OR NOT tool_authorized(r.workspace_id,r.id,(r.data->>'fence')::integer,r.lease_hash,g.id,work)
   OR descriptor IS NULL OR pin IS NULL OR pin->>'version' IS DISTINCT FROM descriptor->>'version'
   OR pin->>'schema_sha256' IS DISTINCT FROM descriptor->>'schema_sha256'
   OR pin->>'implementation_sha256' IS DISTINCT FROM descriptor->>'implementation_sha256'
   OR NOT ((g.data->'effects') @> (descriptor->'effects')) OR NOT ((g.data->'privacy_classes') @> (descriptor->'privacy_classes'))
   OR NOT tool_file_resources_authorized(r.workspace_id,r.id,payload)
 THEN RAISE EXCEPTION 'exact authorized file input rejection required'; END IF;
 PERFORM require_general_publication_authority(r);
 RETURN NEW;
END $$;
CREATE TRIGGER file_input_rejection_guard BEFORE INSERT ON responses_events
 FOR EACH ROW EXECUTE FUNCTION guard_file_input_rejection();

-- Unrelated unknown tools still hold admission, steps and checkpoints. Original
-- observations stay unknown; only a consumed exact no-effect resolution settles.
CREATE FUNCTION file_input_tools_unresolved(ws text,rid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM tool_attempts t JOIN tool_attempt_events sent ON sent.attempt_id=t.id AND sent.kind='dispatch'
   LEFT JOIN tool_attempt_events obs ON obs.attempt_id=t.id AND obs.kind='observation'
   WHERE t.workspace_id=ws AND t.run_id=rid AND obs.data->>'status' IS DISTINCT FROM 'observed'
   AND NOT EXISTS(SELECT 1 FROM responses_events e JOIN provider_attempts a ON a.id=e.attempt_id
     WHERE a.workspace_id=ws AND a.run_id=rid AND e.phase=t.call_id AND e.kind='file_input_rejection'
       AND e.data->>'resolution_sha256' IS NOT NULL AND file_input_rejection_valid(e.attempt_id,e.phase,e.data)))
$$;
CREATE FUNCTION guard_file_input_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF file_input_tools_unresolved(NEW.workspace_id,NEW.run_id)
   AND (NEW.data->>'waiting' IS DISTINCT FROM 'unknown' OR NEW.data->>'next_safe_action' IS DISTINCT FROM 'reconcile')
 THEN RAISE EXCEPTION 'unresolved tool effects require reconciliation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER file_input_checkpoint_guard BEFORE INSERT ON run_checkpoints
 FOR EACH ROW EXECUTE FUNCTION guard_file_input_checkpoint();

DO $$ DECLARE definition text; old text=$q$NEW.kind IN ('count_send','dispatch','read','cancel','tool_result','selection_rejection')$q$;
BEGIN
 definition=pg_get_functiondef('guard_responses_event()'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>
     '0bc84596348a3407af47960494c6a13c3b3fac6f9966110f300b243c4894936b'
    OR (length(definition)-length(replace(definition,old,'')))<>length(old)
 THEN RAISE EXCEPTION 'file rejection authority predecessor drift'; END IF;
 EXECUTE replace(definition,old,$q$NEW.kind IN ('count_send','dispatch','read','cancel','tool_result','selection_rejection','file_input_rejection')$q$);
END $$;
DO $$ DECLARE definition text; old text=$q$kind IN ('tool_result','selection_rejection')$q$;
BEGIN
 definition=pg_get_functiondef('guard_responses_step()'::regprocedure);
 IF encode(sha256(convert_to(definition,'UTF8')),'hex')<>
     '384de338ede48c63155c37d4d7462ab6edc0ac32c3c56051475f3ead952cbcb7'
    OR (length(definition)-length(replace(definition,old,'')))<>2*length(old)
 THEN RAISE EXCEPTION 'file rejection step predecessor drift'; END IF;
 EXECUTE replace(definition,old,$q$(kind IN ('tool_result','selection_rejection') OR (kind='file_input_rejection' AND file_input_rejection_valid(attempt_id,phase,data)))$q$);
END $$;

CREATE FUNCTION guard_file_input_step() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a provider_attempts;
BEGIN
 SELECT * INTO a FROM provider_attempts WHERE id=NEW.attempt_id;
 IF file_input_tools_unresolved(a.workspace_id,a.run_id)
 THEN RAISE EXCEPTION 'unresolved tool send blocks new response step'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER file_input_step_guard BEFORE INSERT ON responses_steps
 FOR EACH ROW EXECUTE FUNCTION guard_file_input_step();
