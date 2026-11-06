-- Research evidence remains authority-dependent when copied into tool receipts.
-- Keep immutable accounting/history; deny new consumers and provider sends.
CREATE FUNCTION research_tool_dependencies_visible(ws text, aid text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE a tool_attempts; e jsonb; ref jsonb; s source_snapshots;
BEGIN
 SELECT * INTO a FROM tool_attempts WHERE workspace_id=ws AND id=aid;
 IF a.id IS NULL THEN RETURN false; END IF;
 SELECT data INTO e FROM tool_attempt_events WHERE attempt_id=aid AND kind='observation';
 IF a.capability_id='research.capture' AND e->>'status'='observed'
    AND nullif(e->'output'->'result'->'snapshot','null'::jsonb) IS NOT NULL
    AND NOT research_source_visible(ws,aid) THEN RETURN false; END IF;
 IF a.capability_id='research.cite' AND e->>'status'='observed'
    AND NOT research_claim_visible(ws,aid) THEN RETURN false; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(a.call->'input_refs') LOOP
   IF ref->>'kind'='workspace_file' THEN
     SELECT * INTO s FROM source_snapshots WHERE workspace_id=ws AND id=ref->>'version';
     IF s.id IS NOT NULL AND s.data->'locator'->>'kind'='public_source'
       AND (s.workspace_file_id IS DISTINCT FROM ref->>'id'
         OR s.data->>'extraction_sha256' IS DISTINCT FROM ref->>'sha256'
         OR NOT research_source_visible(ws,s.id)) THEN RETURN false; END IF;
   END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION research_run_dependencies_visible(ws text,rid text) RETURNS boolean LANGUAGE sql STABLE AS $$
 -- read_result copies old evidence into a new run without a tool_attempt.
 -- Follow those retained reads transitively (UNION also terminates cycles).
 WITH RECURSIVE dependencies(run_id) AS (
   SELECT rid
   UNION
   SELECT rr.data->'decision'->>'run_id'
   FROM retained_result_reads rr JOIN dependencies d ON rr.run_id=d.run_id
   WHERE rr.workspace_id=ws AND rr.data->'decision'->>'kind'='read_result'
 )
 SELECT NOT EXISTS(SELECT 1 FROM tool_attempts a JOIN dependencies d ON d.run_id=a.run_id
   WHERE a.workspace_id=ws AND NOT research_tool_dependencies_visible(ws,a.id))
$$;

CREATE FUNCTION guard_research_provider_egress() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r runs;
BEGIN
 IF NEW.kind IN ('count_send','dispatch') THEN
   SELECT rr.* INTO r FROM runs rr JOIN provider_attempts a ON a.workspace_id=rr.workspace_id AND a.run_id=rr.id WHERE a.id=NEW.attempt_id;
   IF r.id IS NOT NULL AND NOT research_run_dependencies_visible(r.workspace_id,r.id)
     THEN RAISE EXCEPTION 'research dependency no longer visible'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_research_provider_egress BEFORE INSERT ON responses_events FOR EACH ROW EXECUTE FUNCTION guard_research_provider_egress();
