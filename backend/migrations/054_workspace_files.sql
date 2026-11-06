-- B3.0b additive metadata/ref stores. No original-byte duplication or backfill.
CREATE TABLE workspace_files (
 workspace_id text NOT NULL, id text NOT NULL, conversation_id text NOT NULL,
 owner_id text NOT NULL, artifact_id text, filename text NOT NULL, mime_type text NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,artifact_id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,principal_id),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id),
 CHECK(artifact_id IS NULL OR artifact_id=id),
 CHECK(length(filename) BETWEEN 1 AND 255 AND filename !~ '[/\\]' AND filename NOT IN ('.','..'))
);
CREATE INDEX workspace_files_scope ON workspace_files(workspace_id,conversation_id,owner_id,id);
CREATE TABLE source_snapshots (
 workspace_id text NOT NULL, id text NOT NULL, workspace_file_id text NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0), parent_snapshot_id text,
 data jsonb NOT NULL, PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,workspace_file_id,version_number),
 FOREIGN KEY(workspace_id,workspace_file_id) REFERENCES workspace_files(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_snapshot_id) REFERENCES source_snapshots(workspace_id,id),
 CHECK((data->>'snapshot_id'=id AND data->>'workspace_id'=workspace_id
   AND data->>'workspace_file_id'=workspace_file_id AND (data->>'version_number')::integer=version_number
   AND data->>'trust_label'='untrusted_evidence'
   AND data->>'original_sha256' ~ '^[0-9a-f]{64}$'
   AND data->>'extraction_sha256' ~ '^[0-9a-f]{64}$') IS TRUE)
);
CREATE TABLE generated_blobs (
 workspace_id text NOT NULL, id text NOT NULL, owner_id text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'), mime_type text NOT NULL,
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 1048576),
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,principal_id),
 CHECK(sha256=encode(sha256(bytes),'hex'))
);
CREATE TABLE artifact_exports (
 workspace_id text NOT NULL, id text NOT NULL, owner_id text NOT NULL, blob_id text NOT NULL,
 data jsonb NOT NULL, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES memberships(workspace_id,principal_id),
 FOREIGN KEY(workspace_id,blob_id) REFERENCES generated_blobs(workspace_id,id),
 CHECK((data->>'export_id'=id AND data->>'workspace_id'=workspace_id
   AND data->'blob'->>'blob_id'=blob_id AND data->'blob'->>'kind'='generated_blob'
   AND data->>'format' IN ('txt','markdown','csv','json')) IS TRUE)
);
CREATE TRIGGER immutable_workspace_files BEFORE UPDATE OR DELETE ON workspace_files FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_source_snapshots BEFORE UPDATE OR DELETE ON source_snapshots FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_generated_blobs BEFORE UPDATE OR DELETE ON generated_blobs FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_artifact_exports BEFORE UPDATE OR DELETE ON artifact_exports FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION guard_workspace_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM conversations WHERE workspace_id=NEW.workspace_id AND id=NEW.conversation_id AND data->>'owner_id'=NEW.owner_id)
 OR (NEW.artifact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM artifacts WHERE workspace_id=NEW.workspace_id AND id=NEW.artifact_id AND conversation_id=NEW.conversation_id))
 THEN RAISE EXCEPTION 'same-owner conversation file required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_workspace_file BEFORE INSERT ON workspace_files FOR EACH ROW EXECUTE FUNCTION guard_workspace_file();

CREATE FUNCTION guard_workspace_text_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f workspace_files; b jsonb;
BEGIN
 SELECT * INTO f FROM workspace_files WHERE workspace_id=NEW.workspace_id AND artifact_id=NEW.artifact_id;
 IF f.id IS NULL THEN RETURN NEW; END IF;
 b=NEW.data->'body';
 IF b->>'kind' IS DISTINCT FROM 'file' OR b->>'filename' IS DISTINCT FROM 'content.txt'
   OR b->>'mime_type' IS DISTINCT FROM 'text/plain' OR octet_length(b->>'content') NOT BETWEEN 1 AND 200000
   OR b->>'content_sha256' IS DISTINCT FROM encode(sha256(convert_to(b->>'content','UTF8')),'hex')
   OR NEW.data->>'body_hash' IS DISTINCT FROM tool_json_hash(b)
 THEN RAISE EXCEPTION 'exact immutable working text required'; END IF;
 IF f.mime_type='application/json' THEN PERFORM ltrim(b->>'content',chr(65279))::jsonb; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_workspace_text_revision BEFORE INSERT ON revisions FOR EACH ROW EXECUTE FUNCTION guard_workspace_text_revision();
CREATE TRIGGER guard_workspace_text_proposal BEFORE INSERT ON proposals FOR EACH ROW EXECUTE FUNCTION guard_workspace_text_revision();

CREATE FUNCTION guard_source_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f workspace_files; previous source_snapshots; original bytea; extraction bytea; source jsonb;
BEGIN
 SELECT * INTO f FROM workspace_files WHERE workspace_id=NEW.workspace_id AND id=NEW.workspace_file_id;
 IF f.artifact_id IS NOT NULL OR NEW.data->>'conversation_id' IS DISTINCT FROM f.conversation_id
   OR NEW.data->>'parent_snapshot_id' IS DISTINCT FROM NEW.parent_snapshot_id
 THEN RAISE EXCEPTION 'immutable evidence file required'; END IF;
 SELECT * INTO previous FROM source_snapshots WHERE workspace_id=NEW.workspace_id AND workspace_file_id=NEW.workspace_file_id ORDER BY version_number DESC LIMIT 1;
 IF NEW.version_number<>coalesce(previous.version_number,0)+1 OR NEW.parent_snapshot_id IS DISTINCT FROM previous.id
 THEN RAISE EXCEPTION 'exact source refresh parent required'; END IF;
 IF NEW.data->'locator'->>'kind'='document' THEN
   SELECT d.original,convert_to(d.data->>'text','UTF8') INTO original,extraction FROM conversation_documents d
     WHERE d.workspace_id=NEW.workspace_id AND d.conversation_id=f.conversation_id AND d.owner_id=f.owner_id
       AND d.id=NEW.data->'locator'->>'document_id';
 ELSIF NEW.data->'locator'->>'kind'='attachment' THEN
   SELECT item INTO source FROM conversation_messages m CROSS JOIN LATERAL jsonb_array_elements(m.data->'attachments') item
     WHERE m.workspace_id=NEW.workspace_id AND m.conversation_id=f.conversation_id
       AND m.id=NEW.data->'locator'->>'message_id' AND m.author_kind='human' AND m.data->>'evidence_origin'='human'
       AND item->>'ref'=NEW.data->'locator'->>'ref';
   original=convert_to(source->>'content','UTF8'); extraction=original;
 ELSE RAISE EXCEPTION 'existing original reference required'; END IF;
 IF original IS NULL OR extraction IS NULL
   OR NEW.data->'locator'->>'sha256' IS DISTINCT FROM encode(sha256(original),'hex')
   OR NEW.data->>'original_sha256' IS DISTINCT FROM encode(sha256(original),'hex')
   OR NEW.data->>'extraction_sha256' IS DISTINCT FROM encode(sha256(extraction),'hex')
   OR (NEW.data->>'original_byte_length')::integer IS DISTINCT FROM octet_length(original)
   OR (NEW.data->>'extraction_byte_length')::integer IS DISTINCT FROM octet_length(extraction)
 THEN RAISE EXCEPTION 'exact retained original and extraction required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_source_snapshot BEFORE INSERT ON source_snapshots FOR EACH ROW EXECUTE FUNCTION guard_source_snapshot();

CREATE FUNCTION guard_artifact_export() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b generated_blobs; f workspace_files;
BEGIN
 SELECT * INTO b FROM generated_blobs WHERE workspace_id=NEW.workspace_id AND id=NEW.blob_id AND owner_id=NEW.owner_id;
 IF b.id IS NULL OR NEW.data->'blob'->>'sha256' IS DISTINCT FROM b.sha256
   OR NEW.data->'blob'->>'mime_type' IS DISTINCT FROM b.mime_type
   OR (NEW.data->'blob'->>'byte_length')::integer IS DISTINCT FROM octet_length(b.bytes)
 THEN RAISE EXCEPTION 'exact generated byte manifest required'; END IF;
 IF NEW.data->>'workspace_file_id' IS NOT NULL THEN
   SELECT * INTO f FROM workspace_files WHERE workspace_id=NEW.workspace_id AND id=NEW.data->>'workspace_file_id' AND owner_id=NEW.owner_id;
   IF f.id IS NULL OR NEW.data->>'conversation_id' IS DISTINCT FROM f.conversation_id
     OR NEW.data->>'artifact_id' IS DISTINCT FROM f.artifact_id
   THEN RAISE EXCEPTION 'same-owner file export required'; END IF;
   IF f.artifact_id IS NULL THEN
     IF NOT EXISTS (SELECT 1 FROM source_snapshots s WHERE s.workspace_id=NEW.workspace_id AND s.workspace_file_id=f.id
         AND s.id=NEW.data->>'revision_id' AND s.id=NEW.data->>'source_snapshot_id'
         AND s.data->>'extraction_sha256'=NEW.data->>'input_sha256')
     THEN RAISE EXCEPTION 'exact source export required'; END IF;
   ELSE
     IF NOT EXISTS (SELECT 1 FROM revisions r WHERE r.workspace_id=NEW.workspace_id AND r.artifact_id=f.artifact_id
         AND r.id=NEW.data->>'revision_id' AND r.data->'body'->>'content_sha256'=NEW.data->>'input_sha256')
     THEN RAISE EXCEPTION 'exact file revision export required'; END IF;
   END IF;
 ELSE
   IF NOT EXISTS (SELECT 1 FROM revisions r WHERE r.workspace_id=NEW.workspace_id AND r.artifact_id=NEW.data->>'artifact_id'
       AND r.id=NEW.data->>'revision_id' AND r.data->>'body_hash'=NEW.data->>'input_sha256')
   THEN RAISE EXCEPTION 'exact artifact export required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_artifact_export BEFORE INSERT ON artifact_exports FOR EACH ROW EXECUTE FUNCTION guard_artifact_export();

REVOKE ALL ON workspace_files,source_snapshots,generated_blobs,artifact_exports FROM PUBLIC;
DO $$ DECLARE r record;
BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='conversation_messages' AND privilege_type='INSERT'
   AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP EXECUTE format('GRANT SELECT,INSERT ON workspace_files,source_snapshots,generated_blobs,artifact_exports TO %I',r.grantee); END LOOP;
END $$;
