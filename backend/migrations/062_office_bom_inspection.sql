-- Additive correction: retain 061 checksums and historical receipts unchanged.
-- Parse an inspection view only; NEW.data retains the human's exact BOM bytes.
CREATE OR REPLACE FUNCTION guard_office_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f workspace_files; v jsonb;
BEGIN
 SELECT * INTO f FROM workspace_files WHERE workspace_id=NEW.workspace_id AND artifact_id=NEW.artifact_id;
 IF f.office_source_snapshot_id IS NULL THEN RETURN NEW; END IF;
 v=ltrim(NEW.data->'body'->>'content',chr(65279))::jsonb;
 IF v->>'office_version' IS DISTINCT FROM 'office-v1' OR coalesce(v->>'kind','') NOT IN ('document','workbook')
 OR jsonb_typeof(v->'annotations') IS DISTINCT FROM 'array'
 OR (v->>'kind'='document' AND jsonb_typeof(v->'paragraphs') IS DISTINCT FROM 'array')
 OR (v->>'kind'='workbook' AND jsonb_typeof(v->'sheets') IS DISTINCT FROM 'array')
 THEN RAISE EXCEPTION 'editable office values required'; END IF;
 RETURN NEW;
END $$;
