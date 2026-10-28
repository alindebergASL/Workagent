-- Owner-private working files retain the same privacy through inherited event,
-- attention, snapshot, proposal and responsibility aliases. Ordinary artifacts
-- keep their existing membership/source visibility. Additive; no stored rewrites.
CREATE OR REPLACE FUNCTION work_artifact_visible(ws text, who text, cid text, aid text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM public.artifacts a
   LEFT JOIN public.assignments job ON job.workspace_id=a.workspace_id AND job.id=a.assignment_id
   JOIN public.conversations cv ON cv.workspace_id=a.workspace_id AND cv.id=coalesce(a.conversation_id,job.conversation_id)
   WHERE a.workspace_id=ws AND a.id=aid AND cv.id=cid
     AND NOT EXISTS (SELECT 1 FROM public.workspace_files f
       WHERE f.workspace_id=ws AND f.artifact_id=aid AND f.owner_id<>who)
     AND work_refs_visible(ws,who,coalesce(job.data->'selected_source_refs',cv.data->'selected_source_refs'))
     AND NOT EXISTS (SELECT 1 FROM public.revisions r WHERE r.workspace_id=ws AND r.artifact_id=aid
       AND (NOT work_refs_visible(ws,who,r.data->'source_dependencies') OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(r.data->'source_dependencies') dep WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(coalesce(job.data->'selected_source_refs',cv.data->'selected_source_refs')) selected
           WHERE selected->>'source_id'=dep->>'source_id')))))
$$;
