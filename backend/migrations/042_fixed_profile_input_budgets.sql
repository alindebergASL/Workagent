-- New fixed-profile grants must be able to reserve 50k for each originally
-- allowed generation. Existing grant JSON and monetary/generation caps stay put.
CREATE FUNCTION guard_fixed_intake_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.data->>'profile'='openai-responses-v1'
    AND NEW.data->'responses'->'input_limit' IS DISTINCT FROM '80000'::jsonb
    AND NEW.data->'responses'->'input_limit' IS DISTINCT FROM '200000'::jsonb
 THEN RAISE EXCEPTION 'exact fixed intake input budget required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fixed_intake_input_guard BEFORE INSERT OR UPDATE ON provider_grants
 FOR EACH ROW EXECUTE FUNCTION guard_fixed_intake_input();

DO $$
DECLARE item text[]; definition text; matches integer;
BEGIN
 FOREACH item SLICE 1 IN ARRAY ARRAY[
   ARRAY['guard_general_grant()',
     'b->>''input_limit'' IS DISTINCT FROM (CASE WHEN b->>''policy_version''=''adaptive-local-v1'' THEN ''1000000'' ELSE ''160000'' END)',
     '(b->''input_limit'' IS DISTINCT FROM to_jsonb(CASE WHEN b->>''policy_version''=''adaptive-local-v1'' THEN 1000000 ELSE 160000 END)
       AND b->''input_limit'' IS DISTINCT FROM to_jsonb(CASE WHEN b->>''policy_version''=''adaptive-local-v1'' THEN 2500000 ELSE 400000 END))'],
   ARRAY['guard_responses_event()',
     '(CASE WHEN grantrow.data->>''profile''=''general-responses-v1'' THEN (grantrow.data->''responses''->>''input_limit'')::bigint ELSE 80000 END)',
     '(grantrow.data->''responses''->>''input_limit'')::bigint']
 ] LOOP
   definition=pg_get_functiondef(item[1]::regprocedure);
   matches=(length(definition)-length(replace(definition,item[2],'')))/length(item[2]);
   IF matches<>1 THEN RAISE EXCEPTION 'fixed input migration drift: %',item[1]; END IF;
   EXECUTE replace(definition,item[2],item[3]);
 END LOOP;
END $$;
