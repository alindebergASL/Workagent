-- Existing artifact/revision/proposal authority, now conversation-owned as well.
ALTER TABLE artifacts ALTER COLUMN assignment_id DROP NOT NULL;
ALTER TABLE artifacts ADD COLUMN conversation_id text;
ALTER TABLE artifacts ADD CONSTRAINT artifact_conversation_fk FOREIGN KEY(workspace_id,conversation_id) REFERENCES conversations(workspace_id,id);
ALTER TABLE artifacts ADD CONSTRAINT artifact_one_owner CHECK ((assignment_id IS NOT NULL)::integer+(conversation_id IS NOT NULL)::integer=1);
CREATE TRIGGER immutable_artifact_owner BEFORE UPDATE ON artifacts FOR EACH ROW EXECUTE FUNCTION protect_run_owner();
ALTER TABLE runs DROP CONSTRAINT run_owner_data_binding;
ALTER TABLE runs ADD CONSTRAINT run_owner_data_binding CHECK
 ((data->>'assignment_id') IS NOT DISTINCT FROM assignment_id AND
  (data->>'conversation_id') IS NOT DISTINCT FROM conversation_id AND
  (conversation_id IS NOT NULL) = (data->>'kind' = 'conversation_turn') AND
  (conversation_id IS NOT NULL) = (data->>'profile' IN ('general-controlled-v1','general-products-controlled-v1')));
CREATE TABLE product_observations (
 workspace_id text, id text NOT NULL, run_id text NOT NULL, artifact_id text NOT NULL,
 data jsonb NOT NULL, PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,run_id,artifact_id),
 FOREIGN KEY(workspace_id,run_id) REFERENCES runs(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES artifacts(workspace_id,id),
 CHECK(data->>'id'=id AND data->>'workspace_id'=workspace_id AND data->>'run_id'=run_id AND data->>'artifact_id'=artifact_id)
);
CREATE TRIGGER immutable_product_observations BEFORE UPDATE OR DELETE ON product_observations FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
-- Activation metadata is inert; never modifies accepted intake activation.
INSERT INTO bundle_activations(id,data) VALUES ('general-products-controlled-v1','{"profile":"general-products-controlled-v1","version":"1"}');
-- Upgrade existing restricted conversation writers, not only newly provisioned DBs.
-- New evidence table only; no mutation rights on observations or authority tables.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT DISTINCT g.grantee FROM information_schema.role_table_grants g
 WHERE g.table_schema='public' AND g.table_name='conversation_messages'
   AND g.privilege_type='INSERT' AND g.grantee<>current_user AND g.grantee<>'PUBLIC'
   AND EXISTS (SELECT 1 FROM information_schema.role_table_grants a
     WHERE a.table_schema='public' AND a.table_name='artifacts' AND a.grantee=g.grantee AND a.privilege_type='INSERT')
 LOOP
   EXECUTE format('GRANT SELECT,INSERT ON product_observations TO %I',r.grantee);
 END LOOP;
END $$;
