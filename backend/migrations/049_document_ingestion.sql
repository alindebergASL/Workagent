-- B2.5: independent immutable binary originals; parent orders after 047/048.
CREATE TABLE conversation_documents (
 workspace_id text NOT NULL, conversation_id text NOT NULL, id text NOT NULL,
 owner_id text NOT NULL, sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 original bytea NOT NULL CHECK(octet_length(original) BETWEEN 1 AND 5242880),
 data jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id),
 CHECK((data->>'document_id'=id AND data->>'workspace_id'=workspace_id
   AND data->>'conversation_id'=conversation_id AND data->>'owner_id'=owner_id
   AND data->>'sha256'=sha256 AND (data->>'byte_length')::integer=octet_length(original)) IS TRUE),
 CHECK(octet_length(data->>'text')<=102400)
);
CREATE INDEX conversation_documents_scope ON conversation_documents(workspace_id,conversation_id,owner_id,id);
CREATE TRIGGER immutable_conversation_documents BEFORE UPDATE OR DELETE ON conversation_documents
 FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
REVOKE ALL ON conversation_documents FROM PUBLIC;
-- Runtime access follows the existing immutable-message table's installed roles.
DO $$ DECLARE r record;
BEGIN
 FOR r IN SELECT DISTINCT grantee FROM information_schema.role_table_grants
 WHERE table_schema='public' AND table_name='conversation_messages' AND privilege_type='INSERT'
   AND grantee<>current_user AND grantee<>'PUBLIC'
 LOOP EXECUTE format('GRANT SELECT,INSERT ON conversation_documents TO %I',r.grantee); END LOOP;
END $$;

ALTER TABLE conversation_documents ADD CONSTRAINT document_exact_original_hash
 CHECK(sha256=encode(sha256(original),'hex'));
ALTER TABLE conversation_documents ADD CONSTRAINT document_exact_text_hash
 CHECK((data->>'text_sha256'=encode(sha256(convert_to(data->>'text','UTF8')),'hex')
       AND (data->>'text_bytes')::integer=octet_length(data->>'text')) IS TRUE);

CREATE FUNCTION guard_message_documents() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; r runs;
BEGIN
 IF NOT (NEW.data ? 'document_refs') THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.data->'document_refs') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.data->'document_refs')>2
    OR (NEW.author_kind<>'human' AND NEW.data->'document_refs'<>'[]'::jsonb)
 THEN RAISE EXCEPTION 'bounded human document references required'; END IF;
 SELECT * INTO r FROM runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 FOR item IN SELECT jsonb_array_elements(NEW.data->'document_refs') LOOP
   IF NOT EXISTS (SELECT 1 FROM conversation_documents d
     WHERE d.workspace_id=NEW.workspace_id AND d.conversation_id=NEW.conversation_id
       AND d.owner_id=r.data->>'principal_id' AND d.id=item->>'document_id'
       AND d.sha256=item->>'sha256' AND d.data=item)
   THEN RAISE EXCEPTION 'exact same-owner immutable document snapshot required'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_message_documents BEFORE INSERT ON conversation_messages
 FOR EACH ROW EXECUTE FUNCTION guard_message_documents();

ALTER TABLE conversation_documents ADD CONSTRAINT document_required_metadata CHECK((
 jsonb_typeof(data)='object' AND data ?& ARRAY['document_id','workspace_id','conversation_id',
 'owner_id','sha256','filename','mime_type','byte_length','text','text_bytes','text_sha256',
 'status','reason','parser_version','coverage','limits']
 AND jsonb_typeof(data->'text')='string'
 AND data->>'status' IN ('extracted','truncated','needs_ocr','unsupported','encrypted','failed','unavailable')
 AND (data->>'status' IN ('extracted','truncated') OR data->>'text'='')
 AND length(data->>'filename')<=85
 AND data->>'filename' ~ '^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*\.(pdf|docx|xlsx)$'
) IS TRUE);
CREATE FUNCTION guard_document_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM conversations cv WHERE cv.workspace_id=NEW.workspace_id
     AND cv.id=NEW.conversation_id AND cv.data->>'owner_id'=NEW.owner_id)
 THEN RAISE EXCEPTION 'conversation document owner required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_document_owner BEFORE INSERT ON conversation_documents
 FOR EACH ROW EXECUTE FUNCTION guard_document_owner();
