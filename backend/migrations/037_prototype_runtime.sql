-- Prototype runtime simplification. No retained rows, grant amounts, request
-- bytes, reservations or receipt identities are rewritten. This grants no money.
-- New standing bindings may express the already authorized $100 cumulative cap;
-- existing lower bindings still bind, and shared historical accounting is intact.
-- 034's continuity wrapper stays installed over the standing validator below.
CREATE OR REPLACE FUNCTION require_alpha_budget_binding_pre_continuity(b jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE bounded jsonb;
BEGIN
 IF b ? 'admission_policy' THEN
   IF b->'admission_policy' IS DISTINCT FROM '"principal-workspace-v1"'::jsonb
      OR b->'conversation_ids' IS DISTINCT FROM '[]'::jsonb
   THEN RAISE EXCEPTION 'exact standing admission policy required'; END IF;
   IF jsonb_typeof(b->'cost_limit_usd') IS DISTINCT FROM 'string'
      OR coalesce(b->>'cost_limit_usd','') !~ '^(0|[1-9][0-9]{0,2})(\.[0-9]{1,6})?$'
      OR (b->>'cost_limit_usd')::numeric>100.00
   THEN RAISE EXCEPTION 'standing cumulative cost ceiling exceeded'; END IF;
   bounded=(b-'admission_policy') || '{"conversation_ids":["validation-only"]}'::jsonb;
   -- Keep the exact historical schema/pins/types, but use the opted-in ceiling.
   bounded=jsonb_set(bounded,'{cost_limit_usd}',to_jsonb(least((b->>'cost_limit_usd')::numeric,20.00)::text));
   PERFORM require_scoped_alpha_budget_binding(bounded);
 ELSE
   PERFORM require_scoped_alpha_budget_binding(b);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION guard_companion_view_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb; target jsonb; config jsonb; author text; ref jsonb;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data->'value'->'decision' INTO selected FROM responses_events
   WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 IF selected->>'kind' IS DISTINCT FROM 'publish_artifact'
    OR selected->'body'->>'kind' IS DISTINCT FROM 'custom_view'
    OR nullif(selected->'target','null'::jsonb) IS NOT NULL
 THEN RETURN NEW; END IF;
 SELECT m.data->'target',m.author_kind,rc.data INTO target,author,config
   FROM provider_attempts a JOIN run_configurations rc ON rc.workspace_id=a.workspace_id AND rc.run_id=a.run_id
   JOIN conversation_messages m ON m.workspace_id=a.workspace_id AND m.run_id=a.run_id
   WHERE a.id=NEW.attempt_id AND m.author_kind IN ('human','system');
 IF nullif(target,'null'::jsonb) IS NULL THEN RETURN NEW; END IF;
 -- Scope is structural authority, not a prompt digest.
 IF author IS DISTINCT FROM 'human' OR config ? 'responsibility'
    OR config->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
    OR selected->'body'->>'version' IS DISTINCT FROM 'custom-view/v1'
    OR jsonb_typeof(selected->'body'->'bindings') IS DISTINCT FROM 'array'
    OR jsonb_array_length(selected->'body'->'bindings')=0
    OR NEW.data->'binding'->'base_hash' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'companion requires exact human source without mutation base'; END IF;
 FOR ref IN SELECT jsonb_array_elements(selected->'body'->'bindings') LOOP
   IF (ref-'name') IS DISTINCT FROM target
   THEN RAISE EXCEPTION 'companion may bind only its exact explicit source'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;

-- require_general_publication_authority rechecks live grant/membership/lease,
-- exact human targets, and responsibility dependencies before retaining a read.
-- Network/SSRF enforcement remains in public_retrieval; all result bounds remain.
CREATE OR REPLACE FUNCTION guard_public_retrieval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected jsonb; decision jsonb; config jsonb; message jsonb;
        observation jsonb; result jsonb; binding jsonb; r runs; step responses_steps;
BEGIN
 IF NEW.kind<>'tool_result' THEN RETURN NEW; END IF;
 SELECT data INTO selected FROM responses_events
   WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase AND kind='result';
 decision=selected->'value'->'decision';
 IF coalesce(decision->>'kind','')<>'fetch_public_url'
    AND coalesce(NEW.data->'decision'->>'kind','')<>'fetch_public_url'
    AND coalesce(NEW.data->'capability_result'->>'capability','')<>'fetch_public_url'
 THEN RETURN NEW; END IF;
 SELECT run.* INTO r FROM provider_attempts a JOIN runs run
   ON run.workspace_id=a.workspace_id AND run.id=a.run_id WHERE a.id=NEW.attempt_id;
 SELECT data INTO config FROM run_configurations WHERE workspace_id=r.workspace_id AND run_id=r.id;
 PERFORM require_general_publication_authority(r);
 SELECT data INTO message FROM conversation_messages WHERE workspace_id=r.workspace_id
   AND run_id=r.id AND author_kind IN ('human','system');
 SELECT * INTO step FROM responses_steps WHERE attempt_id=NEW.attempt_id AND phase=NEW.phase;
 binding=NEW.data->'binding'; observation=NEW.data->'capability_result'; result=observation->'result';
 IF config->'responses'->>'runtime_extension' IS DISTINCT FROM 'general-alpha-v1'
    OR message IS NULL
    OR decision->>'kind' IS DISTINCT FROM 'fetch_public_url'
    OR NEW.data->'decision' IS DISTINCT FROM decision
    OR selected->>'state' IS DISTINCT FROM 'function_call'
    OR observation->>'capability' IS DISTINCT FROM 'fetch_public_url'
    OR observation->>'version' IS DISTINCT FROM '1'
    OR (observation - ARRAY['capability','version','result']) IS DISTINCT FROM '{}'::jsonb
    OR NEW.data->>'status' IS DISTINCT FROM 'reply'
    OR coalesce(NEW.data->>'terminal_outcome','') NOT IN ('continue','step_limit')
    OR NEW.data->'verification'->>'satisfied' IS DISTINCT FROM 'false'
    OR NEW.data->'verification'->>'requested_goal_status' IS DISTINCT FROM 'needs_validation'
    OR NEW.data->'body' IS DISTINCT FROM 'null'::jsonb
    OR NEW.data->'file' IS DISTINCT FROM 'null'::jsonb
    OR NEW.data->'output' IS DISTINCT FROM 'null'::jsonb
    OR binding->>'attempt_id' IS DISTINCT FROM NEW.attempt_id
    OR binding->>'selection_request_sha256' IS DISTINCT FROM selected->>'request_sha256'
    OR binding->>'selection_request_sha256' IS DISTINCT FROM step.request_sha256
    OR binding->>'selection_response_id' IS DISTINCT FROM selected->>'response_id'
    OR binding->>'decision_sha256' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(selected->'value'),'UTF8')),'hex')
    OR binding->>'operation_hash' IS DISTINCT FROM encode(sha256(convert_to(acceptance_canonical_json(decision),'UTF8')),'hex')
    OR binding->'base_hash' IS DISTINCT FROM 'null'::jsonb
    OR result->>'requested_url' IS DISTINCT FROM decision->>'url'
    OR jsonb_typeof(result->'text') IS DISTINCT FROM 'string'
    OR length(result->>'text')>20000
    OR result->>'text_sha256' IS DISTINCT FROM encode(sha256(convert_to(result->>'text','UTF8')),'hex')
    OR result->>'provenance' IS DISTINCT FROM 'public_https_get'
    OR result->>'trust' IS DISTINCT FROM 'untrusted_external_content'
    OR result->'limits' IS DISTINCT FROM '{"body_bytes":262144,"text_characters":20000,"redirects":3,"total_seconds":15}'::jsonb
    OR jsonb_typeof(result->'truncated') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(result->'redirects') IS DISTINCT FROM 'array'
    OR jsonb_array_length(result->'redirects')>3
    OR jsonb_typeof(result->'bytes_read') IS DISTINCT FROM 'number'
    OR (result->>'bytes_read')::numeric NOT BETWEEN 0 AND 262144
    OR jsonb_typeof(result->'fetched_at') IS DISTINCT FROM 'string'
    OR (result->>'fetched_at')::timestamptz > now()+interval '1 minute'
    OR coalesce(result->>'status','') NOT IN ('ok','error')
    OR (result - ARRAY['requested_url','final_url','fetched_at','status','http_status','content_type','title','text','text_sha256','truncated','bytes_read','redirects','error','provenance','trust','limits']) IS DISTINCT FROM '{}'::jsonb
 THEN RAISE EXCEPTION 'exact bounded public retrieval selection required'; END IF;
 IF result->>'status'='ok' THEN
   IF result->'error' IS DISTINCT FROM 'null'::jsonb
      OR coalesce(result->>'final_url','') NOT LIKE 'https://%'
      OR coalesce((result->>'http_status')::integer,0) NOT BETWEEN 200 AND 299
   THEN RAISE EXCEPTION 'public retrieval success requires source provenance'; END IF;
 ELSE
   IF result->>'text' IS DISTINCT FROM '' OR coalesce(result->>'error','') NOT IN (
     'invalid_url','https_public_only','invalid_host','non_public_destination','redirect_limit','invalid_redirect',
     'http_error','unsupported_content_type','unsupported_content_encoding','unsupported_charset','timeout','network_error','reader_unavailable')
   THEN RAISE EXCEPTION 'public retrieval error cannot fabricate content'; END IF;
 END IF;
 RETURN NEW;
END; $$;
