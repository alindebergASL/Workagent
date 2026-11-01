-- Future opt-in gateway contract. No grant, pin, request or receipt is rewritten.
-- Only the exact schema allowlists change; all authority/material checks remain.
-- sha256(current_gateway.SCHEMA.material):
-- dd380fbc7577ec3f7738686b19bd696bff3f039f713ccabca9be0d67c77745e4
DO $$ DECLARE body text; old text; replacement text; name text;
BEGIN
 name='public.guard_model_discovery_receipt_v2()';
 body=pg_get_functiondef(name::regprocedure);
 old=$q$cfg->'responses'->>'scope_tool_sha256' IS DISTINCT FROM 'e662b6d28c9bd98bd3e0f9e9ed5f417081dd18d3f81f3c2eed71a56535a4c591'$q$;
 replacement=$q$coalesce(cfg->'responses'->>'scope_tool_sha256','') NOT IN ('e662b6d28c9bd98bd3e0f9e9ed5f417081dd18d3f81f3c2eed71a56535a4c591','dd380fbc7577ec3f7738686b19bd696bff3f039f713ccabca9be0d67c77745e4')$q$;
 IF (length(body)-length(replace(body,old,'')))<>length(old) THEN
   RAISE EXCEPTION '084 discovery schema predecessor drift';
 END IF;
 EXECUTE replace(body,old,replacement);
 -- 084 introduced the exact discovery hash once in each existing allowlist.
 -- 085/086 preserve it while extending unrelated rejection/terminal semantics.
 FOREACH name IN ARRAY ARRAY['public.require_alpha_budget_binding(jsonb)',
   'public.require_run_successor(public.runs,jsonb)','public.guard_retained_result_read()'] LOOP
   body=pg_get_functiondef(name::regprocedure);
   old=$q$'e662b6d28c9bd98bd3e0f9e9ed5f417081dd18d3f81f3c2eed71a56535a4c591'$q$;
   replacement=old||$q$,'dd380fbc7577ec3f7738686b19bd696bff3f039f713ccabca9be0d67c77745e4'$q$;
   IF (length(body)-length(replace(body,old,'')))<>length(old) THEN
     RAISE EXCEPTION '084 gateway allowlist predecessor drift: %',name;
   END IF;
   EXECUTE replace(body,old,replacement);
 END LOOP;
END $$;
