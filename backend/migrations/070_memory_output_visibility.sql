-- Derived automated material is evidence, not a durable grant to stale memory.
-- Human revisions and immutable accounting are retained, never silently rewritten.
CREATE FUNCTION memory_run_visible(ws text,rid text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE ctx jsonb; entry jsonb; rev jsonb; effective jsonb; owner text;
BEGIN
 SELECT data INTO ctx FROM run_contexts WHERE workspace_id=ws AND run_id=rid;
 IF ctx IS NULL OR NOT ctx ? 'memory_manifest' THEN RETURN true; END IF;
 SELECT data->>'principal_id' INTO owner FROM runs WHERE workspace_id=ws AND id=rid;
 FOR entry IN SELECT value FROM jsonb_array_elements(ctx->'memory_manifest') LOOP
   SELECT r.data INTO rev FROM memory_items i JOIN memory_revisions r
     ON r.workspace_id=i.workspace_id AND r.id=i.current_revision_id
     WHERE i.workspace_id=ws AND i.owner_id=owner AND i.id=entry->>'memory_id';
   effective=rev;
   IF rev->>'exception_to_revision_id' IS NOT NULL AND rev->>'status' IN ('active','contested')
     AND ((rev->>'valid_from')::timestamptz>statement_timestamp()
       OR (rev->>'valid_until')::timestamptz<=statement_timestamp()
       OR (rev->>'expires_at')::timestamptz<=statement_timestamp()) THEN
     SELECT data INTO effective FROM memory_revisions WHERE workspace_id=ws
       AND memory_id=entry->>'memory_id' AND id=rev->>'exception_to_revision_id';
   END IF;
   IF effective IS NULL OR effective->>'status' NOT IN ('active','contested')
     OR effective->>'revision_id' IS DISTINCT FROM entry->>'revision_id'
     OR effective->>'content_sha256' IS DISTINCT FROM entry->>'content_sha256'
     OR effective->>'scope_kind' IS DISTINCT FROM entry->>'scope_kind'
     OR effective->>'scope_id' IS DISTINCT FROM entry->>'scope_id'
     OR (effective->>'valid_from')::timestamptz>statement_timestamp()
     OR (effective->>'valid_until')::timestamptz<=statement_timestamp()
     OR (effective->>'expires_at')::timestamptz<=statement_timestamp()
     OR NOT memory_dependencies_authorized(ws,owner,effective->>'scope_kind',effective->>'scope_id',
       effective->>'memory_id',effective->'source_refs',statement_timestamp())
     THEN RETURN false; END IF;
   IF nullif(effective->'procedure','null'::jsonb) IS NOT NULL AND EXISTS(
     SELECT 1 FROM jsonb_array_elements(effective->'procedure'->'evidence') e
     WHERE NOT memory_procedure_evidence_authorized(ws,owner,effective->>'scope_kind',effective->>'scope_id',e))
     THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

-- Existing retained-read graph and provider count/send SQL fence gains memory.
CREATE OR REPLACE FUNCTION research_run_dependencies_visible(ws text,rid text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH RECURSIVE dependencies(run_id) AS (
   SELECT rid UNION SELECT rr.data->'decision'->>'run_id'
   FROM retained_result_reads rr JOIN dependencies d ON rr.run_id=d.run_id
   WHERE rr.workspace_id=ws AND rr.data->'decision'->>'kind'='read_result'
 )
 SELECT NOT EXISTS(SELECT 1 FROM dependencies d WHERE NOT memory_run_visible(ws,d.run_id))
 AND NOT EXISTS(SELECT 1 FROM tool_attempts a JOIN dependencies d ON d.run_id=a.run_id
   WHERE a.workspace_id=ws AND NOT research_tool_dependencies_visible(ws,a.id))
$$;

CREATE FUNCTION memory_revision_visible(ws text,aid text,rid text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM product_observations o
   WHERE o.workspace_id=ws AND o.artifact_id=aid AND o.data->>'revision_id'=rid
     AND NOT research_run_dependencies_visible(ws,o.run_id))
$$;
