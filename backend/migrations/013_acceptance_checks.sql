-- Additive human-check authority. Existing model examples never become goal proof.
-- No new execution rights, tables, grants or accepted runtime bundles.
CREATE FUNCTION acceptance_canonical_json(v jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE jsonb_typeof(v)
   WHEN 'object' THEN '{' || coalesce((SELECT string_agg(to_jsonb(key)::text || ':' || acceptance_canonical_json(value), ',' ORDER BY key COLLATE "C") FROM jsonb_each(v)), '') || '}'
   WHEN 'array' THEN '[' || coalesce((SELECT string_agg(acceptance_canonical_json(value), ',' ORDER BY n) FROM jsonb_array_elements(v) WITH ORDINALITY AS a(value,n)), '') || ']'
   ELSE v::text END;
$$;

CREATE FUNCTION valid_acceptance_spec(spec jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; arg jsonb;
BEGIN
 IF jsonb_typeof(spec) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF spec->>'kind'='wasm_cases' THEN
   IF NOT spec ?& ARRAY['kind','entrypoint','cases'] OR spec-ARRAY['kind','entrypoint','cases']<>'{}'::jsonb
      OR jsonb_typeof(spec->'entrypoint') IS DISTINCT FROM 'string'
      OR (spec->>'entrypoint') !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'
      OR jsonb_typeof(spec->'cases') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
   IF jsonb_array_length(spec->'cases') NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
   FOR item IN SELECT jsonb_array_elements(spec->'cases') LOOP
     IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
     IF NOT item ?& ARRAY['arguments','expected'] OR item-ARRAY['arguments','expected']<>'{}'::jsonb
        OR jsonb_typeof(item->'arguments') IS DISTINCT FROM 'array'
        OR jsonb_typeof(item->'expected') IS DISTINCT FROM 'string'
        OR (item->>'expected') !~ '^(0|-?[1-9][0-9]{0,18})$' THEN RETURN false; END IF;
     IF jsonb_array_length(item->'arguments')>8 OR
        (item->>'expected')::numeric NOT BETWEEN -9223372036854775808 AND 9223372036854775807 THEN RETURN false; END IF;
     FOR arg IN SELECT jsonb_array_elements(item->'arguments') LOOP
       IF jsonb_typeof(arg) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
       IF arg::text !~ '^-?(0|[1-9][0-9]*)$' OR arg::text::numeric NOT BETWEEN -1000000000 AND 1000000000 THEN RETURN false; END IF;
     END LOOP;
   END LOOP;
   RETURN true;
 ELSIF spec->>'kind'='csv_totals' THEN
   IF NOT spec ?& ARRAY['kind','expected_sum','mismatch_count'] OR spec-ARRAY['kind','expected_sum','mismatch_count']<>'{}'::jsonb
      OR jsonb_typeof(spec->'expected_sum') IS DISTINCT FROM 'string'
      OR (spec->>'expected_sum') !~ '^(0|[1-9][0-9]{0,20})\.[0-9]{2}$'
      OR jsonb_typeof(spec->'mismatch_count') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
   RETURN (spec->>'mismatch_count') ~ '^(0|[1-9][0-9]*)$' AND (spec->>'mismatch_count')::numeric BETWEEN 0 AND 500;
 END IF;
 RETURN false;
END;
$$;

CREATE FUNCTION guard_human_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE spec jsonb;
BEGIN
 spec=nullif(NEW.data->'acceptance_checks','null'::jsonb);
 IF spec IS NULL THEN RETURN NEW; END IF;
 IF NEW.author_kind<>'human' OR NOT EXISTS (
    SELECT 1 FROM run_configurations rc WHERE rc.workspace_id=NEW.workspace_id AND rc.run_id=NEW.run_id
      AND rc.data->>'profile'='general-responses-v1'
      AND rc.data->'responses'->>'policy_version'='adaptive-local-v1')
    OR NOT valid_acceptance_spec(spec)
 THEN RAISE EXCEPTION 'bounded human acceptance checks require adaptive authority'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER human_acceptance_guard BEFORE INSERT ON conversation_messages
FOR EACH ROW EXECUTE FUNCTION guard_human_acceptance();

CREATE FUNCTION guard_acceptance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE human conversation_messages; spec jsonb; evidence jsonb; checkrow jsonb;
        criterion jsonb; expected_pass boolean; all_pass boolean=true; n integer; i integer;
        expected_actual jsonb; expected_body_hash text;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT m.* INTO human FROM conversation_messages m JOIN provider_attempts p
   ON p.workspace_id=m.workspace_id AND p.run_id=m.run_id
   WHERE p.id=NEW.attempt_id AND m.author_kind='human';
 spec=nullif(human.data->'acceptance_checks','null'::jsonb);
 evidence=nullif(NEW.data->'verification'->'acceptance','null'::jsonb);
 IF spec IS NULL THEN
   IF evidence IS NOT NULL THEN RAISE EXCEPTION 'acceptance evidence requires immutable human checks'; END IF;
   RETURN NEW;
 END IF;
 IF evidence IS NULL OR jsonb_typeof(evidence) IS DISTINCT FROM 'object'
    OR evidence->'spec' IS DISTINCT FROM spec OR NOT valid_acceptance_spec(spec)
    OR evidence->>'checker_version' IS DISTINCT FROM 'human-checks-v1'
    OR evidence->>'scope' IS DISTINCT FROM 'supplied_checks_only'
    OR evidence->>'spec_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(spec),'UTF8')),'hex')
    OR evidence->'operation_hash' IS DISTINCT FROM NEW.data->'binding'->'operation_hash'
    OR NEW.data->'verification'->'request'->>'message_id' IS DISTINCT FROM human.id
    OR NEW.data->'verification'->'request'->>'message_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(human.data),'UTF8')),'hex')
    OR NEW.data->'verification'->'satisfied' IS DISTINCT FROM 'false'::jsonb
    OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'needs_validation'
    OR NEW.data->>'terminal_outcome'='completed'
 THEN RAISE EXCEPTION 'acceptance evidence must bind the exact human request without claiming goal completion'; END IF;
 IF nullif(NEW.data->'body','null'::jsonb) IS NOT NULL THEN
   expected_body_hash=encode(sha256(convert_to(acceptance_canonical_json(NEW.data->'body'),'UTF8')),'hex');
 END IF;
 IF evidence->>'body_sha256' IS DISTINCT FROM expected_body_hash
    OR jsonb_typeof(evidence->'checks') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'acceptance evidence must bind the checked body'; END IF;
 n=CASE WHEN spec->>'kind'='wasm_cases' THEN jsonb_array_length(spec->'cases') ELSE 1 END;
 IF jsonb_array_length(evidence->'checks')<>n THEN RAISE EXCEPTION 'all supplied acceptance checks required'; END IF;
 FOR i IN 0..n-1 LOOP
   checkrow=evidence->'checks'->i;
   criterion=CASE WHEN spec->>'kind'='wasm_cases' THEN spec->'cases'->i ELSE spec END;
   IF checkrow->'criterion' IS DISTINCT FROM criterion THEN RAISE EXCEPTION 'acceptance criterion changed'; END IF;
   IF spec->>'kind'='wasm_cases' THEN
     expected_pass=coalesce(NEW.data->>'status'='observed'
       AND NEW.data->'decision'->>'kind'='run_wasm'
       AND NEW.data->'decision'->>'entrypoint'=spec->>'entrypoint'
       AND checkrow->'actual'=criterion->'expected',false);
   ELSE
     expected_actual=NULL;
     IF NEW.data->>'status'='observed' AND NEW.data->'decision'->>'kind'='reconcile_csv' THEN
       expected_actual=jsonb_build_object('expected_sum',NEW.data->'output'->'expected_sum',
         'mismatch_count',jsonb_array_length(NEW.data->'output'->'discrepancies'));
       IF checkrow->'actual' IS DISTINCT FROM expected_actual THEN RAISE EXCEPTION 'CSV acceptance requires retained totals'; END IF;
     END IF;
     expected_pass=coalesce(expected_actual=(spec-'kind'),false);
   END IF;
   IF checkrow->'passed' IS DISTINCT FROM to_jsonb(expected_pass) THEN RAISE EXCEPTION 'acceptance pass flag contradicts actual checks'; END IF;
   all_pass=all_pass AND expected_pass;
 END LOOP;
 IF evidence->'passed' IS DISTINCT FROM to_jsonb(all_pass)
    OR (NEW.data->>'terminal_outcome'='needs_validation' AND NOT all_pass)
 THEN RAISE EXCEPTION 'failed acceptance checks cannot claim a passing result'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER acceptance_evidence_guard BEFORE INSERT ON responses_events
FOR EACH ROW EXECUTE FUNCTION guard_acceptance_evidence();

CREATE OR REPLACE FUNCTION guard_general_observation() RETURNS trigger LANGUAGE plpgsql AS $$
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
   AND e.kind='tool_result' AND e.data->'binding'=b;
 IF EXISTS (SELECT 1 FROM run_configurations rc WHERE rc.workspace_id=r.workspace_id AND rc.run_id=r.id
     AND rc.data->'responses'->>'policy_version'='adaptive-local-v1') AND
     NOT (coalesce(t->>'terminal_outcome'='completed' AND t->'verification'->>'satisfied'='true',false)
       OR coalesce(t->>'terminal_outcome'='needs_validation'
          AND t->'verification'->>'satisfied'='false'
          AND (t->'verification'->'acceptance'->>'passed'='true'
            OR (nullif(t->'verification'->'acceptance','null'::jsonb) IS NULL AND t->'verification'->>'model_tests_passed'='true'))
          AND t->'verification'->>'requested_goal_status'='needs_validation',false))
 THEN RAISE EXCEPTION 'passing local tests or independent verification required'; END IF;
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
