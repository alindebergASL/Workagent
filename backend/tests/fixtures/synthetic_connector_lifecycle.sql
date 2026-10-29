INSERT INTO workspaces(id,data) VALUES('b33b-syntax','{}'); INSERT INTO memberships VALUES('b33b-syntax','owner','owner',true); INSERT INTO memberships VALUES('b33b-syntax','viewer','viewer',true);

SET ROLE b33b_app;
DO $$ DECLARE result text; ok boolean; BEGIN
 IF has_table_privilege(current_user,'connector_accounts','INSERT') OR has_table_privilege(current_user,'connector_accounts','UPDATE') OR has_table_privilege(current_user,'connector_accounts','DELETE') THEN RAISE EXCEPTION 'direct mutation allowed'; END IF;
 result=connector_start('b33b-syntax','owner','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','opaque-flow-handle');
 IF result<>'11111111-1111-4111-8111-111111111111' THEN RAISE EXCEPTION 'start mismatch'; END IF;
 result=connector_start('b33b-syntax','owner','33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','other-handle');
 IF result<>'11111111-1111-4111-8111-111111111111' THEN RAISE EXCEPTION 'start replay duplicated'; END IF;
 result=connector_claim('b33b-syntax','owner','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444');
 IF result<>'opaque-flow-handle' THEN RAISE EXCEPTION 'claim mismatch'; END IF;
 result=connector_claim('b33b-syntax','owner','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444');
 IF result IS NOT NULL THEN RAISE EXCEPTION 'callback replay'; END IF;
 ok=connector_finish('b33b-syntax','owner','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','opaque-credential-handle',clock_timestamp()+interval '5 minutes');
 IF NOT ok THEN RAISE EXCEPTION 'finish refused'; END IF;
 result=connector_revoke('b33b-syntax','owner','11111111-1111-4111-8111-111111111111',1,'55555555-5555-4555-8555-555555555555');
 IF result<>'opaque-credential-handle' THEN RAISE EXCEPTION 'revoke mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM connector_accounts WHERE workspace_id='b33b-syntax' AND state='revoked' AND access_generation=2 AND credential_ref IS NULL AND provider_revocation='pending') THEN RAISE EXCEPTION 'local revoke fence missing'; END IF;
 ok=connector_finish('b33b-syntax','owner','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','late-handle',clock_timestamp()+interval '5 minutes');
 IF ok THEN RAISE EXCEPTION 'late completion restored authority'; END IF;
 PERFORM connector_revoke_result('b33b-syntax','owner','11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','failed');
 IF NOT EXISTS(SELECT 1 FROM connector_accounts WHERE workspace_id='b33b-syntax' AND state='revoked' AND access_generation=2 AND provider_revocation='failed') THEN RAISE EXCEPTION 'provider failure lost local block'; END IF;
 BEGIN
 PERFORM connector_start('b33b-syntax','viewer','66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777','opaque');
 RAISE EXCEPTION 'viewer escalated';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'connector unavailable' THEN RAISE; END IF; END;
 BEGIN
 PERFORM connector_revoke('b33b-syntax','intruder','11111111-1111-4111-8111-111111111111',2,'88888888-8888-4888-8888-888888888888');
 RAISE EXCEPTION 'intruder escalated';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'connector unavailable' THEN RAISE; END IF; END;
END $$;
SELECT 'restricted lifecycle assertions passed';

