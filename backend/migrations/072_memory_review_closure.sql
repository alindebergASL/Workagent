-- Close the reviewed output graph, preserving all predecessor research checks.
ALTER TABLE revisions ADD COLUMN producer_run_id text;
ALTER TABLE proposals ADD COLUMN producer_run_id text;
ALTER TABLE revisions ADD FOREIGN KEY(workspace_id,producer_run_id) REFERENCES runs(workspace_id,id);
ALTER TABLE proposals ADD FOREIGN KEY(workspace_id,producer_run_id) REFERENCES runs(workspace_id,id);

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
 AND NOT EXISTS(SELECT 1 FROM run_contexts rc JOIN dependencies d ON d.run_id=rc.run_id,
   LATERAL jsonb_array_elements_text(coalesce(rc.data->'research_source_ids','[]'::jsonb)) sid
   WHERE rc.workspace_id=ws AND NOT research_source_visible(ws,sid))
$$;

-- Legacy files.create_draft IDs are exact tool attempt IDs. Read-only derivation
-- covers saved predecessors without bulk modifying their immutable revisions.
CREATE FUNCTION memory_revision_producers(ws text,aid text,rid text) RETURNS TABLE(run_id text)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT o.run_id FROM product_observations o WHERE o.workspace_id=ws
   AND o.artifact_id=aid AND o.data->>'revision_id'=rid
 UNION SELECT r.producer_run_id FROM revisions r WHERE r.workspace_id=ws
   AND r.artifact_id=aid AND r.id=rid AND r.producer_run_id IS NOT NULL
 UNION SELECT a.run_id FROM revisions r JOIN tool_attempts a ON a.workspace_id=r.workspace_id
   AND a.id=r.artifact_id AND a.capability_id='files.create_draft'
   WHERE r.workspace_id=ws AND r.artifact_id=aid AND r.id=rid AND r.data->>'author_kind'='worker'
$$;
CREATE OR REPLACE FUNCTION memory_revision_visible(ws text,aid text,rid text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM memory_revision_producers(ws,aid,rid) p
   WHERE NOT research_run_dependencies_visible(ws,p.run_id))
$$;
CREATE FUNCTION memory_proposal_visible(ws text,pid text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM (
   SELECT o.run_id FROM product_observations o WHERE o.workspace_id=ws AND o.data->>'proposal_id'=pid
   UNION SELECT producer_run_id FROM proposals WHERE workspace_id=ws AND id=pid AND producer_run_id IS NOT NULL
   UNION SELECT a.run_id FROM tool_attempts a JOIN tool_attempt_events e ON e.attempt_id=a.id AND e.kind='observation'
     WHERE a.workspace_id=ws AND a.capability_id='files.propose_patch' AND e.data->'output'->'result'->>'proposal_id'=pid
 ) p WHERE NOT research_run_dependencies_visible(ws,p.run_id))
$$;

DO $$ DECLARE definition text; needle text;
BEGIN
 definition=pg_get_functiondef('memory_dependencies_authorized(text,text,text,text,text,jsonb,timestamptz)'::regprocedure);
 needle=$q$AND r.id=ref->'ref'->>'version_id' AND r.data->'body'->>'content_sha256'=ref->'ref'->>'sha256'$q$;
 IF position(needle in definition)=0 THEN RAISE EXCEPTION '072 file graph predecessor drift'; END IF;
 EXECUTE replace(definition,needle,needle||' AND memory_revision_visible(ws,r.artifact_id,r.id)');
 definition=pg_get_functiondef('memory_evidence_pre_delegation(text,text,text,text,jsonb)'::regprocedure);
 needle=$q$AND (e->>'status'<>'observed' OR research_tool_dependencies_visible(ws,a.id))$q$;
 IF position(needle in definition)=0 THEN RAISE EXCEPTION '072 procedure graph predecessor drift'; END IF;
 EXECUTE replace(definition,needle,needle||' AND research_run_dependencies_visible(ws,a.run_id)');
END $$;

-- Explicit memory/file/tool-evidence lineage. Includes historical references so
-- changing the current dependency list cannot declassify a prior derivative.
CREATE VIEW memory_parent_edges AS
 SELECT e.workspace_id,e.memory_id,e.source_ref->'ref'->>'memory_id' AS parent_id
 FROM memory_evidence e WHERE e.source_ref->>'source_type'='memory'
 UNION
 SELECT e.workspace_id,e.memory_id,m->>'memory_id'
 FROM memory_evidence e JOIN workspace_files f ON f.workspace_id=e.workspace_id
   AND f.id=e.source_ref->'ref'->>'workspace_file_id',
 LATERAL memory_revision_producers(e.workspace_id,f.artifact_id,e.source_ref->'ref'->>'version_id') p,
 run_contexts rc,LATERAL jsonb_array_elements(coalesce(rc.data->'memory_manifest','[]'::jsonb)) m
 WHERE e.source_ref->>'source_type'='file' AND rc.workspace_id=e.workspace_id AND rc.run_id=p.run_id
 UNION
 SELECT r.workspace_id,r.memory_id,m->>'memory_id'
 FROM memory_revisions r,LATERAL jsonb_array_elements(coalesce(nullif(r.data->'procedure','null'::jsonb)->'evidence','[]'::jsonb)) ev,
 tool_attempts a,run_contexts rc,LATERAL jsonb_array_elements(coalesce(rc.data->'memory_manifest','[]'::jsonb)) m
 WHERE ev->>'kind'='tool_observation' AND a.workspace_id=r.workspace_id AND a.id=ev->>'event_id'
   AND rc.workspace_id=a.workspace_id AND rc.run_id=a.run_id;

DO $$ DECLARE definition text; needle text;
BEGIN
 definition=pg_get_functiondef('forget_memory(text,text,text,text,text)'::regprocedure);
 needle=$q$SELECT mid UNION SELECT e.memory_id FROM descendants d JOIN memory_evidence e
     ON e.workspace_id=ws AND e.source_ref->>'source_type'='memory' AND e.source_ref->'ref'->>'memory_id'=d.id$q$;
 IF position(needle in definition)=0 THEN RAISE EXCEPTION '072 forget graph predecessor drift'; END IF;
 EXECUTE replace(definition,needle,$q$SELECT mid UNION SELECT e.memory_id FROM descendants d JOIN memory_parent_edges e
     ON e.workspace_id=ws AND e.parent_id=d.id$q$);
END $$;
-- Existing runtime-role upgrades can read the new content-free edge view. Fresh
-- fixtures grant SELECT ON ALL TABLES after migration, as usual.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT grantee FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='memory_evidence' AND privilege_type='SELECT' AND grantee<>current_user LOOP
   EXECUTE format('GRANT SELECT ON memory_parent_edges TO %I',r.grantee);
 END LOOP;
END $$;
