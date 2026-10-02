-- Row-locking SELECTs require UPDATE privilege in PostgreSQL. Granting it must
-- not let the non-owner runtime alter authority or human-maintained sources.
CREATE OR REPLACE FUNCTION protect_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_name text;
BEGIN
 SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid=TG_RELID;
 IF current_user <> owner_name THEN RAISE EXCEPTION 'authority provisioner required'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER runtime_authority_guard BEFORE INSERT OR UPDATE OR DELETE ON workspaces
 FOR EACH ROW EXECUTE FUNCTION protect_authority();
CREATE OR REPLACE TRIGGER runtime_authority_guard BEFORE INSERT OR UPDATE OR DELETE ON memberships
 FOR EACH ROW EXECUTE FUNCTION protect_authority();
CREATE OR REPLACE TRIGGER runtime_authority_guard BEFORE INSERT OR UPDATE OR DELETE ON sources
 FOR EACH ROW EXECUTE FUNCTION protect_authority();
CREATE OR REPLACE TRIGGER runtime_authority_guard BEFORE INSERT OR UPDATE OR DELETE ON source_access
 FOR EACH ROW EXECUTE FUNCTION protect_authority();
