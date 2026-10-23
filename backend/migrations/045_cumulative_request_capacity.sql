-- Standing-only finite cumulative envelopes. No authority is activated and no
-- grants, requests, receipts, counters, liabilities or active flags are changed.
-- Keep 034's continuity wrapper and the scoped/fixed validators intact.
-- Exact prosrc fingerprint of 037's standing wrapper; fail closed on drift.
DO $$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc
     WHERE oid='require_alpha_budget_binding_pre_continuity(jsonb)'::regprocedure)
    IS DISTINCT FROM '9996f031096563bb21e7c42837cc1ace'
 THEN RAISE EXCEPTION 'cumulative request migration drift'; END IF;
END $$;

CREATE OR REPLACE FUNCTION require_alpha_budget_binding_pre_continuity(b jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE bounded jsonb; k text; ceiling numeric; legacy_ceiling numeric;
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
   -- Validate original values before normalizing ONLY for the scoped validator.
   -- This temporary JSON never replaces stored authority or historical counters.
   FOREACH k IN ARRAY ARRAY['generation_limit','count_limit','input_limit','output_limit'] LOOP
     ceiling=CASE k WHEN 'input_limit' THEN 51200000 WHEN 'output_limit' THEN 8388608 ELSE 1024 END;
     IF jsonb_typeof(b->k) IS DISTINCT FROM 'number'
        OR coalesce(b->>k,'') !~ '^(0|[1-9][0-9]*)$'
     THEN RAISE EXCEPTION 'exact typed standing budget binding required'; END IF;
     IF (b->>k)::numeric>ceiling THEN RAISE EXCEPTION 'standing budget ceiling exceeded'; END IF;
     legacy_ceiling=CASE k WHEN 'input_limit' THEN 12800000 WHEN 'output_limit' THEN 2097152 ELSE 256 END;
     bounded=jsonb_set(bounded,ARRAY[k],to_jsonb(least((b->>k)::numeric,legacy_ceiling)));
   END LOOP;
   PERFORM require_scoped_alpha_budget_binding(bounded);
 ELSE
   PERFORM require_scoped_alpha_budget_binding(b);
 END IF;
END $$;
